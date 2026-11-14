# Trado Architectural Decision Register (D-1 .. D-35)

Generated at: 2026-11-14T05:30:00.000Z  
Total decisions: **35** (All Active)  

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

## Answered Business Decisions (A-n)

| Question ID | Decision / Answer | Resolved Date | Applied In |
|---|---|---|---|
| **A-01** | Operations limits support both `warn_only` and `hard_block` modes with distinct error codes. | 2026-11-13 | `usageMetering.ts` |
| **A-02** | `audit:read_own` restricts queries strictly to `actorUid == callerUid` with `ownActivityOnly: true`. | 2026-11-13 | `history.ts` |
| **A-03** | `AGENTS.md` is canonical for all tools; `CLAUDE.md` contains `@AGENTS.md` thin adapter. | 2026-11-14 | `AGENTS.md` |
