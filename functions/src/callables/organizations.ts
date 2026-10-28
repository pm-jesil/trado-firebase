/**
 * Organization Callables
 * - organizationsCreate: Super Admin only; provisions org + owner with compensating rollback.
 * - organizationsUpdate: Tenant admin/owner or Super Admin.
 * - organizationsDeactivate: Soft status change.
 * - organizationsList: Super Admin only, paginated.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth } from "../services/firebase.js";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  DeactivateOrganizationSchema,
  ListOrganizationsSchema,
} from "../validation/schemas.js";
import {
  CreateOrganizationResponse,
} from "../types/api.js";
import {
  OrganizationDoc,
  UserDoc,
  MembershipDoc,
  BranchDoc,
  BranchCodeLockDoc,
  MembershipBranchDoc,
  OrganizationSharingPolicies,
} from "../types/models.js";
import { EntityStatus, IdempotencyStatus } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { compensateAuthUser } from "../services/compensation.js";
import { setPrimaryOrganizationClaim, setPrimaryBranchClaim } from "../services/claims.js";
import { createAuditLog } from "../services/audit.js";
import { queueWelcomeNotification } from "../services/notificationSender.js";

export const organizationsCreate = onCall({ region: "asia-south1" }, async (request): Promise<CreateOrganizationResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  if (request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to provision organizations.");
  }

  // 1. Validate Input
  const parsed = CreateOrganizationSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  // 2. Idempotency Check & Reservation (with lease expiry & side-effect recovery)
  const idempotency = await reserveIdempotency({
    scope: "platform",
    actorUid: request.auth.uid,
    operation: "organizations.create",
    clientKey: input.idempotencyKey,
    payload: input as unknown as Record<string, unknown>,
    recoveryChecker: async () => {
      try {
        const existingOwnerAuth = await auth.getUserByEmail(input.ownerEmail);
        const mems = await db.collection("memberships")
          .where("userId", "==", existingOwnerAuth.uid)
          .where("roleId", "==", "role_org_owner")
          .limit(1)
          .get();
        if (!mems.empty) {
          const mem = mems.docs[0];
          const memData = mem.data() as MembershipDoc;
          return {
            organizationId: memData.organizationId,
            ownerUserId: existingOwnerAuth.uid,
            ownerMembershipId: mem.id,
            status: "active",
            message: "Organization and owner provisioned successfully.",
          };
        }
      } catch {
        // Owner not yet created
      }
      return null;
    },
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation is currently being processed. Please retry shortly.");
    }
    return idempotency.cachedResult as unknown as CreateOrganizationResponse;
  }

  let createdAuthUid: string | null = null;

  try {
    // 3. Verify Plan exists
    const planDoc = await db.collection("subscriptionPlans").doc(input.planId).get();
    if (!planDoc.exists) {
      throw new HttpsError("not-found", `Subscription plan "${input.planId}" does not exist.`);
    }

    // 4. Create Firebase Auth user for Organization Owner
    const password = input.initialPassword || Math.random().toString(36).slice(-10) + "Aa1!";
    const authUser = await auth.createUser({
      email: input.ownerEmail,
      displayName: input.ownerName,
      phoneNumber: input.ownerPhone || undefined,
      password,
    });
    createdAuthUid = authUser.uid;

    // 5. Coordinated Firestore Creation
    const orgRef = db.collection("organizations").doc();
    const orgId = orgRef.id;

    // Set custom claims primaryOrganizationId and primaryBranchId on newly created Owner
    await setPrimaryOrganizationClaim(createdAuthUid, orgId);
    await setPrimaryBranchClaim(createdAuthUid, "main-branch");

    const userRef = db.collection("users").doc(createdAuthUid);
    const membershipId = `${createdAuthUid}_${orgId}`;
    const membershipRef = db.collection("memberships").doc(membershipId);

    const now = new Date().toISOString();
    const branchCode = (input.defaultBranchCode || "MAIN").toUpperCase().trim();

    const defaultSharingPolicies: OrganizationSharingPolicies = {
      products: "organization_shared",
      categories: "organization_shared",
      customers: "organization_shared",
      vendors: "organization_shared",
      sales: "branch_scoped",
      purchases: "organization_shared",
      expenses: "organization_shared",
      stock: "branch_scoped",
      deliveries: "organization_shared",
    };

    const orgDocData: OrganizationDoc = {
      name: input.name,
      businessType: input.businessType,
      businessCategory: input.businessCategory,
      country: input.country,
      currency: input.currency,
      taxRegimeCode: input.taxRegimeCode,
      status: EntityStatus.ACTIVE,
      planId: input.planId,
      moduleToggles: {},
      defaultBranchId: "main-branch",
      branchCount: 1,
      sharingPolicies: defaultSharingPolicies,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    const userDocData: UserDoc = {
      name: input.ownerName,
      email: input.ownerEmail,
      phone: input.ownerPhone || null,
      accountType: "admin",
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    const membershipDocData: MembershipDoc = {
      userId: createdAuthUid,
      organizationId: orgId,
      roleId: "role_org_owner",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: "main-branch",
      assignedBranchIds: ["main-branch"],
      createdAt: now,
      createdBy: request.auth.uid,
    };

    // Branch-readiness: Provision default branch 'main-branch' under organizations/{orgId}/branches
    const branchRef = orgRef.collection("branches").doc("main-branch");
    const defaultBranchDoc: BranchDoc = {
      organizationId: orgId,
      name: input.defaultBranchName?.trim() || "Main Branch",
      code: branchCode,
      isDefault: true,
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
      updatedAt: now,
    };

    // Code lock for default branch
    const lockRef = db.collection("branchCodeLocks").doc(`${orgId}_${branchCode}`);
    const lockDoc: BranchCodeLockDoc = {
      organizationId: orgId,
      branchCode,
      branchId: "main-branch",
      createdAt: now,
    };

    // Join record mapping Owner membership to main-branch
    const membershipBranchRef = db.collection("membershipBranches").doc(`${membershipId}_main-branch`);
    const membershipBranchDoc: MembershipBranchDoc = {
      organizationId: orgId,
      branchId: "main-branch",
      membershipId,
      userId: createdAuthUid,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: request.auth.uid,
      updatedAt: now,
    };

    const response: CreateOrganizationResponse = {
      organizationId: orgId,
      ownerUserId: createdAuthUid,
      ownerMembershipId: membershipId,
      status: "active",
      message: "Organization and owner provisioned successfully.",
    };

    // Coordinated atomic batch: Org + User + Membership + Branch + CodeLock + MembershipBranch + Audit + Idempotency
    const batch = db.batch();
    batch.set(orgRef, orgDocData);
    batch.set(userRef, userDocData);
    batch.set(membershipRef, membershipDocData);
    batch.set(branchRef, defaultBranchDoc);
    batch.set(lockRef, lockDoc);
    batch.set(membershipBranchRef, membershipBranchDoc);

    const auditRef = db.collection("auditLogs").doc();
    batch.set(auditRef, {
      organizationId: orgId,
      actorUid: request.auth.uid,
      action: "ORGANIZATION_CREATED",
      entityType: "organization",
      entityId: orgId,
      details: {
        name: input.name,
        planId: input.planId,
        ownerEmail: input.ownerEmail,
      },
      createdAt: now,
    });

    if (idempotency.recordId) {
      const idempotencyRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      batch.update(idempotencyRef, {
        status: IdempotencyStatus.SUCCEEDED,
        result: response as unknown as Record<string, unknown>,
        updatedAt: now,
      });
    }

    await batch.commit();

    // 6. Queue Welcome Notification
    await queueWelcomeNotification(createdAuthUid, input.ownerName, input.name);

    return response;
  } catch (error) {
    // 9. Compensating Rollback of Auth User on Firestore Failure
    if (createdAuthUid) {
      const rollback = await compensateAuthUser(createdAuthUid, (error as Error).message);
      if (!rollback.success) {
        console.error(`[CRITICAL] Rollback incomplete for auth user ${createdAuthUid}:`, rollback.error);
      }
    }

    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "PROVISIONING_FAILED", (error as Error).message);
    }

    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to provision organization: ${(error as Error).message}`);
  }
});

export const organizationsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateOrganizationSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  let isOrgOwner = false;

  // Authorization: Caller must be Super Admin or member of target org
  if (!isSuperAdmin) {
    const memDoc = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
    if (!memDoc.exists) {
      throw new HttpsError("permission-denied", "Not a member of this organization.");
    }
    const memData = memDoc.data() as MembershipDoc;
    if (memData.status !== "active") {
      throw new HttpsError("permission-denied", "Membership is inactive.");
    }
    if (memData.roleId === "role_org_owner") {
      isOrgOwner = true;
    } else if (memData.roleId === "role_admin") {
      isOrgOwner = false;
    } else {
      throw new HttpsError("permission-denied", "Insufficient permissions to update organization.");
    }
  }

  // Restrict structural settings changes to Org Owner and Super Admin
  if (!isSuperAdmin && !isOrgOwner) {
    if (input.businessType !== undefined || input.businessCategory !== undefined || input.moduleToggles !== undefined) {
      throw new HttpsError("permission-denied", "Only Organization Owner or Super Admin can modify structural settings (business type, category, or module toggles).");
    }
  }

  const orgRef = db.collection("organizations").doc(input.organizationId);
  const orgDoc = await orgRef.get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }

  const updates: Partial<OrganizationDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;
  if (input.businessType) updates.businessType = input.businessType;
  if (input.businessCategory) updates.businessCategory = input.businessCategory;
  if (input.moduleToggles) updates.moduleToggles = input.moduleToggles;
  if (input.logoUrl) updates.logoUrl = input.logoUrl;

  await orgRef.update(updates);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "ORGANIZATION_UPDATED",
    entityType: "organization",
    entityId: input.organizationId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Organization updated successfully." };
});

export const organizationsDeactivate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = DeactivateOrganizationSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const memDoc = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
    if (!memDoc.exists || (memDoc.data() as MembershipDoc).roleId !== "role_org_owner") {
      throw new HttpsError("permission-denied", "Only Organization Owner or Super Admin can deactivate an organization.");
    }
  }

  const orgRef = db.collection("organizations").doc(input.organizationId);
  await orgRef.update({
    status: EntityStatus.INACTIVE,
    updatedAt: new Date().toISOString(),
  });

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "ORGANIZATION_DEACTIVATED",
    entityType: "organization",
    entityId: input.organizationId,
    details: { reason: input.reason },
  });

  return { success: true, message: "Organization deactivated successfully." };
});

export const organizationsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to list all organizations.");
  }

  const parsed = ListOrganizationsSchema.safeParse(request.data);
  const input = parsed.success ? parsed.data : { limit: 20 };

  let query = db.collection("organizations").orderBy("name").limit(input.limit || 20);

  if (input.status) {
    query = query.where("status", "==", input.status);
  }

  if (input.startAfterId) {
    const startDoc = await db.collection("organizations").doc(input.startAfterId).get();
    if (startDoc.exists) {
      query = query.startAfter(startDoc);
    }
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    organizationId: doc.id,
    ...(doc.data() as OrganizationDoc),
  }));

  return {
    items,
    count: items.length,
    hasMore: items.length === (input.limit || 20),
  };
});
