/**
 * Shared Membership & User Provisioning Service (R1/R3 Single Writer)
 * 
 * Reused by:
 * - organizationsCreate (when createOwner: true)
 * - organizationsProvisionUser (Super Admin onboarding Owner or Admin)
 * - employeesCreate (Tenant-scoped employee onboarding)
 */

import crypto from "crypto";
import type { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { UserRecord } from "firebase-admin/auth";
import { db, auth } from "./firebase.js";
import { normalizeEmail, normalizeOptionalPhone } from "./contactNormalization.js";
import { compensateAuthUser } from "./compensation.js";
import { getUserCustomClaims, setPrimaryOrganizationClaim, setPrimaryBranchClaim } from "./claims.js";
import { gateError } from "./contextResolver.js";
import { EntityStatus, GateReason } from "../constants/enums.js";
import {
  UserDoc,
  MembershipDoc,
  OrganizationDoc,
  SubscriptionPlanDoc,
  MembershipBranchDoc,
  ImageRef,
} from "../types/models.js";
import { attachUploadedImage } from "./imageEngine.js";

export const OWNER_ROLE_ID = "role_org_owner";
export const ADMIN_ROLE_ID = "role_admin";

function seatCapacity(plan: SubscriptionPlanDoc): number {
  return (plan.seatLimits?.admin || 1) + (plan.seatLimits?.staff || 10);
}

async function readActiveEmployeeCount(txn: Transaction, orgId: string, org: OrganizationDoc): Promise<number> {
  if (typeof org.activeEmployeeCount === "number") return org.activeEmployeeCount;
  const snap = await txn.get(
    db.collection("memberships").where("organizationId", "==", orgId).where("status", "==", EntityStatus.ACTIVE)
  );
  return snap.docs.filter((d) => (d.data() as MembershipDoc).roleId !== OWNER_ROLE_ID).length;
}

export async function assertSeatAvailable(
  txn: Transaction,
  orgId: string
): Promise<{ orgRef: FirebaseFirestore.DocumentReference; next: number }> {
  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await txn.get(orgRef);
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", `Organization "${orgId}" not found.`);
  }
  const org = orgSnap.data() as OrganizationDoc;
  const current = await readActiveEmployeeCount(txn, orgId, org);

  if (org.planId) {
    const planSnap = await txn.get(db.collection("subscriptionPlans").doc(org.planId));
    if (planSnap.exists) {
      const plan = planSnap.data() as SubscriptionPlanDoc;
      const capacity = seatCapacity(plan);
      if (current >= capacity) {
        throw gateError(
          "resource-exhausted",
          GateReason.PLAN_LIMIT_REACHED,
          `Plan seat limit of ${capacity} employee(s) reached for this organization.`
        );
      }
    }
  }

  return { orgRef, next: current + 1 };
}

export interface ProvisionMembershipParams {
  organizationId: string;
  roleId: string;
  name: string;
  email: string;
  phone?: string | null;
  credentialMode?: "temporaryPassword" | "invite";
  initialPassword?: string;
  confirmLinkExistingUser?: boolean;
  departmentId?: string | null;
  jobRoleIds?: string[];
  teamId?: string | null;
  reportingToIds?: string[];
  permissionOverrides?: Record<string, boolean>;
  branchIds?: string[];
  defaultBranchId?: string;
  image?: ImageRef | null;
  uploadId?: string | null;
  actorUid: string;
}

export interface ProvisionMembershipResult {
  userId: string;
  membershipId: string;
  organizationId: string;
  roleId: string;
  userCreated: boolean;
  temporaryPassword?: string;
  inviteLink?: string;
  status: "active";
}

export async function provisionMembershipInternal(
  params: ProvisionMembershipParams
): Promise<ProvisionMembershipResult> {
  const normalizedEmail = normalizeEmail(params.email);
  const normalizedPhone = normalizeOptionalPhone(params.phone);

  const orgDocSnap = await db.collection("organizations").doc(params.organizationId).get();
  if (!orgDocSnap.exists) {
    throw new HttpsError("not-found", `Organization "${params.organizationId}" not found.`);
  }
  const orgData = orgDocSnap.data() as OrganizationDoc;

  // If role is Owner, verify no active owner exists
  if (params.roleId === OWNER_ROLE_ID) {
    const existingOwnerSnap = await db
      .collection("memberships")
      .where("organizationId", "==", params.organizationId)
      .where("roleId", "==", OWNER_ROLE_ID)
      .where("status", "==", EntityStatus.ACTIVE)
      .limit(1)
      .get();

    if (!existingOwnerSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "[ORGANIZATION_ALREADY_HAS_OWNER] Organization already has an active Owner. Use organizationsTransferOwnership to change owners.",
        { reason: "ORGANIZATION_ALREADY_HAS_OWNER" }
      );
    }
  }

  // Check Firebase Auth for existing user by email or phone
  let targetUid: string;
  let userCreated = false;
  let generatedPassword: string | undefined;

  let existingUser: UserRecord | null = null;
  try {
    existingUser = await auth.getUserByEmail(normalizedEmail);
  } catch {
    if (normalizedPhone) {
      try {
        existingUser = await auth.getUserByPhoneNumber(normalizedPhone);
      } catch (e) {}
    }
  }

  if (existingUser) {
    if (!params.confirmLinkExistingUser && params.roleId === OWNER_ROLE_ID) {
      throw new HttpsError(
        "already-exists",
        "[OWNER_EMAIL_EXISTS] An account with this email address or phone already exists. Pass confirmLinkExistingUser: true to link this existing user.",
        { reason: "OWNER_EMAIL_EXISTS" }
      );
    }
    targetUid = existingUser.uid;
  } else {
    // Create new Auth user
    try {
      generatedPassword = params.initialPassword || `${crypto.randomBytes(6).toString("base64")}Aa1!`;
      const newAuthUser = await auth.createUser({
        email: normalizedEmail,
        displayName: params.name,
        phoneNumber: normalizedPhone || undefined,
        password: generatedPassword,
      });
      targetUid = newAuthUser.uid;
      userCreated = true;
    } catch (err) {
      const createErr = err as { code?: string; errorInfo?: { code?: string } };
      if (createErr.code === "auth/phone-number-already-exists" || createErr.errorInfo?.code === "auth/phone-number-already-exists") {
        throw new HttpsError(
          "already-exists",
          "[PHONE_ALREADY_EXISTS] The provided phone number is already registered to another user account.",
          { reason: "PHONE_ALREADY_EXISTS" }
        );
      }
      if (createErr.code === "auth/email-already-exists" || createErr.errorInfo?.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "[EMAIL_ALREADY_EXISTS] An account with this email address already exists.",
          { reason: "EMAIL_ALREADY_EXISTS" }
        );
      }
      throw createErr;
    }
  }

  const membershipId = `${targetUid}_${params.organizationId}`;
  const membershipRef = db.collection("memberships").doc(membershipId);
  const userRef = db.collection("users").doc(targetUid);
  const now = new Date().toISOString();

  let imageRef = params.image || null;
  if (params.uploadId) {
    imageRef = await attachUploadedImage({
      uploadId: params.uploadId,
      purpose: "user_photo",
      entityType: "user",
      entityId: targetUid,
      callerUid: params.actorUid,
      scope: params.organizationId,
    });
  }

  const assignedBranchIds = params.branchIds && params.branchIds.length > 0
    ? Array.from(new Set(params.branchIds))
    : [orgData.defaultBranchId || "main-branch"];
  const defaultBranch = params.defaultBranchId || assignedBranchIds[0];

  try {
    await db.runTransaction(async (txn) => {
      // 1. Check existing membership
      const existingMem = await txn.get(membershipRef);
      if (existingMem.exists && (existingMem.data() as MembershipDoc).status === EntityStatus.ACTIVE) {
        throw new HttpsError("already-exists", "User is already an active member of this organization.");
      }

      // 2. Seat limit check (Owners do not consume employee seats)
      let seat: { orgRef: FirebaseFirestore.DocumentReference; next: number } | null = null;
      if (params.roleId !== OWNER_ROLE_ID) {
        seat = await assertSeatAvailable(txn, params.organizationId);
      }

      // 3. User document
      const userSnap = await txn.get(userRef);
      if (!userSnap.exists) {
        const userDoc: UserDoc = {
          name: params.name,
          email: normalizedEmail,
          phone: normalizedPhone || null,
          accountType: params.roleId === OWNER_ROLE_ID || params.roleId === ADMIN_ROLE_ID ? "admin" : "standard",
          mustChangePassword: userCreated,
          /** D-15: ONE stored image field; no url, no photoUrl, no avatarUrl. */
          image: imageRef || undefined,
          isActive: true,
          createdAt: now,
          createdBy: params.actorUid,
        };
        txn.set(userRef, userDoc);
      } else {
        txn.update(userRef, {
          isActive: true,
          updatedAt: now,
          updatedBy: params.actorUid,
          /** D-15: only the typed ImageRef; no url, no photoUrl, no avatarUrl. */
          ...(imageRef ? { image: imageRef } : {}),
        });
      }

      // 4. Membership document
      const membershipDoc: MembershipDoc = {
        userId: targetUid,
        organizationId: params.organizationId,
        roleId: params.roleId,
        departmentId: params.departmentId || null,
        jobRoleIds: params.jobRoleIds || [],
        teamId: params.teamId || null,
        reportingToIds: params.reportingToIds || [],
        permissions: params.permissionOverrides || {},
        status: EntityStatus.ACTIVE,
        isPrimary: params.roleId === OWNER_ROLE_ID,
        primaryBranchId: defaultBranch,
        createdAt: now,
        createdBy: params.actorUid,
        updatedAt: now,
        updatedBy: params.actorUid,
      };
      txn.set(membershipRef, membershipDoc);

      // 5. Branch assignments
      for (const bId of assignedBranchIds) {
        const mbDoc: MembershipBranchDoc = {
          organizationId: params.organizationId,
          branchId: bId,
          membershipId,
          userId: targetUid,
          status: EntityStatus.ACTIVE,
          isDefaultForMembership: bId === defaultBranch,
          permissions: {},
          createdAt: now,
          createdBy: params.actorUid,
          updatedAt: now,
        };
        txn.set(db.collection("membershipBranches").doc(`${membershipId}_${bId}`), mbDoc);
      }

      // 6. Update seat count or organization ownerStatus
      const orgRef = db.collection("organizations").doc(params.organizationId);
      if (params.roleId === OWNER_ROLE_ID) {
        txn.update(orgRef, { ownerStatus: "active", updatedAt: now });
      } else if (seat) {
        txn.update(seat.orgRef, { activeEmployeeCount: seat.next, updatedAt: now });
      }
    });

    // 7. Update custom claims
    const existingClaims = await getUserCustomClaims(targetUid);
    if (!existingClaims.primaryOrganizationId || params.roleId === OWNER_ROLE_ID) {
      await setPrimaryOrganizationClaim(targetUid, params.organizationId);
      await setPrimaryBranchClaim(targetUid, defaultBranch);
    }
  } catch (err) {
    if (userCreated) {
      await compensateAuthUser(targetUid, (err instanceof Error && err.message) || "Downstream provisioning failed");
    }
    throw err;
  }

  return {
    userId: targetUid,
    membershipId,
    organizationId: params.organizationId,
    roleId: params.roleId,
    userCreated,
    temporaryPassword: userCreated ? generatedPassword : undefined,
    inviteLink: params.credentialMode === "invite" ? `https://trado.local/auth/invite?userId=${targetUid}&org=${params.organizationId}` : undefined,
    status: "active",
  };
}
