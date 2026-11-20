/**
 * Reports & Analytics - Financial Reports
 * 
 * - computeProfitLoss: Master profit & loss calculation
 * - reportsGetRevenue: Revenue and sales trends
 * - reportsGetProfitLoss: Full P&L statement
 * - reportsGetCashBankSummary: Operational cash and bank liquidity summary
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { db } from "../../services/firebase.js";
import { resolveRequestContext } from "../../services/contextResolver.js";
import { DEFAULT_ORG_TIMEZONE, localDateInTimezone } from "../../services/subscription.js";
import { AppPermissions } from "../../constants/permissions.js";
import {
  GetRevenueReportSchema,
  GetProfitLossReportSchema,
  GetCashBankSummarySchema,
  GetBranchSummarySchema,
} from "../../validation/schemas.js";
import { parseInput } from "../../validation/parseInput.js";
import { Money, roundTo, getCurrencyDecimals, requireCurrency } from "../../services/money.js";
import {
  BillDoc,
  OutflowDoc,
  DailySummaryDoc,
  ReturnDoc,
  StockMovementDoc,
  OrganizationDoc,
  FinancialAccountDoc,
  PaymentProcessingFeeDoc,
  BranchDoc,
} from "../../types/models.js";
import { ReturnType, ReturnDisposition } from "../../constants/enums.js";
import { WRITE_OFF_MOVEMENT_TYPES, billsInPeriod, sourceLinesById } from "./helpers.js";

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
  const currency = requireCurrency(orgData.currency, `organization "${orgId}"`);
  const decimals = getCurrencyDecimals(currency);

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

  grossRevenue = Money.amount(grossRevenue, currency);
  salesReturns = Money.amount(salesReturns, currency);
  const netRevenue = Money.amount(Math.max(0, grossRevenue - salesReturns), currency);

  grossCogs = Money.amount(grossCogs, currency);
  cogsReversals = Money.amount(cogsReversals, currency);
  const netCogs = Money.amount(Math.max(0, grossCogs - cogsReversals), currency);

  let totalExpenses = 0;
  let outflowCount = 0;
  const expensesByCategory: Record<string, number> = {};

  outflowsSnap.docs.forEach((doc) => {
    const outflow = doc.data() as OutflowDoc;
    if (outflow.kind === "expense") {
      const amt = outflow.totalAmount || 0;
      totalExpenses += amt;
      const cat = outflow.expenseCategoryId || "general";
      expensesByCategory[cat] = Money.amount((expensesByCategory[cat] || 0) + amt, currency);
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
  paymentFeesTotal = Money.amount(paymentFeesTotal, currency);
  if (paymentFeesTotal > 0) {
    totalExpenses += paymentFeesTotal;
    expensesByCategory["payment_processing_fees"] = Money.amount(
      (expensesByCategory["payment_processing_fees"] || 0) + paymentFeesTotal,
      currency
    );
  }

  totalExpenses = Money.amount(totalExpenses, currency);

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
  inventoryWriteOff = Money.amount(inventoryWriteOff, currency);

  const grossProfit = Money.amount(netRevenue - netCogs, currency);
  const grossMarginPercent = netRevenue > 0 ? roundTo((grossProfit / netRevenue) * 100, 2) : 0;
  const netProfit = Money.amount(grossProfit - totalExpenses - inventoryWriteOff, currency);
  const netMarginPercent = netRevenue > 0 ? roundTo((netProfit / netRevenue) * 100, 2) : 0;

  return {
    branchId: targetBranchId || null,
    from: effectiveFrom || null,
    to: effectiveTo || null,
    periodType: validated.periodType || "custom",
    timezone: tz,
    currencyDecimals: decimals,
    financialYearStartMonth: fyStartMonth,
    grossRevenue,
    discounts: Money.amount(totalDiscounts, currency),
    tax: Money.amount(totalTax, currency),
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
  const currency = context.organization.currency;

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
      const revs: number[] = [];
      summariesSnap.docs.forEach((doc) => {
        const data = doc.data() as DailySummaryDoc;
        revs.push(data.totalRevenue || 0);
        billCount += data.billCount || 0;
        breakdown.push({
          period: data.date,
          revenue: data.totalRevenue || 0,
          count: data.billCount || 0,
        });
      });
      totalRevenue = Money.sum(revs, currency);
    }
  }

  if (breakdown.length === 0) {
    // Direct scan on source bills (branch-aware)
    const billsSnap = await billsInPeriod(orgId, { branchId: targetBranchId, from: validated.from, to: validated.to }).get();
    const billAmounts: number[] = [];
    billsSnap.docs.forEach((doc) => {
      const data = doc.data() as BillDoc;
      billAmounts.push(data.totalAmount || 0);
      billCount++;
    });
    totalRevenue = Money.sum(billAmounts, currency);

    breakdown.push({
      period: validated.from || "all-time",
      revenue: Money.amount(totalRevenue, currency),
      count: billCount,
    });
  }

  breakdown.sort((a, b) => a.period.localeCompare(b.period));

  return {
    totalRevenue: Money.amount(totalRevenue, currency),
    billCount,
    averageBillValue: billCount > 0 ? Money.amount(totalRevenue / billCount, currency) : 0,
    breakdown,
  };
});

/**
 * 2. reportsGetProfitLoss
 */
export const reportsGetProfitLoss = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.REPORT_VIEW,
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
 * 12. reportsGetCashBankSummary
 */
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
  const currency = ctx.organization.currency;
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
        totals.cashInHand = Money.amount(totals.cashInHand + balance, currency);
        break;
      case "bank":
        totals.bankBalance = Money.amount(totals.bankBalance + balance, currency);
        break;
      case "digital":
        totals.digitalWallets = Money.amount(totals.digitalWallets + balance, currency);
        break;
      case "clearing":
      case "control":
        totals.clearingAndControl = Money.amount(totals.clearingAndControl + balance, currency);
        break;
    }
    totals.totalOperationalLiquidity = Money.amount(totals.totalOperationalLiquidity + balance, currency);

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

/**
 * 13. reportsGetBranchSummary (U-5; D-F12)
 * Cross-branch comparative balance and sales metrics with strict scope enforcement.
 */
export const reportsGetBranchSummary = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetBranchSummarySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    requiredPermission: AppPermissions.REPORT_VIEW,
  });

  const orgId = ctx.organizationId;
  const currency = ctx.organization.currency;
  const isOrgScoped = ctx.isOwner || ctx.role?.code === "admin" || ctx.isSuperAdmin || ctx.can(AppPermissions.BRANCH_MANAGE);

  // Validate scope convention (Q-F12)
  if (input.scope === "organization" && !isOrgScoped) {
    throw new HttpsError("permission-denied", "Unauthorized branch query.", { reason: "BRANCH_ACCESS_DENIED" });
  }

  if (input.branchId && !isOrgScoped && input.branchId !== ctx.branchId) {
    throw new HttpsError("permission-denied", "Unauthorized branch query.", { reason: "BRANCH_ACCESS_DENIED" });
  }

  if (input.branchIds && input.branchIds.length > 0 && !isOrgScoped) {
    const unauthorized = input.branchIds.some((b) => b !== ctx.branchId);
    if (unauthorized) {
      throw new HttpsError("permission-denied", "Unauthorized branch query.", { reason: "BRANCH_ACCESS_DENIED" });
    }
  }

  // Determine branch IDs to report on
  const branchesRef = db.collection("organizations").doc(orgId).collection("branches");
  const branchesSnap = await branchesRef.where("isActive", "==", true).get();
  let branches = branchesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as BranchDoc) }));

  if (input.branchId) {
    branches = branches.filter((b) => b.id === input.branchId);
  } else if (input.branchIds && input.branchIds.length > 0) {
    branches = branches.filter((b) => input.branchIds!.includes(b.id));
  } else if (!isOrgScoped) {
    branches = branches.filter((b) => b.id === ctx.branchId);
  }

  // Pre-fetch all operational financial accounts
  const accountsSnap = await db.collection("financialAccounts").where("organizationId", "==", orgId).where("isActive", "==", true).get();
  const accounts = accountsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as FinancialAccountDoc) }));

  // Aggregate metrics per branch
  const branchSummaries = await Promise.all(
    branches.map(async (branch) => {
      // 1. Sales (Bills)
      let billsQuery = db.collection("bills").where("organizationId", "==", orgId).where("branchId", "==", branch.id).where("status", "==", "finalized");
      if (input.from) billsQuery = billsQuery.where("createdAt", ">=", input.from);
      if (input.to) billsQuery = billsQuery.where("createdAt", "<=", input.to);
      const billsSnap = await billsQuery.get();
      let totalRevenue = 0;
      billsSnap.docs.forEach((doc) => {
        const b = doc.data() as BillDoc;
        totalRevenue += b.totalAmount || 0;
      });

      // 2. Outflows (Purchases & Expenses)
      let outflowsQuery = db.collection("outflows").where("organizationId", "==", orgId).where("branchId", "==", branch.id).where("status", "==", "confirmed");
      if (input.from) outflowsQuery = outflowsQuery.where("createdAt", ">=", input.from);
      if (input.to) outflowsQuery = outflowsQuery.where("createdAt", "<=", input.to);
      const outflowsSnap = await outflowsQuery.get();
      let totalPurchases = 0;
      let totalExpenses = 0;
      outflowsSnap.docs.forEach((doc) => {
        const o = doc.data() as OutflowDoc;
        if (o.kind === "purchase") totalPurchases += o.totalAmount || 0;
        else totalExpenses += o.totalAmount || 0;
      });

      // 3. Financial Accounts Liquidity
      const branchAccounts = accounts.filter((a) => a.branchId === branch.id || a.assignedBranchIds?.includes(branch.id));
      let cashBalance = 0;
      let bankBalance = 0;
      branchAccounts.forEach((a) => {
        const bal = a.currentBalance || 0;
        if (a.accountType === "cash") cashBalance += bal;
        else bankBalance += bal;
      });

      return {
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        sales: {
          totalRevenue: Money.amount(totalRevenue, currency),
          billCount: billsSnap.size,
        },
        outflows: {
          totalPurchases: Money.amount(totalPurchases, currency),
          totalExpenses: Money.amount(totalExpenses, currency),
          outflowCount: outflowsSnap.size,
        },
        liquidity: {
          cashBalance: Money.amount(cashBalance, currency),
          bankBalance: Money.amount(bankBalance, currency),
          totalLiquidity: Money.amount(cashBalance + bankBalance, currency),
          accountCount: branchAccounts.length,
        },
      };
    })
  );

  const orgTotals = {
    totalRevenue: Money.sum(branchSummaries.map((b) => b.sales.totalRevenue), currency),
    totalBills: branchSummaries.reduce((s, b) => s + b.sales.billCount, 0),
    totalPurchases: Money.sum(branchSummaries.map((b) => b.outflows.totalPurchases), currency),
    totalExpenses: Money.sum(branchSummaries.map((b) => b.outflows.totalExpenses), currency),
    totalLiquidity: Money.sum(branchSummaries.map((b) => b.liquidity.totalLiquidity), currency),
    branchCount: branchSummaries.length,
  };

  return {
    organizationId: orgId,
    scope: input.scope || (input.branchId ? "branch" : input.branchIds ? "branches" : "organization"),
    branchSummaries,
    branches: branchSummaries,
    orgTotals,
    totals: orgTotals,
  };
});
