# Trado Engineering Handoff (Appendix E)

- **Date:** 2026-11-18
- **Last Active Agent:** antigravity (Gemini 3.8 Flash)
- **Prompt:** Hybrid Prompt 76 — Trado Firebase Backend (1 of 4): Close Open Gaps [cov:BX0-BX6] — SIGN-OFF (`run-77-final`)
- **Current State:** **PHASES BX0, BX1, BX2, BX3, BX4, BX5, BX6 [cov:7/7] DELIVERED, EMULATOR-VERIFIED & STATICALLY AUDITED.**
- **Delivered Across Prompt 76:**
  1. **BX0 Truth Reconciliation:**
     - Created `functions/scripts/report-numbers.js` and `reportNumbers.test.ts` (D-N1 source-derived numbers).
     - Full reconciliation delivered in `docs/plans/2026-11-18-gap-closure.md`: R-1..R-20 verdicts, TB-1..TB-15 tables, new gaps MG-36..MG-41.
     - Recorded decisions D-53..D-61 and answered questions A-18..A-28 in `docs/decisions/decision-register.md` and `docs/audit/open-questions.md`.
  2. **BX1 Flutter Contract Pack & API Reference (`scripts/generate-flutter-contract.js` & `scripts/check-flutter-contract.js`):**
     - Generated `docs/flutter-contract/callables.json`, `callables/INDEX.md`, and 42 `callables/<domain>.md` files for 188 callables (`responseDocumented: 188/188`).
     - Generated `permissions.json` (147 concrete permissions + 2 wildcards with descriptions, default roles, scope notes, 0 aliases).
     - Generated `images.md` (fixed `storagePath` vs `path`/`uploadId` across contract docs) and `auth.md` (`primaryOrganization.timezone`, `organization_selection_required`, `requestedOrgId` rejected).
     - Expanded `errors.md` to 69 codes and `state-machines.md` to 13 state machines.
     - Upgraded `forms/*.json` to 35 entity/action forms (fixed `approval_request` to `DocumentDecisionSchema`/`documentsDecide`, added `requests_settings`, `user_profile`, `ownership_transfer`, `sharing_policy`, `usage_limits`; fixed `customer.priceGroup` to text `"retail"`).
     - Added `.checksum.json` tamper guard (158 tracked files) and `functions/scripts/helpers/contract-shape.cjs` (`assertResponseShape`).
     - Added unit test `contractGuardAndPermissions.test.ts` (4/4 pass).
  3. **BX2 Organization Field Edit Policy:**
     - Implemented `ORGANIZATION_FIELD_CLASS`, `canEditOrganizationField`, and `maskBankAccounts` in `functions/src/callables/organizations.ts` (permission-only: `org:manage_legal_profile`, `org:manage_bank_details`, `org:update`; zero role-name checks; atomic rejection).
     - Updated `organizationsGet` to mask bank account numbers to `****XXXX` on responses (Q-B2, MG-37).
     - Created migration script `functions/scripts/migrate-org-owner-permissions.cjs` (dry-run/apply, idempotent, audited).
     - Added unit test `functions/src/test/unit/organizationEditPolicy.test.ts` (8 actors × 21 fields matrix = 168 cells, BM-4..BM-6 verified).
     - Verified live emulator tests in `verify-bx2-emulator.cjs` (BS-11..BS-15 pass).
  4. **BX3 Requests Hardening to Full Spec:**
     - Added `requestsSettingsGet` and `requestsSettingsUpdate` (`platform:requests_configure`, bounded SLA/limits/windows, audited) in `functions/src/callables/requests/platformRequests.ts` and `schemas.ts`.
     - Added 7 ordered `REQUEST_CATEGORY_GROUPS` to `requestsService.ts` and `requestsMeta`.
     - Fixed MG-36 fail-open bug: `assertRequestsFeatureEnabled()` now fails closed with `FEATURE_DISABLED` when document is missing.
     - Enforced `reopenWindowDays` (default 14 days) in `validateStateTransition` and `requestsTransition`.
     - Enforced BS-16: `org_profile_change` refuses fields caller can already edit directly and accepts S0 fields.
     - Added unit test `requestsExhaustiveSpec.test.ts` (RH-2 exhaustive 1,008-cell state grid, RH-3 45 per-category tests, RH-4 internal note redaction, RH-6 transaction read-after-write detector, RH-9 settings bounds, RH-13 no hard delete).
     - Refactored DUP-077: removed stored `organizationName` from `requests` collection, `models.ts`, and `tenantRequests.ts`.
     - Upgraded `migrate-requests-permissions.cjs` to support `--apply`, audit logging, and custom-role preservation.
     - Upgraded `functions/scripts/test-requests-scenarios.cjs` to cover F-RQ4 (plan downgrade blocker override) and F-RQ11 (SLA pause accumulation).
  5. **BX4 Test-Tier Repair & Remaining Capabilities:**
     - Added CP-1 `productsList` optional 1–50 unique `ids` filter + `missingIds` with cross-tenant isolation and cost redaction.
     - Added `"pubsub": { "port": 8085 }` to `firebase.json` (both `subscriptionAndUsageSweep` and `requestsSlaAndLifecycleSweep` initialize cleanly).
     - Added Storage and PubSub reachability safety abort in `functions/scripts/helpers/emulator-helper.cjs`.
     - Moved live provisioning integration test out of `membershipProvisioning.test.ts` into `test-membership-provisioning.cjs`.
     - Created `functions/scripts/report-outcome-coverage.js` (outcome tag coverage matrix).
     - Added `scriptSyntaxAndProductsBatch.test.ts` (`node --check` syntax gate on all `*.cjs` scripts).
     - Removed plain-string silent Super Admin fallback in `auth-personas.cjs` (BM-20).
     - Documented CP-3 PDF deferral in `sales-billing-and-quotations.md` and CP-4 multi-org Switch ON HOLD in `organizations-subscriptions-and-branches.md`.
  6. **BX5 Verification at the Gate:**
     - **BM-1..BM-20 Seeded Defect Proofs:** 20/20 detected (`verify-bm1-bm20.cjs`, 20 injected, 20 detected, 0 undetected).
     - **TypeScript Build:** 0 errors (`npm --prefix functions run build`).
     - **Pure Unit Tests:** **369/369 pass (96 suites, 0 skipped, 0 silent skips, `--test-timeout=15000`)**.
     - **Static Guards:** 35/35 [cov:35/35] `npm run test:static` checks PASSED (exit code 0; 0 `any` writes, 0 dead fields, 0 banned words, 0 schema duplication violations, 196/196 exports documented, 640 flutter contract items verified with 0 violations).
     - **Live 12-Step Emulator Gate:** **12/12 steps PASSED (failed=0/12)**:
       1. `SEED` (code 0)
       2. `SCENARIO_REAL_WORLD` (code 0)
       3. `SCENARIO_SUBSCRIPTION_AUDIT` (code 0)
       4. `SCENARIO_REQUESTS_FULL` (code 0)
       5. `SCENARIO_FINANCE_BRANCH` (code 0)
       6. `MEMBERSHIP_PROVISIONING` (code 0)
       7. `BX2_ORG_POLICY_ACCEPTANCE` (code 0)
       8. `BX1_BX4_ACCEPTANCE` (code 0)
       9. `RULES_FIRESTORE_STORAGE` (code 0)
       10. `CHECK_DATA_DUP` (code 0)
       11. `CHECK_DATA_SAME_DOC` (code 0)
       12. `CHECK_DATA_RAW_CENSUS` (code 0)

- **Source Numbers (from `report-numbers.js`):**
  - Total exports: **196** (188 callables, 6 triggers, 2 schedules)
  - Collections referenced: **61** (62 models in `models.ts`)
  - Permissions: **149** (147 concrete + 2 wildcards)
  - Flutter Contract: 13 docs, 35 entity forms (748 fields), 15 request detail forms, 158 checksummed files, `SUMMARY.md` 66 lines
  - Error codes: 63 unique thrown, 69 documented in `errors.md` (0 undocumented)
  - State machines: 13 in code, 13 in contract
  - Duplication allowlist: 92 exceptions (DUP-077 removed)

- **Next Command (Prompt 77 — Money, Stock and Account Integrity):**
  ```powershell
  # Prompt 77 entry command
  npm --prefix functions run verify:status
  ```
