/**
 * Payment Processing Charges & Fees Callables (Section 9, GAP-FEE-01)
 * 
 * Provides:
 * - paymentsRecordFee: Manually records processing charges linked to original sale/payment
 * - paymentsListFees: Lists processing fees filtered by bill, payment, or branch
 * - paymentsGetFee: Single processing fee retrieval
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  RecordPaymentFeeSchema,
  ListPaymentFeesSchema,
  GetPaymentFeeSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  PaymentProcessingFeeDoc,
  BillDoc,
  PaymentDoc,
} from "../types/models.js";
import { Money } from "../services/money.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";

export const paymentsRecordFee = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(RecordPaymentFeeSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_FEE_MANAGE,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "payments.recordFee",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  const feeRef = db.collection("paymentProcessingFees").doc();
  const feeId = feeRef.id;

  const result = await db.runTransaction(async (txn) => {
    // 1. Transactional Reads
    let grossAmount = 0;
    let branchId = input.branchId || null;

    if (input.sourceDocumentType === "bill") {
      const billRef = db.collection("bills").doc(input.sourceDocumentId);
      const billSnap = await txn.get(billRef);
      if (!billSnap.exists) {
        throw new HttpsError("not-found", `Source bill "${input.sourceDocumentId}" not found.`);
      }
      const bill = billSnap.data() as BillDoc;
      if (bill.organizationId !== orgId) {
        throw new HttpsError("permission-denied", "Cross-tenant document reference rejected.");
      }
      grossAmount = bill.totalAmount;
      branchId = branchId || bill.branchId || null;
    } else {
      const paymentRef = db.collection("payments").doc(input.sourceDocumentId);
      const paymentSnap = await txn.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new HttpsError("not-found", `Source payment "${input.sourceDocumentId}" not found.`);
      }
      const payment = paymentSnap.data() as PaymentDoc;
      if (payment.organizationId !== orgId) {
        throw new HttpsError("permission-denied", "Cross-tenant document reference rejected.");
      }
      grossAmount = payment.amount;
      branchId = branchId || payment.branchId || null;
    }

    const feeAmount = Money.amount(input.feeAmount, "INR");
    const feeTaxAmount = input.feeTaxAmount ? Money.amount(input.feeTaxAmount, "INR") : 0;
    const totalFeeDeduction = feeAmount + feeTaxAmount;

    if (totalFeeDeduction > grossAmount) {
      throw new HttpsError("invalid-argument", `Fee (${totalFeeDeduction}) cannot exceed transaction gross amount (${grossAmount}).`);
    }

    const netSettlementAmount = grossAmount - totalFeeDeduction;

    // Reserve document number
    const reservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "FEE",
    });

    // Prepare ledger entry (deducts fee from clearing/settlement account)
    const prep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: input.financialAccountId,
      branchId,
      type: "processing_fee",
      direction: "out",
      amount: totalFeeDeduction,
      sourceDocumentType: "fee",
      sourceDocumentId: feeId,
      description: `Payment processing fee for ${input.sourceDocumentType} ${input.sourceDocumentId} (${reservation.formattedNumber})`,
      actorUid: callerUid,
      now,
    });

    // 2. Transactional Writes
    commitDocumentNumberInTxn(txn, reservation);
    const feeNumber = reservation.formattedNumber;

    const ledgerResult = applyAccountTransactionInTxn(txn, prep, {
      organizationId: orgId,
      financialAccountId: input.financialAccountId,
      branchId,
      type: "processing_fee",
      direction: "out",
      amount: totalFeeDeduction,
      sourceDocumentType: "fee",
      sourceDocumentId: feeId,
      description: `Payment processing fee for ${input.sourceDocumentType} ${input.sourceDocumentId} (${feeNumber})`,
      actorUid: callerUid,
      now,
    });

    const feeDoc: PaymentProcessingFeeDoc = {
      organizationId: orgId,
      branchId,
      feeNumber,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      paymentId: input.paymentId || (input.sourceDocumentType === "payment" ? input.sourceDocumentId : null),
      financialAccountId: input.financialAccountId,
      feeExpenseCategoryId: input.feeExpenseCategoryId || null,
      paymentMethod: input.paymentMethod,
      grossAmount,
      feeAmount,
      feeTaxAmount,
      netSettlementAmount,
      settlementTiming: input.settlementTiming,
      settlementReference: input.settlementReference || undefined,
      accountTransactionId: ledgerResult.transactionId,
      notes: input.notes || undefined,
      createdAt: now,
      createdBy: callerUid,
    };

    txn.set(feeRef, feeDoc);

    return {
      feeId,
      feeNumber,
      grossAmount,
      feeAmount,
      feeTaxAmount,
      netSettlementAmount,
      accountTransactionId: ledgerResult.transactionId,
      balanceAfter: ledgerResult.balanceAfter,
      message: "Payment processing fee recorded successfully.",
    };
  });

  return result;
});

export const paymentsListFees = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListPaymentFeesSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_VIEW,
  });

  const orgId = ctx.organizationId;
  let query: FirebaseFirestore.Query = db
    .collection("paymentProcessingFees")
    .where("organizationId", "==", orgId);

  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.sourceDocumentId) {
    query = query.where("sourceDocumentId", "==", input.sourceDocumentId);
  }
  if (input.paymentId) {
    query = query.where("paymentId", "==", input.paymentId);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "paymentProcessingFees",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    feeId: doc.id,
    ...(doc.data() as PaymentProcessingFeeDoc),
  }));

  return {
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

export const paymentsGetFee = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetPaymentFeeSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_VIEW,
  });

  const feeRef = db.collection("paymentProcessingFees").doc(input.feeId);
  const snap = await feeRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Payment processing fee record not found.");
  }

  const data = snap.data() as PaymentProcessingFeeDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return {
    fee: {
      feeId: snap.id,
      ...data,
    },
  };
});
