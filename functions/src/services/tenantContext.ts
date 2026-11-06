/**
 * Tenant and Branch Context Derivation and Verification Service
 * 
 * Centralizes server-side derivation and validation of tenant organization
 * and branch boundaries for Cloud Functions callables:
 * - Derives organizationId from authenticated token claim or active Firestore membership
 * - Rejects forged client-supplied organizationId conflicting with active context
 * - Derives branchId from active context or validates branch assignment in membershipBranches
 * - Enforces Super Admin platform isolation (Super Admin has no tenant/branch context)
 */

import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { MembershipDoc, MembershipBranchDoc, OrganizationDoc } from "../types/models.js";

export { buildAuthSessionContext, BuildAuthSessionContextOptions } from "./sessionContext.js";

export interface ResolvedTenantContext {
  callerUid: string;
  isSuperAdmin: boolean;
  organizationId: string;
  branchId: string;
}

/**
 * Verifies tenant access and returns the authorized organizationId.
 * If the client omits organizationId, it is derived from token claims or active membership.
 * If the client supplies organizationId, it is validated against the caller's active context.
 */
export async function verifyTenantAccess(
  auth: { uid: string; token: Record<string, unknown> },
  clientOrgId?: string
): Promise<string> {
  const callerUid = auth.uid;
  const isSuperAdmin = auth.token.isSuperAdmin === true;

  if (isSuperAdmin) {
    if (clientOrgId && clientOrgId.trim()) {
      return clientOrgId.trim();
    }
    throw new HttpsError(
      "invalid-argument",
      "Super Admin platform operations require an explicit target organizationId."
    );
  }

  const tokenOrgId = typeof auth.token.primaryOrganizationId === "string"
    ? auth.token.primaryOrganizationId.trim()
    : undefined;

  const normalizedClientOrgId = clientOrgId ? clientOrgId.trim() : undefined;

  // Reject forged organizationId
  if (normalizedClientOrgId && tokenOrgId && normalizedClientOrgId !== tokenOrgId) {
    throw new HttpsError(
      "permission-denied",
      "Client-supplied organizationId does not match caller's active organization context."
    );
  }

  let resolvedOrgId = normalizedClientOrgId || tokenOrgId;

  if (!resolvedOrgId) {
    // Fallback to active membership in Firestore
    const memQuery = await db.collection("memberships")
      .where("userId", "==", callerUid)
      .where("status", "==", "active")
      .limit(2)
      .get();

    if (memQuery.empty) {
      throw new HttpsError("permission-denied", "No active organization membership found for caller.");
    }
    resolvedOrgId = (memQuery.docs[0].data() as MembershipDoc).organizationId;
  }

  // Live parallel check of User, Membership, and Organization records to guarantee immediate revocation
  const [userDoc, memDoc, orgDoc] = await Promise.all([
    db.collection("users").doc(callerUid).get(),
    db.collection("memberships").doc(`${callerUid}_${resolvedOrgId}`).get(),
    db.collection("organizations").doc(resolvedOrgId).get(),
  ]);

  if (!userDoc.exists || !userDoc.data()?.isActive) {
    throw new HttpsError("permission-denied", "User account is inactive or suspended.");
  }

  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }

  if (!orgDoc.exists || (orgDoc.data() as OrganizationDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Organization is inactive or locked.");
  }

  return resolvedOrgId;
}

/**
 * Resolves and validates operating branch context.
 * If client supplies branchId, validates that it exists in the organization
 * and that caller is actively assigned to it via membershipBranches (or has owner bypass).
 */
export async function resolveBranchContext(
  auth: { uid: string; token: Record<string, unknown> },
  organizationId: string,
  clientBranchId?: string
): Promise<string> {
  const callerUid = auth.uid;
  const isSuperAdmin = auth.token.isSuperAdmin === true;

  const tokenBranchId = typeof auth.token.primaryBranchId === "string"
    ? auth.token.primaryBranchId.trim()
    : undefined;

  let targetBranchId = (clientBranchId ? clientBranchId.trim() : undefined) || tokenBranchId;

  if (!targetBranchId) {
    // Lookup organization default branch
    const orgDoc = await db.collection("organizations").doc(organizationId).get();
    if (orgDoc.exists) {
      targetBranchId = (orgDoc.data() as OrganizationDoc).defaultBranchId;
    }
    if (!targetBranchId) {
      targetBranchId = "main-branch";
    }
  }

  if (isSuperAdmin) {
    return targetBranchId;
  }

  // Check if caller is org_owner (has organization-wide branch access)
  const memRef = db.collection("memberships").doc(`${callerUid}_${organizationId}`);
  const memDoc = await memRef.get();
  const memData = memDoc.exists ? (memDoc.data() as MembershipDoc) : null;
  const isOwner = memData?.roleId === "role_owner";

  if (!isOwner) {
    // Verify branch assignment via membershipBranches
    const mbId = `${callerUid}_${organizationId}_${targetBranchId}`;
    const mbDoc = await db.collection("membershipBranches").doc(mbId).get();
    if (!mbDoc.exists || (mbDoc.data() as MembershipBranchDoc).status !== "active") {
      throw new HttpsError(
        "permission-denied",
        `Caller is not assigned to branch "${targetBranchId}".`
      );
    }
  }

  // Verify branch exists and is active
  const branchDoc = await db.collection("organizations").doc(organizationId).collection("branches").doc(targetBranchId).get();
  if (branchDoc.exists && branchDoc.data()?.isActive === false) {
    throw new HttpsError("permission-denied", `Branch "${targetBranchId}" is inactive.`);
  }

  return targetBranchId;
}
