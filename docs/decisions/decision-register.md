# Trado Architectural Decision Register (D-1 .. D-52)

Generated at: 2026-11-16T13:30:00.000Z  
Total decisions: **52** (All Active)  

| ID | Title | Prompt | Status | Enforced By | Description |
|---|---|---|---|---|---|
| **D-1** | **Super Admin Onboarding Scope Only** | 60 | `active` | `functions/src/services/contextResolver.ts` | Super Admin provisions Owner and Admin users only during onboarding; all other tenant mutations remain forbidden. |
| **D-2** | **Owner Provisioning Default** | 60 | `active` | `functions/src/services/organizationProvisioning.ts` | createOwner defaults to true; false produces an organization in explicit owner-pending state. |
| **D-3** | **Server-Generated Credentials** | 60 | `active` | `functions/src/services/organizationProvisioning.ts` | Initial credentials are server-generated temporary passwords; forced reset on first sign-in. |
| **D-4** | **Default Party Type** | 60 | `active` | `functions/src/validation/schemas.ts` | partyType defaults to 'organization' across customers, vendors, and schemas. |
| **D-5** | **ImageRef Path Storage** | 60 | `active` | `scripts/check-stored-url-fields.js` | Images stored as ImageRef metadata paths; URLs never stored, computed at read time. |
| **D-6** | **Single Image Policy** | 60 | `active` | `docs/reference/image-policy.md` | Image standards defined in one policy file; rules, Flutter, and docs derived from it. |
| **D-7** | **Pre-Release Atomic Migration** | 62 | `active` | `scripts/check-naming.js` | Field renames and removals done atomically with data migration; no compatibility aliases. |
| **D-8** | **Field Addition Rubric** | 62 | `active` | `scripts/field-glossary.json` | Fields added only if passing reference catalog rubric; others registered in deferral ledger. |
| **D-9** | **Issue-Time Legal Enforcement** | 62 | `active` | `functions/src/callables/bills.ts` | Statutory fields (e.g. buyer tax ID) enforced at document issue time, not party creation. |
| **D-10** | **Sensitive Field Masking by Default** | 62 | `active` | `scripts/check-sensitive.js` | Sensitive attributes (bank account, national tax ID) masked by default; unmasked only with permission. |
| **D-11** | **No Silently Ignored Fields** | 63 | `active` | `functions/src/validation/schemas.ts` | Disallowed or unknown client fields fail with stable error reasons; never silently dropped. |
| **D-12** | **One Response Shape per Callable** | 63 | `active` | `functions/src/validation/schemas.ts` | No duplicate representations of entities inside a single response payload. |
| **D-13** | **Every Fact Has One Home** | 63 | `active` | `scripts/check-doc-counts.js` | Architecture counts, lists of callables, and field tables exist in generated files only. |
| **D-14** | **Schema as Single Field Source** | 63 | `active` | `scripts/check-doc-examples.js` | Every field has description and example in the schema; docs and OpenAPI generated from it. |
| **D-15** | **Single Stored Image Field** | 64 | `active` | `scripts/check-stored-url-fields.js` | Single stored field is 'image' of type ImageRef; photoUrl/avatarUrl removed from database. |
| **D-16** | **No 'any' on Write/Response Paths** | 64 | `active` | `functions/scripts/check-no-any-writes.js` | Zero 'any' casts on database writes or response hydration paths. |
| **D-17** | **Guards Never Loosened** | 64 | `active` | `scripts/check-schema-duplicates.js` | Guards never narrowed to make tests pass; registered exclusions require explicit justification. |
| **D-18** | **Unified Response Convention** | 64 | `active` | `functions/src/callables/usage.ts` | Single entity returned under entity name; lists returned as { items, count, totalCount, nextCursor, included }. |
| **D-19** | **Computed Denominators** | 65 | `active` | `scripts/coverage-engine.js` | Coverage denominators computed from source code truth, never from handwritten lists. |
| **D-20** | **Change-Impact Test System** | 65 | `active` | `scripts/verify-impact.js` | Input hash baseline determines affected units; unimpacted units reported as skipped since baseline. |
| **D-21** | **Universal Attribution** | 66 | `active` | `functions/src/services/requestContext.ts` | Every operation attributed to (organization|platform, user|system, source). Super Admin acts on platform scope. |
| **D-22** | **Cost Derived, Never Stored** | 66 | `active` | `functions/src/services/costReconciliation.ts` | Rollups store operation quantities. Cost computed at read time using versioned rate card. |
| **D-23** | **Single Recording Points** | 66 | `active` | `scripts/check-recording-points.js` | One recording point for metering (requestRecorder) and one for audit (auditRecorder) in wrapper layer. |
| **D-24** | **Unified Audit Collection** | 66 | `active` | `functions/src/services/auditRecorder.ts` | auditLogs is the sole audit collection; changeHistory merged; entity history filtered by entityId. |
| **D-25** | **Tenant Cost Visibility Control** | 66 | `active` | `functions/src/callables/usage.ts` | Tenants see operation counts and limits; platform cost visible only if showCostToTenant is enabled. |
| **D-26** | **Untrusted Client Metadata** | 66 | `active` | `functions/src/services/requestContext.ts` | Token and server clock authoritative; client _meta feeds diagnostic analytics only. |
| **D-27** | **Privacy by Default** | 66 | `active` | `scripts/check-sensitive.js` | IP addresses truncated (/24 and /48); secrets dropped; 24-month retention enforced by TTL. |
| **D-28** | **Evidence Ladder** | 67 | `active` | `scripts/audit/extract-obligations.js` | Status assigned by evidence levels L0-L4 only; documentation text never counts as evidence. |
| **D-29** | **Frozen As-Found Baseline** | 67 | `active` | `docs/audit/as-found/` | Phase A as-found snapshot is permanently frozen; ongoing progress tracked as delta. |
| **D-30** | **Change Coupling Enforcement** | 67 | `active` | `scripts/verify-coupling.js` | Source changes require coupled updates to tests, docs, OpenAPI, and manifests before completion. |
| **D-31** | **Generated Contract Suites & Hand-Written Scenarios** | 67 | `active` | `docs/process/testing-standard.md` | Contract tests generated from schemas and registry; complex domain scenarios hand-written. |
| **D-32** | **Ask, Don't Guess Protocol** | 67 | `active` | `docs/process/ask-protocol.md` | Unclear business semantics asked interactively; answers recorded in register and never re-asked. |
| **D-33** | **Single Canonical Rule File** | 67 | `active` | `scripts/check-rules-sync.js` | AGENTS.md is the single authoritative rule file; CLAUDE.md is a thin adapter referencing it. |
| **D-34** | **A Zero is a Claim** | 68 | `active` | `scripts/check-rules-sync.js` | Every "0 findings / violations" result must report examined count, counted D-17 exclusions with reasons, and the seeded defect proving the check can fail; otherwise UNVERIFIED. |
| **D-35** | **Flutter Contract Generated** | 69 | `active` | `scripts/check-flutter-contract.js` | The Flutter contract is generated, never hand-written, from schemas, registry, and catalogs; freshness enforced by coupling guard and emulator execution. |
| **D-36** | **Platform-Domain Request Exemption** | 74 | `active` | `functions/src/services/contextResolver.ts` | A request is a platform-domain document, not tenant data: Super Admin may transition it despite SUPER_ADMIN_TENANT_FORBIDDEN gate rule. |
| **D-37** | **Atomic State Machine (Compare-and-Set)** | 74 | `active` | `functions/src/services/requestsService.ts` | One state machine, two kinds (approval/work). Every transition is compare-and-set on expectedStatus; single entry point requestsTransition. |
| **D-38** | **Internal Notes Never Leave Platform** | 74 | `active` | `functions/src/services/requestsService.ts` | Internal notes (visibility: internal) are stripped by the data access layer for all tenant read paths. |
| **D-39** | **Shared Internal Service for Apply** | 74 | `active` | `functions/src/callables/requests.ts` | Apply invokes shared internal domain functions in one commit with request status change and audit entry; never a callable calling a callable. |
| **D-40** | **Two Histories, One Commit** | 74 | `active` | `functions/src/services/auditRecorder.ts` | User-visible timeline (requests/{id}/activity) and canonical audit entry (auditLogs) are both committed in the same database commit. |
| **D-41** | **Static Category Detail Schemas** | 74 | `active` | `functions/src/validation/schemas.ts` | Request categories and detail schemas are static code exported to Flutter contract pack; no dynamic server-driven forms. |
| **D-42** | **Deterministic SLA Clock with Pauses** | 74 | `active` | `functions/src/services/requestsService.ts` | SLA clock pauses in needs_info and on_hold; arithmetic calculated via injected Clock interface for test repeatability. |
| **D-43** | **One Open Plan Change per Tenant** | 74 | `active` | `functions/src/services/requestsService.ts` | An organization may have at most one open plan_change request; duplicates fail with REQUEST_DUPLICATE_OPEN. |
| **D-44** | **Server-Computed Blocker Guards** | 74 | `active` | `functions/src/services/requestsService.ts` | Plan-change apply is guarded by server-computed blockers (usage, branches, staff, modules); override requires explicit permission and reason. |
| **D-45** | **Idempotent Notification Dispatch** | 74 | `active` | `functions/src/triggers/eventTriggers.ts` | Trigger dispatch writes delivery marker keyed by event ID in same transaction, guaranteeing at-most-once delivery under retry. |
| **D-46** | **Operational Financial Accounts Separation** | 75 | `active` | `functions/src/services/ledgerService.ts` | FB-5: Legal/invoice display bank accounts (OrganizationDoc.bankAccounts) remain distinct from live operational cash/bank ledger entities (financialAccounts) and append-only accountTransactions. |
| **D-47** | **Atomic Account Ledger Balance Formula** | 75 | `active` | `functions/src/services/ledgerService.ts` | Double-entry running balance balanceAfter = currentBalance ± amount enforced transactionally via two-phase helper; direct manual balance overwrite is impossible. |
| **D-48** | **Storage Location & Warehouse Hierarchy** | 75 | `active` | `functions/src/callables/storageLocations.ts` | Warehouses, sales counters, transit locations, and stockyards modeled as distinct storage locations per branch or central facility. |
| **D-49** | **Inter-Branch Stock Transfer Isolation** | 75 | `active` | `functions/src/callables/stockTransfers.ts` | In-transit stock held in dedicated state; source stock deducted atomically upon dispatch and added upon receipt without duplicating master product records or triggering sales tax/AR/AP. |
| **D-50** | **Unified Approvals Inbox & Decision Router** | 75 | `active` | `functions/src/callables/approvals.ts` | Single maker-checker decision router documentsDecide handles all domains; unified approvalsList and approvalsCounts query pending items across all operational collections. |
| **D-51** | **Payment Processing Charges Linked Accounting** | 75 | `active` | `functions/src/callables/paymentFees.ts` | Merchant processing charges recorded as operating expenses linked to source payment/bill without reducing gross sales or customer receivable settlement; deducts from clearing/financial account to match net bank deposit. |
| **D-52** | **Capital & Owner Investment Accounting** | 75 | `active` | `functions/src/callables/financialAccounts.ts` | Capital contributions and drawings adjust cash/bank ledger balances via double-entry without polluting sales revenue, purchases, or customer receivable accounts. |

## Answered Business Decisions (A-n)

| Question ID | Decision / Answer | Resolved Date | Applied In |
|---|---|---|---|
| **A-01** | Operations limits support both `warn_only` and `hard_block` modes with distinct error codes. | 2026-11-13 | `usageMetering.ts` |
| **A-02** | `audit:read_own` restricts queries strictly to `actorUid == callerUid` with `ownActivityOnly: true`. | 2026-11-13 | `history.ts` |
| **A-03** | `AGENTS.md` is canonical for all tools; `CLAUDE.md` contains `@AGENTS.md` thin adapter. | 2026-11-14 | `AGENTS.md` |
| **A-04** | Super-Admin-only organization fields for `org_profile_change`: `name`, `businessType`, `businessCategory`, `financialYearStartMonth`, `moduleToggles`, `salesChannels`, `timezone`, `showCostToTenant` (derived from `ORGANIZATION_FIELD_POLICY` in `functions/src/callables/organizations.ts:65-76`). | 2026-11-15 | `schemas.ts`, `requests.ts` |
| **A-05** | Notification mechanism: In-app timeline (`requests/{id}/activity`), unread indicators, in-app notification records (`notifications` collection), and FCM push via existing `notificationService`. No external email service exists; email integration deferred until owner provisions a provider. | 2026-11-15 | `eventTriggers.ts`, `notificationService.ts` |
| **A-06** | Request audiences: Both `platform` (handled by Super Admin) and `organization` (handled by tenant Owner/Manager) audiences supported in single `requests` collection. | 2026-11-15 | `models.ts`, `schemas.ts`, `requests.ts` |
| **A-07** | Taxonomy: 15 categories across 7 groups with designated approval/work kinds per Appendix A. | 2026-11-15 | `models.ts`, `schemas.ts` |
| **A-08** | Apply model: Explicit 2nd step (`approved -> applied`) for automated categories (`plan_change`, `limit_increase`, `module_request`); manual apply record for other approvals. | 2026-11-15 | `requests.ts`, `requestsService.ts` |
| **A-09** | Plan price visibility: Plan prices hidden from tenant catalog unless `showPriceToTenants === true` on plan record. | 2026-11-15 | `plans.ts`, `schemas.ts` |
| **A-10** | SLA targets: Appendix C calendar hours (IST), clock paused in `needs_info` and `on_hold`. | 2026-11-15 | `requestsService.ts`, `scheduled.ts` |
| **A-11** | Attachments: Images (JPEG, PNG, WebP) and PDF, up to 5 per request, max 5 MB each. | 2026-11-15 | `storage.rules`, `schemas.ts` |
| **A-12** | Request retention: 5 years post closure, no client hard-delete callable. | 2026-11-15 | `requestsService.ts` |
| **A-13** | Platform handlers: Super Admin handles platform requests in v1; support agent permissions separated but role unseeded. | 2026-11-15 | `permissions.ts`, `catalogs.ts` |
| **A-14** | Volume limits: 10 open/user, 50/org, 10/user/hr, 1 open plan_change/org enforced in transaction. | 2026-11-15 | `requestsService.ts` |
| **A-15** | Bug report diagnostics: Strictly opt-in (`diagnosticsOptIn: true`) without payloads or PII. | 2026-11-15 | `schemas.ts` |
| **A-16** | Role migration: Idempotent script with `--dry-run` default updating system roles in `roles` collection. | 2026-11-15 | `migrate-requests-permissions.ts` |
| **A-17** | Dark launch: `platformSettings/requests.requestsEnabled` defaults to `false`; callables return `FEATURE_DISABLED` while off. | 2026-11-15 | `requests.ts`, `requestsService.ts` |
