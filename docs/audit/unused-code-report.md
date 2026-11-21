# Trado Backend — Unused Code, Duplicates and Junk Audit (Prompt 77E)

- **Date:** 2026-11-21
- **Head Commit:** `a439ff6` (tag `77d-complete`)
- **Baseline:** `base-8c4086d4` (trusted: true)
- **Status:** READ-ONLY AUDIT & DECISION RECORD (E0 & E1)

---

## 1. Recorded Decisions for Later Deletion Batches (E3)

> [!IMPORTANT]
> No code is deleted in steps E0, E1, or E2. Deletions happen exclusively in step E3, one approved batch per local commit.

- **Batch E3-A (Unused Functions & Constants):**
  - Targets: `setSuperAdminClaim`, `normalizeOptionalEmail`, `allocateNextDocumentNumber`, `membershipIdFor`, `setNotificationSender`, `meterMode`, `systemClock`, `IN_HAND`, `validateHSN`, `GetBranchSchema`, `PaginationQuerySchema`.
  - Action after deletion: Regenerate OpenAPI (`docs/openapi.json`) and API manifest (`tests/api/api-manifest.json`) via repo generators.
- **Batch E3-M (Money Leftovers):**
  - Targets: `toMinor`, `fromMinor`, `addMinor`, `subtractMinor`, `allocateMinor` and their exports in `functions/src/services/money.ts`.
  - Rewrite test callers: update `functions/src/test/unit/postingRules.test.ts` and `functions/src/test/unit/worldwideTaxAndCurrency.test.ts` to `Money.amount` and `Money.sum`.
  - Remove `moneyConvention: "major"` marker across `models.ts:214`, `schemas.ts:2514`, the 3 writers in `accountEntries.ts:694/721/730`, and the migration script.
  - Delete one-off 77D tools: `functions/scripts/money-field-scan.cjs` and `docs/audit/money-field-inventory.md`; update `docs/README.md` and `docs/generated/doc-index.json`.
  - Remove unused re-exports `getExponent` / `getCurrencyInfo` at `money.ts:12`.
  - Constraint: Do NOT add `Money.allocate` or any new helper.
- **Batch E3-B1 (Enums, Unbacked Docs, Usage Docs, Inferred Types):**
  - Targets: Enums `UserRole`, `EmployeeType`, `PermissionCode`.
  - Unbacked doc types: `ChartOfAccountDoc`, `AccountReconciliationDoc`.
  - Usage doc types: `UserUsageDailyDoc`, `OrganizationUsageMonthlyDoc`, `BranchUsageMonthlyDoc`, `UsageCounterShardDoc`.
  - Inferred input types: `AuthLoginInput`, `AuthMeInput`, `OrganizationContactInput`, `ContactPersonInput`, `BankAccountInput`, `TaxIdentityInput`, `NotesInput`, `PartyCoreInput`.
  - Strictly KEPT: `UniqueKeyDoc` (maps to Firestore `uniqueKeys`), `SerialDoc` (maps to Firestore `serials`), `BranchUsageDailyDoc` (read by `usage.ts`).
- **Batch E3-B2 (Unused `api.ts` Types):**
  - Target: Unused types in `functions/src/types/api.ts` verified to have zero external references.
  - Strictly KEPT: `PlatformCurrencyTotals` (`api.ts:798`, used at lines 819/821 in `PlatformOverviewReportResponse`), `RecordLocationPingRequest`, `GetLatestLocationsRequest`, `GetLocationHistoryRequest` (used by location tracking), and `AuthSubscriptionContext` (referenced at line 106 by `AuthPrimaryOrganizationContext`).
- **Batch E3-B3 (22 Docs-Only `api.ts` Types):**
  - Delete the 22 interfaces and update corresponding documentation markdown in the same batch (`check-doc-truth` must pass).

---

## 2. Knip "Unused Files" Truth Verification (String Grep Across Repo)

Knip reported 15 files under `Unused files`. As required, each script was verified by grepping its name as a literal string across `functions/package.json`, `scripts/`, `functions/scripts/`, `verify/`, and `docs/`.

| Script | Grep References Found | Status | Notes |
|---|---|---|---|
| `functions/scripts/gate/verify-bx1-bx4-emulator.cjs` | `run-emulator-gate.cjs:15`, `check-gate-integrity.js:22` | **ACTIVE GATE STEP** | Executes `BX1_BX4_ACCEPTANCE` in `gate:emulator`. Never delete. |
| `functions/scripts/gate/verify-bx2-emulator.cjs` | `run-emulator-gate.cjs:14`, `check-gate-integrity.js:21` | **ACTIVE GATE STEP** | Executes `BX2_ORG_POLICY_ACCEPTANCE` in `gate:emulator`. Never delete. |
| `functions/scripts/helpers/contract-shape.cjs` | `verify-bx1-bx4-emulator.cjs:12`, `verify-seeded-defects.cjs:87` | **ACTIVE TEST HELPER** | Imports `assertResponseShape`. Never delete. |
| `functions/scripts/lib/state-diff.cjs` | `run-bf0-audit.cjs:5, 21` | **TEST HELPER** | Used by `run-bf0-audit.cjs`. |
| `functions/scripts/migrate-org-owner-permissions.cjs` | `verify-bx2-emulator.cjs:9` | **ACTIVE GATE STEP** | Imported and verified in gate step. Never delete. |
| `functions/scripts/report-numbers.js` | `reportNumbers.test.ts`, `decision-register.md:60` (D-53) | **ACTIVE VERIFICATION TOOL** | Verified by unit test; generates source-derived metric reports. |
| `functions/scripts/report-outcome-coverage.js` | `verify-seeded-defects.cjs:142`, `decision-register.md:67` (D-60) | **ACTIVE GATE STEP** | Seeded defect BM-17 verifies callable outcome coverage. |
| `functions/scripts/clean-test-artifacts.js` | 0 references in code or docs | **CANDIDATE** | Last commit: `2026-11-13 (9e9ca89)`. Clean-up helper. |
| `functions/scripts/generate-demo-usage.cjs` | 0 references outside self | **CANDIDATE** | Last commit: `2026-11-13 (9e9ca89)`. Demo usage generator. |
| `functions/scripts/migrate-d15-image-fields.cjs` | `issue-ledger.md`, `phase-reports-archive.md`, `generate-open-items.js` | **CANDIDATE** | Last commit: `2026-11-13 (9e9ca89)`. One-off migration (D-15). |
| `functions/scripts/migrate-d7-party-fields.cjs` | `issue-ledger.md`, `phase-reports-archive.md` | **CANDIDATE** | Last commit: `2026-11-13 (9e9ca89)`. One-off migration (D-7). |
| `functions/scripts/migrate-legacy-fields.cjs` | 0 references outside self | **CANDIDATE** | Last commit: `2026-11-13 (9e9ca89)`. Pre-release cleanup script. |
| `functions/scripts/migrate-money-single-convention.cjs` | `test/unit/moneyRounding.test.ts` | **CANDIDATE** | Last commit: `2026-11-20 (d30d6b5)`. 77D S6 migration script. |
| `functions/scripts/money-field-scan.cjs` | `docs/audit/money-field-inventory.md` | **CANDIDATE (E3-M)** | Last commit: `2026-11-20`. Approved for deletion in E3-M. |
| `functions/scripts/run-bf0-audit.cjs` | 0 references outside self | **CANDIDATE** | Last commit: `2026-11-20 (a25c39f)`. BF0 audit runner. |
| `functions/scripts/run-cost-reconciliation.js` | 0 references outside self | **CANDIDATE** | Last commit: `2026-11-13 (9e9ca89)`. Standalone cost runner. |

---

## 3. Historical Migration Scripts (One-Off, Preserved in Tag `77d-complete`)

Because there is zero production data outside test emulators, one-off historical migrations can safely be removed from the working tree and remain preserved in git history at tag `77d-complete`:

| Migration Script | Last Commit Date & Sha | Purpose / Original Change | Recommendation |
|---|---|---|---|
| `functions/scripts/migrate-d15-image-fields.cjs` | `2026-11-13 (9e9ca89)` | Stripped `photoUrl`, `avatarUrl`, `logoUrl`, and `.url` from images | Awaiting owner decision in E1 |
| `functions/scripts/migrate-d7-party-fields.cjs` | `2026-11-13 (9e9ca89)` | Stripped legacy flat party fields (`whatsApp`, flat addresses) | Awaiting owner decision in E1 |
| `functions/scripts/migrate-legacy-fields.cjs` | `2026-11-13 (9e9ca89)` | Initial pre-release schema cleanup | Awaiting owner decision in E1 |
| `functions/scripts/migrate-org-owner-permissions.cjs` | `2026-11-19 (8c36152)` | Migrated org owners to system roles (verified in BX2 gate) | **KEEP** (called by BX2 gate step) |
| `functions/scripts/migrate-money-single-convention.cjs` | `2026-11-20 (d30d6b5)` | 77D S5b/S6 migration to major unit convention | Awaiting owner decision in E1 |

---

## 4. E1 Analysis: Files and Folders

### 4.1 `.agents/skills` vs `.claude/skills`
- **Current State:**
  - Both `.agents/skills` and `.claude/skills` contain 88 files across 13 skills.
  - On the local filesystem, `.claude\skills\*` entries are NTFS junctions pointing to `.agents\skills\*`.
  - In git, git tracks both folders independently.
- **Decision Options for Owner:**
  - **Option 1 (Recommended):** Keep `.claude/skills` as the source of truth, generate `.agents/skills` from it with `npm run skills:sync`, and enforce synchronization via guard `check-skills-sync.js`.
  - **Option 2:** Keep `.agents/skills` as the source of truth, generate `.claude/skills` from it.
  - **Option 3:** Delete one directory and retain only the directory for the designated agent environment.

### 4.2 Generated Artifacts Committed to Git

| Artifact / Folder | Generator Command | Readers (Guards / Impact / CI) | Needed in Git? | Proposal |
|---|---|---|---|---|
| `functions/scripts/helpers/runtime-callable-traces.jsonl` (8,450 lines) | Recorded during emulator test executions | Ignored in `verify/impact.config.json:107`; read by no static guard | **NO** | Remove from git tracking; add to `.gitignore`. Generated on demand during trace runs. |
| `docs/generated/*` (17 JSON/MD files) | `scripts/generate-policy-artifacts.js`, `generate-doc-index.js`, etc. | Verified by static guards (`test:static`, `check-doc-truth`, `check-doc-counts`, `check-naming`, etc.) | **YES** | Keep committed; ensures static validation passes without requiring pre-build generator execution in CI. |
| `docs/flutter-contract/**` (161 files) | `scripts/generate-flutter-contract.js` | Enforced by `check-flutter-contract.js`, `.checksum.json`, and Flutter contract packaging | **YES** | Keep committed; contract consumed by Flutter repo as a frozen contract pack (D-35). |
| `docs/audit/**` (50 files) | Multiple audit scripts & generators | Verified by `check-doc-banned-words`, `verify:coupling`, `check-test-completeness` | **YES** | Keep committed; forms audit trail, baseline records, and compliance evidence. |
| `tests/api/*.json` (`api-manifest.json`, `canonical-source-inventory.json`) | `scripts/generate-source-inventory.js`, `generate-manifest.js` | Enforced by `verify-coupling.js`, `check-test-completeness.js`, `check-doc-truth.js` | **YES** | Keep committed; canonical API manifest and collection inventory used as static guard baselines. |

### 4.3 Scripts with Zero External References

The following 13 scripts have zero references in `functions/package.json`, other scripts, guards, or documentation:

| Path | Name | Last Commit Date & Sha | Purpose |
|---|---|---|---|
| `functions/scripts/clean-test-artifacts.js` | `clean-test-artifacts.js` | `2026-11-13 (9e9ca89)` | Clean-up helper for test artifacts |
| `functions/scripts/generate-demo-usage.cjs` | `generate-demo-usage.cjs` | `2026-11-13 (9e9ca89)` | Generates synthetic usage metrics for demo |
| `functions/scripts/migrate-legacy-fields.cjs` | `migrate-legacy-fields.cjs` | `2026-11-13 (9e9ca89)` | One-off migration for legacy fields |
| `functions/scripts/run-bf0-audit.cjs` | `run-bf0-audit.cjs` | `2026-11-20 (a25c39f)` | BF0 phase audit execution helper |
| `functions/scripts/run-cost-reconciliation.js` | `run-cost-reconciliation.js` | `2026-11-13 (9e9ca89)` | Standalone cost reconciliation runner |
| `scripts/audit-callables.js` | `audit-callables.js` | `2026-11-06 (9a1158c)` | Early callable audit tool |
| `scripts/generate-callable-test-map.js` | `generate-callable-test-map.js` | `2026-11-13 (9e9ca89)` | One-off test mapping generator |
| `scripts/generate-contract-changes.js` | `generate-contract-changes.js` | `2026-11-13 (9e9ca89)` | One-off contract changes generator |
| `scripts/generate-document-ledger.js` | `generate-document-ledger.js` | `2026-11-13 (9e9ca89)` | One-off document ledger generator |
| `scripts/generate-validation-vectors.js` | `generate-validation-vectors.js` | `2026-11-13 (9e9ca89)` | One-off validation vector generator |
| `scripts/audit/generate-as-found.js` | `generate-as-found.js` | `2026-11-14 (53e96c4)` | Generator for frozen as-found baseline |
| `scripts/audit/generate-coupling-map.js` | `generate-coupling-map.js` | `2026-11-14 (53e96c4)` | Generator for coupling map audit |
| `scripts/audit/generate-decision-register.js` | `generate-decision-register.js` | `2026-11-21 (86bb3f3)` | Generator for `docs/decisions/decision-register.md` |

### 4.4 Leftover / One-Off Docs in `docs/audit/*` (Prompt 79 Decides)

The following historical run logs and as-found reports exist in `docs/audit/` and are listed for Prompt 79 review:
1. `docs/audit/changes/run-74.md` (100 lines) — Run 74 execution log
2. `docs/audit/changes/run-75.md` (75 lines) — Run 75 execution log
3. `docs/audit/changes/run-76.md` (69 lines) — Run 76 execution log
4. `docs/audit/as-found/2026-11-14-antigravity.json` (326 lines) — Frozen Phase A snapshot
5. `docs/audit/as-found/2026-11-14-antigravity.md` (106 lines) — Frozen Phase A report
6. `docs/audit/as-found/2026-11-14-as-found-after-S1-S3.json` (42 lines) — Intermediate snapshot
7. `docs/audit/as-found/2026-11-14-as-found-after-S1-S3.md` (29 lines) — Intermediate report
8. `docs/audit/2026-11-16-master-financial-branch-inventory-audit.md` (190 lines) — Master finance audit
9. `docs/audit/2026-11-17-backend-baseline.md` (104 lines) — Backend baseline audit
10. `docs/audit/current-repository-baseline.md` (164 lines) — Archived baseline
11. `docs/audit/phase-reports-archive.md` (178 lines) — Prompts 58–64 archived reports
12. `docs/audit/test-file-refactor.md` (52 lines) — Test refactor notes
13. `docs/audit/test-refactor-verification-report.md` (212 lines) — Verification report
14. `docs/audit/documentation-verification-report.md` (189 lines) — Verification report
15. `docs/audit/documentation-inventory-and-deduplication.md` (70 lines) — Inventory report


---

## 5. E1b Investigation Results

### 5.1 E1b-1: Test Count Discrepancy Forensic Resolution
- **S8 vs HEAD Discrepancy:** Prompt 77D S8 reported "452 unit tests across 126 suites"; HEAD `a439ff6` reports "446 unit tests across 125 suites".
- **Forensic Investigation:**
  - Created a clean scratch worktree at commit `a6d1040` (S8).
  - Completely purged `functions/lib` and compiled fresh from TypeScript source.
  - Ran `node --test lib/test/unit/**/*.test.js`:
    `# tests 446`
    `# suites 125`
    `# pass 446, fail 0`
  - Compared test files between `a6d1040` and HEAD `a439ff6`:
    `git diff a6d1040..a439ff6 functions/src/test/unit/` touched only 3 files with zero tests added or removed (only minor wording updates: `money_paise` -> `money`, `paise` -> `positive amount`).
  - Git deletion history: `git log --diff-filter=D --summary functions/src/test/unit/` confirmed ZERO test files were ever deleted in git history.
- **Root Cause:** The earlier "452" count was a transient artifact of stale compiled `.js` files in `functions/lib/` before a clean build removed an old refactored module.
- **Verdict:** **Zero real tests were lost.** 446 tests across 125 suites is the exact, canonical unit test count.

### 5.2 E1b-2: `runtime-callable-traces.jsonl` Reader Check
- Literal search `git grep -rn "runtime-callable-traces"` found only `verify/impact.config.json:107` (in the ignore list).
- Removed the file locally and executed `npm run coverage:compute`, `npm run verify:status`, and `npm run verify:changed`: verified 3/3 commands passed cleanly with 0 unmapped files [cov:3/3].
- **Verdict:** Safe to untrack. Propose adding to `.gitignore` and running `git rm --cached functions/scripts/helpers/runtime-callable-traces.jsonl` in E3.

### 5.3 D3: Analysis of the 7 Generator Outputs
1. `scripts/generate-callable-test-map.js` -> `docs/generated/callable-test-map.json`: 0 external readers found outside itself. Candidate for deletion along with its output in E3.
2. `scripts/generate-contract-changes.js` -> `docs/generated/contract-changes.md`: Read by `docs/README.md` and `docs/generated/doc-index.json`. **KEEP**.
3. `scripts/generate-validation-vectors.js` -> `docs/generated/field-validation-vectors.json`: Read by `functions/src/test/unit/fieldValidationVectors.test.ts`. **KEEP**.
4. `scripts/generate-document-ledger.js` -> `docs/audit/document-ledger.json` / `.md`: Read by `docs/README.md` and `docs/generated/doc-index.json`. **KEEP**.
5. `scripts/audit/generate-as-found.js` -> `docs/audit/as-found/`: Frozen baseline snapshot per D-29. **KEEP**.
6. `scripts/audit/generate-coupling-map.js` -> `docs/audit/coupling-map.json`: Read by `scripts/verify-coupling.js`. **KEEP**.
7. `scripts/audit/generate-decision-register.js` -> `docs/decisions/decision-register.md`: Core architectural decision register generator. **KEEP**.

### 5.4 D4: `migrate-money-single-convention.cjs` Reference Check
- Referenced only in `functions/src/test/unit/moneyRounding.test.ts:863-982` (5 migration transform unit tests).
- 0 references in seeded defects (BM-1..BM-27) and 0 references in static guards.
- **Verdict:** Keep until E3-C, then delete script and remove its unit test block.

---

## 6. E2 Architectural & Duplicate Analysis (Read-Only)

### 6.1 `assertSeatAvailable` Duplicate Analysis
- **Locations:** `functions/src/callables/employees.ts:65` and `functions/src/services/membershipProvisioning.ts:45`.
- **Line-by-Line Comparison:**
  - `membershipProvisioning.ts:45` includes defensive checks: `if (!orgSnap.exists)` and `if (org.planId)` before querying `subscriptionPlans`. Already exported.
  - `employees.ts:65` omits the existence check and assumes `org.planId` is present.
  - Also duplicated: helper `readActiveEmployeeCount(txn, orgId, org)` is identical in both files.
- **Callers:**
  - `employees.ts`: called by `employeesCreate` (line 288) and `employeesActivate` (line 433).
  - `membershipProvisioning.ts`: called by `provisionMembershipInternal` (line 228).
  - All callers need identical return value: `{ orgRef, next: current + 1 }`.
- **Merger Proposal:** Delete `readActiveEmployeeCount` and `assertSeatAvailable` from `employees.ts`, and import `assertSeatAvailable` from `../services/membershipProvisioning.js`. Zero risk, removes 30 duplicate lines.

### 6.2 `devDependencies`: `swagger-ui-dist` and `firebase-functions-test`
- **`swagger-ui-dist`:** Actively used by `tools/api-explorer/server.js:453-1078` to host Swagger UI locally and offline without CDN dependency. **KEEP**.
- **`firebase-functions-test`:** 0 references in tests or scripts. Unit tests use `node --test` with direct function calls; emulator tests use `callable-client.cjs`. However, removing it removes transitive `glob@13` from `node_modules`, which breaks `functions/scripts/check-stored-url-fields.js`. Once `check-stored-url-fields.js` is switched to Node 22 native `fs.readdirSync`, `firebase-functions-test` can be safely removed.

### 6.3 Unlisted `glob` in `functions/scripts/check-stored-url-fields.js`
- `glob` is not listed in `functions/package.json` dependencies or devDependencies.
- It works only because `firebase-functions-test` (and `eslint`) pulls it in transitively.
- **Fix:** Replace `const { glob } = require("glob");` in `check-stored-url-fields.js` with Node 22 built-in `fs.readdirSync(srcDir, { recursive: true })`.

### 6.4 Unused Exports Analysis
1. `setCustomClaims` (`claims.ts:29`): Used only internally by `setCustomClaimsActiveOrg`, `setCustomClaimsActiveBranch`, `setCustomClaimsSuperAdmin`. 0 external uses. **Action: Remove `export` keyword**.
2. `nextRunOn` (`recurringExpenses.ts:29`): Used only internally at lines 75, 150. (Tests check doc property `.nextRunOn`, not function). **Action: Remove `export` keyword**.
3. `periodKey` (`recurringExpenses.ts:44`): Used only internally at line 132. **Action: Remove `export` keyword**.
4. `preparePostingInTxn` (`postingRules.ts:129`): Superseded by `postingService.ts` (`prepareEntriesInTxn`). 0 external uses. **Action: Delete function** (along with `applyPostingInTxn`).
5. `BAHRAIN_BICYCLE_SPEC` (`seed-business-data.ts:542`): Internal to seed file (defines alias `CYCLE_WORLD_SPEC`). **Action: Remove `export` keyword**.
6. `UAE_KITCHENWARE_SPEC` (`seed-business-data.ts:783`): Internal to seed file (defines alias `KITCHEN_MART_SPEC`). **Action: Remove `export` keyword**.

### 6.5 94 Registered Duplication Exceptions (Allowlist)
- **Candidate Findings:** 100 total (`D8_UNBOUNDED_ARRAY`: 51, `D5_DERIVED_FIELD`: 41, `D1_DISPLAY_COPY`: 4, `D3_EMBEDDED_ENTITY`: 2, `D2_SHARED_ATTRIBUTE`: 2).
- **Registered Allowlist Entries:** 94 entries in `duplication-allowlist.json`.
  - By kind: `BOUNDED_ARRAY`: 49, `R3`: 20, `R2`: 19, `OWNED`: 4, `R4`: 2.
  - By collection: `outflows` (17), `bills` (15), `organizations` (7), `customers` (7), `vendors` (7), `products` (5), `accountTransactions` (5), `returns` (4), `requests` (3), `stockTransfers` (3), `taxRegimes` (3), `stockBalances` (2), `payments` (2), `memberships` (2), `activity` (2), and 1 each for 10 other collections.
- **Array Growth Risk Analysis:**
  - *High-growth risk:* `accountReconciliations.reconciledTransactionIds` (`DUP-085`). In high-volume tenants, monthly statements can have 5,000-50,000 transactions, inflating a single document. Propose moving to subcollection in a future data migration.
  - *Medium-growth risk:* `stockAdjustmentRequests.serialNumbers` (`DUP-062`) and `stockTransfers.items.serialNumbers` (`DUP-095`), capped at 500 in schemas.
  - *Safely bounded:* `bills.items`, `outflows.lines`, `returns.items`, `deliveries.lines`, `stockTransfers.items`, `payments.allocations` are strictly bounded to 200 items in Zod schemas. Contacts, addresses, phones, and roles are bounded between 4 and 20 items.

### 6.6 Two Fee Paths
- **Path 1 (`paymentsRecordFee` in `paymentFees.ts`):** Creates standalone doc in `paymentProcessingFees` (`FEE-xxxx`), posts to `accountTransactions` via `prepareAccountTransactionInTxn`, auto-creates `outflows` expense (`EXP-xxxx`), provides maker-checker verification/dispute workflow (`paymentsVerifyFee`, `paymentsDisputeFee`, `paymentsReverseFee`).
- **Path 2 (`accountEntriesRecordFee` in `cashFlows.ts`):** Depth-1 sub-entry on `accountTransactions` (`subEntryType: "gateway_fee"`), updates parent `feeStatus`, creates linked `outflows` expense. Does NOT write `paymentProcessingFees`.
- **Relationship:** Neither wraps the other. They are parallel implementations from different phases (Prompt 75 vs Prompt 77). Callers are split across scenarios.
- **Recommendation:** Unify around `postingService` sub-entries while keeping `paymentsRecordFee` as the public facade.

### 6.7 Three Bill-Cancel Paths
- **`billsCancel`:** DOES NOT EXIST as a callable in code; only exists in documentation diagrams.
- **`billsVoid`:** The single unified callable for bills.
  - If `draft` or `pending_approval`: sets `status: "cancelled"`, releases stock reservations and held serials. 0 accounting changes.
  - If `active`: sets `status: "voided"`, reverses physical stock via `RETURN_IN` stock movements, reverses customer balance, executes two-phase ledger reversals on linked payments.
- **Refund / Return:** Handled by `returnsCreate` (creates separate `returns` document and credit note for active bills).

### 6.8 Two Stock-Write Paths
- **`stockEngine`:** Central service for `bills`, `outflows`, `returns`, and adjustments. Writes `products.currentStock`, `stockBalances.currentStock`, and `stockMovements`. Does NOT touch `branchProductStock`.
- **`stockTransfers.ts`:** Custom multi-branch transfer logic. Writes `stockBalances` (source decrement, dest increment, `inTransitQty`), `stockMovements`, and also writes to `branchProductStock` (`// Keep branchProductStock backwards-compatible`).
- **Sync & Tracking:** `stockBalances` stays in sync across both paths. `branchProductStock` drifts because `stockEngine` does not update it (it is a legacy mirror). `stockTransfers.ts` does NOT bypass WAC (recalculates destination WAC on receive) or serial tracking (marks in-transit on dispatch, transfers on receive).

### 6.9 Repeated Permission-Check Blocks in Callables
- Scanned 207 callables across 48 files.
- Found ~704 lines of boilerplate (`!request.auth`, `resolveRequestContext`, cross-tenant checks), averaging ~3.4 lines per callable.
- While a higher-order wrapper (`tradoCallable`) could reduce this boilerplate, static analysis guards (`check-gate-conformance.js`, `generate-source-inventory.js`, `check-flutter-contract.js`) rely on explicit AST/regex parsing of `resolveRequestContext`. Explicit checks must be retained to maintain static guard integrity.

### 6.10 Top 5 Repeated Zod Snippets
1. `organizationId`: 86 occurrences (`z.string().trim().min(2).optional()` / `min(2)`).
2. `idempotencyKey`: 47 occurrences (`z.string().trim().min(8).max(128).optional()` / `optional()`).
3. `branchId`: 40 occurrences (`z.string().trim().min(2).optional()`).
4. `reason`: 27 occurrences (`z.string().trim().min(2).max(500)`).
5. `notes`: 25 occurrences (`z.string().trim().max(500).optional()` / `max(1000)` / `max(300)`).
