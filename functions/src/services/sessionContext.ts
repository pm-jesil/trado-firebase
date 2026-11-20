/**
 * Canonical AuthSessionContext Builder
 * 
 * Shared across both authentication entry points:
 * 1. authMe (Canonical production bootstrap for Flutter Web / Mobile)
 * 2. authLogin (Local emulator testing adapter for Swagger UI / curl / Postman)
 */

import { HttpsError } from "firebase-functions/v2/https";
import { db, auth } from "./firebase.js";
import { effectiveBusinessConfig } from "../constants/businessDefaults.js";
import { requireCurrency } from "./money.js";
import { getExponent } from "../constants/currencies.js";
import {
  UserDoc,
  MembershipDoc,
  OrganizationDoc,
  BranchDoc,
  MembershipBranchDoc,
  RoleDoc,
  JobRoleDoc,
  SubscriptionPlanDoc,
} from "../types/models.js";
import {
  AuthSessionContext,
  AuthUserContext,
  AuthRoleContext,
  AuthJobRoleContext,
  AuthOrganizationContext,
  AuthPrimaryOrganizationContext,
  AuthBranchContext,
  AuthPrimaryBranchContext,
  AuthDeviceContext,
} from "../types/api.js";
import { resolveAllEffectivePermissions } from "./permissionResolver.js";
import { DEFAULT_SYSTEM_ROLES } from "../constants/catalogs.js";
import { evaluateSubscription } from "./subscription.js";
import { hydrateImageUrl } from "./imageEngine.js";
import { GateReason } from "../constants/enums.js";

export interface BuildAuthSessionContextOptions {
  uid: string;
  deviceId?: string;
  requestedOrgId?: string;
  requestedBranchId?: string;
}

function toSubscriptionContext(org: OrganizationDoc): NonNullable<AuthSessionContext["subscription"]> {
  const sub = evaluateSubscription(org);
  return {
    state: sub.state,
    planId: org.planId || null,
    expiresAt: sub.expiresAt ?? null,
    graceEndsAt: sub.graceEndsAt ?? null,
    daysRemaining: sub.daysRemaining ?? null,
  };
}

export async function buildAuthSessionContext(
  options: BuildAuthSessionContextOptions
): Promise<AuthSessionContext> {
  const { uid, deviceId, requestedOrgId, requestedBranchId } = options;

  // 1. Fetch User Record from Firestore (Identity & Status Authority)
  const userDocRef = db.collection("users").doc(uid);
  const userSnapshot = await userDocRef.get();

  if (!userSnapshot.exists) {
    throw new HttpsError("not-found", "User profile not found. User must be provisioned first.");
  }

  const userData = userSnapshot.data() as UserDoc;
  if (!userData.isActive) {
    throw new HttpsError("permission-denied", "User account is inactive or suspended.");
  }

  // 2. Truthful Device ID Recognition (Idempotent Metadata)
  let deviceContext: AuthDeviceContext | null = null;
  if (deviceId && typeof deviceId === "string" && deviceId.trim().length >= 4 && deviceId.trim().length <= 128) {
    const cleanDeviceId = deviceId.trim();
    const nowIso = new Date().toISOString();
    const deviceRef = userDocRef.collection("devices").doc(cleanDeviceId);

    await deviceRef.set(
      {
        lastLoginAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    deviceContext = {
      deviceId: cleanDeviceId,
      recognized: true,
    };
  }

  // 3. Resolve Super Admin Status (Cryptographic Custom Claim Authority ONLY)
  // A client-writable or Firestore profile field such as accountType MUST NEVER grant Super Admin.
  let isSuperAdmin = false;
  try {
    const userRecord = await auth.getUser(uid);
    if (userRecord.disabled) {
      throw new HttpsError("permission-denied", "User account is disabled in Firebase Authentication.");
    }
    isSuperAdmin = userRecord.customClaims?.isSuperAdmin === true;
  } catch (err: unknown) {
    if (err instanceof HttpsError) throw err;
    isSuperAdmin = false;
  }

  // 4. Permission Catalog Codes
  const catalogQuery = await db.collection("permissionCatalog").get();
  let catalogCodes = catalogQuery.docs.map((d) => d.id);
  if (catalogCodes.length === 0) {
    for (const r of DEFAULT_SYSTEM_ROLES) {
      catalogCodes.push(...r.permissions);
    }
  }
  catalogCodes = Array.from(new Set(catalogCodes));

  // 5. Super Admin Platform Isolation
  if (isSuperAdmin) {
    const platformPerms = catalogCodes.filter((c) => c.startsWith("platform:"));
    if (!platformPerms.includes("platform:*")) {
      platformPerms.unshift("platform:*");
    }

    const superAdminUser: AuthUserContext = {
      uid,
      email: userData.email,
      name: userData.name,
      phone: userData.phone || null,
      /** D-15: compute display URL from stored path via hydrateImageUrl; never read a stored URL field. */
      imageUrl: hydrateImageUrl(userData.image),
      accountType: "super_admin",
      isActive: userData.isActive,
      isSuperAdmin: true,
    };

    return {
      user: superAdminUser,
      role: null, // STRICT: Super Admin has role === null (no tenant role)
      jobRoles: [],
      permissions: [], // STRICT: Zero tenant permissions for platform Super Admin
      platformPermissions: platformPerms,
      organizations: [],
      primaryOrganization: null,
      branches: [],
      primaryBranch: null,
      device: deviceContext,
      contextStatus: "platform",
    };
  }

  // 6. Tenant User: Load Active Memberships
  const membershipsQuery = await db
    .collection("memberships")
    .where("userId", "==", uid)
    .get();

  const activeMemberships = membershipsQuery.docs.filter(
    (d) => (d.data() as MembershipDoc).status === "active"
  );

  const tenantUser: AuthUserContext = {
    uid,
    email: userData.email,
    name: userData.name,
    phone: userData.phone || null,
    /** D-15: compute display URL from stored path via hydrateImageUrl; never read a stored URL field. */
    imageUrl: hydrateImageUrl(userData.image),
    accountType: userData.accountType || "standard",
    isActive: userData.isActive,
    isSuperAdmin: false,
  };

  if (activeMemberships.length === 0) {
    return {
      user: tenantUser,
      role: null,
      jobRoles: [],
      permissions: [],
      platformPermissions: [],
      organizations: [],
      primaryOrganization: null,
      branches: [],
      primaryBranch: null,
      device: deviceContext,
      contextStatus: "no_active_membership",
    };
  }

  // 7. Resolve Organization List in parallel (avoids N+1 sequential round-trips)
  const orgResolvedList = await Promise.all(
    activeMemberships.map(async (doc) => {
      const mem = doc.data() as MembershipDoc;
      const [orgSnap, roleSnap] = await Promise.all([
        db.collection("organizations").doc(mem.organizationId).get(),
        db.collection("roles").doc(mem.roleId).get(),
      ]);
      const orgData = orgSnap.exists ? (orgSnap.data() as OrganizationDoc) : null;
      const roleData = roleSnap.exists ? (roleSnap.data() as RoleDoc) : null;

      return {
        doc,
        mem,
        orgData,
        roleData,
        contextItem: {
          organizationId: mem.organizationId,
          name: orgData?.name,
          roleId: mem.roleId,
          roleName: roleData?.name,
          isPrimary: mem.isPrimary || false,
        } as AuthOrganizationContext,
      };
    })
  );

  const organizationsList = orgResolvedList.map((item) => item.contextItem);

  // Determine Active Primary Membership according to the simple selection rule:
  // Rule 1: If requestedOrgId specified and valid active membership exists -> use it
  // Rule 2: If user has exactly one active membership -> select it automatically
  // Rule 3: If user has multiple active memberships and one valid server-stored primary exists -> use it
  // Rule 4: If multiple memberships exist without an unambiguous primary -> return organization_selection_required
  let selectedOrgItem: typeof orgResolvedList[0] | null = null;

  if (requestedOrgId) {
    selectedOrgItem = orgResolvedList.find((item) => item.mem.organizationId === requestedOrgId) || null;
    if (!selectedOrgItem) {
      throw new HttpsError(
        "permission-denied",
        `User does not have an active membership in organization "${requestedOrgId}".`
      );
    }
  } else if (activeMemberships.length === 1) {
    selectedOrgItem = orgResolvedList[0];
  } else {
    const explicitPrimaries = orgResolvedList.filter((item) => item.mem.isPrimary === true);
    if (explicitPrimaries.length === 1) {
      selectedOrgItem = explicitPrimaries[0];
    }
  }

  // If multiple memberships exist and there is NO unambiguous active context:
  if (!selectedOrgItem) {
    return {
      user: tenantUser,
      role: null,
      jobRoles: [],
      permissions: [], // STRICT: Zero tenant permissions when organization selection is required
      platformPermissions: [],
      organizations: organizationsList,
      primaryOrganization: null,
      branches: [],
      primaryBranch: null,
      device: deviceContext,
      contextStatus: "organization_selection_required",
    };
  }

  const primaryMembershipDoc = selectedOrgItem.doc;
  const primaryMembership = selectedOrgItem.mem;
  const primaryOrgData = selectedOrgItem.orgData;
  const roleData = selectedOrgItem.roleData;

  const primaryOrgContext: AuthPrimaryOrganizationContext | null = primaryOrgData
    ? {
      organizationId: primaryMembership.organizationId,
      name: primaryOrgData.name,
      currency: requireCurrency(primaryOrgData.currency, `organization "${primaryMembership.organizationId}"`),
      currencyDecimals: getExponent(primaryOrgData.currency),
      timezone: primaryOrgData.timezone || "Asia/Kolkata",
      country: primaryOrgData.country || "IN",
      taxRegimeCode: primaryOrgData.taxRegimeCode || "IN_GST",
      businessType: primaryOrgData.businessType,
      businessCategory: primaryOrgData.businessCategory,
    }
    : null;

  // 7b. Organization status & subscription: a locked tenant gets a distinct status, zero permissions
  if (primaryOrgData) {
    const sub = evaluateSubscription(primaryOrgData);
    const subscriptionContext = toSubscriptionContext(primaryOrgData);
    let lockedStatus: AuthSessionContext["contextStatus"] | null = null;
    if (primaryOrgData.status !== "active") lockedStatus = "organization_inactive";
    else if (sub.reason === GateReason.SUBSCRIPTION_EXPIRED) lockedStatus = "subscription_expired";
    else if (sub.reason === GateReason.SUBSCRIPTION_NOT_STARTED) lockedStatus = "subscription_not_started";
    else if (sub.reason) lockedStatus = "subscription_suspended";
    if (lockedStatus) {
      return {
        user: tenantUser,
        role: null,
        jobRoles: [],
        permissions: [],
        platformPermissions: [],
        organizations: organizationsList,
        primaryOrganization: primaryOrgContext,
        branches: [],
        primaryBranch: null,
        device: deviceContext,
        contextStatus: lockedStatus,
        subscription: subscriptionContext,
      };
    }
  }

  // 8. Resolve Role, Job Roles & Branch Context for Primary Organization
  const roleCode = roleData?.code || "employee";
  const isOrgOwner = roleCode === "org_owner";

  const roleContext: AuthRoleContext = {
    scope: "organization",
    roleId: primaryMembership.roleId,
    roleName: roleData?.name || "Employee",
    roleCode,
  };

  // Job Roles (parallel fetch)
  const jobRolesList: AuthJobRoleContext[] = [];
  if (primaryMembership.jobRoleIds && primaryMembership.jobRoleIds.length > 0) {
    const jrSnaps = await Promise.all(
      primaryMembership.jobRoleIds.map((jrId) => db.collection("jobRoles").doc(jrId).get())
    );
    for (const jrDoc of jrSnaps) {
      if (jrDoc.exists) {
        const jrData = jrDoc.data() as JobRoleDoc;
        jobRolesList.push({
          jobRoleId: jrDoc.id,
          name: jrData.name,
          code: jrData.code || jrDoc.id,
        });
      }
    }
  }

  // Branch Assignments via membershipBranches
  const mbQuery = await db.collection("membershipBranches")
    .where("membershipId", "==", primaryMembershipDoc.id)
    .where("status", "==", "active")
    .get();

  const assignedBranchIds = mbQuery.docs.map((d) => (d.data() as MembershipBranchDoc).branchId);

  // Available Active Branches in Organization
  const branchesSnap = await db.collection("organizations")
    .doc(primaryMembership.organizationId)
    .collection("branches")
    .where("isActive", "==", true)
    .get();

  const availableBranches: AuthBranchContext[] = [];
  for (const bDoc of branchesSnap.docs) {
    const bData = bDoc.data() as BranchDoc;
    if (isOrgOwner || assignedBranchIds.includes(bDoc.id)) {
      availableBranches.push({
        branchId: bDoc.id,
        name: bData.name,
        code: bData.code,
        isDefault: bData.isDefault || false,
      });
    }
  }

  // Fallback branch if none populated
  if (availableBranches.length === 0 && primaryOrgData) {
    const defaultBId = primaryOrgData.defaultBranchId || "main-branch";
    availableBranches.push({
      branchId: defaultBId,
      name: "Main Branch",
      code: "MAIN",
      isDefault: true,
    });
  }

  // Determine Active Primary Branch
  let primaryBranchContext: AuthPrimaryBranchContext | null = null;
  let targetBranchId: string | undefined;

  if (requestedBranchId && availableBranches.some((b) => b.branchId === requestedBranchId)) {
    targetBranchId = requestedBranchId;
  } else if (primaryMembership.primaryBranchId && availableBranches.some((b) => b.branchId === primaryMembership.primaryBranchId)) {
    targetBranchId = primaryMembership.primaryBranchId;
  } else {
    const defaultBranch = availableBranches.find((b) => b.isDefault) || availableBranches[0];
    targetBranchId = defaultBranch?.branchId;
  }

  const selectedBranch = availableBranches.find((b) => b.branchId === targetBranchId);
  if (selectedBranch) {
    primaryBranchContext = {
      branchId: selectedBranch.branchId,
      name: selectedBranch.name,
      code: selectedBranch.code,
    };
  }

  // 9. Effective Permissions Resolution
  let planFlags: Record<string, boolean> = {};
  if (primaryOrgData?.planId) {
    const planDoc = await db.collection("subscriptionPlans").doc(primaryOrgData.planId).get();
    if (planDoc.exists) {
      planFlags = (planDoc.data() as SubscriptionPlanDoc).moduleFlags || {};
    }
  }

  const effectivePermissions = resolveAllEffectivePermissions(catalogCodes, {
    isSuperAdmin: false,
    roleCode,
    rolePermissions: roleData?.permissions || [],
    membershipOverrides: primaryMembership.permissions || {},
    planModuleFlags: planFlags,
    orgModuleToggles: primaryOrgData ? effectiveBusinessConfig(primaryOrgData).modules : {},
  });

  // 10. Compute Context Status
  let contextStatus: AuthSessionContext["contextStatus"] = "ready";
  if (!primaryBranchContext) {
    contextStatus = "branch_selection_required";
  }

  return {
    user: tenantUser,
    role: roleContext,
    jobRoles: jobRolesList,
    permissions: effectivePermissions,
    platformPermissions: [], // STRICT: Platform permissions empty for tenant users
    organizations: organizationsList,
    primaryOrganization: primaryOrgContext,
    branches: availableBranches,
    primaryBranch: primaryBranchContext,
    device: deviceContext,
    contextStatus,
    businessConfig: primaryOrgData ? effectiveBusinessConfig(primaryOrgData) : null, // override ?? business-type default
    subscription: primaryOrgData ? toSubscriptionContext(primaryOrgData) : null,
  };
}

