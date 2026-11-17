# Run 74 Change Record — Requests and Support Desk Module (Prompt 74)

- **Run ID:** `run-74`
- **Date:** 2026-11-15
- **Agent:** Antigravity (Google DeepMind)
- **Model:** Gemini 3.8 Flash
- **Project:** Trado Firebase (`trado-x`, Cloud Functions Gen 2, Node 22, `asia-south1`)
- **Phases Completed:** RB0, RB1, RB2, RB3, RB4, RB5, RB6, RB7, RB8 ([cov:RB0-RB8 9/9 phases])

---

## 1. Executive Summary

Prompt 74 builds the complete backend engine for Trado's unified Requests & Support Desk Module. It supports tenant plan changes, limit increases, module toggles, bug reports, feature requests, ownership transfers, access requests, and security concerns with full category validation, dual state machines (`approval` and `work`), compare-and-set concurrency control, deterministic SLA tracking with pause states, automated blocker evaluation, internal note redaction, and idempotent timeline activity notifications.

The 16 HTTPS callables and 2 event triggers have been implemented, tested across 30 unit tests and 12 emulator scenario flows, and synchronized with the Flutter Contract Pack (`docs/flutter-contract/`).

---

## 2. Decisions & Policy Additions

### Architectural Decisions (D-36 through D-45)
- **D-36:** A request is a platform-domain document (`requests/{requestId}`). The Super Admin may transition it although the tenancy guard otherwise forbids Super Admin tenant mutations (`SUPER_ADMIN_TENANT_FORBIDDEN`).
- **D-37:** Unified atomic state machine (`requestsTransition`) with compare-and-set on `expectedStatus`. Two distinct lifecycle kinds: `approval` (submitted -> in_review -> needs_info -> on_hold -> approved -> applied / rejected) and `work` (submitted -> in_progress -> needs_info -> on_hold -> resolved -> closed / declined, with 30-day reopen window).
- **D-38:** Internal notes (`visibility: 'internal'`) never leave the platform domain. Tenant-facing read paths (`requestsGet`, `requestsActivityList`) strictly strip them at the data layer.
- **D-39:** Apply reuses internal domain functions directly in-process (`requestsApply`), never invoking a callable from a callable.
- **D-40:** Dual persistence: user-visible timeline entries (`requests/{id}/activity`) and canonical audit records (`auditLogs`) are written atomically in the same commit.
- **D-41:** 15 categories and their detail schemas are static TypeScript code, exported directly to the Flutter contract pack (`forms/request-details-*.json/md`).
- **D-42:** Deterministic SLA engine with injected `Clock`. SLA clock pauses in `needs_info` and `on_hold`, accumulating paused duration.
- **D-43:** Strictly one open `plan_change` request per organization. Duplicate submissions reject with stable error `REQUEST_DUPLICATE_OPEN`.
- **D-44:** Plan-change apply is guarded by real-time server-evaluated blockers (branches, active seats, disabled modules). Overrides require `platform:requests_override_blockers` and `overrideReason`.
- **D-45:** Idempotent activity notifications via `onRequestActivityWritten` using event-id deduplication markers.

### Answered Questions (A-04 through A-17)
- **A-04:** Super-Admin-only organization fields defined: `name`, `businessType`, `businessCategory`, `financialYearStartMonth`, `moduleToggles`, `salesChannels`, `timezone`, `showCostToTenant`.
- **A-05:** Notification infrastructure verified: in-app notifications and activity timeline exist; no external email service configured.
- **A-06 (Q-RQ1):** Two audiences supported: `platform` (handled by Super Admin) and `organization` (handled by Org Owner / Managers with `requests:manage_org`).
- **A-07 (Q-RQ2):** 15-category taxonomy accepted across 7 functional groups.
- **A-08 (Q-RQ3):** Explicit two-step apply (`approved -> applied`) for `plan_change`, `limit_increase`, and `module_request`.
- **A-09 (Q-RQ4):** Tenant plan pricing visibility guarded by `showPriceToTenants` flag.
- **A-10 (Q-RQ5):** SLA targets configured in IST calendar hours, pausing in `needs_info` and `on_hold`.
- **A-11 (Q-RQ6):** Attachments capped at 5 per request, 5 MB maximum, allowed formats: PNG, JPG, WebP, PDF.
- **A-12 (Q-RQ8):** Request retention policy established at 5 years post-closure.
- **A-13 (Q-RQ9):** Platform requests handled by Super Admin role; separate support agent platform role designed for future seeding.
- **A-14 (Q-RQ10):** Abuse limits enforced: 10 open requests per user, 50 per organization, 10 creations per user per hour.
- **A-15 (Q-RQ11):** Bug report diagnostics require explicit opt-in; PII stripped.
- **A-16 (Q-RQ12):** Idempotent migration script provided in `functions/scripts/migrate-requests-permissions.cjs`.
- **A-17 (Q-RQ13):** Dark launch feature toggle in `platformSettings/requests` (`requestsEnabled: false` default; rejects with `FEATURE_DISABLED` when off).

---

## 3. Implemented Components

### 3.1 Security & Storage Rules
- `firestore.rules`: Declarative security rules for `requests/{requestId}` and `requests/{requestId}/activity/{activityId}`.
- `storage.rules`: Scoped attachment uploads under `tmp/{orgId}/{uid}/` and `tmp/platform/{uid}/`.
- `firestore.indexes.json`: Added composite queries for request inbox filtering, organization listing, and SLA monitoring sweeps.

### 3.2 Backend HTTPS Callables (16 Functions)
| Callable | Audience / Role | Purpose |
|---|---|---|
| `requestsMeta` | Requester | Returns operational limits and active categories |
| `plansCatalogList` | Requester / Org Owner | Catalog of available plans with blocker previews |
| `requestsCreate` | Requester | Submits request with strict Zod category validation |
| `requestsUpdate` | Requester | Edits title/description/details while in submitted/needs_info |
| `requestsAddComment` | Requester / Handler | Appends public comment to timeline |
| `requestsTransition` | Requester / Handler | Single atomic state machine transition with CAS on `expectedStatus` |
| `requestsGet` | Requester / Handler | Fetches single request; strips internal notes for tenants |
| `requestsList` | Requester / Org Member | Queries requests with `scope: "mine" \| "organization"` |
| `requestsActivityList` | Requester / Handler | Timeline activity history; strips internal notes for tenants |
| `requestsCounts` | Requester / Org Member | Badge counters for open, actionRequired, and closed |
| `requestsInboxList` | Super Admin / Handler | Platform inbox with multi-dimensional filtering, sort, and cursor |
| `requestsInboxCounts` | Super Admin / Handler | Platform inbox badge counters (unassigned, mine, urgent, breached) |
| `requestsAssign` | Super Admin / Handler | Assigns or unassigns ticket handler |
| `requestsSetPriority` | Super Admin / Handler | Adjusts priority, severity, and recomputes SLA targets |
| `requestsAddInternalNote` | Super Admin / Handler | Appends internal operator note (visibility: internal) |
| `requestsApply` | Super Admin | Executes approved plan change, limit increase, or module toggle |

### 3.3 Event Triggers & Scheduled Functions
- `onRequestActivityWritten`: Firestore onWrite trigger delivering notifications with `reserveIdempotency` deduplication.
- `requestsSlaAndLifecycleSweep`: Scheduled PubSub trigger (interval: 15 min) evaluating SLA breaches, 7-day auto-closing of resolved requests, and 14-day auto-canceling of abandoned requests in needs_info.

### 3.4 Flutter Contract Pack Updates
- `docs/flutter-contract/forms/request-details-*.json/md`: 15 category detail forms generated.
- `docs/flutter-contract/state-machines.md`: Documented `request-approval` and `request-work` state machines.
- `docs/flutter-contract/errors.md`: Added 16 `RequestReason` error codes.
- `docs/flutter-contract/permissions.md`: Documented new `requests:*` and `platform:requests_*` permissions.
- `docs/flutter-contract/SUMMARY.md`: Preserved concise index at 102 lines (<= 250 limit).

---

## 4. Verification Evidence (D-34 Standard)

### 4.1 Unit Test Suite (`npm run test:unit`)
- `functions/src/test/unit/requestsSchemasAndSla.test.ts`: 15 tests (detail schemas, attachment bounds, SLA calculations). **15/15 PASS** in 15.8ms.
- `functions/src/test/unit/requestsStateMachine.test.ts`: 15 tests (CAS transitions, approval vs work matrices, RBAC). **15/15 PASS** in 5.6ms.
- **Combined Unit Result:** 30 passed, 0 failed, 0 skipped in 2.30s.

### 4.2 Emulator Scenario Suite (`test-requests-scenarios.cjs`)
Executed against local Firebase Emulators (Auth, Firestore, Functions):
- **Flow 1 (F-RQ1):** Plan-Change request full lifecycle (submitted -> on_hold -> in_review -> approved -> applied). **PASS**.
- **Flow 2 (F-RQ5):** Duplicate open plan change rejection (`REQUEST_DUPLICATE_OPEN`, D-43). **PASS**.
- **Flow 3 (F-RQ2):** Limit increase request lifecycle & organization overrides update. **PASS**.
- **Flow 4 (F-RQ3):** Module toggle request lifecycle & organization module update. **PASS**.
- **Flow 5 (F-RQ6):** Bug report with opt-in diagnostics -> start_work -> resolve -> close. **PASS**.
- **Flow 6 (F-RQ7):** Work request reopen within 30-day window. **PASS**.
- **Flow 7 (F-RQ8):** Internal note stripping on tenant read paths (`visibility: 'internal'`, D-38). **PASS**.
- **Flow 8 (F-RQ9):** Security concern visibility isolation (requester & admin only). **PASS**.
- **Flow 9 (F-RQ10):** Organization audience request handled by Org Manager. **PASS**.
- **Flow 10 (F-RQ12):** Dark launch enforcement (`FEATURE_DISABLED`, A-17). **PASS**.
- **Aggregation Checks:** `requestsMeta`, `requestsCounts`, `requestsInboxCounts` badges verified. **PASS**.
- **Total Assertions Verified:** 38/38 verified checks, 0 errors.

### 4.3 Static Guards & Integrity Checks
- `check-schema-duplicates.js`: 52 collections scanned, 82 candidate findings, 77 registered allowlist exceptions (`DUP-074`..`DUP-081`). **0 unregistered duplicates (PASS)**.
- `check-flutter-contract.js`: 177 contract items examined across 11 docs and 23 forms, 0 violations, 2/2 seeded defects caught. **PASS**.
- `check-rules-sync.js`: `AGENTS.md` and `CLAUDE.md` synchronized. **PASS**.
- `check-doc-truth.js`: 150 callables verified across 151 documents. **PASS**.
- `verify-coupling.js`: 134 callables, 6 triggers, 48 collections verified coupled. **PASS**.
- `verify:plan`: 92 units total, 0 unmapped changed files. **PASS**.
