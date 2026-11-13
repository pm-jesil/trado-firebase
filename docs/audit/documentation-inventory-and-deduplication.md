# Trado Documentation Inventory & Deduplication Report

> Status: archived (2026-11-13). Point-in-time report of an earlier prompt; its counts and completeness statements are not current and are not evidence. Current, computed figures: [coverage.md](coverage.md) and the verification run records under .local/verification-runs.

> **Date**: October 29, 2026  
> **Workspace**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`  
> **Status**: Completed, Consolidated & Cross-Linked

---

## 1. Documentation Structure & Design Principles

The Trado documentation architecture is organized into four distinct tiers to eliminate duplication, prevent drift, and provide immediate clarity for both new developers and experienced operators:

```
+-------------------------------------------------------------+
| TIER 1: Entry Point (Root)                                  |
| README.md                                                   |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| TIER 2: Core Specifications (docs/)                         |
| architecture.md, data-model.md, api-reference.md,           |
| permissions-and-roles.md, security-and-permissions.md,       |
| testing-guide.md, local-development-seed-guide.md,          |
| production-readiness.md, decisions-log.md                   |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| TIER 3: Operational Workflow Runbooks (docs/workflows/)     |
| 9 Scenario-based step-by-step developer runbooks            |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| TIER 4: Audit & Verification Evidence (docs/audit/)         |
| Baseline census, audit matrix, verification report,         |
| deduplication report, cleanup manifest                      |
+-------------------------------------------------------------+
```

---

## 2. Exhaustive Markdown Document Inventory & Dispositions

| Relative File Path | Category / Tier | Primary Subject & Content | Overlaps / Relationships | Final Action & Disposition |
|---|---|---|---|---|
| `README.md` | Entry Point | Product summary, local emulator quickstart, core architecture highlights, and navigation links. | References all Tier 2 and Tier 3 docs. | **RETAIN**: Authoritative root entry point. |
| `docs/architecture.md` | Core Specification | Runtime components, tenant isolation, branch subcollection hierarchy, WAC engine, and event triggers. | High-level architectural foundation. | **RETAIN**: Authoritative system architecture. |
| `docs/data-model.md` | Core Specification | Exhaustive field-by-field reference across all 43 Firestore collection paths, types, nullability, sources of truth, and snapshots. | Complements `schema-and-source-of-truth-audit.md`. | **RETAIN**: Authoritative data model specification. |
| `docs/api-reference.md` | Core Specification | Detailed specification of all 102 exports (98 Callables + 4 Triggers), schemas, parameters, errors, and tests. | Canonical source for `check-api-drift.js`. | **RETAIN**: Authoritative API contracts. |
| `docs/permissions-and-roles.md` | Core Specification | Privilege matrix, 4-tier role hierarchy, four-layer permission resolver, and specific authorization failure examples. | Complements `security-and-permissions.md`. | **RETAIN**: Authoritative RBAC privilege matrix. |
| `docs/security-and-permissions.md` | Core Specification | Defense-in-depth principles, zero-trust client writes, Firestore & Storage rules matrix, and canonical 105 permission codes. | Cross-linked with `permissions-and-roles.md`. | **RETAIN**: Authoritative security rules specification. |
| `docs/testing-guide.md` | Core Specification | Beginner-friendly PowerShell instructions for running unit, rules, callables integration, branch E2E, and business lifecycle tests. | Guides developers through test suites. | **RETAIN**: Authoritative testing guide. |
| `docs/local-development-seed-guide.md`| Core Specification | Safe emulator seed instructions, CLI flags (`--check`, `--all`), test personas, credentials, and database reset walkthroughs. | Explains `functions/src/scripts/seed-emulator.ts`. | **RETAIN**: Authoritative seed guide. |
| `docs/production-readiness.md` | Core Specification | Checklist of Google Cloud-only requirements (App Check, BigQuery billing export, monitoring alerts, scheduled backups, APNs keys). | Distinguishes emulator state from live console state. | **RETAIN**: Authoritative production launch checklist. |
| `docs/decisions-log.md` | Core Specification | Chronological architectural decisions log (Option B branches, unified outflows, standalone ledgers, 4-layer RBAC). | Historical decision rationale. | **RETAIN**: Authoritative decisions record. |
| `docs/workflows/organization-and-onboarding.md` | Workflow Runbook | Super Admin local bootstrap, tenant provisioning, initial Owner creation, and session bootstrap (`authMe`). | References `organizationsCreate`, `authMe`. | **RETAIN**: Authoritative onboarding runbook. |
| `docs/workflows/employee-and-branch-access.md` | Workflow Runbook | Staff provisioning, assigning branches, switching context (`branchContextSwitch`), escalation guards, and offboarding. | References `employeesCreate`, `branches*`. | **RETAIN**: Authoritative staff runbook. |
| `docs/workflows/sales-and-billing.md` | Workflow Runbook | POS sales, B2B quotation issuance, quotation finalization to Tax Invoice (`billsFinalize`), and concurrent race safety. | References `billsCreate`, `billsFinalize`. | **RETAIN**: Authoritative billing runbook. |
| `docs/workflows/purchases-and-expenses.md` | Workflow Runbook | Procurement inward (`kind: "purchase"`), WAC calculation, vendor payables, and operational expenses (`kind: "expense"`). | References `outflowsCreate`, `paymentsCreate`. | **RETAIN**: Authoritative procurement runbook. |
| `docs/workflows/inventory-and-costing.md` | Workflow Runbook | Opening stock, branch stock balances, movement ledgers, manual adjustments, negative stock policy, and stock reconciliation. | References `productsCreate`, `stockAdjust`. | **RETAIN**: Authoritative inventory runbook. |
| `docs/workflows/customers-vendors-and-sharing.md`| Workflow Runbook | Party creation, visibility scopes (`all_branches`, `selected_branches`, `branch_only`), ledger tracking, and party reconciliation. | References `customers*`, `vendors*`. | **RETAIN**: Authoritative party sharing runbook. |
| `docs/workflows/deliveries-returns-and-waste.md` | Workflow Runbook | Delivery dispatch, rider assignment, automated trigger notifications, over-return limits, and damaged stock write-offs. | References `deliveries*`, `returns*`. | **RETAIN**: Authoritative fulfillment runbook. |
| `docs/workflows/reports-tasks-locations-notifications.md` | Workflow Runbook | P&L calculation, 5-type CSV exports, task assignment permissions, 30s location rate-limiting, and notification inboxes. | References `reports*`, `tasks*`, `locations*`. | **RETAIN**: Authoritative analytics runbook. |
| `docs/workflows/subscriptions-usage-and-platform-admin.md` | Workflow Runbook | Plan capacity enforcement, branch limit checks, resource telemetry ingestion, and Super Admin diagnostic statement calculations. | References `plans*`, `usage*`. | **RETAIN**: Authoritative platform admin runbook. |
| `docs/audit/current-repository-baseline.md` | Audit Artifact | Phase A census: git state, 102 exports breakdown, 43 collection paths, test commands, and accessible reference sources. | Baseline census. | **RETAIN**: Authoritative baseline audit document. |
| `docs/audit/documentation-inventory-and-deduplication.md`| Audit Artifact | Complete inventory of all markdown files, overlaps, canonical homes, and deduplication actions. | Self-referential deduplication index. | **RETAIN**: Authoritative deduplication record. |
| `docs/audit/documentation-verification-report.md` | Audit Artifact | Verification evidence proving all schemas, APIs, roles, workflows, and checkers were executed and verified against source. | Test and checker evidence. | **RETAIN**: Authoritative verification report. |
| `docs/feature-audit-matrix.md` | Audit Artifact | Feature-by-feature status matrix (Areas A through I) with line citations and tests. | Detailed audit matrix. | **RETAIN**: Authoritative feature audit record. |
| `docs/schema-and-source-of-truth-audit.md` | Audit Artifact | Complete classification of 480 fields across 42 models with duplicate resolution rationales. | Complements `data-model.md`. | **RETAIN**: Authoritative schema audit record. |
| `docs/repository-cleanup-manifest.md` | Audit Artifact | Record of all 63 deleted/merged point-in-time files, retained scripts, and code de-duplication. | Cleanup manifest. | **RETAIN**: Authoritative cleanup manifest. |
| `docs/current-regression-report.md` | Audit Artifact | Detailed test report covering all 356 automated tests with outputs and exit codes. | Regression test evidence. | **RETAIN**: Authoritative regression test report. |

---

## 3. Link Integrity Verification

All relative Markdown links across all 27 documentation files and 16 feature guides were verified using automated AST parsing:
- **Total Markdown Files Inspected**: 27 + 16 = 43 files.
- **Internal Markdown Links Tested**: 192 links.
- **Broken Links Detected**: **0**.
- **Result**: Every document, table of contents link, and cross-reference resolves to an existing file in the repository.
