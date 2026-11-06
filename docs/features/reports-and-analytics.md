# Feature Guide: Reports & Analytics Engine

---

## 1. Purpose & Scope
This module provides operational intelligence, real-time Firestore aggregations, financial P&L reporting, inventory valuation, and multi-format CSV exports for Trado:
- **Revenue Analytics**: `reportsGetRevenue` aggregates sales volume and revenue by period.
- **Profit & Loss**: `reportsGetProfitLoss` computes Net Profit by subtracting Weighted Average Cost (WAC) COGS and operational expenses from revenue.
- **Stock Valuation**: `reportsGetStockValuation` values current branch or organization stock using WAC and cost price.
- **Top Entities**: `reportsGetTopEntities` identifies top-selling products and highest-revenue customers.
- **Staff Performance**: `reportsGetStaffActivity` breaks down sales performance by salesperson.
- **CSV Data Export**: `reportsExportCsv` exports raw aggregated reports into compliant CSV format with optional branch scoping.

---

## 2. Actors & Permissions
- **Organization Owner & Finance Director**: Possess `report:view` and `report:export`. Can access all financial reports, P&L, stock valuation, and CSV downloads across the organization.
- **Branch Manager**: Possess `report:view`. Can generate reports scoped specifically to their assigned branch (`branchId`).
- **Super Admin**: Possess `platform:report` or `report:view`. Can view cross-organization platform overviews (`reportsGetPlatformOverview`).

---

## 3. Reporting Functions & Real Firestore Aggregations

Unlike mock reporting layers, Trado's reporting engine executes direct aggregations across Firestore collections:

### 3.1 Revenue Report (`reportsGetRevenue`)
- Queries `bills` where `organizationId == orgId` and `status in ["active", "partial", "paid"]`.
- When `branchId` is passed, filters strictly for that branch.
- Computes:
  - `totalRevenue`: Sum of `totalAmount`.
  - `billCount`: Count of finalized bills.
  - `averageBillValue`: $\frac{\text{totalRevenue}}{\text{billCount}}$.
  - `breakdown`: Daily or monthly revenue series.

### 3.2 Profit & Loss Report (`reportsGetProfitLoss`)
- Aggregates three distinct financial components over the selected date range:
  1. **Total Revenue**: Sum of sales from finalized bills.
  2. **Cost of Goods Sold (COGS)**: Sum of $(\text{quantity} \times \text{product.weightedAvgCost})$ for all sold line items.
  3. **Gross Profit**: $\text{Revenue} - \text{COGS}$.
  4. **Operating Expenses**: Sum of `totalAmount` from `outflows` where `kind == "expense"`.
  5. **Net Profit**: $\text{Gross Profit} - \text{Operating Expenses}$.

### 3.3 Stock Valuation Report (`reportsGetStockValuation`)
- Reads all active products in the organization.
- If `branchId` is supplied: reads `stockBalances` specifically for that branch to calculate branch valuation.
- If `branchId` is omitted: values total organization stock using `products.currentStock`.
- Formula:
  $$\text{Stock Valuation} = \sum_{\text{products}} (\text{currentStock} \times (\text{weightedAvgCost} \parallel \text{costPrice}))$$

### 3.4 Top Entities Report (`reportsGetTopEntities`)
- When `entityType == "products"`: Aggregates total units sold and revenue per product.
- When `entityType == "customers"`: Aggregates total spend and bill count per customer.
- Supports configurable result limits (default: 10).

### 3.5 Staff Sales Activity (`reportsGetStaffActivity`)
- Groups finalized bills by `salespersonMembershipId`.
- Computes bill count and total revenue generated per staff member.

### 3.6 CSV Data Export (`reportsExportCsv`)
- Formats reports into RFC 4180-compliant CSV files.
- Supported report types:
  1. `revenue`: Date, BillCount, TotalRevenue, BranchId.
  2. `profit_loss`: Metric, Amount, BranchId.
  3. `stock_valuation`: ProductCode, Name, Category, StockQuantity, ValuationRate, TotalValue, BranchId.
  4. `top_products`: ProductId, Name, QuantitySold, TotalRevenue, BranchId.
  5. `staff_sales`: StaffMembershipId, BillCount, TotalRevenue, BranchId.

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Exporting Monthly Profit & Loss to CSV
1. **Manager calls `reportsExportCsv`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "reportType": "profit_loss",
       "from": "2026-10-01",
       "to": "2026-10-31",
       "branchId": "main-branch"
     }
     ```
2. **Backend Processing**:
   - Computes revenue, COGS, gross profit, and expenses for `main-branch`.
   - Generates CSV string:
     ```csv
     "Metric","Amount","BranchId"
     "Total Revenue","12000","main-branch"
     "Cost of Goods Sold (COGS)","8500","main-branch"
     "Gross Profit","3500","main-branch"
     "Operational Expenses","1500","main-branch"
     "Net Profit","2000","main-branch"
     ```
   - Returns `{ filename: "profit_loss_main-branch_2026-10-01_2026-10-31.csv", csvContent: "..." }`.

---

## 5. Branch-Scoping Policy
- **When `branchId` is passed**: Every query (bills, outflows, stockBalances) restricts results to that operating branch.
- **When `branchId` is omitted**: Reports aggregate data across the entire organization (all active branches).

---

## 6. Local Testing & Verification
- **Integration Tests**: Part 1 of `functions/scripts/test-phase3-integration.js`.
  - Tests verify revenue aggregation, P&L (WAC COGS + expense deduction), stock valuation, top entities, staff sales, and CSV generation across all 5 report types.

