/**
 * Payments Ledger Callables
 * 
 * Strict architectural rule:
 * - Standalone collection `payments`
 * - References `referenceId` (billId or outflowId) by ID only
 * - Records inbound collections (from customers) and outbound vouchers (to vendors)
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreatePaymentSchema,
  ListPaymentsSchema,
  VoidPaymentSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { PaymentDoc, BillDoc, OutflowDoc, CustomerDoc, VendorDoc } from "../types/models.js";
import { Money } from "../services/money.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import { hydrate } from "../services/hydration.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext, resolveDataScope, applyDataScope } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";

/** Rejects references to documents of another organization. */
function assertSameOrg(snap: FirebaseFirestore.DocumentSnapshot | null, orgId: string, label: string): void {
  if (snap && snap.exists && snap.data()?.organizationId !== orgId) {
    throw new HttpsError("permission-denied", `Cross-tenant ${label} reference rejected.`);
  }
  if (snap && !snap.exists) {
    throw new HttpsError("not-found", `Referenced ${label} not found.`);
  }
}

export const paymentsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreatePaymentSchema, request.data);
  if (input.partyName && (input.partyId || input.referenceId)) {
    throw new HttpsError("invalid-argument", "[REFERENCE_ATTRIBUTE_COPY] partyName is only for a standalone payment; a referenced party or document is resolved by id.", { reason: "REFERENCE_ATTRIBUTE_COPY" });
  }
  if (!input.partyName && !input.partyId && !input.referenceId) {
    throw new HttpsError("invalid-argument", "A standalone payment needs partyName, partyId or referenceId.");
  }

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.PAYMENT_CREATE });
  const orgId = ctx.organizationId;
  const branchId = ctx.branchId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "payments.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
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
    const callerUid = ctx.callerUid;

    const finalResult = await db.runTransaction(async (txn) => {
      // === STEP 1: ALL TRANSACTIONAL READS FIRST ===
      const paymentReservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: orgId,
        type: "PAY",
      });

      let accountPrep = null;
      if (input.financialAccountId) {
        accountPrep = await prepareAccountTransactionInTxn(txn, {
          organizationId: orgId,
          financialAccountId: input.financialAccountId,
          branchId,
          type: input.direction === "in" ? "customer_payment" : "vendor_payment",
          direction: input.direction,
          amount: input.amount,
          sourceDocumentType: "payment",
          sourceDocumentId: paymentId,
          actorUid: callerUid,
          now,
        });
      }

      const allocatedDocSnaps: Array<{
        ref: FirebaseFirestore.DocumentReference;
        snap: FirebaseFirestore.DocumentSnapshot;
        type: "bill" | "outflow";
        amount: number;
      }> = [];
      if (input.allocations && input.allocations.length > 0) {
        let totalAllocated = 0;
        for (const alloc of input.allocations) {
          totalAllocated = Money.amount(totalAllocated + alloc.amount);
          const docRef = db.collection(alloc.documentType === "bill" ? "bills" : "outflows").doc(alloc.documentId);
          const docSnap = await txn.get(docRef);
          assertSameOrg(docSnap, orgId, alloc.documentType);
          const docData = docSnap.data() as BillDoc | OutflowDoc;
          const openStatus = alloc.documentType === "bill" ? (docData as BillDoc).status === "active" : (docData as OutflowDoc).status === "confirmed";
          if (!openStatus) {
            throw new HttpsError("failed-precondition", `Cannot allocate payment against ${alloc.documentType} in status "${docData.status}".`);
          }
          if (alloc.amount > Money.amount(docData.balanceAmount || 0) + 0.005) {
            throw new HttpsError("invalid-argument", `Allocation ${alloc.amount} exceeds open balance ${docData.balanceAmount} on ${alloc.documentType} ${alloc.documentId}.`);
          }
          allocatedDocSnaps.push({ ref: docRef, snap: docSnap, type: alloc.documentType, amount: alloc.amount });
        }
        if (totalAllocated > input.amount + 0.005) {
          throw new HttpsError("invalid-argument", `Sum of allocations (${totalAllocated}) exceeds payment amount (${input.amount}).`);
        }
      }

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

      assertSameOrg(billSnap, orgId, "bill");
      assertSameOrg(outflowSnap, orgId, "outflow");

      // The party of a document payment is the document's own party (never a second, divergent copy)
      const docParty = billSnap?.exists ? ((billSnap.data() as BillDoc).customerId || null)
        : outflowSnap?.exists ? ((outflowSnap.data() as OutflowDoc).vendorId || null) : undefined;
      if (billSnap && input.partyType !== "customer") {
        throw new HttpsError("invalid-argument", "A bill payment's partyType must be customer.");
      }
      if (input.partyId && docParty !== undefined && input.partyId !== docParty) {
        throw new HttpsError("invalid-argument", "[REFERENCE_MISMATCH] partyId differs from the referenced document's party.", { reason: "REFERENCE_MISMATCH" });
      }
      const partyId = input.partyId || docParty || null;

      let custRef = null;
      let custSnap = null;
      if (input.partyType === "customer" && partyId) {
        custRef = db.collection("customers").doc(partyId);
        custSnap = await txn.get(custRef);
      }

      let vendRef = null;
      let vendSnap = null;
      if (input.partyType === "vendor" && partyId) {
        vendRef = db.collection("vendors").doc(partyId);
        vendSnap = await txn.get(vendRef);
      }

      assertSameOrg(custSnap, orgId, "customer");
      assertSameOrg(vendSnap, orgId, "vendor");

      // Settlement guards: only active/confirmed documents, never beyond the open balance
      const settled = (billSnap?.data() as BillDoc | undefined) || (outflowSnap?.data() as OutflowDoc | undefined);
      if (settled) {
        const openStatus = billSnap ? (settled as BillDoc).status === "active" : (settled as OutflowDoc).status === "confirmed";
        if (!openStatus) {
          throw new HttpsError("failed-precondition", `Cannot record a payment against a document in status "${settled.status}".`);
        }
        if (input.amount > Money.amount(settled.balanceAmount || 0) + 0.005) {
          throw new HttpsError("invalid-argument", `Payment ${input.amount} exceeds the open balance ${settled.balanceAmount}.`);
        }
      }

      // === STEP 2: ALL TRANSACTIONAL WRITES ===
      commitDocumentNumberInTxn(txn, paymentReservation);
      const paymentNumber = paymentReservation.formattedNumber;

      if (accountPrep) {
        applyAccountTransactionInTxn(txn, accountPrep, {
          organizationId: orgId,
          financialAccountId: input.financialAccountId!,
          branchId,
          type: input.direction === "in" ? "customer_payment" : "vendor_payment",
          direction: input.direction,
          amount: input.amount,
          sourceDocumentType: "payment",
          sourceDocumentId: paymentId,
          partyType: (input.partyType === "customer" || input.partyType === "vendor") ? input.partyType : null,
          partyId,
          description: `Payment ${paymentNumber}`,
          actorUid: callerUid,
          now,
        });
      }

      const paymentDoc: PaymentDoc = {
        organizationId: orgId,
        branchId,
        paymentNumber,
        direction: input.direction,
        partyType: input.partyType,
        partyId,
        ...(input.partyName ? { partyName: input.partyName } : {}),
        amount: input.amount,
        method: input.method,
        referenceId: input.referenceId || null,
        referenceModel: input.referenceModel || null,
        ...(input.financialAccountId ? { financialAccountId: input.financialAccountId } : {}),
        ...(input.allocations ? { allocations: input.allocations } : {}),
        notes: input.notes,
        status: "completed",
        createdAt: now,
        createdBy: callerUid,
      };
      if (input.gateway) paymentDoc.gateway = input.gateway;

      txn.set(paymentRef, paymentDoc);

      // Settle multi-document allocations (GAP-FIN-04)
      for (const item of allocatedDocSnaps) {
        if (item.type === "bill") {
          const bData = item.snap.data() as BillDoc;
          const newPaid = Money.amount((bData.paidAmount || 0) + item.amount);
          const newBal = Money.amount(Math.max(0, bData.totalAmount - newPaid));
          const newStatus = newBal <= 0 ? "paid" : "partial";
          txn.update(item.ref, {
            paidAmount: newPaid,
            balanceAmount: newBal,
            paymentStatus: newStatus,
            updatedAt: now,
          });
        } else {
          const oData = item.snap.data() as OutflowDoc;
          const newPaid = Money.amount((oData.paidAmount || 0) + item.amount);
          const newBal = Money.amount(Math.max(0, oData.totalAmount - newPaid));
          const newStatus = newBal <= 0 ? "paid" : "partial";
          txn.update(item.ref, {
            paidAmount: newPaid,
            balanceAmount: newBal,
            paymentStatus: newStatus,
            updatedAt: now,
          });
        }
      }

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
        organizationId: orgId,
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


    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_PAYMENT_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create payment: ${(error as Error).message}`);
  }
});

// ---------------------------------------------------------------------------
// paymentsVoid: reverses a completed payment entry
// ---------------------------------------------------------------------------

export const paymentsVoid = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(VoidPaymentSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.PAYMENT_VOID });
  const orgId = ctx.organizationId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "payments.void",
    clientKey: input.idempotencyKey || `void_payment_${input.paymentId}`,
    payload: { paymentId: input.paymentId },
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const now = new Date().toISOString();
    const paymentRef = db.collection("payments").doc(input.paymentId);

    const result = await db.runTransaction(async (txn) => {
      // === READS ===
      const paySnap = await txn.get(paymentRef);
      if (!paySnap.exists) throw new HttpsError("not-found", "Payment not found.");
      const payment = paySnap.data() as PaymentDoc;
      if (payment.organizationId !== orgId) {
        throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
      }
      if (payment.status === "voided") {
        throw new HttpsError("failed-precondition", "Payment is already voided.");
      }

      // Reverse the settlement on the linked document (bill or outflow)
      let docRef: FirebaseFirestore.DocumentReference | null = null;
      let docSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (payment.referenceId && payment.referenceModel) {
        const collection = payment.referenceModel === "bill" ? "bills" : "outflows";
        docRef = db.collection(collection).doc(payment.referenceId);
        docSnap = await txn.get(docRef);
      }

      // Reverse party balance (customer receivable or vendor payable)
      let partyRef: FirebaseFirestore.DocumentReference | null = null;
      let partySnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (payment.partyId) {
        const partyCollection = payment.partyType === "customer" ? "customers" : "vendors";
        partyRef = db.collection(partyCollection).doc(payment.partyId);
        partySnap = await txn.get(partyRef);
      }

      // Reverse financial account balance and record ledger transaction
      let accountPrep = null;
      if (payment.financialAccountId) {
        accountPrep = await prepareAccountTransactionInTxn(txn, {
          organizationId: orgId,
          financialAccountId: payment.financialAccountId,
          branchId: payment.branchId,
          type: "reversal",
          direction: payment.direction === "in" ? "out" : "in",
          amount: payment.amount,
          sourceDocumentType: "payment",
          sourceDocumentId: paymentRef.id,
          description: `Void payment ${payment.paymentNumber}: ${input.reason}`,
          actorUid: ctx.callerUid,
        });
      }

      // === WRITES ===

      // 1. Mark payment as voided
      txn.update(paymentRef, {
        status: "voided",
        voidReason: input.reason,
        voidedAt: now,
        voidedBy: ctx.callerUid,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });

      // Apply financial account reversal
      if (accountPrep) {
        applyAccountTransactionInTxn(txn, accountPrep, {
          organizationId: orgId,
          financialAccountId: payment.financialAccountId!,
          branchId: payment.branchId,
          type: "reversal",
          direction: payment.direction === "in" ? "out" : "in",
          amount: payment.amount,
          sourceDocumentType: "payment",
          sourceDocumentId: paymentRef.id,
          description: `Void payment ${payment.paymentNumber}: ${input.reason}`,
          actorUid: ctx.callerUid,
        });
      }

      // 2. Reverse referenced document settlement
      let reversedDocumentId: string | null = null;
      if (docRef && docSnap?.exists) {
        const docData = docSnap.data() as BillDoc | OutflowDoc;
        // Only reverse if the document is still active/confirmed (not voided/cancelled itself)
        const docStatus = docData.status;
        const isActive = payment.referenceModel === "bill"
          ? docStatus === "active"
          : docStatus === "confirmed";
        if (isActive) {
          const newPaid = Money.amount(Math.max(0, (docData.paidAmount || 0) - payment.amount));
          const newBal = Money.amount(docData.totalAmount - newPaid);
          const newPaymentStatus = newPaid <= 0 ? "pending" : (newBal <= 0 ? "paid" : "partial");
          txn.update(docRef, {
            paidAmount: newPaid,
            balanceAmount: newBal,
            paymentStatus: newPaymentStatus,
            updatedAt: now,
          });
          reversedDocumentId = docSnap.id;
        }
      }

      // 3. Reverse party balance
      if (partyRef && partySnap?.exists) {
        if (payment.partyType === "customer") {
          const cust = partySnap.data() as CustomerDoc;
          // Voiding an inbound collection restores the customer's outstanding balance
          txn.update(partyRef, {
            outstandingBalance: Money.amount((cust.outstandingBalance || 0) + payment.amount),
            updatedAt: now,
          });
        } else if (payment.partyType === "vendor") {
          const vend = partySnap.data() as VendorDoc;
          // Voiding an outbound payment restores the vendor's outstanding payable
          txn.update(partyRef, {
            outstandingPayable: Money.amount((vend.outstandingPayable || 0) + payment.amount),
            updatedAt: now,
          });
        }
      }

      return {
        paymentId: paySnap.id,
        paymentNumber: payment.paymentNumber,
        status: "voided" as const,
        reversedDocumentId,
        message: `Payment ${payment.paymentNumber} voided successfully.`,
      };
    });

    if (idempotency.recordId) {
      await finalizeIdempotencySuccess(idempotency.recordId, result);
    }


    return result;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "VOID_PAYMENT_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to void payment: ${(error as Error).message}`);
  }
});

export const paymentsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListPaymentsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.PAYMENT_VIEW });
  const scope = await resolveDataScope(ctx, "payments", AppPermissions.PAYMENT_VIEW, input.branchId);
  const orgId = ctx.organizationId;

  let query: FirebaseFirestore.Query = db.collection("payments")
    .where("organizationId", "==", orgId);

  if (input.direction) {
    query = query.where("direction", "==", input.direction);
  }
  if (input.partyId) {
    query = query.where("partyId", "==", input.partyId);
  }
  if (input.referenceId) {
    query = query.where("referenceId", "==", input.referenceId);
  }
  const scoped = applyDataScope(query, scope);
  const { snapshot, nextCursor } = await fetchPage(scoped.query, "payments", input.startAfterId, input.limit || 50);
  const items = snapshot.docs
    .map((doc) => ({ paymentId: doc.id, ...(doc.data() as PaymentDoc) }))
    .filter((pmt) => scoped.keep(pmt as unknown as Record<string, unknown>));

  return { items, count: items.length, nextCursor, included: await hydrate(ctx, items) };
});
