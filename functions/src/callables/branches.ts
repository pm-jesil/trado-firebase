/**
 * Branch Management Callables
 * - branchesGetDefault: Fetches default branch configuration.
 * - branchesList: Lists accessible branches in organization.
 * - branchesCreate: Concurrency-locked, permission-guarded branch creation.
 * - branchesUpdate: Updates branch profile and settings.
 * - branchesDeactivate: Soft-deactivates branch with default branch protection.
 * - branchContextSwitch: Validates assignment and updates caller's primaryBranchId custom claim.
 * - sharingPoliciesUpdate: Tenant-level data sharing policy configuration.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { uniqueKeyRef } from "../services/uniqueKeys.js";
import {
  CreateBranchSchema,
  UpdateBranchSchema,
  DeactivateBranchSchema,
  ListBranchesSchema,
  SwitchBranchContextSchema,
  UpdateSharingPoliciesSchema,
  ContextOnlySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  BranchDoc,
  MembershipBranchDoc,
  OrganizationDoc,
  OrganizationSharingPolicies,
  SubscriptionPlanDoc,
} from "../types/models.js";
import { EntityStatus } from "../constants/enums.js";
import { AppPermissions } from "../constants/permissions.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { setPrimaryBranchClaim } from "../services/claims.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";

/**
 * 1. branchesGetDefault
 * Returns the default branch for the caller's active organization.
 */
export const branchesGetDefault = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(ContextOnlySchema, request.data);
  const context = await resolveRequestContext(request);
  const defaultBranchId = context.organization.defaultBranchId || "main-branch";

  const branchRef = db
    .collection("organizations")
    .doc(context.organizationId)
    .collection("branches")
    .doc(defaultBranchId);

  const branchSnap = await branchRef.get();
  if (!branchSnap.exists) {
    throw new HttpsError("not-found", `Default branch "${defaultBranchId}" not found.`);
  }

  return {
    branchId: defaultBranchId,
    branch: branchSnap.data() as BranchDoc,
  };
});

/**
 * 2. branchesList
 * Lists branches accessible to the caller.
 */
export const branchesList = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(ListBranchesSchema, request.data || {});

  const context = await resolveRequestContext(request);
  const orgId = context.organizationId;
  const isOwnerOrAdmin = context.isSuperAdmin || context.role?.code === "org_owner" || context.role?.code === "admin";

  const branchesCol = db.collection("organizations").doc(orgId).collection("branches");
  let query: FirebaseFirestore.Query = branchesCol;

  if (input.status) {
    query = query.where("isActive", "==", input.status === EntityStatus.ACTIVE);
  }

  const { snapshot, nextCursor } = await fetchPage(query.orderBy("name"), `organizations/${orgId}/branches`, input.startAfterId, input.limit || 50);
  let branchDocs = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as BranchDoc),
  }));

  // Filter for regular staff: only branches with active membershipBranches assignment
  if (!isOwnerOrAdmin && context.membership) {
    const membershipId = `${context.callerUid}_${orgId}`;
    const userBranchesSnap = await db
      .collection("membershipBranches")
      .where("membershipId", "==", membershipId)
      .where("status", "==", "active")
      .get();

    const allowedBranchIds = new Set(userBranchesSnap.docs.map((d) => (d.data() as MembershipBranchDoc).branchId));
    branchDocs = branchDocs.filter((b) => allowedBranchIds.has(b.id));
  }

  return {
    items: branchDocs,
    count: branchDocs.length,
    nextCursor,
  };
});

/**
 * 3. branchesCreate
 * Creates a new branch under the organization.
 * Enforces:
 * - branch:create permission
 * - Plan branchLimit check
 * - Atomic uppercase branch code uniqueness (uniqueKeys kind branch_code)
 */
export const branchesCreate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(CreateBranchSchema, request.data);

  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.BRANCH_CREATE,
  });

  const orgId = context.organizationId;
  const codeUpper = input.code.trim().toUpperCase();

  // Idempotency check
  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: context.callerUid,
    operation: "branches.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Branch creation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const branchRef = db.collection("organizations").doc(orgId).collection("branches").doc();
    const branchId = branchRef.id;
    const lockRef = uniqueKeyRef(orgId, "branch_code", codeUpper);
    const orgRef = db.collection("organizations").doc(orgId);
    const now = new Date().toISOString();

    const branchDoc: BranchDoc = {
      organizationId: orgId,
      name: input.name.trim(),
      code: codeUpper,
      isDefault: false,
      isActive: true,
      address: input.address,
      contact: input.contact,
      settings: input.settings,
      createdAt: now,
      createdBy: context.callerUid,
      updatedAt: now,
    };

    const lockDoc = { organizationId: orgId, kind: "branch_code", entityType: "branch", entityId: branchId, createdAt: now };

    // Transactional write: enforce plan branchLimit and unique code lock
    await db.runTransaction(async (txn) => {
      const liveOrgSnap = await txn.get(orgRef);
      if (!liveOrgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      const liveOrg = liveOrgSnap.data() as OrganizationDoc;
      if (liveOrg.status !== EntityStatus.ACTIVE) {
        throw new HttpsError("failed-precondition", "Organization is not active.");
      }

      // Authoritative plan resolution inside transaction
      if (!liveOrg.planId) {
        throw new HttpsError("failed-precondition", "Organization has no assigned subscription plan.");
      }
      const planRef = db.collection("subscriptionPlans").doc(liveOrg.planId);
      const planSnap = await txn.get(planRef);
      if (!planSnap.exists) {
        throw new HttpsError("failed-precondition", `Assigned subscription plan "${liveOrg.planId}" not found.`);
      }
      const planDoc = planSnap.data() as SubscriptionPlanDoc;
      if (planDoc.isActive === false) {
        throw new HttpsError("failed-precondition", `Subscription plan "${planDoc.name || liveOrg.planId}" is inactive.`);
      }

      const branchLimit = typeof planDoc.branchLimit === "number" && planDoc.branchLimit >= 0 ? planDoc.branchLimit : 1;
      const currentBranchCount = typeof liveOrg.branchCount === "number" ? liveOrg.branchCount : 1;

      if (!context.isSuperAdmin && currentBranchCount >= branchLimit) {
        throw new HttpsError(
          "failed-precondition",
          `Branch limit reached. Your subscription plan allows up to ${branchLimit} active branch(es).`
        );
      }

      const lockSnap = await txn.get(lockRef);
      if (lockSnap.exists) {
        throw new HttpsError(
          "already-exists",
          `Branch code "${codeUpper}" already exists in this organization.`
        );
      }

      // 1. Write Code Lock
      txn.set(lockRef, lockDoc);

      // 2. Write Branch Document
      txn.set(branchRef, branchDoc);

      // 3. Update Organization branchCount
      txn.update(orgRef, {
        branchCount: currentBranchCount + 1,
        updatedAt: now,
      });

      // 4. Assign creator to branch in membershipBranches
      if (context.membership) {
        const membershipId = `${context.callerUid}_${orgId}`;
        const membershipBranchRef = db.collection("membershipBranches").doc(`${membershipId}_${branchId}`);
        const membershipBranchDoc: MembershipBranchDoc = {
          organizationId: orgId,
          branchId,
          membershipId,
          userId: context.callerUid,
          status: EntityStatus.ACTIVE,
          isDefaultForMembership: false,
          permissions: {},
          createdAt: now,
          createdBy: context.callerUid,
          updatedAt: now,
        };
        txn.set(membershipBranchRef, membershipBranchDoc);
      }
    });


    const response = {
      success: true,
      branchId,
      branch: branchDoc,
    };

    await finalizeIdempotencySuccess(idempotency.recordId, response);
    return response;
  } catch (err) {
    // A failed attempt releases the key, so the client may retry (otherwise the lease blocks it).
    await finalizeIdempotencyFailure(idempotency.recordId, "BRANCH_CREATE_FAILED", err instanceof Error ? err.message : String(err));
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", (err instanceof Error ? err.message : undefined) || "Failed to create branch.");
  }
});

/**
 * 4. branchesUpdate
 * Updates branch information (name, address, contact, settings).
 * Cannot alter branch code or deactivate default branch.
 */
export const branchesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(UpdateBranchSchema, request.data);

  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.BRANCH_UPDATE,
    allowInactiveBranch: true,
  });

  const orgId = context.organizationId;
  const branchRef = db.collection("organizations").doc(orgId).collection("branches").doc(input.branchId);
  const branchSnap = await branchRef.get();

  if (!branchSnap.exists) {
    throw new HttpsError("not-found", `Branch "${input.branchId}" not found.`);
  }

  const updates: Partial<BranchDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.address !== undefined) updates.address = input.address;
  if (input.contact !== undefined) updates.contact = input.contact;
  if (input.settings !== undefined) updates.settings = input.settings;

  const now = new Date().toISOString();
  const orgRef = db.collection("organizations").doc(orgId);

  // Handle active/inactive status transitions transactionally
  if (input.isActive === true) {
    await db.runTransaction(async (txn) => {
      const liveOrgSnap = await txn.get(orgRef);
      if (!liveOrgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
      const liveOrg = liveOrgSnap.data() as OrganizationDoc;

      const liveBranchSnap = await txn.get(branchRef);
      if (!liveBranchSnap.exists) throw new HttpsError("not-found", `Branch "${input.branchId}" not found.`);
      const liveBranch = liveBranchSnap.data() as BranchDoc;

      if (liveBranch.isActive) {
        return; // Already active
      }

      if (!liveOrg.planId) {
        throw new HttpsError("failed-precondition", "Organization has no assigned subscription plan.");
      }
      const planRef = db.collection("subscriptionPlans").doc(liveOrg.planId);
      const planSnap = await txn.get(planRef);
      if (!planSnap.exists) {
        throw new HttpsError("failed-precondition", "Assigned subscription plan not found.");
      }
      const planDoc = planSnap.data() as SubscriptionPlanDoc;
      if (planDoc.isActive === false) {
        throw new HttpsError("failed-precondition", "Assigned subscription plan is inactive.");
      }

      const branchLimit = typeof planDoc.branchLimit === "number" && planDoc.branchLimit >= 0 ? planDoc.branchLimit : 1;
      const currentBranchCount = typeof liveOrg.branchCount === "number" ? liveOrg.branchCount : 1;

      if (!context.isSuperAdmin && currentBranchCount >= branchLimit) {
        throw new HttpsError(
          "failed-precondition",
          `Branch limit reached. Your subscription plan allows up to ${branchLimit} active branch(es). Upgrade plan to reactivate this branch.`
        );
      }

      txn.update(orgRef, {
        branchCount: currentBranchCount + 1,
        updatedAt: now,
      });

      txn.update(branchRef, {
        isActive: true,
        updatedAt: now,
      });
    });

    // Reactivate caller's membershipBranch link if present
    const callerMbRef = db.collection("membershipBranches").doc(`${context.callerUid}_${orgId}_${input.branchId}`);
    const callerMbSnap = await callerMbRef.get();
    if (callerMbSnap.exists) {
      await callerMbRef.update({ status: EntityStatus.ACTIVE, updatedAt: now });
    }
  } else if (input.isActive === false) {
    const defaultBranchId = context.organization.defaultBranchId || "main-branch";
    if (input.branchId === defaultBranchId || input.branchId === "main-branch") {
      throw new HttpsError("failed-precondition", "Cannot deactivate the default branch.");
    }

    await db.runTransaction(async (txn) => {
      const liveOrgSnap = await txn.get(orgRef);
      if (!liveOrgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
      const liveBranchSnap = await txn.get(branchRef);
      if (!liveBranchSnap.exists) throw new HttpsError("not-found", `Branch "${input.branchId}" not found.`);
      const liveBranch = liveBranchSnap.data() as BranchDoc;
      if (!liveBranch.isActive) return;

      const liveOrg = liveOrgSnap.data() as OrganizationDoc;
      const currentBranchCount = typeof liveOrg.branchCount === "number" ? liveOrg.branchCount : 1;
      const newCount = Math.max(1, currentBranchCount - 1);

      txn.update(orgRef, {
        branchCount: newCount,
        updatedAt: now,
      });
      txn.update(branchRef, {
        isActive: false,
        updatedAt: now,
      });
    });
  }

  if (Object.keys(updates).length > 1) {
    await branchRef.update(updates);
  }


  return {
    success: true,
    branchId: input.branchId,
  };
});

/**
 * 5. branchesDeactivate
 * Soft-deactivates a branch.
 * Prohibits deactivating default branch or the last active branch.
 */
export const branchesDeactivate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(DeactivateBranchSchema, request.data);

  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.BRANCH_DEACTIVATE,
    allowInactiveBranch: true,
  });

  const orgId = context.organizationId;
  const defaultBranchId = context.organization.defaultBranchId || "main-branch";

  if (input.branchId === defaultBranchId || input.branchId === "main-branch") {
    throw new HttpsError("failed-precondition", "Cannot deactivate the default branch.");
  }

  const branchRef = db.collection("organizations").doc(orgId).collection("branches").doc(input.branchId);
  const branchSnap = await branchRef.get();

  if (!branchSnap.exists) {
    throw new HttpsError("not-found", `Branch "${input.branchId}" not found.`);
  }

  const now = new Date().toISOString();
  const orgRef = db.collection("organizations").doc(orgId);

  // Transactionally update branchCount and branch status
  await db.runTransaction(async (txn) => {
    const liveOrgSnap = await txn.get(orgRef);
    if (!liveOrgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
    const liveBranchSnap = await txn.get(branchRef);
    if (!liveBranchSnap.exists) throw new HttpsError("not-found", `Branch "${input.branchId}" not found.`);

    const liveBranch = liveBranchSnap.data() as BranchDoc;
    if (!liveBranch.isActive) return; // Already inactive

    const liveOrg = liveOrgSnap.data() as OrganizationDoc;
    const currentBranchCount = typeof liveOrg.branchCount === "number" ? liveOrg.branchCount : 1;
    const newCount = Math.max(1, currentBranchCount - 1);

    txn.update(orgRef, {
      branchCount: newCount,
      updatedAt: now,
    });
    txn.update(branchRef, {
      isActive: false,
      updatedAt: now,
    });
  });

  // Safely reassign any active memberships with this branch as primaryBranchId back to defaultBranchId
  const memsToReassign = await db.collection("memberships")
    .where("organizationId", "==", orgId)
    .where("primaryBranchId", "==", input.branchId)
    .get();
  for (const mDoc of memsToReassign.docs) {
    await mDoc.ref.update({ primaryBranchId: defaultBranchId, updatedAt: now });
  }

  // Deactivate membershipBranches join records for this branch
  const mbToDeactivate = await db.collection("membershipBranches")
    .where("organizationId", "==", orgId)
    .where("branchId", "==", input.branchId)
    .get();
  for (const mbDoc of mbToDeactivate.docs) {
    await mbDoc.ref.update({ status: EntityStatus.INACTIVE, updatedAt: now });
  }


  return {
    success: true,
    branchId: input.branchId,
  };
});

/**
 * 6. branchContextSwitch
 * Validates caller's assignment and updates their primaryBranchId claim.
 */
export const branchContextSwitch = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(SwitchBranchContextSchema, request.data);

  const context = await resolveRequestContext(request);
  const orgId = context.organizationId;
  const targetBranchId = input.targetBranchId;

  // Validate target branch exists and is active
  const targetBranchRef = db.collection("organizations").doc(orgId).collection("branches").doc(targetBranchId);
  const targetBranchSnap = await targetBranchRef.get();

  if (!targetBranchSnap.exists) {
    throw new HttpsError("not-found", `Target branch "${targetBranchId}" does not exist in this organization.`);
  }

  const targetBranchData = targetBranchSnap.data() as BranchDoc;
  if (!targetBranchData.isActive) {
    throw new HttpsError("failed-precondition", `Target branch "${targetBranchId}" is inactive.`);
  }

  // Validate assignment unless superadmin or org_owner
  const isOwner = context.isSuperAdmin || context.role?.code === "org_owner";
  if (!isOwner) {
    const membershipId = `${context.callerUid}_${orgId}`;
    const mbRef = db.collection("membershipBranches").doc(`${membershipId}_${targetBranchId}`);
    const mbSnap = await mbRef.get();

    if (!mbSnap.exists || (mbSnap.data() as MembershipBranchDoc).status !== "active") {
      throw new HttpsError("permission-denied", `Caller is not actively assigned to branch "${targetBranchId}".`);
    }
  }

  // Update server-side custom claim and membership primaryBranchId
  await setPrimaryBranchClaim(context.callerUid, targetBranchId);
  const memRef = db.collection("memberships").doc(`${context.callerUid}_${orgId}`);
  await memRef.update({ primaryBranchId: targetBranchId, updatedAt: new Date().toISOString() });


  return {
    success: true,
    primaryBranchId: targetBranchId,
  };
});

/**
 * 7. sharingPoliciesUpdate
 * Updates organization data sharing policies.
 * Strictly guarantees stock remains branch_scoped.
 */
export const sharingPoliciesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(UpdateSharingPoliciesSchema, request.data);

  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.ORG_SETTINGS,
  });

  const orgId = context.organizationId;
  const orgRef = db.collection("organizations").doc(orgId);

  const currentPolicies = context.organization.sharingPolicies || {
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

  const updatedPolicies: OrganizationSharingPolicies = {
    ...currentPolicies,
    ...input.policies,
    stock: "branch_scoped", // Strictly enforced: stock is ALWAYS branch_scoped
  };

  await orgRef.update({
    sharingPolicies: updatedPolicies,
    updatedAt: new Date().toISOString(),
  });


  return {
    success: true,
    sharingPolicies: updatedPolicies,
  };
});
