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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  GetRevenueReportSchema,
  GetProfitLossReportSchema,
  GetStockValuationReportSchema,
  GetTopEntitiesReportSchema,
  GetStaffReportSchema,
  GetPlatformOverviewReportSchema,
  ExportReportSchema,
} from "../validation/schemas.js";
import { calculateStockValuation } from "../services/costingEngine.js";
import { round2 } from "../services/money.js";
import { ProductDoc, BillDoc, OutflowDoc, DailySummaryDoc, ReturnDoc } from "../types/models.js";
import { ReturnType, ReturnDisposition } from "../constants/enums.js";

/**
 * Helper to convert array of flat objects to CSV format.
 */
function toCsv(rows: Record<string, any>[]): string {
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

/**
 * 1. reportsGetRevenue
 */
export const reportsGetRevenue = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.REPORT_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const parsed = GetRevenueReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
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
    let billsQuery = db
      .collection("bills")
      .where("organizationId", "==", orgId)
      .where("status", "in", ["active", "partial", "paid"]);

    if (targetBranchId) {
      billsQuery = billsQuery.where("branchId", "==", targetBranchId);
    }
    if (validated.from) {
      billsQuery = billsQuery.where("createdAt", ">=", validated.from);
    }
    if (validated.to) {
      billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);
    }

    const billsSnap = await billsQuery.get();
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

  const parsed = GetProfitLossReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  // Read bills for revenue & cogs
  let billsQuery = db
    .collection("bills")
    .where("organizationId", "==", orgId)
    .where("status", "in", ["active", "partial", "paid"]);

  if (targetBranchId) {
    billsQuery = billsQuery.where("branchId", "==", targetBranchId);
  }
  if (validated.from) {
    billsQuery = billsQuery.where("createdAt", ">=", validated.from);
  }
  if (validated.to) {
    billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);
  }

  // Read outflows for operational expenses
  let outflowsQuery = db
    .collection("outflows")
    .where("organizationId", "==", orgId)
    .where("status", "==", "confirmed");

  if (targetBranchId) {
    outflowsQuery = outflowsQuery.where("branchId", "==", targetBranchId);
  }
  if (validated.from) {
    outflowsQuery = outflowsQuery.where("createdAt", ">=", validated.from);
  }
  if (validated.to) {
    outflowsQuery = outflowsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);
  }

  const [billsSnap, outflowsSnap, productsSnap, returnsSnap] = await Promise.all([
    billsQuery.get(),
    outflowsQuery.get(),
    db.collection("products").where("organizationId", "==", orgId).get(),
    db.collection("returns").where("organizationId", "==", orgId).get(),
  ]);

  const productCostMap = new Map<string, number>();
  productsSnap.docs.forEach((doc) => {
    const data = doc.data() as ProductDoc;
    const effectiveCost = data.weightedAverageCost && data.weightedAverageCost > 0
      ? data.weightedAverageCost
      : (data.costPrice || 0);
    productCostMap.set(doc.id, effectiveCost);
  });

  let grossRevenue = 0;
  let grossCogs = 0;
  let billCount = 0;

  billsSnap.docs.forEach((doc) => {
    const bill = doc.data() as BillDoc;
    grossRevenue += bill.totalAmount || 0;
    billCount++;

    if (Array.isArray(bill.items)) {
      bill.items.forEach((item) => {
        // Authoritative Historical COGS: Use the immutable costSnapshot recorded at sale/invoice time.
        // Zero cost is valid (samples, free tiers). Falls back to product catalog cost only for legacy records.
        const unitCost = (item.costSnapshot !== undefined && item.costSnapshot !== null)
          ? item.costSnapshot
          : (productCostMap.get(item.productId) ?? 0);
        grossCogs += (item.quantity || 0) * unitCost;
      });
    }
  });

  let salesReturns = 0;
  let cogsReversals = 0;
  let returnCount = 0;

  returnsSnap.docs.forEach((doc) => {
    const ret = doc.data() as ReturnDoc;
    if (ret.returnType !== ReturnType.SALES_RETURN || ret.status === "voided") return;
    if (targetBranchId && ret.branchId && ret.branchId !== targetBranchId) return;
    if (validated.from && ret.createdAt < validated.from) return;
    if (validated.to && ret.createdAt > `${validated.to}T23:59:59.999Z`) return;

    salesReturns += ret.totalRefundAmount || 0;
    returnCount++;

    if (Array.isArray(ret.items)) {
      ret.items.forEach((item) => {
        if (item.disposition === ReturnDisposition.RESTOCKED_TO_INVENTORY) {
          // Authoritative Return COGS Reversal: Use the immutable cost basis of the original sale line.
          // Zero cost is valid. Falls back to product catalog cost only for legacy records.
          const unitCost = (item.costSnapshot !== undefined && item.costSnapshot !== null)
            ? item.costSnapshot
            : (productCostMap.get(item.productId) ?? 0);
          cogsReversals += (item.quantity || 0) * unitCost;
        }
      });
    }
  });

  grossRevenue = round2(grossRevenue);
  salesReturns = round2(salesReturns);
  const netRevenue = round2(Math.max(0, grossRevenue - salesReturns));

  grossCogs = round2(grossCogs);
  cogsReversals = round2(cogsReversals);
  const netCogs = round2(Math.max(0, grossCogs - cogsReversals));

  let totalExpenses = 0;
  let outflowCount = 0;

  outflowsSnap.docs.forEach((doc) => {
    const outflow = doc.data() as OutflowDoc;
    if (outflow.kind === "expense") {
      totalExpenses += outflow.totalAmount || 0;
      outflowCount++;
    } else if (outflow.kind === "purchase") {
      outflowCount++;
    }
  });

  totalExpenses = round2(totalExpenses);

  const grossProfit = round2(netRevenue - netCogs);
  const grossMarginPercent = netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : 0;
  const netProfit = round2(grossProfit - totalExpenses);
  const netMarginPercent = netRevenue > 0 ? round2((netProfit / netRevenue) * 100) : 0;

  return {
    organizationId: orgId,
    branchId: targetBranchId || null,
    from: validated.from || null,
    to: validated.to || null,
    // GAAP / IFRS Revenue Breakdown
    grossRevenue,
    salesReturns,
    netRevenue,
    totalRevenue: netRevenue,
    // COGS Breakdown
    grossCogs,
    cogsReversals,
    netCogs,
    cogs: netCogs,
    // Profit Metrics
    grossProfit,
    grossMarginPercent,
    operatingExpenses: totalExpenses,
    totalExpenses,
    netProfit,
    netMarginPercent,
    billCount,
    returnCount,
    outflowCount,
    costingMethod: "weighted_average",
  };
});

/**
 * 3. reportsGetStockValuation
 */
export const reportsGetStockValuation = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.INVENTORY_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const parsed = GetStockValuationReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
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
      const data = doc.data() as any;
      balanceMap.set(data.productId, data.currentStock || 0);
    });
    products = products.map((p) => ({
      ...p,
      currentStock: balanceMap.get(p.id) || 0,
    }));
  }

  const valuationResult = calculateStockValuation(products as any);
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

  const parsed = GetTopEntitiesReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const limit = validated.limit || 10;

  if (validated.entityType === "products") {
    let billsQuery = db
      .collection("bills")
      .where("organizationId", "==", orgId)
      .where("status", "in", ["active", "partial", "paid"]);

    if (targetBranchId) billsQuery = billsQuery.where("branchId", "==", targetBranchId);
    if (validated.from) billsQuery = billsQuery.where("createdAt", ">=", validated.from);
    if (validated.to) billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);

    const billsSnap = await billsQuery.get();
    const productStats = new Map<string, { productId: string; name: string; quantity: number; revenue: number }>();

    billsSnap.docs.forEach((doc) => {
      const bill = doc.data() as BillDoc;
      if (Array.isArray(bill.items)) {
        bill.items.forEach((item) => {
          const existing = productStats.get(item.productId) || {
            productId: item.productId,
            name: item.nameSnapshot || "Unknown",
            quantity: 0,
            revenue: 0,
          };
          existing.quantity += item.quantity || 0;
          existing.revenue += item.subtotal || 0;
          productStats.set(item.productId, existing);
        });
      }
    });

    const items = Array.from(productStats.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)
      .map((item) => ({ ...item, revenue: round2(item.revenue) }));

    return { entityType: "products", items };
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
 */
export const reportsGetStaffActivity = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });

  const parsed = GetStaffReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
  const orgId = validated.organizationId || context.organizationId;
  const targetBranchId = validated.branchId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.membership?.isPrimary || context.role?.code === "admin" || context.role?.code === "owner";
  const hasReportPermission = context.effectivePermissions.includes(AppPermissions.REPORT_VIEW) || isOwnerOrAdmin;

  let targetStaffId = validated.staffMembershipId;
  if (!hasReportPermission) {
    targetStaffId = callerMembershipId;
  }

  let billsQuery = db
    .collection("bills")
    .where("organizationId", "==", orgId)
    .where("status", "in", ["active", "partial", "paid"]);

  if (targetBranchId) billsQuery = billsQuery.where("branchId", "==", targetBranchId);
  if (validated.from) billsQuery = billsQuery.where("createdAt", ">=", validated.from);
  if (validated.to) billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);

  const billsSnap = await billsQuery.get();
  const staffStats = new Map<string, { staffMembershipId: string; totalSales: number; billCount: number }>();

  billsSnap.docs.forEach((doc) => {
    const bill = doc.data() as BillDoc;
    const staffId = bill.salespersonMembershipId || bill.createdBy || "unknown";

    if (targetStaffId && staffId !== targetStaffId && bill.createdBy !== targetStaffId) {
      return;
    }

    const existing = staffStats.get(staffId) || {
      staffMembershipId: staffId,
      totalSales: 0,
      billCount: 0,
    };
    existing.totalSales += bill.totalAmount || 0;
    existing.billCount++;
    staffStats.set(staffId, existing);
  });

  const staffSummaries = Array.from(staffStats.values()).map((s) => ({
    ...s,
    totalSales: round2(s.totalSales),
    averageBillValue: s.billCount > 0 ? round2(s.totalSales / s.billCount) : 0,
  }));

  return {
    organizationId: orgId,
    staffSummaries,
  };
});

/**
 * 6. reportsGetPlatformOverview (Super Admin only)
 */
export const reportsGetPlatformOverview = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });

  GetPlatformOverviewReportSchema.parse(request.data || {});

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin authorization required");
  }

  const [orgsSnap, plansSnap] = await Promise.all([
    db.collection("organizations").get(),
    db.collection("subscriptionPlans").get(),
  ]);

  const planCounts: Record<string, number> = {};
  let activeOrgs = 0;
  let suspendedOrgs = 0;

  orgsSnap.docs.forEach((doc) => {
    const data = doc.data();
    const planId = data.planId || "free";
    planCounts[planId] = (planCounts[planId] || 0) + 1;
    if (data.status === "active") activeOrgs++;
    else suspendedOrgs++;
  });

  return {
    totalOrganizations: orgsSnap.size,
    activeOrganizations: activeOrgs,
    suspendedOrganizations: suspendedOrgs,
    organizationsByPlan: planCounts,
    availablePlansCount: plansSnap.size,
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

  const parsed = ExportReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
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
        const data = doc.data() as any;
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
    let billsQuery = db.collection("bills").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]);
    if (targetBranchId) billsQuery = billsQuery.where("branchId", "==", targetBranchId);
    if (validated.from) billsQuery = billsQuery.where("createdAt", ">=", validated.from);
    if (validated.to) billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);

    let outflowsQuery = db.collection("outflows").where("organizationId", "==", orgId).where("status", "==", "confirmed");
    if (targetBranchId) outflowsQuery = outflowsQuery.where("branchId", "==", targetBranchId);
    if (validated.from) outflowsQuery = outflowsQuery.where("createdAt", ">=", validated.from);
    if (validated.to) outflowsQuery = outflowsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);

    const [billsSnap, outflowsSnap, productsSnap] = await Promise.all([
      billsQuery.get(),
      outflowsQuery.get(),
      db.collection("products").where("organizationId", "==", orgId).get(),
    ]);

    const productCostMap = new Map<string, number>();
    productsSnap.docs.forEach((doc) => {
      const data = doc.data() as ProductDoc;
      const effectiveCost = data.weightedAverageCost && data.weightedAverageCost > 0
        ? data.weightedAverageCost
        : (data.costPrice || 0);
      productCostMap.set(doc.id, effectiveCost);
    });

    let totalRevenue = 0;
    let totalCogs = 0;
    billsSnap.docs.forEach((doc) => {
      const bill = doc.data() as BillDoc;
      totalRevenue += bill.totalAmount || 0;
      if (Array.isArray(bill.items)) {
        bill.items.forEach((item) => {
          const unitCost = (item.costSnapshot !== undefined && item.costSnapshot !== null)
            ? item.costSnapshot
            : (productCostMap.get(item.productId) ?? 0);
          totalCogs += (item.quantity || 0) * unitCost;
        });
      }
    });

    let totalExpenses = 0;
    outflowsSnap.docs.forEach((doc) => {
      const outflow = doc.data() as OutflowDoc;
      if (outflow.kind === "expense") {
        totalExpenses += outflow.totalAmount || 0;
      }
    });

    totalRevenue = round2(totalRevenue);
    totalCogs = round2(totalCogs);
    totalExpenses = round2(totalExpenses);
    const grossProfit = round2(totalRevenue - totalCogs);
    const netProfit = round2(grossProfit - totalExpenses);

    csvContent = toCsv([
      { Metric: "Total Revenue", Amount: totalRevenue, BranchId: targetBranchId || "all" },
      { Metric: "Cost of Goods Sold (COGS)", Amount: totalCogs, BranchId: targetBranchId || "all" },
      { Metric: "Gross Profit", Amount: grossProfit, BranchId: targetBranchId || "all" },
      { Metric: "Operational Expenses", Amount: totalExpenses, BranchId: targetBranchId || "all" },
      { Metric: "Net Profit", Amount: netProfit, BranchId: targetBranchId || "all" },
    ]);
  } else if (validated.reportType === "top_products") {
    let billsQuery = db.collection("bills").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]);
    if (targetBranchId) billsQuery = billsQuery.where("branchId", "==", targetBranchId);
    if (validated.from) billsQuery = billsQuery.where("createdAt", ">=", validated.from);
    if (validated.to) billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);
    const billsSnap = await billsQuery.get();
    const productStats = new Map<string, { ProductId: string; Name: string; QuantitySold: number; TotalRevenue: number; BranchId: string }>();

    billsSnap.docs.forEach((doc) => {
      const bill = doc.data() as BillDoc;
      if (Array.isArray(bill.items)) {
        bill.items.forEach((item) => {
          const existing = productStats.get(item.productId) || {
            ProductId: item.productId,
            Name: item.nameSnapshot || "Unknown",
            QuantitySold: 0,
            TotalRevenue: 0,
            BranchId: targetBranchId || "all",
          };
          existing.QuantitySold += item.quantity || 0;
          existing.TotalRevenue += item.subtotal || 0;
          productStats.set(item.productId, existing);
        });
      }
    });

    const rows = Array.from(productStats.values())
      .sort((a, b) => b.TotalRevenue - a.TotalRevenue)
      .map((r) => ({ ...r, TotalRevenue: round2(r.TotalRevenue) }));
    csvContent = toCsv(rows.length > 0 ? rows : [{ ProductId: "none", Name: "No sales", QuantitySold: 0, TotalRevenue: 0, BranchId: targetBranchId || "all" }]);
  } else if (validated.reportType === "staff_sales") {
    let billsQuery = db.collection("bills").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]);
    if (targetBranchId) billsQuery = billsQuery.where("branchId", "==", targetBranchId);
    if (validated.from) billsQuery = billsQuery.where("createdAt", ">=", validated.from);
    if (validated.to) billsQuery = billsQuery.where("createdAt", "<=", `${validated.to}T23:59:59.999Z`);
    const billsSnap = await billsQuery.get();
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
