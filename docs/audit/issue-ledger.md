# Trado Firebase Backend — Master Issue Ledger

**Project**: Trado Firebase Backend (`trado-x`)  
**Region**: `asia-south1`  
**Execution Boundary**: Local Firebase Emulator Suite (127.0.0.1)  
**Last Updated**: 2026-11-06  

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
- **Resolution**: Added concurrent `Promise.all` validation in `verifyTenantAccess` and `resolveBranchContext` checking `user.isActive`, `membership.status === "active"`, `organization.status === "active"`, and branch active status.

### ISSUE-09: Negative Test Personas Missing in Emulator Seed Tool
- **Evidence**: Emulator seed script only created happy-path active personas; manual and automated negative testing required ad-hoc data creation.
- **Root Cause**: Seed tool was originally designed only for happy-path developer workflows.
- **Resolution**: Extended `functions/src/scripts/seed-emulator.ts` with four dedicated negative personas/entities: `inactive@apexwholesale.local` (inactive user), `deactivated_member@apexwholesale.local` (revoked membership), `branch_inactive` (disabled branch), and `org_suspended_sample` with `suspended_org_user@apexwholesale.local` (suspended tenant). Added verification test `test-seed-repeatability.cjs` proving idempotency without document duplication across repeated seed executions.
