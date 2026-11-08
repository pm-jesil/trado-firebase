/**
 * Stock Management Callables
 * - stockAdjust: Manual stock intake, physical count adjustment, wastage, or damage write-off
 * - stockMovementsList: Tenant-scoped stock movement ledger
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  StockAdjustSchema,
  ListStockMovementsSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { StockMovementDoc, ProductDoc } from "../types/models.js";
import { StockMovementType, StockAdjustmentReason, WRITE_OFF_REASONS } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { applyStockChangesInTxn } from "../services/stockEngine.js";
import { assertSerialCount, prepareSerialsInTxn } from "../services/serials.js";
import { createAuditLog } from "../services/audit.js";
import { hydrate } from "../services/hydration.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext, resolveDataScope, applyDataScope, type RequestContext } from "../services/contextResolver.js";
import { evaluateApproval, assertCanDecide } from "../services/approvals.js";
import type { DocumentDecisionInput } from "../validation/schemas.js";
import { AppPermissions } from "../constants/permissions.js";

interface AdjustmentRequest {
  productId: string;
  branchId: string;
  quantity: number;
  reason: string;
  reasonCode?: StockAdjustmentReason;
  serialNumbers?: string[];
}

/**
 * Applies a stock adjustment (stock ledger + serials) and audits it. One implementation for a
 * direct adjustment and for an approved request (`requestRef`: re-checked pending in the txn).
 */
export async function applyStockAdjustment(ctx: RequestContext, adj: AdjustmentRequest, requestRef?: FirebaseFirestore.DocumentReference) {
  const orgId = ctx.organizationId;
  const prodDoc = await db.collection("products").doc(adj.productId).get();
  if (!prodDoc.exists) throw new HttpsError("not-found", `Product "${adj.productId}" not found.`);
  const prodData = prodDoc.data() as ProductDoc;
  if (prodData.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  if (!prodData.trackStock) throw new HttpsError("failed-precondition", `Product "${prodData.name}" does not track stock.`);

  const reasonCode = adj.reasonCode || (adj.quantity < 0 ? StockAdjustmentReason.OTHER : StockAdjustmentReason.COUNT_CORRECTION);
  const movType = adj.quantity < 0 && WRITE_OFF_REASONS.has(reasonCode)
    ? StockMovementType.DAMAGE_OUT
    : (adj.quantity >= 0 ? StockMovementType.ADJUSTMENT_IN : StockMovementType.ADJUSTMENT_OUT);
  // Serial-tracked products: an adjustment names the units (+ registers them, − writes them off)
  const serialLine = prodData.trackSerial ? { lineId: "ADJ", productId: adj.productId, serials: adj.serialNumbers || [] } : null;
  if (serialLine) assertSerialCount(serialLine, Math.abs(adj.quantity));
  else if (adj.serialNumbers?.length) {
    throw new HttpsError("invalid-argument", "[SERIALS_NOT_TRACKED] This product does not track serial numbers.", { reason: "SERIALS_NOT_TRACKED" });
  }
  const adjustmentId = requestRef?.id || db.collection("stockAdjustmentRequests").doc().id;

  const results = await db.runTransaction(async (txn) => {
    if (requestRef) {
      const req = await txn.get(requestRef);
      if (!req.exists || req.data()?.status !== "pending_approval") throw new HttpsError("failed-precondition", "Adjustment request is no longer pending approval.");
    }
    const commitSerials = serialLine
      ? await prepareSerialsInTxn(txn, { organizationId: orgId, branchId: adj.branchId, lines: [serialLine], action: adj.quantity > 0 ? { kind: "adjust_in", adjustmentId } : { kind: "adjust_out", adjustmentId } })
      : null;
    const applied = await applyStockChangesInTxn(txn, {
      organizationId: orgId,
      branchId: adj.branchId,
      actorUid: ctx.callerUid,
      items: [{ productId: adj.productId, quantity: adj.quantity, type: movType, referenceId: adj.productId, referenceModel: "manual_adjustment", reason: adj.reason, reasonCode }],
      allowNegativeStock: ctx.branch.settings?.allowNegativeStock === true,
    });
    if (commitSerials) commitSerials();
    if (requestRef) {
      const now = new Date().toISOString();
      txn.update(requestRef, { status: "approved", movementId: applied[0].movementId, approvedAt: now, approvedBy: ctx.callerUid, updatedAt: now, updatedBy: ctx.callerUid });
    }
    return applied;
  });

  const changeResult = results[0];
  await createAuditLog({
    organizationId: orgId,
    branchId: adj.branchId,
    actorUid: ctx.callerUid,
    actorMembershipId: ctx.membershipId,
    action: requestRef ? "STOCK_ADJUSTMENT_APPROVED" : "STOCK_ADJUSTED",
    entityType: "product",
    entityId: adj.productId,
    details: { quantity: adj.quantity, previousStock: changeResult.previousStock, newStock: changeResult.newStock, reason: adj.reason, reasonCode, requestId: requestRef?.id || null },
  });
  return {
    productId: adj.productId,
    organizationId: orgId,
    previousStock: changeResult.previousStock,
    newStock: changeResult.newStock,
    quantityAdjusted: adj.quantity,
    reasonCode,
    movementId: changeResult.movementId,
    status: "adjusted",
    message: "Stock adjusted successfully.",
  };
}

export const stockAdjust = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(StockAdjustSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.STOCK_ADJUST, AppPermissions.INVENTORY_ADJUST],
  });
  const orgId = ctx.organizationId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "stock.adjust",
    clientKey: input.idempotencyKey,
    payload: input as unknown as Record<string, unknown>,
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const adj: AdjustmentRequest = {
      productId: input.productId, branchId: ctx.branchId, quantity: input.quantity, reason: input.reason,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}), ...(input.serialNumbers ? { serialNumbers: input.serialNumbers } : {}),
    };
    // Maker–checker: valued at current cost (WAC) for the policy threshold
    const product = (await db.collection("products").doc(input.productId).get()).data() as ProductDoc | undefined;
    const value = Math.abs(input.quantity) * (product?.weightedAverageCost || product?.costPrice || 0);
    const approval = await evaluateApproval(ctx, "stock_adjustment", value);
    let response: Record<string, unknown>;
    if (approval.required) {
      const now = new Date().toISOString();
      const ref = db.collection("stockAdjustmentRequests").doc();
      await ref.set({ organizationId: orgId, ...adj, status: "pending_approval", approvalNote: approval.note || null, createdAt: now, createdBy: ctx.callerUid, createdByMembershipId: ctx.membershipId });
      response = { requestId: ref.id, productId: input.productId, organizationId: orgId, status: "pending_approval", message: "Adjustment submitted for approval (no stock effect until approved)." };
    } else {
      response = await applyStockAdjustment(ctx, adj);
    }
    if (idempotency.recordId) {
      await db.collection("idempotencyRecords").doc(idempotency.recordId).update({ status: "succeeded", result: response, updatedAt: new Date().toISOString() });
    }
    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "STOCK_ADJUST_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to adjust stock: ${(error as Error).message}`);
  }
});

/** Approver decision on a pending stock adjustment request (called by documentsDecide). */
export async function decideStockAdjustment(ctx: RequestContext, input: DocumentDecisionInput) {
  const ref = db.collection("stockAdjustmentRequests").doc(input.documentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Adjustment request not found.");
  const req = snap.data() as AdjustmentRequest & { organizationId: string; status: string; createdBy: string };
  if (req.organizationId !== ctx.organizationId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  assertCanDecide(ctx, "stock_adjustment", req);
  if (input.decision === "reject") {
    const now = new Date().toISOString();
    await ref.update({ status: "rejected", rejectedAt: now, rejectedBy: ctx.callerUid, approvalReason: input.reason || null, updatedAt: now, updatedBy: ctx.callerUid });
    return { requestId: snap.id, status: "rejected" };
  }
  return { requestId: snap.id, ...(await applyStockAdjustment(ctx, req, ref)) };
}

export const stockMovementsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListStockMovementsSchema, request.data);

  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.STOCK_VIEW, AppPermissions.INVENTORY_VIEW],
  });
  const scope = await resolveDataScope(ctx, "stock", AppPermissions.STOCK_VIEW, input.branchId);
  const orgId = ctx.organizationId;

  let query: FirebaseFirestore.Query = db.collection("stockMovements")
    .where("organizationId", "==", orgId);

  if (input.productId) {
    query = query.where("productId", "==", input.productId);
  }
  if (input.type) {
    query = query.where("type", "==", input.type);
  }
  // Stock is branch data: anyone allowed to view stock sees their branch's movements
  const scoped = applyDataScope(query, { ...scope, userIds: null });
  const { snapshot, nextCursor } = await fetchPage(scoped.query, "stockMovements", input.startAfterId, input.limit || 50);
  const items = snapshot.docs.map((doc) => ({
    movementId: doc.id,
    ...(doc.data() as StockMovementDoc),
  }));

  return { items, count: items.length, nextCursor, included: await hydrate(ctx, items) };
});
