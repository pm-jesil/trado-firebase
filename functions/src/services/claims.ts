/**
 * Firebase Auth Custom Claims Service
 * 
 * Manages trusted server-side custom claims for RBAC and multi-tenancy.
 * - isSuperAdmin: boolean (platform bypass)
 * - primaryOrganizationId: string (active tenant context)
 */

import { auth } from "./firebase.js";

export interface TradoCustomClaims {
  isSuperAdmin?: boolean;
  primaryOrganizationId?: string;
  primaryBranchId?: string;
  [key: string]: unknown;
}

/**
 * Retrieves the current custom claims for a given user.
 */
export async function getUserCustomClaims(uid: string): Promise<TradoCustomClaims> {
  const user = await auth.getUser(uid);
  return (user.customClaims as TradoCustomClaims) || {};
}

/**
 * Updates or merges custom claims for a given user.
 */
export async function setCustomClaims(
  uid: string,
  claims: Partial<TradoCustomClaims>,
  merge: boolean = true
): Promise<void> {
  let finalClaims: TradoCustomClaims = claims;
  if (merge) {
    const existing = await getUserCustomClaims(uid);
    finalClaims = { ...existing, ...claims };
  }
  await auth.setCustomUserClaims(uid, finalClaims);
}

/**
 * Sets the primary organization ID claim for a user.
 */
export async function setPrimaryOrganizationClaim(uid: string, organizationId: string): Promise<void> {
  await setCustomClaims(uid, { primaryOrganizationId: organizationId }, true);
}

/**
 * Sets the primary branch ID claim for a user.
 */
export async function setPrimaryBranchClaim(uid: string, branchId: string): Promise<void> {
  await setCustomClaims(uid, { primaryBranchId: branchId }, true);
}


