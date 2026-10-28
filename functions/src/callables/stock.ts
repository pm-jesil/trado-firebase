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
import { StockMovementDoc, ProductDoc, MembershipDoc } from "../types/models.js";
import { StockMovementType } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { applyStockChangesInTxn } from "../services/stockEngine.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const stockAdjust = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = StockAdjustSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "stock.adjust",
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
    const prodDoc = await db.collection("products").doc(input.productId).get();
    if (!prodDoc.exists) {
      throw new HttpsError("not-found", `Product "${input.productId}" not found.`);
    }

    const prodData = prodDoc.data() as ProductDoc;
    if (prodData.organizationId !== input.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }

    const movType = input.quantity >= 0 ? StockMovementType.ADJUSTMENT_IN : StockMovementType.ADJUSTMENT_OUT;
    const callerUid = request.auth.uid;
    const branchId = input.branchId || (request.auth.token.primaryBranchId as string) || "main-branch";

    const results = await db.runTransaction(async (txn) => {
      return await applyStockChangesInTxn(txn, {
        organizationId: input.organizationId,
        branchId,
        actorUid: callerUid,
        items: [
          {
            productId: input.productId,
            quantity: input.quantity,
            type: movType,
            unit: prodData.baseUnit || "piece",
            referenceId: input.productId,
            referenceModel: "manual_adjustment",
            reason: input.reason,
          },
        ],
      });
    });

    const changeResult = results[0];
    const response = {
      productId: input.productId,
      organizationId: input.organizationId,
      previousStock: changeResult.previousStock,
      newStock: changeResult.newStock,
      quantityAdjusted: input.quantity,
      movementId: changeResult.movementId,
      status: "adjusted",
      message: "Stock adjusted successfully.",
    };

    if (idempotency.recordId) {
      const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      await idempRef.update({
        status: "succeeded",
        result: response,
        updatedAt: new Date().toISOString(),
      });
    }

    await createAuditLog({
      organizationId: input.organizationId,
      actorUid: request.auth.uid,
      action: "STOCK_ADJUSTED",
      entityType: "product",
      entityId: input.productId,
      details: {
        quantity: input.quantity,
        previousStock: changeResult.previousStock,
        newStock: changeResult.newStock,
        reason: input.reason,
      },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "STOCK_ADJUST_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to adjust stock: ${(error as Error).message}`);
  }
});

export const stockMovementsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListStockMovementsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("stockMovements")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.productId) {
    query = query.where("productId", "==", input.productId);
  }
  if (input.type) {
    query = query.where("type", "==", input.type);
  }
  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    movementId: doc.id,
    ...(doc.data() as StockMovementDoc),
  }));

  return { items, count: items.length };
});
