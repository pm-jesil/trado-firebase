/**
 * Shared Billing & Sales Engine - Query Callables
 *
 * - billsList: Paged, filtered list of bills
 * - billsGet: Single bill retrieval with line serials, delivery progress, and hydrated references
 * - billsPreview: Read-only pricing preview for checkout calculation
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { db } from "../../services/firebase.js";
import {
  ListBillsSchema,
  GetBillSchema,
  PreviewBillSchema,
} from "../../validation/schemas.js";
import { parseInput } from "../../validation/parseInput.js";
import {
  BillDoc,
  DeliveryDoc,
  StockBalanceDoc,
} from "../../types/models.js";
import { AppPermissions } from "../../constants/permissions.js";
import { Money, requireCurrency } from "../../services/money.js";
import {
  resolveRequestContext,
  resolveDataScope,
  applyDataScope,
  isInDataScope,
} from "../../services/contextResolver.js";
import { redactBill } from "../../services/redaction.js";
import { hydrate } from "../../services/hydration.js";
import { deliveryProgress } from "../../services/deliveryProgress.js";
import { serialsOf, linesFromRegistry } from "../../services/serials.js";
import { fetchPage } from "../../services/pagination.js";
import { SALE_READ, priceBillLines, billTotals, buildBillPrintSnapshot } from "./helpers.js";

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
  let items = snapshot.docs
    .map((doc) => ({ billId: doc.id, ...(doc.data() as BillDoc) }))
    .filter((b) => scoped.keep(b as unknown as Record<string, unknown>));

  if (input.startDate) items = items.filter((b) => (b.createdAt || "") >= input.startDate!);
  if (input.endDate) items = items.filter((b) => (b.createdAt || "") <= input.endDate!);
  if (input.minAmount !== undefined) items = items.filter((b) => (b.totalAmount || 0) >= input.minAmount!);
  if (input.maxAmount !== undefined) items = items.filter((b) => (b.totalAmount || 0) <= input.maxAmount!);
  if (input.search) {
    const s = input.search.toLowerCase();
    items = items.filter((b) =>
      (b.billNumber || "").toLowerCase().includes(s) ||
      (b.notes || "").toLowerCase().includes(s) ||
      (b.billToSnapshot?.name || "").toLowerCase().includes(s)
    );
  }

  const redacted = items.map((b) => redactBill(b as unknown as Record<string, unknown>, ctx));
  return { items: redacted, count: redacted.length, scope: scope.level, nextCursor, included: await hydrate(ctx, redacted) };
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
  const printSnapshot = buildBillPrintSnapshot(ctx.organization, data);
  return { ...bill, serialsByLine, delivery, included: await hydrate(ctx, [bill]), printSnapshot };
});

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

  const currency = requireCurrency(ctx.organization.currency, `organization "${ctx.organizationId}"`);
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

  const printSnapshot = buildBillPrintSnapshot(ctx.organization, {
    items: priced.items,
    subTotal: priced.subTotal,
    taxTotal: priced.taxTotal,
    discountTotal: totals.discountTotal,
    totalAmount: totals.totalAmount,
    roundOff: totals.roundOff,
    taxSnapshot: totals.taxSnapshot,
    salesMode: input.salesMode || "pos",
    documentType: input.documentType || "invoice",
  });

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
    printSnapshot,
  };
});
