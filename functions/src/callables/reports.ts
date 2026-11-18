/**
 * Reports & Analytics Callables — Domain Hub
 * 
 * Provides read/aggregation services over existing source-of-truth collections:
 * - Financial: reportsGetRevenue, reportsGetProfitLoss, reportsGetCashBankSummary, computeProfitLoss
 * - Operational: reportsGetPartyStatement, reportsGetOutflowSummary, reportsGetReceivablesAgeing, reportsGetPayablesAgeing
 * - Analytics & Platform: reportsGetStockValuation, reportsGetTopEntities, reportsGetStaffActivity, reportsGetPlatformOverview, reportsExportCsv
 */

export * from "./reports/helpers.js";
export * from "./reports/financialReports.js";
export * from "./reports/operationalReports.js";
export * from "./reports/analyticsReports.js";
