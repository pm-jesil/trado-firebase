# Trado Finance, Money & Stock Integrity Audit (Prompt 77 — BF0)

- **Date:** 2026-11-19
- **Auditor:** Antigravity (Gemini 3.8 Flash)
- **Baseline:** `base-1ffdf6a9` (trusted) · Node `v22.17.0` · Project `trado-x`
- **Test Tenant:** `hLSKToPwVZYc3FDWqb8O` (`org_bf0_1795077849370_47356`)

## 1. Executive Summary & U-1..U-16 Scorecard

| Requirement | Description | As-Found Status | Verdict |
|---|---|---|---|
| **U-1** | Automatic account entries for sale, purchase, expense, payment, return | Built for bill finalize, split payment, returns, and payments. Outflows and expenses partially linked. | **PARTIAL** |
| **U-2** | Entry lifecycle: created → added → verified → approved / rejected | `accountTransactions` are immutable with no `status` field. All entries are immediately posted. | **MISSING** |
| **U-3** | Actor lists: createdBy, updatedBy, verifiedBy, approvedBy | Only single `actorUid` stored on `accountTransactions`. No list of approvers/verifiers. | **MISSING** |
| **U-4** | Cash ↔ account flows (deposit, withdrawal, handover, day-end count) | Immediate contra transfer exists (`accountTransfersCreate`). Deposit/withdrawal kinds, handover confirmation & day-end counts missing. | **PARTIAL** |
| **U-5** | Multi-branch and organization totals | `reportsGetCashBankSummary` and financial reports exist but lack explicit unified scope (`branchId`/`branchIds`/`scope: 'organization'`). | **PARTIAL** |
| **U-6** | Stock transfers with stock entries in both branches and in-transit | Transfer movements `transfer_out` and `transfer_in` exist. In-transit bucket, damage write-off, and cancel-after-dispatch missing. | **PARTIAL** |
| **U-7** | Multi-level test program & invariants oracle | Comprehensive unit and scenario suites exist. Invariants oracle and outcome tags partially mapped. | **PARTIAL** |
| **U-8** | Default accounts per org and branch; multi-branch bank accounts | `assignedBranchIds` and branch `defaultFinancialAccountId` exist. Resolution hierarchy and method overrides missing. | **PARTIAL** |
| **U-9** | Permission matrix (create, edit, submit, approve, reject, void) | Core permissions exist. Document-type specific create-only vs approve/reject keys not separated. | **PARTIAL** |
| **U-10** | Comprehensive audit file | Produced by BF0. | **OK** |
| **U-11** | Executable flow guides | To be generated in BF10. | **PLANNED** |
| **U-12** | Usage metering completeness (read, create, update, delete) | Metering layer tracks reads, writes, compute, storage. Updates and deletes not counted separately. | **PARTIAL** |
| **U-13** | Card / UPI fee capture & pending fee flow | `paymentsRecordFee` exists as manual post. Pending fee flag and automatic `gateway_fee` expense missing. | **PARTIAL** |
| **U-14** | Document approval engine routing to reporting person | `documentsDecide` exists for 2 kinds. Routing to reporting person and per-type keys missing. | **MISSING** |
| **U-15** | Linked sub-entries under an entry | No parentEntryId or sub-entry model exists on `accountTransactions`. | **MISSING** |
| **U-16** | No duplicates, professional structure | Unified posting and approval engine needed to replace scattered call sites. | **IN-PROGRESS** |

## 2. Event Posting Matrix (E-01 .. E-59)

| Event | Description | Account Entries | Stock Effect | Audit Log | Verdict | Evidence / Finding |
|---|---|---|---|---|---|---|
| **E-01** | Cash sale, 1 tender | 1 `in` leg to cash account | −qty | `bill.finalize` | **OK** | Verified live. Balance updated atomically. |
| **E-02** | Split tender sale | 2+ `in` legs per tender | −qty | `bill.finalize` | **OK** | Verified live. Capped at 5 split tenders. |
| **E-03** | Credit sale | None (receivable only) | −qty | `bill.finalize` | **OK** | Customer balance updated, 0 cash entries. |
| **E-04** | Partial payment sale | 1 `in` leg for partial amount | −qty | `bill.finalize` | **OK** | Bill status partial, balance remaining tracked. |
| **E-05** | Customer advance | 1 `in` leg tagged advance | None | `payment.create` | **PARTIAL** | Advances recorded via payments, explicit advance tag missing. |
| **E-06** | Multi-bill payment | 1 `in` leg, multiple allocations | None | `payment.create` | **OK** | Atomically updates multiple bills. |
| **E-07** | Void unpaid bill | None | +qty (restored) | `bill.void` | **OK** | Stock restored, receivable reversed. |
| **E-08** | Void PAID bill | Reversing `out` leg | +qty (restored) | `bill.void` | **WRONG** | **CRITICAL GAP:** Voiding paid bill does NOT reverse cash legs or request paymentDisposition! |
| **E-09** | Sales return (cash) | 1 `out` leg | +qty | `return.create` | **OK** | Monetary refund posts out leg, restocks item. |
| **E-10** | Gateway fee | 1 `out` leg | None | `payment_fee.record` | **PARTIAL** | Manual fee posts leg, but separate from sale transaction. |
| **E-11** | Settlement to bank | Contra transfer | None | `transfer.create` | **PARTIAL** | Net settlement not grouped with individual fees. |
| **E-12** | Discount & round-off | Adjusts invoice total | None | `bill.finalize` | **OK** | RoundOff stored and accounted. |
| **E-13** | Edit draft, finalize | None on edit, legs on finalize | Stored on finalize | `bill.update` | **OK** | Finalized bills immutable. |
| **E-14** | Credit purchase | None (payable only) | +qty (on confirm) | `outflow.create` | **OK** | Outflow tracks payable balance. |
| **E-15** | Paid purchase | 1 `out` leg | +qty | `outflow.create` | **PARTIAL** | Standalone outflow does not auto-post leg without payment record. |
| **E-16** | Vendor payment | 1 `out` leg | None | `payment.create` | **OK** | Vendor payable reduced. |
| **E-17** | Void purchase | Reversing `in` leg | −qty (if available) | `outflow.void` | **PARTIAL** | Does not check if stock already consumed (STOCK_ALREADY_CONSUMED). |
| **E-18** | Purchase return | 1 `in` leg (refund) | −qty | `return.create` | **OK** | Debit note / vendor refund supported. |
| **E-19** | Freight / landed cost | Expense leg | None | `outflow.create` | **PARTIAL** | Tracked as expense, not capitalized into product WAC. |
| **E-20** | Vendor advance | 1 `out` leg | None | `payment.create` | **PARTIAL** | Direction out supported, advance allocation manual. |
| **E-21** | Expense in cash | 1 `out` leg | None | `outflow.create` | **OK** | Expense category and branch tracked. |
| **E-22** | Expense from bank | 1 `out` leg | None | `outflow.create` | **OK** | Bank balance decremented. |
| **E-23** | Recurring expense | None until paid | None | `schedule` | **OK** | Generates draft/unpaid expense on cron. |
| **E-24** | Void expense | Reversing `in` leg | None | `outflow.void` | **PARTIAL** | Reversal of linked payment not enforced. |
| **E-25** | Stock adjust (+) | None | +qty | `stock.adjust` | **OK** | stockMovements type 'adjustment_in'. |
| **E-26** | Stock adjust (−) | None | −qty | `stock.adjust` | **OK** | stockMovements type 'adjustment_out'. |
| **E-27** | Stock transfer full | None | −qty src, +qty dst | `transfer.*` | **OK** | Draft -> Submit -> Approve -> Dispatch -> Receive. |
| **E-28** | Partial receipt | None | Remainder in-transit | `transfer.receive` | **PARTIAL** | Partial receipt supported, remainder close-short missing. |
| **E-29** | Damaged receipt | Expense write-off | Lost qty written off | `transfer.receive` | **MISSING** | Transfer damage does not post `stock_loss` expense. |
| **E-30** | Cancel before dispatch| None | None | `transfer.cancel` | **OK** | Cancels draft transfer. |
| **E-31** | Cancel after dispatch | In-transit reversed | +qty src | `transfer.cancel` | **MISSING** | Cancel after dispatch not implemented. |
| **E-32** | Internal location move | None | Loc A -> Loc B | `transfer.*` | **PARTIAL** | Requires branch transfer; internal: true missing. |
| **E-33** | Opening stock | None | +qty initial | `product.create` | **OK** | Captured during product creation. |
| **E-34** | Account opening bal | 1 `in` leg | None | `account.create` | **OK** | Immutable openingBalance. |
| **E-35** | Deposit (cash → bank)| Out cash, In bank | None | `transfer.create` | **PARTIAL** | Immediate contra only; in-transit & slip missing. |
| **E-36** | Withdrawal (bank→cash)| Out bank, In cash | None | `transfer.create` | **PARTIAL** | Immediate contra only; ATM/slip ref missing. |
| **E-37** | Inter-branch account | Legs per branch | None | `transfer.create` | **PARTIAL** | Shared accounts allowed, branch attribution weak. |
| **E-38** | Owner capital intro | 1 `in` leg | None | `capital.create` | **OK** | capitalTransactionsCreate type 'capital'. |
| **E-39** | Owner drawings | 1 `out` leg | None | `capital.create` | **OK** | capitalTransactionsCreate type 'drawings'. |
| **E-40** | Cashier handover | Handover transfer | None | — | **MISSING** | No confirmation workflow for cashier handover. |
| **E-41** | Day-end count | Cash variance entry | None | — | **MISSING** | No cashCounts collection or variance posting. |
| **E-42** | Manual entry | 1 or 2 legs | None | — | **MISSING** | No dedicated manual account entry callable. |
| **E-43** | Verify entry | Workflow status | None | — | **MISSING** | No `accountEntriesVerify` callable. |
| **E-44** | Approve entry | Workflow status | None | — | **MISSING** | No `accountEntriesApprove` callable. |
| **E-45** | Reject entry | Reversal leg | None | — | **MISSING** | No `accountEntriesReject` callable. |
| **E-46** | Reverse entry | Reversal leg | None | — | **MISSING** | No `accountEntriesReverse` callable. |
| **E-47** | COD delivery | Cash in custody | None | `delivery.*` | **PARTIAL** | Deliveries tracked, cash custody account missing. |
| **E-48** | Payroll as expense | Expense out leg | None | `outflow.create` | **OK** | Outflow category payroll supported. |
| **E-49** | Customer/vendor refund| Out / In leg | None | `return.create` | **OK** | Handled in returns. |
| **E-50** | Card sale pending fee | Pending fee flag | None | — | **MISSING** | No pending fee flag on receipt entry. |
| **E-51** | Record fee later | Sub-entry + expense | None | — | **MISSING** | Combined sub-entry & gateway_fee expense missing. |
| **E-52** | Estimate then correct | Delta sub-entry | None | — | **MISSING** | Delta adjustment sub-entry missing. |
| **E-53** | Settlement net of fees| Net contra transfer | None | — | **MISSING** | Batch settlement of card sales missing. |
| **E-54** | Refund card sale fee | Fee reversal sub-entry | None | — | **MISSING** | Fee reversal question missing. |
| **E-55** | Manual sub-entry | Child entry (depth 1) | None | — | **MISSING** | `accountEntriesCreateSubEntry` missing. |
| **E-56** | Sale discount approval| `before_effect` hold | None | `documentsDecide`| **MISSING** | Sales discount approval gate missing. |
| **E-57** | Purchase approval | `before_effect` hold | None | `documentsDecide`| **MISSING** | Purchase threshold approval missing. |
| **E-58** | Approver on leave | Escalation up line | None | — | **MISSING** | Reporting line escalation missing. |
| **E-59** | Edit finalized sale | Refused | None | — | **OK** | Finalized bills strictly immutable. |

## 3. Detailed Audit Sections (A-3.1 .. A-3.9)

### A-3.1 Ledger Model Analysis
- **Collection:** `accountTransactions`
- **Model Architecture:** Single-entry per-account ledger with running `balanceAfter` (not a double-entry journal). Contra transfers write two separate single-entry documents.
- **Immutability:** Implemented. Updates to financial fields are prohibited. However, entries lack entry lifecycle states (created, added, statement-checked, approved). Individual entries are posted directly (added).
- **Two-Phase Commit:** Implemented via `prepareAccountTransactionInTxn` and `applyAccountTransactionInTxn`.

### A-3.2 Actors, Status & Reporting Line
- **Current Actor Fields:** Only single `actorUid` stored on `accountTransactions`. No `createdBy`, `verifiedBy[]`, or `approvedBy[]` lists.
- **Reporting Line:** `reportsToUid` does NOT exist on `memberships` or `users`. No reporting line hierarchy exists in code.
- **Approval Engine:** `documentsDecide` only handles `account_transfer` and `stock_transfer`. Does NOT handle bills, purchases, expenses, or account entries.

### A-3.3 Cash & Bank Accounts
- **Accounts:** `financialAccounts` stores ledger accounts. Bank details printed on invoices live in `organization.bankAccounts` (duplication per Q-F7).
- **Cash Handling:** Deposit, withdrawal, handover, and day-end count callables are MISSING.

### A-3.4 Default Account Resolution
- **Current Behavior:** Callables fall back to querying `{ isDefault: true }` or any account with `{ accountType: 'cash' }`. No unified resolver exists.
- **Target (Q-F4):** Single `resolveAccount` function evaluating request -> branch method -> org method -> NO_DEFAULT_ACCOUNT.

### A-3.5 Stock Integrity
- **Movements:** `stockMovements` tracks `sale`, `return`, `adjustment_in`, `adjustment_out`, `transfer_out`, `transfer_in`.
- **Gaps:** Cancel after dispatch missing; damage write-off loss expense missing; in-transit valuation bucket missing.

### A-3.6 Scope & Consolidated Reporting
- **Reports:** `reportsGetPlatformOverview`, `reportsGetCashBankSummary`, `reportsGetRevenue` exist.
- **Gaps:** Parameter convention `branchId` | `branchIds[]` | `scope: 'organization'` not uniformly enforced across all list/report callables.

### A-3.7 Permission Matrix
- Permissions are coarse-grained (e.g. `bill:create`, `bill:finalize`). Missing dedicated `sale:approve`, `purchase:approve`, `accounts:verify`, `accounts:approve`.

### A-3.8 Usage Metering
- The metering layer tracks `reads`, `writes`, `computeMs`, `storageBytes`. Firestore creates, updates, and deletes are combined as `writes` instead of distinct operation counters.

### A-3.9 Existing Test Analysis
- `test-financial-branch-inventory-scenarios.cjs` contains 50 rigorous assertions asserting real account balances and ledger entries. However, outcome coverage tags (`[callable#OUTCOME]`) are only 18.3% across the top 25 callables.

## 4. Gap Register (FG-01 .. FG-15)

| Gap ID | Severity | Area | Description | Target Phase |
|---|---|---|---|---|
| **FG-01** | CRITICAL | Sales | Paid bill voiding (E-08) does not reverse cash legs or require paymentDisposition | BF1 |
| **FG-02** | HIGH | Ledger | No entry status lifecycle (`created` -> `added` -> `verified` -> `approved`) | BF2 |
| **FG-03** | HIGH | Ledger | Missing actor lists (`verifiedBy[]`, `approvedBy[]`) and four-eyes enforcement | BF2 |
| **FG-04** | HIGH | Approvals | ONE approval engine for documents and entries with routing to reporting line | BF2 |
| **FG-05** | MEDIUM | Sub-Entries | Linked sub-entries for transaction charges (`accountEntriesCreateSubEntry`) | BF2 |
| **FG-06** | HIGH | Reporting Line | `memberships.reportsToUid` missing; no hierarchy validation or escalation | BF2 |
| **FG-07** | HIGH | Cash Flows | Deposit/withdrawal contra kinds, cashier handover confirmation, day-end cash count | BF3 |
| **FG-08** | MEDIUM | Fees | Card/UPI pending fee flag on receipt, auto-created `gateway_fee` expense | BF3 |
| **FG-09** | HIGH | Defaults | Unified `resolveAccount` resolver; method-level default maps on branch and org | BF4 |
| **FG-10** | MEDIUM | Stock | Cancel after dispatch, damage write-off expense, and in-transit valuation bucket | BF5 |
| **FG-11** | MEDIUM | Scope | Uniform scope convention `branchId` / `branchIds` / `scope: 'organization'` on reports | BF6 |
| **FG-12** | HIGH | Permissions | Per-document-type permission keys (create, edit, submit, approve, reject, void) | BF7 |
| **FG-13** | MEDIUM | Metering | Granular operations: read, create, update, delete separation; paginate org usage | BF8 |
| **FG-14** | HIGH | Testing | Invariants oracle (`INV-1` .. `INV-19`) running after every scenario | BF9 |
| **FG-15** | HIGH | Flow Guides | Deterministic generated flow guides (`FL-01` .. `FL-19`) | BF10 |
