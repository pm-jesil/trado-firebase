/**
 * Payments Ledger Callables
 * 
 * Strict architectural rule:
 * - Standalone collection `payments`
 * - References `referenceId` (billId or outflowId) by ID only
 * - Records inbound collections (from customers) and outbound vouchers (to vendors)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreatePaymentSchema,
  ListPaymentsSchema,
} from "../validation/schemas.js";
import { PaymentDoc, MembershipDoc, BillDoc, OutflowDoc, CustomerDoc, VendorDoc } from "../types/models.js";
import { Money } from "../services/money.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const paymentsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreatePaymentSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "payments.create",
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
    const paymentRef = db.collection("payments").doc();
    const paymentId = paymentRef.id;
    const now = new Date().toISOString();
    const callerUid = request.auth.uid;
    const branchId = input.branchId || (request.auth.token.primaryBranchId as string) || "main-branch";

    const finalResult = await db.runTransaction(async (txn) => {
      // === STEP 1: ALL TRANSACTIONAL READS FIRST ===
      const paymentReservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: input.organizationId,
        type: "PAY",
      });

      let billRef = null;
      let billSnap = null;
      if (input.referenceModel === "bill" && input.referenceId) {
        billRef = db.collection("bills").doc(input.referenceId);
        billSnap = await txn.get(billRef);
      }

      let outflowRef = null;
      let outflowSnap = null;
      if (input.referenceModel === "outflow" && input.referenceId) {
        outflowRef = db.collection("outflows").doc(input.referenceId);
        outflowSnap = await txn.get(outflowRef);
      }

      let custRef = null;
      let custSnap = null;
      if (input.partyType === "customer" && input.partyId) {
        custRef = db.collection("customers").doc(input.partyId);
        custSnap = await txn.get(custRef);
      }

      let vendRef = null;
      let vendSnap = null;
      if (input.partyType === "vendor" && input.partyId) {
        vendRef = db.collection("vendors").doc(input.partyId);
        vendSnap = await txn.get(vendRef);
      }

      // === STEP 2: ALL TRANSACTIONAL WRITES ===
      commitDocumentNumberInTxn(txn, paymentReservation);
      const paymentNumber = paymentReservation.formattedNumber;

      const paymentDoc: PaymentDoc = {
        organizationId: input.organizationId,
        branchId,
        paymentNumber,
        direction: input.direction,
        partyType: input.partyType,
        partyId: input.partyId || null,
        partyName: input.partyName.trim(),
        amount: input.amount,
        method: input.method,
        referenceId: input.referenceId || null,
        referenceModel: input.referenceModel || null,
        notes: input.notes,
        status: "completed",
        createdAt: now,
        createdBy: callerUid,
      };

      txn.set(paymentRef, paymentDoc);

      // Settle linked Bill if applicable
      if (billRef && billSnap && billSnap.exists) {
        const bData = billSnap.data() as BillDoc;
        const newPaid = Money.amount((bData.paidAmount || 0) + input.amount);
        const newBal = Money.amount(Math.max(0, bData.totalAmount - newPaid));
        const newStatus = newBal <= 0 ? "paid" : "partial";
        txn.update(billRef, {
          paidAmount: newPaid,
          balanceAmount: newBal,
          paymentStatus: newStatus,
          updatedAt: now,
        });
      }

      // Settle linked Outflow if applicable
      if (outflowRef && outflowSnap && outflowSnap.exists) {
        const oData = outflowSnap.data() as OutflowDoc;
        const newPaid = Money.amount((oData.paidAmount || 0) + input.amount);
        const newBal = Money.amount(Math.max(0, oData.totalAmount - newPaid));
        const newStatus = newBal <= 0 ? "paid" : "partial";
        txn.update(outflowRef, {
          paidAmount: newPaid,
          balanceAmount: newBal,
          paymentStatus: newStatus,
          updatedAt: now,
        });
      }

      // Recalculate customer receivable balance
      if (custRef && custSnap && custSnap.exists) {
        const cData = custSnap.data() as CustomerDoc;
        const currentBal = cData.outstandingBalance || 0;
        const newBal = Money.amount(Math.max(0, currentBal - input.amount));
        txn.update(custRef, {
          outstandingBalance: newBal,
          updatedAt: now,
        });
      }

      // Recalculate vendor payable balance
      if (vendRef && vendSnap && vendSnap.exists) {
        const vData = vendSnap.data() as VendorDoc;
        const currentPayable = vData.outstandingPayable || 0;
        const newPayable = Money.amount(Math.max(0, currentPayable - input.amount));
        txn.update(vendRef, {
          outstandingPayable: newPayable,
          updatedAt: now,
        });
      }

      return {
        paymentId,
        organizationId: input.organizationId,
        paymentNumber,
        amount: input.amount,
        direction: input.direction,
        status: "completed",
        message: "Payment entry recorded successfully.",
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
      action: "PAYMENT_RECORDED",
      entityType: "payment",
      entityId: paymentId,
      details: {
        paymentNumber: finalResult.paymentNumber,
        amount: input.amount,
        direction: input.direction,
      },
    });

    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_PAYMENT_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create payment: ${(error as Error).message}`);
  }
});

export const paymentsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListPaymentsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("payments")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.direction) {
    query = query.where("direction", "==", input.direction);
  }
  if (input.partyId) {
    query = query.where("partyId", "==", input.partyId);
  }
  if (input.referenceId) {
    query = query.where("referenceId", "==", input.referenceId);
  }
  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    paymentId: doc.id,
    ...(doc.data() as PaymentDoc),
  }));

  return { items, count: items.length };
});
