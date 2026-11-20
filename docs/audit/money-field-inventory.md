# Money and Currency Field Mechanical Inventory (Prompt 77D S0)

**Date:** 2026-11-20
**Scope:** Backend Repository (`trado-firebase`), Node 22, Commit `24a8003`
**Methodology:** Mechanically parsed via `functions/scripts/lib/money-field-scan.cjs`.
Every single row contains strict `file:line` evidence verified in code.

---

## 1. Executive Summary

| Category | Total Lines Matched | Actual Money Fields | Non-Money Fields (Rates, Counts, Days, Ratios) |
|---|---|---|---|
| **`types/models.ts`** | **107** | **94** | **13** |
| **`validation/schemas.ts` & `sharedSchemas.ts`** | **99** | **10** | **89** |

---

## 2. `functions/src/types/models.ts` Fields Inventory (107 matching lines)

Keywords searched: `Amount`, `Price`, `Cost`, `Balance`, `Limit`, `Threshold`, `Total`, `Fee`, `Charge`, `Value`, `Salary`, `Minor`, `Rate` (excluding `Percent`).

### 2.1 Stored Money Fields in `models.ts` (94 fields)

| # | Interface / Type | Field Name | File:Line | Classification | Storage Representation | Duplicate Of | Notes / Raw Declaration |
|---|---|---|---|---|---|---|---|
| 1 | `AccountingPolicy` | `minorUnitsThresholds` | [`models.ts:218`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L218) | **MONEY** | stored decimal major | None | `minorUnitsThresholds?: Record<string, number>;` |
| 2 | `AccountingPolicy` | `selfApprovalLimits` | [`models.ts:220`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L220) | **MONEY** | stored decimal major | None | `selfApprovalLimits?: Record<string, number>;` |
| 3 | `AccountingPolicy` | `cashCountVarianceThresholdMinor` | [`models.ts:224`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L224) | **MONEY** | stored integer-minor | `cashCountVarianceThreshold` | `cashCountVarianceThresholdMinor?: number;` |
| 4 | `ApprovalPolicy` | `amountThreshold` | [`models.ts:247`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L247) | **MONEY** | stored decimal major | None | `amountThreshold?: number; // Only documents at/above this total need approval (0 = all)` |
| 5 | `SubscriptionPlanDoc` | `price` | [`models.ts:320`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L320) | **MONEY** | stored decimal major | None | `price: number;` |
| 6 | `AuditLogDoc` | `amount` | [`models.ts:439`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L439) | **MONEY** | stored decimal major | None | `amount?: number \| null;` |
| 7 | `TaxBreakdownItem` | `amount` | [`models.ts:491`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L491) | **MONEY** | stored decimal major | None | `amount: number;` |
| 8 | `TaxBreakdownItem` | `taxableAmount` | [`models.ts:492`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L492) | **MONEY** | stored decimal major | None | `taxableAmount?: number;` |
| 9 | `TaxSnapshot` | `taxAmount` | [`models.ts:502`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L502) | **MONEY** | stored decimal major | None | `taxAmount: number;` |
| 10 | `ProductDoc` | `sellingPrice` | [`models.ts:525`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L525) | **MONEY** | stored decimal major | None | `sellingPrice: number;` |
| 11 | `ProductDoc` | `costPrice` | [`models.ts:526`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L526) | **MONEY** | stored decimal major | None | `costPrice: number;` |
| 12 | `ProductDoc` | `weightedAverageCost` | [`models.ts:527`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L527) | **MONEY** | stored decimal major | None | `weightedAverageCost?: number; // Maintained weighted-average cost for valuation & COGS` |
| 13 | `ProductDoc` | `wholesalePrice` | [`models.ts:529`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L529) | **MONEY** | stored decimal major | None | `wholesalePrice?: number \| null;` |
| 14 | `ProductDoc` | `makingCharge` | [`models.ts:565`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L565) | **MONEY** | stored decimal major | None | `makingCharge?: number;` |
| 15 | `ProductAlternateUnit` | `sellingPrice` | [`models.ts:587`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L587) | **MONEY** | stored decimal major | None | `sellingPrice?: number;` |
| 16 | `ProductAlternateUnit` | `wholesalePrice` | [`models.ts:588`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L588) | **MONEY** | stored decimal major | None | `wholesalePrice?: number;` |
| 17 | `CustomerDoc` | `creditLimit` | [`models.ts:659`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L659) | **MONEY** | stored decimal major | None | `creditLimit: number;` |
| 18 | `CustomerDoc` | `outstandingBalance` | [`models.ts:661`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L661) | **MONEY** | stored decimal major | None | `outstandingBalance: number; // Udhaar amount customer owes` |
| 19 | `CustomerDoc` | `advanceBalance` | [`models.ts:662`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L662) | **MONEY** | stored decimal major | None | `advanceBalance?: number; // Advance payments / credits unapplied` |
| 20 | `CustomerDoc` | `totalSpend` | [`models.ts:663`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L663) | **MONEY** | stored decimal major | None | `totalSpend: number;` |
| 21 | `VendorDoc` | `creditLimit` | [`models.ts:695`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L695) | **MONEY** | stored decimal major | None | `creditLimit?: number;` |
| 22 | `VendorDoc` | `totalPurchase` | [`models.ts:697`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L697) | **MONEY** | stored decimal major | None | `totalPurchase: number;` |
| 23 | `OutflowLine` | `unitPrice` | [`models.ts:719`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L719) | **MONEY** | stored decimal major | None | `unitPrice: number;` |
| 24 | `OutflowLine` | `grossAmount` | [`models.ts:720`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L720) | **MONEY** | stored decimal major | None | `grossAmount: number;` |
| 25 | `OutflowLine` | `discountAmount` | [`models.ts:721`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L721) | **MONEY** | stored decimal major | None | `discountAmount: number;` |
| 26 | `OutflowLine` | `taxAmount` | [`models.ts:722`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L722) | **MONEY** | stored decimal major | None | `taxAmount: number;` |
| 27 | `OutflowLine` | `lineTotal` | [`models.ts:723`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L723) | **MONEY** | stored decimal major | None | `lineTotal: number;` |
| 28 | `SplitPaymentEntry` | `amount` | [`models.ts:771`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L771) | **MONEY** | stored decimal major | None | `amount: number;` |
| 29 | `OutflowDoc` | `requestedPaidAmount` | [`models.ts:786`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L786) | **MONEY** | stored decimal major | None | `requestedPaidAmount?: number;` |
| 30 | `OutflowDoc` | `billDiscountAmount` | [`models.ts:792`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L792) | **MONEY** | stored decimal major | None | `billDiscountAmount?: number;` |
| 31 | `OutflowDoc` | `subTotal` | [`models.ts:802`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L802) | **MONEY** | stored decimal major | None | `subTotal: number;` |
| 32 | `OutflowDoc` | `discountTotal` | [`models.ts:803`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L803) | **MONEY** | stored decimal major | None | `discountTotal: number;` |
| 33 | `OutflowDoc` | `taxTotal` | [`models.ts:804`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L804) | **MONEY** | stored decimal major | None | `taxTotal: number;` |
| 34 | `OutflowDoc` | `totalAmount` | [`models.ts:805`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L805) | **MONEY** | stored decimal major | None | `totalAmount: number;` |
| 35 | `OutflowDoc` | `paidAmount` | [`models.ts:806`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L806) | **MONEY** | stored decimal major | None | `paidAmount: number;` |
| 36 | `OutflowDoc` | `balanceAmount` | [`models.ts:807`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L807) | **MONEY** | stored decimal major | None | `balanceAmount: number;` |
| 37 | `BillItem` | `priceSnapshot` | [`models.ts:824`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L824) | **MONEY** | stored decimal major | None | `priceSnapshot: number; // Selling price at sale time` |
| 38 | `BillItem` | `costSnapshot` | [`models.ts:825`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L825) | **MONEY** | stored decimal major | None | `costSnapshot: number; // Cost price at sale time` |
| 39 | `BillItem` | `subtotal` | [`models.ts:833`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L833) | **MONEY** | stored decimal major | None | `subtotal: number;` |
| 40 | `BillItem` | `discountValue` | [`models.ts:834`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L834) | **MONEY** | stored decimal major | None | `discountValue: number;` |
| 41 | `BillItem` | `taxAmount` | [`models.ts:835`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L835) | **MONEY** | stored decimal major | None | `taxAmount: number;` |
| 42 | `BillItem` | `lineTotal` | [`models.ts:836`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L836) | **MONEY** | stored decimal major | None | `lineTotal: number;` |
| 43 | `BillDoc` | `subTotal` | [`models.ts:870`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L870) | **MONEY** | stored decimal major | None | `subTotal: number;` |
| 44 | `BillDoc` | `discountTotal` | [`models.ts:871`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L871) | **MONEY** | stored decimal major | None | `discountTotal: number;` |
| 45 | `BillDoc` | `taxTotal` | [`models.ts:872`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L872) | **MONEY** | stored decimal major | None | `taxTotal: number;` |
| 46 | `BillDoc` | `totalAmount` | [`models.ts:874`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L874) | **MONEY** | stored decimal major | None | `totalAmount: number;` |
| 47 | `BillDoc` | `paidAmount` | [`models.ts:875`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L875) | **MONEY** | stored decimal major | None | `paidAmount: number;` |
| 48 | `BillDoc` | `balanceAmount` | [`models.ts:876`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L876) | **MONEY** | stored decimal major | None | `balanceAmount: number;` |
| 49 | `BillDoc` | `requestedPaidAmount` | [`models.ts:880`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L880) | **MONEY** | stored decimal major | None | `requestedPaidAmount?: number; // Tender held until approval` |
| 50 | `StockMovementDoc` | `unitCostSnapshot` | [`models.ts:912`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L912) | **MONEY** | stored decimal major | None | `unitCostSnapshot?: number; // Cost per base unit at movement time (values write-offs)` |
| 51 | `DeliveryCod` | `amount` | [`models.ts:933`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L933) | **MONEY** | stored decimal major | None | `amount: number;` |
| 52 | `DeliveryDoc` | `deliveryFee` | [`models.ts:952`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L952) | **MONEY** | stored decimal major | None | `deliveryFee: number;` |
| 53 | `ReturnItem` | `refundAmount` | [`models.ts:972`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L972) | **MONEY** | stored decimal major | None | `refundAmount: number;` |
| 54 | `ReturnDoc` | `totalRefundAmount` | [`models.ts:988`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L988) | **MONEY** | stored decimal major | None | `totalRefundAmount: number;` |
| 55 | `PaymentAllocation` | `amount` | [`models.ts:1011`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1011) | **MONEY** | stored decimal major | None | `amount: number;` |
| 56 | `PaymentDoc` | `amount` | [`models.ts:1028`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1028) | **MONEY** | stored decimal major | None | `amount: number;` |
| 57 | `DailySummaryDoc` | `totalRevenue` | [`models.ts:1100`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1100) | **MONEY** | stored decimal major | None | `totalRevenue: number; // Gross bill total amount` |
| 58 | `DailySummaryDoc` | `totalExpenses` | [`models.ts:1101`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1101) | **MONEY** | stored decimal major | None | `totalExpenses: number; // Outflow expenses total amount` |
| 59 | `MonthlySummaryDoc` | `totalRevenue` | [`models.ts:1124`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1124) | **MONEY** | stored decimal major | None | `totalRevenue: number;` |
| 60 | `MonthlySummaryDoc` | `totalExpenses` | [`models.ts:1125`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1125) | **MONEY** | stored decimal major | None | `totalExpenses: number;` |
| 61 | `FinancialAccountDoc` | `openingBalance` | [`models.ts:1682`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1682) | **MONEY** | stored decimal major | None | `openingBalance: number;` |
| 62 | `FinancialAccountDoc` | `currentBalance` | [`models.ts:1683`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1683) | **MONEY** | stored decimal major | None | `currentBalance: number;` |
| 63 | `FinancialAccountDoc` | `openingBalanceMinor` | [`models.ts:1684`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1684) | **MONEY** | stored integer-minor | `openingBalance` | `openingBalanceMinor?: number;` |
| 64 | `FinancialAccountDoc` | `currentBalanceMinor` | [`models.ts:1685`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1685) | **MONEY** | stored integer-minor | `currentBalance` | `currentBalanceMinor?: number;` |
| 65 | `FinancialAccountDoc` | `feeFixed` | [`models.ts:1688`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1688) | **MONEY** | stored decimal major | None | `feeFixed?: number;` |
| 66 | `AccountTransactionDoc` | `amount` | [`models.ts:1759`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1759) | **MONEY** | stored decimal major | None | `amount: number;` |
| 67 | `AccountTransactionDoc` | `balanceAfter` | [`models.ts:1760`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1760) | **MONEY** | stored decimal major | None | `balanceAfter: number;` |
| 68 | `AccountTransactionDoc` | `amountMinor` | [`models.ts:1761`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1761) | **MONEY** | stored integer-minor | `amount` | `amountMinor?: number;` |
| 69 | `AccountTransactionDoc` | `balanceAfterMinor` | [`models.ts:1762`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1762) | **MONEY** | stored integer-minor | `balanceAfter` | `balanceAfterMinor?: number;` |
| 70 | `AccountTransferDoc` | `amount` | [`models.ts:1810`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1810) | **MONEY** | stored decimal major | None | `amount: number;` |
| 71 | `CashCountDoc` | `countedAmount` | [`models.ts:1838`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1838) | **MONEY** | stored decimal major | None | `countedAmount: number;` |
| 72 | `CashCountDoc` | `systemBalance` | [`models.ts:1839`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1839) | **MONEY** | stored decimal major | None | `systemBalance: number;` |
| 73 | `CashCountDoc` | `varianceAmount` | [`models.ts:1840`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1840) | **MONEY** | stored decimal major | None | `varianceAmount: number;` |
| 74 | `AccountReconciliationDoc` | `statementOpeningBalance` | [`models.ts:1863`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1863) | **MONEY** | stored decimal major | None | `statementOpeningBalance: number;` |
| 75 | `AccountReconciliationDoc` | `statementClosingBalance` | [`models.ts:1864`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1864) | **MONEY** | stored decimal major | None | `statementClosingBalance: number;` |
| 76 | `AccountReconciliationDoc` | `ledgerClosingBalance` | [`models.ts:1865`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1865) | **MONEY** | stored decimal major | None | `ledgerClosingBalance: number;` |
| 77 | `AccountReconciliationDoc` | `discrepancyAmount` | [`models.ts:1866`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1866) | **MONEY** | stored decimal major | None | `discrepancyAmount: number;` |
| 78 | `StockTransferLine` | `unitCost` | [`models.ts:1919`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1919) | **MONEY** | stored decimal major | None | `unitCost?: number; // Frozen source WAC at dispatch` |
| 79 | `StockTransferLine` | `totalCost` | [`models.ts:1920`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1920) | **MONEY** | stored decimal major | None | `totalCost?: number; // unitCost * dispatchedBaseQuantity` |
| 80 | `StockTransferDoc` | `handlingFee` | [`models.ts:1946`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1946) | **MONEY** | stored decimal major | None | `handlingFee?: number;` |
| 81 | `StockTransferDoc` | `totalValuation` | [`models.ts:1948`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1948) | **MONEY** | stored decimal major | None | `totalValuation?: number;` |
| 82 | `PaymentProcessingFeeDoc` | `grossAmount` | [`models.ts:1984`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1984) | **MONEY** | stored decimal major | None | `grossAmount: number;` |
| 83 | `PaymentProcessingFeeDoc` | `feeAmount` | [`models.ts:1985`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1985) | **MONEY** | stored decimal major | None | `feeAmount: number;` |
| 84 | `PaymentProcessingFeeDoc` | `feeTaxAmount` | [`models.ts:1986`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1986) | **MONEY** | stored decimal major | None | `feeTaxAmount?: number;` |
| 85 | `PaymentProcessingFeeDoc` | `netSettlementAmount` | [`models.ts:1987`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1987) | **MONEY** | stored decimal major | None | `netSettlementAmount: number;` |
| 86 | `PaymentProcessingFeeDoc` | `expectedFeeAmount` | [`models.ts:1997`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1997) | **MONEY** | stored decimal major | None | `expectedFeeAmount?: number;` |
| 87 | `PaymentProcessingFeeDoc` | `varianceAmount` | [`models.ts:1998`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1998) | **MONEY** | stored decimal major | None | `varianceAmount?: number;` |
| 88 | `CapitalTransactionDoc` | `amount` | [`models.ts:2022`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2022) | **MONEY** | stored decimal major | None | `amount: number;` |
| 89 | `JournalLineItem` | `debitMinor` | [`models.ts:2059`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2059) | **MONEY** | stored integer-minor | `debit` | `debitMinor?: number;` |
| 90 | `JournalLineItem` | `creditMinor` | [`models.ts:2060`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2060) | **MONEY** | stored integer-minor | `credit` | `creditMinor?: number;` |
| 91 | `JournalEntryDoc` | `totalDebit` | [`models.ts:2077`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2077) | **MONEY** | stored decimal major | None | `totalDebit: number;` |
| 92 | `JournalEntryDoc` | `totalCredit` | [`models.ts:2078`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2078) | **MONEY** | stored decimal major | None | `totalCredit: number;` |
| 93 | `JournalEntryDoc` | `totalDebitMinor` | [`models.ts:2079`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2079) | **MONEY** | stored integer-minor | `totalDebit` | `totalDebitMinor?: number;` |
| 94 | `JournalEntryDoc` | `totalCreditMinor` | [`models.ts:2080`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2080) | **MONEY** | stored integer-minor | `totalCredit` | `totalCreditMinor?: number;` |

### 2.2 Non-Money Fields in `models.ts` (13 fields: Rates, Units, Days, Operation Quotas)

| # | Interface / Type | Field Name | File:Line | Classification (Reason) | Raw Declaration |
|---|---|---|---|---|---|
| 1 | `SubscriptionPlanDoc` | `storageLimitMb` | [`models.ts:322`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L322) | *Non-Money* (Plan resource / entity count limit) | `storageLimitMb: number;` |
| 2 | `SubscriptionPlanDoc` | `monthlyDocumentVolumeLimit` | [`models.ts:323`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L323) | *Non-Money* (Plan resource / entity count limit) | `monthlyDocumentVolumeLimit: number;` |
| 3 | `SubscriptionPlanDoc` | `branchLimit` | [`models.ts:329`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L329) | *Non-Money* (Plan resource / entity count limit) | `branchLimit?: number;` |
| 4 | `TaxSlab` | `rate` | [`models.ts:363`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L363) | *Non-Money* (Rate / ratio / percentage multiplier) | `rate: number; // e.g. 0, 5, 10, 18` |
| 5 | `TaxRegimeDoc` | `defaultRate` | [`models.ts:378`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L378) | *Non-Money* (Rate / ratio / percentage multiplier) | `defaultRate?: number;` |
| 6 | `TaxRegimeDoc` | `rates` | [`models.ts:379`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L379) | *Non-Money* (Rate / ratio / percentage multiplier) | `rates?: number[];` |
| 7 | `TaxBreakdownItem` | `rate` | [`models.ts:490`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L490) | *Non-Money* (Rate / ratio / percentage multiplier) | `rate: number;` |
| 8 | `ProductDoc` | `lowStockThreshold` | [`models.ts:540`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L540) | *Non-Money* (Inventory stock quantity reorder threshold (units count, not currency)) | `lowStockThreshold: number;` |
| 9 | `StockMovementDoc` | `balanceAfter` | [`models.ts:906`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L906) | *Non-Money* (Stock inventory quantity running balance (items count, not currency)) | `balanceAfter: number; // Branch stock after this movement (R4 ledger running balance)` |
| 10 | `MetricLimitConfig` | `dailyLimit` | [`models.ts:1401`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1401) | *Non-Money* (Service operation invocation quota (calls/period)) | `dailyLimit?: number; // Maximum allowed operations per day (undefined/0 = disabled)` |
| 11 | `MetricLimitConfig` | `weeklyLimit` | [`models.ts:1402`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1402) | *Non-Money* (Service operation invocation quota (calls/period)) | `weeklyLimit?: number; // Maximum per ISO week (Monday start, organization timezone)` |
| 12 | `MetricLimitConfig` | `monthlyLimit` | [`models.ts:1403`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1403) | *Non-Money* (Service operation invocation quota (calls/period)) | `monthlyLimit?: number; // Maximum allowed operations per month` |
| 13 | `RequestDoc` | `slaTotalPausedMs` | [`models.ts:1590`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1590) | *Non-Money* (Time interval / duration) | `slaTotalPausedMs: number;` |

---

## 3. `functions/src/validation/schemas.ts` & `sharedSchemas.ts` Zod Integer / Paise Fields (99 lines)

Criteria: `z.number()` with `.int()` or message containing `"paise"`.

### 3.1 Money Schemas with Integer / Paise Enforcements (10 fields — TARGET FOR S4)

| # | Schema Name | Field Name | File:Line | Classification | Storage / Wire Representation | Duplicate / Conflict | Raw Zod Declaration |
|---|---|---|---|---|---|---|---|
| 1 | `SplitPaymentEntrySchema` | `amount` | [`schemas.ts:892`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L892) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `amount: z.number().int().positive("Payment amount must be positive paise"),` |
| 2 | `BillingQueryDetailsSchema` | `amount` | [`schemas.ts:1750`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1750) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `amount: z.number().int().nonnegative().optional(), // minor paise` |
| 3 | `FeeRuleInputSchema` | `feeFixed` | [`schemas.ts:2081`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2081) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `feeFixed: z.number().int().min(0).optional(),` |
| 4 | `RecordPaymentFeeSchema` | `feeAmount` | [`schemas.ts:2345`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2345) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `feeAmount: z.number().int().positive("Fee must be positive paise"),` |
| 5 | `RecordPaymentFeeSchema` | `feeTaxAmount` | [`schemas.ts:2346`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2346) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `feeTaxAmount: z.number().int().min(0).default(0).optional(),` |
| 6 | `CreateCapitalTransactionSchema` | `amount` | [`schemas.ts:2406`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2406) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `amount: z.number().int().positive("Capital amount must be positive paise"),` |
| 7 | `CreateSubEntrySchema` | `amount` | [`schemas.ts:2495`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2495) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `amount: z.number().int().positive("Sub-entry amount must be positive paise"),` |
| 8 | `RecordEntryFeeSchema` | `feeAmount` | [`schemas.ts:2506`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2506) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `feeAmount: z.number().int().positive("Fee must be positive paise"),` |
| 9 | `RecordEntryFeeSchema` | `feeTaxAmount` | [`schemas.ts:2507`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2507) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `feeTaxAmount: z.number().int().min(0).default(0).optional(),` |
| 10 | `UpdateAccountingPolicySchema` | `minorUnitsThresholds` | [`schemas.ts:2518`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2518) | **MONEY** | wire integer-minor (forced by .int()) | `Conflict with decimal major convention` | `minorUnitsThresholds: z.record(z.string(), z.number().int().min(0)).optional(),` |

### 3.2 Non-Money Integer Fields in Schemas (89 fields: Days, Ordinals, Dimensions, Counts)

| # | Schema Name | Field Name | File:Line | Classification (Reason) | Raw Zod Declaration |
|---|---|---|---|---|---|
| 1 | `ImageRefSchema` | `width` | [`schemas.ts:111`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L111) | *Non-Money* (Image / file dimension or size in bytes) | `width: z.number().int().min(1).max(10000),` |
| 2 | `ImageRefSchema` | `height` | [`schemas.ts:112`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L112) | *Non-Money* (Image / file dimension or size in bytes) | `height: z.number().int().min(1).max(10000),` |
| 3 | `ImageRefSchema` | `sizeBytes` | [`schemas.ts:113`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L113) | *Non-Money* (Image / file dimension or size in bytes) | `sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),` |
| 4 | `CreateOrganizationSchema` | `currencyDecimals` | [`schemas.ts:155`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L155) | *Non-Money* (Entity count / limit / configuration integer) | `currencyDecimals: z.number().int().min(0).max(4).optional(),` |
| 5 | `CreateOrganizationSchema` | `financialYearStartMonth` | [`schemas.ts:168`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L168) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `financialYearStartMonth: z.number().int().min(1).max(12).optional(),` |
| 6 | `CreateOrganizationSchema` | `durationDays` | [`schemas.ts:185`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L185) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `durationDays: z.number().int().min(1).max(3660).optional(), // default 30` |
| 7 | `CreateOrganizationSchema` | `graceDays` | [`schemas.ts:186`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L186) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `graceDays: z.number().int().min(0).max(90).optional(),` |
| 8 | `UpdateOrganizationSchema` | `financialYearStartMonth` | [`schemas.ts:217`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L217) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `financialYearStartMonth: z.number().int().min(1).max(12).optional(),` |
| 9 | `SetSubscriptionSchema` | `durationDays` | [`schemas.ts:268`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L268) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `durationDays: z.number().int().min(1).max(3660).optional(),` |
| 10 | `SetSubscriptionSchema` | `extendDays` | [`schemas.ts:269`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L269) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `extendDays: z.number().int().min(1).max(3660).optional(),` |
| 11 | `SetSubscriptionSchema` | `graceDays` | [`schemas.ts:270`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L270) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `graceDays: z.number().int().min(0).max(90).optional(),` |
| 12 | `ListOrganizationsSchema` | `limit` | [`schemas.ts:290`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L290) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(20).optional(),` |
| 13 | `GetSubscriptionHistorySchema` | `limit` | [`schemas.ts:307`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L307) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 14 | `ListEmployeesSchema` | `limit` | [`schemas.ts:365`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L365) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 15 | `CreatePlanSchema` | `admin` | [`schemas.ts:464`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L464) | *Non-Money* (Subscription plan seat count) | `admin: z.number().int().positive(),` |
| 16 | `CreatePlanSchema` | `staff` | [`schemas.ts:465`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L465) | *Non-Money* (Subscription plan seat count) | `staff: z.number().int().positive(),` |
| 17 | `CreatePlanSchema` | `branchLimit` | [`schemas.ts:467`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L467) | *Non-Money* (Entity count / limit / configuration integer) | `branchLimit: z.number().int().positive().default(1).optional(),` |
| 18 | `UpdatePlanSchema` | `branchLimit` | [`schemas.ts:478`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L478) | *Non-Money* (Entity count / limit / configuration integer) | `branchLimit: z.number().int().positive().optional(),` |
| 19 | `PreviewPlanImpactSchema` | `branchLimit` | [`schemas.ts:487`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L487) | *Non-Money* (Entity count / limit / configuration integer) | `branchLimit: z.number().int().positive().optional(),` |
| 20 | `PreviewPlanImpactSchema` | `admin` | [`schemas.ts:489`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L489) | *Non-Money* (Subscription plan seat count) | `admin: z.number().int().nonnegative().optional(),` |
| 21 | `PreviewPlanImpactSchema` | `staff` | [`schemas.ts:490`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L490) | *Non-Money* (Subscription plan seat count) | `staff: z.number().int().nonnegative().optional(),` |
| 22 | `PreviewPlanImpactSchema` | `monthlyDocumentVolumeLimit` | [`schemas.ts:492`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L492) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `monthlyDocumentVolumeLimit: z.number().int().nonnegative().optional(),` |
| 23 | `ListPlatformUsersSchema` | `limit` | [`schemas.ts:516`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L516) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(20).optional(),` |
| 24 | `ListAuditLogsSchema` | `limit` | [`schemas.ts:540`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L540) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 25 | `ProductAlternateUnitSchema` | `returnWindowDays` | [`schemas.ts:577`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L577) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `returnWindowDays: z.number().int().min(0).max(3650).optional(),` |
| 26 | `ProductAlternateUnitSchema` | `warrantyMonths` | [`schemas.ts:589`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L589) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `warrantyMonths: z.number().int().min(0).max(240).optional(),` |
| 27 | `ListProductsSchema` | `limit` | [`schemas.ts:675`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L675) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 28 | `CreateUnitSchema` | `precision` | [`schemas.ts:713`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L713) | *Non-Money* (Entity count / limit / configuration integer) | `precision: z.number().int().min(0).max(4).default(0),` |
| 29 | `UpdateUnitSchema` | `precision` | [`schemas.ts:723`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L723) | *Non-Money* (Entity count / limit / configuration integer) | `precision: z.number().int().min(0).max(4).optional(),` |
| 30 | `CreateCustomerSchema` | `creditPeriodDays` | [`schemas.ts:750`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L750) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `creditPeriodDays: z.number().int().min(0).default(30),` |
| 31 | `UpdateCustomerSchema` | `creditPeriodDays` | [`schemas.ts:782`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L782) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `creditPeriodDays: z.number().int().min(0).optional(),` |
| 32 | `ListCustomersSchema` | `limit` | [`schemas.ts:796`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L796) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 33 | `CreateVendorSchema` | `paymentTermsDays` | [`schemas.ts:818`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L818) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `paymentTermsDays: z.number().int().min(0).default(0).optional(),` |
| 34 | `UpdateVendorSchema` | `paymentTermsDays` | [`schemas.ts:849`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L849) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `paymentTermsDays: z.number().int().min(0).optional(),` |
| 35 | `ListOutflowsSchema` | `limit` | [`schemas.ts:937`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L937) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 36 | `ListBillsSchema` | `limit` | [`schemas.ts:1033`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1033) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 37 | `ListDeliveriesSchema` | `limit` | [`schemas.ts:1083`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1083) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 38 | `ListReturnsSchema` | `limit` | [`schemas.ts:1117`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1117) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 39 | `ListPaymentsSchema` | `limit` | [`schemas.ts:1168`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1168) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 40 | `ListStockMovementsSchema` | `limit` | [`schemas.ts:1191`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1191) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 41 | `ListBranchesSchema` | `limit` | [`schemas.ts:1246`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1246) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 42 | `GetTopEntitiesReportSchema` | `limit` | [`schemas.ts:1313`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1313) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(50).default(10).optional(),` |
| 43 | `ListTasksSchema` | `limit` | [`schemas.ts:1387`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1387) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 44 | `GetLocationHistorySchema` | `limit` | [`schemas.ts:1422`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1422) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 45 | `ListNotificationsSchema` | `limit` | [`schemas.ts:1428`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1428) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 46 | `GetOrganizationsUsageSchema` | `limit` | [`schemas.ts:1470`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1470) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 47 | `MetricLimitConfigSchema` | `dailyLimit` | [`schemas.ts:1503`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1503) | *Non-Money* (Entity count / limit / configuration integer) | `dailyLimit: z.number().int().nonnegative().optional(),` |
| 48 | `MetricLimitConfigSchema` | `weeklyLimit` | [`schemas.ts:1504`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1504) | *Non-Money* (Entity count / limit / configuration integer) | `weeklyLimit: z.number().int().nonnegative().optional(),` |
| 49 | `MetricLimitConfigSchema` | `monthlyLimit` | [`schemas.ts:1505`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1505) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `monthlyLimit: z.number().int().nonnegative().optional(),` |
| 50 | `PriceHistorySchema` | `limit` | [`schemas.ts:1570`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1570) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 51 | `EntityHistorySchema` | `limit` | [`schemas.ts:1600`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1600) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 52 | `CreateRecurringExpenseSchema` | `dayOfMonth` | [`schemas.ts:1616`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1616) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `dayOfMonth: z.number().int().min(1).max(28).optional(), // monthly (1–28: exists every month)` |
| 53 | `CreateRecurringExpenseSchema` | `weekday` | [`schemas.ts:1617`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1617) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `weekday: z.number().int().min(1).max(7).optional(), // weekly, ISO 1 = Monday` |
| 54 | `ListRecurringExpensesSchema` | `limit` | [`schemas.ts:1636`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1636) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).optional(),` |
| 55 | `CreateImageUploadSessionSchema` | `sizeBytes` | [`schemas.ts:1649`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1649) | *Non-Money* (Image / file dimension or size in bytes) | `sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),` |
| 56 | `RequestAttachmentSchema` | `sizeBytes` | [`schemas.ts:1710`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1710) | *Non-Money* (Image / file dimension or size in bytes) | `sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),` |
| 57 | `LimitIncreaseDetailsSchema` | `requestedLimit` | [`schemas.ts:1737`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1737) | *Non-Money* (Entity count / limit / configuration integer) | `requestedLimit: z.number().int().positive(),` |
| 58 | `UpdateRequestSchema` | `expectedVersion` | [`schemas.ts:1903`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1903) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `expectedVersion: z.number().int().positive(),` |
| 59 | `ListRequestsSchema` | `limit` | [`schemas.ts:1950`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1950) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 60 | `ListRequestActivitySchema` | `limit` | [`schemas.ts:1959`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1959) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 61 | `InboxListRequestsSchema` | `limit` | [`schemas.ts:1984`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L1984) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 62 | `GetRequestsMetaSchema` | `firstResponseHours` | [`schemas.ts:2039`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2039) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `firstResponseHours: z.number().int().min(1).max(720),` |
| 63 | `GetRequestsMetaSchema` | `resolutionHours` | [`schemas.ts:2040`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2040) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `resolutionHours: z.number().int().min(1).max(2160),` |
| 64 | `UpdateRequestsSettingsSchema` | `maxOpenPerUser` | [`schemas.ts:2054`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2054) | *Non-Money* (Entity count / limit / configuration integer) | `maxOpenPerUser: z.number().int().min(1).max(1000).optional(),` |
| 65 | `UpdateRequestsSettingsSchema` | `maxOpenPerOrg` | [`schemas.ts:2055`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2055) | *Non-Money* (Entity count / limit / configuration integer) | `maxOpenPerOrg: z.number().int().min(1).max(10000).optional(),` |
| 66 | `UpdateRequestsSettingsSchema` | `maxCreationsPerHourPerUser` | [`schemas.ts:2056`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2056) | *Non-Money* (Entity count / limit / configuration integer) | `maxCreationsPerHourPerUser: z.number().int().min(1).max(500).optional(),` |
| 67 | `UpdateRequestsSettingsSchema` | `autoCloseDays` | [`schemas.ts:2058`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2058) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `autoCloseDays: z.number().int().min(1).max(90).optional(),` |
| 68 | `UpdateRequestsSettingsSchema` | `reopenWindowDays` | [`schemas.ts:2059`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2059) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `reopenWindowDays: z.number().int().min(1).max(90).optional(),` |
| 69 | `UpdateRequestsSettingsSchema` | `needsInfoReminderDays` | [`schemas.ts:2060`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2060) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `needsInfoReminderDays: z.number().int().min(1).max(30).optional(),` |
| 70 | `UpdateRequestsSettingsSchema` | `needsInfoAutoCancelDays` | [`schemas.ts:2061`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2061) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `needsInfoAutoCancelDays: z.number().int().min(1).max(90).optional(),` |
| 71 | `FeeRuleInputSchema` | `settlementDays` | [`schemas.ts:2083`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2083) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `settlementDays: z.number().int().min(0).optional(),` |
| 72 | `ListFinancialAccountsSchema` | `limit` | [`schemas.ts:2117`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2117) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 73 | `GetAccountLedgerSchema` | `limit` | [`schemas.ts:2129`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2129) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 74 | `ListAccountTransfersSchema` | `limit` | [`schemas.ts:2153`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2153) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 75 | `ListStorageLocationsSchema` | `limit` | [`schemas.ts:2190`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2190) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 76 | `SubmitStockTransferSchema` | `version` | [`schemas.ts:2231`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2231) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 77 | `CancelStockTransferSchema` | `version` | [`schemas.ts:2239`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2239) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 78 | `DispatchStockTransferSchema` | `version` | [`schemas.ts:2255`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2255) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 79 | `ReceiveStockTransferSchema` | `version` | [`schemas.ts:2272`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2272) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 80 | `ResolveTransferDiscrepancySchema` | `version` | [`schemas.ts:2282`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2282) | *Non-Money* (Integer ordinal / identifier / conversion factor) | `version: z.number().int().min(0).optional(),` |
| 81 | `ListStockTransfersSchema` | `limit` | [`schemas.ts:2297`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2297) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 82 | `ListApprovalsSchema` | `limit` | [`schemas.ts:2310`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2310) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 83 | `ListPaymentFeesSchema` | `limit` | [`schemas.ts:2361`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2361) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 84 | `ListCapitalTransactionsSchema` | `limit` | [`schemas.ts:2417`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2417) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 85 | `ListAccountEntriesSchema` | `limit` | [`schemas.ts:2453`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2453) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(200).default(50).optional(),` |
| 86 | `UpdateAccountingPolicySchema` | `selfApprovalLimits` | [`schemas.ts:2520`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2520) | *Non-Money* (Entity count / limit / configuration integer) | `selfApprovalLimits: z.record(z.string(), z.number().int().min(0)).optional(),` |
| 87 | `CreateCashCountSchema` | `denominations` | [`schemas.ts:2529`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2529) | *Non-Money* (Physical note/coin count in denomination map) | `denominations: z.record(z.string(), z.number().int().min(0)),` |
| 88 | `ListCashCountsSchema` | `limit` | [`schemas.ts:2537`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/schemas.ts#L2537) | *Non-Money* (Entity count / limit / configuration integer) | `limit: z.number().int().min(1).max(100).default(50).optional(),` |
| 89 | `PartyCoreSchema` | `paymentTermsDays` | [`sharedSchemas.ts:130`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/validation/sharedSchemas.ts#L130) | *Non-Money* (Date / time duration unit (hours, days, weekday, months, years)) | `paymentTermsDays: z.number().int().min(0).max(365).default(0).optional(),` |

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

1. **`AccountTransactionDoc.amountMinor`** ([`models.ts:1761`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1761)) — duplicate of `amount` ([`models.ts:1759`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1759))
2. **`AccountTransactionDoc.balanceAfterMinor`** ([`models.ts:1762`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1762)) — duplicate of `balanceAfter` ([`models.ts:1760`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1760))
3. **`FinancialAccountDoc.openingBalanceMinor`** ([`models.ts:1684`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1684)) — duplicate of `openingBalance` ([`models.ts:1682`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1682))
4. **`FinancialAccountDoc.currentBalanceMinor`** ([`models.ts:1685`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1685)) — duplicate of `currentBalance` ([`models.ts:1683`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L1683))
5. **`JournalLineItem.debitMinor`** ([`models.ts:2059`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2059)) — duplicate of `debit` ([`models.ts:2057`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2057))
6. **`JournalLineItem.creditMinor`** ([`models.ts:2060`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2060)) — duplicate of `credit` ([`models.ts:2058`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2058))
7. **`JournalEntryDoc.totalDebitMinor`** ([`models.ts:2079`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2079)) — duplicate of `totalDebit` ([`models.ts:2077`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2077))
8. **`JournalEntryDoc.totalCreditMinor`** ([`models.ts:2080`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2080)) — duplicate of `totalCredit` ([`models.ts:2078`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L2078))
9. **`AccountingPolicy.cashCountVarianceThresholdMinor`** ([`models.ts:224`](file:///c:/Users/jesil.p/Project/FireBase/trado-firebase/functions/src/types/models.ts#L224)) — duplicate of decimal variance threshold
