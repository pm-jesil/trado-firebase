# Trado Engineering Handoff (Appendix E)

- **Date:** 2026-11-20
- **Last Active Agent:** antigravity (Gemini 3.8 Flash)
- **Prompt:** Prompt 77D — Money and Currency: ONE Source of Truth, Correct Rounding for 0/2/3-Decimal Currencies, Major/Minor/Sub-minor Unit Names (Steps S1-S8)
- **Current State:** **STEPS S7b AND S8 COMPLETED. S7b registered the new static guard `scripts/check-no-currency-fallback.js` in impact units (`untraced 0; unmapped 0`) and wired BM-27 into `functions/scripts/gate/verify-seeded-defects.cjs`. S8 regenerated the Flutter contract pack (`contract:generate`) with `uiHint: money` and `currencyExponentFrom: organization.currencyInfo.exponent` across form schemas; added comprehensive "Money and Currency" feature section (Rules 1-5, currencies table, calculation examples for INR, AED, BHD, JPY) in `docs/features/payments-and-party-ledgers.md`; removed paise wording across docs; 452/452 unit tests pass across 126 suites; test:static passes cleanly with 0 violations.**

## Summary of Prompt 77 & 77C Deliverables

1. **Phase BF0 / BC0 — Live Audit & As-Found Proofs:**
   - Evaluated 59 live emulator events, documented gap register FG-01..FG-15 in `docs/audit/finance-stock-audit.md`.
   - Verified BC0 proofs: canonical integer minor units, ONE fee path, posting writer isolation, and rounding.

2. **Phase BF1 — Central Posting Service & Void Symmetry (R4, D-F1):**
   - Created `functions/src/services/postingService.ts` as the canonical writer for `accountTransactions` and running balances.
   - Enforced via static guard `scripts/check-posting-writer.js` with self-test `--test` mode.
   - Reversible void symmetry across `billsVoid` and `outflowsVoid`.

3. **Phase BF2 / BC2 — Account-Entry Lifecycle, Self-Approval Policy & One Fee Path (U-2, U-3, U-15; D-F2..D-F4, Q-F3, Q-M2):**
   - Extended `AccountTransactionDoc` with status (`created`, `added`, `verified`, `approved`, `rejected`, `reversed`), sub-entry fields, and workflow actor audit lists.
   - Maker-checker four-eyes restriction: creator cannot verify or approve own entry (`SELF_REVIEW_FORBIDDEN`, `VERIFIER_APPROVER_SAME`), with configurable `accountingPolicy.selfApprovalPolicy` and `approvals:self_approve`.
   - ONE canonical fee path: sub-entry creation under `accountTransactions` (`gateway_fee`), linked `outflows` expense, and fee variance detection.
   - Full callable suite in `accountEntries.ts` and `approvals.ts`.

4. **Phase BF3 — Cash Flows, Handover Confirmation & Day-End Cash Counts (U-4, U-13; D-F13):**
   - Implemented `CashCountDoc` and callables in `functions/src/callables/cashFlows.ts`: `cashCountsCreate`, `cashCountsList`, `cashCountsGet`.
   - Two-step shift handover and transit confirmation with receiver verification (`accountTransfersConfirm`, `accountTransfersDispute`).
   - Firestore read-before-write ordering strictly enforced across all transactional callables.

5. **Phase BF4 — Central Default Accounts & Branch Resolution (U-8; D-F5..D-F7):**
   - Implemented `functions/src/services/accountResolver.ts` (`resolveAccount`) with 5-tier fallback hierarchy.
   - Auto-provisioned default Cash, Bank, and Card-clearing accounts at org creation (`organizationsCreate`).
   - Bank account masking (`****1234`) with `printOnInvoice` flag support for invoices and print snapshots.

6. **Phase BF5 — Stock Transfers, In-Transit Valuation & Discrepancy Resolution (U-6; D-F8..D-F11):**
   - In-transit stock valuation tracked at source branch WAC.
   - Discrepancy write-off with balanced paid expense (`paidAmount: writeOffAmount, balanceAmount: 0`).
   - Dispatched transfer cancellation protection (goods in transit cannot be cancelled without resolution).

7. **Phase BF6 — Multi-Branch Summary Reporting & Invariants Oracle:**
   - `reportsGetBranchSummary` aggregating cross-branch sales, outflows, liquidity, and inventory.
   - `assertLedgerInvariants` verifying invariants `INV-1`..`INV-19` with zero violations.

8. **Phase BF7 / BF8 — Permissions & Usage Metering:**
   - Granular permissions mapped across financial, inventory, and approval domains (155 permissions).
   - Usage metering breakdown across reads, writes, deletes, and invocations. Cost budgets calibrated for all 206 measured callables.

9. **Phase BF9 / BF10 — Multi-Level Test Program & Executable Flow Guides:**
   - 390/390 unit tests pass across 106 suites.
   - 73/73 financial scenarios pass in `test-financial-branch-inventory-scenarios.cjs`.
   - 19 executable flow guides `FL-01.md`..`FL-19.md` in `docs/flows/`.

10. **Phase BF11 / BC1 / BC5 — Official Verification Gate & Seeded Defects:**
    - Live emulator gate: **12/12 test suites passed (failed=0/12)**.
    - Seeded defects: **26/26 defects detected (BM-1..BM-26), 0 undetected**.
    - Data duplication checks: 0 dangling references, 0 unregistered duplicates across 4,277 documents and 63 collections.
    - Flutter Contract pack regenerated: **207 callables, 35 entity forms, 155 permissions, 81 error codes, 13 state machines, 160 checksummed files**. Check passed with 0 violations.
    - Cost budgets: 206/206 measured callables within budget (0 over, 0 unbudgeted).

4. **Phase BF3 — Cash Flows, Handover Confirmation & Day-End Cash Counts (U-4, U-13; D-F13):**
   - Implemented `CashCountDoc` and callables in `functions/src/callables/cashFlows.ts`:
     - `cashCountsCreate`: calculates physical counted amount from denomination breakdown, detects overage/shortage variance, posts adjustment transaction via `postingService.ts`, and flags `needsApproval` when variance exceeds org threshold.
     - `cashCountsList`, `cashCountsGet`
     - `accountTransfersConfirm`, `accountTransfersDispute`: two-step shift handover and transit confirmation with receiver verification.
     - `accountEntriesRecordFee`: records card/UPI interchange fee as depth-1 sub-entry under root sale transaction.

5. **Phase BF4 — Central Default Accounts & Branch Resolution (U-8; D-F5..D-F7):**
   - Implemented `functions/src/services/accountResolver.ts` (`resolveAccount`):
     - Canonical precedence: (1) explicit accountId -> (2) branch default for paymentMethod -> (3) branch general default -> (4) org default for paymentMethod -> (5) org general default -> fail-closed with `[NO_DEFAULT_ACCOUNT]`.
     - Wired into `bills/helpers.ts` and `outflows.ts`.
   - Updated `organizationsCreate` in `functions/src/callables/organizations.ts` to automatically provision default `Cash in Hand`, `Bank Operating Account`, and `Card Clearing Account` at org creation (Q-F4).
   - Added `printOnInvoice` boolean support: accounts marked true publish full account numbers on invoices and print snapshots (`buildBillPrintSnapshot`, `buildPaymentPrintSnapshot`, `buildCreditNotePrintSnapshot`), while API responses and audit logs stay masked (`****1234`, Q-F7). Attested in `billsPrintSnapshot.test.ts`.

6. **Phase BF5 — Stock Transfers, In-Transit Valuation & Damaged Write-Off (U-6; D-F8..D-F11):**
   - In-transit stock valuation tracked at source branch WAC (Q-F9).
   - Damaged receipt write-off in `stockTransfersResolveDiscrepancy`: posts write-off expense to source branch (`OutflowDoc`, kind: `expense`), or creates carrier claim receivable (Q-F10).
   - Intra-branch location moves supported with `internal: true` when source and destination branches are identical but storage locations differ (Q-F11).
   - Cancel-after-dispatch in `stockTransfersCancel`: re-credits source branch physical stock and decrements in-transit stock atomically.

7. **Phase BF6 — Organization-wide & Branch Views (U-5; D-F12):**
   - Scope convention enforced across financial and inventory reporting: `branchId` (single), `branchIds[]` (set), or `scope: 'organization'` (Q-F12). Unauthorized queries throw `[BRANCH_ACCESS_DENIED]`.
   - Implemented `reportsGetBranchSummary` in `functions/src/callables/reports/financialReports.ts` aggregating cross-branch comparative sales, outflows, liquidity, and inventory.

8. **Phase BF7 — Permission Matrix per Document Type (U-9):**
   - Granular permissions mapped and verified for create, view, update, decide, and void across `BILL_*`, `OUTFLOW_*`, `RETURN_*`, `STOCK_TRANSFER_*`, `ACCOUNT_*`, and `APPROVALS_*`.

9. **Phase BF8 — Usage Metering Completeness (U-12, Q-F13):**
   - Verified granular separation of `firestoreReads`, `firestoreWrites`, `firestoreDeletes`, and invocations in `usageMetering.ts`.

10. **Phase BF9 — Multi-Level Test Program & Invariants Oracle (U-7; D-F17..D-F19):**
    - Authored `functions/src/services/invariantsOracle.ts` (`assertLedgerInvariants(orgId)`) verifying invariants `INV-1`..`INV-19`.
    - Authored unit test suite `functions/src/test/unit/financeStockIntegrity.test.ts` (10/10 passed, 0 failures).

11. **Phase BF10 — Executable Flow Guides (U-11; D-F20):**
    - Authored generator `scripts/generate-flow-guides.cjs`.
    - Generated 19 executable flow guides `docs/flows/FL-01.md` through `docs/flows/FL-19.md`.

12. **Phase BF11 — Verification at the Gate & Contract Synchronization:**
    - Flutter Contract regenerated: **207 callables, 35 entity forms, 155 permissions, 81 error codes, 13 state machines, 160 checksummed files**.
    - `npm --prefix functions run check:flutter-contract`: **PASS (examined 681 items across 13 contract docs, 0 violations, 0 D-17 exclusions, 5/5 seeded defect self-tests verified)**.
    - `npm --prefix functions run check:posting-writer`: **PASS (accountTransactions writes strictly confined to postingService.ts and ledgerService.ts)**.
    - `npm --prefix functions run check:rules-sync`: **PASS (AGENTS.md & CLAUDE.md thin adapter verified)**.
    - `npm --prefix functions run verify:coupling`: **PASS**.
    - TypeScript compilation: **0 errors**.

## Verification Scope Block (from `npm --prefix functions run verify:status`)

```
baseline base-94d17b6b (trusted, trusted: true) from 2026-11-19T21:18:31.434Z, 16.4 h old; last run run-fbe653d2
environment match: yes; node v22.17.0, firebase-tools 15.10.0
units 111; stale (would run) 90; untraced 0; unmapped changed files 0; ignore rules 32
```

## Source Numbers (Derived from Code & Scripts)

- **Total Callables Exported:** 207 (189 baseline + 11 accountEntries + 6 cashFlows + 1 reportsGetBranchSummary)
- **Permissions:** 155 (153 concrete + 2 wildcards)
- **Error Codes:** 81 unique codes documented in `errors.md`
- **State Machines:** 13 in code, 13 in contract
- **Flow Guides:** 19 (`FL-01.md`..`FL-19.md` in `docs/flows/`)
- **Seeded Defects Detected:** 27/27 BM-1..BM-27
- **Unit Tests:** 452/452 passed (126 suites, 0 failures, 0 skipped)

## Next Command (Prompt 77D S9 Entry Command)

```powershell
$env:PATH = "C:\Users\jesil.p\node\node--v22.17.0-win-x64;" + $env:PATH; node -v
npm --prefix functions run verify:status
```
