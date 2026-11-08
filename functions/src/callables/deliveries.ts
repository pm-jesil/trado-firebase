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
  GetDeliverySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { DeliveryDoc, BillDoc, MembershipDoc } from "../types/models.js";
import { DeliveryStatus, DeliveryPartner, PaymentMethod, DocumentType } from "../constants/enums.js";
import { prepareReservationInTxn, commitReservationInTxn } from "../services/stockEngine.js";
import { remainingToDeliver } from "../services/deliveryProgress.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";
import { hydrate } from "../services/hydration.js";
import { fetchPage } from "../services/pagination.js";
import {
  resolveRequestContext,
  resolveDataScope,
  applyDataScope,
  isInDataScope,
  type RequestContext,
} from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { finalizeBillInternal } from "./bills.js";

/** Legal delivery status transitions. */
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.PENDING]: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
  [DeliveryStatus.ASSIGNED]: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
  [DeliveryStatus.FAILED]: [DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.RETURNED],
  [DeliveryStatus.DELIVERED]: [DeliveryStatus.RETURNED],
  [DeliveryStatus.RETURNED]: [],
};

/** Releases (−1) or re-takes (+1) a draft sales order's stock reservation. */
async function setOrderReservation(ctx: RequestContext, billId: string, direction: 1 | -1): Promise<void> {
  const billRef = db.collection("bills").doc(billId);
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(billRef);
    const bill = snap.data() as BillDoc | undefined;
    if (!bill || bill.status !== "draft" || bill.documentType !== DocumentType.SALES_ORDER) return;
    if ((direction === -1) !== (bill.stockReserved === true)) return; // already in the wanted state
    const lines = bill.items.filter((i) => i.trackStock !== false).map((i) => ({ productId: i.productId, baseQuantity: i.baseQuantity ?? i.quantity }));
    const plan = await prepareReservationInTxn(txn, { organizationId: ctx.organizationId, branchId: bill.branchId || "main-branch", lines, direction, allowNegativeStock: ctx.branch.settings?.allowNegativeStock === true });
    commitReservationInTxn(txn, plan, ctx.callerUid);
    txn.update(billRef, { stockReserved: direction === 1, updatedAt: new Date().toISOString(), updatedBy: ctx.callerUid });
  });
}

async function assertRiderInOrg(orgId: string, riderMembershipId: string): Promise<void> {
  const mem = await db.collection("memberships").doc(riderMembershipId).get();
  if (!mem.exists || (mem.data() as MembershipDoc).organizationId !== orgId || (mem.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("invalid-argument", "riderMembershipId is not an active member of this organization.");
  }
}

/** Riders without delivery:assign only see / update deliveries assigned to them. */
function isRiderOnly(ctx: RequestContext): boolean {
  return !ctx.isOwner && ctx.role?.code !== "admin" && !ctx.can(AppPermissions.DELIVERY_ASSIGN);
}

export const deliveriesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateDeliverySchema, request.data);

  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.DELIVERY_CREATE, AppPermissions.DELIVERY_ASSIGN],
  });
  const orgId = ctx.organizationId;

  // Verify the referenced bill exists and belongs to this organization
  const billDoc = await db.collection("bills").doc(input.billId).get();
  if (!billDoc.exists) {
    throw new HttpsError("not-found", `Referenced Bill "${input.billId}" not found.`);
  }
  const billData = billDoc.data() as BillDoc;
  if (billData.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant bill reference rejected.");
  }

  const branchId = billData.branchId || ctx.branchId;
  if (branchId !== ctx.branchId && !ctx.isOwner && ctx.role?.code !== "admin") {
    throw new HttpsError("permission-denied", "[BRANCH_NOT_ASSIGNED] The bill belongs to another branch.", { reason: "BRANCH_NOT_ASSIGNED" });
  }
  if (["voided", "cancelled", "rejected"].includes(String(billData.status))) {
    throw new HttpsError("failed-precondition", `Cannot deliver a bill in status "${billData.status}".`);
  }
  if (input.riderMembershipId) await assertRiderInOrg(orgId, input.riderMembershipId);

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
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

    const deliveryDoc: DeliveryDoc = {
      organizationId: orgId,
      branchId,
      billId: input.billId, // ID reference ONLY!
      customerId: billData.customerId || null,
      ...(input.recipient ? { recipient: input.recipient } : {}),
      lines: [], // set from the bill inside the creation transaction
      address: {
        line1: input.address.line1.trim(),
        line2: input.address.line2?.trim() || undefined,
        landmark: input.address.landmark?.trim() || undefined,
        city: input.address.city.trim(),
        pincode: input.address.pincode.trim(),
      },
      riderMembershipId: input.riderMembershipId || null,
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
      createdBy: ctx.callerUid,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    };

    // Lines: per-line quantities, never more than what is not yet on another delivery (transactional)
    await db.runTransaction(async (txn) => {
      const others = await txn.get(db.collection("deliveries").where("organizationId", "==", orgId).where("billId", "==", input.billId));
      const remaining = remainingToDeliver(billData, others.docs.map((d) => d.data() as DeliveryDoc));
      const lines = input.lines || Object.entries(remaining).filter(([, q]) => q > 0).map(([lineId, quantity]) => ({ lineId, quantity }));
      if (!lines.length) throw new HttpsError("failed-precondition", "[DELIVERY_COMPLETE] Every line of this bill is already on a delivery.", { reason: "DELIVERY_COMPLETE" });
      for (const l of lines) {
        if (remaining[l.lineId] === undefined) throw new HttpsError("invalid-argument", `Line ${l.lineId} is not on bill ${input.billId}.`);
        if (l.quantity > remaining[l.lineId] + 1e-9) {
          throw new HttpsError("invalid-argument", `[DELIVERY_EXCEEDS_LINE] Line ${l.lineId}: ${l.quantity} requested, ${remaining[l.lineId]} not yet on a delivery.`, { reason: "DELIVERY_EXCEEDS_LINE" });
        }
      }
      // A sales order is invoiced in full on delivery, so it ships in one delivery
      if (billData.status === "draft" && lines.some((l) => Math.abs(l.quantity - remaining[l.lineId]) > 1e-9 || lines.length < Object.values(remaining).filter((q) => q > 0).length)) {
        throw new HttpsError("failed-precondition", "[PARTIAL_ORDER_DELIVERY] A sales order ships in one full delivery; invoice it first to deliver in parts.", { reason: "PARTIAL_ORDER_DELIVERY" });
      }
      deliveryDoc.lines = lines;
      txn.set(deliveryRef, deliveryDoc);
    });

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
      organizationId: orgId,
      branchId,
      actorUid: ctx.callerUid,
      actorMembershipId: ctx.membershipId,
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

  const input = parseInput(UpdateDeliveryStatusSchema, request.data);

  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.DELIVERY_UPDATE, AppPermissions.DELIVERY_ASSIGN],
  });
  const orgId = ctx.organizationId;

  const deliveryRef = db.collection("deliveries").doc(input.deliveryId);
  const docSnap = await deliveryRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Delivery not found.");
  }

  const existing = docSnap.data() as DeliveryDoc;
  if (existing.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Delivery staff may only act on deliveries assigned to them; (re)assignment needs delivery:assign
  if (isRiderOnly(ctx)) {
    if (existing.riderMembershipId !== ctx.membershipId) {
      throw new HttpsError("permission-denied", "[PERMISSION_DENIED] This delivery is not assigned to you.", { reason: "PERMISSION_DENIED" });
    }
    if (input.riderMembershipId && input.riderMembershipId !== existing.riderMembershipId) {
      throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Reassigning a delivery requires delivery:assign.", { reason: "PERMISSION_DENIED" });
    }
  }
  if (input.riderMembershipId) await assertRiderInOrg(orgId, input.riderMembershipId);
  const allowed = DELIVERY_TRANSITIONS[existing.status as DeliveryStatus] || [];
  if (input.status !== existing.status && !allowed.includes(input.status)) {
    throw new HttpsError("failed-precondition", `Illegal delivery transition "${existing.status}" -> "${input.status}".`);
  }

  const now = new Date().toISOString();
  const updates: Partial<DeliveryDoc> = {
    status: input.status,
    updatedAt: now,
    updatedBy: ctx.callerUid,
  };

  // A failed sales-order delivery releases its stock reservation; a retry re-reserves it
  const leavingFailed = existing.status === DeliveryStatus.FAILED && input.status !== DeliveryStatus.FAILED && input.status !== DeliveryStatus.RETURNED;
  if (input.status === DeliveryStatus.FAILED || leavingFailed) {
    await setOrderReservation(ctx, existing.billId, input.status === DeliveryStatus.FAILED ? -1 : 1);
  }

  // Delivery completes a pre-sale order: finalize the bill (stock out, ledger, collected payment)
  let finalizedBill: { billNumber: string; paymentId: string | null } | null = null;
  if (input.status === DeliveryStatus.DELIVERED && existing.status !== DeliveryStatus.DELIVERED) {
    const billSnap = await db.collection("bills").doc(existing.billId).get();
    const bill = billSnap.data() as BillDoc | undefined;
    if (bill && bill.status === "draft") {
      const collected = input.collectedAmount ?? (input.codCollected && existing.cod ? existing.cod.amount : 0);
      const res = await finalizeBillInternal(ctx, existing.billId, {
        paidAmount: collected || 0,
        paymentMethod: (input.paymentMethod as PaymentMethod) || PaymentMethod.CASH,
      });
      finalizedBill = { billNumber: res.billNumber, paymentId: res.paymentId };
      updates.deliveredAt = now;
    }
  }

  if (input.riderMembershipId) updates.riderMembershipId = input.riderMembershipId;
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
    organizationId: orgId,
    branchId: ctx.branchId,
    actorUid: ctx.callerUid,
    actorMembershipId: ctx.membershipId,
    action: "DELIVERY_STATUS_UPDATED",
    entityType: "delivery",
    entityId: input.deliveryId,
    details: { status: input.status, finalizedBillNumber: finalizedBill?.billNumber || null },
    changes: [{ field: "status", from: existing.status, to: input.status }],
  });

  return {
    success: true,
    status: input.status,
    finalizedBill,
    message: `Delivery status updated to ${input.status}.`,
  };
});

export const deliveriesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListDeliveriesSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.DELIVERY_VIEW });
  const orgId = ctx.organizationId;
  const scope = await resolveDataScope(ctx, "deliveries", AppPermissions.DELIVERY_ASSIGN, input.branchId);

  let query: FirebaseFirestore.Query = db.collection("deliveries")
    .where("organizationId", "==", orgId);

  if (input.status) {
    query = query.where("status", "==", input.status);
  }
  // Riders see deliveries assigned to them; dispatchers/managers by data scope
  let keep: (d: Record<string, unknown>) => boolean = () => true;
  if (isRiderOnly(ctx) && scope.level === "self") {
    query = query.where("riderMembershipId", "==", ctx.membershipId);
  } else {
    const scoped = applyDataScope(query, scope);
    query = scoped.query;
    keep = scoped.keep;
  }

  const { snapshot, nextCursor } = await fetchPage(query, "deliveries", input.startAfterId, input.limit || 50);
  const items = snapshot.docs
    .map((doc) => ({ deliveryId: doc.id, ...(doc.data() as DeliveryDoc) }))
    .filter((d) => keep(d as unknown as Record<string, unknown>));

  return { items, count: items.length, scope: scope.level, nextCursor, included: await hydrate(ctx, items) };
});

export const deliveriesGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { deliveryId } = parseInput(GetDeliverySchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.DELIVERY_VIEW });
  const orgId = ctx.organizationId;

  const docSnap = await db.collection("deliveries").doc(deliveryId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Delivery not found.");
  }

  const data = docSnap.data() as DeliveryDoc;
  if (data.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const scope = await resolveDataScope(ctx, "deliveries", AppPermissions.DELIVERY_ASSIGN);
  const assignedToMe = data.riderMembershipId === ctx.membershipId;
  if (!assignedToMe && !isInDataScope(data as unknown as Record<string, unknown>, scope)) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Delivery is outside your data scope.", { reason: "PERMISSION_DENIED" });
  }

  const delivery = { deliveryId: docSnap.id, ...data };
  return { ...delivery, included: await hydrate(ctx, [delivery]) };
});

