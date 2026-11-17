/**
 * Reports & Analytics Callables
 * 
 * Provides read/aggregation services over existing source-of-truth collections:
 * - `reportsGetRevenue`: Revenue & sales trend (uses dailySummaries or source bills)
 * - `reportsGetProfitLoss`: Full P&L (revenue - COGS - expenses)
 * - `reportsGetStockValuation`: Inventory valuation at Weighted-Average Cost
 * - `reportsGetTopEntities`: Top products, customers, and vendors
 * - `reportsGetStaffActivity`: Staff sales & activity summary (role-scoped)
 * - `reportsGetPlatformOverview`: Super Admin platform-wide metric overview
 * - `reportsExportCsv`: Scoped CSV data export
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { resolveRequestContext, resolveDataScope } from "../services/contextResolver.js";
import { DEFAULT_ORG_TIMEZONE, localDateInTimezone } from "../services/subscription.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  GetRevenueReportSchema,
  GetProfitLossReportSchema,
  GetStockValuationReportSchema,
  GetTopEntitiesReportSchema,
  GetStaffReportSchema,
  GetPlatformOverviewReportSchema,
  ExportReportSchema,
  PartyStatementSchema,
  OutflowSummarySchema,
  GetReceivablesAgeingReportSchema,
  GetPayablesAgeingReportSchema,
  GetCashBankSummarySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { calculateStockValuation } from "../services/costingEngine.js";
import { round2, roundTo } from "../services/money.js";
import { hydrate } from "../services/hydration.js";
import {
  ProductDoc,
  BillDoc,
  OutflowDoc,
  DailySummaryDoc,
  ReturnDoc,
  StockMovementDoc,
  PaymentDoc,
  DeliveryDoc,
  TaskDoc,
  OrganizationDoc,
  StockBalanceDoc,
  AuditLogDoc,
  FinancialAccountDoc,
  PaymentProcessingFeeDoc,
} from "../types/models.js";
import { ReturnType, ReturnDisposition, StockMovementType } from "../constants/enums.js";

/** Outward stock movements that are inventory losses (not sales, not returns to vendor). */
const WRITE_OFF_MOVEMENT_TYPES = [StockMovementType.DAMAGE_OUT, StockMovementType.ADJUSTMENT_OUT];

/**
 * Helper to convert array of flat objects to CSV format.
 */
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((header) => {
      const val = row[header] ?? "";
      const escaped = String(val).replace(/"/g, "\"\"");
      return `"${escaped}"`;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

/** Bills that count as sales in a period (one query shape for every report). */
function billsInPeriod(orgId: string, period: { branchId?: string; from?: string; to?: string }): FirebaseFirestore.Query {
  let q: FirebaseFirestore.Query = db.collection("bills").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]);
  if (period.branchId) q = q.where("branchId", "==", period.branchId);
  if (period.from) q = q.where("createdAt", ">=", period.from);
  if (period.to) q = q.where("createdAt", "<=", `${period.to}T23:59:59.999Z`);
  return q;
}

/** Bill lines keyed "${billId}#${lineId}" for the given bills (one batched read). */
async function sourceLinesById(billIds: string[]): Promise<Map<string, BillDoc["items"][number]>> {
  const ids = Array.from(new Set(billIds.filter(Boolean)));
  const out = new Map<string, BillDoc["items"][number]>();
  if (!ids.length) return out;
  const snaps = await db.getAll(...ids.map((id) => db.collection("bills").doc(id)));
  for (const snap of snaps) {
    if (!snap.exists) continue;
    for (const line of (snap.data() as BillDoc).items || []) out.set(`${snap.id}#${line.lineId}`, line);
  }
  return out;
}

/** Quantity (base units) and revenue per product across bills. */
function productSalesTotals(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Map<string, { productId: string; quantity: number; revenue: number }> {
  const stats = new Map<string, { productId: string; quantity: number; revenue: number }>();
  for (const doc of docs) {
    for (const item of (doc.data() as BillDoc).items || []) {
      const row = stats.get(item.productId) || { productId: item.productId, quantity: 0, revenue: 0 };
      row.quantity += item.baseQuantity ?? item.quantity ?? 0;
      row.revenue += item.subtotal || 0;
      stats.set(item.productId, row);
    }
  }
  return stats;
}

/** Profit & loss for a period: the single implementation behind reportsGetProfitLoss and the P&L CSV. */
export async function computeProfitLoss(orgId: string, validated: {
  branchId?: string;
  from?: string;
  to?: string;
  periodType?: "day" | "week" | "month" | "year" | "custom";
  periodValue?: string;
  comparePreviousPeriod?: boolean;
}) {
  const targetBranchId = validated.branchId;

  // Load organization configuration (timezone, financial year start, currency decimals)
  const orgDoc = await db.collection("organizations").doc(orgId).get();
  const orgData = (orgDoc.exists ? orgDoc.data() : {}) as OrganizationDoc;
  const tz = orgData.timezone || DEFAULT_ORG_TIMEZONE;
  const fyStartMonth = (orgData as unknown as { financialYearStartMonth?: number }).financialYearStartMonth || 4;
  const decimals = orgData.currencyDecimals ?? 2;

  let effectiveFrom = validated.from;
  let effectiveTo = validated.to;

  // Resolve period boundaries if periodType is specified
  if (validated.periodType && validated.periodType !== "custom") {
    const now = new Date();
    const todayStr = localDateInTimezone(now.getTime(), tz);
    if (validated.periodType === "day") {
      effectiveFrom = validated.periodValue || todayStr;
      effectiveTo = effectiveFrom;
    } else if (validated.periodType === "month") {
      const monthPrefix = validated.periodValue || todayStr.slice(0, 7);
      effectiveFrom = `${monthPrefix}-01`;
      const [y, m] = monthPrefix.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      effectiveTo = `${monthPrefix}-${String(lastDay).padStart(2, "0")}`;
    } else if (validated.periodType === "year") {
      const targetYear = validated.periodValue ? parseInt(validated.periodValue, 10) : parseInt(todayStr.slice(0, 4), 10);
      effectiveFrom = `${targetYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
      const endYear = fyStartMonth === 1 ? targetYear : targetYear + 1;
      const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
      const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
      effectiveTo = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }

  const periodParams = { branchId: targetBranchId, from: effectiveFrom, to: effectiveTo };
  const billsQuery = billsInPeriod(orgId, periodParams);

  // Read outflows for operational expenses
  let outflowsQuery = db
    .collection("outflows")
    .where("organizationId", "==", orgId)
    .where("status", "==", "confirmed");

  if (targetBranchId) {
    outflowsQuery = outflowsQuery.where("branchId", "==", targetBranchId);
  }
  if (effectiveFrom) {
    outflowsQuery = outflowsQuery.where("createdAt", ">=", effectiveFrom);
  }
  if (effectiveTo) {
    outflowsQuery = outflowsQuery.where("createdAt", "<=", `${effectiveTo}T23:59:59.999Z`);
  }

  let feesQuery = db
    .collection("paymentProcessingFees")
    .where("organizationId", "==", orgId);

  if (targetBranchId) {
    feesQuery = feesQuery.where("branchId", "==", targetBranchId);
  }
  if (effectiveFrom) {
    feesQuery = feesQuery.where("createdAt", ">=", effectiveFrom);
  }
  if (effectiveTo) {
    feesQuery = feesQuery.where("createdAt", "<=", `${effectiveTo}T23:59:59.999Z`);
  }

  const [billsSnap, outflowsSnap, returnsSnap, writeOffSnap, feesSnap] = await Promise.all([
    billsQuery.get(),
    outflowsQuery.get(),
    db.collection("returns").where("organizationId", "==", orgId).where("returnType", "==", ReturnType.SALES_RETURN).get(),
    db.collection("stockMovements")
      .where("organizationId", "==", orgId)
      .where("type", "in", WRITE_OFF_MOVEMENT_TYPES)
      .get(),
    feesQuery.get(),
  ]);

  let grossRevenue = 0;
  let grossCogs = 0;
  let billCount = 0;
  let totalTax = 0;
  let totalDiscounts = 0;

  billsSnap.docs.forEach((doc) => {
    const bill = doc.data() as BillDoc;
    grossRevenue += bill.totalAmount || 0;
    totalTax += bill.taxTotal || 0;
    totalDiscounts += bill.discountTotal || 0;
    billCount++;

    if (Array.isArray(bill.items)) {
      bill.items.forEach((item) => {
        grossCogs += (item.quantity || 0) * (item.costSnapshot || 0);
      });
    }
  });

  let salesReturns = 0;
  let cogsReversals = 0;
  let returnCount = 0;

  const inPeriodReturns = returnsSnap.docs.map((d) => d.data() as ReturnDoc).filter((ret) =>
    ret.status !== "voided" &&
    !(targetBranchId && ret.branchId && ret.branchId !== targetBranchId) &&
    !(effectiveFrom && ret.createdAt < effectiveFrom) &&
    !(effectiveTo && ret.createdAt > `${effectiveTo}T23:59:59.999Z`));
  const sourceBills = await sourceLinesById(inPeriodReturns.map((r) => r.referenceId));
  inPeriodReturns.forEach((ret) => {
    salesReturns += ret.totalRefundAmount || 0;
    returnCount++;
    for (const item of ret.items || []) {
      if (item.disposition !== ReturnDisposition.RESTOCKED_TO_INVENTORY) continue;
      const line = sourceBills.get(`${ret.referenceId}#${item.sourceLineId}`);
      const costPerBase = line ? (line.costSnapshot || 0) / (line.conversionFactor || 1) : 0;
      cogsReversals += (item.baseQuantity || 0) * costPerBase;
    }
  });

  grossRevenue = roundTo(grossRevenue, decimals);
  salesReturns = roundTo(salesReturns, decimals);
  const netRevenue = roundTo(Math.max(0, grossRevenue - salesReturns), decimals);

  grossCogs = roundTo(grossCogs, decimals);
  cogsReversals = roundTo(cogsReversals, decimals);
  const netCogs = roundTo(Math.max(0, grossCogs - cogsReversals), decimals);

  let totalExpenses = 0;
  let outflowCount = 0;
  const expensesByCategory: Record<string, number> = {};

  outflowsSnap.docs.forEach((doc) => {
    const outflow = doc.data() as OutflowDoc;
    if (outflow.kind === "expense") {
      const amt = outflow.totalAmount || 0;
      totalExpenses += amt;
      const cat = outflow.expenseCategoryId || "general";
      expensesByCategory[cat] = roundTo((expensesByCategory[cat] || 0) + amt, decimals);
      outflowCount++;
    } else if (outflow.kind === "purchase") {
      outflowCount++;
    }
  });

  let paymentFeesTotal = 0;
  feesSnap.docs.forEach((doc) => {
    const fee = doc.data() as PaymentProcessingFeeDoc;
    paymentFeesTotal += (fee.feeAmount || 0) + (fee.feeTaxAmount || 0);
  });
  paymentFeesTotal = roundTo(paymentFeesTotal, decimals);
  if (paymentFeesTotal > 0) {
    totalExpenses += paymentFeesTotal;
    expensesByCategory["payment_processing_fees"] = roundTo(
      (expensesByCategory["payment_processing_fees"] || 0) + paymentFeesTotal,
      decimals
    );
  }

  totalExpenses = roundTo(totalExpenses, decimals);

  let inventoryWriteOff = 0;
  let writeOffCount = 0;
  writeOffSnap.docs.forEach((doc) => {
    const mv = doc.data() as StockMovementDoc;
    if (targetBranchId && mv.branchId && mv.branchId !== targetBranchId) return;
    if (effectiveFrom && mv.createdAt < effectiveFrom) return;
    if (effectiveTo && mv.createdAt > `${effectiveTo}T23:59:59.999Z`) return;
    const unitCost = mv.unitCostSnapshot || 0;
    inventoryWriteOff += Math.abs(mv.quantity || 0) * unitCost;
    writeOffCount++;
  });
  inventoryWriteOff = roundTo(inventoryWriteOff, decimals);

  const grossProfit = roundTo(netRevenue - netCogs, decimals);
  const grossMarginPercent = netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : 0;
  const netProfit = roundTo(grossProfit - totalExpenses - inventoryWriteOff, decimals);
  const netMarginPercent = netRevenue > 0 ? round2((netProfit / netRevenue) * 100) : 0;

  return {
    branchId: targetBranchId || null,
    from: effectiveFrom || null,
    to: effectiveTo || null,
    periodType: validated.periodType || "custom",
    timezone: tz,
    currencyDecimals: decimals,
    financialYearStartMonth: fyStartMonth,
    grossRevenue,
    discounts: roundTo(totalDiscounts, decimals),
    tax: roundTo(totalTax, decimals),
    salesReturns,
    netRevenue,
    totalRevenue: netRevenue,
    grossCogs,
    cogsReversals,
    netCogs,
    cogs: netCogs,
    grossProfit,
    grossMarginPercent,
    operatingExpenses: totalExpenses,
    totalExpenses,
    paymentFeesTotal,
    expensesByCategory,
    inventoryWriteOff,
    writeOffCount,
    netProfit,
    netMarginPercent,
    billCount,
    returnCount,
    outflowCount,
    costingMethod: "weighted_average",
  };
}

/**
 * 1. reportsGetRevenue
 */
export const reportsGetRevenue = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.REPORT_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetRevenueReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  let totalRevenue = 0;
  let billCount = 0;
  const breakdown: Array<{ period: string; revenue: number; count: number }> = [];

  // Attempt reading maintained daily summaries first ONLY if no branch filter is active (summaries are org-wide)
  if (!targetBranchId) {
    let summariesQuery = db
      .collection("dailySummaries")
      .where("organizationId", "==", orgId);

    if (validated.from) {
      summariesQuery = summariesQuery.where("date", ">=", validated.from);
    }
    if (validated.to) {
      summariesQuery = summariesQuery.where("date", "<=", validated.to);
    }

    const summariesSnap = await summariesQuery.get();

    if (!summariesSnap.empty) {
      summariesSnap.docs.forEach((doc) => {
        const data = doc.data() as DailySummaryDoc;
        totalRevenue += data.totalRevenue || 0;
        billCount += data.billCount || 0;
        breakdown.push({
          period: data.date,
          revenue: data.totalRevenue || 0,
          count: data.billCount || 0,
        });
      });
    }
  }

  if (breakdown.length === 0) {
    // Direct scan on source bills (branch-aware)
    const billsSnap = await billsInPeriod(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to }).get();
    billsSnap.docs.forEach((doc) => {
      const data = doc.data() as BillDoc;
      totalRevenue += data.totalAmount || 0;
      billCount++;
    });

    breakdown.push({
      period: validated.from || "all-time",
      revenue: round2(totalRevenue),
      count: billCount,
    });
  }

  breakdown.sort((a, b) => a.period.localeCompare(b.period));

  return {
    totalRevenue: round2(totalRevenue),
    billCount,
    averageBillValue: billCount > 0 ? round2(totalRevenue / billCount) : 0,
    breakdown,
  };
});

/**
 * 2. reportsGetProfitLoss
 */
export const reportsGetProfitLoss = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.REPORT_PROFIT,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetProfitLossReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  return { organizationId: orgId, ...(await computeProfitLoss(orgId, validated)) };
});

/**
 * 3. reportsGetStockValuation
 */
export const reportsGetStockValuation = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.INVENTORY_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetStockValuationReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  let query = db.collection("products").where("organizationId", "==", orgId);
  if (validated.categoryId) {
    query = query.where("categoryId", "==", validated.categoryId);
  }

  const productsSnap = await query.get();
  let products = productsSnap.docs.map((d) => ({
    ...(d.data() as ProductDoc),
    id: d.id,
  }));

  if (targetBranchId) {
    const balancesSnap = await db
      .collection("stockBalances")
      .where("organizationId", "==", orgId)
      .where("branchId", "==", targetBranchId)
      .get();
    const balanceMap = new Map<string, number>();
    balancesSnap.docs.forEach((doc) => {
      const data = doc.data() as StockBalanceDoc;
      balanceMap.set(data.productId, data.currentStock || 0);
    });
    products = products.map((p) => ({
      ...p,
      currentStock: balanceMap.get(p.id) || 0,
    }));
  }

  const valuationResult = calculateStockValuation(products);
  return valuationResult;
});

/**
 * 4. reportsGetTopEntities
 */
export const reportsGetTopEntities = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.REPORT_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetTopEntitiesReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const limit = validated.limit || 10;

  if (validated.entityType === "products") {
    const billsSnap = await billsInPeriod(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to }).get();
    const items = Array.from(productSalesTotals(billsSnap.docs).values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)
      .map((item) => ({ ...item, revenue: round2(item.revenue) }));
    return { entityType: "products", items, included: await hydrate(context, items) };
  }

  if (validated.entityType === "customers") {
    const customersSnap = await db
      .collection("customers")
      .where("organizationId", "==", orgId)
      .get();

    const items = customersSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          customerId: d.id,
          name: data.name || "Unknown",
          phone: data.phone || "",
          totalSpend: round2(data.totalSpend || 0),
          outstandingBalance: round2(data.outstandingBalance || 0),
        };
      })
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, limit);

    return { entityType: "customers", items };
  }

  // Vendors
  const vendorsSnap = await db
    .collection("vendors")
    .where("organizationId", "==", orgId)
    .get();

  const items = vendorsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        vendorId: d.id,
        name: data.name || "Unknown",
        phone: data.phone || "",
        totalPurchase: round2(data.totalPurchase || 0),
        outstandingPayable: round2(data.outstandingPayable || 0),
      };
    })
    .sort((a, b) => b.totalPurchase - a.totalPurchase)
    .slice(0, limit);

  return { entityType: "vendors", items };
});

/**
 * 5. reportsGetStaffActivity
 *
 * Per-employee duty tracking across sales, purchases, expenses, returns, deliveries,
 * stock adjustments, approvals and tasks, attributed by document createdBy (and rider /
 * approver ids). Scope: Owner/Admin see everyone; managers see their team (reportingToIds,
 * recursive); everyone else sees only themselves.
 */
export const reportsGetStaffActivity = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.REPORT_VIEW, AppPermissions.EMPLOYEE_VIEW],
    operation: "read",
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetStaffReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;
  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const scope = await resolveDataScope(context, "sales", undefined, validated.branchId);
  const fromIso = validated.from || "0000";
  const toIso = validated.to ? `${validated.to}T23:59:59.999Z` : "9999";
  const inRange = (iso?: string) => !!iso && iso >= fromIso && iso <= toIso;
  const inBranch = (b?: string) => !scope.branchId || !b || b === scope.branchId;
  const targetUid = validated.staffMembershipId ? validated.staffMembershipId.split("_")[0] : null;
  const allowedUid = (uid?: string | null) =>
    !!uid && (!scope.userIds || scope.userIds.includes(uid)) && (!targetUid || uid === targetUid);

  const LIMIT = 5000;
  const [billsSnap, outflowsSnap, returnsSnap, deliveriesSnap, movementsSnap, tasksSnap, approvalsSnap] = await Promise.all([
    db.collection("bills").where("organizationId", "==", orgId).limit(LIMIT).get(),
    db.collection("outflows").where("organizationId", "==", orgId).limit(LIMIT).get(),
    db.collection("returns").where("organizationId", "==", orgId).limit(LIMIT).get(),
    db.collection("deliveries").where("organizationId", "==", orgId).limit(LIMIT).get(),
    db.collection("stockMovements").where("organizationId", "==", orgId)
      .where("referenceModel", "==", "manual_adjustment").limit(LIMIT).get(),
    db.collection("tasks").where("organizationId", "==", orgId).where("status", "==", "completed").limit(LIMIT).get(),
    db.collection("auditLogs").where("organizationId", "==", orgId)
      .where("action", "==", "document.decide").where("entityType", "in", ["bill", "outflow"]).limit(LIMIT).get(),
  ]);

  interface StaffStats {
    userId: string;
    staffMembershipId: string;
    sales: { count: number; amount: number };
    purchases: { count: number; amount: number };
    expenses: { count: number; amount: number };
    returns: { count: number; amount: number };
    deliveriesCompleted: number;
    stockAdjustments: number;
    approvalsDecided: number;
    tasksCompleted: number;
  }
  const stats = new Map<string, StaffStats>();
  const get = (uid: string): StaffStats => {
    let s = stats.get(uid);
    if (!s) {
      s = {
        userId: uid,
        staffMembershipId: `${uid}_${orgId}`,
        sales: { count: 0, amount: 0 },
        purchases: { count: 0, amount: 0 },
        expenses: { count: 0, amount: 0 },
        returns: { count: 0, amount: 0 },
        deliveriesCompleted: 0,
        stockAdjustments: 0,
        approvalsDecided: 0,
        tasksCompleted: 0,
      };
      stats.set(uid, s);
    }
    return s;
  };
  const uidOfMembership = (m?: string | null) => (m ? m.split("_")[0] : null);

  billsSnap.docs.forEach((d) => {
    const b = d.data() as BillDoc;
    if (b.status !== "active" || !inRange(b.createdAt) || !inBranch(b.branchId) || !allowedUid(b.createdBy)) return;
    const s = get(b.createdBy);
    s.sales.count++;
    s.sales.amount += b.totalAmount || 0;
  });
  outflowsSnap.docs.forEach((d) => {
    const o = d.data() as OutflowDoc;
    if (o.status !== "confirmed" || !inRange(o.createdAt) || !inBranch(o.branchId) || !allowedUid(o.createdBy)) return;
    const bucket = o.kind === "purchase" ? get(o.createdBy).purchases : get(o.createdBy).expenses;
    bucket.count++;
    bucket.amount += o.totalAmount || 0;
  });
  returnsSnap.docs.forEach((d) => {
    const r = d.data() as ReturnDoc;
    if (r.status === "voided" || !inRange(r.createdAt) || !inBranch(r.branchId) || !allowedUid(r.createdBy)) return;
    const s = get(r.createdBy);
    s.returns.count++;
    s.returns.amount += r.totalRefundAmount || 0;
  });
  deliveriesSnap.docs.forEach((d) => {
    const dl = d.data() as DeliveryDoc;
    const rider = uidOfMembership(dl.riderMembershipId);
    if (dl.status !== "delivered" || !inRange(dl.updatedAt || dl.createdAt) || !inBranch(dl.branchId) || !allowedUid(rider)) return;
    get(rider as string).deliveriesCompleted++;
  });
  movementsSnap.docs.forEach((d) => {
    const m = d.data() as StockMovementDoc;
    if (!inRange(m.createdAt) || !inBranch(m.branchId) || !allowedUid(m.createdBy)) return;
    get(m.createdBy).stockAdjustments++;
  });
  tasksSnap.docs.forEach((d) => {
    const t = d.data() as TaskDoc;
    const uid = uidOfMembership(t.completedByMembershipId || t.assignedToMembershipId);
    if (!inRange(t.completedAt || t.updatedAt || t.createdAt) || !allowedUid(uid)) return;
    get(uid as string).tasksCompleted++;
  });
  approvalsSnap.docs.forEach((d) => {
    const a = d.data() as AuditLogDoc;
    if (!a.actorUid || !inRange(a.occurredAt.toDate().toISOString()) || !allowedUid(a.actorUid)) return;
    get(a.actorUid).approvalsDecided++;
  });

  const staffSummaries = Array.from(stats.values()).map((s) => ({
    ...s,
    sales: { count: s.sales.count, amount: round2(s.sales.amount) },
    purchases: { count: s.purchases.count, amount: round2(s.purchases.amount) },
    expenses: { count: s.expenses.count, amount: round2(s.expenses.amount) },
    returns: { count: s.returns.count, amount: round2(s.returns.amount) },
    // Backward-compatible sales fields
    totalSales: round2(s.sales.amount),
    billCount: s.sales.count,
    averageBillValue: s.sales.count > 0 ? round2(s.sales.amount / s.sales.count) : 0,
  }));

  return {
    organizationId: orgId,
    scope: scope.level,
    staffSummaries,
  };
});

/**
 * 6. reportsGetPlatformOverview (Super Admin only)
 */
export const reportsGetPlatformOverview = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(GetPlatformOverviewReportSchema, request.data);
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_DASHBOARD,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin authorization required");
  }

  const [orgsSnap, plansSnap, usersSnap] = await Promise.all([
    db.collection("organizations").get(),
    db.collection("subscriptionPlans").get(),
    db.collection("users").get(),
  ]);

  const planCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = { active: 0, suspended: 0, inactive: 0 };
  const countryCounts: Record<string, number> = {};
  const subscriptionsExpiring: Array<{ organizationId: string; name: string; expiresAt: string; daysLeft: number }> = [];
  const activeOrgIds: string[] = [];
  const nowMs = Date.now();

  orgsSnap.docs.forEach((doc) => {
    const data = doc.data() as OrganizationDoc;
    const planId = data.planId || "free";
    planCounts[planId] = (planCounts[planId] || 0) + 1;
    const st = data.status || "active";
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const c = data.country || "IN";
    countryCounts[c] = (countryCounts[c] || 0) + 1;

    if (data.status === "active") {
      activeOrgIds.push(doc.id);
    }

    if (data.subscriptionExpiresAt) {
      const expMs = Date.parse(data.subscriptionExpiresAt);
      const daysLeft = Math.round((expMs - nowMs) / 86400000);
      if (daysLeft <= 7 && daysLeft >= 0) {
        subscriptionsExpiring.push({
          organizationId: doc.id,
          name: data.name,
          expiresAt: data.subscriptionExpiresAt,
          daysLeft,
        });
      }
    }
  });

  let totalPlatformRevenue = 0;
  let billsCount = 0;
  let totalPlatformOutflows = 0;
  let outflowsCount = 0;
  const orgUsageMap: Array<{ organizationId: string; billsCount: number; revenue: number }> = [];

  const orgQueries = activeOrgIds.map(async (orgId) => {
    const [bSnap, oSnap] = await Promise.all([
      db.collection("bills").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]).get(),
      db.collection("outflows").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]).get(),
    ]);

    let orgRev = 0;
    bSnap.docs.forEach((doc) => {
      const data = doc.data();
      const createdAt = data.createdAt;
      if (input.from && createdAt < input.from) return;
      if (input.to && createdAt > `${input.to}T23:59:59.999Z`) return;
      const amt = Number(data.totalAmount) || 0;
      totalPlatformRevenue += amt;
      orgRev += amt;
      billsCount++;
    });

    oSnap.docs.forEach((doc) => {
      const data = doc.data();
      const createdAt = data.createdAt;
      if (input.from && createdAt < input.from) return;
      if (input.to && createdAt > `${input.to}T23:59:59.999Z`) return;
      totalPlatformOutflows += Number(data.totalAmount) || 0;
      outflowsCount++;
    });

    orgUsageMap.push({ organizationId: orgId, billsCount: bSnap.size, revenue: round2(orgRev) });
  });

  await Promise.all(orgQueries);

  // Top organizations by usage
  const topOrganizationsByUsage = orgUsageMap.sort((a, b) => b.billsCount - a.billsCount).slice(0, 5);

  return {
    totalOrganizations: orgsSnap.size,
    activeOrganizations: statusCounts.active || 0,
    suspendedOrganizations: statusCounts.suspended || 0,
    inactiveOrganizations: statusCounts.inactive || 0,
    organizationsByStatus: statusCounts,
    organizationsByCountry: countryCounts,
    organizationsByPlan: planCounts,
    availablePlansCount: plansSnap.size,
    totalUsers: usersSnap.size,
    subscriptionsExpiring,
    atRiskOrganizations: [],
    topOrganizationsByUsage,
    totalPlatformRevenue: round2(totalPlatformRevenue),
    totalPlatformOutflows: round2(totalPlatformOutflows),
    netPlatformCashFlow: round2(totalPlatformRevenue - totalPlatformOutflows),
    platformFinancials: {
      totalRevenue: round2(totalPlatformRevenue),
      totalOutflows: round2(totalPlatformOutflows),
      netPlatformCashFlow: round2(totalPlatformRevenue - totalPlatformOutflows),
      billsCount,
      outflowsCount,
    },
    generatedAt: new Date().toISOString(),
  };
});

/**
 * 7. reportsExportCsv
 */
export const reportsExportCsv = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.REPORT_EXPORT,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(ExportReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  let csvContent = "";

  if (validated.reportType === "stock_valuation") {
    const productsSnap = await db.collection("products").where("organizationId", "==", orgId).get();
    let products = productsSnap.docs.map((d) => ({ ...(d.data() as ProductDoc), id: d.id }));

    if (targetBranchId) {
      const balancesSnap = await db
        .collection("stockBalances")
        .where("organizationId", "==", orgId)
        .where("branchId", "==", targetBranchId)
        .get();
      const balanceMap = new Map<string, number>();
      balancesSnap.docs.forEach((doc) => {
        const data = doc.data() as StockBalanceDoc;
        balanceMap.set(data.productId, data.currentStock || 0);
      });
      products = products.map((p) => ({
        ...p,
        currentStock: balanceMap.get(p.id) || 0,
      }));
    }

    const result = calculateStockValuation(products);
    csvContent = toCsv(
      result.items.map((i) => ({
        ProductId: i.productId,
        Name: i.name,
        BranchId: targetBranchId || "all",
        CurrentStock: i.currentStock,
        CostPrice: i.costPrice,
        WeightedAverageCost: i.weightedAverageCost,
        Valuation: i.valuation,
      }))
    );
  } else if (validated.reportType === "revenue") {
    let billsQuery = db.collection("bills").where("organizationId", "==", orgId);
    if (targetBranchId) billsQuery = billsQuery.where("branchId", "==", targetBranchId);
    if (validated.from) billsQuery = billsQuery.where("createdAt", ">=", validated.from);
    if (validated.to) billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);
    const billsSnap = await billsQuery.get();
    csvContent = toCsv(
      billsSnap.docs.map((d) => {
        const data = d.data() as BillDoc;
        return {
          BillId: d.id,
          BillNumber: data.billNumber,
          BranchId: data.branchId || targetBranchId || "main-branch",
          Date: data.createdAt,
          TotalAmount: data.totalAmount,
          PaidAmount: data.paidAmount,
          Status: data.status,
        };
      })
    );
  } else if (validated.reportType === "profit_loss") {
    const pl = await computeProfitLoss(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to });
    const b = targetBranchId || "all";
    csvContent = toCsv([
      { Metric: "Net Revenue", Amount: pl.netRevenue, BranchId: b },
      { Metric: "Cost of Goods Sold (COGS)", Amount: pl.netCogs, BranchId: b },
      { Metric: "Gross Profit", Amount: pl.grossProfit, BranchId: b },
      { Metric: "Operational Expenses", Amount: pl.totalExpenses, BranchId: b },
      { Metric: "Inventory Write-off", Amount: pl.inventoryWriteOff, BranchId: b },
      { Metric: "Net Profit", Amount: pl.netProfit, BranchId: b },
    ]);
  } else if (validated.reportType === "top_products") {
    const billsSnap = await billsInPeriod(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to }).get();
    const totals = Array.from(productSalesTotals(billsSnap.docs).values()).sort((a, b) => b.revenue - a.revenue);
    const names = (await hydrate(context, totals)).products || {};
    const rows = totals.map((r) => ({ ProductId: r.productId, Name: (names[r.productId]?.name as string) || "", QuantitySold: r.quantity, TotalRevenue: round2(r.revenue), BranchId: targetBranchId || "all" }));
    csvContent = toCsv(rows.length > 0 ? rows : [{ ProductId: "none", Name: "No sales", QuantitySold: 0, TotalRevenue: 0, BranchId: targetBranchId || "all" }]);
  } else if (validated.reportType === "staff_sales") {
    const billsSnap = await billsInPeriod(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to }).get();
    const staffStats = new Map<string, { StaffMembershipId: string; BillCount: number; TotalRevenue: number; BranchId: string }>();

    billsSnap.docs.forEach((doc) => {
      const bill = doc.data() as BillDoc;
      const staffId = bill.salespersonMembershipId || bill.createdBy || "unknown";
      const existing = staffStats.get(staffId) || {
        StaffMembershipId: staffId,
        BillCount: 0,
        TotalRevenue: 0,
        BranchId: targetBranchId || "all",
      };
      existing.BillCount++;
      existing.TotalRevenue += bill.totalAmount || 0;
      staffStats.set(staffId, existing);
    });

    const rows = Array.from(staffStats.values())
      .sort((a, b) => b.TotalRevenue - a.TotalRevenue)
      .map((r) => ({ ...r, TotalRevenue: round2(r.TotalRevenue) }));
    csvContent = toCsv(rows.length > 0 ? rows : [{ StaffMembershipId: "none", BillCount: 0, TotalRevenue: 0, BranchId: targetBranchId || "all" }]);
  }

  return {
    reportType: validated.reportType,
    organizationId: orgId,
    branchId: targetBranchId,
    csv: csvContent,
    contentType: "text/csv",
  };
});

// ---------------------------------------------------------------------------
// Party statements (vendor payables / customer receivables)
// ---------------------------------------------------------------------------

/** Fields shared by bills and purchase outflows that a party statement reads. */
interface PartyDocument {
  status: string;
  kind?: string;
  branchId?: string;
  docDate?: string;
  createdAt: string;
  outflowNumber?: string;
  billNumber?: string;
  invoiceNumber?: string;
  dueDate?: string | null;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus?: string;
}

/**
 * reportsGetPartyStatement
 * Vendor or customer statement over a date range: opening balance, every document (purchase
 * or bill) with its paid status, payments, credit-note returns, running balance, day-wise
 * document totals (several purchases in one day) and ageing of open documents.
 * Voided documents and voided payments are excluded.
 */
export const reportsGetPartyStatement = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(PartyStatementSchema, request.data);
  const isVendor = input.partyType === "vendor";
  const ctx = await resolveRequestContext(request, {
    requiredPermission: isVendor
      ? [AppPermissions.VENDOR_VIEW_BALANCE, AppPermissions.PAYMENT_VIEW]
      : [AppPermissions.CUSTOMER_VIEW_BALANCE, AppPermissions.PAYMENT_VIEW],
  });
  const orgId = ctx.organizationId;

  const partySnap = await db.collection(isVendor ? "vendors" : "customers").doc(input.partyId).get();
  if (!partySnap.exists || partySnap.data()?.organizationId !== orgId) {
    throw new HttpsError("not-found", `${isVendor ? "Vendor" : "Customer"} not found in this organization.`);
  }
  const party = partySnap.data() as Record<string, unknown>;

  const [docsSnap, paymentsSnap, returnsSnap] = await Promise.all([
    isVendor
      ? db.collection("outflows").where("organizationId", "==", orgId).where("vendorId", "==", input.partyId).get()
      : db.collection("bills").where("organizationId", "==", orgId).where("customerId", "==", input.partyId).get(),
    db.collection("payments").where("organizationId", "==", orgId).where("partyId", "==", input.partyId).get(),
    db.collection("returns").where("organizationId", "==", orgId)
      .where("returnType", "==", isVendor ? ReturnType.PURCHASE_RETURN : ReturnType.SALES_RETURN).get(),
  ]);

  const tz = ctx.organization.timezone || DEFAULT_ORG_TIMEZONE;
  const dayOf = (iso: string) => localDateInTimezone(Date.parse(iso), tz);
  const fromIso = input.from ? (input.from.length === 10 ? `${input.from}T00:00:00.000Z` : input.from) : null;
  const toIso = input.to ? (input.to.length === 10 ? `${input.to}T23:59:59.999Z` : input.to) : null;
  const branchOk = (b?: string) => !input.branchId || b === input.branchId;

  interface Entry { at: string; kind: string; id: string; number: string; debit: number; credit: number; status?: string; paymentStatus?: string; method?: string }
  const entries: Entry[] = [];
  const documents: Array<Record<string, unknown>> = [];
  const docIds = new Set<string>();

  docsSnap.docs.forEach((d) => {
    const doc = d.data() as PartyDocument;
    const live = isVendor ? doc.status === "confirmed" && doc.kind === "purchase" : doc.status === "active";
    if (!live || !branchOk(doc.branchId)) return;
    docIds.add(d.id);
    const at = (isVendor ? doc.docDate : doc.createdAt) || doc.createdAt;
    entries.push({ at, kind: isVendor ? "purchase" : "bill", id: d.id, number: (isVendor ? doc.outflowNumber : doc.billNumber) || "", debit: doc.totalAmount || 0, credit: 0, paymentStatus: doc.paymentStatus });
    documents.push({
      id: d.id,
      number: isVendor ? doc.outflowNumber : doc.billNumber,
      at,
      day: dayOf(at),
      invoiceNumber: isVendor ? doc.invoiceNumber || null : null,
      dueDate: doc.dueDate || null,
      totalAmount: doc.totalAmount,
      paidAmount: doc.paidAmount,
      balanceAmount: doc.balanceAmount,
      paymentStatus: doc.paymentStatus,
    });
  });
  paymentsSnap.docs.forEach((d) => {
    const p = d.data() as PaymentDoc;
    if (p.status !== "completed" || !branchOk(p.branchId)) return;
    if (p.partyType !== (isVendor ? "vendor" : "customer")) return;
    entries.push({ at: p.createdAt, kind: "payment", id: d.id, number: p.paymentNumber, debit: 0, credit: p.amount, method: p.method });
  });
  returnsSnap.docs.forEach((d) => {
    const r = d.data() as ReturnDoc;
    if (r.status === "voided" || r.refundMethod !== "credit_note" || !branchOk(r.branchId)) return;
    if (r.partyId !== input.partyId && !docIds.has(r.referenceId)) return;
    entries.push({ at: r.createdAt, kind: "return_credit_note", id: d.id, number: r.returnNumber, debit: 0, credit: r.totalRefundAmount || 0 });
  });

  entries.sort((a, b) => a.at.localeCompare(b.at));
  let opening = 0;
  let running = 0;
  const lines: Array<Entry & { balance: number }> = [];
  for (const e of entries) {
    if (fromIso && e.at < fromIso) {
      opening = round2(opening + e.debit - e.credit);
      running = opening;
      continue;
    }
    if (toIso && e.at > toIso) continue;
    running = round2(running + e.debit - e.credit);
    lines.push({ ...e, debit: round2(e.debit), credit: round2(e.credit), balance: running });
  }

  // Day-wise document totals within range
  const byDay = new Map<string, { day: string; count: number; total: number; paid: number; balance: number }>();
  documents.forEach((doc) => {
    const at = doc.at as string;
    if ((fromIso && at < fromIso) || (toIso && at > toIso)) return;
    const k = doc.day as string;
    const row = byDay.get(k) || { day: k, count: 0, total: 0, paid: 0, balance: 0 };
    row.count++;
    row.total = round2(row.total + (doc.totalAmount as number));
    row.paid = round2(row.paid + (doc.paidAmount as number));
    row.balance = round2(row.balance + (doc.balanceAmount as number));
    byDay.set(k, row);
  });

  // Ageing of open documents by due date (or document date)
  const now = Date.now();
  const ageing = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  documents.forEach((doc) => {
    const bal = doc.balanceAmount as number;
    if (!bal || bal <= 0) return;
    const ref = Date.parse((doc.dueDate as string) || (doc.at as string));
    const days = Math.floor((now - ref) / 86_400_000);
    if (days <= 0) ageing.current = round2(ageing.current + bal);
    else if (days <= 30) ageing.d1_30 = round2(ageing.d1_30 + bal);
    else if (days <= 60) ageing.d31_60 = round2(ageing.d31_60 + bal);
    else if (days <= 90) ageing.d61_90 = round2(ageing.d61_90 + bal);
    else ageing.d90_plus = round2(ageing.d90_plus + bal);
  });

  const totals = lines.reduce((t, l) => ({ debit: round2(t.debit + l.debit), credit: round2(t.credit + l.credit) }), { debit: 0, credit: 0 });
  return {
    organizationId: orgId,
    partyType: input.partyType,
    partyId: input.partyId,
    partyName: party.name,
    from: input.from || null,
    to: input.to || null,
    openingBalance: opening,
    totalDebit: totals.debit,
    totalCredit: totals.credit,
    closingBalance: running,
    ledgerBalance: isVendor ? party.outstandingPayable ?? null : party.outstandingBalance ?? null,
    entries: lines,
    documents,
    dayWise: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    ageing,
  };
});

// ---------------------------------------------------------------------------
// Total outflow (purchases + expenses) — commitment / cash view, never P&L
// ---------------------------------------------------------------------------

/**
 * reportsGetOutflowSummary
 * totalOutflow = purchases + expenses (accrual: document totals; cash: payments made).
 * Purchases are inventory: in the P&L they appear only as COGS when goods are sold, so this
 * figure must never be added to the P&L (no double counting). Grouped by day / category /
 * employee (recorded by) / vendor / branch. Employee-linked expenses need expense:view_sensitive.
 */
export const reportsGetOutflowSummary = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(OutflowSummarySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.REPORT_VIEW, AppPermissions.OUTFLOW_VIEW],
  });
  const orgId = ctx.organizationId;
  const tz = ctx.organization.timezone || DEFAULT_ORG_TIMEZONE;
  const fromIso = input.from ? (input.from.length === 10 ? `${input.from}T00:00:00.000Z` : input.from) : "0000";
  const toIso = input.to ? (input.to.length === 10 ? `${input.to}T23:59:59.999Z` : input.to) : "9999";
  const branchOk = (b?: string) => !input.branchId || b === input.branchId;
  const canSensitive = ctx.can(AppPermissions.EXPENSE_VIEW_SENSITIVE);

  const [outflowsSnap, paymentsSnap] = await Promise.all([
    db.collection("outflows").where("organizationId", "==", orgId).where("status", "==", "confirmed").get(),
    db.collection("payments").where("organizationId", "==", orgId).where("direction", "==", "out").get(),
  ]);

  const groupBy = input.groupBy || "day";
  const groups = new Map<string, { key: string; purchases: number; expenses: number; total: number; count: number }>();
  let purchases = 0;
  let expenses = 0;
  let employeeLinkedExpenses = 0;
  let hiddenSensitive = 0;
  const outflowIds = new Set<string>();

  outflowsSnap.docs.forEach((d) => {
    const o = d.data() as OutflowDoc;
    const at = o.docDate || o.createdAt;
    if (at < fromIso || at > toIso || !branchOk(o.branchId)) return;
    if (o.payeeMembershipId && !canSensitive) {
      hiddenSensitive++;
      return;
    }
    outflowIds.add(d.id);
    const amt = o.totalAmount || 0;
    if (o.kind === "purchase") purchases += amt;
    else {
      expenses += amt;
      if (o.payeeMembershipId) employeeLinkedExpenses += amt;
    }
    let key: string;
    switch (groupBy) {
      case "category": key = o.expenseCategoryId || o.lines?.[0]?.categoryId || (o.kind === "purchase" ? "purchases" : "uncategorized"); break;
      case "employee": key = o.createdBy; break;
      case "vendor": key = o.vendorId || o.payee || "other"; break;
      case "branch": key = o.branchId || "main-branch"; break;
      default: key = localDateInTimezone(Date.parse(at), tz);
    }
    const g = groups.get(key) || { key, purchases: 0, expenses: 0, total: 0, count: 0 };
    if (o.kind === "purchase") g.purchases = round2(g.purchases + amt);
    else g.expenses = round2(g.expenses + amt);
    g.total = round2(g.total + amt);
    g.count++;
    groups.set(key, g);
  });

  let cashPaid = 0;
  paymentsSnap.docs.forEach((d) => {
    const p = d.data() as PaymentDoc;
    if (p.status !== "completed" || p.createdAt < fromIso || p.createdAt > toIso || !branchOk(p.branchId)) return;
    if (p.referenceModel === "outflow" && p.referenceId && !outflowIds.has(p.referenceId)) return;
    cashPaid += p.amount || 0;
  });

  return {
    organizationId: orgId,
    branchId: input.branchId || null,
    from: input.from || null,
    to: input.to || null,
    accrual: {
      purchases: round2(purchases),
      expenses: round2(expenses),
      totalOutflow: round2(purchases + expenses),
      employeeLinkedExpenses: round2(employeeLinkedExpenses),
    },
    cash: { paid: round2(cashPaid) },
    groupBy,
    groups: Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key)),
    excludedSensitiveCount: hiddenSensitive,
    note: "Total outflow is a spend/commitment view. The P&L uses COGS for purchases (when sold) and expenses directly; never add totalOutflow to the P&L.",
  };
});

export const reportsGetReceivablesAgeing = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetReceivablesAgeingReportSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.RECEIVABLES_VIEW,
  });

  const orgId = ctx.organizationId;
  const asOf = input.asOfDate || new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(`${asOf}T23:59:59.999Z`);

  let query: FirebaseFirestore.Query = db
    .collection("bills")
    .where("organizationId", "==", orgId)
    .where("status", "in", ["active", "partial"]);

  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.customerId) {
    query = query.where("customerId", "==", input.customerId);
  }

  const snap = await query.get();

  const totals = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90Plus: 0,
    totalOutstanding: 0,
  };

  const customerMap = new Map<string, {
    customerId: string;
    customerName: string;
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
    totalOutstanding: number;
    billCount: number;
  }>();

  for (const doc of snap.docs) {
    const bill = doc.data() as BillDoc;
    const balance = bill.balanceAmount || 0;
    if (balance <= 0) continue;

    const dueStr = bill.createdAt.slice(0, 10);
    const dueMs = Date.parse(`${dueStr}T00:00:00.000Z`);
    const daysOverdue = Math.floor((asOfMs - dueMs) / 86400000);

    const cId = bill.customerId || "walk_in";
    const cName = bill.billToSnapshot?.name || "Walk-in Customer";

    let cEntry = customerMap.get(cId);
    if (!cEntry) {
      cEntry = {
        customerId: cId,
        customerName: cName,
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90Plus: 0,
        totalOutstanding: 0,
        billCount: 0,
      };
      customerMap.set(cId, cEntry);
    }

    cEntry.billCount++;
    cEntry.totalOutstanding = round2(cEntry.totalOutstanding + balance);
    totals.totalOutstanding = round2(totals.totalOutstanding + balance);

    if (daysOverdue <= 0) {
      cEntry.current = round2(cEntry.current + balance);
      totals.current = round2(totals.current + balance);
    } else if (daysOverdue <= 30) {
      cEntry.days1to30 = round2(cEntry.days1to30 + balance);
      totals.days1to30 = round2(totals.days1to30 + balance);
    } else if (daysOverdue <= 60) {
      cEntry.days31to60 = round2(cEntry.days31to60 + balance);
      totals.days31to60 = round2(totals.days31to60 + balance);
    } else if (daysOverdue <= 90) {
      cEntry.days61to90 = round2(cEntry.days61to90 + balance);
      totals.days61to90 = round2(totals.days61to90 + balance);
    } else {
      cEntry.days90Plus = round2(cEntry.days90Plus + balance);
      totals.days90Plus = round2(totals.days90Plus + balance);
    }
  }

  return {
    asOfDate: asOf,
    organizationId: orgId,
    branchId: input.branchId || null,
    totals,
    customers: Array.from(customerMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
  };
});

export const reportsGetPayablesAgeing = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetPayablesAgeingReportSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYABLES_VIEW,
  });

  const orgId = ctx.organizationId;
  const asOf = input.asOfDate || new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(`${asOf}T23:59:59.999Z`);

  let query: FirebaseFirestore.Query = db
    .collection("outflows")
    .where("organizationId", "==", orgId)
    .where("status", "in", ["confirmed", "partial"]);

  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.vendorId) {
    query = query.where("vendorId", "==", input.vendorId);
  }

  const snap = await query.get();

  const totals = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90Plus: 0,
    totalOutstanding: 0,
  };

  const vendorMap = new Map<string, {
    vendorId: string;
    vendorName: string;
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
    totalOutstanding: number;
    outflowCount: number;
  }>();

  for (const doc of snap.docs) {
    const outflow = doc.data() as OutflowDoc;
    const balance = outflow.balanceAmount || 0;
    if (balance <= 0) continue;

    const dueStr = outflow.dueDate || outflow.docDate || outflow.createdAt.slice(0, 10);
    const dueMs = Date.parse(`${dueStr}T00:00:00.000Z`);
    const daysOverdue = Math.floor((asOfMs - dueMs) / 86400000);

    const vId = outflow.vendorId || "other";
    const vName = outflow.payee || "Vendor";

    let vEntry = vendorMap.get(vId);
    if (!vEntry) {
      vEntry = {
        vendorId: vId,
        vendorName: vName,
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90Plus: 0,
        totalOutstanding: 0,
        outflowCount: 0,
      };
      vendorMap.set(vId, vEntry);
    }

    vEntry.outflowCount++;
    vEntry.totalOutstanding = round2(vEntry.totalOutstanding + balance);
    totals.totalOutstanding = round2(totals.totalOutstanding + balance);

    if (daysOverdue <= 0) {
      vEntry.current = round2(vEntry.current + balance);
      totals.current = round2(totals.current + balance);
    } else if (daysOverdue <= 30) {
      vEntry.days1to30 = round2(vEntry.days1to30 + balance);
      totals.days1to30 = round2(totals.days1to30 + balance);
    } else if (daysOverdue <= 60) {
      vEntry.days31to60 = round2(vEntry.days31to60 + balance);
      totals.days31to60 = round2(totals.days31to60 + balance);
    } else if (daysOverdue <= 90) {
      vEntry.days61to90 = round2(vEntry.days61to90 + balance);
      totals.days61to90 = round2(totals.days61to90 + balance);
    } else {
      vEntry.days90Plus = round2(vEntry.days90Plus + balance);
      totals.days90Plus = round2(totals.days90Plus + balance);
    }
  }

  return {
    asOfDate: asOf,
    organizationId: orgId,
    branchId: input.branchId || null,
    totals,
    vendors: Array.from(vendorMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
  };
});

export const reportsGetCashBankSummary = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetCashBankSummarySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });

  const orgId = ctx.organizationId;
  let q: FirebaseFirestore.Query = db
    .collection("financialAccounts")
    .where("organizationId", "==", orgId);

  if (input.branchId) {
    q = q.where("branchId", "in", [input.branchId, null]);
  }
  if (!input.includeInactive) {
    q = q.where("isActive", "==", true);
  }

  const snap = await q.get();

  const totals = {
    cashInHand: 0,
    bankBalance: 0,
    digitalWallets: 0,
    clearingAndControl: 0,
    totalOperationalLiquidity: 0,
  };

  const accounts = snap.docs.map((doc) => {
    const d = doc.data() as FinancialAccountDoc;
    const balance = d.currentBalance || 0;

    switch (d.accountType) {
      case "cash":
        totals.cashInHand = round2(totals.cashInHand + balance);
        break;
      case "bank":
        totals.bankBalance = round2(totals.bankBalance + balance);
        break;
      case "digital":
        totals.digitalWallets = round2(totals.digitalWallets + balance);
        break;
      case "clearing":
      case "control":
        totals.clearingAndControl = round2(totals.clearingAndControl + balance);
        break;
    }
    totals.totalOperationalLiquidity = round2(totals.totalOperationalLiquidity + balance);

    return {
      financialAccountId: doc.id,
      name: d.name,
      code: d.code,
      accountType: d.accountType,
      currency: d.currency,
      currentBalance: balance,
      branchId: d.branchId || null,
      isDefault: d.isDefault,
      isActive: d.isActive,
    };
  });

  return {
    organizationId: orgId,
    branchId: input.branchId || null,
    totals,
    accounts: accounts.sort((a, b) => b.currentBalance - a.currentBalance),
    count: accounts.length,
  };
});

