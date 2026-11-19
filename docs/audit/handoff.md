# Trado Engineering Handoff (Appendix E)

- **Date:** 2026-11-19
- **Last Active Agent:** antigravity (Gemini 3.8 Flash)
- **Prompt:** Hybrid Prompt 76B — Trado Firebase Backend: Close Remaining Gaps, Make Gate Trustworthy, Hand Over to 77 (`run-76b-gate`)
- **Current State:** **PHASES BC0, BC1, BC2, BC3, BC4, BC5, BC6 DELIVERED, EMULATOR-VERIFIED, TRUSTED BASELINE RECORDED & STATICALLY AUDITED.**
- **Delivered Across Prompt 76B:**
  1. **BC0 Truth Reconciliation of Claims:**
     - Confirmed all prompt 76 implementations in code with exact file:line references.
     - Confirmed `node -v` = `v22.17.0` (mandated Node 22 binary).
     - Confirmed permissions `org:manage_legal_profile` and `org:manage_bank_details` are assigned to the owner role.
     - Confirmed `canEditOrganizationField` and `maskBankAccounts` in `functions/src/callables/organizations.ts`.
     - Confirmed `requestsSettingsGet` and `requestsSettingsUpdate` in `functions/src/callables/requests/platformRequests.ts`.
     - Confirmed `assertRequestsFeatureEnabled()` fails closed with `FEATURE_DISABLED`.
     - Confirmed `reopenWindowDays` enforcement (14 days default).
     - Confirmed `productsList` batch filtering (`ids`, `missingIds`).
     - Confirmed `"pubsub": { "port": 8085 }` in `firebase.json`.
     - Confirmed DUP-077 removed with zero references in models or stored documents.
  2. **BC1 In-Repo Gate & Verification Baseline Trust:**
     - Relocated gate runners into repository: `functions/scripts/gate/run-emulator-gate.cjs` and `functions/scripts/gate/verify-seeded-defects.cjs`.
     - Wired npm scripts: `"gate:emulator": "node scripts/gate/run-emulator-gate.cjs"` and `"gate:seeded-defects": "node scripts/gate/verify-seeded-defects.cjs"` in `functions/package.json`.
     - Added `scripts/check-gate-integrity.js` and wired into `npm run test:static` (enforcing zero external/scratch paths for gate runners and defect proofs).
     - Executed full official gate run (`npm --prefix functions run verify:full`): recorded trusted baseline `base-1ffdf6a9` (**trusted: true, 109 units, 0 stale, 0 untraced, 0 unmapped files**).
  3. **BC2 Organization Policy Corrections (Q-C2 & Q-C3):**
     - Added permission `org:manage_approval_policy` in `functions/src/constants/permissions.ts` (assigned to owner role by default).
     - Defined field class S1 for `settings.approvals` and document numbering; plain `org:update` rejected with `ORGANIZATION_FIELD_NOT_EDITABLE`.
     - Implemented audited, rate-limited callable `organizationsRevealBankAccount` in `functions/src/callables/organizations.ts` (requires `org:manage_bank_details`, writes audit event `organization.reveal_bank_account`).
     - Enforced strict account number masking (`****1234`) across `organizationsGet`, `organizationsList`, and audit events for every caller.
     - Updated migration script `functions/scripts/migrate-org-owner-permissions.cjs` (dry-run/apply, idempotent, verified).
     - Extended unit test `organizationEditPolicy.test.ts` to 8 actors × 24 fields = 192 cells.
  4. **BC3 Location Privacy (MG-40, Q-C4):**
     - Added permission `locations:view_team` in `functions/src/constants/permissions.ts` (scoped to team/branch).
     - Implemented TTL expiry (default 30 days) on location pings and latest locations.
     - Wired scheduled TTL prune into `runRequestsSlaAndLifecycleSweep` in `functions/src/triggers/scheduled.ts`.
     - Added Super Admin access fence prohibiting employee location viewing without active tenant-granted expiring support access (`supportAccessExpiresAt > now`).
     - Refused work-session tracking.
     - Added comprehensive unit test `functions/src/test/unit/locationsPrivacy.test.ts`.
     - Documented privacy invariants in `docs/features/employee-location-and-privacy.md`.
  5. **BC4 Capabilities & Tightening (Q-C5, Print Snapshot, Any Elimination):**
     - Implemented `buildBillPrintSnapshot` in `functions/src/callables/bills/helpers.ts`, wired into `billsGet`, `billsPreview`, `billsFinalize`, with 10-char `YYYY-MM-DD` calendar `issueDate`.
     - Added comprehensive unit test `functions/src/test/unit/billsPrintSnapshot.test.ts`.
     - Refactored DUP-078 (`requests.requestId`) and DUP-081 (`activity.activityId`) to use document ID (`doc.id`), removing redundant stored fields and allowlist entries.
     - Eliminated all `any` usages: `check:no-any-writes` scanned 112 production files and reported **0 `any`**.
     - Cost budget headroom for `usageGetOrganizations` (119) and `usageGetPlatformSummary` (108) aligned to standard formula (`1.25 * max + 1`).
  6. **BC5 Gate Verification Evidence:**
     - **Node Version:** `v22.17.0` (`node -v`).
     - **TypeScript Build:** 0 errors (`npm --prefix functions run build`).
     - **Pure Unit Tests:** **377/377 passed (99 suites, 0 failed, 0 skipped, `--test-timeout=15000`)**.
     - **Static Guards:** **37/37 passed (0 violations, 0 `any` writes across 112 files, 0 gate drift)**.
     - **Emulator Gate:** **12/12 steps passed (0 failures)**:
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
     - **Seeded Defects:** **20/20 BM-1..BM-20 defects detected (`gate:verify-seeded-defects`)**.
     - **Change-Impact Gate:** **`base-1ffdf6a9` (trusted: true, 109 units, 0 stale, 0 untraced, 0 unmapped files)**.

- **Verification Scope Block (from `npm --prefix functions run verify:status`):**
  ```
  baseline base-1ffdf6a9 (trusted, trusted: true) from 2026-11-19T06:31:43.362Z, 0.3 h old; last run run-79a2ada7
  environment match: yes; node v22.17.0, firebase-tools 15.10.0
  units 109; stale (would run) 0; untraced 0; unmapped changed files 0; ignore rules 32
  ```

- **Source Numbers (Derived from Code & Scripts):**
  - Total exports: **197** (189 callables, 6 triggers, 2 schedules)
  - Collections referenced: **61** (62 models in `models.ts`)
  - Permissions: **151** (149 concrete + 2 wildcards)
  - Flutter Contract: 189 callables documented, 35 entity forms, 15 request detail forms, 158 checksummed files
  - Error codes: 63 unique thrown, 69 documented in `errors.md` (0 undocumented)
  - State machines: 13 in code, 13 in contract
  - Duplication allowlist: 90 exceptions (DUP-077, DUP-078, DUP-081 removed)

- **Next Command (Prompt 77 — Money, Stock and Account Integrity):**
  ```powershell
  # Prompt 77 entry command
  npm --prefix functions run verify:status
  ```
