/**
 * Subscription Plan Callables
 * - plansCreate: Super Admin only
 * - plansUpdate: Super Admin only
 * - plansList: Authenticated callers
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreatePlanSchema,
  UpdatePlanSchema,
  ListPlansSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { SubscriptionPlanDoc } from "../types/models.js";
import { createAuditLog } from "../services/audit.js";

export const plansCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to create subscription plans.");
  }

  const input = parseInput(CreatePlanSchema, request.data);

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

  await createAuditLog({
    organizationId: "platform",
    actorUid: request.auth.uid,
    action: "PLAN_CREATED",
    entityType: "subscriptionPlan",
    entityId: planRef.id,
    details: { name: input.name, price: input.price },
  });

  return { planId: planRef.id, ...planDoc };
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

  await createAuditLog({
    organizationId: "platform",
    actorUid: request.auth.uid,
    action: "PLAN_UPDATED",
    entityType: "subscriptionPlan",
    entityId: input.planId,
    details: updates as Record<string, unknown>,
  });

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

  return { plans };
});
