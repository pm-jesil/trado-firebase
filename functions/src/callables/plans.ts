/**
 * Subscription Plan Callables
 * - plansCreate: Super Admin only
 * - plansUpdate: Super Admin only
 * - plansList: Authenticated callers
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreatePlanSchema,
  UpdatePlanSchema,
  ListPlansSchema,
  PreviewPlanImpactSchema,
  GetPlanSchema,
  ArchivePlanSchema,
  DeletePlanSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { SubscriptionPlanDoc, OrganizationDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";

export const plansCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to create subscription plans.");
  }

  const input = parseInput(CreatePlanSchema, request.data);

  const idempotency = await reserveIdempotency({
    scope: "platform",
    actorUid: request.auth.uid,
    operation: "plans.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const planRef = db.collection("subscriptionPlans").doc();
    const planDoc: SubscriptionPlanDoc = {
      name: input.name,
      price: input.price,
      currency: input.currency,
      storageLimitMb: input.storageLimitMb,
      monthlyDocumentVolumeLimit: input.monthlyDocumentVolumeLimit,
      seatLimits: input.seatLimits,
      branchLimit: input.branchLimit ?? 1,
      moduleFlags: input.moduleFlags,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      createdBy: request.auth.uid,
    };

    await planRef.set(planDoc);


    const result = { planId: planRef.id, ...planDoc };

    await finalizeIdempotencySuccess(idempotency.recordId, result);

    return result;
  } catch (err) {
    await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_PLAN_FAILED", (err as Error).message);
    throw err;
  }
});

export const plansUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to update subscription plans.");
  }

  const input = parseInput(UpdatePlanSchema, request.data);

  const planRef = db.collection("subscriptionPlans").doc(input.planId);
  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    throw new HttpsError("not-found", "Subscription plan not found.");
  }

  const updates: Partial<SubscriptionPlanDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;
  if (input.price !== undefined) updates.price = input.price;
  if (input.branchLimit !== undefined) updates.branchLimit = input.branchLimit;
  if (input.moduleFlags) updates.moduleFlags = input.moduleFlags;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  await planRef.update(updates);


  return { success: true, message: "Subscription plan updated successfully." };
});

export const plansList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const includeInactive = parseInput(ListPlansSchema, request.data).includeInactive === true;
  let query = db.collection("subscriptionPlans").orderBy("price");

  if (!includeInactive) {
    query = query.where("isActive", "==", true);
  }

  const snapshot = await query.get();
  const plans = snapshot.docs.map((doc) => ({
    planId: doc.id,
    ...(doc.data() as SubscriptionPlanDoc),
  }));

  return {
    plans,
    items: plans,
    count: plans.length,
    totalCount: plans.length,
  };
});

export const plansPreviewImpact = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to preview plan impact.");
  }

  const input = parseInput(PreviewPlanImpactSchema, request.data);

  if (input.organizationId) {
    const targetPlanId = input.targetPlanId || input.planId;
    if (!targetPlanId) {
      throw new HttpsError("invalid-argument", "targetPlanId or planId is required when organizationId is provided.");
    }
    const orgDoc = await db.collection("organizations").doc(input.organizationId).get();
    if (!orgDoc.exists) {
      throw new HttpsError("not-found", `Organization "${input.organizationId}" not found.`);
    }
    const org = orgDoc.data() as OrganizationDoc;
    const targetPlanDoc = await db.collection("subscriptionPlans").doc(targetPlanId).get();
    if (!targetPlanDoc.exists) {
      throw new HttpsError("not-found", `Subscription plan "${targetPlanId}" not found.`);
    }
    const targetPlan = targetPlanDoc.data() as SubscriptionPlanDoc;

    const branchesSnap = await db.collection("organizations").doc(input.organizationId).collection("branches").get();
    const currentBranches = branchesSnap.size;
    const currentStaff = org.activeEmployeeCount || 0;

    const violations: Array<{
      type: "branch_limit_exceeded" | "staff_limit_exceeded" | "module_disabled";
      current: unknown;
      proposed: unknown;
      message: string;
    }> = [];

    const targetBranchLimit = targetPlan.branchLimit ?? 9999;
    if (currentBranches > targetBranchLimit) {
      violations.push({
        type: "branch_limit_exceeded",
        current: currentBranches,
        proposed: targetBranchLimit,
        message: `Has ${currentBranches} branches, proposed limit is ${targetBranchLimit}.`,
      });
    }

    const targetStaffLimit = targetPlan.seatLimits?.staff ?? 9999;
    if (currentStaff > targetStaffLimit) {
      violations.push({
        type: "staff_limit_exceeded",
        current: currentStaff,
        proposed: targetStaffLimit,
        message: `Has ${currentStaff} active employees, proposed staff seat limit is ${targetStaffLimit}.`,
      });
    }

    const isDowngradePossible = violations.length === 0;
    const impactedOrganizations = violations.length > 0 ? [{
      organizationId: input.organizationId,
      organizationName: org.name,
      violations,
    }] : [];

    const impact = {
      organizationId: input.organizationId,
      currentPlanId: org.planId,
      targetPlanId,
      currentBranches,
      proposedBranchLimit: targetBranchLimit,
      currentStaff,
      proposedStaffLimit: targetStaffLimit,
      violations,
      isDowngradePossible,
      canSwitch: isDowngradePossible,
    };

    return {
      planId: targetPlanId,
      totalOrganizationsOnPlan: 1,
      impactedCount: impactedOrganizations.length,
      affectedCount: impactedOrganizations.length,
      impactedOrganizations,
      affectedOrganizations: impactedOrganizations,
      impact,
      isDowngradePossible,
      violations,
    };
  }

  const planId = input.planId;
  if (!planId) {
    throw new HttpsError("invalid-argument", "planId is required.");
  }

  const planRef = db.collection("subscriptionPlans").doc(planId);
  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    throw new HttpsError("not-found", `Subscription plan "${planId}" not found.`);
  }

  // Scan organizations subscribed to this plan
  const orgsSnap = await db
    .collection("organizations")
    .where("planId", "==", planId)
    .get();

  const impactedOrganizations: Array<{
    organizationId: string;
    organizationName: string;
    violations: Array<{
      type: "branch_limit_exceeded" | "staff_limit_exceeded" | "module_disabled";
      current: unknown;
      proposed: unknown;
      message: string;
    }>;
  }> = [];

  for (const doc of orgsSnap.docs) {
    const org = doc.data() as OrganizationDoc;
    const violations: Array<{
      type: "branch_limit_exceeded" | "staff_limit_exceeded" | "module_disabled";
      current: unknown;
      proposed: unknown;
      message: string;
    }> = [];

    // Check branch count
    if (input.branchLimit !== undefined) {
      const branchesSnap = await db.collection("organizations").doc(doc.id).collection("branches").get();
      const currentBranches = branchesSnap.size;
      if (currentBranches > input.branchLimit) {
        violations.push({
          type: "branch_limit_exceeded",
          current: currentBranches,
          proposed: input.branchLimit,
          message: `Has ${currentBranches} branches, proposed limit is ${input.branchLimit}.`,
        });
      }
    }

    // Check staff seat count
    if (input.seatLimits?.staff !== undefined) {
      const currentStaff = org.activeEmployeeCount || 0;
      if (currentStaff > input.seatLimits.staff) {
        violations.push({
          type: "staff_limit_exceeded",
          current: currentStaff,
          proposed: input.seatLimits.staff,
          message: `Has ${currentStaff} active employees, proposed staff seat limit is ${input.seatLimits.staff}.`,
        });
      }
    }

    // Check disabled modules that the tenant currently uses
    if (input.moduleFlags) {
      const currentModules = org.moduleToggles || {};
      for (const [mod, enabled] of Object.entries(input.moduleFlags)) {
        if (!enabled && currentModules[mod] === true) {
          violations.push({
            type: "module_disabled",
            current: true,
            proposed: false,
            message: `Module "${mod}" is actively enabled for this tenant but would be disabled by the proposed plan.`,
          });
        }
      }
    }

    if (violations.length > 0) {
      impactedOrganizations.push({
        organizationId: doc.id,
        organizationName: org.name,
        violations,
      });
    }
  }

  const isDowngradePossible = impactedOrganizations.length === 0;
  return {
    planId,
    totalOrganizationsOnPlan: orgsSnap.size,
    impactedCount: impactedOrganizations.length,
    affectedCount: impactedOrganizations.length,
    impactedOrganizations,
    affectedOrganizations: impactedOrganizations,
    impact: {
      impactedCount: impactedOrganizations.length,
      affectedCount: impactedOrganizations.length,
      isDowngradePossible,
      impactedOrganizations,
      affectedOrganizations: impactedOrganizations,
    },
    isDowngradePossible,
  };
});

export const plansGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(GetPlanSchema, request.data);
  const planRef = db.collection("subscriptionPlans").doc(input.planId);
  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    throw new HttpsError("not-found", `Subscription plan "${input.planId}" not found.`);
  }
  const planData = {
    id: planDoc.id,
    planId: planDoc.id,
    ...(planDoc.data() as SubscriptionPlanDoc),
  };
  return {
    ...planData,
    plan: planData,
  };
});

export const plansArchive = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required.");
  }
  const input = parseInput(ArchivePlanSchema, request.data);
  const planRef = db.collection("subscriptionPlans").doc(input.planId);
  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    throw new HttpsError("not-found", `Subscription plan "${input.planId}" not found.`);
  }
  const now = new Date().toISOString();
  await planRef.update({
    isActive: false,
    isArchived: true,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  return {
    success: true,
    isArchived: true,
    planId: input.planId,
    message: `Subscription plan "${input.planId}" archived successfully.`,
  };
});

export const plansDelete = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required.");
  }
  const input = parseInput(DeletePlanSchema, request.data);
  const planRef = db.collection("subscriptionPlans").doc(input.planId);
  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    throw new HttpsError("not-found", `Subscription plan "${input.planId}" not found.`);
  }
  // Check if any organization currently references this plan
  const orgsSnap = await db.collection("organizations").where("planId", "==", input.planId).limit(1).get();
  if (!orgsSnap.empty) {
    throw new HttpsError("failed-precondition", `Plan is referenced by organization "${orgsSnap.docs[0].id}". It must be archived rather than permanently deleted.`);
  }
  await planRef.delete();
  return { success: true, message: `Subscription plan "${input.planId}" permanently deleted.` };
});
