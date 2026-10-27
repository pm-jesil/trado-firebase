/**
 * Return Callables (Sales Returns & Purchase Returns)
 * 
 * Strict architectural rule:
 * - References `referenceId` by ID only (billId or outflowId)
 * - Restocked items increment/decrement stock transactionally
 * - Generates sequential return numbers: `RET-2026-000001`
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateReturnSchema,
  ListReturnsSchema,
} from "../validation/schemas.js";
import { ReturnDoc, ReturnItem, ProductDoc, MembershipDoc, BillDoc, OutflowDoc } from "../types/models.js";
import {
  ReturnType,
  ReturnDisposition,
  StockMovementType,
} from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  StockChangeItem,
} from "../services/stockEngine.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const returnsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateReturnSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  // Verify referenced parent document exists and belongs to this organization
  let parentNumber = "";
  if (input.returnType === ReturnType.SALES_RETURN) {
    const billDoc = await db.collection("bills").doc(input.referenceId).get();
    if (!billDoc.exists) {
      throw new HttpsError("not-found", `Referenced Bill "${input.referenceId}" not found.`);
    }
    const billData = billDoc.data() as BillDoc;
    if (billData.organizationId !== input.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant reference rejected.");
    }
    parentNumber = billData.billNumber;
  } else {
    const outflowDoc = await db.collection("outflows").doc(input.referenceId).get();
    if (!outflowDoc.exists) {
      throw new HttpsError("not-found", `Referenced Outflow "${input.referenceId}" not found.`);
    }
    const outflowData = outflowDoc.data() as OutflowDoc;
    if (outflowData.organizationId !== input.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant reference rejected.");
    }
    parentNumber = outflowData.outflowNumber;
  }

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "returns.create",
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
    const returnRef = db.collection("returns").doc();
    const returnId = returnRef.id;
    const now = new Date().toISOString();

    let totalRefundAmount = 0;
    const processedItems: ReturnItem[] = [];
    const stockChangeItems: StockChangeItem[] = [];

    for (const item of input.items) {
      const prodDoc = await db.collection("products").doc(item.productId).get();
      if (!prodDoc.exists) {
        throw new HttpsError("not-found", `Product "${item.productId}" not found.`);
      }
      const prodData = prodDoc.data() as ProductDoc;

      totalRefundAmount += item.refundAmount;

      processedItems.push({
        productId: item.productId,
        nameSnapshot: prodData.name,
        quantity: item.quantity,
        unit: prodData.baseUnit,
        priceSnapshot: prodData.sellingPrice,
        refundAmount: item.refundAmount,
        reason: item.reason,
        disposition: item.disposition,
      });

      // Stock adjustment for restocked items
      if (item.disposition === ReturnDisposition.RESTOCKED_TO_INVENTORY) {
        // Sales return: item put back into stock (+ quantity)
        // Purchase return: item returned back to vendor (- quantity)
        const qtyChange = input.returnType === ReturnType.SALES_RETURN ? Math.abs(item.quantity) : -Math.abs(item.quantity);
        const movType = input.returnType === ReturnType.SALES_RETURN 
          ? StockMovementType.SALE_RETURN_IN 
          : StockMovementType.PURCHASE_RETURN_OUT;

        stockChangeItems.push({
          productId: item.productId,
          quantity: qtyChange,
          type: movType,
          unit: prodData.baseUnit || "piece",
          referenceId: returnId,
          referenceModel: "return",
          reason: `${input.returnType === ReturnType.SALES_RETURN ? "Sales" : "Purchase"} return ${returnId}`,
        });
      }
    }

    const callerUid = request.auth.uid;
    const finalResult = await db.runTransaction(async (txn) => {
      // === PHASE 1: ALL READS FIRST (Firestore requirement) ===
      const returnReservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: input.organizationId,
        type: "RET",
      });

      let preparedStock = null;
      if (stockChangeItems.length > 0) {
        preparedStock = await prepareStockChangesInTxn(txn, {
          organizationId: input.organizationId,
          actorUid: callerUid,
          items: stockChangeItems,
        });
      }

      // === PHASE 2: ALL WRITES AFTER ALL READS ===
      commitDocumentNumberInTxn(txn, returnReservation);
      const returnNumber = returnReservation.formattedNumber;

      const returnDoc: ReturnDoc = {
        organizationId: input.organizationId,
        returnNumber,
        returnType: input.returnType,
        referenceId: input.referenceId,
        referenceNumber: parentNumber,
        partyId: input.partyId || null,
        partyName: input.partyName || undefined,
        items: processedItems,
        totalRefundAmount,
        refundMethod: input.refundMethod || "cash",
        status: "completed",
        notes: input.notes,
        createdAt: now,
        createdBy: callerUid,
      };

      txn.set(returnRef, returnDoc);

      // Apply stock restoration / return movements transactionally
      if (preparedStock) {
        commitStockChangesInTxn(txn, preparedStock);
      }

      return {
        returnId,
        organizationId: input.organizationId,
        returnNumber,
        totalRefundAmount,
        status: "completed",
        message: "Return processed successfully.",
      };
    });

    if (idempotency.recordId) {
      const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      await idempRef.update({
        status: "succeeded",
        result: finalResult,
        updatedAt: now,
      });
    }

    await createAuditLog({
      organizationId: input.organizationId,
      actorUid: request.auth.uid,
      action: "RETURN_PROCESSED",
      entityType: "return",
      entityId: returnId,
      details: {
        returnNumber: finalResult.returnNumber,
        referenceId: input.referenceId,
        totalRefundAmount,
      },
    });

    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_RETURN_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create return: ${(error as Error).message}`);
  }
});

export const returnsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListReturnsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("returns")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.returnType) {
    query = query.where("returnType", "==", input.returnType);
  }
  if (input.referenceId) {
    query = query.where("referenceId", "==", input.referenceId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    returnId: doc.id,
    ...(doc.data() as ReturnDoc),
  }));

  return { items, count: items.length };
});
