# Trado Firebase Backend — Current Repository Baseline Census

> Status: archived (2026-11-13). Point-in-time report of an earlier prompt; its counts and completeness statements are not current and are not evidence. Current, computed figures: [coverage.md](coverage.md) and the verification run records under .local/verification-runs.

> **Document Type**: Phase A Read-Only Baseline & System Census  
> **Date**: October 29, 2026  
> **Workspace**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`  
> **Firebase Project**: `trado-x` (`asia-south1`, Cloud Functions Gen 2, Node.js 22)  
> **Author**: Antigravity Assistant

---

## 1. Git State & Checkpoint Status

- **Current Git Branch**: `main`
- **Head Commit**: `bfd748a` (*Initialize backend architecture with Firebase functions, Firestore rules, and documentation*)
- **Working Tree State**:
  - Tracked files are clean and synchronized with `origin/main`.
  - 21 documentation and feature guide files staged from previous session.
  - Zero unstaged deletions or destructive overrides.
  - Baseline checkpoint is fully preserved.

---

## 2. Actual Cloud Functions Export Enumeration

Verified by direct AST inspection of `functions/src/index.ts`:

- **HTTPS Callable Functions (`onCall`)**: **98**
- **Firestore Event Triggers (`onDocumentWritten`)**: **4**
- **Scheduled Cloud Functions (`onSchedule`)**: **0**
- **Total Exported Functions**: **102**

### Classification by Domain
1. **Diagnostic & Session (2)**: `healthCheck`, `authMe`
2. **Organizations (4)**: `organizationsCreate`, `organizationsUpdate`, `organizationsDeactivate`, `organizationsList`
3. **Branches (7)**: `branchesGetDefault`, `branchesList`, `branchesCreate`, `branchesUpdate`, `branchesDeactivate`, `branchContextSwitch`, `sharingPoliciesUpdate`
4. **Employees & Staff (4)**: `employeesCreate`, `employeesUpdate`, `employeesDeactivate`, `employeesList`
5. **Roles & Capabilities (3)**: `rolesCreate`, `rolesUpdate`, `rolesList`
6. **Departments (3)**: `departmentsCreate`, `departmentsUpdate`, `departmentsList`
7. **Job Roles (3)**: `jobRolesCreate`, `jobRolesUpdate`, `jobRolesList`
8. **Teams (3)**: `teamsCreate`, `teamsUpdate`, `teamsList`
9. **Subscription Plans (3)**: `plansCreate`, `plansUpdate`, `plansList`
10. **Catalogs & Reference Data (3)**: `permissionCatalogList`, `modulesList`, `taxRegimesList`
11. **Devices & FCM (1)**: `notificationsRegisterFcmToken`
12. **Products (4)**: `productsCreate`, `productsUpdate`, `productsList`, `productsGet`
13. **Categories (3)**: `categoriesCreate`, `categoriesUpdate`, `categoriesList`
14. **Units (3)**: `unitsCreate`, `unitsUpdate`, `unitsList`
15. **Customers (4)**: `customersCreate`, `customersUpdate`, `customersList`, `customersGet`
16. **Vendors (4)**: `vendorsCreate`, `vendorsUpdate`, `vendorsList`, `vendorsGet`
17. **Unified Outflows (3)**: `outflowsCreate`, `outflowsList`, `outflowsGet`
18. **Shared Bills & Invoicing (4)**: `billsCreate`, `billsFinalize`, `billsList`, `billsGet`
19. **Deliveries (4)**: `deliveriesCreate`, `deliveriesUpdateStatus`, `deliveriesList`, `deliveriesGet`
20. **Returns (2)**: `returnsCreate`, `returnsList`
21. **Payments (2)**: `paymentsCreate`, `paymentsList`
22. **Stock Movements (2)**: `stockAdjust`, `stockMovementsList`
23. **Reconciliation (3)**: `reconcileStockBalances`, `reconcilePartyLedgers`, `reconcileBranchCounts`
24. **Reporting & Analytics (7)**: `reportsGetRevenue`, `reportsGetProfitLoss`, `reportsGetStockValuation`, `reportsGetTopEntities`, `reportsGetStaffActivity`, `reportsGetPlatformOverview`, `reportsExportCsv`
25. **Tasks (6)**: `tasksCreate`, `tasksUpdate`, `tasksAssign`, `tasksUpdateStatus`, `tasksList`, `tasksDelete`
26. **Live Location (3)**: `locationsRecordPing`, `locationsGetLatest`, `locationsGetHistory`
27. **In-App Notifications (2)**: `notificationsList`, `notificationsMarkRead`
28. **Usage Metering (6)**: `usageGetPlatformSummary`, `usageGetOrganizations`, `usageGetBranches`, `usageGetDetail`, `usageCalculateDryRunStatement`, `usageRecordClientMetric`
29. **Event Triggers (4)**: `onBillWritten`, `onOutflowWritten`, `onPaymentWritten`, `onDeliveryWritten`

---

## 3. Concrete Firestore Collection Paths vs. Model Declarations

### Inventory of Actual Concrete Firestore Paths (43 Paths)

#### A. Top-Level Root Collections (41)
1. `users/{userId}`
2. `organizations/{orgId}`
3. `branchCodeLocks/{orgId_code}`
4. `memberships/{membershipId}`
5. `membershipBranches/{membershipId_branchId}`
6. `roles/{roleId}`
7. `departments/{departmentId}`
8. `jobRoles/{jobRoleId}`
9. `teams/{teamId}`
10. `products/{productId}`
11. `productCategories/{categoryId}`
12. `productBrands/{brandId}`
13. `units/{unitId}`
14. `barcodeLocks/{orgId_barcode}`
15. `stockBalances/{orgId_branchId_productId}`
16. `stockMovements/{movementId}`
17. `customers/{customerId}`
18. `customerLedgers/{ledgerId}`
19. `vendors/{vendorId}`
20. `vendorLedgers/{ledgerId}`
21. `bills/{billId}`
22. `outflows/{outflowId}`
23. `payments/{paymentId}`
24. `deliveries/{deliveryId}`
25. `returns/{returnId}`
26. `tasks/{taskId}`
27. `locations/{locationId}`
28. `activeLocations/{membershipId}`
29. `notifications/{notificationId}`
30. `dailySummaries/{orgId_date}`
31. `organizationUsageDaily/{orgId_date}`
32. `branchUsageDaily/{orgId_branchId_date}`
33. `platformUsageSnapshots/{date}`
34. `usageRateCards/{rateCardId}`
35. `usageAllocationRuns/{runId}`
36. `plans/{planId}`
37. `modules/{moduleId}`
38. `taxRegimes/{regimeId}`
39. `documentCounters/{orgId_type_year}`
40. `idempotencyRecords/{idempotencyKey}`
41. `auditLogs/{logId}`

#### B. Subcollections (2)
42. `organizations/{orgId}/branches/{branchId}`
43. `users/{userId}/devices/{deviceId}`

### Distinction: Model Interface Count vs. Collection Count
- In `functions/src/types/models.ts`, there are **42 TypeScript `Doc` interfaces**.
- The collection `units/{unitId}` is defined and validated in `functions/src/validation/schemas.ts` and `functions/src/constants/catalogs.ts` (`unitsCreate`, `unitsList`).
- Therefore: **43 concrete collection paths** exist in the system, matching **42 `Doc` interfaces** in `models.ts` plus the lightweight unit catalog schema.

---

## 4. Discovered Test Suites & Package Scripts

### Commands in `functions/package.json`
- `npm run lint` -> `eslint --ext .js,.ts .` (0 errors)
- `npm run build` -> `tsc` (0 errors)
- `npm run test:unit` -> `node --test lib/test/unit/**/*.test.js` (95 pass, 0 fail, 26 suites)
- `npm run test:rules` -> `node --test lib/test/rules/**/*.test.js` (16 pass, 0 fail, 2 suites)

### Integration & E2E Suites in `functions/scripts/`
- `test-callables-integration.js` (49 pass, 0 fail)
- `test-branch-deep-e2e.js` (15 pass, 0 fail)
- `test-e2e-business-flow.js` (10 steps pass, 0 fail)
- `test-phase3-integration.js` (27 pass, 0 fail)
- `test-api-workbench.js` (Interactive testing tool)

### Static Checkers in `scripts/`
- `check-api-drift.js` (102/102 exports match canonical API documentation)
- `check-duplicate-embedding.js` (0 violations across 42 models)
- `check-schema-duplicates.js` (0 schema/enum naming collisions)

---

## 5. Current Documentation Inventory & Verification

- **Root Document**: `README.md`
- **Core Specification Documents (`docs/`)**:
  - `architecture.md`
  - `data-model.md`
  - `api-reference.md`
  - `security-and-permissions.md`
  - `testing-guide.md`
  - `production-readiness.md`
  - `decisions-log.md`
- **Feature Guides (`docs/features/`)**: 16 comprehensive guides covering each functional domain.
- **Audit Artifacts (`docs/`)**:
  - `audit-baseline.md`
  - `feature-audit-matrix.md`
  - `schema-and-source-of-truth-audit.md`
  - `repository-cleanup-manifest.md`
  - `current-regression-report.md`

**Markdown Link Validation**: Automated AST link checker verified **0 broken internal links** across all 29 markdown documents.

---

## 6. Accessible Reference Sources

- **Inspected Sources**:
  - `functions/src/types/models.ts`
  - `functions/src/types/api.ts`
  - `functions/src/validation/schemas.ts`
  - `functions/src/constants/permissions.ts`
  - `functions/src/constants/enums.ts`
  - `functions/src/constants/catalogs.ts`
  - `functions/src/services/contextResolver.ts`
  - `functions/src/services/permissionResolver.ts`
  - `functions/src/services/stockEngine.ts`
  - `functions/src/services/costingEngine.ts`
  - `firestore.rules` & `storage.rules`
  - `firestore.indexes.json`
- **External/Client Codebases**:
  - No Flutter client repository or external `testing-trado-api` folder is physically present in the workspace or parent directory.
  - All contracts and API behaviors are derived strictly from authoritative backend code and validation schemas.

---

## 7. Open Questions & Non-Destructive Plan Forward

1. **Seed Script Enhancement**: `functions/src/scripts/seed-emulator.ts` requires restructuring to support `--check`, `--seed-reference-data`, `--seed-demo-organization`, `--reset-seed-data`, `--all`, and profile flags (`minimal`, `staff-demo`, `operations-demo`, `multi-branch-test`) with hard-fail emulator safeguards.
2. **Checker Self-Tests**: Add `--test` mode to `scripts/check-api-drift.js` to ensure all 3 checkers possess verified self-test fixtures.
3. **Dedicated Workflow Runbooks**: Expand `docs/workflows/` with the 9 specific human-readable step-by-step operational runbooks requested in Section 6.

