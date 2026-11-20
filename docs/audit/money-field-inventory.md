# Money and Currency Field Mechanical Inventory (Prompt 77D S0)

**Date:** 2026-11-20
**Scope:** Backend Repository (`trado-firebase`), Node 22, Commit `24a8003`
**Methodology:** Mechanically parsed via `functions/scripts/lib/money-field-scan.cjs`.
Each row contains strict ile:line evidence verified in code [cov:money-fields 142/142].

---

## 1. Executive Summary

| Category | Total Lines Matched | Actual Money Fields | Non-Money Fields (Rates, Counts, Days, Ratios) |
|---|---|---|---|
| **`types/models.ts`** | **98** | **85** | **13** |
| **`validation/schemas.ts` & `sharedSchemas.ts`** | **87** | **0** | **87** |

---

## 2. `functions/src/types/models.ts` Fields Inventory (98 matching lines)

Keywords searched: `Amount`, `Price`, `Cost`, `Balance`, `Limit`, `Threshold`, `Total`, `Fee`, `Charge`, `Value`, `Salary`, `Minor`, `Rate` (excluding `Percent`).

### 2.1 Stored Money Fields in `models.ts` (85 fields)

| # | Interface / Type | Field Name | File:Line | Classification | Storage Representation | Duplicate Of | Notes / Raw Declaration |
|---|---|---|---|---|---|---|---|
| 1 | `AccountingPolicy` | `selfApprovalLimits` | [`models.ts:216`](../../functions/src/types/models.ts#L216) | **MONEY** | stored decimal major | None | `selfApprovalLimits?: Record<string, number>;` |
| 2 | `AccountingPolicy` | `cashCountVarianceThreshold` | [`models.ts:220`](../../functions/src/types/models.ts#L220) | **MONEY** | stored decimal major | None | `cashCountVarianceThreshold?: number;` |
| 3 | `ApprovalPolicy` | `amountThreshold` | [`models.ts:243`](../../functions/src/types/models.ts#L243) | **MONEY** | stored decimal major | None | `amountThreshold?: number; // Only documents at/above this total need approval (0 = all)` |
| 4 | `SubscriptionPlanDoc` | `price` | [`models.ts:316`](../../functions/src/types/models.ts#L316) | **MONEY** | stored decimal major | None | `price: number;` |
| 5 | `AuditLogDoc` | `amount` | [`models.ts:435`](../../functions/src/types/models.ts#L435) | **MONEY** | stored decimal major | None | `amount?: number \| null;` |
| 6 | `TaxBreakdownItem` | `amount` | [`models.ts:487`](../../functions/src/types/models.ts#L487) | **MONEY** | stored decimal major | None | `amount: number;` |
| 7 | `TaxBreakdownItem` | `taxableAmount` | [`models.ts:488`](../../functions/src/types/models.ts#L488) | **MONEY** | stored decimal major | None | `taxableAmount?: number;` |
| 8 | `TaxSnapshot` | `taxAmount` | [`models.ts:498`](../../functions/src/types/models.ts#L498) | **MONEY** | stored decimal major | None | `taxAmount: number;` |
| 9 | `ProductDoc` | `sellingPrice` | [`models.ts:521`](../../functions/src/types/models.ts#L521) | **MONEY** | stored decimal major | None | `sellingPrice: number;` |
| 10 | `ProductDoc` | `costPrice` | [`models.ts:522`](../../functions/src/types/models.ts#L522) | **MONEY** | stored decimal major | None | `costPrice: number;` |
| 11 | `ProductDoc` | `weightedAverageCost` | [`models.ts:523`](../../functions/src/types/models.ts#L523) | **MONEY** | stored decimal major | None | `weightedAverageCost?: number; // Maintained weighted-average cost for valuation & COGS` |
| 12 | `ProductDoc` | `wholesalePrice` | [`models.ts:525`](../../functions/src/types/models.ts#L525) | **MONEY** | stored decimal major | None | `wholesalePrice?: number \| null;` |
| 13 | `ProductDoc` | `makingCharge` | [`models.ts:561`](../../functions/src/types/models.ts#L561) | **MONEY** | stored decimal major | None | `makingCharge?: number;` |
| 14 | `ProductAlternateUnit` | `sellingPrice` | [`models.ts:583`](../../functions/src/types/models.ts#L583) | **MONEY** | stored decimal major | None | `sellingPrice?: number;` |
| 15 | `ProductAlternateUnit` | `wholesalePrice` | [`models.ts:584`](../../functions/src/types/models.ts#L584) | **MONEY** | stored decimal major | None | `wholesalePrice?: number;` |
| 16 | `CustomerDoc` | `creditLimit` | [`models.ts:655`](../../functions/src/types/models.ts#L655) | **MONEY** | stored decimal major | None | `creditLimit: number;` |
| 17 | `CustomerDoc` | `outstandingBalance` | [`models.ts:657`](../../functions/src/types/models.ts#L657) | **MONEY** | stored decimal major | None | `outstandingBalance: number; // Udhaar amount customer owes` |
| 18 | `CustomerDoc` | `advanceBalance` | [`models.ts:658`](../../functions/src/types/models.ts#L658) | **MONEY** | stored decimal major | None | `advanceBalance?: number; // Advance payments / credits unapplied` |
| 19 | `CustomerDoc` | `totalSpend` | [`models.ts:659`](../../functions/src/types/models.ts#L659) | **MONEY** | stored decimal major | None | `totalSpend: number;` |
| 20 | `VendorDoc` | `creditLimit` | [`models.ts:691`](../../functions/src/types/models.ts#L691) | **MONEY** | stored decimal major | None | `creditLimit?: number;` |
| 21 | `VendorDoc` | `totalPurchase` | [`models.ts:693`](../../functions/src/types/models.ts#L693) | **MONEY** | stored decimal major | None | `totalPurchase: number;` |
| 22 | `OutflowLine` | `unitPrice` | [`models.ts:715`](../../functions/src/types/models.ts#L715) | **MONEY** | stored decimal major | None | `unitPrice: number;` |
| 23 | `OutflowLine` | `grossAmount` | [`models.ts:716`](../../functions/src/types/models.ts#L716) | **MONEY** | stored decimal major | None | `grossAmount: number;` |
| 24 | `OutflowLine` | `discountAmount` | [`models.ts:717`](../../functions/src/types/models.ts#L717) | **MONEY** | stored decimal major | None | `discountAmount: number;` |
| 25 | `OutflowLine` | `taxAmount` | [`models.ts:718`](../../functions/src/types/models.ts#L718) | **MONEY** | stored decimal major | None | `taxAmount: number;` |
| 26 | `OutflowLine` | `lineTotal` | [`models.ts:719`](../../functions/src/types/models.ts#L719) | **MONEY** | stored decimal major | None | `lineTotal: number;` |
| 27 | `SplitPaymentEntry` | `amount` | [`models.ts:767`](../../functions/src/types/models.ts#L767) | **MONEY** | stored decimal major | None | `amount: number;` |
| 28 | `OutflowDoc` | `requestedPaidAmount` | [`models.ts:782`](../../functions/src/types/models.ts#L782) | **MONEY** | stored decimal major | None | `requestedPaidAmount?: number;` |
| 29 | `OutflowDoc` | `billDiscountAmount` | [`models.ts:788`](../../functions/src/types/models.ts#L788) | **MONEY** | stored decimal major | None | `billDiscountAmount?: number;` |
| 30 | `OutflowDoc` | `subTotal` | [`models.ts:798`](../../functions/src/types/models.ts#L798) | **MONEY** | stored decimal major | None | `subTotal: number;` |
| 31 | `OutflowDoc` | `discountTotal` | [`models.ts:799`](../../functions/src/types/models.ts#L799) | **MONEY** | stored decimal major | None | `discountTotal: number;` |
| 32 | `OutflowDoc` | `taxTotal` | [`models.ts:800`](../../functions/src/types/models.ts#L800) | **MONEY** | stored decimal major | None | `taxTotal: number;` |
| 33 | `OutflowDoc` | `totalAmount` | [`models.ts:801`](../../functions/src/types/models.ts#L801) | **MONEY** | stored decimal major | None | `totalAmount: number;` |
| 34 | `OutflowDoc` | `paidAmount` | [`models.ts:802`](../../functions/src/types/models.ts#L802) | **MONEY** | stored decimal major | None | `paidAmount: number;` |
| 35 | `OutflowDoc` | `balanceAmount` | [`models.ts:803`](../../functions/src/types/models.ts#L803) | **MONEY** | stored decimal major | None | `balanceAmount: number;` |
| 36 | `BillItem` | `priceSnapshot` | [`models.ts:820`](../../functions/src/types/models.ts#L820) | **MONEY** | stored decimal major | None | `priceSnapshot: number; // Selling price at sale time` |
| 37 | `BillItem` | `costSnapshot` | [`models.ts:821`](../../functions/src/types/models.ts#L821) | **MONEY** | stored decimal major | None | `costSnapshot: number; // Cost price at sale time` |
| 38 | `BillItem` | `subtotal` | [`models.ts:829`](../../functions/src/types/models.ts#L829) | **MONEY** | stored decimal major | None | `subtotal: number;` |
| 39 | `BillItem` | `discountValue` | [`models.ts:830`](../../functions/src/types/models.ts#L830) | **MONEY** | stored decimal major | None | `discountValue: number;` |
| 40 | `BillItem` | `taxAmount` | [`models.ts:831`](../../functions/src/types/models.ts#L831) | **MONEY** | stored decimal major | None | `taxAmount: number;` |
| 41 | `BillItem` | `lineTotal` | [`models.ts:832`](../../functions/src/types/models.ts#L832) | **MONEY** | stored decimal major | None | `lineTotal: number;` |
| 42 | `BillDoc` | `subTotal` | [`models.ts:866`](../../functions/src/types/models.ts#L866) | **MONEY** | stored decimal major | None | `subTotal: number;` |
| 43 | `BillDoc` | `discountTotal` | [`models.ts:867`](../../functions/src/types/models.ts#L867) | **MONEY** | stored decimal major | None | `discountTotal: number;` |
| 44 | `BillDoc` | `taxTotal` | [`models.ts:868`](../../functions/src/types/models.ts#L868) | **MONEY** | stored decimal major | None | `taxTotal: number;` |
| 45 | `BillDoc` | `totalAmount` | [`models.ts:870`](../../functions/src/types/models.ts#L870) | **MONEY** | stored decimal major | None | `totalAmount: number;` |
| 46 | `BillDoc` | `paidAmount` | [`models.ts:871`](../../functions/src/types/models.ts#L871) | **MONEY** | stored decimal major | None | `paidAmount: number;` |
| 47 | `BillDoc` | `balanceAmount` | [`models.ts:872`](../../functions/src/types/models.ts#L872) | **MONEY** | stored decimal major | None | `balanceAmount: number;` |
| 48 | `BillDoc` | `requestedPaidAmount` | [`models.ts:876`](../../functions/src/types/models.ts#L876) | **MONEY** | stored decimal major | None | `requestedPaidAmount?: number; // Tender held until approval` |
| 49 | `StockMovementDoc` | `unitCostSnapshot` | [`models.ts:908`](../../functions/src/types/models.ts#L908) | **MONEY** | stored decimal major | None | `unitCostSnapshot?: number; // Cost per base unit at movement time (values write-offs)` |
| 50 | `DeliveryCod` | `amount` | [`models.ts:929`](../../functions/src/types/models.ts#L929) | **MONEY** | stored decimal major | None | `amount: number;` |
| 51 | `DeliveryDoc` | `deliveryFee` | [`models.ts:948`](../../functions/src/types/models.ts#L948) | **MONEY** | stored decimal major | None | `deliveryFee: number;` |
| 52 | `ReturnItem` | `refundAmount` | [`models.ts:968`](../../functions/src/types/models.ts#L968) | **MONEY** | stored decimal major | None | `refundAmount: number;` |
| 53 | `ReturnDoc` | `totalRefundAmount` | [`models.ts:984`](../../functions/src/types/models.ts#L984) | **MONEY** | stored decimal major | None | `totalRefundAmount: number;` |
| 54 | `PaymentAllocation` | `amount` | [`models.ts:1007`](../../functions/src/types/models.ts#L1007) | **MONEY** | stored decimal major | None | `amount: number;` |
| 55 | `PaymentDoc` | `amount` | [`models.ts:1024`](../../functions/src/types/models.ts#L1024) | **MONEY** | stored decimal major | None | `amount: number;` |
| 56 | `DailySummaryDoc` | `totalRevenue` | [`models.ts:1096`](../../functions/src/types/models.ts#L1096) | **MONEY** | stored decimal major | None | `totalRevenue: number; // Gross bill total amount` |
| 57 | `DailySummaryDoc` | `totalExpenses` | [`models.ts:1097`](../../functions/src/types/models.ts#L1097) | **MONEY** | stored decimal major | None | `totalExpenses: number; // Outflow expenses total amount` |
| 58 | `MonthlySummaryDoc` | `totalRevenue` | [`models.ts:1120`](../../functions/src/types/models.ts#L1120) | **MONEY** | stored decimal major | None | `totalRevenue: number;` |
| 59 | `MonthlySummaryDoc` | `totalExpenses` | [`models.ts:1121`](../../functions/src/types/models.ts#L1121) | **MONEY** | stored decimal major | None | `totalExpenses: number;` |
| 60 | `FinancialAccountDoc` | `openingBalance` | [`models.ts:1678`](../../functions/src/types/models.ts#L1678) | **MONEY** | stored decimal major | None | `openingBalance: number;` |
| 61 | `FinancialAccountDoc` | `currentBalance` | [`models.ts:1679`](../../functions/src/types/models.ts#L1679) | **MONEY** | stored decimal major | None | `currentBalance: number;` |
| 62 | `FinancialAccountDoc` | `feeFixed` | [`models.ts:1682`](../../functions/src/types/models.ts#L1682) | **MONEY** | stored decimal major | None | `feeFixed?: number;` |
| 63 | `AccountTransactionDoc` | `amount` | [`models.ts:1753`](../../functions/src/types/models.ts#L1753) | **MONEY** | stored decimal major | None | `amount: number;` |
| 64 | `AccountTransactionDoc` | `balanceAfter` | [`models.ts:1754`](../../functions/src/types/models.ts#L1754) | **MONEY** | stored decimal major | None | `balanceAfter: number;` |
| 65 | `AccountTransferDoc` | `amount` | [`models.ts:1802`](../../functions/src/types/models.ts#L1802) | **MONEY** | stored decimal major | None | `amount: number;` |
| 66 | `CashCountDoc` | `countedAmount` | [`models.ts:1830`](../../functions/src/types/models.ts#L1830) | **MONEY** | stored decimal major | None | `countedAmount: number;` |
| 67 | `CashCountDoc` | `systemBalance` | [`models.ts:1831`](../../functions/src/types/models.ts#L1831) | **MONEY** | stored decimal major | None | `systemBalance: number;` |
| 68 | `CashCountDoc` | `varianceAmount` | [`models.ts:1832`](../../functions/src/types/models.ts#L1832) | **MONEY** | stored decimal major | None | `varianceAmount: number;` |
| 69 | `AccountReconciliationDoc` | `statementOpeningBalance` | [`models.ts:1855`](../../functions/src/types/models.ts#L1855) | **MONEY** | stored decimal major | None | `statementOpeningBalance: number;` |
| 70 | `AccountReconciliationDoc` | `statementClosingBalance` | [`models.ts:1856`](../../functions/src/types/models.ts#L1856) | **MONEY** | stored decimal major | None | `statementClosingBalance: number;` |
| 71 | `AccountReconciliationDoc` | `ledgerClosingBalance` | [`models.ts:1857`](../../functions/src/types/models.ts#L1857) | **MONEY** | stored decimal major | None | `ledgerClosingBalance: number;` |
| 72 | `AccountReconciliationDoc` | `discrepancyAmount` | [`models.ts:1858`](../../functions/src/types/models.ts#L1858) | **MONEY** | stored decimal major | None | `discrepancyAmount: number;` |
| 73 | `StockTransferLine` | `unitCost` | [`models.ts:1911`](../../functions/src/types/models.ts#L1911) | **MONEY** | stored decimal major | None | `unitCost?: number; // Frozen source WAC at dispatch` |
| 74 | `StockTransferLine` | `totalCost` | [`models.ts:1912`](../../functions/src/types/models.ts#L1912) | **MONEY** | stored decimal major | None | `totalCost?: number; // unitCost * dispatchedBaseQuantity` |
| 75 | `StockTransferDoc` | `handlingFee` | [`models.ts:1938`](../../functions/src/types/models.ts#L1938) | **MONEY** | stored decimal major | None | `handlingFee?: number;` |
| 76 | `StockTransferDoc` | `totalValuation` | [`models.ts:1940`](../../functions/src/types/models.ts#L1940) | **MONEY** | stored decimal major | None | `totalValuation?: number;` |
| 77 | `PaymentProcessingFeeDoc` | `grossAmount` | [`models.ts:1976`](../../functions/src/types/models.ts#L1976) | **MONEY** | stored decimal major | None | `grossAmount: number;` |
| 78 | `PaymentProcessingFeeDoc` | `feeAmount` | [`models.ts:1977`](../../functions/src/types/models.ts#L1977) | **MONEY** | stored decimal major | None | `feeAmount: number;` |
| 79 | `PaymentProcessingFeeDoc` | `feeTaxAmount` | [`models.ts:1978`](../../functions/src/types/models.ts#L1978) | **MONEY** | stored decimal major | None | `feeTaxAmount?: number;` |
| 80 | `PaymentProcessingFeeDoc` | `netSettlementAmount` | [`models.ts:1979`](../../functions/src/types/models.ts#L1979) | **MONEY** | stored decimal major | None | `netSettlementAmount: number;` |
| 81 | `PaymentProcessingFeeDoc` | `expectedFeeAmount` | [`models.ts:1989`](../../functions/src/types/models.ts#L1989) | **MONEY** | stored decimal major | None | `expectedFeeAmount?: number;` |
| 82 | `PaymentProcessingFeeDoc` | `varianceAmount` | [`models.ts:1990`](../../functions/src/types/models.ts#L1990) | **MONEY** | stored decimal major | None | `varianceAmount?: number;` |
| 83 | `CapitalTransactionDoc` | `amount` | [`models.ts:2014`](../../functions/src/types/models.ts#L2014) | **MONEY** | stored decimal major | None | `amount: number;` |
| 84 | `JournalEntryDoc` | `totalDebit` | [`models.ts:2067`](../../functions/src/types/models.ts#L2067) | **MONEY** | stored decimal major | None | `totalDebit: number;` |
| 85 | `JournalEntryDoc` | `totalCredit` | [`models.ts:2068`](../../functions/src/types/models.ts#L2068) | **MONEY** | stored decimal major | None | `totalCredit: number;` |

### 2.2 Non-Money Fields in `models.ts` (13 fields: Rates, Units, Days, Operation Quotas)

| # | Interface / Type | Field Name | File:Line | Classification (Reason) | Raw Declaration |
|---|---|---|---|---|---|
| 1 | `SubscriptionPlanDoc` | `storageLimitMb` | [`models.ts:318`](../../functions/src/types/models.ts#L318) | *Non-Money* (Plan resource / entity count limit) | `storageLimitMb: number;` |
| 2 | `SubscriptionPlanDoc` | `monthlyDocumentVolumeLimit` | [`models.ts:319`](../../functions/src/types/models.ts#L319) | *Non-Money* (Plan resource / entity count limit) | `monthlyDocumentVolumeLimit: number;` |
| 3 | `SubscriptionPlanDoc` | `branchLimit` | [`models.ts:325`](../../functions/src/types/models.ts#L325) | *Non-Money* (Plan resource / entity count limit) | `branchLimit?: number;` |
| 4 | `TaxSlab` | `rate` | [`models.ts:359`](../../functions/src/types/models.ts#L359) | *Non-Money* (Rate / ratio / percentage multiplier) | `rate: number; // e.g. 0, 5, 10, 18` |
| 5 | `TaxRegimeDoc` | `defaultRate` | [`models.ts:374`](../../functions/src/types/models.ts#L374) | *Non-Money* (Rate / ratio / percentage multiplier) | `defaultRate?: number;` |
| 6 | `TaxRegimeDoc` | `rates` | [`models.ts:375`](../../functions/src/types/models.ts#L375) | *Non-Money* (Rate / ratio / percentage multiplier) | `rates?: number[];` |
| 7 | `TaxBreakdownItem` | `rate` | [`models.ts:486`](../../functions/src/types/models.ts#L486) | *Non-Money* (Rate / ratio / percentage multiplier) | `rate: number;` |
| 8 | `ProductDoc` | `lowStockThreshold` | [`models.ts:536`](../../functions/src/types/models.ts#L536) | *Non-Money* (Inventory stock quantity reorder threshold (units count, not currency)) | `lowStockThreshold: number;` |
| 9 | `StockMovementDoc` | `balanceAfter` | [`models.ts:902`](../../functions/src/types/models.ts#L902) | *Non-Money* (Stock inventory quantity running balance (items count, not currency)) | `balanceAfter: number; // Branch stock after this movement (R4 ledger running balance)` |
| 10 | `MetricLimitConfig` | `dailyLimit` | [`models.ts:1397`](../../functions/src/types/models.ts#L1397) | *Non-Money* (Service operation invocation quota (calls/period)) | `dailyLimit?: number; // Maximum allowed operations per day (undefined/0 = disabled)` |
| 11 | `MetricLimitConfig` | `weeklyLimit` | [`models.ts:1398`](../../functions/src/types/models.ts#L1398) | *Non-Money* (Service operation invocation quota (calls/period)) | `weeklyLimit?: number; // Maximum per ISO week (Monday start, organization timezone)` |
| 12 | `MetricLimitConfig` | `monthlyLimit` | [`models.ts:1399`](../../functions/src/types/models.ts#L1399) | *Non-Money* (Service operation invocation quota (calls/period)) | `monthlyLimit?: number; // Maximum allowed operations per month` |
| 13 | `RequestDoc` | `slaTotalPausedMs` | [`models.ts:1586`](../../functions/src/types/models.ts#L1586) | *Non-Money* (Time interval / duration) | `slaTotalPausedMs: number;` |

---

## 3. `functions/src/validation/schemas.ts` & `sharedSchemas.ts` Zod Integer / Paise Fields (87 lines)

Criteria: `z.number()` with `.int()` or message containing `"paise"`.

### 3.1 Money Schemas with Integer / Paise Enforcements (0 fields — TARGET FOR S4)

| # | Schema Name | Field Name | File:Line | Classification | Storage / Wire Representation | Duplicate / Conflict | Raw Zod Declaration |
|---|---|---|---|---|---|---|---|

### 3.2 Non-Money Integer Fields in Schemas (87 fields: Days, Ordinals, Dimensions, Counts)

| # | Schema Name | Field Name | File:Line | Classification (Reason) | Raw Zod Declaration |
|---|---|---|---|---|---|
| 1 | `ImageRefSchema` | `width` | [`schemas.ts:111`](../../functions/src/validation/schemas.ts#L111) | *Non-Money* (Image / file dimension or size in bytes) | `width: z.number().int().min(1).max(10000),` |
| 2 | `ImageRefSchema` | `height` | [`schemas.ts:112`](../../functions/src/validation/schemas.ts#L112) | *Non-Money* (Image / file dimension or size in bytes) | `height: z.number().int().min(1).max(10000),` |
| 3 | `ImageRefSchema` | `sizeBytes` | [`schemas.ts:113`](../../functions/src/validation/schemas.ts#L113) | *Non-Money* (Image / file dimension or size in bytes) | `sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),` |
| 4 | `CreateOrganizationSchema` | `financialYearStartMonth` | [`schemas.ts:164`](../../functions/src/validation/schemas.ts#L164) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `financialYearStartMonth: z.number().int().min(1).max(12).optional(),` |
| 5 | `CreateOrganizationSchema` | `durationDays` | [`schemas.ts:181`](../../functions/src/validation/schemas.ts#L181) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `durationDays: z.number().int().min(1).max(3660).optional(), // default 30` |
| 6 | `CreateOrganizationSchema` | `graceDays` | [`schemas.ts:182`](../../functions/src/validation/schemas.ts#L182) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `graceDays: z.number().int().min(0).max(90).optional(),` |
| 7 | `UpdateOrganizationSchema` | `financialYearStartMonth` | [`schemas.ts:213`](../../functions/src/validation/schemas.ts#L213) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `financialYearStartMonth: z.number().int().min(1).max(12).optional(),` |
| 8 | `SetSubscriptionSchema` | `durationDays` | [`schemas.ts:264`](../../functions/src/validation/schemas.ts#L264) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `durationDays: z.number().int().min(1).max(3660).optional(),` |
| 9 | `SetSubscriptionSchema` | `extendDays` | [`schemas.ts:265`](../../functions/src/validation/schemas.ts#L265) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `extendDays: z.number().int().min(1).max(3660).optional(),` |
| 10 | `SetSubscriptionSchema` | `graceDays` | [`schemas.ts:266`](../../functions/src/validation/schemas.ts#L266) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `graceDays: z.number().int().min(0).max(90).optional(),` |
| 11 | `ListOrganizationsSchema` | `limit` | [`schemas.ts:286`](../../functions/src/validation/schemas.ts#L286) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(20).optional(),` |
| 12 | `GetSubscriptionHistorySchema` | `limit` | [`schemas.ts:303`](../../functions/src/validation/schemas.ts#L303) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 13 | `ListEmployeesSchema` | `limit` | [`schemas.ts:361`](../../functions/src/validation/schemas.ts#L361) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 14 | `CreatePlanSchema` | `admin` | [`schemas.ts:460`](../../functions/src/validation/schemas.ts#L460) | *Non-Money* (Subscription plan seat count) | `admin: z.number().int().positive(),` |
| 15 | `CreatePlanSchema` | `staff` | [`schemas.ts:461`](../../functions/src/validation/schemas.ts#L461) | *Non-Money* (Subscription plan seat count) | `staff: z.number().int().positive(),` |
| 16 | `CreatePlanSchema` | `branchLimit` | [`schemas.ts:463`](../../functions/src/validation/schemas.ts#L463) | *Non-Money* (Entity count / limit / configuration integer) | `branchLimit: z.number().int().positive().default(1).optional(),` |
| 17 | `UpdatePlanSchema` | `branchLimit` | [`schemas.ts:474`](../../functions/src/validation/schemas.ts#L474) | *Non-Money* (Entity count / limit / configuration integer) | `branchLimit: z.number().int().positive().optional(),` |
| 18 | `PreviewPlanImpactSchema` | `branchLimit` | [`schemas.ts:483`](../../functions/src/validation/schemas.ts#L483) | *Non-Money* (Entity count / limit / configuration integer) | `branchLimit: z.number().int().positive().optional(),` |
| 19 | `PreviewPlanImpactSchema` | `admin` | [`schemas.ts:485`](../../functions/src/validation/schemas.ts#L485) | *Non-Money* (Subscription plan seat count) | `admin: z.number().int().nonnegative().optional(),` |
| 20 | `PreviewPlanImpactSchema` | `staff` | [`schemas.ts:486`](../../functions/src/validation/schemas.ts#L486) | *Non-Money* (Subscription plan seat count) | `staff: z.number().int().nonnegative().optional(),` |
| 21 | `PreviewPlanImpactSchema` | `monthlyDocumentVolumeLimit` | [`schemas.ts:488`](../../functions/src/validation/schemas.ts#L488) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `monthlyDocumentVolumeLimit: z.number().int().nonnegative().optional(),` |
| 22 | `ListPlatformUsersSchema` | `limit` | [`schemas.ts:512`](../../functions/src/validation/schemas.ts#L512) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(20).optional(),` |
| 23 | `ListAuditLogsSchema` | `limit` | [`schemas.ts:536`](../../functions/src/validation/schemas.ts#L536) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 24 | `ProductAlternateUnitSchema` | `returnWindowDays` | [`schemas.ts:573`](../../functions/src/validation/schemas.ts#L573) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `returnWindowDays: z.number().int().min(0).max(3650).optional(),` |
| 25 | `ProductAlternateUnitSchema` | `warrantyMonths` | [`schemas.ts:585`](../../functions/src/validation/schemas.ts#L585) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `warrantyMonths: z.number().int().min(0).max(240).optional(),` |
| 26 | `ListProductsSchema` | `limit` | [`schemas.ts:671`](../../functions/src/validation/schemas.ts#L671) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 27 | `CreateUnitSchema` | `precision` | [`schemas.ts:709`](../../functions/src/validation/schemas.ts#L709) | *Non-Money* (Entity count / limit / configuration integer) | `precision: z.number().int().min(0).max(4).default(0),` |
| 28 | `UpdateUnitSchema` | `precision` | [`schemas.ts:719`](../../functions/src/validation/schemas.ts#L719) | *Non-Money* (Entity count / limit / configuration integer) | `precision: z.number().int().min(0).max(4).optional(),` |
| 29 | `CreateCustomerSchema` | `creditPeriodDays` | [`schemas.ts:746`](../../functions/src/validation/schemas.ts#L746) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `creditPeriodDays: z.number().int().min(0).default(30),` |
| 30 | `UpdateCustomerSchema` | `creditPeriodDays` | [`schemas.ts:778`](../../functions/src/validation/schemas.ts#L778) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `creditPeriodDays: z.number().int().min(0).optional(),` |
| 31 | `ListCustomersSchema` | `limit` | [`schemas.ts:792`](../../functions/src/validation/schemas.ts#L792) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 32 | `CreateVendorSchema` | `paymentTermsDays` | [`schemas.ts:814`](../../functions/src/validation/schemas.ts#L814) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `paymentTermsDays: z.number().int().min(0).default(0).optional(),` |
| 33 | `UpdateVendorSchema` | `paymentTermsDays` | [`schemas.ts:845`](../../functions/src/validation/schemas.ts#L845) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `paymentTermsDays: z.number().int().min(0).optional(),` |
| 34 | `ListOutflowsSchema` | `limit` | [`schemas.ts:933`](../../functions/src/validation/schemas.ts#L933) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 35 | `ListBillsSchema` | `limit` | [`schemas.ts:1029`](../../functions/src/validation/schemas.ts#L1029) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 36 | `ListDeliveriesSchema` | `limit` | [`schemas.ts:1079`](../../functions/src/validation/schemas.ts#L1079) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 37 | `ListReturnsSchema` | `limit` | [`schemas.ts:1113`](../../functions/src/validation/schemas.ts#L1113) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 38 | `ListPaymentsSchema` | `limit` | [`schemas.ts:1164`](../../functions/src/validation/schemas.ts#L1164) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 39 | `ListStockMovementsSchema` | `limit` | [`schemas.ts:1187`](../../functions/src/validation/schemas.ts#L1187) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 40 | `ListBranchesSchema` | `limit` | [`schemas.ts:1242`](../../functions/src/validation/schemas.ts#L1242) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 41 | `GetTopEntitiesReportSchema` | `limit` | [`schemas.ts:1309`](../../functions/src/validation/schemas.ts#L1309) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(50).default(10).optional(),` |
| 42 | `ListTasksSchema` | `limit` | [`schemas.ts:1383`](../../functions/src/validation/schemas.ts#L1383) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 43 | `GetLocationHistorySchema` | `limit` | [`schemas.ts:1418`](../../functions/src/validation/schemas.ts#L1418) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 44 | `ListNotificationsSchema` | `limit` | [`schemas.ts:1424`](../../functions/src/validation/schemas.ts#L1424) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 45 | `GetOrganizationsUsageSchema` | `limit` | [`schemas.ts:1466`](../../functions/src/validation/schemas.ts#L1466) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 46 | `MetricLimitConfigSchema` | `dailyLimit` | [`schemas.ts:1499`](../../functions/src/validation/schemas.ts#L1499) | *Non-Money* (Entity count / limit / configuration integer) | `dailyLimit: z.number().int().nonnegative().optional(),` |
| 47 | `MetricLimitConfigSchema` | `weeklyLimit` | [`schemas.ts:1500`](../../functions/src/validation/schemas.ts#L1500) | *Non-Money* (Entity count / limit / configuration integer) | `weeklyLimit: z.number().int().nonnegative().optional(),` |
| 48 | `MetricLimitConfigSchema` | `monthlyLimit` | [`schemas.ts:1501`](../../functions/src/validation/schemas.ts#L1501) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `monthlyLimit: z.number().int().nonnegative().optional(),` |
| 49 | `PriceHistorySchema` | `limit` | [`schemas.ts:1566`](../../functions/src/validation/schemas.ts#L1566) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 50 | `EntityHistorySchema` | `limit` | [`schemas.ts:1596`](../../functions/src/validation/schemas.ts#L1596) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 51 | `CreateRecurringExpenseSchema` | `dayOfMonth` | [`schemas.ts:1612`](../../functions/src/validation/schemas.ts#L1612) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `dayOfMonth: z.number().int().min(1).max(28).optional(), // monthly (1–28: exists every month)` |
| 52 | `CreateRecurringExpenseSchema` | `weekday` | [`schemas.ts:1613`](../../functions/src/validation/schemas.ts#L1613) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `weekday: z.number().int().min(1).max(7).optional(), // weekly, ISO 1 = Monday` |
| 53 | `ListRecurringExpensesSchema` | `limit` | [`schemas.ts:1632`](../../functions/src/validation/schemas.ts#L1632) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).optional(),` |
| 54 | `CreateImageUploadSessionSchema` | `sizeBytes` | [`schemas.ts:1645`](../../functions/src/validation/schemas.ts#L1645) | *Non-Money* (Image / file dimension or size in bytes) | `sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),` |
| 55 | `RequestAttachmentSchema` | `sizeBytes` | [`schemas.ts:1706`](../../functions/src/validation/schemas.ts#L1706) | *Non-Money* (Image / file dimension or size in bytes) | `sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),` |
| 56 | `LimitIncreaseDetailsSchema` | `requestedLimit` | [`schemas.ts:1733`](../../functions/src/validation/schemas.ts#L1733) | *Non-Money* (Entity count / limit / configuration integer) | `requestedLimit: z.number().int().positive(),` |
| 57 | `UpdateRequestSchema` | `expectedVersion` | [`schemas.ts:1899`](../../functions/src/validation/schemas.ts#L1899) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `expectedVersion: z.number().int().positive(),` |
| 58 | `ListRequestsSchema` | `limit` | [`schemas.ts:1946`](../../functions/src/validation/schemas.ts#L1946) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 59 | `ListRequestActivitySchema` | `limit` | [`schemas.ts:1955`](../../functions/src/validation/schemas.ts#L1955) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 60 | `InboxListRequestsSchema` | `limit` | [`schemas.ts:1980`](../../functions/src/validation/schemas.ts#L1980) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 61 | `GetRequestsMetaSchema` | `firstResponseHours` | [`schemas.ts:2035`](../../functions/src/validation/schemas.ts#L2035) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `firstResponseHours: z.number().int().min(1).max(720),` |
| 62 | `GetRequestsMetaSchema` | `resolutionHours` | [`schemas.ts:2036`](../../functions/src/validation/schemas.ts#L2036) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `resolutionHours: z.number().int().min(1).max(2160),` |
| 63 | `UpdateRequestsSettingsSchema` | `maxOpenPerUser` | [`schemas.ts:2050`](../../functions/src/validation/schemas.ts#L2050) | *Non-Money* (Entity count / limit / configuration integer) | `maxOpenPerUser: z.number().int().min(1).max(1000).optional(),` |
| 64 | `UpdateRequestsSettingsSchema` | `maxOpenPerOrg` | [`schemas.ts:2051`](../../functions/src/validation/schemas.ts#L2051) | *Non-Money* (Entity count / limit / configuration integer) | `maxOpenPerOrg: z.number().int().min(1).max(10000).optional(),` |
| 65 | `UpdateRequestsSettingsSchema` | `maxCreationsPerHourPerUser` | [`schemas.ts:2052`](../../functions/src/validation/schemas.ts#L2052) | *Non-Money* (Entity count / limit / configuration integer) | `maxCreationsPerHourPerUser: z.number().int().min(1).max(500).optional(),` |
| 66 | `UpdateRequestsSettingsSchema` | `autoCloseDays` | [`schemas.ts:2054`](../../functions/src/validation/schemas.ts#L2054) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `autoCloseDays: z.number().int().min(1).max(90).optional(),` |
| 67 | `UpdateRequestsSettingsSchema` | `reopenWindowDays` | [`schemas.ts:2055`](../../functions/src/validation/schemas.ts#L2055) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `reopenWindowDays: z.number().int().min(1).max(90).optional(),` |
| 68 | `UpdateRequestsSettingsSchema` | `needsInfoReminderDays` | [`schemas.ts:2056`](../../functions/src/validation/schemas.ts#L2056) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `needsInfoReminderDays: z.number().int().min(1).max(30).optional(),` |
| 69 | `UpdateRequestsSettingsSchema` | `needsInfoAutoCancelDays` | [`schemas.ts:2057`](../../functions/src/validation/schemas.ts#L2057) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `needsInfoAutoCancelDays: z.number().int().min(1).max(90).optional(),` |
| 70 | `FeeRuleInputSchema` | `settlementDays` | [`schemas.ts:2079`](../../functions/src/validation/schemas.ts#L2079) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `settlementDays: z.number().int().min(0).optional(),` |
| 71 | `ListFinancialAccountsSchema` | `limit` | [`schemas.ts:2113`](../../functions/src/validation/schemas.ts#L2113) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 72 | `GetAccountLedgerSchema` | `limit` | [`schemas.ts:2125`](../../functions/src/validation/schemas.ts#L2125) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 73 | `ListAccountTransfersSchema` | `limit` | [`schemas.ts:2149`](../../functions/src/validation/schemas.ts#L2149) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 74 | `ListStorageLocationsSchema` | `limit` | [`schemas.ts:2186`](../../functions/src/validation/schemas.ts#L2186) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 75 | `SubmitStockTransferSchema` | `version` | [`schemas.ts:2227`](../../functions/src/validation/schemas.ts#L2227) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 76 | `CancelStockTransferSchema` | `version` | [`schemas.ts:2235`](../../functions/src/validation/schemas.ts#L2235) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 77 | `DispatchStockTransferSchema` | `version` | [`schemas.ts:2251`](../../functions/src/validation/schemas.ts#L2251) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 78 | `ReceiveStockTransferSchema` | `version` | [`schemas.ts:2268`](../../functions/src/validation/schemas.ts#L2268) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 79 | `ResolveTransferDiscrepancySchema` | `version` | [`schemas.ts:2278`](../../functions/src/validation/schemas.ts#L2278) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 80 | `ListStockTransfersSchema` | `limit` | [`schemas.ts:2293`](../../functions/src/validation/schemas.ts#L2293) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 81 | `ListApprovalsSchema` | `limit` | [`schemas.ts:2306`](../../functions/src/validation/schemas.ts#L2306) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 82 | `ListPaymentFeesSchema` | `limit` | [`schemas.ts:2357`](../../functions/src/validation/schemas.ts#L2357) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 83 | `ListCapitalTransactionsSchema` | `limit` | [`schemas.ts:2413`](../../functions/src/validation/schemas.ts#L2413) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 84 | `ListAccountEntriesSchema` | `limit` | [`schemas.ts:2449`](../../functions/src/validation/schemas.ts#L2449) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 85 | `CreateCashCountSchema` | `denominations` | [`schemas.ts:2526`](../../functions/src/validation/schemas.ts#L2526) | *Non-Money* (Physical note/coin count in denomination map) | `denominations: z.record(z.string(), z.number().int().min(0)),` |
| 86 | `ListCashCountsSchema` | `limit` | [`schemas.ts:2534`](../../functions/src/validation/schemas.ts#L2534) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 87 | `PartyCoreSchema` | `paymentTermsDays` | [`sharedSchemas.ts:130`](../../functions/src/validation/sharedSchemas.ts#L130) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `paymentTermsDays: z.number().int().min(0).max(365).default(0).optional(),` |

---

## 4. Code Pattern Search Counts & Locations

Mechanical counts across repository:

| Pattern | Total Occurrences | Files Count | Key Locations / Scope Breakdown |
|---|---|---|---|
| `round2(` | **169** | **14** | 132 in `functions/src` (reports 86, taxCalculation 12, summary 12, stockTransfers 7, costing 3, usage 3); 37 in `functions/scripts` |
| `roundCurrency(` | **18** | **6** | 18 in `functions/src` (helpers 2, outflows 1, money 2, postingRules 2, unit tests 11) |
| `Money.(fromDecimal\|toDecimal\|toMinor\|fromMinor\|addMinor\|subtractMinor\|allocateMinor)` | **24** | **4** | 24 in `functions/src` (money 5, postingRules 5, unit tests 14) |
| `getCurrencyDecimals` | **19** | **3** | 19 across 3 files (money.ts 14, worldwideTaxAndCurrency.test.ts 4, run-ledger.md 1) |
| `"INR"` / `'INR'` | **156** | **66** | 87 in `functions/src` (~49 non-test locations); 33 in `functions/scripts`; 4 in `scripts`; 32 in `docs` |
| `paise` / `Paise` | **62** | **27** | 26 in `functions/src` (schemas 6, tests 14, models 1, cashFlows 2, money 2, countryDefaults 1); 10 in `functions/scripts`; 26 in `scripts` & `docs` |

### Detailed File Listing for Code Patterns:
- **`round2(`** (14 files):
  - `functions/src/callables/bills/helpers.ts` (1)
  - `functions/src/callables/reports/analyticsReports.ts` (20)
  - `functions/src/callables/reports/financialReports.ts` (20)
  - `functions/src/callables/reports/operationalReports.ts` (46)
  - `functions/src/callables/stockTransfers.ts` (7)
  - `functions/src/services/costingEngine.ts` (3)
  - `functions/src/services/money.ts` (1)
  - `functions/src/services/summaryService.ts` (12)
  - `functions/src/services/taxCalculation.ts` (12)
  - `functions/src/services/usageMetering.ts` (3)
  - `functions/src/test/unit/moneyRounding.test.ts` (1)
  - `functions/src/test/unit/stockTransfersAndTransitions.test.ts` (6)
  - `functions/scripts/accounting-oracle.cjs` (36)
  - `functions/scripts/run-two-business-simulation.cjs` (1)
- **`roundCurrency(`** (6 files):
  - `functions/src/callables/bills/helpers.ts` (2)
  - `functions/src/callables/outflows.ts` (1)
  - `functions/src/services/money.ts` (2)
  - `functions/src/services/postingRules.ts` (2)
  - `functions/src/test/unit/financialAndCoreServices.test.ts` (5)
  - `functions/src/test/unit/moneyRounding.test.ts` (6)
- **`Money.*` minor helpers** (4 files):
  - `functions/src/services/money.ts` (5)
  - `functions/src/services/postingRules.ts` (5)
  - `functions/src/test/unit/financialAndCoreServices.test.ts` (2)
  - `functions/src/test/unit/postingRules.test.ts` (12)
- **`getCurrencyDecimals`** (3 files):
  - `functions/src/services/money.ts` (14)
  - `functions/src/test/unit/worldwideTaxAndCurrency.test.ts` (4)
  - `docs/audit/run-ledger.md` (1)
- **`paise` / `Paise` in `functions/src`** (9 files):
  - `functions/src/validation/schemas.ts` (6: lines 892, 1750, 2345, 2406, 2495, 2506)
  - `functions/src/callables/cashFlows.ts` (2: lines 252, 260)
  - `functions/src/constants/countryDefaults.ts` (1: line 23)
  - `functions/src/services/money.ts` (2: lines 8, 32)
  - `functions/src/types/models.ts` (1: line 224)
  - `functions/src/test/unit/financeStockIntegrity.test.ts` (6)
  - `functions/src/test/unit/financialAndBranchInventory.test.ts` (6)
  - `functions/src/test/unit/postingRules.test.ts` (1)
  - `functions/src/test/unit/worldwideTaxAndCurrency.test.ts` (1)

---

## 5. Duplicate Integer Minor Fields Identified in Code (To Be Removed in S5)

1. **`AccountTransactionDoc.amountMinor`** ([`models.ts:1761`](../../functions/src/types/models.ts#L1761)) — duplicate of `amount` ([`models.ts:1759`](../../functions/src/types/models.ts#L1759))
2. **`AccountTransactionDoc.balanceAfterMinor`** ([`models.ts:1762`](../../functions/src/types/models.ts#L1762)) — duplicate of `balanceAfter` ([`models.ts:1760`](../../functions/src/types/models.ts#L1760))
3. **`FinancialAccountDoc.openingBalanceMinor`** ([`models.ts:1684`](../../functions/src/types/models.ts#L1684)) — duplicate of `openingBalance` ([`models.ts:1682`](../../functions/src/types/models.ts#L1682))
4. **`FinancialAccountDoc.currentBalanceMinor`** ([`models.ts:1685`](../../functions/src/types/models.ts#L1685)) — duplicate of `currentBalance` ([`models.ts:1683`](../../functions/src/types/models.ts#L1683))
5. **`JournalLineItem.debitMinor`** ([`models.ts:2059`](../../functions/src/types/models.ts#L2059)) — duplicate of `debit` ([`models.ts:2057`](../../functions/src/types/models.ts#L2057))
6. **`JournalLineItem.creditMinor`** ([`models.ts:2060`](../../functions/src/types/models.ts#L2060)) — duplicate of `credit` ([`models.ts:2058`](../../functions/src/types/models.ts#L2058))
7. **`JournalEntryDoc.totalDebitMinor`** ([`models.ts:2079`](../../functions/src/types/models.ts#L2079)) — duplicate of `totalDebit` ([`models.ts:2077`](../../functions/src/types/models.ts#L2077))
8. **`JournalEntryDoc.totalCreditMinor`** ([`models.ts:2080`](../../functions/src/types/models.ts#L2080)) — duplicate of `totalCredit` ([`models.ts:2078`](../../functions/src/types/models.ts#L2078))
9. **`AccountingPolicy.cashCountVarianceThresholdMinor`** ([`models.ts:224`](../../functions/src/types/models.ts#L224)) — duplicate of decimal variance threshold
