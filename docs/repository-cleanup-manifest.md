# Trado Firebase Backend — Repository Cleanup & Hygiene Manifest

> **Date**: October 29, 2026  
> **Repository Path**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`  
> **Status**: Completed, Verified & Cleaned

---

## 1. Overview of Codebase Hygiene Operations

The Trado Firebase backend underwent a comprehensive hygiene and de-duplication pass to remove obsolete point-in-time scripts, consolidate fragmented documentation, normalize terminology, and eliminate redundant helpers. Every deletion or consolidation is documented below with architectural evidence and justification.

---

## 2. Deleted & Consolidated Files Manifest

| File Path | Original Purpose | Reason for Removal / Consolidation | Surviving / Canonical Replacement |
|---|---|---|---|
| `scripts/test-migration.js` | Early test script verifying branch schema migration. | Obsolete point-in-time test. Migration logic was automated into core branch provisioning. | Tested comprehensively in `functions/scripts/test-branch-deep-e2e.js`. |
| `scripts/migrate-to-branches.js` | One-off CLI script to migrate flat organizations to subcollections. | Obsolete. Default branch `main-branch` is now created atomically inside `organizationsCreate`. | Core provisioning in `functions/src/callables/organizations.ts` & `branches.ts`. |
| `scripts/test-callables-integration.js` | Root-level copy of callables test suite. | Duplicate file. Contained stale imports while the real suite lived under `functions/scripts/`. | Canonical suite: `functions/scripts/test-callables-integration.js`. |
| `scripts/test-callable-invocation.js` | Ad-hoc single-callable test probe. | Obsolete. Only tested one endpoint with hardcoded IDs. | Replaced by `functions/scripts/test-api-workbench.js` and `scripts/manual-tests/trado-api.http`. |
| `docs/phase1-*.md` (10 files) | Early Phase 1 reports and notes. | Fragmented developmental history. Superceded by permanent architecture. | Merged into `docs/architecture.md`, `docs/data-model.md`, and feature guides. |
| `docs/phase2-*.md` (7 files) | Early Phase 2 reports and baseline notes. | Point-in-time progress logs. | Merged into `docs/api-reference.md`, `docs/data-model.md`, and feature guides. |
| `docs/phase3-*.md` (5 files) | Phase 3 completion reports. | Point-in-time development logs. | Merged into permanent feature guides under `docs/features/`. |
| `docs/branch-*.md` (16 files) | Intermediate branch retrofit audit files. | Redundant branch reports. | Consolidated into `docs/features/organizations-subscriptions-and-branches.md` and `docs/decisions-log.md`. |
| `docs/final-*.md` & misc reports (21 files) | Various incremental signoff drafts. | Ephemeral verification checklists. | Consolidated into `docs/audit-baseline.md`, `docs/feature-audit-matrix.md`, and `docs/current-regression-report.md`. |

---

## 3. Retained Operational & Test Files

The following files were reviewed and intentionally retained because they provide essential operational value, automated testing, or compliance validation:

| Retained File Path | Operational Justification & Purpose |
|---|---|
| `scripts/check-api-drift.js` | Automated CI checker verifying 100% parity between exported functions in `index.ts` and `docs/api-reference.md`. |
| `scripts/check-duplicate-embedding.js` | Structural AST checker inspecting TypeScript models and source code to prevent document embedding violations. |
| `scripts/check-schema-duplicates.js` | Automated validator auditing runtime Zod schemas, TypeScript types, and enums for naming drift and duplicates. |
| `scripts/manual-tests/trado-api.http` | Ready-to-use HTTP workbench for testing all 98 Cloud Functions callables via VS Code / IntelliJ REST Client. |
| `scripts/fixtures/` | Contains seed fixtures and mock payloads used across integration suites. |
| `functions/scripts/test-api-workbench.js` | Comprehensive CLI testing workbench for invoking and inspecting any backend API against local emulators. |
| `functions/scripts/test-callables-integration.js` | Authoritative integration test suite covering 49 end-to-end callable paths, idempotency, and RBAC. |
| `functions/scripts/test-branch-deep-e2e.js` | 15-scenario end-to-end test verifying multi-branch isolation, context switching, and sharing policies. |
| `functions/scripts/test-e2e-business-flow.js` | 10-step smoke test executing the full connected business lifecycle (Org -> Staff -> Purchase -> Sale -> Payment -> Return -> Reconciliation). |
| `functions/scripts/test-phase3-integration.js` | Integration suite verifying advanced operations: reporting, tasks, live location, automated triggers, branch capacity, and usage metering. |
| `tests/api/api-manifest.json` | Machine-readable JSON manifest detailing all 102 exports, parameters, required permissions, and test references. |

---

## 4. De-Duplication of Business Logic & Code Normalization

During this audit and cleanup, the codebase was inspected to ensure single canonical implementations exist for all core business routines:

1. **Precision & Money Utility**:
   - Single source of truth: `functions/src/utils/money.ts`.
   - All arithmetic uses `roundMoney`, `round2`, and integer-safe rounding. Duplicate inline rounding implementations were replaced.
2. **Context & Tenant Resolution**:
   - Single source of truth: `functions/src/services/contextResolver.ts`.
   - Standardizes target organization resolution, branch validation, and membership checks across all callables.
3. **Four-Layer Permission Resolver**:
   - Single source of truth: `functions/src/services/permissionResolver.ts`.
   - Centralizes plan module flags, tenant toggles, branch overrides, membership overrides, and role wildcards.
4. **Weighted-Average Costing**:
   - Single source of truth: `functions/src/services/costingEngine.ts`.
   - Used uniformly during purchase intake (`outflowsCreate`) and financial reporting (`reportsGetProfitLoss`).
5. **Physical Stock Arithmetic**:
   - Single source of truth: `functions/src/services/stockEngine.ts`.
   - Guarantees transactional updates to `stockBalances`, `products.currentStock`, and `stockMovements`.

---

## 5. Summary Metrics

- **Files Deleted / Merged**: 4 obsolete scripts + 59 redundant/point-in-time documents = **63 files cleanly consolidated**.
- **Permanent Core Docs**: 8 authoritative files in root and `docs/`.
- **Permanent Feature Guides**: 16 comprehensive guides in `docs/features/`.
- **Active Test & Checker Scripts**: 8 authoritative scripts in `functions/scripts/` and `scripts/`.
- **Codebase Integrity**: Zero broken imports, zero lint warnings, zero TypeScript errors.

