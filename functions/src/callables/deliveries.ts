/**
 * Delivery & Dispatch Callables
 * 
 * Strict architectural rule:
 * - Deliveries reference `billId` by ID only!
 * - Never embed the Bill document or its items in the Delivery document.
 * - Delivery address is stored as the specific delivery destination.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateDeliverySchema,
  UpdateDeliveryStatusSchema,
  ListDeliveriesSchema,
} from "../validation/schemas.js";
import { DeliveryDoc, MembershipDoc, BillDoc } from "../types/models.js";
import { DeliveryStatus, DeliveryPartner } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const deliveriesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateDeliverySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  // Verify the referenced bill exists and belongs to this organization
  const billDoc = await db.collection("bills").doc(input.billId).get();
  if (!billDoc.exists) {
    throw new HttpsError("not-found", `Referenced Bill "${input.billId}" not found.`);
  }
  const billData = billDoc.data() as BillDoc;
  if (billData.organizationId !== input.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant bill reference rejected.");
  }

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "deliveries.create",
    clientKey: input.idempotencyKey,
    payload: input as unknown as Record<string, unknown>,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const deliveryRef = db.collection("deliveries").doc();
    const deliveryId = deliveryRef.id;
    const now = new Date().toISOString();
    const branchId = input.branchId || billData.branchId || (request.auth.token.primaryBranchId as string) || "main-branch";

    const deliveryDoc: DeliveryDoc = {
      organizationId: input.organizationId,
      branchId,
      billId: input.billId, // ID reference ONLY!
      customerId: input.customerId || null,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      address: {
        line1: input.address.line1.trim(),
        line2: input.address.line2?.trim() || undefined,
        landmark: input.address.landmark?.trim() || undefined,
        city: input.address.city.trim(),
        pincode: input.address.pincode.trim(),
      },
      riderMembershipId: input.riderMembershipId || null,
      riderName: input.riderName?.trim() || undefined,
      partner: input.partner || DeliveryPartner.INTERNAL,
      deliveryFee: input.deliveryFee || 0,
      status: input.riderMembershipId ? DeliveryStatus.ASSIGNED : DeliveryStatus.PENDING,
      cod: input.cod ? {
        isCod: input.cod.isCod,
        amount: input.cod.amount,
        isCollected: false,
        collectedAt: null,
      } : undefined,
      notes: input.notes,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    await deliveryRef.set(deliveryDoc);

    const response = {
      deliveryId,
      organizationId: deliveryDoc.organizationId,
      billId: deliveryDoc.billId,
      status: deliveryDoc.status,
      message: "Delivery order created successfully.",
    };

    if (idempotency.recordId) {
      const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      await idempRef.update({
        status: "succeeded",
        result: response,
        updatedAt: now,
      });
    }

    await createAuditLog({
      organizationId: input.organizationId,
      actorUid: request.auth.uid,
      action: "DELIVERY_CREATED",
      entityType: "delivery",
      entityId: deliveryId,
      details: { billId: input.billId, status: deliveryDoc.status },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_DELIVERY_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create delivery: ${(error as Error).message}`);
  }
});

export const deliveriesUpdateStatus = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateDeliveryStatusSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const deliveryRef = db.collection("deliveries").doc(input.deliveryId);
  const docSnap = await deliveryRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Delivery not found.");
  }

  const existing = docSnap.data() as DeliveryDoc;
  if (existing.organizationId !== input.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const now = new Date().toISOString();
  const updates: Partial<DeliveryDoc> = {
    status: input.status,
    updatedAt: now,
  };

  if (input.riderMembershipId) updates.riderMembershipId = input.riderMembershipId;
  if (input.riderName) updates.riderName = input.riderName;
  if (input.notes) updates.notes = input.notes;

  if (input.codCollected && existing.cod) {
    updates.cod = {
      ...existing.cod,
      isCollected: true,
      collectedAt: now,
    };
  }

  await deliveryRef.update(updates);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "DELIVERY_STATUS_UPDATED",
    entityType: "delivery",
    entityId: input.deliveryId,
    details: { status: input.status },
  });

  return { success: true, message: `Delivery status updated to ${input.status}.` };
});

export const deliveriesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListDeliveriesSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("deliveries")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.status) {
    query = query.where("status", "==", input.status);
  }
  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    deliveryId: doc.id,
    ...(doc.data() as DeliveryDoc),
  }));

  return { items, count: items.length };
});

export const deliveriesGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const deliveryId = request.data?.deliveryId;
  const organizationId = request.data?.organizationId;
  if (!deliveryId || !organizationId) {
    throw new HttpsError("invalid-argument", "deliveryId and organizationId required.");
  }

  await verifyTenantAccess(request.auth, organizationId);

  const docSnap = await db.collection("deliveries").doc(deliveryId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Delivery not found.");
  }

  const data = docSnap.data() as DeliveryDoc;
  if (data.organizationId !== organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return { deliveryId: docSnap.id, ...data };
});

