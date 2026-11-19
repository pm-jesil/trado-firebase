/**
 * Shared Billing & Sales Engine - Mutation Callables
 *
 * - billsCreate: Create counter sales (POS), B2B tax invoices, quotations, proformas, or sales orders
 * - billsUpdateDraft: Edit draft documents before finalization
 * - billsFinalize: quotation / draft / sales order -> invoice
 * - finalizeBillInternal: Internal logic for bill finalization (shared with deliveries)
 * - decideBill: Maker-checker decision application on pending bills
 * - billsVoid: Reversal of active bills or cancellation of draft/pending bills
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { db } from "../../services/firebase.js";
import {
  CreateBillSchema,
  UpdateDraftBillSchema,
  FinalizeBillSchema,
  VoidDocumentSchema,
  type DocumentDecisionInput,
} from "../../validation/schemas.js";
import { parseInput } from "../../validation/parseInput.js";
import {
  BillDoc,
  CustomerDoc,
  PaymentDoc,
  ProductDoc,
  ReturnDoc,
  AccountTransactionDoc,
} from "../../types/models.js";
import {
  prepareReversalInTxn,
  applyReversalInTxn,
  type PreparedReversal,
} from "../../services/postingService.js";
import {
  SalesMode,
  PaymentStatus,
  StockMovementType,
  PaymentMethod,
  DocumentType,
} from "../../constants/enums.js";
import { AppPermissions } from "../../constants/permissions.js";
import { Money } from "../../services/money.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
  DocumentTypePrefix,
} from "../../services/documentCounter.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  prepareReservationInTxn,
  commitReservationInTxn,
  StockChangeItem,
} from "../../services/stockEngine.js";
import {
  resolveRequestContext,
  resolveDataScope,
  isInDataScope,
  type RequestContext,
} from "../../services/contextResolver.js";
import { evaluateApproval, assertCanDecide } from "../../services/approvals.js";
import {
  assertSerialCount,
  prepareSerialsInTxn,
  serialsOf,
  linesFromRegistry,
} from "../../services/serials.js";
import {
  SALE_CREATE,
  priceBillLines,
  billTotals,
  reservationLines,
  prepareSaleEffects,
  paymentStatusFor,
  markIdempotencySucceeded,
  buildBillPrintSnapshot,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// billsCreate
// ---------------------------------------------------------------------------

export const billsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateBillSchema, request.data);
  const docType = input.documentType || DocumentType.INVOICE;

  const ctx = await resolveRequestContext(request, {
    // Order-taking (pre-sale) belongs to the "sales" module; counter/B2B invoices to "billing"
    requiredPermission: docType === DocumentType.SALES_ORDER ? AppPermissions.SALE_CREATE : SALE_CREATE,
  });
  const orgId = ctx.organizationId;
  const branchId = ctx.branchId;

  if (input.salesMode === SalesMode.B2B && !input.customerId) {
    throw new HttpsError("invalid-argument", "B2B invoices require a registered customerId.");
  }
  if (input.customerId && input.walkInCustomer) {
    throw new HttpsError("invalid-argument", "[REFERENCE_ATTRIBUTE_COPY] Pass customerId or walkInCustomer, not both: a registered customer is referenced by id.", { reason: "REFERENCE_ATTRIBUTE_COPY" });
  }

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "bills.create",
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
    const orgData = ctx.organization;
    const currency = orgData.currency || "INR";
    const billRef = db.collection("bills").doc();
    const billId = billRef.id;
    const now = new Date().toISOString();

    const isSalesOrder = docType === DocumentType.SALES_ORDER;
    const isQuotationOrDraft =
      input.status === "draft" ||
      docType === DocumentType.QUOTATION ||
      docType === DocumentType.PROFORMA;
    const isPreSale = isQuotationOrDraft || isSalesOrder;

    let prefix: DocumentTypePrefix = "POS";
    if (docType === DocumentType.QUOTATION) prefix = "QTN";
    else if (docType === DocumentType.PROFORMA) prefix = "PRO";
    else if (isSalesOrder) prefix = "SO";
    else if (input.salesMode === SalesMode.B2B) prefix = "INV";

    const priced = await priceBillLines(ctx, input.items, currency);
    const { items: processedItems, subTotal, taxTotal } = priced;
    // Serials: assigned when stock is affected (invoice, sales order, pending sale) - not on quotations/drafts
    const serialsApply = !isQuotationOrDraft || isSalesOrder;
    if (!serialsApply && priced.serialLines.some((l) => l.serials.length)) {
      throw new HttpsError("invalid-argument", "[SERIALS_NOT_ALLOWED] Serial numbers are assigned when the quotation/draft becomes an invoice or sales order.", { reason: "SERIALS_NOT_ALLOWED" });
    }
    if (serialsApply) {
      for (const l of priced.serialLines) assertSerialCount(l, processedItems.find((i) => i.lineId === l.lineId)?.baseQuantity ?? 0);
    }

    // Inter-state tax detection (G7): Check customer state vs branch state
    let isInterState = false;
    let customerDoc: CustomerDoc | null = null;
    if (input.customerId) {
      const custSnap = await db.collection("customers").doc(input.customerId).get();
      if (!custSnap.exists || (custSnap.data() as CustomerDoc).organizationId !== orgId) {
        throw new HttpsError("not-found", "Customer not found in this organization.");
      }
      customerDoc = custSnap.data() as CustomerDoc;
      const billingAddr = customerDoc.addresses?.find((a) => a.isDefaultBilling) || customerDoc.addresses?.[0];
      const custState = billingAddr?.state;
      const branchAddr = ctx.branch?.address;
      const branchState = branchAddr && typeof branchAddr === "object" ? branchAddr.state : undefined;
      if (custState && branchState && custState.trim().toLowerCase() !== branchState.trim().toLowerCase()) {
        isInterState = true;
      }
    }

    const { discountTotal, totalAmount, roundOff, taxSnapshot } = billTotals(ctx, priced, input.discountTotal, currency, isInterState);

    const requestedPaid = isPreSale ? 0 : Math.min(totalAmount, Math.max(0, input.paidAmount || 0));
    const requestedBalance = Money.subtract(totalAmount, requestedPaid, currency);

    // Credit-limit breach (credit sales to a registered customer)
    let creditBreach: string | undefined;
    if (!isPreSale && customerDoc && requestedBalance > 0) {
      if (customerDoc.creditLimit > 0 && (customerDoc.outstandingBalance || 0) + requestedBalance > customerDoc.creditLimit) {
        creditBreach = `Credit limit ${customerDoc.creditLimit} exceeded (outstanding ${customerDoc.outstandingBalance || 0} + ${requestedBalance}).`;
      }
    }
    const forceReason = [
      priced.discountBreaches.length ? `Discount above product maximum: ${priced.discountBreaches.join(", ")}.` : "",
      creditBreach || "",
    ].filter(Boolean).join(" ") || undefined;

    const approval = isPreSale
      ? { required: false, note: undefined as string | undefined }
      : await evaluateApproval(ctx, "sale", totalAmount, forceReason);
    const pendingApproval = approval.required;
    const applyEffectsNow = !isPreSale && !pendingApproval;

    const paidAmount = applyEffectsNow ? requestedPaid : 0;
    const balanceAmount = Money.subtract(totalAmount, paidAmount, currency);
    const paymentStatus = isPreSale || pendingApproval ? PaymentStatus.PENDING : paymentStatusFor(totalAmount, paidAmount);
    const billStatus = pendingApproval ? "pending_approval" : (isPreSale ? "draft" : "active");
    const paymentMethod = (input.paymentMethod as PaymentMethod) || PaymentMethod.CASH;

    const effectiveAccountId = input.financialAccountId || ctx.branch.settings?.defaultFinancialAccountId || undefined;

    const finalResult = await db.runTransaction(async (txn) => {
      // === READS ===
      const billReservation = await readNextDocumentNumberInTxn(txn, { organizationId: orgId, type: prefix });
      const commitEffects = applyEffectsNow
        ? await prepareSaleEffects(txn, {
          ctx, billId, branchId, items: processedItems, customerId: input.customerId,
          totalAmount, balanceAmount, paidAmount, paymentMethod,
          financialAccountId: effectiveAccountId,
          splitPayments: input.splitPayments,
          storageLocationId: input.storageLocationId,
          stockReason: `Sale ${billId}`,
        })
        : null;
      const reservation = isSalesOrder && !pendingApproval
        ? await prepareReservationInTxn(txn, {
          organizationId: orgId, branchId, lines: reservationLines(processedItems), direction: 1,
          allowNegativeStock: ctx.branch.settings?.allowNegativeStock === true,
        })
        : null;
      const commitSerials = serialsApply && priced.serialLines.length
        ? await prepareSerialsInTxn(txn, { organizationId: orgId, branchId, lines: priced.serialLines, action: applyEffectsNow ? { kind: "sell", billId } : { kind: "reserve", billId } })
        : null;

      // === WRITES ===
      commitDocumentNumberInTxn(txn, billReservation);
      const billNumber = billReservation.formattedNumber;

      const billDoc: BillDoc = {
        organizationId: orgId,
        branchId,
        financialAccountId: effectiveAccountId || null,
        storageLocationId: input.storageLocationId || null,
        splitPayments: input.splitPayments || undefined,
        billNumber,
        salesMode: input.salesMode || SalesMode.POS,
        documentType: docType,
        salespersonMembershipId: ctx.membershipId,
        customerId: input.customerId || null,
        billToSnapshot: input.walkInCustomer || null,
        items: processedItems,
        subTotal,
        discountTotal,
        taxTotal,
        roundOff,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        status: billStatus,
        stockReserved: !!reservation,
        taxSnapshot,
        notes: input.notes,
        createdAt: now,
        createdBy: ctx.callerUid,
        createdByMembershipId: ctx.membershipId,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      };
      if (pendingApproval) {
        billDoc.requestedPaidAmount = requestedPaid;
        billDoc.requestedPaymentMethod = paymentMethod;
        billDoc.approvalNote = approval.note || null;
      } else if (approval.note) {
        billDoc.approvalNote = approval.note;
      }
      if (reservation) commitReservationInTxn(txn, reservation, ctx.callerUid);
      if (commitSerials) commitSerials();
      const effects = commitEffects ? commitEffects() : { paymentId: null, billToSnapshot: null };
      if (effects.billToSnapshot && docType === DocumentType.INVOICE) billDoc.billToSnapshot = effects.billToSnapshot;
      txn.set(billRef, billDoc);

      return {
        billId,
        organizationId: orgId,
        billNumber,
        salesMode: billDoc.salesMode,
        documentType: docType,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        paymentId: effects.paymentId,
        status: billStatus,
        message: pendingApproval
          ? "Bill submitted for approval (no stock or ledger effect until approved)."
          : isSalesOrder
            ? "Sales order created; stock reserved until delivery/finalization."
            : isQuotationOrDraft
              ? "Quotation / Draft created successfully (stock unaffected)."
              : "Bill generated successfully.",
      };
    });

    await markIdempotencySucceeded(idempotency.recordId, finalResult);

    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_BILL_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create bill: ${(error as Error).message}`);
  }
});

// ---------------------------------------------------------------------------
// billsUpdateDraft: quotations / proformas / draft invoices are editable until finalized
// ---------------------------------------------------------------------------

export const billsUpdateDraft = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(UpdateDraftBillSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: SALE_CREATE });
  const ref = db.collection("bills").doc(input.billId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Bill not found.");
  const bill = snap.data() as BillDoc;
  if (bill.organizationId !== ctx.organizationId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  if (bill.status !== "draft" || bill.documentType === DocumentType.SALES_ORDER) {
    throw new HttpsError("failed-precondition", "[DOCUMENT_IMMUTABLE] Only quotations, proformas and draft invoices can be edited; finalized documents are voided and reissued (sales orders: cancel and re-create).", { reason: "DOCUMENT_IMMUTABLE" });
  }
  const scope = await resolveDataScope(ctx, "sales", AppPermissions.BILL_VIEW_ALL);
  if (!isInDataScope(bill as unknown as Record<string, unknown>, scope)) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Bill is outside your data scope.", { reason: "PERMISSION_DENIED" });
  }
  if (input.customerId && input.walkInCustomer) {
    throw new HttpsError("invalid-argument", "[REFERENCE_ATTRIBUTE_COPY] Pass customerId or walkInCustomer, not both.", { reason: "REFERENCE_ATTRIBUTE_COPY" });
  }
  const currency = ctx.organization.currency || "INR";
  const updates: Partial<BillDoc> = {};
  if (input.items || input.discountTotal !== undefined) {
    const priced = await priceBillLines(ctx, input.items || bill.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unit: i.unit, unitPriceOverride: i.priceSnapshot, discountValue: i.discountValue })), currency);
    const totals = billTotals(ctx, priced, input.discountTotal ?? bill.discountTotal, currency);
    Object.assign(updates, { items: priced.items, subTotal: priced.subTotal, taxTotal: priced.taxTotal, discountTotal: totals.discountTotal, totalAmount: totals.totalAmount, roundOff: totals.roundOff, balanceAmount: totals.totalAmount, taxSnapshot: totals.taxSnapshot });
  }
  if (input.customerId !== undefined) Object.assign(updates, { customerId: input.customerId, billToSnapshot: null });
  if (input.walkInCustomer) Object.assign(updates, { customerId: null, billToSnapshot: input.walkInCustomer });
  if (input.notes !== undefined) updates.notes = input.notes;
  if (!Object.keys(updates).length) throw new HttpsError("invalid-argument", "No updatable fields provided.");
  const now = new Date().toISOString();
  await ref.update({ ...updates, updatedAt: now, updatedBy: ctx.callerUid });
  return { billId: snap.id, status: "draft", totalAmount: updates.totalAmount ?? bill.totalAmount, updated: Object.keys(updates) };
});

// ---------------------------------------------------------------------------
// billsFinalize: quotation / draft / sales order -> invoice
// ---------------------------------------------------------------------------

export const billsFinalize = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(FinalizeBillSchema, request.data);

  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.BILL_CREATE, AppPermissions.BILL_UPDATE, AppPermissions.DELIVERY_UPDATE],
  });
  const orgId = ctx.organizationId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "bills.finalize",
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
    const finalResult = await finalizeBillInternal(ctx, input.billId);
    await markIdempotencySucceeded(idempotency.recordId, finalResult);
    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "FINALIZE_BILL_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to finalize bill: ${(error as Error).message}`);
  }
});

/**
 * Converts a draft / quotation / sales order into an active invoice: releases any reservation,
 * deducts stock, posts the customer ledger and records an optional collected payment.
 * Used by billsFinalize and by delivery completion.
 */
export async function finalizeBillInternal(
  ctx: RequestContext,
  billId: string,
  collect?: { paidAmount: number; paymentMethod: PaymentMethod }
) {
  const now = new Date().toISOString();
  const billRef = db.collection("bills").doc(billId);
  return db.runTransaction(async (txn) => {
    const billSnap = await txn.get(billRef);
    if (!billSnap.exists) {
      throw new HttpsError("not-found", "Bill not found.");
    }
    const billData = billSnap.data() as BillDoc;
    if (billData.organizationId !== ctx.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    if (billData.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        `Only draft / quotation bills can be finalized. Current status: "${billData.status}".`
      );
    }

    const invReservation = await readNextDocumentNumberInTxn(txn, { organizationId: ctx.organizationId, type: "INV" });

    // Lock authoritative cost snapshot at the moment of finalization (per line unit)
    const finalizedItems = billData.items.map((i) => ({ ...i }));
    const productSnaps = await Promise.all(finalizedItems.map((i) => txn.get(db.collection("products").doc(i.productId))));
    finalizedItems.forEach((item, idx) => {
      const pSnap = productSnaps[idx];
      if (!pSnap.exists) return;
      const pData = pSnap.data() as ProductDoc;
      const baseCost = (pData.weightedAverageCost !== undefined && pData.weightedAverageCost !== null)
        ? pData.weightedAverageCost
        : (pData.costPrice ?? 0);
      item.costSnapshot = Money.rate(baseCost * (item.conversionFactor || 1));
      item.trackStock = pData.trackStock === true;
    });
    const heldLines = linesFromRegistry(await serialsOf(ctx.organizationId, "holdBillId", billId, txn), "holdLineId");
    finalizedItems.forEach((item, idx) => {
      const pData = productSnaps[idx].exists ? (productSnaps[idx].data() as ProductDoc) : null;
      if (pData?.trackSerial && pData.trackStock !== false) {
        assertSerialCount(heldLines.find((l) => l.lineId === item.lineId) || { lineId: item.lineId, productId: item.productId, serials: [] }, item.baseQuantity ?? item.quantity);
      }
    });
    const commitSerials = heldLines.length
      ? await prepareSerialsInTxn(txn, { organizationId: ctx.organizationId, branchId: billData.branchId || "main-branch", lines: heldLines, action: { kind: "sell", billId } })
      : null;

    const paidAmount = Math.min(billData.totalAmount, Math.max(0, (collect?.paidAmount || 0) + (billData.paidAmount || 0)));
    const newlyPaid = Money.subtract(paidAmount, billData.paidAmount || 0);
    const balanceAmount = Money.subtract(billData.totalAmount, paidAmount);

    const commitEffects = await prepareSaleEffects(txn, {
      ctx,
      billId,
      branchId: billData.branchId || "main-branch",
      items: finalizedItems,
      customerId: billData.customerId,
      totalAmount: billData.totalAmount,
      balanceAmount,
      paidAmount: newlyPaid,
      paymentMethod: collect?.paymentMethod || PaymentMethod.CASH,
      stockReason: `Finalized Bill ${invReservation.formattedNumber} (ex-${billData.billNumber})`,
      releaseReservation: billData.stockReserved === true,
    });

    commitDocumentNumberInTxn(txn, invReservation);
    const invoiceNumber = invReservation.formattedNumber;
    const effects = commitEffects();
    if (commitSerials) commitSerials();

    txn.update(billRef, {
      status: "active",
      documentType: DocumentType.INVOICE,
      billNumber: invoiceNumber,
      originalQuotationNumber: billData.billNumber,
      items: finalizedItems,
      paidAmount,
      balanceAmount,
      paymentStatus: paymentStatusFor(billData.totalAmount, paidAmount),
      ...(effects.billToSnapshot ? { billToSnapshot: effects.billToSnapshot } : {}),
      stockReserved: false,
      finalizedAt: now,
      finalizedBy: ctx.callerUid,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    });

    return {
      billId,
      status: "active",
      billNumber: invoiceNumber,
      originalQuotationNumber: billData.billNumber,
      totalAmount: billData.totalAmount,
      paidAmount,
      balanceAmount,
      paymentId: effects.paymentId,
      message: `Quotation ${billData.billNumber} finalized into Invoice ${invoiceNumber}. Inventory stock decremented.`,
      printSnapshot: buildBillPrintSnapshot(ctx.organization, {
        ...billData,
        billNumber: invoiceNumber,
        status: "active",
        documentType: DocumentType.INVOICE,
        items: finalizedItems,
        paidAmount,
        balanceAmount,
        finalizedAt: now,
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// decideBill: maker-checker decision on a pending bill
// ---------------------------------------------------------------------------

/** Applies an approver's decision on a pending document (called by documentsDecide in approvals.ts). */
export async function decideBill(ctx: RequestContext, input: DocumentDecisionInput) {
  const billRef = db.collection("bills").doc(input.documentId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (txn) => {
    const snap = await txn.get(billRef);
    if (!snap.exists) throw new HttpsError("not-found", "Bill not found.");
    const bill = snap.data() as BillDoc;
    if (bill.organizationId !== ctx.organizationId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    assertCanDecide(ctx, "sale", bill);
    const heldLines = linesFromRegistry(await serialsOf(ctx.organizationId, "holdBillId", snap.id, txn), "holdLineId");
    const commitSerials = heldLines.length
      ? await prepareSerialsInTxn(txn, { organizationId: ctx.organizationId, branchId: bill.branchId || "main-branch", lines: heldLines, action: input.decision === "reject" ? { kind: "release", billId: snap.id } : { kind: "sell", billId: snap.id } })
      : null;

    if (input.decision === "reject") {
      if (commitSerials) commitSerials();
      txn.update(billRef, {
        status: "rejected",
        rejectedAt: now,
        rejectedBy: ctx.callerUid,
        approvalReason: input.reason || null,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });
      return { billId: snap.id, status: "rejected" };
    }

    const paidAmount = bill.requestedPaidAmount || 0;
    const balanceAmount = Money.subtract(bill.totalAmount, paidAmount);
    const commitEffects = await prepareSaleEffects(txn, {
      ctx,
      billId: snap.id,
      branchId: bill.branchId || "main-branch",
      items: bill.items,
      customerId: bill.customerId,
      totalAmount: bill.totalAmount,
      balanceAmount,
      paidAmount,
      paymentMethod: (bill.requestedPaymentMethod as PaymentMethod) || PaymentMethod.CASH,
      financialAccountId: bill.financialAccountId || null,
      splitPayments: bill.splitPayments,
      storageLocationId: bill.storageLocationId || undefined,
      stockReason: `Approved sale ${bill.billNumber}`,
    });
    const effects = commitEffects();
    if (commitSerials) commitSerials();
    txn.update(billRef, {
      status: "active",
      ...(effects.billToSnapshot && (bill.documentType || DocumentType.INVOICE) === DocumentType.INVOICE ? { billToSnapshot: effects.billToSnapshot } : {}),
      paidAmount,
      balanceAmount,
      paymentStatus: paymentStatusFor(bill.totalAmount, paidAmount),
      approvedAt: now,
      approvedBy: ctx.callerUid,
      approvalReason: input.reason || null,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    });
    return { billId: snap.id, status: "active", paymentId: effects.paymentId };
  });

  return result;
}

// ---------------------------------------------------------------------------
// billsVoid: reversal of an active bill / cancellation of a draft or pending bill
// ---------------------------------------------------------------------------

export const billsVoid = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(VoidDocumentSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.BILL_VOID });
  const orgId = ctx.organizationId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "bills.void",
    clientKey: input.idempotencyKey || `void_${input.documentId}`,
    payload: { documentId: input.documentId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    // Returns, completed payments, and direct accountTransactions referencing the bill
    const [returnsSnap, paymentsSnap, billTxnsSnap] = await Promise.all([
      db.collection("returns").where("organizationId", "==", orgId).where("referenceId", "==", input.documentId).get(),
      db.collection("payments").where("organizationId", "==", orgId).where("referenceId", "==", input.documentId).get(),
      db.collection("accountTransactions").where("organizationId", "==", orgId).where("sourceDocumentType", "==", "bill").where("sourceDocumentId", "==", input.documentId).get(),
    ]);
    if (returnsSnap.docs.some((d) => (d.data() as ReturnDoc).status !== "voided")) {
      throw new HttpsError("failed-precondition", "Bill has returns recorded against it; void the returns first.");
    }

    const now = new Date().toISOString();
    const billRef = db.collection("bills").doc(input.documentId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(billRef);
      if (!snap.exists) throw new HttpsError("not-found", "Bill not found.");
      const bill = snap.data() as BillDoc;
      if (bill.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      const voidable = bill.status === "draft" || bill.status === "pending_approval";
      const serialLinesHeld = voidable
        ? linesFromRegistry(await serialsOf(orgId, "holdBillId", snap.id, txn), "holdLineId")
        : linesFromRegistry(await serialsOf(orgId, "soldBillId", snap.id, txn), "soldLineId");
      const releaseSerials = serialLinesHeld.length
        ? await prepareSerialsInTxn(txn, { organizationId: orgId, branchId: bill.branchId || "main-branch", lines: serialLinesHeld, action: { kind: "release", billId: snap.id } })
        : null;
      if (voidable) {
        const release = bill.stockReserved
          ? await prepareReservationInTxn(txn, { organizationId: orgId, branchId: bill.branchId || "main-branch", lines: reservationLines(bill.items), direction: -1 })
          : null;
        if (release) commitReservationInTxn(txn, release, ctx.callerUid);
        if (releaseSerials) releaseSerials();
        txn.update(billRef, {
          status: "cancelled",
          stockReserved: false,
          voidReason: input.reason,
          voidedAt: now,
          voidedBy: ctx.callerUid,
          updatedAt: now,
          updatedBy: ctx.callerUid,
        });
        return { billId: snap.id, status: "cancelled" };
      }
      if (bill.status !== "active") {
        throw new HttpsError("failed-precondition", `Bill in status "${bill.status}" cannot be voided.`);
      }

      const stockItems: StockChangeItem[] = bill.items
        .filter((i) => i.trackStock !== false)
        .map((i) => ({
          productId: i.productId,
          quantity: Math.abs(i.baseQuantity ?? i.quantity),
          type: StockMovementType.ADJUSTMENT_IN,
          referenceId: snap.id,
          referenceModel: "bill" as const,
          referenceLineId: i.lineId,
          reason: `Void of ${bill.billNumber}: ${input.reason}`,
        }));
      const preparedStock = stockItems.length
        ? await prepareStockChangesInTxn(txn, { organizationId: orgId, branchId: bill.branchId || "main-branch", actorUid: ctx.callerUid, items: stockItems })
        : null;
      const custRef = bill.customerId ? db.collection("customers").doc(bill.customerId) : null;
      const custSnap = custRef ? await txn.get(custRef) : null;

      // Handle payment reversal / customer credit disposition
      const paymentDisposition = input.paymentDisposition || "reverse_entries";
      const reversalPreps: PreparedReversal[] = [];

      if (paymentDisposition === "reverse_entries") {
        const seenAccountAmounts = new Set<string>();

        // 1. Direct bill account transaction legs (cash, card, split payments)
        for (const tDoc of billTxnsSnap.docs) {
          const t = tDoc.data() as AccountTransactionDoc;
          if (t.direction === "in" && t.type !== "reversal" && !t.reversalTransactionId) {
            const prep = await prepareReversalInTxn(txn, {
              organizationId: orgId,
              originalTransactionId: tDoc.id,
              financialAccountId: t.financialAccountId,
              branchId: t.branchId || bill.branchId,
              amount: t.amount,
              currency: t.currency,
              sourceDocumentType: "bill",
              sourceDocumentId: snap.id,
              reason: `Void bill ${bill.billNumber}: ${input.reason}`,
              actorUid: ctx.callerUid,
              now,
            });
            reversalPreps.push(prep);
            seenAccountAmounts.add(`${t.financialAccountId}_${t.amount}`);
          }
        }

        // 2. Payments records referencing this bill (if any recorded separately)
        for (const p of paymentsSnap.docs) {
          const pDoc = p.data() as PaymentDoc;
          if (pDoc.status === "completed" && pDoc.financialAccountId) {
            const key = `${pDoc.financialAccountId}_${pDoc.amount}`;
            if (!seenAccountAmounts.has(key)) {
              const prep = await prepareReversalInTxn(txn, {
                organizationId: orgId,
                financialAccountId: pDoc.financialAccountId,
                branchId: pDoc.branchId || bill.branchId,
                amount: pDoc.amount,
                sourceDocumentType: "bill",
                sourceDocumentId: snap.id,
                reason: `Void bill ${bill.billNumber}: ${input.reason}`,
                actorUid: ctx.callerUid,
                now,
              });
              reversalPreps.push(prep);
              seenAccountAmounts.add(key);
            }
          }
        }
      }

      if (preparedStock) commitStockChangesInTxn(txn, preparedStock);
      if (releaseSerials) releaseSerials();
      if (custRef && custSnap?.exists) {
        const cust = custSnap.data() as CustomerDoc;
        const totalPaid = bill.paidAmount || 0;
        const custUpdates: Partial<CustomerDoc> = {
          totalSpend: Money.amount((cust.totalSpend || 0) - bill.totalAmount),
          outstandingBalance: Money.amount((cust.outstandingBalance || 0) - bill.balanceAmount),
          updatedAt: now,
        };
        if (paymentDisposition === "keep_as_customer_credit" && totalPaid > 0) {
          custUpdates.advanceBalance = Money.amount((cust.advanceBalance || 0) + totalPaid);
        }
        txn.update(custRef, custUpdates);
      }

      for (const pr of reversalPreps) {
        applyReversalInTxn(txn, pr);
      }

      let voidedPayments = 0;
      for (const p of paymentsSnap.docs) {
        if ((p.data() as PaymentDoc).status !== "completed") continue;
        txn.update(p.ref, { status: "voided", voidReason: `Bill ${bill.billNumber} voided`, updatedAt: now, updatedBy: ctx.callerUid });
        voidedPayments++;
      }
      txn.update(billRef, {
        status: "voided",
        paymentDisposition,
        voidReason: input.reason,
        voidedAt: now,
        voidedBy: ctx.callerUid,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });
      return {
        billId: snap.id,
        status: "voided",
        reversedStockLines: stockItems.length,
        voidedPayments,
        reversedPaymentLegs: reversalPreps.length,
        paymentDisposition,
      };
    });

    await markIdempotencySucceeded(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "VOID_BILL_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to void bill: ${(error as Error).message}`);
  }
});
