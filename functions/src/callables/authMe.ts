/**
 * authMe Callable
 * 
 * Session bootstrap endpoint (equivalent to legacy /auth/me).
 * Returns user profile, active memberships, and resolved permissions.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { UserDoc, MembershipDoc, OrganizationDoc, RoleDoc, SubscriptionPlanDoc, BranchDoc, MembershipBranchDoc } from "../types/models.js";
import { AuthMeResponse } from "../types/api.js";
import { resolveAllEffectivePermissions } from "../services/permissionResolver.js";
import { DEFAULT_SYSTEM_ROLES } from "../constants/catalogs.js";

export const authMe = onCall({ region: "asia-south1" }, async (request): Promise<AuthMeResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to access session details.");
  }

  const uid = request.auth.uid;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  // 1. Fetch User Profile
  const userDocRef = db.collection("users").doc(uid);
  const userSnapshot = await userDocRef.get();

  if (!userSnapshot.exists) {
    throw new HttpsError("not-found", "User profile not found. User must be provisioned first.");
  }

  const userData = userSnapshot.data() as UserDoc;
  if (!userData.isActive) {
    throw new HttpsError("permission-denied", "User account is inactive or suspended.");
  }

  // 2. Fetch User's Memberships
  const membershipsQuery = await db.collection("memberships").where("userId", "==", uid).get();
  const membershipItems: AuthMeResponse["memberships"] = [];
  let primaryMembership: MembershipDoc | null = null;
  let primaryMembershipBranchIds: string[] = [];
  let primaryMembershipDefaultBranch: string = "main-branch";

  for (const doc of membershipsQuery.docs) {
    const mem = doc.data() as MembershipDoc;
    if (mem.status === "active") {
      let orgName: string | undefined;
      const orgDoc = await db.collection("organizations").doc(mem.organizationId).get();
      const orgData = orgDoc.exists ? (orgDoc.data() as OrganizationDoc) : null;
      if (orgData) {
        orgName = orgData.name;
      }

      let roleName: string | undefined;
      const roleDoc = await db.collection("roles").doc(mem.roleId).get();
      if (roleDoc.exists) {
        roleName = (roleDoc.data() as RoleDoc).name;
      }

      // Fetch assigned branches from membershipBranches
      const mbQuery = await db.collection("membershipBranches")
        .where("membershipId", "==", doc.id)
        .where("status", "==", "active")
        .get();

      let assignedBranchIds: string[] = [];
      let primaryBranchId: string | undefined = mem.primaryBranchId;

      if (!mbQuery.empty) {
        assignedBranchIds = mbQuery.docs.map((d) => (d.data() as MembershipBranchDoc).branchId);
        const defaultMb = mbQuery.docs.find((d) => (d.data() as MembershipBranchDoc).isDefaultForMembership);
        if (defaultMb) {
          primaryBranchId = (defaultMb.data() as MembershipBranchDoc).branchId;
        } else if (!primaryBranchId && assignedBranchIds.length > 0) {
          primaryBranchId = assignedBranchIds[0];
        }
      } else {
        // Fallback for default main-branch
        const fallbackBranch = orgData?.defaultBranchId || "main-branch";
        assignedBranchIds = [fallbackBranch];
        primaryBranchId = fallbackBranch;
      }

      membershipItems.push({
        membershipId: doc.id,
        organizationId: mem.organizationId,
        organizationName: orgName,
        roleId: mem.roleId,
        roleName: roleName,
        status: mem.status,
        isPrimary: mem.isPrimary,
        primaryBranchId,
        assignedBranchIds,
      });

      if (mem.isPrimary || !primaryMembership) {
        primaryMembership = mem;
        primaryMembershipBranchIds = assignedBranchIds;
        primaryMembershipDefaultBranch = primaryBranchId || "main-branch";
      }
    }
  }

  let activeContext: AuthMeResponse["activeContext"] | undefined;

  // 3. Resolve active tenant context if user belongs to an organization
  if (primaryMembership) {
    const orgDoc = await db.collection("organizations").doc(primaryMembership.organizationId).get();
    const roleDoc = await db.collection("roles").doc(primaryMembership.roleId).get();

    if (orgDoc.exists && roleDoc.exists) {
      const orgData = orgDoc.data() as OrganizationDoc;
      const roleData = roleDoc.data() as RoleDoc;

      // Fetch plan to inspect moduleFlags
      let planFlags: Record<string, boolean> = {};
      const planDoc = await db.collection("subscriptionPlans").doc(orgData.planId).get();
      if (planDoc.exists) {
        planFlags = (planDoc.data() as SubscriptionPlanDoc).moduleFlags || {};
      }

      // Collect all known permission codes to resolve
      const catalogQuery = await db.collection("permissionCatalog").get();
      const catalogCodes = catalogQuery.docs.map((d) => d.id);
      if (catalogCodes.length === 0) {
        // Fallback to default system roles catalog
        for (const r of DEFAULT_SYSTEM_ROLES) {
          catalogCodes.push(...r.permissions);
        }
      }

      const effectivePermissions = resolveAllEffectivePermissions(Array.from(new Set(catalogCodes)), {
        isSuperAdmin,
        roleCode: roleData.code,
        rolePermissions: roleData.permissions || [],
        membershipOverrides: primaryMembership.permissions || {},
        planModuleFlags: planFlags,
        orgModuleToggles: orgData.moduleToggles || {},
      });

      // Fetch active branches in organization
      const branchesSnap = await db.collection("organizations")
        .doc(primaryMembership.organizationId)
        .collection("branches")
        .where("isActive", "==", true)
        .get();

      const isOrgOwner = roleData.code === "org_owner";
      const availableBranches: Array<{ branchId: string; name: string; code: string; isDefault: boolean }> = [];

      for (const bDoc of branchesSnap.docs) {
        const bData = bDoc.data() as BranchDoc;
        // Owners and superadmins see all active branches; staff sees assigned branches
        if (isOrgOwner || isSuperAdmin || primaryMembershipBranchIds.includes(bDoc.id)) {
          availableBranches.push({
            branchId: bDoc.id,
            name: bData.name,
            code: bData.code,
            isDefault: bData.isDefault || false,
          });
        }
      }

      activeContext = {
        organizationId: primaryMembership.organizationId,
        branchId: primaryMembershipDefaultBranch,
        primaryBranchId: primaryMembershipDefaultBranch,
        assignedBranchIds: primaryMembershipBranchIds,
        roleId: primaryMembership.roleId,
        roleCode: roleData.code,
        isOrgOwner,
        effectivePermissions,
        moduleToggles: orgData.moduleToggles || {},
        branches: availableBranches,
      };
    }
  }

  return {
    user: {
      uid,
      email: userData.email,
      name: userData.name,
      phone: userData.phone || undefined,
      accountType: userData.accountType,
      isActive: userData.isActive,
    },
    isSuperAdmin,
    memberships: membershipItems,
    activeContext,
  };
});
