/**
 * Reports & Analytics - Analytics & Platform Reports
 * 
 * - reportsGetStockValuation: Inventory valuation at WAC
 * - reportsGetTopEntities: Top products, customers, and vendors
 * - reportsGetStaffActivity: Staff sales & activity summary
 * - reportsGetPlatformOverview: Platform overview (Super Admin)
 * - reportsExportCsv: Scoped CSV report export
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { db } from "../../services/firebase.js";
import { resolveRequestContext, resolveDataScope } from "../../services/contextResolver.js";
import { AppPermissions } from "../../constants/permissions.js";
import {
  GetStockValuationReportSchema,
  GetTopEntitiesReportSchema,
  GetStaffReportSchema,
  GetPlatformOverviewReportSchema,
  ExportReportSchema,
} from "../../validation/schemas.js";
import { parseInput } from "../../validation/parseInput.js";
import { calculateStockValuation } from "../../services/costingEngine.js";
import { Money } from "../../services/money.js";
import { hydrate } from "../../services/hydration.js";
import {
  ProductDoc,
  BillDoc,
  OutflowDoc,
  ReturnDoc,
  StockMovementDoc,
  DeliveryDoc,
  TaskDoc,
  OrganizationDoc,
  StockBalanceDoc,
  AuditLogDoc,
} from "../../types/models.js";
import { toCsv, billsInPeriod, productSalesTotals } from "./helpers.js";
import { computeProfitLoss } from "./financialReports.js";

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
  const currency = context.organization.currency;

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

  const valuationResult = calculateStockValuation(products, currency);
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
  const currency = context.organization.currency;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const limit = validated.limit || 10;

  if (validated.entityType === "products") {
    const billsSnap = await billsInPeriod(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to }).get();
    const items = Array.from(productSalesTotals(billsSnap.docs).values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)
      .map((item) => ({ ...item, revenue: Money.amount(item.revenue, currency) }));
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
          totalSpend: Money.amount(data.totalSpend || 0, currency),
          outstandingBalance: Money.amount(data.outstandingBalance || 0, currency),
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
        totalPurchase: Money.amount(data.totalPurchase || 0, currency),
        outstandingPayable: Money.amount(data.outstandingPayable || 0, currency),
      };
    })
    .sort((a, b) => b.totalPurchase - a.totalPurchase)
    .slice(0, limit);

  return { entityType: "vendors", items };
});

/**
 * 5. reportsGetStaffActivity
 */
export const reportsGetStaffActivity = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.REPORT_VIEW, AppPermissions.EMPLOYEE_VIEW],
    operation: "read",
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetStaffReportSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;
  const currency = context.organization.currency;
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
    sales: { count: s.sales.count, amount: Money.amount(s.sales.amount, currency) },
    purchases: { count: s.purchases.count, amount: Money.amount(s.purchases.amount, currency) },
    expenses: { count: s.expenses.count, amount: Money.amount(s.expenses.amount, currency) },
    returns: { count: s.returns.count, amount: Money.amount(s.returns.amount, currency) },
    totalSales: Money.amount(s.sales.amount, currency),
    billCount: s.sales.count,
    averageBillValue: s.sales.count > 0 ? Money.amount(s.sales.amount / s.sales.count, currency) : 0,
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

    orgUsageMap.push({ organizationId: orgId, billsCount: bSnap.size, revenue: Money.amount(orgRev, "INR") });
  });

  await Promise.all(orgQueries);

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
    totalPlatformRevenue: Money.amount(totalPlatformRevenue, "INR"),
    totalPlatformOutflows: Money.amount(totalPlatformOutflows, "INR"),
    netPlatformCashFlow: Money.amount(totalPlatformRevenue - totalPlatformOutflows, "INR"),
    platformFinancials: {
      totalRevenue: Money.amount(totalPlatformRevenue, "INR"),
      totalOutflows: Money.amount(totalPlatformOutflows, "INR"),
      netPlatformCashFlow: Money.amount(totalPlatformRevenue - totalPlatformOutflows, "INR"),
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
  const currency = context.organization.currency;

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

    const result = calculateStockValuation(products, currency);
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
    const rows = totals.map((r) => ({ ProductId: r.productId, Name: (names[r.productId]?.name as string) || "", QuantitySold: r.quantity, TotalRevenue: Money.amount(r.revenue, currency), BranchId: targetBranchId || "all" }));
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
      .map((r) => ({ ...r, TotalRevenue: Money.amount(r.TotalRevenue, currency) }));
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
