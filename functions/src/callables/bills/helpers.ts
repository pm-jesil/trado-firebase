/**
 * Shared Billing & Sales Engine - Helpers, Pricing & Transaction Preparation
 */

import { HttpsError } from "firebase-functions/v2/https";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "../../services/firebase.js";
import {
  CreateBillSchema,
} from "../../validation/schemas.js";
import {
  BillItem,
  BillToSnapshot,
  ProductDoc,
  PaymentDoc,
  CustomerDoc,
  SplitPaymentEntry,
  OrganizationDoc,
  BankAccountRecord,
  TaxSnapshot,
  TaxBreakdownItem,
} from "../../types/models.js";
import { maskBankAccounts } from "../organizations.js";
import { resolveAccount } from "../../services/accountResolver.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../../services/ledgerService.js";
import {
  PaymentStatus,
  StockMovementType,
  PaymentDirection,
  PartyType,
  PaymentMethod,
} from "../../constants/enums.js";
import { AppPermissions } from "../../constants/permissions.js";
import { Money, roundTo } from "../../services/money.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../../services/documentCounter.js";
import { calculateTax } from "../../services/taxCalculation.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  prepareReservationInTxn,
  commitReservationInTxn,
  resolveUnitConversion,
  StockChangeItem,
} from "../../services/stockEngine.js";
import {
  type RequestContext,
} from "../../services/contextResolver.js";
import { SerialLine } from "../../services/serials.js";

export const SALE_CREATE = [AppPermissions.BILL_CREATE, AppPermissions.SALE_CREATE];
export const SALE_READ = [AppPermissions.BILL_VIEW, AppPermissions.BILL_VIEW_ALL, AppPermissions.SALE_VIEW];

export type BillInput = ReturnType<typeof CreateBillSchema.parse>;

export interface PricedBill {
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

export async function priceBillLines(
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
      costSnapshot: Money.rate(baseUnitCost * conv.factor),
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

export function billTotals(
  ctx: RequestContext,
  priced: PricedBill,
  discountInput: number | undefined,
  currency: string,
  isInterState?: boolean
) {
  const discountTotal = Money.amount(Math.min(priced.subTotal, discountInput || 0), currency);
  if (discountTotal > 0 && !ctx.can(AppPermissions.BILL_DISCOUNT)) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Bill-level discounts require bill:discount.", { reason: "PERMISSION_DENIED" });
  }
  const rawTotal = Money.subtract(priced.subTotal, discountTotal, currency) + priced.taxTotal;
  const totalAmount = Money.amount(rawTotal, currency);

  const taxLines = priced.items.map((item) => ({
    taxableAmount: item.subtotal - item.discountValue,
    taxRatePercent: item.taxAmount > 0 && (item.subtotal - item.discountValue) > 0
      ? roundTo((item.taxAmount / (item.subtotal - item.discountValue)) * 100, 2)
      : 0,
    taxCode: item.taxCodeSnapshot,
    isTaxable: item.taxAmount > 0,
  }));

  const taxResult = calculateTax({
    currency,
    taxRegimeCode: ctx.organization.taxRegimeCode,
    country: ctx.organization.country,
    subTotal: priced.subTotal - discountTotal,
    lines: taxLines.length > 0 ? taxLines : undefined,
    isInterState,
  });

  return { discountTotal, totalAmount, roundOff: Money.amount(totalAmount - rawTotal, currency), taxSnapshot: taxResult.taxSnapshot };
}

export function stockOutItems(billId: string, items: BillItem[], reason: string, storageLocationId?: string): StockChangeItem[] {
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
      storageLocationId,
      reason,
    }));
}

export function reservationLines(items: BillItem[]) {
  return items.filter((i) => i.trackStock !== false).map((i) => ({ productId: i.productId, baseQuantity: i.baseQuantity ?? i.quantity }));
}

export interface SaleEffectsParams {
  ctx: RequestContext;
  billId: string;
  branchId: string;
  items: BillItem[];
  customerId?: string | null;
  totalAmount: number;
  balanceAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  financialAccountId?: string | null;
  splitPayments?: SplitPaymentEntry[];
  storageLocationId?: string;
  stockReason: string;
  releaseReservation?: boolean;
}

export async function prepareSaleEffects(txn: Transaction, p: SaleEffectsParams) {
  const orgId = p.ctx.organizationId;
  const paymentReservation = p.paidAmount > 0
    ? await readNextDocumentNumberInTxn(txn, { organizationId: orgId, type: "PAY" })
    : null;
  const reservation = p.releaseReservation
    ? await prepareReservationInTxn(txn, { organizationId: orgId, branchId: p.branchId, lines: reservationLines(p.items), direction: -1 })
    : null;
  const stockItems = stockOutItems(p.billId, p.items, p.stockReason, p.storageLocationId);
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

  const splitPreps: Array<{
    prep: Awaited<ReturnType<typeof prepareAccountTransactionInTxn>>;
    accountId: string;
    method: PaymentMethod;
    amount: number;
  }> = [];

  if (p.splitPayments && p.splitPayments.length > 0) {
    for (const split of p.splitPayments) {
      if (split.amount > 0) {
        let splitAccountId = split.financialAccountId;
        if (!splitAccountId) {
          const resolved = await resolveAccount({
            organizationId: orgId,
            branchId: p.branchId,
            paymentMethod: split.method,
          }, txn);
          splitAccountId = resolved.id;
        }
        const prep = await prepareAccountTransactionInTxn(txn, {
          organizationId: orgId,
          financialAccountId: splitAccountId,
          branchId: p.branchId,
          type: "sale_collection",
          direction: "in",
          amount: split.amount,
          sourceDocumentType: "bill",
          sourceDocumentId: p.billId,
          partyType: p.customerId ? "customer" : null,
          partyId: p.customerId || null,
          description: `Sale ${p.billId} (${split.method})`,
          actorUid: p.ctx.callerUid,
        });
        splitPreps.push({ prep, accountId: splitAccountId, method: split.method, amount: split.amount });
      }
    }
  } else if (p.paidAmount > 0) {
    let targetAccountId = p.financialAccountId;
    if (!targetAccountId) {
      const resolved = await resolveAccount({
        organizationId: orgId,
        branchId: p.branchId,
        paymentMethod: p.paymentMethod || "cash",
      }, txn);
      targetAccountId = resolved.id;
    }
    const singlePrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: targetAccountId,
      branchId: p.branchId,
      type: "sale_collection",
      direction: "in",
      amount: p.paidAmount,
      sourceDocumentType: "bill",
      sourceDocumentId: p.billId,
      partyType: p.customerId ? "customer" : null,
      partyId: p.customerId || null,
      description: `Sale ${p.billId}`,
      actorUid: p.ctx.callerUid,
    });
    splitPreps.push({ prep: singlePrep, accountId: targetAccountId, method: p.paymentMethod || "cash", amount: p.paidAmount });
  }

  return (): { paymentId: string | null; billToSnapshot: BillToSnapshot | null } => {
    const now = new Date().toISOString();
    if (reservation) commitReservationInTxn(txn, reservation, p.ctx.callerUid);
    if (preparedStock) commitStockChangesInTxn(txn, preparedStock);
    if (customerRef && customerSnap?.exists) {
      const cust = customerSnap.data() as CustomerDoc;
      const currency = p.ctx.organization.currency;
      txn.update(customerRef, {
        totalSpend: Money.amount((cust.totalSpend || 0) + p.totalAmount, currency),
        outstandingBalance: Money.amount((cust.outstandingBalance || 0) + p.balanceAmount, currency),
        updatedAt: now,
      });
    }

    for (const sp of splitPreps) {
      applyAccountTransactionInTxn(txn, sp.prep, {
        organizationId: orgId,
        financialAccountId: sp.accountId,
        branchId: p.branchId,
        type: "sale_collection",
        direction: "in",
        amount: sp.amount,
        sourceDocumentType: "bill",
        sourceDocumentId: p.billId,
        partyType: p.customerId ? "customer" : null,
        partyId: p.customerId || null,
        description: `Sale ${p.billId} (${sp.method})`,
        actorUid: p.ctx.callerUid,
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
        financialAccountId: p.financialAccountId || (p.splitPayments?.[0]?.financialAccountId ?? null),
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

export function billToFromCustomer(snap: FirebaseFirestore.DocumentSnapshot | null): BillToSnapshot | null {
  if (!snap?.exists) return null;
  const c = snap.data() as CustomerDoc;
  const out: BillToSnapshot = { name: c.name };
  if (c.phone) {
    out.phone = c.phone ?? undefined;
  }
  if (c.taxId) {
    out.taxId = c.taxId;
  }
  const billingAddr = c.addresses?.find((a) => a.isDefaultBilling) ?? c.addresses?.[0];
  if (billingAddr) {
    out.billingAddress = [billingAddr.line1, billingAddr.line2, billingAddr.city, billingAddr.state, billingAddr.postalCode]
      .filter(Boolean).join(", ");
  }
  return out;
}

export function paymentStatusFor(total: number, paid: number): PaymentStatus {
  if (paid >= total && total > 0) return PaymentStatus.PAID;
  if (paid > 0) return PaymentStatus.PARTIAL;
  return total === 0 ? PaymentStatus.PAID : PaymentStatus.PENDING;
}

export async function markIdempotencySucceeded(recordId: string | undefined | null, result: unknown) {
  if (!recordId) return;
  await db.collection("idempotencyRecords").doc(recordId).update({
    status: "succeeded",
    result,
    updatedAt: new Date().toISOString(),
  });
}

export interface BillPrintSnapshot {
  version: 1;
  invoiceTitle: string;
  organization: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: Record<string, unknown> | null;
    contactPhone: string | null;
    contactEmail: string | null;
    bankAccounts: Array<{
      id?: string;
      bankName: string;
      accountNumber: string; // masked (****1234)
      routingType?: string;
      routingCode?: string | null;
      accountHolderName?: string;
    }>;
  };
  customer: BillToSnapshot | null;
  billNumber: string;
  issueDate: string;
  salesMode: string;
  documentType: string;
  items: Array<{
    lineId: string;
    productId: string;
    name: string;
    sku: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountAmount: number;
    taxAmount: number;
    taxRatePercent?: number;
    totalAmount: number;
  }>;
  totals: {
    subTotal: number;
    discountTotal: number;
    taxTotal: number;
    roundOff: number;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
  };
  taxBreakdown: Array<{
    name: string;
    ratePercent: number;
    taxableAmount: number;
    taxAmount: number;
  }>;
}

export function buildBillPrintSnapshot(
  orgDoc: Partial<OrganizationDoc> | undefined | null,
  bill: {
    billNumber?: string;
    salesMode?: string;
    documentType?: string;
    status?: string;
    createdAt?: string;
    finalizedAt?: string;
    billToSnapshot?: BillToSnapshot | null;
    items?: Array<Partial<BillItem> & { name?: string; sku?: string | null; unitPrice?: number; discountAmount?: number; taxRatePercent?: number; totalAmount?: number }>;
    subTotal?: number;
    discountTotal?: number;
    taxTotal?: number;
    roundOff?: number;
    totalAmount?: number;
    paidAmount?: number;
    balanceAmount?: number;
    taxSnapshot?: TaxSnapshot | {
      labels?: { invoiceTitle?: string; taxName?: string };
      invoiceTitle?: string;
      taxName?: string;
      taxRatePercent?: number;
      breakdown?: TaxBreakdownItem[];
      slabs?: Array<{ name: string; rate?: number; ratePercent?: number; taxableAmount?: number; amount?: number; taxAmount?: number }>;
    } | null;
  }
): BillPrintSnapshot {
  const org = orgDoc || {};
  const maskedAccounts = Array.isArray(org.bankAccounts)
    ? maskBankAccounts(org.bankAccounts, { preserveForInvoicePrint: true }).map((a: BankAccountRecord) => ({
      id: a.id,
      bankName: a.bankName || "",
      accountHolderName: a.accountHolderName || "",
      accountNumber: a.accountNumber || "",
      routingType: a.routingType || "other",
      routingCode: a.routingCode || null,
    }))
    : [];

  const invoiceTitle = bill.taxSnapshot?.labels?.invoiceTitle ||
    ("invoiceTitle" in (bill.taxSnapshot || {}) ? (bill.taxSnapshot as { invoiceTitle?: string }).invoiceTitle : null) ||
    (bill.documentType === "quotation" ? "QUOTATION" :
      bill.documentType === "proforma" ? "PROFORMA INVOICE" :
        bill.documentType === "receipt" ? "SALES RECEIPT" :
          bill.salesMode === "b2b" ? "TAX INVOICE" : "RETAIL INVOICE");

  const items = (bill.items || []).map((item) => ({
    lineId: item.lineId || "L1",
    productId: item.productId || "",
    name: item.name || "",
    sku: item.sku || null,
    quantity: item.quantity ?? 1,
    unit: item.unit || "pcs",
    unitPrice: item.unitPrice ?? item.priceSnapshot ?? 0,
    discountAmount: item.discountAmount ?? item.discountValue ?? 0,
    taxAmount: item.taxAmount || 0,
    taxRatePercent: item.taxRatePercent || 0,
    totalAmount: item.totalAmount ?? item.lineTotal ?? 0,
  }));

  const subTotal = bill.subTotal ?? items.reduce((s, i) => s + (i.unitPrice * i.quantity), 0);
  const discountTotal = bill.discountTotal ?? items.reduce((s, i) => s + i.discountAmount, 0);
  const taxTotal = bill.taxTotal ?? items.reduce((s, i) => s + i.taxAmount, 0);
  const totalAmount = bill.totalAmount ?? (subTotal - discountTotal + taxTotal);
  const paidAmount = bill.paidAmount ?? 0;
  const balanceAmount = bill.balanceAmount ?? (totalAmount - paidAmount);

  const taxBreakdown: Array<{ name: string; ratePercent: number; taxableAmount: number; taxAmount: number }> = [];
  const rawBreakdown = bill.taxSnapshot?.breakdown ||
    ("slabs" in (bill.taxSnapshot || {}) ? (bill.taxSnapshot as { slabs?: Array<{ name: string; rate?: number; ratePercent?: number; taxableAmount?: number; amount?: number; taxAmount?: number }> }).slabs : null);
  if (rawBreakdown && Array.isArray(rawBreakdown)) {
    for (const slab of rawBreakdown) {
      const rateVal = "ratePercent" in slab && slab.ratePercent !== undefined ? slab.ratePercent : ("rate" in slab ? slab.rate : 0);
      const amtVal = slab.amount ?? ("taxAmount" in slab ? (slab as { taxAmount?: number }).taxAmount : 0) ?? 0;
      taxBreakdown.push({
        name: slab.name || "Tax",
        ratePercent: rateVal ?? 0,
        taxableAmount: slab.taxableAmount || (subTotal - discountTotal),
        taxAmount: amtVal,
      });
    }
  } else if (taxTotal > 0) {
    taxBreakdown.push({
      name: bill.taxSnapshot?.labels?.taxName || ("taxName" in (bill.taxSnapshot || {}) ? (bill.taxSnapshot as { taxName?: string }).taxName : null) || "Tax",
      ratePercent: bill.taxSnapshot?.taxRatePercent || 0,
      taxableAmount: subTotal - discountTotal,
      taxAmount: taxTotal,
    });
  }

  return {
    version: 1,
    invoiceTitle,
    organization: {
      name: org.name || "",
      legalName: org.legalName || org.name || null,
      taxId: org.taxId || null,
      address: org.address || (Array.isArray(org.addresses) && org.addresses[0] ? org.addresses[0] : null) || null,
      contactPhone: org.contactPhone || null,
      contactEmail: org.contactEmail || null,
      bankAccounts: maskedAccounts,
    },
    customer: bill.billToSnapshot || null,
    billNumber: bill.billNumber || "PREVIEW",
    issueDate: (bill.finalizedAt || bill.createdAt || new Date().toISOString()).slice(0, 10),
    salesMode: bill.salesMode || "pos",
    documentType: bill.documentType || "invoice",
    items,
    totals: {
      subTotal,
      discountTotal,
      taxTotal,
      roundOff: bill.roundOff || 0,
      totalAmount,
      paidAmount,
      balanceAmount,
    },
    taxBreakdown,
  };
}

export interface PaymentPrintSnapshot {
  version: 1;
  voucherTitle: string; // "PAYMENT RECEIPT" | "PAYMENT VOUCHER"
  organization: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: Record<string, unknown> | null;
    contactPhone: string | null;
    contactEmail: string | null;
    bankAccounts: Array<{
      id?: string;
      bankName: string;
      accountNumber: string; // masked (****1234)
      routingType?: string;
      routingCode?: string | null;
      accountHolderName?: string;
    }>;
  };
  party: {
    name: string;
    partyType: string;
    phone?: string | null;
    taxId?: string | null;
  } | null;
  paymentNumber: string;
  issueDate: string; // 10-char YYYY-MM-DD
  direction: string;
  paymentMethod: string;
  amount: number;
  referenceId?: string | null;
  allocations: Array<{
    documentId: string;
    documentType: string;
    amount: number;
  }>;
  notes: string | null;
}

export function buildPaymentPrintSnapshot(
  orgDoc: Partial<OrganizationDoc> | undefined | null,
  payment: {
    paymentNumber?: string;
    direction?: string;
    partyName?: string;
    partyType?: string;
    partyPhone?: string | null;
    partyTaxId?: string | null;
    amount?: number;
    method?: string;
    referenceId?: string | null;
    allocations?: Array<{ documentId: string; documentType: string; amount: number }>;
    notes?: string | null;
    createdAt?: string;
  }
): PaymentPrintSnapshot {
  const org = orgDoc || {};
  const maskedAccounts = Array.isArray(org.bankAccounts)
    ? maskBankAccounts(org.bankAccounts, { preserveForInvoicePrint: true }).map((a: BankAccountRecord) => ({
      id: a.id,
      bankName: a.bankName || "",
      accountHolderName: a.accountHolderName || "",
      accountNumber: a.accountNumber || "",
      routingType: a.routingType || "other",
      routingCode: a.routingCode || null,
    }))
    : [];

  const direction = payment.direction || "in";
  const voucherTitle = direction === "in" ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER";

  return {
    version: 1,
    voucherTitle,
    organization: {
      name: org.name || "",
      legalName: org.legalName || org.name || null,
      taxId: org.taxId || null,
      address: org.address || (Array.isArray(org.addresses) && org.addresses[0] ? org.addresses[0] : null) || null,
      contactPhone: org.contactPhone || null,
      contactEmail: org.contactEmail || null,
      bankAccounts: maskedAccounts,
    },
    party: payment.partyName ? {
      name: payment.partyName,
      partyType: payment.partyType || "other",
      phone: payment.partyPhone || null,
      taxId: payment.partyTaxId || null,
    } : null,
    paymentNumber: payment.paymentNumber || "PREVIEW",
    issueDate: (payment.createdAt || new Date().toISOString()).slice(0, 10),
    direction,
    paymentMethod: payment.method || "cash",
    amount: payment.amount || 0,
    referenceId: payment.referenceId || null,
    allocations: payment.allocations || [],
    notes: payment.notes || null,
  };
}

export interface CreditNotePrintSnapshot {
  version: 1;
  documentTitle: string; // "CREDIT NOTE" | "DEBIT NOTE"
  organization: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: Record<string, unknown> | null;
    contactPhone: string | null;
    contactEmail: string | null;
    bankAccounts: Array<{
      id?: string;
      bankName: string;
      accountNumber: string; // masked (****1234)
      routingType?: string;
      routingCode?: string | null;
      accountHolderName?: string;
    }>;
  };
  customer: {
    name: string;
    phone?: string | null;
    taxId?: string | null;
    address?: string | null;
  } | null;
  returnNumber: string;
  issueDate: string; // 10-char YYYY-MM-DD
  returnType: string;
  referenceId: string;
  items: Array<{
    lineId: string;
    productId: string;
    name?: string;
    quantity: number;
    unitPrice?: number;
    refundAmount: number;
    reason: string;
    disposition: string;
  }>;
  totalRefundAmount: number;
  refundMethod: string;
  notes: string | null;
}

export function buildCreditNotePrintSnapshot(
  orgDoc: Partial<OrganizationDoc> | undefined | null,
  returnDoc: {
    returnNumber?: string;
    returnType?: string;
    referenceId?: string;
    customerSnapshot?: { name: string; phone?: string | null; taxId?: string | null; address?: string | null } | null;
    items?: Array<{
      sourceLineId?: string;
      productId: string;
      name?: string;
      quantity: number;
      unitPrice?: number;
      refundAmount: number;
      reason?: string;
      disposition?: string;
    }>;
    totalRefundAmount?: number;
    refundMethod?: string;
    notes?: string | null;
    createdAt?: string;
  }
): CreditNotePrintSnapshot {
  const org = orgDoc || {};
  const maskedAccounts = Array.isArray(org.bankAccounts)
    ? maskBankAccounts(org.bankAccounts, { preserveForInvoicePrint: true }).map((a: BankAccountRecord) => ({
      id: a.id,
      bankName: a.bankName || "",
      accountHolderName: a.accountHolderName || "",
      accountNumber: a.accountNumber || "",
      routingType: a.routingType || "other",
      routingCode: a.routingCode || null,
    }))
    : [];

  const isSalesReturn = returnDoc.returnType === "sales_return" || !returnDoc.returnType;
  const documentTitle = isSalesReturn ? "CREDIT NOTE" : "DEBIT NOTE";

  return {
    version: 1,
    documentTitle,
    organization: {
      name: org.name || "",
      legalName: org.legalName || org.name || null,
      taxId: org.taxId || null,
      address: org.address || (Array.isArray(org.addresses) && org.addresses[0] ? org.addresses[0] : null) || null,
      contactPhone: org.contactPhone || null,
      contactEmail: org.contactEmail || null,
      bankAccounts: maskedAccounts,
    },
    customer: returnDoc.customerSnapshot || null,
    returnNumber: returnDoc.returnNumber || "PREVIEW",
    issueDate: (returnDoc.createdAt || new Date().toISOString()).slice(0, 10),
    returnType: returnDoc.returnType || "sales_return",
    referenceId: returnDoc.referenceId || "",
    items: (returnDoc.items || []).map((it, idx) => ({
      lineId: it.sourceLineId || `ret_line_${idx + 1}`,
      productId: it.productId,
      name: it.name || "Item",
      quantity: it.quantity,
      unitPrice: it.unitPrice || 0,
      refundAmount: it.refundAmount || 0,
      reason: it.reason || "Return",
      disposition: it.disposition || "restocked_to_inventory",
    })),
    totalRefundAmount: returnDoc.totalRefundAmount || 0,
    refundMethod: returnDoc.refundMethod || "credit_note",
    notes: returnDoc.notes || null,
  };
}
