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
} from "../../types/models.js";
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
import { Money, round2 } from "../../services/money.js";
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
  const totalAmount = Money.roundCurrency(rawTotal, currency);

  const taxLines = priced.items.map((item) => ({
    taxableAmount: item.subtotal - item.discountValue,
    taxRatePercent: item.taxAmount > 0 && (item.subtotal - item.discountValue) > 0
      ? round2((item.taxAmount / (item.subtotal - item.discountValue)) * 100)
      : 0,
    taxCode: item.taxCodeSnapshot,
    isTaxable: item.taxAmount > 0,
  }));

  const taxResult = calculateTax({
    taxRegimeCode: ctx.organization.taxRegimeCode,
    country: ctx.organization.country,
    subTotal: priced.subTotal - discountTotal,
    lines: taxLines.length > 0 ? taxLines : undefined,
    isInterState,
  });

  return { discountTotal, totalAmount, roundOff: Money.roundCurrency(totalAmount - rawTotal, currency), taxSnapshot: taxResult.taxSnapshot };
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
        const prep = await prepareAccountTransactionInTxn(txn, {
          organizationId: orgId,
          financialAccountId: split.financialAccountId,
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
        splitPreps.push({ prep, accountId: split.financialAccountId, method: split.method, amount: split.amount });
      }
    }
  } else if (p.paidAmount > 0 && p.financialAccountId) {
    const singlePrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: p.financialAccountId,
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
    splitPreps.push({ prep: singlePrep, accountId: p.financialAccountId, method: p.paymentMethod, amount: p.paidAmount });
  }

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
