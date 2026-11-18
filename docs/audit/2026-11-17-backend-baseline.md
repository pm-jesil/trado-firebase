# Trado Firebase Backend — Baseline Audit & Gap Verification (Phase 0)

- **Audit Date:** 2026-11-17
- **Target Repository:** `pm-jesil/trado-firebase` (Cloud Functions v2, TypeScript, Node 22, region `asia-south1`, project `trado-x`)
- **Git Commit:** `74fe76c` (read-only baseline)
- **Status:** PHASE 0 COMPLETE — READ-ONLY BASELINE ESTABLISHED

---

## 1. Executive Summary & Baseline Counts

Phase 0 executed a strict read-only audit of the entire backend codebase against local Firebase emulators and static verification guards.

| Verification Gate | Result | Metric / Count | Details / Evidence |
|---|---|---|---|
| **TypeScript Build** | ✅ PASS | 0 errors | `npm --prefix functions run build` (`tsc`) |
| **Unit Test Suite** | ✅ PASS | 273 passed, 0 failed, 69 suites | `npm --prefix functions run test:unit` |
| **Schema Duplication Guard** | ✅ PASS | 60 interfaces, 91 candidates, 85 registered, 0 unregistered | `node scripts/check-schema-duplicates.js` |
| **Rules Sync Guard** | ✅ PASS | AGENTS.md (58 lines), CLAUDE.md thin adapter verified | `node scripts/check-rules-sync.js` |
| **Flutter Contract Guard** | ✅ PASS | 206 items, 11 docs, 23 forms, SUMMARY 108 lines, D-34 self-test verified | `node scripts/check-flutter-contract.js` |
| **Master Financial & Inventory Scenarios** | ✅ PASS | 35 passed, 0 failed (13/13 scenarios, ratio 35/35) | `test-financial-branch-inventory-scenarios.cjs` |
| **Real-World Core Scenarios (R-02..R-33)** | ✅ PASS | 22 checks passed, 0 failed (5/5 scenarios) | `test-real-world-scenarios.cjs` |
| **Subscription Limits & Audit Visibility** | ✅ PASS | 37 checks passed, 0 failed | `test-subscription-limits-and-audit-visibility.cjs` |

---

## 2. Forensic Verification of Known Gaps (G1 – G10)

Every gap listed in the Master Gap Report was audited directly against the source code. All 10 gaps are **CONFIRMED** with exact file:line evidence:

### G1 — Returns/refunds never touch the ledger (P0)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/callables/returns.ts:135-160`, `functions/src/callables/returns.ts:312-330`
- **Finding:** `returns.ts` contains exactly zero calls to `applyAccountTransactionInTxn` or `prepareAccountTransactionInTxn`. Cash, bank, and card refunds (`refundMethod: "cash" | "bank_transfer" | "card"`) update inventory and document status, but do NOT move `financialAccounts` and do NOT write `accountTransactions`. Only `refundMethod: "credit_note"` adjusts customer `outstandingBalance` or vendor `outstandingPayable`.

### G2 — Card/gateway fee flow is manual-only with no verification state; no auto-expense (P0)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/types/models.ts:1816-1836`, `functions/src/callables/paymentFees.ts:72-186`, `functions/src/callables/bills.ts:500-550`
- **Finding:**
  1. `PaymentProcessingFeeDoc` lacks: `status` (`expected` | `pending_verification` | `verified` | `disputed` | `reversed`), `isManualEntry`, `enteredBy`, `verifiedBy`, `verifiedAt`, `expectedFeeAmount`, `varianceAmount`, `settlementDate`, `settlementReference`, and `highlight`.
  2. `paymentsRecordFee` writes a `processing_fee` ledger row, but has zero calls to create an `outflows` expense document. It only stores an unindexed `feeExpenseCategoryId?: string | null`.
  3. Card sales in `billsCreate` immediately post the full gross collection to the financial account; there is no `pending_settlement` holding state for clearing accounts.

### G3 — Ledger entries are single-sided with no double-entry journal or Chart of Accounts (P0)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/types/models.ts:1667-1686`, codebase grep: 0 references to `journalEntries` or `chartOfAccounts`
- **Finding:** `AccountTransactionDoc` (`accountTransactions/{id}`) records a single account balance movement (`financialAccountId`, `direction: "in" | "out"`, `amount`, `balanceAfter`). There is no `journalEntries` collection, no Chart of Accounts (`chartOfAccounts`), and no balanced dual debit/credit posting mechanism. Trial balances cannot be generated.

### G4 — Ledger test coverage is thin; accounting oracle ignores per-account balances (P0)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/scripts/accounting-oracle.cjs` (0 occurrences of `financialAccount`, `accountTransactions`, or `financialAccountId`), test suites: 0 direct assertions on `accountTransactions` collection
- **Finding:** Pure unit tests only inspect Zod schemas and math helpers. Scenario tests query `financialAccountsGetLedger` API, but no test directly queries the raw `accountTransactions` collection or verifies sum(ledger) == balance. `accounting-oracle.cjs` models customers, vendors, stock, and P&L, but completely ignores cash/bank accounts, transfers, capital, and fees.

### G5 — Money calculations use rounded floats rather than integer minor units (P0)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/services/money.ts:20-60`, `functions/src/services/money.ts:93-138`, `functions/src/services/ledgerService.ts:60-65`
- **Finding:** `services/money.ts` relies on JavaScript `Number` floating-point math with `roundTo(value, 2)` exponential commercial rounding. In `ledgerService.ts`, running balance calculations use `currentBalance + amount` and `currentBalance - amount`. While amounts are conventionally paise, floating-point accumulation across high-volume ledgers risks fractional drift.

### G6 — Stock transfer ignores conversionFactor, cost carry, in-transit, and serials; bypasses stockEngine (P0)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/callables/stockTransfers.ts:226-262`, `functions/src/callables/stockTransfers.ts:314-362`
- **Finding:**
  1. **Unit conversion:** `requestedQty` and `dispatchedQty` are decremented and incremented directly without checking `conversionFactor` or converting to `baseQuantity`.
  2. **Cost carry:** No cost fields exist on transfer lines; destination WAC is never updated; transfer valuation is zero.
  3. **In-transit:** Source stock is decremented immediately upon dispatch and destination stock is incremented upon receipt. No in-transit holding quantity exists (`inTransitQty`).
  4. **Vanishing discrepancy:** `rejectedQty` and transit shortfalls are logged as notes/strings; no write-off, wastage expense, or carrier claim is recorded.
  5. **Serials/batches:** Serial numbers and batches are not tracked or transferred.
  6. **Engine bypass:** Direct read/write to `branchProductStock` doc bypassing `services/stockEngine.ts`.

### G7 — Tax regimes are hard-coded in a switch; only 6 countries; bill-level single rate (P1)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/services/taxCalculation.ts:51-101`, `functions/src/constants/countryDefaults.ts:28-146`, `functions/src/callables/bills.ts:217`
- **Finding:**
  1. `taxCalculation.ts` uses a static `switch` (`IN_GST`, `AE_VAT`, `OM_VAT`, `BH_VAT`, `SG_GST`, `US_SALES_TAX`, `NONE`). No database-backed tax jurisdictions or tax rates exist.
  2. `countryDefaults.ts` defines exactly 6 countries (IN, AE, OM, BH, SG, US), with state lists only for IN and AE.
  3. In `bills.ts:217`, `calculateTax` is invoked once on the bill subtotal; it does not support per-line tax category slabs, HSN codes, or interstate IGST calculation per line.

### G8 — Currency minor-unit name is not stored (P1)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/constants/countryDefaults.ts:14-26`, `functions/src/types/models.ts:110-150`
- **Finding:** `CountryDefaultDefinition` and `OrganizationDoc` store `currencyCode` and `currencyDecimals`, but do not store `minorUnitName` (e.g. "paisa", "fils", "cent") or `minorUnitNamePlural`.

### G9 — Seeds do not match the required 2 organizations; fields not fully populated (P1)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `functions/src/scripts/seed-business-data.ts:265-492`
- **Finding:** The seed file defines 8 fragmented sample specs (`WHOLESALE_HUB_SPEC`, `CYCLE_WORLD_SPEC`, `KITCHEN_MART_SPEC`, `UAE_TRADING_SPEC`, `SINGAPORE_TECH_SPEC`, `OMAN_SUPPLIES_SPEC`, `BAHRAIN_TRADING_SPEC`, `US_WHOLESALE_SPEC`). `CYCLE_WORLD_SPEC` has no country/currency (defaults to IN/INR), contains only 2 bicycles and 1 branch, has no bank accounts, no storage locations, and no multi-branch transfers.

### G10 — Duplicate skills directories, oversized files, open items U-6 and U-7 (P2)
- **Status:** `CONFIRMED`
- **File:Line Evidence:** `.agents/skills` (13 folders) vs `.claude/skills` (13 identical folders), `docs/audit/open-items.md:13-14`
- **Finding:**
  1. Duplicate directory trees: `.agents/skills` and `.claude/skills` contain identical duplicated Firebase skill files.
  2. Oversized source files: `schemas.ts` (2,053 lines), `models.ts` (1,721 lines), `reports.ts` (1,332 lines), `requests.ts` (1,082 lines), `bills.ts` (1,101 lines).
  3. Open items U-6 (state machine table of allowed transitions) and U-7 (update concurrency precondition) remain `PARTIAL` and `BLOCKED-ON Q-2 / Q-1`.

---

## 3. Comprehensive Inventory: Money- & Stock-Moving Callables

| Callable | Moves Money? | Moves Stock? | Existing Ledger Services Called | Existing Stock Services Called | Gaps Identified |
|---|:---:|:---:|---|---|---|
| `billsCreate` / `billsFinalize` | Yes | Yes | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (for single & split payments) | `stockOutItems`, `commitStockDeductionInTxn`, `stockMovements` (`SALE_OUT`) | Inline posting; card payments post gross immediately without `pending_settlement`. |
| `billsVoid` | Yes | Yes | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (two-phase reversal) | `stockMovements` (`RETURN_IN` restoration) | Reversal logic is inline; no journal entry. |
| `outflowsCreate` | Yes | Yes (purchases) | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (for payments & split payments) | `commitStockAdditionInTxn`, `stockMovements` (`PURCHASE_IN`) | Inline posting; no automatic fee expense linkage. |
| `outflowsVoid` | Yes | Yes (purchases) | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (two-phase reversal) | `commitStockDeductionInTxn`, `stockMovements` | Inline posting; no journal entry. |
| `paymentsCreate` | Yes | No | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` | None | Single-party balance update; no posting rules service. |
| `paymentsVoid` | Yes | No | Two-phase transaction reversal | None | Single-sided reversal. |
| `returnsCreate` / `decideReturn` | **Yes (Refunds)** | Yes | **NONE (0 calls)** | `commitStockAdditionInTxn` / `commitStockDeductionInTxn`, `stockMovements` | **P0 GAP G1:** Cash/bank refunds do not touch ledger! |
| `paymentsRecordFee` | Yes | No | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (`processing_fee`) | None | **P0 GAP G2:** No status state machine; no auto expense outflow document. |
| `financialAccountsCreate` | Yes (Opening bal) | No | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (`opening_balance`) | None | Single-sided account transaction only. |
| `accountTransfersCreate` / `decideAccountTransfer` | Yes | No | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (`transfer_out` + `transfer_in`) | None | Two legs posted in one transaction, but no journal. |
| `capitalTransactionsCreate` | Yes | No | `prepareAccountTransactionInTxn`, `applyAccountTransactionInTxn` (`capital_contribution` / `drawings`) | None | Single-sided account transaction; equity not journaled. |
| `stockAdjust` | No | Yes | None | `stockEngine`, `stockMovements` (`ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DAMAGE_OUT`) | Correctly uses `stockEngine`. |
| `stockTransfersDispatch` | No | Yes | None | Direct `branchProductStock` mutation; writes `stockMovements` | **P0 GAP G6:** Bypasses `stockEngine`; no conversionFactor, no in-transit, no serials. |
| `stockTransfersReceive` | No | Yes | None | Direct `branchProductStock` mutation; writes `stockMovements` | **P0 GAP G6:** Bypasses `stockEngine`; shortfalls vanish without write-off/expense. |
| `deliveriesUpdateStatus` | Yes (COD) | No | None | None | COD collection has no cashier handover ledger posting. |

---

## 4. Phase 0 Verdict & Readiness for Phase 1

1. **Baseline Stability:** Existing unit tests (273/273), static guards (3/3), and emulator scenarios (35/35 financial + 22/22 real-world + 37/37 subscription) are green.
2. **Action Plan for Phase 1:**
   - Build unified `services/postingRules.ts` to centralize all 20 posting events.
   - Wire `returns.ts` to `postingRules` (closing G1).
   - Extend `PaymentProcessingFeeDoc` with full verification lifecycle, auto-create linked `expense` outflows, and wire clearing accounts with `pending_settlement` (closing G2).
   - Implement `ledgerVerify` invariant callable and double-entry journal / Chart of Accounts (closing G3, G4).
   - Establish integer minor unit helpers with property drift tests (closing G5).
