# Hybrid Prompt 76 — BX0 Truth Reconciliation, Gap Closure Plan & Owner Approval Tables

- **Date:** 2026-11-18
- **Run ID:** `run-77-bx0` (next free ledger ID after existing `run-76-*` entries)
- **Git HEAD:** `d75bd12273d58a09b1fe7ff63d197883b6e3c88f` (working tree dirty: `report-numbers.js`, `reportNumbers.test.ts`, plan & state updates)
- **Scope of This Document:** BX0 truth reconciliation (TB-1..TB-15, R-1..R-20 verdicts), newly identified gaps (MG-36..MG-41), CP-2 location tracking inventory, and **two owner confirmation tables required before BX1/BX2/BX3 code edits**: (1) C-1 Organization Field Classification (Q-B1/Q-B2) and (2) Duplication Allowlist Review `DUP-074..DUP-100` (Q-B10).

> **Rule Conflict Notice (`AGENTS.md` vs Q-B11 / A-0):**
> `AGENTS.md` explicitly states: *"Never: deploy, commit, push, stage or unstage. Read-only git is fine."*
> Prompt 76 A-0 mentions a local tag `checkpoint/bx0-<yyyymmdd>` ("if `AGENTS.md` allows tags; otherwise ask") and Q-B11 proposes local commits ("unless `AGENTS.md` says otherwise").
> Per `AGENTS.md` and Prompt 76's conflict rule, **zero commits, zero staging, and zero tags** have been created. Please confirm whether `AGENTS.md` (no commits/tags by agents) remains binding, or whether local-only commits are authorized for this run.

---

## 1. Source-Derived Numbers (`node functions/scripts/report-numbers.js --run-unit`, D-N1)

```text
=== TRADO BACKEND SOURCE-DERIVED NUMBERS (D-N1) ===
UTC Time:       2026-11-18T13:34:07.960Z
Git SHA:        d75bd12273d58a09b1fe7ff63d197883b6e3c88f (dirty: true)
Node Runtime:   v24.16.0 (package.json engines.node: 22)
Command:        node functions/scripts/report-numbers.js --run-unit

--- Exports (functions/src/index.ts) ---
Total exports:  194 (= 186 callables baseline subset + 8 triggers in module layer: 6 Firestore/Storage + 2 schedules)
Triggers (6):   onStorageObjectFinalized, onBillWritten, onOutflowWritten, onPaymentWritten, onDeliveryWritten, onRequestActivityWritten
Schedules (2):  subscriptionAndUsageSweep, requestsSlaAndLifecycleSweep
Callables by gate: public_or_auth=10, tenant=138, platform=29, mixed_tenant_or_platform=9
Callables by domain (42 domains):
  approvals:3, authLogin:1, authMe:1, bills:7, branches:7, catalogs:3, categories:3,
  customers:4, deliveries:4, departments:3, employees:5, financialAccounts:10,
  healthCheck:1, history:2, images:3, jobRoles:3, ledgerVerify:2, locations:3,
  notifications:3, organizations:11, outflows:4, paymentFees:6, payments:3, plans:7,
  platformUsers:2, products:5, reconciliation:3, recurringExpenses:3, reports:12,
  requests:16, returns:2, roles:3, stock:2, stockTransfers:8, stockVerify:1,
  storageLocations:4, tasks:6, teams:4, units:3, usage:8, users:1, vendors:4

--- Collections & Models ---
Collections referenced in source: 61
Document interfaces (*Doc) in models.ts: 62
Explicit collection match blocks in firestore.rules: 10
Source collections covered by default-deny rule: 51

--- Flutter Contract Pack (docs/flutter-contract/) ---
Top-level contract docs: 11
Entity form JSONs:       30 (total fields: 688)
Request-detail JSONs:    15
Total form JSON files:   45
Zero-field entity forms: 1 (approval_request)
SUMMARY.md lines:        108

--- Permissions (functions/src/constants/permissions.ts) ---
AppPermissions entries:  147 (145 concrete + 2 wildcards: *, platform:*)
Documented in contract:  145/145

--- Reason / Error Codes ---
GateReason enum:         21
RequestReason enum:      16
Unique thrown codes:     62
Documented in errors.md: 24
Undocumented thrown:     45

--- State Machines ---
State machines in code:  13
Documented in contract:  9

--- Duplication Allowlist (functions/scripts/duplication-allowlist.json) ---
Total exceptions:        93 (max id: DUP-100)
By kind:                 R2=19, R3=20, R4=4, OWNED=5, BOUNDED_ARRAY=45

--- Documentation & Tests ---
Markdown files in docs/: 160
Unit test files:         30
Rules test files:        2
Emulator test scripts:   27
Unit run:                309/309 pass (88 suites, 0 skipped)
Emulator run:            NOT RUN (verified separately in BX0 emulator batch below)
```

---

## 2. Verdicts on R-1 through R-20

| # | Verdict | Tool / File Evidence |
|---|---|---|
| **R-1** | **CONFIRMED** | Backend exports grew `140` (pre-P74: 134 + 6) → `158` (P74 `1f370f8`: 150 + 8) → `186` (P75 `74fe76c`: 178 + 8) → `194` (HEAD `d75bd12`: 186 callables baseline subset + 8 triggers/schedules). Flutter `docs/audit/numbers.md:26` counted 104 `call(...)` invocations (current `lib/**/*.dart` scan: 118). Contract forms only reference 54 valid + 4 non-existent callables; no `callables.json` exists yet. |
| **R-2** | **CONFIRMED** | Four distinct definitions were mixed: `61` collections in source, `62` `*Doc` interfaces in `models.ts`, `30` entity forms in `docs/flutter-contract/forms/` (`688` fields) + `15` request-detail forms, while `scripts/check-flutter-contract.js:111` hardcodes `"23 entity forms"` in its stdout message despite checking `REQUIRED_ENTITIES` (length 30). |
| **R-3** | **CONFIRMED** | `test-requests-scenarios.cjs` executes 43 checks across 10 flows + in-process sweep; **F-RQ4** (blocker override) and **F-RQ11** (SLA pause accumulation) are absent despite being listed in lines 9 & 16. Unit suites have 29 tests across `requestsSchemasAndSla.test.ts` (15) & `requestsStateMachine.test.ts` (14), not an exhaustive state grid or ≥ 45 per-category tests. |
| **R-4** | **CONFIRMED** | `docs/plans/2026-11-15-requests-module.md:204` and `functions/src/services/requestsService.ts:208` specify `14` days; `docs/flutter-contract/errors.md:40` and `test-requests-scenarios.cjs:60` hardcode `30` days. No decision row justifies 30. |
| **R-5** | **PARTIAL** | Prompt-74 stopped at `verify:plan`; later `run-76-phase6-final-gate` ran `verify:changed` and recorded an **untrusted** baseline `run-062d4c4a` (`trusted: false` per `verify:status`), not a trusted `verify:full` baseline. |
| **R-6** | **CONFIRMED** | Contract pack has zero response-shape descriptors and no `assertResponseShape` check; `requestsService.ts:197-212` still contains a fail-open bug when `platformSettings/requests` is absent (MG-36). |
| **R-7** | **CONFIRMED** | No `requestsSettingsUpdate` / `requestsSettingsGet` callable exists; `migrate-requests-permissions.cjs` uses `--execute` (no `--apply`, no `auditLogs` entry, no automated test). |
| **R-8** | **CONFIRMED (POLICY FIX IN BACKEND)** | `ORGANIZATION_FIELD_POLICY.admin` in `functions/src/callables/organizations.ts:75-78` is **NOT** empty (it was populated in P75), but it uses role-name branching (`roleId === "role_org_owner"`, line 349) and lets plain `org:update` edit sensitive fields `legalName` & `taxId`. Policy must be rebuilt permission-first in BX2 (Q-B1/Q-B2). |
| **R-9** | **CONFIRMED** | `functions/src/constants/permissions.ts` defines 147 entries (145 concrete + 2 wildcards). Verified present: `usage:read`, `usage:read_users`, `audit:view`, `audit:read_own`, `product:view_cost`, `platform:requests_override_blockers`, `platform:requests_configure`. Verified absent: `usage:view`, `audit:read`, `inventory:view_cost`. No machine-readable `permissions.json` or scope notes exist yet. |
| **R-10** | **CONFIRMED** | `docs/flutter-contract/forms/approval_request.json` has `0` fields because `scripts/generate-flutter-contract.js:51` points to non-existent `"approvalsDecide"` and `"DecideApprovalSchema"` instead of `documentsDecide`. No forms exist for `usersUpdateMe`, `organizationsTransferOwnership`, notification preferences, or system settings. |
| **R-11** | **CONFIRMED** | Open gaps MG-01..MG-15 verified against source (MG-01 `storagePath` vs `path`, MG-02 `authMe` undocumented though `timezone` is present, MG-05 `priceGroup` has `uiHint: money_paise`, MG-06 `update` holds void/list/delete/non-existent callables). |
| **R-12** | **PARTIAL** | Exports grew +28 in P75 (`74fe76c`) and +8 in P76 (`d75bd12`) to 194 total. Six new forms (`financial_account`, `storage_location`, `stock_transfer`, `account_transfer`, `payment_processing_fee`, `capital_transaction`) WERE added in `generate-flutter-contract.js:55-60` (30 entity forms total), while `check-flutter-contract.js:111` still prints `"23 entity forms"`. No `callables.json` / per-callable API reference exists yet. |
| **R-13** | **CONFIRMED (LIVE PROBE)** | Live TB-13 probe proved `Admin(+org:update)` IS allowed to edit `legalName`, `taxId`, `displayName`, `contactEmail`, `website` and rejected with `FIELD_NOT_EDITABLE` on `showCostToTenant`, `financialYearStartMonth`; `Admin(-org:update)` is rejected with `PERMISSION_DENIED`. The alignment report claiming `admin` was empty was stale (it changed in P75). |
| **R-14** | **CONFIRMED** | `functions/src/test/unit/membershipProvisioning.test.ts:24-31` probes hardcoded `http://127.0.0.1:8080` with 500ms timeout and returns early on failure, making `node --test` report 5/5 PASS and `0 skipped` when emulator is offline. `compensation.test.ts:13-39` also targets `127.0.0.1:9099` in the unit tier. |
| **R-15** | **CONFIRMED** | `scratch/audit-coverage.js:38-48` performs pure substring matching (`content.includes(exp)`), proving only name mention, not outcome assertions. |
| **R-16** | **CONFIRMED** | Decision register already holds `D-1..D-52`; new decisions use next free IDs `D-53..D-60`. Master gaps use `MG-nn`. |
| **R-17** | **PARTIAL** | **Disproved on 11-18:** `test-financial-branch-inventory-scenarios.cjs` ran cleanly to completion in BX0 (`50/50` pass, exit code 0). **Confirmed:** `callable-client.cjs:94-106` still type-sniffs argument order and `auth-personas.cjs:67-80` still falls back silently to Super Admin token for plain strings; no `assertResponseShape` validation exists. |
| **R-18** | **CONFIRMED** | BX0 emulator run printed: `! pubsub: Not starting the pubsub emulator`, `! functions: ... calls to these services from the Functions emulator will affect production: apphosting, database, hosting, pubsub, dataconnect`, `! functions: Your requested "node" version "22" doesn't match your global version "24"`, and ignored both `subscriptionAndUsageSweep` and `requestsSlaAndLifecycleSweep`. `firebase.json` lacks a `pubsub` emulator block. |
| **R-19** | **PARTIAL** | `stockTransfersCancel` now EXISTS (added in `d75bd12`). The other 6 names ("branchesGet", "branchesReactivate", "branchesReconcileCounts", "organizationsReconcileCounts", "outflowsFinalize", "outflowsUpdateDraft") STILL do not exist, plus 4 non-existent names in `generate-flutter-contract.js` ("approvalsDecide", "departmentsDelete", "jobRolesDelete", "stockGetLevels") and 1 called by Flutter ("paymentsGet"). Allowlist has **93 entries** (`DUP-001..DUP-100`, with skipped IDs). Seeded permission catalog seeds 145 concrete keys (`seed-emulator.ts:164`). |
| **R-20** | **PARTIAL** | Reproduced in BX0: unit tests `309/309` (88 suites, +2 new `reportNumbers` tests); `test-financial-branch-inventory-scenarios.cjs` `50/50`; `test-requests-scenarios.cjs` `43/43`; rules `79/79` (Firestore + Storage); `check:data` `0` findings across `61` collections / `942` docs; `verify:status` confirms baseline `run-062d4c4a` has `trusted: false`. Triggers 6 of 8 (2 schedules ignored due to missing pubsub emulator). |

---

## 3. BX0 Reconciliation Tables (TB-1 through TB-15)

### TB-1 — Callables Reconciliation
- **Ground truth (`functions/src/index.ts`):** `194` exports = `186` callables + `6` event triggers + `2` scheduled functions (`8` triggers/schedules total).
- **Gate breakdown (`report-numbers.js`):** `tenant=138`, `platform=29`, `public_or_auth=10`, `mixed_tenant_or_platform=9` (`other=0`).
- **Flutter & Contract comparison:**
  - `docs/flutter-contract/forms/*.json` references `54` valid callables and **4 non-existent callables** ("approvalsDecide", "departmentsDelete", "jobRolesDelete", "stockGetLevels").
  - Flutter `lib/**/*.dart` (read-only scan) references `118` backend callables (`77` of which are NOT in any contract form) plus `"paymentsGet"` which does not exist on the backend.
  - **Action in BX1:** Generate `docs/flutter-contract/callables.json` + `callables/INDEX.md` + `callables/<domain>.md` covering all `186` callables (`186/186`), fix the 4 broken form references, and add forms for user/settings/ownership-transfer callables.

### TB-2 — Collections, Models & Contract Forms Reconciliation
- **Source collections (`source-truth.getCollections()`):** `61` collections (`10` explicit match blocks in `firestore.rules`: `users`, `users/devices`, `memberships`, `membershipBranches`, `notifications`, `subscriptionPlans`, `requests`, `requests/activity`, `counters`, `platformSettings`; plus `51` covered by default-deny `/{document=**}`).
- **Document interfaces (`models.ts`):** `62` `*Doc` interfaces. Naming mismatches: collections without exact `*Doc` name = `requests/activity` (`RequestActivityDoc`), `branchProductStock`, `counters` (`RequestCounterDoc`), `platformCostReconciliation`, `platformSettings` (`PlatformSettingsRequestsDoc`); `*Doc` without direct source collection match = `UserUsageDailyDoc`, `AccountReconciliationDoc`, `ChartOfAccountDoc`.
- **Contract forms:** `30` entity form JSONs (`688` total fields; `1` zero-field form: `approval_request`) + `15` `request-details-*.json` = `45` form JSONs. `scripts/check-flutter-contract.js:111` falsely logs `"23 entity forms"` while iterating `30`.

### TB-3 — Permissions Reconciliation
- `functions/src/constants/permissions.ts`: `147` entries = `145` concrete keys + `2` wildcards (`*`, `platform:*`).
- `seed-emulator.ts:164`: seeds all `145` concrete keys into `permissionCatalog`.
- `docs/flutter-contract/permissions.md`: documents `145/145` concrete keys, but lacks machine-readable `permissions.json`, default-role mapping, and per-key scope notes (e.g. `audit:read_own`).
- Confirmed present: `usage:read`, `usage:read_users`, `audit:view`, `audit:read_own`, `product:view_cost`, `platform:requests_override_blockers`, `platform:requests_configure`.
- Confirmed absent (no aliases): `usage:view`, `audit:read`, `inventory:view_cost`.

### TB-4 — Reason & Error Codes
- `GateReason` enum (`enums.ts:204-226`): `21` codes. `RequestReason` enum (`enums.ts:343-360`): `16` codes.
- Total unique thrown reason codes scanned across `functions/src/**/*.ts`: **`62`**.
- Documented in `docs/flutter-contract/errors.md`: **`24`** (`45` thrown codes undocumented, including `FIELD_NOT_EDITABLE`, `SELF_APPROVAL_FORBIDDEN`, `SUPER_ADMIN_TENANT_FORBIDDEN`, `SUBSCRIPTION_EXPIRED`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_NATURAL_KEY`, `DOCUMENT_IMMUTABLE`, `IMAGE_*`, `SERIALS_*`, etc.).

### TB-5 — State Machines
- Code has **`13`** state machines (`bill`, `outflow`, `delivery`, `return`, `task`, `membership`, `organization`, `subscription`, `request-approval`, `request-work`, `stock-transfer`, `payment-processing-fee`, `approval-decision`).
- `docs/flutter-contract/state-machines.md` documents only **`9`**, omits `subscription`, `stock-transfer`, `payment-processing-fee`, `approval-decision`, cites non-existent `"approvalsDecide"`, and lists `delivery` states (`in_transit`, `cancelled`) that disagree with `DeliveryStatus` (`picked_up`, `out_for_delivery`, `returned`).

### TB-6 — Re-Run of Guards & Emulator Evidence
- `npm --prefix functions run build`: **PASS (0 errors)**.
- `npm --prefix functions run test:unit` (emulator OFF): **309/309 pass, 88 suites, 0 skipped** (includes 2 new `reportNumbers` unit tests; `membershipProvisioning.test.ts` silently skipped 4 live tests).
- Static guards (`test:static`): `check-schema-duplicates`, `check-gate-conformance` (151 callables verified), `check-api-drift` (194/194 exports), `check-test-completeness` (194/194 exports, 61/61 collections), `check-markdown-links` (256 files), `check-openapi-drift` (186 callables, 8 triggers), `check-field-parity` (61 entities, 1441 fields), `check-dead-fields` (0), `check-naming`, `check-shared-schemas`, `check-sensitive`, `check-doc-truth`, `check-doc-counts`, `check-doc-examples`, `check-doc-index` all passed; `generate-doc-index --check` detected our +1 line edit to `run-ledger.md` (expected, regenerated below).
- Emulator batch (`auth,firestore,functions,storage`):
  - `test-financial-branch-inventory-scenarios.cjs`: **50/50 PASS**.
  - `test-requests-scenarios.cjs`: **43/43 PASS** (but see TB-7 gaps).
  - `firestoreRules.test.js` + `storageRules.test.js`: **79/79 PASS**.
  - `check:data` (duplication + same-doc-dupes + raw-field-census): **PASS** (`61` collections, `942` docs, `0` findings).

### TB-7 — Requests Spec Conformance Matrix
| Spec Item | Status | Evidence / Gap |
|---|---|---|
| 15 categories & detail schemas | `IMPLEMENTED` | `schemas.ts:1830-1847`; needs ≥ 45 per-category tests (currently 9 tests bundling 8 categories into 1 test). |
| 7 category groups in `requestsMeta` | `MISSING` | `tenantRequests.ts:100-112` returns flat `availableCategories` without `groups`. |
| Reopen window (`14` days configurable) | `DEVIATES` | `requestsService.ts:208` defaults `14`, `errors.md:40` & `test-requests-scenarios.cjs:60` hardcode `30`; `requestsMeta` omits `reopenWindowDays`. |
| Dark launch default OFF (`FEATURE_DISABLED`) | `DEVIATES (BUG)` | `requestsService.ts:197-212` returns `{ requestsEnabled: false }` WITHOUT throwing `FEATURE_DISABLED` when `platformSettings/requests` doc is missing (MG-36). |
| `requestsSettingsUpdate` / `requestsSettingsGet` | `MISSING` | No callable exists to toggle flag/SLA/limits (Q-B9 accepted). |
| 12 statuses & dual state machine | `IMPLEMENTED` | `requestsStateMachine.test.ts` covers 14 happy/negative cases, NOT exhaustive `(kind × status × action × actor × permission)` grid. |
| 48 scenarios (`RQ-S01..S48`) & 12 flows (`F-RQ1..F-RQ12`) | `DEVIATES` | `test-requests-scenarios.cjs` has 43 unnamed checks; **F-RQ4** (blocker override) and **F-RQ11** (SLA pause accumulation) are absent. |
| Triggers & schedules (T-1..T-7) | `DEVIATES` | Only `onRequestActivityWritten` + `requestsSlaAndLifecycleSweep` exist; sweep ignored by emulator (no `pubsub` in `firebase.json`); Flow 11 ran unattributed outside `RequestContext` with `slaUpdated=0`. |
| Storage attachment spoofing & 5×5MB checks | `PARTIAL` | `storageRules.test.ts` tests size/MIME/cross-user, but server-side request attachment path/MIME/count spoofing tests are absent. |
| Permission migration (`migrate-requests-permissions.cjs`) | `DEVIATES` | Uses `--execute` (not `--apply`), writes no `auditLogs` entry per org, never exercised by an automated test. |

### TB-8 — Claims-Without-Evidence Audit
- Internal notes stripped on every read path (`requestsGet`, `requestsList`, `requestsActivityList`, `requestsCounts`, `requestsMeta`, `included`, triggers): **PARTIAL** (only `requestsActivityList` tested in F-RQ8; full visibility matrix `UNPROVEN`).
- Idempotent notification dispatch (same event twice → 1 delivery): **UNPROVEN** (code exists in `eventTriggers.ts:264-271`, no replay test).
- Automated blocker evaluation & override: **UNPROVEN** (F-RQ4 absent).
- SLA pause/resume accumulation end-to-end: **PARTIAL** (1 unit test in `requestsSchemasAndSla.test.ts:274`; F-RQ11 absent).
- Permission migration idempotency: **UNPROVEN** (never run in any test).
- Rules deny direct client access to `requests/**`: **PROVEN** (`firestoreRules.test.ts:60,67`, 79/79 pass).
- Attachment spoofing rejected server-side: **UNPROVEN**.
- Platform work metering (D-21) for requests sweep: **DISPROVED / DEFECT** (Flow 11 logged `[meter] Firestore operation outside a RequestContext (requests); counted as unattributed`).

### TB-9 — Contract Freshness
- Running `node scripts/generate-flutter-contract.js` on HEAD produced **0 file diffs** (pack matches current generator).
- However, `check-flutter-contract.js` does **NOT** validate callable responses, does **NOT** validate `uiHint` vs `type`, does **NOT** reject 0-field forms (`approval_request`), and does **NOT** validate that form callables exist in `index.ts`.

### TB-10 — Git State
- Before this session: clean working tree at `d75bd12` (`main`). All prior P74/P75/P76 work was already committed on `main`.
- Current uncommitted changes from this BX0 session only: `functions/scripts/report-numbers.js`, `functions/src/test/unit/reportNumbers.test.ts`, `docs/plans/2026-11-18-gap-closure.md`, updated state files (`run-ledger.md`, `open-questions.md`, `decision-register.md`, `handoff.md`, `doc-index.json`, `docs/README.md`).

### TB-11 — Growth Since Prompt 74 (`1f370f8`)
- `1f370f8` (P74, 2026-11-16): `158` exports.
- `74fe76c` (P75, 2026-11-17): `186` exports (+28: `approvalsList`, `approvalsCounts`, `financialAccounts*` (5), `accountTransfers*` (3), `capitalTransactions*` (2), `paymentsRecordFee/ListFees/GetFee`, `storageLocations*` (4), `stockTransfersCreate/Submit/Dispatch/Receive/List/Get`, `reportsGetReceivablesAgeing/PayablesAgeing/CashBankSummary`).
- `d75bd12` (P76, 2026-11-18): `194` exports (+8: `paymentsVerifyFee`, `paymentsDisputeFee`, `paymentsReverseFee`, `ledgerVerify`, `reportsGetTrialBalance`, `stockTransfersCancel`, `stockTransfersResolveDiscrepancy`, `stockVerify`).

### TB-12 — Test Tiers & `check:data`
- `30` unit test files in `functions/src/test/unit/`:
  - `27` pure unit files (including `operationsValidation.test.ts` which only uses `Timestamp` value type).
  - `2` files touching emulator/network: `membershipProvisioning.test.ts` (`ADMIN_SDK`, `NETWORK_FETCH`, silent `if (!emulatorAvailable) return` skip) and `compensation.test.ts` (`EMULATOR_ENV`, live Auth emulator call).
  - `1` file setting emulator env var for safety checks: `seedSafety.test.ts`.
- Definition of "suite": `node --test` counts every `describe(...)` block (nested included) as a suite (`88` suites across `30` files = `309` tests).
- `check:data` (run live in BX0): `61` collections, `942` docs, `0` dangling/cross-tenant refs, `0` duplication findings, `0` same-doc dupes, `0` removed stored fields (`16` collections had 0 docs in the test-suite run).
- `scratch/audit-coverage.js`: substring match (`content.includes(exp)`) across unit & script files; NOT outcome coverage.

### TB-13 — Live Organization Admin Probe (Emulator Ground Truth)
Raw responses captured against live Functions + Firestore emulators (`tb13-org-admin-probe.cjs`):
- `SuperAdmin`: **ALLOW** on `showCostToTenant`, `financialYearStartMonth`, `legalName`, `taxId`, `displayName`, `contactEmail`, `website`.
- `Owner`: **DENY** (`FIELD_NOT_EDITABLE`) on `showCostToTenant`, `financialYearStartMonth`; **ALLOW** on `legalName`, `taxId`, `displayName`, `contactEmail`, `website`.
- `Admin (+org:update)`: **DENY** (`FIELD_NOT_EDITABLE`) on `showCostToTenant`, `financialYearStartMonth`; **ALLOW** on `legalName`, `taxId`, `displayName`, `contactEmail`, `website`.
- `Admin (-org:update)`: **DENY** (`PERMISSION_DENIED`: `"org:update" is required`) on every field.
- **Read-side finding (C-2 #8 / MG-37):** `organizationsGet` (`organizations.ts:745`) returns `bankAccounts: data.bankAccounts ?? []` **unmasked** to any caller holding `org:view` (including `role_employee` and `role_cashier`).

### TB-14 — Domain Lists, Phantom Names & CRUD Gaps
- **Still non-existent (6 from R-19):** "branchesGet", "branchesReactivate", "branchesReconcileCounts", "organizationsReconcileCounts", "outflowsFinalize", "outflowsUpdateDraft". (`stockTransfersCancel` now exists.)
- **Non-existent in `generate-flutter-contract.js` (4):** "approvalsDecide", "departmentsDelete", "jobRolesDelete", "stockGetLevels".
- **Non-existent called by Flutter (1):** "paymentsGet".
- **Entities with `list` but no `get`:** `branches`, `payments`, `returns`, `capitalTransactions`, `roles`, `departments`, `jobRoles`, `teams`, `categories`, `units`, `recurringExpenses`, `tasks`. (Tracked for Prompts 77/78 where needed.)

### TB-15 — Finance Scenario Suite
- `test-financial-branch-inventory-scenarios.cjs` executed to completion: **50/50 checks PASS** (exit code 0).
- Remaining harness defects for BX4 TT-9: `callable-client.cjs:94-106` (type-sniffing dual signature), `auth-personas.cjs:67-80` (silent Super Admin fallback), no syntax-check gate on `*.cjs`, no `assertResponseShape` validation.

---

## 4. New Master Gaps Identified in BX0 (MG-36 .. MG-41)

| MG | Source | Gap | Target |
|---|---|---|---|
| **MG-36** | BX0 TB-7 | `assertRequestsFeatureEnabled()` (`requestsService.ts:197-212`) returns `{ requestsEnabled: false }` without throwing `FEATURE_DISABLED` when `platformSettings/requests` is absent (fails open on fresh DB). | BX3 |
| **MG-37** | BX0 TB-13 | `organizationsGet` (`organizations.ts:745`) returns unmasked `bankAccounts` to every `org:view` caller (including cashier/employee). Per Q-B2, account numbers must be masked to last 4 in audit logs and API responses. | BX2 |
| **MG-38** | BX0 TB-1/2 | `generate-flutter-contract.js` references 4 non-existent callables ("approvalsDecide", "departmentsDelete", "jobRolesDelete", "stockGetLevels"); `check-flutter-contract.js:111` hardcodes `"23 entity forms"`. | BX1 |
| **MG-39** | BX0 R-18 | `firebase.json` lacks a `"pubsub"` emulator entry, causing both scheduled functions (`subscriptionAndUsageSweep`, `requestsSlaAndLifecycleSweep`) to be ignored by the emulator. | BX4 |
| **MG-40** | BX0 CP-2 | `locations.ts` privacy findings: `latestLocations` has no TTL and is not cleared after delivery/shift end; `locationsRecordPing`/`GetLatest`/`GetHistory` use role-name checks (`isOwnerOrAdmin`) that bypass consent on ping; `allowPlatformSuperAdmin: true` permits Super Admin to read tenant employee coordinates; `location:manage` permission is unused. | Document in BX4; fix in future prompt |
| **MG-41** | Owner Q-B7 | **Work-session location tracking (REGISTERED BACKEND GAP — DO NOT BUILD IN THIS PROMPT):** Sales/delivery employee starts a work session (job start); location pings recorded only between session start and end; after session, manager reads ordered route (coordinate list), distance, total working time, idle/stop time, and breaks; coordinates retained for configurable months then auto-deleted; covers consent, privacy, and cost (ping interval, batching). No map package added. | Future prompt |

---

## 5. OWNER APPROVAL GATE 1 — C-1 Organization Field Classification Table (Q-B1 & Q-B2)

> **Action requested before BX2 code is written:** Please confirm or edit the table below.
> Per Q-B1 & Q-B2 answers: **zero role-name checks** (`roleId === "role_org_owner"` is removed); access is governed strictly by **permission codes** (Owner role holds `*` / these permissions by default, never checked by role name). Every change to an S0 or S1 field is audited with before/after values; `bankAccounts` account numbers and `taxId` are masked to the last 4 in audit logs, and `bankAccounts` account numbers are masked to the last 4 in `organizationsGet` responses.

### 5.1 Editable Fields in `UpdateOrganizationSchema` (21 fields; `organizationId` & `branchId` are context keys)

| Field | Today (SA / Owner / Admin+`org:update`) | Proposed Class | Required Permission | Audit / Masking | Read Today (`organizationsGet`) |
|---|---|---|---|---|---|
| `name` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `businessType` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `businessCategory` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `financialYearStartMonth` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `moduleToggles` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `salesChannels` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `timezone` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | Any `org:view` |
| `showCostToTenant` | SA only | **S0** | Super Admin (`isSuperAdmin`) | Audited (before/after) | SA only (stripped on tenant payload) |
| `legalName` | SA / Owner / Admin | **S1** | `org:manage_legal_profile` (Owner default) | Audited (before/after) | Any `org:view` |
| `taxId` | SA / Owner / Admin | **S1** | `org:manage_legal_profile` (Owner default) | Audited (before/after, masked last 4 in audit) | Any `org:view` |
| `bankAccounts` | SA / Owner only | **S1** | `org:manage_bank_details` (Owner default; NOT `org:update`) | Audited (before/after, masked last 4 in audit **and** API responses) | Any `org:view` (**unmasked today — MG-37!**) |
| `displayName` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `image` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `uploadId` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after, converts to `image`) | N/A (write-only input) |
| `website` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `contactEmail` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `contactPhone` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `contact` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `contacts` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `addresses` | SA / Owner / Admin | **S2** | `org:update` | Audited (before/after) | Any `org:view` |
| `settings` | SA / Owner / Admin | **S2** | `org:update` (Note: `settings.approvals` & `settings.businessConfig` live here — advise if you want `settings.approvals` or numbering prefixes split into S1!) | Audited (before/after) | Any `org:view` |

### 5.2 Non-`organizationsUpdate` Organization Fields (Documented as S0 / Dedicated Callables)
- `country`, `currency`, `currencyDecimals`, `minorUnitName`, `minorUnitNamePlural`, `currencySymbol`, `taxRegimeCode`: Set at creation (`organizationsCreate`, Super Admin only); **S0 immutable / Super Admin only** (cannot be mutated via `organizationsUpdate`).
- `planId`, `subscriptionStatus`, `subscriptionStartsAt`, `subscriptionExpiresAt`, `graceDays`: **S0** via `organizationsSetSubscription` (Super Admin only; tenants file `plan_change` request).
- `usageLimitOverrides`: **S0** via `usageUpdateLimits` (Super Admin only; tenants file `limit_increase` request).
- `status`: **S0** via `organizationsDeactivate` / `organizationsReactivate`.
- `ownerUserId`, `ownerStatus`: **S0** via `organizationsTransferOwnership` / `organizationsProvisionUser`.
- `sharingPolicies`: Controlled via dedicated `sharingPoliciesUpdate`.

> **Read-side question on `bankAccounts` (C-2 #8):** Today `organizationsGet` returns unmasked `bankAccounts` to every `org:view` user. Per your Q-B2 answer (*"account numbers masked to the last 4 in the audit log and in API responses"*), we plan to mask `bankAccounts[].accountNumber` to `****XXXX` (last 4 digits) in `organizationsGet` for all non-`org:manage_bank_details` callers (or for all callers in `organizationsGet` — please confirm whether even holders of `org:manage_bank_details` see masked last-4 in `organizationsGet`!).

---

## 6. OWNER APPROVAL GATE 2 — Duplication Allowlist Review `DUP-074 .. DUP-100` (Q-B10)

> **Action requested before changing `functions/scripts/duplication-allowlist.json`:**
> The allowlist currently has `93` entries (up to `DUP-100`; IDs `DUP-082`, `DUP-086`, `DUP-087` are unused gaps from earlier removals). Below are all 24 entries added in Prompt 74 (`DUP-074..081`) and Prompts 75–76 (`DUP-083..100`) with our proposed choice (**REFACTOR** vs **KEEP + DECISION ROW**):

### 6.1 Prompt 74 Entries (`DUP-074 .. DUP-081` — 8 entries)

| ID | Collection.Field | Kind | Proposed Choice | One-Line Justification / Refactor Plan |
|---|---|---|---|---|
| `DUP-074` | `requests.requester.roleLabel` | `OWNED` (R2) | **KEEP + DECISION ROW** | Point-in-time historical snapshot of requester's role title when ticket was filed (role may change later). |
| `DUP-075` | `requests.attachments` | `BOUNDED_ARRAY` (cap 5) | **KEEP + DECISION ROW** | Owned attachment list strictly capped at 5 by `RequestAttachmentSchema` (A-11). |
| `DUP-076` | `requests.labels` | `BOUNDED_ARRAY` (cap 10) | **KEEP + DECISION ROW** | Owned tag array strictly capped at 10 by `CreateRequestSchema`. |
| `DUP-077` | `requests.organizationName` | `OWNED` (D1) | **REFACTOR** | Remove stored `organizationName` copy and hydrate organization name at read time in `requestsInboxList`/`requestsGet` (R1 one fact, one home). |
| `DUP-078` | `requests.requestId` | `R4` (D7 self-ID) | **REFACTOR** | Document ID is already `doc.id`; remove redundant stored `requestId` field (or hydrate `requestId: doc.id` at read time). |
| `DUP-079` | `activity.author.roleLabel` | `OWNED` (R2) | **KEEP + DECISION ROW** | Immutable timeline snapshot of author's role title at comment/transition time. |
| `DUP-080` | `activity.attachments` | `BOUNDED_ARRAY` (cap 5) | **KEEP + DECISION ROW** | Owned attachment list strictly capped at 5 by `RequestAttachmentSchema` (A-11). |
| `DUP-081` | `activity.activityId` | `R4` (D7 self-ID) | **REFACTOR** | Document ID is already `doc.id`; hydrate `activityId: doc.id` at read time instead of storing self-ID. |

### 6.2 Prompt 75 & 76 Entries (`DUP-083 .. DUP-100` — 16 entries; IDs `082, 086, 087` unused)

| ID | Collection.Field | Kind | Proposed Choice | One-Line Justification / Refactor Plan |
|---|---|---|---|---|
| `DUP-083` | `accountTransactions.balanceAfter` | `R4` | **KEEP + DECISION ROW** | Immutable running balance ledger fact enforced atomically (D-47); reconciled by `ledgerVerify`. |
| `DUP-084` | `stockTransfers.items` | `BOUNDED_ARRAY` (cap 200) | **KEEP + DECISION ROW** | Owned transfer line items capped at 200 in `CreateStockTransferSchema`. |
| `DUP-085` | `accountReconciliations.reconciledTransactionIds` | `BOUNDED_ARRAY` (cap 500) | **KEEP + DECISION ROW** | Server-written reconciliation statement line set capped at 500 per period. |
| `DUP-088` | `payments.allocations` | `BOUNDED_ARRAY` (cap 200) | **KEEP + DECISION ROW** | Owned multi-invoice allocation breakdown capped at 200 in `CreatePaymentSchema`. |
| `DUP-089` | `paymentProcessingFees.grossAmount` | `R2` | **KEEP + DECISION ROW** | Frozen legal snapshot of source payment gross amount at fee recording time (D-51). |
| `DUP-090` | `bills.splitPayments` | `BOUNDED_ARRAY` (cap 5) | **KEEP + DECISION ROW** | Owned tender split array capped at 5 in `CreateBillSchema`. |
| `DUP-091` | `outflows.splitPayments` | `BOUNDED_ARRAY` (cap 5) | **KEEP + DECISION ROW** | Owned tender split array capped at 5 in `CreateOutflowSchema`. |
| `DUP-092` | `financialAccounts.assignedBranchIds` | `BOUNDED_ARRAY` (cap 100) | **KEEP + DECISION ROW** | NOTE: Despite `DERIVED` list in `check-schema-duplicates.js:49`, `assignedBranchIds` is NOT derivable — it is the **authoritative** branch-access allowlist configured on the account (capped at 100). Keep as `BOUNDED_ARRAY` with decision row (and clarify why it is authoritative, not derived). |
| `DUP-093` | `journalEntries.lines` | `BOUNDED_ARRAY` (cap 20) | **KEEP + DECISION ROW** | Server-written balanced double-entry journal lines capped at 20. |
| `DUP-094` | `stockTransfers.items.baseQuantity` | `R2` | **KEEP + DECISION ROW** | Frozen base quantity computed from unit `conversionFactor` at transfer creation time (product conversion factor may later change). |
| `DUP-095` | `stockTransfers.items.serialNumbers` | `BOUNDED_ARRAY` (cap 500) | **KEEP + DECISION ROW** | Owned serial tracking list on transfer lines capped at 500. |
| `DUP-096..098` | `taxRegimes.{rates,slabs,slabs.hsnPrefixes}` | `BOUNDED_ARRAY` (caps 20/20/50) | **KEEP + DECISION ROW** | Server-written canonical tax regime configuration arrays bounded per regime. |
| `DUP-099..100` | `{bills,outflows}.taxSnapshot.breakdown` | `BOUNDED_ARRAY` (cap 20) | **KEEP + DECISION ROW** | Immutable issued-document tax slab breakdown frozen at issue time (R2). |

---

## 7. CP-2 Live Location Tracking Inventory (Facts for Prompt 79's `docs/features/locations.md`)

- **Callables (`functions/src/callables/locations.ts`):**
  1. `locationsRecordPing` — Permission: `location:ping`; requires `memberData.locationTrackingEnabled === true` (currently bypassed if role is `owner`/`admin`); rate limit: 5 seconds (`MIN_PING_INTERVAL_MS = 5000`); writes `latestLocations/{orgId}_{membershipId}` and `locationPings/{orgId}_{membershipId}_{ts}`.
  2. `locationsGetLatest` — Permission: `location:view_own` or `location:view_all`; `location:view_all` (or owner/admin) reads up to 50 org members; `location:view_own` reads own doc only.
  3. `locationsGetHistory` — Permission: `location:view_own` or `location:view_all`; reads `locationPings` filtered by `organizationId`, `membershipId`, `from`, `to` (default limit 50).
- **Retention & Privacy Findings (reported without modifying code per CP-2):**
  - `locationPings` sets native Firestore TTL `expiresAt = createdAt + 7 days`.
  - `latestLocations` has **no TTL** and is **never cleared** when a delivery completes or shift ends.
  - `allowPlatformSuperAdmin: true` is set on all 3 callables, permitting Super Admin access to tenant employee live coordinates.
  - Role-name checks (`isOwnerOrAdmin`) bypass consent on `locationsRecordPing` and grant `canViewAll` on read paths.
  - `location:manage` permission exists in `permissions.ts` but is not enforced anywhere.
  - **Deferred UI & New Gap:** Flutter UI deferred (no map package); work-session tracking registered as **MG-41**.
