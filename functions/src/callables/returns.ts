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
import {
  ReturnDoc,
  ReturnItem,
  BillDoc,
  OutflowDoc,
  CustomerDoc,
  VendorDoc,
} from "../types/models.js";
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
import { verifyTenantAccess, resolveBranchContext } from "../services/tenantContext.js";

export const returnsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateReturnSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const orgId = await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: orgId,
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
    const callerUid = request.auth.uid;

    const finalResult = await db.runTransaction(async (txn) => {
      // === STEP 1: ALL TRANSACTIONAL READS FIRST (Firestore transactional rule) ===
      const returnReservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: orgId,
        type: "RET",
      });

      let parentNumber = "";
      let parentBillDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      let parentOutflowDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      let billData: BillDoc | null = null;
      let outflowData: OutflowDoc | null = null;
      let customerRef: FirebaseFirestore.DocumentReference | null = null;
      let customerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      let vendorRef: FirebaseFirestore.DocumentReference | null = null;
      let vendorSnap: FirebaseFirestore.DocumentSnapshot | null = null;

      if (input.returnType === ReturnType.SALES_RETURN) {
        const billRef = db.collection("bills").doc(input.referenceId);
        parentBillDoc = await txn.get(billRef);
        if (!parentBillDoc.exists) {
          throw new HttpsError("not-found", `Referenced Bill "${input.referenceId}" not found.`);
        }
        billData = parentBillDoc.data() as BillDoc;
        if (billData.organizationId !== orgId) {
          throw new HttpsError("permission-denied", "Cross-tenant reference rejected.");
        }
        if (billData.status === "voided") {
          throw new HttpsError("failed-precondition", "Cannot return items from a voided bill.");
        }
        if (billData.status === "draft") {
          throw new HttpsError("failed-precondition", "Cannot return items from an unfinalized draft bill.");
        }
        parentNumber = billData.billNumber;

        const custId = input.partyId || billData.customerId;
        if (custId && input.refundMethod === "credit_note") {
          customerRef = db.collection("customers").doc(custId);
          customerSnap = await txn.get(customerRef);
        }
      } else {
        const outflowRef = db.collection("outflows").doc(input.referenceId);
        parentOutflowDoc = await txn.get(outflowRef);
        if (!parentOutflowDoc.exists) {
          throw new HttpsError("not-found", `Referenced Outflow "${input.referenceId}" not found.`);
        }
        outflowData = parentOutflowDoc.data() as OutflowDoc;
        if (outflowData.organizationId !== orgId) {
          throw new HttpsError("permission-denied", "Cross-tenant reference rejected.");
        }
        if (outflowData.status === "voided") {
          throw new HttpsError("failed-precondition", "Cannot return items from a voided outflow.");
        }
        parentNumber = outflowData.outflowNumber;

        const vendId = input.partyId || outflowData.vendorId;
        if (vendId && input.refundMethod === "credit_note") {
          vendorRef = db.collection("vendors").doc(vendId);
          vendorSnap = await txn.get(vendorRef);
        }
      }

      // Line item validation against parent document and remaining quantity checks
      let totalRefundAmount = 0;
      const processedItems: ReturnItem[] = [];
      const stockChangeItems: StockChangeItem[] = [];

      for (const item of input.items) {
        let nameSnapshot = "";
        let priceSnapshot = 0;
        let costSnapshot = 0;
        let baseUnit = "piece";

        if (input.returnType === ReturnType.SALES_RETURN && billData) {
          const originalLine = billData.items.find((bi) => bi.productId === item.productId);
          if (!originalLine) {
            throw new HttpsError("invalid-argument", `Product "${item.productId}" was not part of this bill.`);
          }
          const alreadyReturned = originalLine.returnedQty || 0;
          const remainingQty = originalLine.quantity - alreadyReturned;
          if (item.quantity > remainingQty) {
            throw new HttpsError(
              "invalid-argument",
              `Cannot return ${item.quantity} units of "${originalLine.nameSnapshot}". Only ${remainingQty} units remain returnable.`
            );
          }
          nameSnapshot = originalLine.nameSnapshot;
          priceSnapshot = originalLine.priceSnapshot;
          costSnapshot = originalLine.costSnapshot !== undefined ? originalLine.costSnapshot : 0;
          baseUnit = originalLine.unit || "piece";
          originalLine.returnedQty = alreadyReturned + item.quantity;
        } else if (input.returnType === ReturnType.PURCHASE_RETURN && outflowData) {
          const originalLine = outflowData.lines.find((line) => line.productId === item.productId);
          if (!originalLine) {
            throw new HttpsError("invalid-argument", `Product "${item.productId}" was not part of this purchase.`);
          }
          const alreadyReturned = originalLine.returnedQty || 0;
          const remainingQty = originalLine.quantity - alreadyReturned;
          if (item.quantity > remainingQty) {
            throw new HttpsError(
              "invalid-argument",
              `Cannot return ${item.quantity} units of "${originalLine.itemName}". Only ${remainingQty} units remain returnable.`
            );
          }
          nameSnapshot = originalLine.itemName;
          priceSnapshot = originalLine.unitPrice;
          costSnapshot = originalLine.unitPrice;
          baseUnit = originalLine.unit || "piece";
          originalLine.returnedQty = alreadyReturned + item.quantity;
        }

        totalRefundAmount += item.refundAmount;

        processedItems.push({
          productId: item.productId,
          nameSnapshot,
          quantity: item.quantity,
          unit: baseUnit,
          priceSnapshot,
          costSnapshot,
          refundAmount: item.refundAmount,
          reason: item.reason,
          disposition: item.disposition,
        });

        if (item.disposition === ReturnDisposition.RESTOCKED_TO_INVENTORY) {
          const qtyChange = input.returnType === ReturnType.SALES_RETURN
            ? Math.abs(item.quantity)
            : -Math.abs(item.quantity);
          const movType = input.returnType === ReturnType.SALES_RETURN
            ? StockMovementType.SALE_RETURN_IN
            : StockMovementType.PURCHASE_RETURN_OUT;

          stockChangeItems.push({
            productId: item.productId,
            quantity: qtyChange,
            type: movType,
            unit: baseUnit,
            referenceId: returnId,
            referenceModel: "return",
            reason: `${input.returnType === ReturnType.SALES_RETURN ? "Sales" : "Purchase"} return ${returnId}`,
          });
        }
      }

      let preparedStock = null;
      const branchId = await resolveBranchContext(
        request.auth!,
        orgId,
        input.branchId || billData?.branchId || outflowData?.branchId
      );

      if (stockChangeItems.length > 0) {
        preparedStock = await prepareStockChangesInTxn(txn, {
          organizationId: orgId,
          branchId,
          actorUid: callerUid,
          items: stockChangeItems,
        });
      }

      // === STEP 2: ALL TRANSACTIONAL WRITES ===
      commitDocumentNumberInTxn(txn, returnReservation);
      const returnNumber = returnReservation.formattedNumber;

      const returnDoc: ReturnDoc = {
        organizationId: orgId,
        branchId,
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

      if (preparedStock) {
        commitStockChangesInTxn(txn, preparedStock);
      }

      if (billData && parentBillDoc) {
        txn.update(parentBillDoc.ref, {
          items: billData.items,
          updatedAt: now,
        });
      } else if (outflowData && parentOutflowDoc) {
        txn.update(parentOutflowDoc.ref, {
          lines: outflowData.lines,
          updatedAt: now,
        });
      }

      if (customerRef && customerSnap && customerSnap.exists) {
        const custData = customerSnap.data() as CustomerDoc;
        const currentBal = custData.outstandingBalance || 0;
        const newBal = Math.max(0, currentBal - totalRefundAmount);
        txn.update(customerRef, {
          outstandingBalance: newBal,
          updatedAt: now,
        });
      }

      if (vendorRef && vendorSnap && vendorSnap.exists) {
        const vendData = vendorSnap.data() as VendorDoc;
        const currentPayable = vendData.outstandingPayable || 0;
        const newPayable = Math.max(0, currentPayable - totalRefundAmount);
        txn.update(vendorRef, {
          outstandingPayable: newPayable,
          updatedAt: now,
        });
      }

      return {
        returnId,
        organizationId: orgId,
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
      organizationId: orgId,
      actorUid: request.auth.uid,
      action: "RETURN_PROCESSED",
      entityType: "return",
      entityId: returnId,
      details: {
        returnNumber: finalResult.returnNumber,
        referenceId: input.referenceId,
        totalRefundAmount: finalResult.totalRefundAmount,
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

  const orgId = await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("returns")
    .where("organizationId", "==", orgId)
    .limit(input.limit || 50);

  if (input.returnType) {
    query = query.where("returnType", "==", input.returnType);
  }
  if (input.referenceId) {
    query = query.where("referenceId", "==", input.referenceId);
  }
  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    returnId: doc.id,
    ...(doc.data() as ReturnDoc),
  }));

  return { items, count: items.length };
});
