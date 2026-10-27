/**
 * Unified Outflow Callables (Purchases & Expenses)
 * 
 * Strict architectural rule:
 * - Single collection `outflows` for both purchases and expenses
 * - Line items contain line data only; references foreign entities by ID
 * - Purchases update physical inventory `currentStock` transactionally
 * - Payments ledger updated when paidAmount > 0
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateOutflowSchema,
  ListOutflowsSchema,
} from "../validation/schemas.js";
import {
  OutflowDoc,
  OutflowLine,
  OrganizationDoc,
  MembershipDoc,
  PaymentDoc,
} from "../types/models.js";
import {
  OutflowKind,
  OutflowStatus,
  PaymentStatus,
  StockMovementType,
  PaymentDirection,
  PartyType,
  PaymentMethod,
} from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import { calculateTax } from "../services/taxCalculation.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  StockChangeItem,
} from "../services/stockEngine.js";
import { createAuditLog } from "../services/audit.js";
import { Money } from "../services/money.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const outflowsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateOutflowSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "outflows.create",
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
    const orgDoc = await db.collection("organizations").doc(input.organizationId).get();
    if (!orgDoc.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const orgData = orgDoc.data() as OrganizationDoc;

    const outflowRef = db.collection("outflows").doc();
    const outflowId = outflowRef.id;
    const now = new Date().toISOString();
    const docDate = input.docDate || now;
    const prefix = input.kind === OutflowKind.PURCHASE ? "PUR" : "EXP";
    const currency = orgData.currency || "INR";

    // Calculate line totals using canonical Money utility
    let subTotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;

    const processedLines: OutflowLine[] = [];
    const stockChangeItems: StockChangeItem[] = [];

    for (const rawLine of input.lines) {
      const unitPrice = Money.rate(rawLine.unitPrice);
      const quantity = Money.qty(rawLine.quantity);
      const gross = Money.amount(quantity * unitPrice, currency);
      const discount = Money.amount(Math.min(gross, rawLine.discountAmount || 0), currency);
      const net = Money.subtract(gross, discount, currency);
      const taxAmount = rawLine.taxPercent ? Money.percent(net, rawLine.taxPercent, currency) : 0;
      const lineTotal = Money.amount(net + taxAmount, currency);

      subTotal = Money.amount(subTotal + gross, currency);
      discountTotal = Money.amount(discountTotal + discount, currency);
      taxTotal = Money.amount(taxTotal + taxAmount, currency);

      processedLines.push({
        productId: rawLine.productId || null,
        itemName: rawLine.itemName,
        sku: rawLine.sku || null,
        categoryId: rawLine.categoryId || null,
        quantity,
        unit: rawLine.unit,
        unitPrice,
        grossAmount: gross,
        discountAmount: discount,
        taxAmount,
        lineTotal,
        addToStock: rawLine.addToStock !== false,
        batch: rawLine.batch || null,
        expiryDate: rawLine.expiryDate || null,
      });

      // Prepare stock change for purchase lines with linked product and addToStock
      if (input.kind === OutflowKind.PURCHASE && rawLine.productId && rawLine.addToStock !== false) {
        stockChangeItems.push({
          productId: rawLine.productId,
          quantity, // Positive addition
          type: StockMovementType.PURCHASE_IN,
          unit: rawLine.unit,
          referenceId: outflowId,
          referenceModel: "outflow",
          reason: `Purchase receipt ${outflowId}`,
        });
      }
    }

    const netTaxable = Money.subtract(subTotal, discountTotal, currency);
    const totalAmount = Money.roundCurrency(netTaxable + taxTotal, currency);
    const paidAmount = Math.min(totalAmount, Math.max(0, input.paidAmount || 0));
    const balanceAmount = Money.subtract(totalAmount, paidAmount, currency);

    let paymentStatus = PaymentStatus.PENDING;
    if (paidAmount >= totalAmount) {
      paymentStatus = PaymentStatus.PAID;
    } else if (paidAmount > 0) {
      paymentStatus = PaymentStatus.PARTIAL;
    }

    // Compute frozen tax snapshot
    const taxResult = calculateTax({
      taxRegimeCode: orgData.taxRegimeCode,
      country: orgData.country,
      subTotal: subTotal - discountTotal,
    });

    const callerUid = request.auth.uid;

    // Execute atomic transaction for sequential numbering, stock, and payment creation
    const finalResult = await db.runTransaction(async (txn) => {
      // === PHASE 1: ALL READS FIRST (Firestore requirement) ===
      const outflowReservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: input.organizationId,
        type: prefix,
      });

      let paymentReservation = null;
      if (paidAmount > 0) {
        paymentReservation = await readNextDocumentNumberInTxn(txn, {
          organizationId: input.organizationId,
          type: "PAY",
        });
      }

      let preparedStock = null;
      if (stockChangeItems.length > 0) {
        preparedStock = await prepareStockChangesInTxn(txn, {
          organizationId: input.organizationId,
          actorUid: callerUid,
          items: stockChangeItems,
        });
      }

      // === PHASE 2: ALL WRITES AFTER ALL READS ===
      commitDocumentNumberInTxn(txn, outflowReservation);
      const outflowNumber = outflowReservation.formattedNumber;

      const outflowDoc: OutflowDoc = {
        organizationId: input.organizationId,
        outflowNumber,
        kind: input.kind,
        status: OutflowStatus.CONFIRMED,
        docDate,
        vendorId: input.vendorId || null,
        vendorName: input.vendorName || undefined,
        payee: input.payee || undefined,
        invoiceNumber: input.invoiceNumber || undefined,
        dueDate: input.dueDate || null,
        lines: processedLines,
        subTotal,
        discountTotal,
        taxTotal,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        taxSnapshot: taxResult.taxSnapshot,
        notes: input.notes,
        createdAt: now,
        createdBy: callerUid,
      };

      txn.set(outflowRef, outflowDoc);

      // Apply inventory stock changes transactionally
      if (preparedStock) {
        commitStockChangesInTxn(txn, preparedStock);
      }

      // If paid amount > 0, create payment voucher ledger record
      let paymentId: string | null = null;
      if (paidAmount > 0 && paymentReservation) {
        commitDocumentNumberInTxn(txn, paymentReservation);
        const paymentRef = db.collection("payments").doc();
        paymentId = paymentRef.id;

        const paymentDoc: PaymentDoc = {
          organizationId: input.organizationId,
          paymentNumber: paymentReservation.formattedNumber,
          direction: PaymentDirection.OUT,
          partyType: PartyType.VENDOR,
          partyId: input.vendorId || null,
          partyName: input.vendorName || input.payee || "Vendor",
          amount: paidAmount,
          method: (input.paymentMethod as PaymentMethod) || PaymentMethod.CASH,
          referenceId: outflowId,
          referenceModel: "outflow",
          referenceNumber: outflowNumber,
          status: "completed",
          createdAt: now,
          createdBy: callerUid,
        };

        txn.set(paymentRef, paymentDoc);
      }

      return {
        outflowId,
        organizationId: input.organizationId,
        outflowNumber,
        kind: input.kind,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        paymentId,
        status: "confirmed",
        message: `${input.kind === OutflowKind.PURCHASE ? "Purchase" : "Expense"} recorded successfully.`,
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
      action: input.kind === OutflowKind.PURCHASE ? "PURCHASE_CREATED" : "EXPENSE_CREATED",
      entityType: "outflow",
      entityId: outflowId,
      details: {
        number: finalResult.outflowNumber,
        kind: input.kind,
        totalAmount,
        paidAmount,
      },
    });

    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_OUTFLOW_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create outflow: ${(error as Error).message}`);
  }
});

export const outflowsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListOutflowsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("outflows")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.kind) {
    query = query.where("kind", "==", input.kind);
  }
  if (input.vendorId) {
    query = query.where("vendorId", "==", input.vendorId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    outflowId: doc.id,
    ...(doc.data() as OutflowDoc),
  }));

  return { items, count: items.length };
});

export const outflowsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const outflowId = request.data?.outflowId;
  const organizationId = request.data?.organizationId;
  if (!outflowId || !organizationId) {
    throw new HttpsError("invalid-argument", "outflowId and organizationId required.");
  }

  await verifyTenantAccess(request.auth, organizationId);

  const docSnap = await db.collection("outflows").doc(outflowId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Outflow record not found.");
  }

  const data = docSnap.data() as OutflowDoc;
  if (data.organizationId !== organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return { outflowId: docSnap.id, ...data };
});
