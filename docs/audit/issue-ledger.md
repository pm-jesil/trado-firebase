# Trado Firebase Backend — Master Issue Ledger

**Project**: Trado Firebase Backend (`trado-x`)  
**Region**: `asia-south1`  
**Execution Boundary**: Local Firebase Emulator Suite (127.0.0.1)  
**Last Updated**: 2026-11-07  

---

## Issue Classification Taxonomy

- **Confirmed Defect**: Verifiable logic, authorization, security, or data integrity bug in the code.
- **Count / Doc Mismatch**: Discrepancy between code exports, data model paths, OpenAPI spec, and documentation.
- **Test Gap**: Missing negative test case, unverified edge case, or incomplete test fixture.
- **Intentional Design**: Architecture rule or product decision (e.g. deferred multi-org switching).
- **Cloud-Only Requirement**: Production feature requiring cloud deployment (e.g. live App Check, IAM least-privilege, cloud backups).
- **Unverified Claim**: Assertion in previous conversational reports that was not backed by actual code.

---

## Active & Resolved Issue Ledger

| ID | Title / Finding | Category | Severity | Impact | Files Affected | Associated Tests | Status |
|---|---|---|---|---|---|---|---|
| **ISSUE-01** | Subgroup count/math discrepancy in prior reports | Count / Doc Mismatch | MEDIUM | Prior conversational summaries miscounted subcategories (e.g. RBAC 9 vs 12, Catalog 8 vs 10, Queries 18 vs 25). | `docs/audit/callable-and-trigger-inventory.md`, `scripts/generate-source-inventory.js` | AST programmatic inventory generator | **RESOLVED** |
| **ISSUE-02** | Duplicate root `devices` row in `docs/data-model.md` | Count / Doc Mismatch | MEDIUM | Confused table listing 43 vs 44 concrete collections; root `devices` did not exist. Real store is subcollection `users/{uid}/devices/{deviceId}`. | `docs/data-model.md` | `check-test-completeness.js --test` | **RESOLVED** |
| **ISSUE-03** | Phantom trigger names in conversational history | Unverified Claim | LOW | Misleading documentation referencing `auditLogWritten`, `notificationDispatched`, `billFinalizedTrigger`, `stockMovementWritten`. Authentic triggers are 4 since inception. | `docs/audit/callable-and-trigger-inventory.md`, `functions/src/triggers/eventTriggers.ts` | `test-event-triggers.cjs` | **RESOLVED** |
| **ISSUE-04** | Super Admin privilege escalation via Firestore profile | Confirmed Defect | CRITICAL | If Firestore `users/{uid}.accountType` was `"super_admin"`, platform rights were granted even without custom claims. | `functions/src/services/sessionContext.ts`, `functions/src/services/tenantContext.ts` | `authSecurityAndRevocation.test.ts` (Tests 5, 6) | **RESOLVED** |
| **ISSUE-05** | Multi-organization switching product deferral | Intentional Design | HIGH | Organization switching is deferred; ambiguous multi-org membership without primary must safely deny tenant operations. | `functions/src/services/sessionContext.ts`, `docs/decisions-log.md` | `authSecurityAndRevocation.test.ts` (Tests 7, 8) | **RESOLVED** |
| **ISSUE-06** | In-flight ID token revocation / inactive tenant access | Confirmed Defect | HIGH | Stale 1-hour ID token could execute calls after user deactivation, membership revocation, org suspension, or branch deactivation. | `functions/src/services/tenantContext.ts` | `authSecurityAndRevocation.test.ts` (Tests 9, 10, 11, 12) | **RESOLVED** |
| **ISSUE-07** | Client context forgery in operational business APIs | Confirmed Defect | HIGH | Callers could supply forged `organizationId` or `branchId` in business mutations (`billsCreate`, `outflowsCreate`). | `functions/src/validation/schemas.ts`, `functions/src/callables/*.ts` | `contextResolver.test.ts`, `authSecurityAndRevocation.test.ts` | **RESOLVED** |
| **ISSUE-08** | TOCTOU concurrency and idempotent trigger side-effects | Intentional Design / Defect | MEDIUM | Critical transactions must atomically update balances, WAC, and ledgers; triggers must not double-apply side-effects. | `functions/src/callables/bills.ts`, `functions/src/callables/outflows.ts`, `functions/src/triggers/eventTriggers.ts` | `financialAndCoreServices.test.ts`, `test-event-triggers.cjs` | **RESOLVED** |
| **ISSUE-09** | Negative test personas missing in emulator seed tool | Test Gap | MEDIUM | Seeder lacked explicit deactivated user, revoked membership, suspended organization, and inactive branch for negative testing. | `functions/src/scripts/seed-emulator.ts` | `test-seed-repeatability.cjs`, `seed-emulator.ts` | **RESOLVED** |
| **ISSUE-10** | Static completeness checker test coverage verification | Test Gap | LOW | Needed self-test assertions proving checker rejects comments, skipped tests, compatibility wrappers, and stale manifests. | `scripts/check-test-completeness.js` | `node scripts/check-test-completeness.js --test` | **RESOLVED** |
| **ISSUE-11** | Cloud-only feature boundary specification | Cloud-Only Requirement | INFO | App Check enforcement, Cloud IAM least-privilege, live FCM, and PITR backups require live Cloud deployment. | `docs/production-readiness.md` | Documented non-emulator gates | **RESOLVED** |
| **ISSUE-12** | Core business callables had no permission or plan-module check | Confirmed Defect | CRITICAL | `verifyTenantAccess` checked membership only: any active member (base `role_employee`) could create products/bills/expenses, adjust stock, record payments, list vendors (live probe). | `callables/{bills,outflows,products,customers,vendors,payments,stock,returns,deliveries,reconciliation}.ts`, `services/contextResolver.ts` (old `services/tenantContext.ts` deleted) | `test-governance-flagship.cjs` §1 (487 gate denials), `check-gate-conformance.js` | **RESOLVED** |
| **ISSUE-13** | Super Admin could perform tenant mutations | Confirmed Defect | CRITICAL | With an `organizationId`, Super Admin created bills, adjusted stock, mutated tasks (gate returned `["*"]`). | `services/contextResolver.ts` | §1 `SUPER_ADMIN_TENANT_FORBIDDEN` on every mutation | **RESOLVED** |
| **ISSUE-14** | `employeesUpdate` / `employeesDeactivate` open to any member, cross-tenant | Confirmed Defect | CRITICAL | Any active member could change any membership (own `roleId` → Owner, own permission overrides, status) including other organizations' memberships; deactivate the Owner. | `callables/employees.ts` | §5 anti-escalation, cross-tenant, Owner protection | **RESOLVED** |
| **ISSUE-15** | Department / job-role update without any membership check | Confirmed Defect | HIGH | Any authenticated user could rename another organization's department/job role. Units/categories/teams: any member could create/update. | `callables/{departments,jobRoles,units,categories,teams}.ts` | §1 (create callables), catalog gate | **RESOLVED** |
| **ISSUE-16** | `paymentsCreate` updated referenced documents of other tenants; overpayment allowed | Confirmed Defect | HIGH | Referenced bill/outflow/customer/vendor were not org-checked; amount could exceed balance; payments accepted on voided/pending docs. | `callables/payments.ts` | §9 payment against voided bill | **RESOLVED** |
| **ISSUE-17** | `membership.isPrimary` treated as Owner/Admin | Confirmed Defect | HIGH | Every single-org employee was "owner/admin" in tasks, locations (incl. bypassing location-tracking consent, viewing all staff locations), usage limits and staff report. | `callables/{tasks,locations,usage,reports}.ts` | §1, ops suite | **RESOLVED** |
| **ISSUE-18** | Direct client reads bypassed every callable control | Confirmed Defect | HIGH | Rules let any member read bills, outflows, payments, products (cost), vendors/customers (balances), P&L summaries and all staff locations; `isOrgMember` ignored membership status. | `firestore.rules` | `firestoreRules.test.ts` (13/13) incl. inactive-member test | **RESOLVED** (D-04) |
| **ISSUE-19** | Cross-branch leak in customer/vendor lists | Confirmed Defect | MEDIUM | Visibility filtered by an unvalidated client `branchId`. Bills/outflows/payments lists were org-wide for every member. | `callables/{customers,vendors,bills,outflows,payments,returns,stock,deliveries}.ts` | §8 data scope | **RESOLVED** |
| **ISSUE-20** | No subscription dates/status; expiry never enforced | Missing Feature | CRITICAL | R-13 absent: no `subscriptionExpiresAt`, no denial after expiry, no lifecycle callable, no reminders. | `services/subscription.ts`, `contextResolver.ts`, `organizations.ts` (`organizationsSetSubscription`), `sessionContext.ts`, `triggers/scheduled.ts` | §1, §2, §13, `subscriptionAndUsage.test.ts` | **RESOLVED** |
| **ISSUE-21** | Usage limits never enforced; server never metered itself; client could decrement usage | Confirmed Defect | HIGH | Only `usageRecordClientMetric` wrote usage (accepting negative values); `hard_block` was a stub; no weekly window; single hot doc. | `services/usageMetering.ts`, `contextResolver.ts`, `callables/usage.ts` | §6 weekly hard block, concurrency; unit tests | **RESOLVED** (D-01, D-03) |
| **ISSUE-22** | Stock lost on documents with the same product on two lines | Confirmed Defect | HIGH | `prepareStockChangesInTxn` read the same starting balance per line; later write overwrote earlier (mixed box+piece invoice deducted once). | `services/stockEngine.ts` | §11 mixed-unit invoice 60 → 43 | **RESOLVED** |
| **ISSUE-23** | Write-offs missing from P&L | Confirmed Defect | HIGH | Damage/waste adjustments never reached the P&L (Business 1 net −1,083 omitted ₹104). Movements now carry `unitCostSnapshot`; P&L reports `inventoryWriteOff`. | `stockEngine.ts`, `reports.ts`, `accounting-oracle.cjs` | Simulation: actual = oracle = −1,187; §10 ₹180 | **RESOLVED** |
| **ISSUE-24** | No unit conversion (box ↔ piece) | Missing Feature | HIGH | Purchase/sale quantities were added to stock in the line unit. Now `alternateUnits` with factors; lines freeze `conversionFactor`/`baseQuantity`; WAC per base unit. | `stockEngine.ts` (`resolveUnitConversion`), `bills.ts`, `outflows.ts`, `returns.ts` | §11 | **RESOLVED** |
| **ISSUE-25** | No bill/outflow lifecycle (approve/void/cancel) | Missing Feature | HIGH | Only create/list/get/finalize existed. Added `billsApprove`, `billsVoid`, `outflowsApprove`, `outflowsVoid` with reversal entries (stock, party ledger, payments), reason and actor. | `bills.ts`, `outflows.ts` | §7, §9 | **RESOLVED** |
| **ISSUE-26** | No maker–checker | Missing Feature | HIGH | Policy on `organizations.settings.approvals` (off by default) + forced approval for discount-ceiling / credit-limit breaches; small-org auto-approve fallback. | `services/approvals.ts` | §7 | **RESOLVED** (all 5 modules: sales, purchases, expenses, returns, stock adjustments) |
| **ISSUE-27** | No data scope (self/team/branch/org) | Missing Feature | HIGH | `resolveDataScope` + `applyDataScope`; per-membership `dataScopes` override. | `contextResolver.ts`, all list/get callables | §8 | **RESOLVED** |
| **ISSUE-28** | No field-level write/read control | Confirmed Defect | HIGH | Owner could change `businessType`/modules; unknown fields silently stripped; cost/balance fields returned to everyone. | `organizations.ts` (`ORGANIZATION_FIELD_POLICY`), strict update schemas, `services/redaction.ts` | §4 field matrix | **RESOLVED** (strict on all update schemas touched; create schemas of products/teams strict; other create schemas still strip — OPEN low) |
| **ISSUE-29** | Seat limit race and reactivation bypass | Confirmed Defect | MEDIUM | Count query outside a transaction; reactivation via `status: active` unchecked. Now transactional `activeEmployeeCount`. | `employees.ts` | §3 concurrent creation → exactly one success | **RESOLVED** |
| **ISSUE-30** | `billsCreate` / `productsUpdate` broke when organizationId was derived | Confirmed Defect | MEDIUM | Compared product org to `input.organizationId` (undefined → every product rejected); barcode locks keyed `undefined_<code>`. | `bills.ts`, `products.ts` | live probe, catalog suite | **RESOLVED** |
| **ISSUE-31** | Test suites overwrote shared system roles and plans | Test Gap | MEDIUM | Retail e2e replaced `role_admin`, `role_employee`, `plan_enterprise`; persona helper sent fields the schema silently stripped (personas never got intended permissions). | `test-retail-lifecycle.e2e.js`, `helpers/auth-personas.cjs` | full regression | **RESOLVED** |
| **ISSUE-32** | No vendor/customer statement, day-wise purchases, total-outflow, price or change history | Missing Feature | MEDIUM | Added `reportsGetPartyStatement`, `reportsGetOutflowSummary`, `productsGetPriceHistory`, `auditGetEntityHistory`; audit entries carry field diffs. | `reports.ts`, `products.ts`, `history.ts`, `services/audit.ts` | §10, §11, §13 | **RESOLVED** |
| **ISSUE-33** | Sales orders deducted stock immediately; delivery could not complete a sale | Missing Feature | MEDIUM | Orders now reserve (`allocatedStock`); delivery `delivered` finalizes the order with collected payment; riders act only on assigned deliveries; transition table. | `bills.ts`, `deliveries.ts`, `stockEngine.ts` | ops suite | **RESOLVED** (partial-quantity delivery: **OPEN**) |
| **ISSUE-34** | Business-type catalog incomplete; no sales channels | Missing Feature | LOW | Added verticals (jewellery, kitchenware, gifts, restaurant, services/repair), trade models (manufacturer B2B, POS counter), `salesChannels`; Super-Admin-only edit. Per-type default modules/units: **OPEN**. | `enums.ts`, `organizations.ts` | §4 | **PARTIAL** |
| **ISSUE-35** | Serial/IMEI registry and uniqueness | Missing Feature | MEDIUM | Serials are captured on purchase and sale lines (expressible), but no per-unit registry prevents selling the same IMEI twice. | `bills.ts`, `outflows.ts` | §10, §12 | **OPEN** |

---

## Detailed Root Cause & Resolution Ledger

### ISSUE-01: Subgroup Count & Math Discrepancy
- **Evidence**: Previous conversational reports labeled subgroups with numbers like `(9)` or `(18)` while listing 12 or 25 names under those headers.
- **Root Cause**: Manual, conversational text drafting without programmatic AST verification of subgroups.
- **Resolution**: Build `scripts/generate-source-inventory.js` to derive category and subgroup counts directly from AST exports, enforcing mathematical parity ($40 = 12 + 10 + 7 + 4 + 7$, $37 = 25 + 9 + 3$).

### ISSUE-02: Duplicate Root `devices` Row
- **Evidence**: `docs/data-model.md` listed row 6 as `devices/{deviceId}` (root), whereas row 5 listed `users/{uid}/devices/{deviceId}` (subcollection).
- **Root Cause**: Accidental duplicate entry in table during documentation drafting.
- **Resolution**: Removed duplicate row 6. Reconciled inventory to 44 concrete collections (42 root + 2 subcollections).

### ISSUE-04: Super Admin Platform Authority Escalation
- **Evidence**: `sessionContext.ts` evaluated `userData.accountType === "super_admin"` as an authorization fallback.
- **Root Cause**: Convenience fallback from earlier prototype.
- **Resolution**: Exclusively check `userRecord.customClaims?.isSuperAdmin === true`. Enforced `role: null`, `permissions: []` (zero tenant permissions), `platformPermissions: ["platform:*"]`, `organizations: []`, `branches: []`.

### ISSUE-05: Multi-Organization Switching Deferral
- **Evidence**: Multiple active memberships without unambiguous primary could lead to undefined context selection.
- **Root Cause**: Organization-switching callable is intentionally deferred product decision.
- **Resolution**: When caller has multiple active memberships and no unambiguous primary, return `contextStatus: "organization_selection_required"`, `primaryOrganization: null`, `role: null`, and `permissions: []`. Tenant operations are safely denied until an active organization is selected.

### ISSUE-06: In-Flight ID Token Revocation
- **Evidence**: Firebase Auth ID tokens remain cryptographically valid for up to 60 minutes after user or membership deactivation.
- **Root Cause**: Stateless callable token verification did not check real-time Firestore account status.
- **Resolution**: The single gate `resolveRequestContext` (`functions/src/services/contextResolver.ts`) reads user, membership, organization, branch and branch assignment live on every call (batched `getAll`), so deactivation and subscription expiry apply to in-flight ID tokens immediately. (The former `verifyTenantAccess`/`resolveBranchContext` helpers were removed — see ISSUE-12.)

### ISSUE-09: Negative Test Personas Missing in Emulator Seed Tool
- **Evidence**: Emulator seed script only created happy-path active personas; manual and automated negative testing required ad-hoc data creation.
- **Root Cause**: Seed tool was originally designed only for happy-path developer workflows.
- **Resolution**: Extended `functions/src/scripts/seed-emulator.ts` with four dedicated negative personas/entities: `inactive@apexwholesale.local` (inactive user), `deactivated_member@apexwholesale.local` (revoked membership), `branch_inactive` (disabled branch), and `org_suspended_sample` with `suspended_org_user@apexwholesale.local` (suspended tenant). Added verification test `test-seed-repeatability.cjs` proving idempotency without document duplication across repeated seed executions.

---

## Master Audit 2026-11-07 — Flow, Schema & Gate Audit (R-01 … R-33)

Evidence is source (`file`), the live emulator probe run before any change, and the suites
`functions/scripts/test-governance-flagship.cjs` (§ numbers below), `functions/src/test/unit/subscriptionAndUsage.test.ts`,
`functions/src/test/rules/firestoreRules.test.ts`, `scripts/check-gate-conformance.js` and the two-business simulation.

### Phase A live probe (before fixes)

| Actor | Call | Before | After |
|---|---|---|---|
| base employee (`org:view`, `employee:view`) | productsCreate, billsCreate, outflowsCreate, stockAdjust(−5), paymentsCreate(₹999), vendorsList | **ALLOWED** | `PERMISSION_DENIED` |
| Super Admin + organizationId | billsCreate, stockAdjust | **ALLOWED** | `SUPER_ADMIN_TENANT_FORBIDDEN` |
| Owner | organizationsUpdate `businessType` | **ALLOWED** | `FIELD_NOT_EDITABLE` |
| Owner | organizationsUpdate `planId` (unknown field) | silently stripped | `INVALID_ARGUMENT` (strict) |
| Owner (org derived from token) | billsCreate without organizationId | rejected own product | succeeds |

### Gate: order, reads, latency

Single mechanism `resolveRequestContext` (`functions/src/services/contextResolver.ts`); every tenant callable declares `requiredPermission` (static check `scripts/check-gate-conformance.js`, matrix generated into `docs/audit/callable-and-trigger-inventory.md`).
Order: authenticated → user active → membership active → organization active → subscription (server time) → plan module → org/branch module toggle → permission (deny wins) → branch exists/active/assigned → usage limit → business logic. Each failure carries a stable `details.reason` (`GateReason` enum) and a `[REASON]` message prefix.

| | Old (`verifyTenantAccess` + `resolveBranchContext` + callable re-read of org) | New gate |
|---|---|---|
| Firestore reads, hot path (billsCreate/outflowsCreate/productsCreate/list) | 7 reads in 4–5 sequential round trips; no role/plan read, so no permission or plan check | 6 reads in 2 batched `getAll` round trips (user, org, membership, branch, membershipBranch; then role) + plan from 30 s per-instance cache (7 on cache miss) |
| Writes added | 0 | 1 sharded usage-counter write, issued in parallel with read #2 (no extra round trip) |
| Usage check | none | 0 extra reads unless a hard_block limit exists; then a cached snapshot (10 s TTL; fresh when ≥ 90 %) of 8–16 shard docs |

Latency was not benchmarked against production; on the local emulator all suites run at their previous pace (no measurable regression in wall-clock per suite). `scripts/benchmark-resolver.cjs` remains the tool for a real measurement.

### Requirement traceability

| Req | Verdict before | Verdict now | Evidence |
|---|---|---|---|
| R-01 audit every flow/feature/schema | — | DONE | This section, callable matrix (generated), schema matrix in `docs/data-model.md`, ISSUE-12…35 |
| R-02 roles Super Admin/Owner/Admin/Manager/Employee | PARTIAL | DONE | system roles + "manager" = membership with reportees (team scope); §5, §8 |
| R-03 token → uid → live user/membership → permissions; field read/write control | WRONG (no permission check on 10 modules) | DONE | gate; `services/redaction.ts`; strict update schemas; §1, §4 |
| R-04 Super Admin platform-only | WRONG (ISSUE-13) | DONE | §1 SA denial on every mutation; SA keeps read-only support + platform callables |
| R-05 business type at creation, catalog | PARTIAL (existed, Owner-editable, gaps) | PARTIAL | ISSUE-34: catalog + salesChannels done; per-type defaults OPEN |
| R-06 plan max employees on create/reactivate | WRONG (race, reactivation bypass) | DONE | §3 |
| R-07 plan feature gates per module | WRONG (never applied) | DONE | module map: billing, sales, inventory, expenses, purchases, customers, reports, staff, returns, delivery, tasks, employee_tracking; §1 `MODULE_NOT_IN_PLAN` |
| R-08 branch count limit | EXISTS & correct (transactional) | DONE | `branches.ts`; simulation 4th branch rejected |
| R-09 weekly + daily/monthly usage, strict | MISSING (ISSUE-21) | DONE (D-01/D-03) | §6; unit tests |
| R-10 sensitive org fields | WRONG | DONE | `ORGANIZATION_FIELD_POLICY`; §4 (10 owner fields, 6 SA fields, Admin none) |
| R-11 plan check then permission check on every op | MISSING | DONE | gate order |
| R-12 fast common reusable checks | PARTIAL (two divergent gates) | DONE | one gate, batched reads, plan cache |
| R-13 subscription start/expiry, no ops after expiry | MISSING | DONE | §1 `SUBSCRIPTION_EXPIRED`/`SUSPENDED`, §2 authMe `subscription_expired`, renewal mid-session, ±1 s unit tests, sweep §13 |
| R-14 organizationId + branchId from context | PARTIAL (unvalidated client branch in lists) | DONE | gate-derived ids; `check-gate-conformance` rejects client org ids |
| R-15 rich product fields + units | PARTIAL | DONE | alternate units, weight, dimensions, images, warranty, jewellery, variants |
| R-16 bicycle + kitchenware flagship | MISSING | DONE (suite) | §10, §11; seed profiles for both: OPEN (not added to `seed-emulator.ts`) |
| R-17 trackStock, maxDiscount, returnable, created/updated by | PARTIAL | DONE | `updatedBy` on all mutable models; change history in `auditLogs.changes`; maxDiscount §7, returnable §11 |
| R-18 product scope all/this branch | MISSING (products) | DONE | `visibilityScope`, `ownerBranchId` on products |
| R-19 weight/size/images | MISSING | DONE (fields) | Storage per-org byte accounting OPEN |
| R-20 price history | MISSING | DONE | `productsGetPriceHistory` §11 |
| R-21 purchase ↔ stock sync | PARTIAL (untracked items wrote movements; no units) | DONE | untracked never touch stock; box→piece §11 |
| R-22 purchase record fields, payments, gateway-ready | PARTIAL | DONE | bill-level discount, payee types, invoice uniqueness, multiple payments, `gateway` block (no card numbers) |
| R-23 damage on receipt / later | PARTIAL | DONE | `damagedQuantity` §10; reason codes on adjustments |
| R-24 vendor credit/day-wise/statement | MISSING | DONE | `reportsGetPartyStatement` §10 |
| R-25 expenses incl. employee-linked | PARTIAL | DONE | `payeeMembershipId`, `expense:view_sensitive`, category id; managed category master/recurring: OPEN (categories collection reused, recurring not implemented) |
| R-26 total outflow = purchases + expenses, no double count | MISSING | DONE | `reportsGetOutflowSummary` §13 |
| R-27 sales lifecycle incl. order → delivery | PARTIAL | DONE (partial-qty delivery OPEN) | reservation, delivery finalization, transitions |
| R-28 sale create/update/delete tracked | PARTIAL | DONE | createdBy/updatedBy, void actor/reason, audit diffs; draft edit callable OPEN |
| R-29 maker–checker | MISSING | DONE for all 5 modules | §7; returns (`decideReturn`) & stock adjustments (`decideStockAdjustment`) verified complete |
| R-30 staff duty tracking | PARTIAL (sales only) | DONE | `reportsGetStaffActivity` across 8 activity types, scoped; §8 |
| R-31 reporting, teams, managers | PARTIAL (no cycle check, anyone edits teams) | DONE | `teamsAssignMember`, leader rules, cycle prevention §5 |
| R-32 small org without deadlock | — | DONE | §7 approvals off by default; auto-approve fallback when no other approver |
| R-33 fix + second pass | — | DONE | Phase C below |

### Hypotheses (a)–(o)

| # | Hypothesis | Result |
|---|---|---|
| a | no businessType | **Refuted** — `businessType` + `businessCategory` existed; catalog gaps + Owner-editable (fixed) |
| b | no update/cancel/approve/delete for bills & outflows | **Confirmed** — approve/void added; draft edit still OPEN |
| c | write-offs not in P&L | **Confirmed** — fixed (−1,083 → −1,187, oracle matches) |
| d | no weekly usage window | **Confirmed** — added |
| e | hot-document contention on usage | **Confirmed** (single daily doc per org) — 8-shard counters |
| f | direct client reads never metered | **Confirmed** — business collections now callable-only (D-04) |
| g | no scheduled functions | **Confirmed** — `subscriptionAndUsageSweep` |
| h | no vendor/customer statement / day-wise view | **Confirmed** — added |
| i | list/get return full documents | **Confirmed** — redaction by permission |
| j | no data scope | **Confirmed** — added |
| k | no maker–checker | **Confirmed** — added (3 of 5 modules) |
| l | no per-entity change history | **Confirmed** — audit diffs + `auditGetEntityHistory` |
| m | no price history | **Confirmed** — derived, no duplicated data |
| n | no box-of-12 conversions | **Confirmed** — added |
| o | mixed ISO-string vs Timestamp dates | **Confirmed, kept by decision D-06** — all business dates are server-set ISO-8601 UTC strings; Timestamps only for TTL (`locationPings.expiresAt`) |

### Decisions (defaults implemented; change by configuration)

| ID | Decision | Default |
|---|---|---|
| D-01 | Usage enforcement | `hard_block` blocks only the breached metric's class (writes→mutations, reads→reads, invocations→all, pings→pings) at `hardThresholdPercent` (100 %) of daily/weekly/monthly; exempt: payments, voids, approvals, delivery completion, org/usage views. `warn_only` default per metric; `soft_throttle` behaves as warn (true throttling OPEN). |
| D-02 | Starter plan contents | purchases **on** (a stocked shop must record stock-in); sales orders, delivery, tasks, employee tracking off |
| D-03 | Strictness | Server counts operations (not billable documents) for gated calls. Overshoot bound: exact within an instance; across instances ≤ calls completed by other instances within the 10 s snapshot TTL (fresh read at ≥ 90 %); §6 measured 0 overshoot on 12 concurrent writes. Metering-write failure is logged, never fails the user call. |
| D-04 | Read-metering strategy | Option C hybrid: business/financial collections callable-only in rules; small reference docs (organization, branches, roles, catalogs, stockBalances, own notifications/tasks/location) stay direct. |
| D-05 | Expiry & grace | Expiry = end of expiry date in org timezone (default Asia/Kolkata); `graceDays` default 0; default new subscription = 30-day trial; legacy orgs without fields = allowed (`legacy_unset`). |
| D-06 | Date type | ISO-8601 UTC strings, server-set (no client time); Timestamp only for TTL fields. Migrating to Timestamps would break every range query and the Flutter contract. |
| D-07 | Org field policy | Super Admin: identity/entitlement/billing fields; Owner: profile, tax, bank, contact, images, approvals; Admin: none. |
| D-08 | Data-scope defaults | Owner/Admin organization; holder of `*:view_all`-type permission branch; has reportees team (recursive); else self. Override per membership via `dataScopes`. |
| D-09 | Approval defaults | Off; when on, all listed modules unless set false, optional `amountThreshold`; discount-ceiling and credit-limit breaches force approval even when off; auto-approve with audit note when no other active Owner/Admin exists. |
| D-10 | Variant model | One product per sellable variant (own SKU/stock/price) sharing `variantGroupId` + `variantAttributes`. |
| D-11 | Seats | Active memberships excluding the Owner; total = admin + staff seats. Downgrade keeps data, reports `overLimit`, blocks new creation. |
| D-12 | Purchase cost basis | WAC uses line unit price ÷ conversion factor (pre-discount, as before); landed-cost/discount allocation OPEN. |

### Flow matrix

| Flow | Callables | Exists now | Still missing |
|---|---|---|---|
| Org onboarding & subscription | organizationsCreate, organizationsSetSubscription, organizationsUpdate, authMe | trial/active/grace/expired/suspended, reminders, field policy | per-business-type default modules/units |
| Employee lifecycle | employeesCreate/Update/Deactivate/List, teams* | seats, tiers, cycles, team leaders | — |
| Catalog | products*, units*, categories*, productsGetPriceHistory | units, variants, scope, history | Storage byte accounting, serial registry |
| Purchase | outflowsCreate/Approve/Void, paymentsCreate, reportsGetPartyStatement | damaged receipt, invoice uniqueness, statements | draft purchase edit, vendor debit-note document |
| Expense | outflowsCreate (expense) | payee types, sensitive employee expenses | recurring expenses |
| Sale / order / delivery | billsCreate/Finalize/Approve/Void, deliveries* | reservation, delivery finalization, credit limit, max discount | partial-quantity delivery, draft edit |
| Returns / waste | returnsCreate, stockAdjust | returnable/window, reason codes, write-off P&L, approvals for returns & stock adjustments | return void |
| Payments | paymentsCreate/List/Void | tenant checks, overpayment guard, gateway fields, void with reversal | — |
| Reporting | reports*, auditGetEntityHistory | P&L with write-offs, outflow totals, staff activity | — |
| Usage | gate metering, usageGetLimits, usageUpdateLimits, sweep | weekly, sharded, hard_block | Storage-trigger byte metering |

### Phase C — second pass

Each R-01…R-33 above was re-read against the code and the suites. Items marked OPEN are honest gaps, also listed in ISSUE-26/28/33/34/35 and the flow matrix.

### Phase C Final Verification (2026-11-08)

All 4 target enhancements from Phase B have been implemented and independently verified:

1. **Organization Contacts (DUP-063)**: Structured contact persons list (`OrganizationContact[]`) bounded at 20 items, with single-primary enforcement and automatic audit logging on updates. Verified in flagship governance suite.
2. **Platform Financial Aggregation**: `reportsGetPlatformOverview` aggregates total platform revenue, outflows, and net cash flow across active organizations while maintaining strict `where("organizationId", "==", orgId)` query conformance. Verified in analytics platform suite.
3. **Audit Stream Querying**: `EntityHistorySchema` expanded to 18 entity types with optional `entityId` supporting full organizational audit streams. Verified in flagship governance suite.
4. **Tenant Isolation Invariant**: Platform Super Admin isolation strictly verified against all 71 tenant mutation callables (`SUPER_ADMIN_TENANT_FORBIDDEN`). Super Admin operations must proceed via dedicated platform callables or under tenant membership.

All 8 automated test suites pass with 100% success against local emulators:
- Static checks: 0 schema duplicates, 0 API drift, 100% export & collection coverage.
- Unit tests: 141 passed (41 suites, 0 failed).
- Security rules: 54 passed (0 failed).
- Event triggers: 5 triggers passed (0 failed).
- Flagship governance: 95 checks passed (0 failed).
- Analytics platform: 20 callables passed (0 failed).
- E2E suites: 10/10 retail lifecycle + 15/15 multi-branch isolation passed (0 failed).
- Two-business simulation: 100% match against mathematical accounting oracle (0 failed).
- Seed repeatability: 0 collection growth on repeat seed, 0 dangling references.
