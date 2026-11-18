/**
 * Payment Processing Charges & Fees Callables (Section 9, GAP-FEE-01, Phase 1 Master Overhaul)
 * 
 * Provides:
 * - paymentsRecordFee: Manually records processing charges, links to original sale/payment, auto-creates expense outflow, computes expected & variance
 * - paymentsVerifyFee: Reconciles fee with statement, maker-checker rule enforced
 * - paymentsDisputeFee: Marks fee as disputed with reason
 * - paymentsReverseFee: Reverses ledger deduction and expense outflow
 * - paymentsListFees: Lists processing fees filtered by bill, payment, branch, account, status, highlight
 * - paymentsGetFee: Single processing fee retrieval
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  RecordPaymentFeeSchema,
  ListPaymentFeesSchema,
  GetPaymentFeeSchema,
  VerifyPaymentFeeSchema,
  DisputePaymentFeeSchema,
  ReversePaymentFeeSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  PaymentProcessingFeeDoc,
  PaymentFeeStatus,
  BillDoc,
  PaymentDoc,
  FinancialAccountDoc,
  OutflowDoc,
} from "../types/models.js";
import { OutflowKind, OutflowStatus, PaymentStatus } from "../constants/enums.js";
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
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_FEE_MANAGE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

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

    // Read Financial Account for feeRule
    const accountRef = db.collection("financialAccounts").doc(input.financialAccountId);
    const accountSnap = await txn.get(accountRef);
    if (!accountSnap.exists) {
      throw new HttpsError("not-found", `Financial account "${input.financialAccountId}" not found.`);
    }
    const account = accountSnap.data() as FinancialAccountDoc;
    if (account.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant financial account reference rejected.");
    }

    const currency = account.currency || "INR";
    const feeAmount = Money.amount(input.feeAmount, currency);
    const feeTaxAmount = input.feeTaxAmount ? Money.amount(input.feeTaxAmount, currency) : 0;
    const totalFeeDeduction = feeAmount + feeTaxAmount;

    if (totalFeeDeduction > grossAmount) {
      throw new HttpsError(
        "invalid-argument",
        `Fee (${totalFeeDeduction}) cannot exceed transaction gross amount (${grossAmount}).`
      );
    }

    const netSettlementAmount = grossAmount - totalFeeDeduction;

    // Compute expected fee using account fee rule if configured
    let expectedFeeAmount = totalFeeDeduction;
    if (account.feeRule) {
      const fixed = account.feeRule.feeFixed ?? 0;
      const pct = account.feeRule.feePercent ?? 0;
      const taxPct = account.feeRule.feeTaxPercent ?? 0;
      const baseFee = fixed + Math.round((grossAmount * pct) / 100);
      const feeTax = Math.round((baseFee * taxPct) / 100);
      expectedFeeAmount = Money.amount(baseFee + feeTax, currency);
    }

    const varianceAmount = Money.amount(totalFeeDeduction - expectedFeeAmount, currency);

    // Initial status & highlight
    const status: PaymentFeeStatus =
      varianceAmount === 0 ? "verified" : "pending_verification";
    const highlight: "green" | "amber" | "red" =
      varianceAmount === 0 ? "green" : "amber";

    // Reserve document numbers: FEE and EXP
    const reservationFee = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "FEE",
    });

    const reservationExp = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "EXP",
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
      description: `Payment processing fee for ${input.sourceDocumentType} ${input.sourceDocumentId} (${reservationFee.formattedNumber})`,
      actorUid: callerUid,
      now,
    });

    // 2. Transactional Writes
    commitDocumentNumberInTxn(txn, reservationFee);
    commitDocumentNumberInTxn(txn, reservationExp);
    const feeNumber = reservationFee.formattedNumber;
    const expNumber = reservationExp.formattedNumber;

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

    // Auto-create expense outflow doc in `outflows`
    const expenseRef = db.collection("outflows").doc();
    const expenseDoc: OutflowDoc = {
      organizationId: orgId,
      branchId: branchId || undefined,
      financialAccountId: input.financialAccountId,
      outflowNumber: expNumber,
      kind: OutflowKind.EXPENSE,
      status: OutflowStatus.CONFIRMED,
      docDate: now,
      payeeType: "other",
      payee: "Payment Gateway / Processor",
      expenseCategoryId: input.feeExpenseCategoryId || "payment_processing_fees",
      lines: [
        {
          lineId: "L1",
          itemName: "Payment processing fee",
          quantity: 1,
          unit: "unit",
          unitPrice: totalFeeDeduction,
          grossAmount: totalFeeDeduction,
          discountAmount: 0,
          taxAmount: feeTaxAmount,
          lineTotal: totalFeeDeduction,
          addToStock: false,
        },
      ],
      subTotal: feeAmount,
      discountTotal: 0,
      taxTotal: feeTaxAmount,
      totalAmount: totalFeeDeduction,
      paidAmount: totalFeeDeduction,
      balanceAmount: 0,
      paymentStatus: PaymentStatus.PAID,
      notes: input.notes || `Auto-created expense for fee ${feeNumber}`,
      createdAt: now,
      createdBy: callerUid,
    };
    txn.set(expenseRef, expenseDoc);

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
      status,
      isManualEntry: true,
      enteredBy: callerUid,
      expectedFeeAmount,
      varianceAmount,
      settlementDate: now.substring(0, 10),
      highlight,
      expenseOutflowId: expenseRef.id,
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
      expenseOutflowId: expenseRef.id,
      status,
      expectedFeeAmount,
      varianceAmount,
      highlight,
      message: "Payment processing fee recorded successfully.",
    };
  });

  return result;
});

export const paymentsVerifyFee = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(VerifyPaymentFeeSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_FEE_VERIFY,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  return await db.runTransaction(async (txn) => {
    const feeRef = db.collection("paymentProcessingFees").doc(input.feeId);
    const snap = await txn.get(feeRef);

    if (!snap.exists) {
      throw new HttpsError("not-found", `Payment fee "${input.feeId}" not found.`);
    }

    const data = snap.data() as PaymentProcessingFeeDoc;
    if (data.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }

    // Maker-checker rule: cannot verify fee entered by yourself unless superadmin
    if (data.enteredBy === callerUid && !ctx.isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Maker-checker rule violation: cannot verify payment fee entered by yourself."
      );
    }

    if (data.status === "verified") {
      throw new HttpsError("failed-precondition", "Payment fee is already verified.");
    }
    if (data.status === "reversed") {
      throw new HttpsError("failed-precondition", "Cannot verify a reversed fee.");
    }

    txn.update(feeRef, {
      status: "verified" as PaymentFeeStatus,
      verifiedBy: callerUid,
      verifiedAt: now,
      highlight: "green",
      settlementDate: input.settlementDate || data.settlementDate || now.substring(0, 10),
      settlementReference: input.settlementReference || data.settlementReference,
      notes: input.notes ? (data.notes ? `${data.notes}\n${input.notes}` : input.notes) : data.notes,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      feeId: input.feeId,
      status: "verified",
      verifiedBy: callerUid,
      verifiedAt: now,
      message: "Payment processing fee verified successfully.",
    };
  });
});

export const paymentsDisputeFee = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(DisputePaymentFeeSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_FEE_MANAGE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  return await db.runTransaction(async (txn) => {
    const feeRef = db.collection("paymentProcessingFees").doc(input.feeId);
    const snap = await txn.get(feeRef);

    if (!snap.exists) {
      throw new HttpsError("not-found", `Payment fee "${input.feeId}" not found.`);
    }

    const data = snap.data() as PaymentProcessingFeeDoc;
    if (data.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }

    if (data.status === "reversed") {
      throw new HttpsError("failed-precondition", "Cannot dispute a reversed fee.");
    }

    txn.update(feeRef, {
      status: "disputed" as PaymentFeeStatus,
      disputeReason: input.reason,
      highlight: "red",
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      feeId: input.feeId,
      status: "disputed",
      disputeReason: input.reason,
      message: "Payment processing fee marked as disputed.",
    };
  });
});

export const paymentsReverseFee = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReversePaymentFeeSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_FEE_MANAGE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  return await db.runTransaction(async (txn) => {
    const feeRef = db.collection("paymentProcessingFees").doc(input.feeId);
    const snap = await txn.get(feeRef);

    if (!snap.exists) {
      throw new HttpsError("not-found", `Payment fee "${input.feeId}" not found.`);
    }

    const data = snap.data() as PaymentProcessingFeeDoc;
    if (data.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }

    if (data.status === "reversed") {
      throw new HttpsError("failed-precondition", "Payment fee has already been reversed.");
    }

    const totalFee = data.feeAmount + (data.feeTaxAmount || 0);

    // Read associated Outflow expense doc if exists (ALL READS BEFORE WRITES)
    let expenseRef: FirebaseFirestore.DocumentReference | null = null;
    let expenseExists = false;
    if (data.expenseOutflowId) {
      expenseRef = db.collection("outflows").doc(data.expenseOutflowId);
      const expSnap = await txn.get(expenseRef);
      expenseExists = expSnap.exists;
    }

    // 1. Ledger Reversal: Credit the fee back into the financial account
    const prep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: data.financialAccountId,
      branchId: data.branchId || null,
      type: "reversal",
      direction: "in",
      amount: totalFee,
      sourceDocumentType: "fee",
      sourceDocumentId: input.feeId,
      description: `Reversal of fee ${data.feeNumber}: ${input.reason}`,
      actorUid: callerUid,
      now,
    });

    // 2. Transactional Writes
    const ledgerResult = applyAccountTransactionInTxn(txn, prep, {
      organizationId: orgId,
      financialAccountId: data.financialAccountId,
      branchId: data.branchId || null,
      type: "reversal",
      direction: "in",
      amount: totalFee,
      sourceDocumentType: "fee",
      sourceDocumentId: input.feeId,
      description: `Reversal of fee ${data.feeNumber}: ${input.reason}`,
      actorUid: callerUid,
      now,
    });

    if (expenseRef && expenseExists) {
      txn.update(expenseRef, {
        status: OutflowStatus.VOIDED,
        notes: `Voided via fee reversal (${input.feeId}): ${input.reason}`,
        updatedAt: now,
        updatedBy: callerUid,
      });
    }

    // 3. Update Fee doc to reversed
    txn.update(feeRef, {
      status: "reversed" as PaymentFeeStatus,
      reversalReason: input.reason,
      highlight: "red",
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      feeId: input.feeId,
      status: "reversed",
      balanceAfter: ledgerResult.balanceAfter,
      message: "Payment fee and associated expense reversed successfully.",
    };
  });
});

export const paymentsListFees = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListPaymentFeesSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

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
  if (input.financialAccountId) {
    query = query.where("financialAccountId", "==", input.financialAccountId);
  }
  if (input.status) {
    query = query.where("status", "==", input.status);
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

  let items = snapshot.docs.map((doc) => ({
    feeId: doc.id,
    ...(doc.data() as PaymentProcessingFeeDoc),
  }));

  if (input.highlight === "needs_review") {
    items = items.filter((f) => f.highlight === "amber" || f.highlight === "red");
  }

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
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYMENT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

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
