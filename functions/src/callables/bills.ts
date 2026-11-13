/**
 * Shared Billing & Sales Engine Callables (POS & B2B)
 *
 * Strict architectural rules:
 * - Single collection `bills` for POS counter sales, B2B invoices, quotations and sales orders
 * - References `customerId` / `productId` by ID only; display data is hydrated at read time
 *   (`included` map). The one descriptive copy is `billToSnapshot` (R2: frozen on finalized tax
 *   invoices for GST Rule 46, or the walk-in details typed at the counter)
 * - Each line has a stable `lineId` and freezes price/cost/tax snapshots, unit, conversionFactor
 *   and baseQuantity (stock is always held in the base unit)
 * - Finalized financial documents are never deleted: billsVoid posts reversal entries
 *
 * Lifecycle (documentType × status):
 *   quotation/proforma  → status draft   (no effect)            → billsFinalize → invoice/active
 *   sales_order         → status draft   (stock RESERVED)       → billsFinalize → invoice/active (reservation released, stock deducted)
 *   invoice/receipt     → status active  (stock deducted, ledger, payment)
 *   any, needing approval → status pending_approval (no effect) → billsApprove → active | rejected
 *   active              → billsVoid → voided (stock returned, customer ledger reversed, payments voided)
 *   draft / pending     → billsVoid → cancelled (reservation released)
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "../services/firebase.js";
import {
  CreateBillSchema,
  UpdateDraftBillSchema,
  ListBillsSchema,
  FinalizeBillSchema,
  VoidDocumentSchema,
  GetBillSchema,
  PreviewBillSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import type { DocumentDecisionInput } from "../validation/schemas.js";
import {
  BillDoc,
  BillItem,
  BillToSnapshot,
  DeliveryDoc,
  ProductDoc,
  PaymentDoc,
  CustomerDoc,
  ReturnDoc,
  StockBalanceDoc,
} from "../types/models.js";
import {
  SalesMode,
  PaymentStatus,
  StockMovementType,
  PaymentDirection,
  PartyType,
  PaymentMethod,
  DocumentType,
} from "../constants/enums.js";
import { AppPermissions } from "../constants/permissions.js";
import { Money } from "../services/money.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
  DocumentTypePrefix,
} from "../services/documentCounter.js";
import { calculateTax } from "../services/taxCalculation.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  prepareReservationInTxn,
  commitReservationInTxn,
  resolveUnitConversion,
  StockChangeItem,
} from "../services/stockEngine.js";
import {
  resolveRequestContext,
  resolveDataScope,
  applyDataScope,
  isInDataScope,
  type RequestContext,
} from "../services/contextResolver.js";
import { evaluateApproval, assertCanDecide } from "../services/approvals.js";
import { redactBill } from "../services/redaction.js";
import { hydrate } from "../services/hydration.js";
import { deliveryProgress } from "../services/deliveryProgress.js";
import { SerialLine, assertSerialCount, prepareSerialsInTxn, serialsOf, linesFromRegistry } from "../services/serials.js";
import { fetchPage } from "../services/pagination.js";

const SALE_CREATE = [AppPermissions.BILL_CREATE, AppPermissions.SALE_CREATE];
const SALE_READ = [AppPermissions.BILL_VIEW, AppPermissions.BILL_VIEW_ALL, AppPermissions.SALE_VIEW];

type BillInput = ReturnType<typeof CreateBillSchema.parse>;

// ---------------------------------------------------------------------------
// Line pricing
// ---------------------------------------------------------------------------

interface PricedBill {
  items: BillItem[];
  subTotal: number;
  taxTotal: number;
  /** Product names whose line discount exceeds the product's maxDiscountPercent. */
  discountBreaches: string[];
  /** Product names that are non-discountable but had a discount requested. */
  nonDiscountableBreaches: string[];
  /** Lines of serial-tracked products with the serials given for them (registry is the store). */
  serialLines: SerialLine[];
}

async function priceBillLines(
  ctx: RequestContext,
  rawItems: BillInput["items"],
  currency: string,
  options?: { allowWarnings?: boolean }
): Promise<PricedBill> {
  const snaps = await db.getAll(...rawItems.map((i) => db.collection("products").doc(i.productId)));
  const items: BillItem[] = [];
  const discountBreaches: string[] = [];
  const nonDiscountableBreaches: string[] = [];
  const serialLines: SerialLine[] = [];
  let subTotal = 0;
  let taxTotal = 0;

  rawItems.forEach((rawItem, idx) => {
    const lineId = `L${idx + 1}`;
    const snap = snaps[idx];
    if (!snap.exists) {
      throw new HttpsError("not-found", `Product "${rawItem.productId}" not found.`);
    }
    const product = snap.data() as ProductDoc;
    if (product.organizationId !== ctx.organizationId) {
      throw new HttpsError("permission-denied", `Cross-tenant product access rejected for "${rawItem.productId}".`);
    }
    if (product.isActive === false) {
      throw new HttpsError("failed-precondition", `Product "${product.name}" is inactive.`);
    }

    const conv = resolveUnitConversion(product, rawItem.unit);
    const listPrice = Money.rate(conv.alternate?.sellingPrice ?? product.sellingPrice * conv.factor);
    const price = rawItem.unitPriceOverride !== undefined ? Money.rate(rawItem.unitPriceOverride) : listPrice;
    const quantity = Money.qty(rawItem.quantity);
    const listSubtotal = Money.amount(listPrice * quantity, currency);
    const lineSubtotal = Money.amount(price * quantity, currency);
    const discount = Money.amount(Math.min(lineSubtotal, rawItem.discountValue || 0), currency);

    // Discounts (explicit or via a price below list) need bill:discount
    const effectiveDiscount = Money.amount(listSubtotal - (lineSubtotal - discount), currency);
    if (product.isDiscountable === false && (effectiveDiscount > 0 || (rawItem.discountValue || 0) > 0)) {
      if (options?.allowWarnings) {
        nonDiscountableBreaches.push(product.name);
      } else {
        throw new HttpsError("invalid-argument", `Product "${product.name}" is not eligible for discounts.`);
      }
    }
    if (effectiveDiscount > 0 && !ctx.can(AppPermissions.BILL_DISCOUNT)) {
      if (!options?.allowWarnings) {
        throw new HttpsError("permission-denied", `[PERMISSION_DENIED] Discounts on "${product.name}" require bill:discount.`, { reason: "PERMISSION_DENIED" });
      }
    }
    if (product.maxDiscountPercent !== undefined && listSubtotal > 0 &&
      (effectiveDiscount / listSubtotal) * 100 > product.maxDiscountPercent + 1e-9) {
      discountBreaches.push(product.name);
    }

    const taxable = Money.subtract(lineSubtotal, discount, currency);
    const taxRate = product.isTaxable === false ? 0 : (product.taxRatePercent || 0);
    const lineTax = taxRate > 0 ? Money.percent(taxable, taxRate, currency) : 0;
    const baseUnitCost = product.weightedAverageCost && product.weightedAverageCost > 0
      ? product.weightedAverageCost
      : (product.costPrice || 0);

    subTotal = Money.amount(subTotal + lineSubtotal, currency);
    taxTotal = Money.amount(taxTotal + lineTax, currency);

    const item: BillItem = {
      lineId,
      productId: rawItem.productId,
      priceSnapshot: price,
      costSnapshot: Money.rate(baseUnitCost * conv.factor), // cost per LINE unit
      taxCodeSnapshot: product.taxCode || "",
      quantity,
      unit: conv.unit,
      conversionFactor: conv.factor,
      baseQuantity: Money.qty(quantity * conv.factor),
      trackStock: product.trackStock === true,
      subtotal: lineSubtotal,
      discountValue: discount,
      taxAmount: lineTax,
      lineTotal: Money.amount(taxable + lineTax, currency),
    };
    if (product.trackSerial && product.trackStock !== false) {
      serialLines.push({ lineId, productId: rawItem.productId, serials: rawItem.serialNumbers || [] });
    } else if (rawItem.serialNumbers?.length) {
      if (!options?.allowWarnings) {
        throw new HttpsError("invalid-argument", `[SERIALS_NOT_TRACKED] Product "${product.name}" does not track serial numbers.`, { reason: "SERIALS_NOT_TRACKED" });
      }
    }
    if (product.isReturnable === false) item.isReturnable = false;
    items.push(item);
  });

  return { items, subTotal, taxTotal, discountBreaches, nonDiscountableBreaches, serialLines };
}

/** Bill-level totals from priced lines (one implementation for create and draft edits). */
function billTotals(ctx: RequestContext, priced: PricedBill, discountInput: number | undefined, currency: string) {
  const discountTotal = Money.amount(Math.min(priced.subTotal, discountInput || 0), currency);
  if (discountTotal > 0 && !ctx.can(AppPermissions.BILL_DISCOUNT)) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Bill-level discounts require bill:discount.", { reason: "PERMISSION_DENIED" });
  }
  const rawTotal = Money.subtract(priced.subTotal, discountTotal, currency) + priced.taxTotal;
  const totalAmount = Money.roundCurrency(rawTotal, currency);
  const taxSnapshot = calculateTax({ taxRegimeCode: ctx.organization.taxRegimeCode, country: ctx.organization.country, subTotal: priced.subTotal - discountTotal }).taxSnapshot;
  return { discountTotal, totalAmount, roundOff: Money.roundCurrency(totalAmount - rawTotal, currency), taxSnapshot };
}

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

function stockOutItems(billId: string, items: BillItem[], reason: string): StockChangeItem[] {
  return items
    .filter((i) => i.trackStock !== false)
    .map((i) => ({
      productId: i.productId,
      quantity: -Math.abs(i.baseQuantity ?? i.quantity),
      type: StockMovementType.SALE_OUT,
      unit: i.unit,
      referenceId: billId,
      referenceModel: "bill" as const,
      referenceLineId: i.lineId,
      reason,
    }));
}

function reservationLines(items: BillItem[]) {
  return items.filter((i) => i.trackStock !== false).map((i) => ({ productId: i.productId, baseQuantity: i.baseQuantity ?? i.quantity }));
}

// ---------------------------------------------------------------------------
// Sale effects: stock, customer ledger, payment (shared by create/finalize/approve)
// ---------------------------------------------------------------------------

interface SaleEffectsParams {
  ctx: RequestContext;
  billId: string;
  branchId: string;
  items: BillItem[];
  customerId?: string | null;
  totalAmount: number;
  balanceAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  stockReason: string;
  releaseReservation?: boolean;
}

/** Reads everything the sale effects need. MUST run in the transaction read phase. */
async function prepareSaleEffects(txn: Transaction, p: SaleEffectsParams) {
  const orgId = p.ctx.organizationId;
  const paymentReservation = p.paidAmount > 0
    ? await readNextDocumentNumberInTxn(txn, { organizationId: orgId, type: "PAY" })
    : null;
  const reservation = p.releaseReservation
    ? await prepareReservationInTxn(txn, { organizationId: orgId, branchId: p.branchId, lines: reservationLines(p.items), direction: -1 })
    : null;
  const stockItems = stockOutItems(p.billId, p.items, p.stockReason);
  const preparedStock = stockItems.length
    ? await prepareStockChangesInTxn(txn, {
      organizationId: orgId,
      branchId: p.branchId,
      actorUid: p.ctx.callerUid,
      items: stockItems,
      allowNegativeStock: p.ctx.branch.settings?.allowNegativeStock === true,
    })
    : null;
  const customerRef = p.customerId ? db.collection("customers").doc(p.customerId) : null;
  const customerSnap = customerRef ? await txn.get(customerRef) : null;

  /**
   * Writes the effects. MUST run in the transaction write phase. Returns the payment id and the
   * bill-to snapshot to freeze on a finalized tax invoice of a registered customer (R2).
   */
  return (): { paymentId: string | null; billToSnapshot: BillToSnapshot | null } => {
    const now = new Date().toISOString();
    if (reservation) commitReservationInTxn(txn, reservation, p.ctx.callerUid);
    if (preparedStock) commitStockChangesInTxn(txn, preparedStock);
    if (customerRef && customerSnap?.exists) {
      const cust = customerSnap.data() as CustomerDoc;
      txn.update(customerRef, {
        totalSpend: Money.amount((cust.totalSpend || 0) + p.totalAmount),
        outstandingBalance: Money.amount((cust.outstandingBalance || 0) + p.balanceAmount),
        updatedAt: now,
      });
    }
    let paymentId: string | null = null;
    if (paymentReservation) {
      commitDocumentNumberInTxn(txn, paymentReservation);
      const paymentRef = db.collection("payments").doc();
      paymentId = paymentRef.id;
      const paymentDoc: PaymentDoc = {
        organizationId: orgId,
        branchId: p.branchId,
        paymentNumber: paymentReservation.formattedNumber,
        direction: PaymentDirection.IN,
        partyType: PartyType.CUSTOMER,
        partyId: p.customerId || null,
        amount: p.paidAmount,
        method: p.paymentMethod,
        referenceId: p.billId,
        referenceModel: "bill",
        status: "completed",
        createdAt: now,
        createdBy: p.ctx.callerUid,
      };
      txn.set(paymentRef, paymentDoc);
    }
    return { paymentId, billToSnapshot: billToFromCustomer(customerSnap) };
  };
}

/** GST Rule 46 recipient details frozen at issue (registered customers only). */
function billToFromCustomer(snap: FirebaseFirestore.DocumentSnapshot | null): BillToSnapshot | null {
  if (!snap?.exists) return null;
  const c = snap.data() as CustomerDoc;
  const out: BillToSnapshot = { name: c.name };
  if (c.phone) {
    out.phone = c.phone ?? undefined;
  }
  if (c.taxId) {
    out.taxId = c.taxId;
  }
  // The customer's default billing address, else the first address (D-7: flat billingAddress removed)
  const billingAddr = c.addresses?.find((a) => a.isDefaultBilling) ?? c.addresses?.[0];
  if (billingAddr) {
    out.billingAddress = [billingAddr.line1, billingAddr.line2, billingAddr.city, billingAddr.state, billingAddr.postalCode]
      .filter(Boolean).join(", ");
  }
  return out;
}

function paymentStatusFor(total: number, paid: number): PaymentStatus {
  if (paid >= total && total > 0) return PaymentStatus.PAID;
  if (paid > 0) return PaymentStatus.PARTIAL;
  return total === 0 ? PaymentStatus.PAID : PaymentStatus.PENDING;
}

async function markIdempotencySucceeded(recordId: string | undefined | null, result: unknown) {
  if (!recordId) return;
  await db.collection("idempotencyRecords").doc(recordId).update({
    status: "succeeded",
    result,
    updatedAt: new Date().toISOString(),
  });
}

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
    // Serials: assigned when stock is affected (invoice, sales order, pending sale) — not on quotations/drafts
    const serialsApply = !isQuotationOrDraft || isSalesOrder;
    if (!serialsApply && priced.serialLines.some((l) => l.serials.length)) {
      throw new HttpsError("invalid-argument", "[SERIALS_NOT_ALLOWED] Serial numbers are assigned when the quotation/draft becomes an invoice or sales order.", { reason: "SERIALS_NOT_ALLOWED" });
    }
    if (serialsApply) {
      for (const l of priced.serialLines) assertSerialCount(l, processedItems.find((i) => i.lineId === l.lineId)?.baseQuantity ?? 0);
    }

    const { discountTotal, totalAmount, roundOff, taxSnapshot } = billTotals(ctx, priced, input.discountTotal, currency);

    const requestedPaid = isPreSale ? 0 : Math.min(totalAmount, Math.max(0, input.paidAmount || 0));
    const requestedBalance = Money.subtract(totalAmount, requestedPaid, currency);

    // Credit-limit breach (credit sales to a registered customer)
    let creditBreach: string | undefined;
    if (!isPreSale && input.customerId && requestedBalance > 0) {
      const custSnap = await db.collection("customers").doc(input.customerId).get();
      if (!custSnap.exists || (custSnap.data() as CustomerDoc).organizationId !== orgId) {
        throw new HttpsError("not-found", "Customer not found in this organization.");
      }
      const cust = custSnap.data() as CustomerDoc;
      if (cust.creditLimit > 0 && (cust.outstandingBalance || 0) + requestedBalance > cust.creditLimit) {
        creditBreach = `Credit limit ${cust.creditLimit} exceeded (outstanding ${cust.outstandingBalance || 0} + ${requestedBalance}).`;
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


    const finalResult = await db.runTransaction(async (txn) => {
      // === READS ===
      const billReservation = await readNextDocumentNumberInTxn(txn, { organizationId: orgId, type: prefix });
      const commitEffects = applyEffectsNow
        ? await prepareSaleEffects(txn, {
          ctx, billId, branchId, items: processedItems, customerId: input.customerId,
          totalAmount, balanceAmount, paidAmount, paymentMethod, stockReason: `Sale ${billId}`,
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
// billsList / billsGet (data scope + cost redaction)
// ---------------------------------------------------------------------------

export const billsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListBillsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: SALE_READ });
  const scope = await resolveDataScope(ctx, "sales", AppPermissions.BILL_VIEW_ALL, input.branchId);

  let query: FirebaseFirestore.Query = db.collection("bills").where("organizationId", "==", ctx.organizationId);
  if (input.salesMode) query = query.where("salesMode", "==", input.salesMode);
  if (input.customerId) query = query.where("customerId", "==", input.customerId);
  if (input.status) query = query.where("status", "==", input.status);
  if (input.createdBy) query = query.where("createdBy", "==", input.createdBy);
  const scoped = applyDataScope(query, scope);

  const { snapshot, nextCursor } = await fetchPage(scoped.query, "bills", input.startAfterId, input.limit || 50);
  const items = snapshot.docs
    .map((doc) => ({ billId: doc.id, ...(doc.data() as BillDoc) }))
    .filter((b) => scoped.keep(b as unknown as Record<string, unknown>))
    .map((b) => redactBill(b as unknown as Record<string, unknown>, ctx));

  return { items, count: items.length, scope: scope.level, nextCursor, included: await hydrate(ctx, items) };
});

export const billsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { billId } = parseInput(GetBillSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: SALE_READ });

  const docSnap = await db.collection("bills").doc(billId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Bill not found.");
  }

  const data = docSnap.data() as BillDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }
  const scope = await resolveDataScope(ctx, "sales", AppPermissions.BILL_VIEW_ALL);
  if (!isInDataScope(data as unknown as Record<string, unknown>, scope)) {
    throw new HttpsError("permission-denied", `[PERMISSION_DENIED] Bill is outside your ${scope.level} data scope.`, { reason: "PERMISSION_DENIED" });
  }

  const bill = redactBill({ billId: docSnap.id, ...data } as unknown as Record<string, unknown>, ctx);
  const [sold, held] = await Promise.all([serialsOf(ctx.organizationId, "soldBillId", docSnap.id), serialsOf(ctx.organizationId, "holdBillId", docSnap.id)]);
  const serialsByLine: Record<string, string[]> = {};
  for (const l of [...linesFromRegistry(sold, "soldLineId"), ...linesFromRegistry(held, "holdLineId")]) serialsByLine[l.lineId] = l.serials;
  const deliveries = await db.collection("deliveries").where("organizationId", "==", ctx.organizationId).where("billId", "==", docSnap.id).get();
  const delivery = deliveries.empty ? null : deliveryProgress(data, deliveries.docs.map((d) => d.data() as DeliveryDoc));
  return { ...bill, serialsByLine, delivery, included: await hydrate(ctx, [bill]) };
});

// ---------------------------------------------------------------------------
// billsFinalize: quotation / draft / sales order → invoice
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
    };
  });
}

// ---------------------------------------------------------------------------
// billsApprove: maker–checker decision on a pending bill
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
    // Returns and completed payments referencing the bill (queried before the transaction)
    const [returnsSnap, paymentsSnap] = await Promise.all([
      db.collection("returns").where("organizationId", "==", orgId).where("referenceId", "==", input.documentId).get(),
      db.collection("payments").where("organizationId", "==", orgId).where("referenceId", "==", input.documentId).get(),
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

      if (preparedStock) commitStockChangesInTxn(txn, preparedStock);
      if (releaseSerials) releaseSerials();
      if (custRef && custSnap?.exists) {
        const cust = custSnap.data() as CustomerDoc;
        txn.update(custRef, {
          totalSpend: Money.amount((cust.totalSpend || 0) - bill.totalAmount),
          outstandingBalance: Money.amount((cust.outstandingBalance || 0) - bill.balanceAmount),
          updatedAt: now,
        });
      }
      let voidedPayments = 0;
      for (const p of paymentsSnap.docs) {
        if ((p.data() as PaymentDoc).status !== "completed") continue;
        txn.update(p.ref, { status: "voided", voidReason: `Bill ${bill.billNumber} voided`, updatedAt: now, updatedBy: ctx.callerUid });
        voidedPayments++;
      }
      txn.update(billRef, {
        status: "voided",
        voidReason: input.reason,
        voidedAt: now,
        voidedBy: ctx.callerUid,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });
      return { billId: snap.id, status: "voided", reversedStockLines: stockItems.length, voidedPayments };
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

// ---------------------------------------------------------------------------
// billsPreview: read-only POS pricing preview
// ---------------------------------------------------------------------------

export const billsPreview = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(PreviewBillSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [
      AppPermissions.BILL_VIEW,
      AppPermissions.BILL_VIEW_ALL,
      AppPermissions.SALE_VIEW,
      AppPermissions.BILL_CREATE,
      AppPermissions.SALE_CREATE,
    ],
  });

  const currency = ctx.organization.currency || "INR";
  const priced = await priceBillLines(ctx, input.items, currency, { allowWarnings: true });
  const totals = billTotals(ctx, priced, input.discountTotal, currency);

  const warnings: Array<{
    type: "stock_shortfall" | "discount_ceiling" | "non_discountable";
    lineId?: string;
    productId?: string;
    message: string;
  }> = [];

  for (const name of priced.nonDiscountableBreaches) {
    warnings.push({
      type: "non_discountable",
      message: `Product "${name}" is not eligible for discounts.`,
    });
  }

  for (const name of priced.discountBreaches) {
    warnings.push({
      type: "discount_ceiling",
      message: `Discount on "${name}" exceeds the maximum allowable discount.`,
    });
  }

  // Stock check for items that track stock
  const trackedItems = priced.items.filter((i) => i.trackStock !== false);
  if (trackedItems.length > 0) {
    const balanceRefs = trackedItems.map((i) =>
      db.collection("stockBalances").doc(`${ctx.organizationId}_${ctx.branchId}_${i.productId}`)
    );
    const balanceSnaps = await db.getAll(...balanceRefs);
    balanceSnaps.forEach((snap, idx) => {
      const item = trackedItems[idx];
      const balData = snap.exists ? (snap.data() as StockBalanceDoc) : null;
      const currentStock = balData?.currentStock || 0;
      const allocatedStock = balData?.allocatedStock || 0;
      const available = Money.qty(currentStock - allocatedStock);
      const requested = item.baseQuantity ?? item.quantity;
      if (requested > available) {
        warnings.push({
          type: "stock_shortfall",
          lineId: item.lineId,
          productId: item.productId,
          message: `Stock shortfall for product "${item.productId}": required ${requested}, available ${available}.`,
        });
      }
    });
  }

  return {
    items: priced.items,
    subTotal: priced.subTotal,
    taxTotal: priced.taxTotal,
    discountTotal: totals.discountTotal,
    totalAmount: totals.totalAmount,
    roundOff: totals.roundOff,
    taxSnapshot: totals.taxSnapshot,
    currency,
    warnings,
  };
});
