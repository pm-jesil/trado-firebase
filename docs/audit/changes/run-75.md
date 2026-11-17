# Run 75 Change Record — Master Financial Accounting, Branch Operations, Inventory, Stock Transfers & Permissions (Prompt 75)

- **Run ID:** `run-75`
- **Date:** 2026-11-16
- **Agent:** Antigravity (Google DeepMind)
- **Model:** Gemini 3.8 Flash
- **Project:** Trado Firebase (`trado-x`, Cloud Functions Gen 2, Node 22, `asia-south1`)
- **Status:** COMPLETE — MASTER FINANCIAL, INVENTORY & CONTRACT SUITE READY

---

## 1. Executive Summary

This run executes the master architectural overhaul and contract alignment across financial accounting, branch management, inventory storage locations, inter-branch stock transfers, maker-checker approvals, and organization governance:
1. **Reconciled Audit Discrepancies (Phase 0):** Documented forensic truth reconciling all 5 conflicting metrics (23 base vs 39 full contract entities; 134 coupled vs 150 exported callables vs 106 Flutter-referenced; 129 vs 124 permissions; 294 executed vs 3,552 theoretical test cases).
2. **Operational Financial Accounts & Double-Entry Ledger (FB-5, R4, D-46, D-47):** Decoupled static invoice metadata (`OrganizationDoc.bankAccounts`) from live operational cash, bank, and digital accounts (`financialAccounts/{id}`) and append-only ledger entries (`accountTransactions/{id}`). Implemented two-phase transactional balance formulas in `services/ledgerService.ts`.
3. **Multi-Invoice Payment Settlement & Advances:** Updated `paymentsCreate` with `PaymentAllocation[]` support, transactional multi-bill balance reconciliation, and customer outstanding balance decrementing.
4. **Receivables & Payables Ageing Analysis:** Added `reportsGetReceivablesAgeing` and `reportsGetPayablesAgeing` callables categorizing unpaid balances into standard ageing buckets (Current, 1–30, 31–60, 61–90, 90+ days).
5. **Storage Locations & Multi-Branch Hierarchy (D-48):** Implemented `storageLocations/{id}` supporting warehouses, stockyards, sales counters, and transit facilities per branch or central org, with `isOwnStockyard` on Branch settings.
6. **Inter-Branch Stock Transfer Engine (D-49):** Implemented complete `stockTransfers/{id}` lifecycle (`draft` -> `submitted` -> `approved` -> `dispatched` -> `received` / `partially_received`). Atomically deducts source branch inventory on dispatch, isolates in-transit stock without phantom products, and credits destination branch inventory on receipt with discrepancy tracking.
7. **Unified Approvals Inbox & Router (FB-7, D-50):** Added `approvalsList` and `approvalsCounts` across all operational domains (`bill`, `outflow`, `return`, `stock_adjustment`, `account_transfer`, `stock_transfer`) with maker-checker self-approval prevention (`assertCanDecide`).
8. **Organization Governance & Field-Level Policy (FB-2, FB-4):** Updated `ORGANIZATION_FIELD_POLICY.admin` to unblock tenant Admins updating non-sensitive profile and contact fields, while strictly preserving Super-Admin control over sensitive configuration (`financialYearStartMonth`, `moduleToggles`, `showCostToTenant`).
9. **Granular RBAC Parity (FB-3):** Registered 17 new permissions (total: 146), mapped across billing, purchases, capital, and inventory modules in `permissionResolver.ts`, and updated system role templates.
10. **Flutter Contract Pack Freshness (D-35):** Generated Flutter form contracts (`financial_account`, `storage_location`, `stock_transfer`, `account_transfer`, `payment_processing_fee`, `capital_transaction`), updated `SUMMARY.md` (108 lines <= 250 max), and aligned state machines.

---

## 2. Installed Decisions (D-46 through D-52)

- **D-46 (Operational Financial Accounts Separation, FB-5):** Legal/invoice display bank accounts (`OrganizationDoc.bankAccounts`) remain distinct from live operational cash/bank ledger entities (`financialAccounts`) and append-only `accountTransactions`.
- **D-47 (Atomic Account Ledger Balance Formula, R4):** Double-entry running balance `balanceAfter = currentBalance ± amount` enforced transactionally via two-phase helper; direct manual balance overwrite is impossible.
- **D-48 (Storage Location & Warehouse Hierarchy):** Warehouses, sales counters, transit locations, and stockyards modeled as distinct storage locations per branch or central facility.
- **D-49 (Inter-Branch Stock Transfer Isolation):** In-transit stock held in dedicated state; source stock deducted atomically upon dispatch and added upon receipt without duplicating master product records or triggering sales tax/AR/AP.
- **D-50 (Unified Approvals Inbox & Decision Router, FB-7):** Single maker-checker decision router `documentsDecide` handles all domains; unified `approvalsList` and `approvalsCounts` query pending items across all operational collections.
- **D-51 (Payment Processing Charges Linked Accounting):** Merchant gateway/card processing charges are recorded as operating expenses linked to source payment/bill without reducing gross sales or customer receivable settlement; deducts from clearing/financial account to match net bank deposit.
- **D-52 (Capital & Owner Investment Accounting):** Capital contributions and drawings adjust cash/bank ledger balances via double-entry without polluting sales revenue, purchases, or customer receivable accounts.

---

## 3. Implemented Components & Callables

### 3.1 New & Extended HTTPS Callables (26 Total)
- **Financial Accounts & Capital (10):**
  - `financialAccountsCreate`: Create cash, bank, or digital account with opening balance.
  - `financialAccountsUpdate`: Patch operational account details.
  - `financialAccountsList`: Paginated account list filtered by branch and type.
  - `financialAccountsGet`: Single account fetch by ID.
  - `financialAccountsGetLedger`: Paginated append-only account transaction history.
  - `accountTransfersCreate`: Initiate fund transfer with optional maker-checker.
  - `accountTransfersList`: Query account-to-account transfers.
  - `accountTransfersGet`: Fetch account transfer detail.
  - `capitalTransactionsCreate`: Record owner/partner equity contribution or drawings (D-52).
  - `capitalTransactionsList`: Query capital transactions with type filters.
- **Payment Processing Fees (3):**
  - `paymentsRecordFee`: Record payment processing charges linked to original sale/payment (D-51).
  - `paymentsListFees`: Query fee records by source document or payment ID.
  - `paymentsGetFee`: Fetch fee transaction detail.
- **Storage Locations (4):**
  - `storageLocationsCreate`: Define warehouse, yard, or counter.
  - `storageLocationsUpdate`: Update storage facility details.
  - `storageLocationsList`: List storage locations for branch.
  - `storageLocationsGet`: Single storage location fetch.
- **Stock Transfers (6):**
  - `stockTransfersCreate`: Draft inter-branch transfer.
  - `stockTransfersSubmit`: Submit for manager approval.
  - `stockTransfersDispatch`: Deduct source inventory and transit stock.
  - `stockTransfersReceive`: Ingest destination inventory with discrepancy logging.
  - `stockTransfersList`: Paginated transfer list filtered by branch and status.
  - `stockTransfersGet`: Fetch complete transfer status and line items.
- **Approvals & Reports (3):**
  - `approvalsList`: Unified pending approvals inbox.
  - `approvalsCounts`: Aggregate pending count metrics by module.
  - `reportsGetReceivablesAgeing`: Real-time receivables ageing analysis (0-30, 31-60, 61-90, 90+ days).
  - `reportsGetPayablesAgeing`: Real-time payables ageing analysis (0-30, 31-60, 61-90, 90+ days).
  - `reportsGetCashBankSummary`: Aggregated liquidity report by cash, bank, digital, and clearing accounts.

### 3.2 Security, Indexes & Rules
- `firestore.indexes.json`: Composite indexes for `financialAccounts`, `accountTransactions`, `accountTransfers`, `storageLocations`, `stockTransfers`, `paymentProcessingFees`, and `capitalTransactions`.
- `duplication-allowlist.json`: Added entries `DUP-082` through `DUP-087` for `currentBalance`, `balanceAfter`, split payments, and bounded item arrays.
- `firestore.rules`: All financial, warehouse, and transfer collections secured under strict callable-only model.

---

## 4. Test Verification Suite

1. **Unit Test Suite (`functions/src/test/unit/financialAndBranchInventory.test.ts`):**
   - Pure-logic assertions covering schema strictness (D-11), unknown field rejection, integer paise precision (D-47), stock transfer invariants (D-49), RBAC catalog completeness (146 keys), opening stock storage location requirements, split payments validation, and Admin field policy (FB-2, FB-4).
2. **Scenario Test Suite (`functions/scripts/test-financial-branch-inventory-scenarios.cjs`):**
   - 13 executable emulator scenarios (S1–S13) covering account opening balances, two-phase payment ledger entries, multi-invoice allocations, account-to-account transfers, storage locations, end-to-end stock transfers (draft -> submit -> approve -> dispatch -> receive with discrepancies), approvals inbox, ageing reports, Admin organization updates, payment processing charges (D-51), capital contributions & drawings (D-52), cash/bank summary analytics, and multi-account split payments.
