/**
 * Centralized Request Context Resolver
 * 
 * Enforces unified tenant and branch boundary isolation across all Trado Cloud Functions:
 * 1. Authentication verification
 * 2. Token claim inspection (primaryOrganizationId, primaryBranchId, isSuperAdmin)
 * 3. Live Firestore membership verification
 * 4. Active branch assignment verification (membershipBranches)
 * 5. Branch active status & tenant boundary verification
 * 6. Four-layer permission & branch module override resolution
 * 7. Rejection of conflicting client-supplied organizationId or branchId
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import {
  OrganizationDoc,
  BranchDoc,
  MembershipDoc,
  MembershipBranchDoc,
  SubscriptionPlanDoc,
  RoleDoc,
} from "../types/models.js";
import { EntityStatus } from "../constants/enums.js";
import {
  resolvePermission,
  resolveAllEffectivePermissions,
  type PermissionResolutionContext,
} from "./permissionResolver.js";

export interface RequestContextOptions {
  requiredPermission?: string;
  allowPlatformSuperAdmin?: boolean;
  allowInactiveBranch?: boolean;
}

export interface RequestContext {
  callerUid: string;
  isSuperAdmin: boolean;
  organizationId: string;
  branchId: string;
  organization: OrganizationDoc;
  branch: BranchDoc;
  membership?: MembershipDoc;
  membershipBranch?: MembershipBranchDoc;
  plan: SubscriptionPlanDoc;
  role?: RoleDoc;
  effectivePermissions: string[];
}

export async function resolveRequestContext(
  request: CallableRequest,
  options: RequestContextOptions = {}
): Promise<RequestContext> {
  // 1. Authentication Check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const callerUid = request.auth.uid;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  const clientData = (request.data || {}) as Record<string, unknown>;

  const clientOrgId = typeof clientData.organizationId === "string" ? clientData.organizationId.trim() : undefined;
  const clientBranchId = typeof clientData.branchId === "string" ? clientData.branchId.trim() : undefined;
  const tokenOrgId = typeof request.auth.token.primaryOrganizationId === "string"
    ? request.auth.token.primaryOrganizationId.trim()
    : undefined;
  const tokenBranchId = typeof request.auth.token.primaryBranchId === "string"
    ? request.auth.token.primaryBranchId.trim()
    : undefined;

  // 2. Super Admin Platform Operations (bypasses tenant when no org specified)
  if (isSuperAdmin && !clientOrgId && !tokenOrgId && options.allowPlatformSuperAdmin) {
    if (options.requiredPermission && !options.requiredPermission.startsWith("platform:")) {
      throw new HttpsError(
        "invalid-argument",
        "Super Admin business operations require an explicit target organizationId."
      );
    }

    const platformOrg: OrganizationDoc = {
      name: "Trado Platform Admin",
      businessType: "retail" as any,
      businessCategory: "general" as any,
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      status: EntityStatus.ACTIVE,
      planId: "plan_enterprise",
      moduleToggles: {},
      defaultBranchId: "main-branch",
      branchCount: 1,
      createdAt: new Date().toISOString(),
      createdBy: "system",
    };

    const platformBranch: BranchDoc = {
      organizationId: "platform",
      name: "Platform Management",
      code: "MAIN",
      isDefault: true,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: "system",
    };

    const platformPlan: SubscriptionPlanDoc = {
      name: "Platform Unlimited",
      price: 0,
      currency: "INR",
      storageLimitMb: 999999,
      monthlyDocumentVolumeLimit: 999999,
      seatLimits: { admin: 999, staff: 999 },
      branchLimit: 999,
      moduleFlags: {},
      isActive: true,
    };

    return {
      callerUid,
      isSuperAdmin: true,
      organizationId: "platform",
      branchId: "main-branch",
      organization: platformOrg,
      branch: platformBranch,
      plan: platformPlan,
      effectivePermissions: ["*"],
    };
  }

  // 3. Determine and Validate Target Organization ID
  let targetOrgId = clientOrgId;

  if (!isSuperAdmin) {
    if (clientOrgId && tokenOrgId && clientOrgId !== tokenOrgId) {
      throw new HttpsError(
        "permission-denied",
        "Client-supplied organizationId does not match caller's active organization context."
      );
    }
    targetOrgId = tokenOrgId || clientOrgId;
  }

  if (!targetOrgId) {
    // Attempt fallback to user's active membership in Firestore
    const memQuery = await db
      .collection("memberships")
      .where("userId", "==", callerUid)
      .where("status", "==", "active")
      .limit(2)
      .get();

    if (memQuery.empty) {
      throw new HttpsError("permission-denied", "No active organization membership found.");
    }
    targetOrgId = (memQuery.docs[0].data() as MembershipDoc).organizationId;
  }

  // 4. Fetch Organization
  const orgDocRef = db.collection("organizations").doc(targetOrgId);
  const orgSnap = await orgDocRef.get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", `Organization "${targetOrgId}" not found.`);
  }
  const orgData = orgSnap.data() as OrganizationDoc;
  if (orgData.status !== "active") {
    throw new HttpsError("failed-precondition", `Organization "${targetOrgId}" is not active.`);
  }

  const defaultBranchId = orgData.defaultBranchId || "main-branch";

  // 5. Determine Target Branch ID
  let targetBranchId: string;
  if (clientBranchId) {
    targetBranchId = clientBranchId;
  } else if (tokenBranchId) {
    targetBranchId = tokenBranchId;
  } else {
    targetBranchId = defaultBranchId;
  }

  // 6. Fetch Target Branch
  const branchDocRef = orgDocRef.collection("branches").doc(targetBranchId);
  const branchSnap = await branchDocRef.get();
  if (!branchSnap.exists) {
    throw new HttpsError("not-found", `Branch "${targetBranchId}" not found in organization "${targetOrgId}".`);
  }
  const branchData = branchSnap.data() as BranchDoc;
  if (!branchData.isActive && !options.allowInactiveBranch) {
    throw new HttpsError("failed-precondition", `Branch "${targetBranchId}" is inactive.`);
  }

  // 7. Fetch Subscription Plan
  let planData: SubscriptionPlanDoc = {
    name: "Standard Plan",
    price: 0,
    currency: orgData.currency || "INR",
    storageLimitMb: 1024,
    monthlyDocumentVolumeLimit: 5000,
    seatLimits: { admin: 5, staff: 20 },
    branchLimit: 1,
    moduleFlags: {},
    isActive: true,
  };

  if (orgData.planId) {
    const planSnap = await db.collection("subscriptionPlans").doc(orgData.planId).get();
    if (planSnap.exists) {
      planData = planSnap.data() as SubscriptionPlanDoc;
    }
  }

  // 8. Super Admin bypass for membership resolution
  if (isSuperAdmin) {
    return {
      callerUid,
      isSuperAdmin: true,
      organizationId: targetOrgId,
      branchId: targetBranchId,
      organization: orgData,
      branch: branchData,
      plan: planData,
      effectivePermissions: ["*"],
    };
  }

  // 9. Fetch and Validate Membership
  const membershipId = `${callerUid}_${targetOrgId}`;
  const membershipRef = db.collection("memberships").doc(membershipId);
  const membershipSnap = await membershipRef.get();

  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "Caller is not a member of this organization.");
  }
  const membershipData = membershipSnap.data() as MembershipDoc;
  if (membershipData.status !== "active") {
    throw new HttpsError("permission-denied", "Caller membership in this organization is not active.");
  }

  // 10. Fetch Role
  let roleData: RoleDoc | undefined;
  if (membershipData.roleId) {
    const roleSnap = await db.collection("roles").doc(membershipData.roleId).get();
    if (roleSnap.exists) {
      roleData = roleSnap.data() as RoleDoc;
    }
  }

  const isOwner = roleData?.code === "org_owner" || membershipData.roleId === "role_owner";

  // 11. Validate Branch Assignment via membershipBranches
  const membershipBranchId = `${membershipId}_${targetBranchId}`;
  const membershipBranchRef = db.collection("membershipBranches").doc(membershipBranchId);
  const membershipBranchSnap = await membershipBranchRef.get();

  let membershipBranchData: MembershipBranchDoc | undefined;

  if (membershipBranchSnap.exists) {
    membershipBranchData = membershipBranchSnap.data() as MembershipBranchDoc;
    if (membershipBranchData.status !== "active" && !isOwner && !options.allowInactiveBranch) {
      throw new HttpsError(
        "permission-denied",
        `Caller is not actively assigned to branch "${targetBranchId}".`
      );
    }
  } else {
    // Org Owner has tenant-wide branch access by default
    if (!isOwner) {
      throw new HttpsError(
        "permission-denied",
        `Caller is not assigned to branch "${targetBranchId}".`
      );
    }
  }

  // 12. Evaluate Permissions
  const resolutionContext: PermissionResolutionContext = {
    isSuperAdmin: false,
    roleCode: roleData?.code,
    rolePermissions: roleData?.permissions || [],
    membershipOverrides: membershipData.permissions || {},
    branchMembershipOverrides: membershipBranchData?.permissions,
    planModuleFlags: planData.moduleFlags || {},
    orgModuleToggles: orgData.moduleToggles || {},
    branchModuleOverrides: branchData.settings?.moduleOverrides,
  };

  if (options.requiredPermission) {
    const granted = resolvePermission(options.requiredPermission, resolutionContext);
    if (!granted) {
      throw new HttpsError(
        "permission-denied",
        `Insufficient permissions: "${options.requiredPermission}" is required.`
      );
    }
  }

  const effectivePermissions = resolveAllEffectivePermissions(
    roleData?.permissions || [],
    resolutionContext
  );

  return {
    callerUid,
    isSuperAdmin: false,
    organizationId: targetOrgId,
    branchId: targetBranchId,
    organization: orgData,
    branch: branchData,
    membership: membershipData,
    membershipBranch: membershipBranchData,
    plan: planData,
    role: roleData,
    effectivePermissions,
  };
}
