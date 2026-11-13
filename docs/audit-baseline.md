# Trado Firebase Backend — Baseline Audit Inventory

> **Execution Context**: Local Windows Development Environment  
> **Date**: October 29, 2026  
> **Firebase Project**: `trado-x` (Project Number: `293471017332`, Region: `asia-south1`)  
> **Operating Mode**: Read-Only Baseline Inspection (Phase 0 of Master Audit)

---

## 1. Environment & Runtime Verification

| Component | Reported Context | Actual Verified System State | Notes / Parity |
|---|---|---|---|
| **Operating System** | Windows 11 | Windows 11 (AMD64) | Matches |
| **Node.js** | v24.16.0 | `v24.16.0` (`C:\Users\jesil.p\node\node-v24.16.0-win-x64`) | Matches local host runtime |
| **npm** | 11.13.0 | `11.13.0` | Matches local host runtime |
| **Firebase CLI** | 15.34.1 | `15.34.1` | Global CLI binary |
| **Functions Runtime Target** | Node.js 22 | `"engines": { "node": "22" }` in `functions/package.json` | Cloud Functions 2nd Generation |
| **Functions Architecture** | Cloud Functions Gen 2 | `firebase-functions/v2` (`setGlobalOptions({ region: "asia-south1", maxInstances: 10 })`) | Modern modular SDK |
| **Project Alias** | `trado-x` | `trado-x` in `.firebaserc` (`projects.default = "trado-x"`) | Verified |
| **Primary Region** | `asia-south1` | `asia-south1` (Mumbai) in `functions/src/index.ts` | Verified |

### Emulator Configuration (`firebase.json`)
- **Authentication**: Port `9099`
- **Functions**: Port `5001`
- **Firestore**: Port `8080`
- **Storage**: Port `9199`
- **Emulator UI**: Port `4000` (Default, enabled: true)
- **Single Project Mode**: `true`
- **Local Isolation Safeguard**: Test and seed tooling strictly verify `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` before executing. No production connection is authorized or opened.

---

## 2. Git State & Working Tree Baseline

- **Current Branch**: `main`
- **Commit**: `bfd748a` (*Initialize backend architecture with Firebase functions, Firestore rules, and documentation*)
- **Working Tree**: Clean (`git status -u` reports `nothing to commit, working tree clean`)
- **Stash**: Empty
- **Production Safety**: Zero cloud deployments. Zero live database writes.

---

## 3. Discovered Cloud Functions Exports Breakdown

Direct source enumeration from `functions/src/index.ts` and underlying callable modules yields **exactly 102 exports**:

### Summary by Invocation Type
- **HTTPS Callable Functions (`onCall`)**: **98**
- **Event-Driven Firestore Triggers (`onDocumentWritten`)**: **4**
- **Scheduled Functions (`onSchedule`)**: **1** (`subscriptionAndUsageSweep`, functions/src/triggers/scheduled.ts; its Cloud Scheduler job is created by `firebase deploy`).
- **Total Exports**: **102**

### Detailed Export Inventory
1. **Diagnostic & Session (2)**: `healthCheck`, `authMe`
2. **Organizations (4)**: `organizationsCreate`, `organizationsUpdate`, `organizationsDeactivate`, `organizationsList`
3. **Branches & Multi-Branch Context (7)**: `branchesGetDefault`, `branchesList`, `branchesCreate`, `branchesUpdate`, `branchesDeactivate`, `branchContextSwitch`, `sharingPoliciesUpdate`
4. **Employees & Memberships (4)**: `employeesCreate`, `employeesUpdate`, `employeesDeactivate`, `employeesList`
5. **Roles & Capabilities (3)**: `rolesCreate`, `rolesUpdate`, `rolesList`
6. **Departments (3)**: `departmentsCreate`, `departmentsUpdate`, `departmentsList`
7. **Job Roles (3)**: `jobRolesCreate`, `jobRolesUpdate`, `jobRolesList`
8. **Teams (3)**: `teamsCreate`, `teamsUpdate`, `teamsList`
9. **Subscription Plans (3)**: `plansCreate`, `plansUpdate`, `plansList`
10. **Catalogs & Reference Data (3)**: `permissionCatalogList`, `modulesList`, `taxRegimesList`
11. **Push Notifications & Devices (1)**: `notificationsRegisterFcmToken`
12. **Products (4)**: `productsCreate`, `productsUpdate`, `productsList`, `productsGet`
13. **Categories (3)**: `categoriesCreate`, `categoriesUpdate`, `categoriesList`
14. **Units (3)**: `unitsCreate`, `unitsUpdate`, `unitsList`
15. **Customers (4)**: `customersCreate`, `customersUpdate`, `customersList`, `customersGet`
16. **Vendors (4)**: `vendorsCreate`, `vendorsUpdate`, `vendorsList`, `vendorsGet`
17. **Unified Outflows (3)**: `outflowsCreate`, `outflowsList`, `outflowsGet`
18. **Shared Bills & Sales Engine (4)**: `billsCreate`, `billsFinalize`, `billsList`, `billsGet`
19. **Deliveries & Dispatch (4)**: `deliveriesCreate`, `deliveriesUpdateStatus`, `deliveriesList`, `deliveriesGet`
20. **Returns (2)**: `returnsCreate`, `returnsList`
21. **Payments Ledger (2)**: `paymentsCreate`, `paymentsList`
22. **Stock Movements & Adjustments (2)**: `stockAdjust`, `stockMovementsList`
23. **Ledger & Stock Reconciliation (3)**: `reconcileStockBalances`, `reconcilePartyLedgers`, `reconcileBranchCounts`
24. **Reporting & Analytics (7)**: `reportsGetRevenue`, `reportsGetProfitLoss`, `reportsGetStockValuation`, `reportsGetTopEntities`, `reportsGetStaffActivity`, `reportsGetPlatformOverview`, `reportsExportCsv`
25. **Tasks (6)**: `tasksCreate`, `tasksUpdate`, `tasksAssign`, `tasksUpdateStatus`, `tasksList`, `tasksDelete`
26. **Live Location Tracking (3)**: `locationsRecordPing`, `locationsGetLatest`, `locationsGetHistory`
27. **In-App Notifications (2)**: `notificationsList`, `notificationsMarkRead`
28. **Super Admin Usage Metering & Platform Consumption (6)**: `usageGetPlatformSummary`, `usageGetOrganizations`, `usageGetBranches`, `usageGetDetail`, `usageCalculateDryRunStatement`, `usageRecordClientMetric`
29. **Event-Driven Firestore Triggers (4)**: `onBillWritten`, `onOutflowWritten`, `onPaymentWritten`, `onDeliveryWritten`

---

## 4. Discovered Firestore Collections & Structural Models

### Concrete Collections & Subcollections (42 Structural Types)
All 42 document interfaces are defined in `functions/src/types/models.ts`:

1. `users/{userId}` — User account and global credentials
2. `users/{userId}/devices/{deviceId}` — Multi-device FCM registration
3. `organizations/{orgId}` — Tenant account boundary
4. `organizations/{orgId}/branches/{branchId}` — Physical operating branch subcollection
5. `branchCodeLocks/{orgId_code}` — Atomic uniqueness lock for branch codes within tenant
6. `memberships/{membershipId}` — User tenant membership, base role, and branch assignment
7. `membershipBranches/{membershipId_branchId}` — Relational join for staff-branch assignment queries
8. `roles/{roleId}` — Tenant custom roles and predefined role definitions
9. `departments/{departmentId}` — Tenant organizational departments
10. `jobRoles/{jobRoleId}` — Tenant job designations
11. `teams/{teamId}` — Tenant teams and leadership hierarchy
12. `products/{productId}` — Product catalog, barcode, pricing, and aggregate stock mirror
13. `productCategories/{categoryId}` — Product category tree
14. `productBrands/{brandId}` — Product brand catalog
15. `barcodeLocks/{orgId_barcode}` — Atomic concurrency lock for barcode uniqueness
16. `stockBalances/{orgId_branchId_productId}` — Authoritative physical stock balance per branch
17. `stockMovements/{movementId}` — Immutable stock audit movement ledger
18. `customers/{customerId}` — Customer profiles and branch visibility scoping
19. `customerLedgers/{ledgerId}` — Double-entry customer credit/receivable ledger
20. `vendors/{vendorId}` — Vendor profiles and branch visibility scoping
21. `vendorLedgers/{ledgerId}` — Double-entry vendor payable ledger
22. `bills/{billId}` — Sales transactions (POS, Quotation, Tax Invoice)
23. `outflows/{outflowId}` — Unified outflows (Purchases with stock inward, Operational Expenses)
24. `payments/{paymentId}` — Standalone payment transaction ledger
25. `deliveries/{deliveryId}` — Delivery dispatch, assignment, and tracking
26. `returns/{returnId}` — Sale and purchase returns with restock controls
27. `tasks/{taskId}` — Operational staff tasks and status lifecycle
28. `locations/{locationId}` — Historical employee location telemetry trail
29. `activeLocations/{membershipId}` — Real-time latest location per employee
30. `notifications/{notificationId}` — In-app notification inbox
31. `dailySummaries/{orgId_date}` — Pre-aggregated daily operational totals
32. `organizationUsageDaily/{orgId_date}` — Aggregated tenant daily resource usage
33. `branchUsageDaily/{orgId_branchId_date}` — Aggregated branch daily resource usage
34. `platformUsageSnapshots/{date}` — Super Admin platform aggregate usage
35. `usageRateCards/{rateCardId}` — Versioned resource pricing cards
36. `usageAllocationRuns/{runId}` — Audit history of diagnostic dry-run statements
37. `plans/{planId}` — Subscription plan catalog and capacity limits
38. `modules/{moduleId}` — Platform feature modules and dependencies
39. `taxRegimes/{regimeId}` — Regional tax regime definitions (GST, VAT, Sales Tax)
40. `documentCounters/{orgId_type_year}` — Concurrency-safe sequential numbering counters
41. `idempotencyRecords/{idempotencyKey}` — 24-hour request deduplication and lease locking
42. `auditLogs/{logId}` — Append-only administrative and security audit trail

---

## 5. Discrepancy & Historical Anomaly Reconciliation

| # | Discrepancy Item | Analysis from Source Code & Git History | Authoritative Disposition |
|---|---|---|---|
| 1 | **73 → 95 → 102 Export History** | Early Phase 2 baseline had 73 exports. Phase 3 added 22 exports (reporting, tasks, locations, notifications). Deep audit added 7 exports (`reconcileBranchCounts` + 6 `usage*` functions). | **Resolved & Verified**: Exactly 102 current exports in `functions/src/index.ts` (98 Callables + 4 Triggers). |
| 2 | **42 Models vs 25 Reported Collections** | Early reports counted only primary business entities (25 collections). They omitted concurrency locks (2), counters (1), idempotency records (1), subcollections (2), relational joins (1), branch stock (1), operations (4), and usage metering (5). | **Resolved**: Exactly 42 concrete Firestore document interfaces exist and are validated in `models.ts`. |
| 3 | **94 vs 95 Unit Tests** | When branch-scoping validation on `ExportReportSchema` was introduced, an additional test was added to `phase3Validation.test.ts`. | **Resolved & Verified**: Exactly 95 unit tests pass across 26 test suites in `functions/src/test/unit/`. |
| 4 | **98 Callables + 4 Triggers Claim** | Verified directly against `functions/src/index.ts`: 98 `onCall` definitions + 4 `onDocumentWritten` triggers in `triggers/eventTriggers.ts`. | **Confirmed Accurate**: Exactly 98 + 4 = 102. |
| 5 | **`users.fcmTokens` vs `users/{uid}/devices/{deviceId}`** | Early prototype placed `fcmTokens: string[]` directly on user. Modern implementation uses dedicated subcollection `users/{uid}/devices/{deviceId}` with device telemetry (platform, model, appVersion). `fcmTokens` on `UserDoc` is retained only as an optional backward-compatible cache. | **Intentional Design**: `users/{uid}/devices/{deviceId}` is authoritative; UserDoc `fcmTokens` is an optional cache. |
| 6 | **`memberships.assignedBranchIds` vs `membershipBranches`** | `membershipBranches` is the authoritative normalized join collection for cross-staff queries. `assignedBranchIds: string[]` on `MembershipDoc` is an intentional read-optimized denormalization to avoid collection scans on every session bootstrap (`authMe`). | **Intentional Design**: `membershipBranches` is authoritative; `assignedBranchIds` is a synchronized cache. |
| 7 | **`primaryBranchId` Context Location** | Stored in Auth Custom Claims (`request.auth.token.primaryBranchId`) and returned in `authMe.activeContext.primaryBranchId`. It is a runtime session pointer, while `assignedBranchIds` on Membership defines allowed branches. | **Confirmed Correct**: Claim is session pointer; Membership stores assignment array. |
| 8 | **`products.currentStock` vs `stockBalances`** | Physical inventory is strictly branch-scoped in `stockBalances/{orgId}_{branchId}_{productId}`. `ProductDoc.currentStock` is an organization-wide aggregate mirror for fast catalog listing. | **Intentional Architecture**: `stockBalances` + `stockMovements` is authoritative; `currentStock` is an aggregate mirror verified by `reconcileStockBalances`. |
| 9 | **Organization vs Plan `branchLimit`** | `subscriptionPlans.branchLimit` is the authoritative subscription tier entitlement. `OrganizationDoc.branchLimit` is a cached snapshot inherited from the plan, and `branchCount` is an operational count of active branches. | **Confirmed Correct**: Plan is authoritative contract; Org stores cached limit and active counter, audited by `reconcileBranchCounts`. |
| 10 | **Documentation File Count Variations** | Early development accumulated 59 temporary, fragmented point-in-time files (`phase1-*`, `phase2-*`, etc.). They were consolidated into 7 authoritative documents. The current task expands these into comprehensive, permanent feature guides. | **Reconciled**: The documentation set is structured into permanent core docs + dedicated feature guides. |

---

## 6. Current Documentation Files Baseline

At the start of this audit, the `docs/` directory contains exactly 7 permanent files resulting from the initial cleanup pass:
- `docs/architecture.md`: System components, tenant isolation, and branch model overview.
- `docs/data-model.md`: Collections and field documentation.
- `docs/api-reference.md`: Documented inventory of Cloud Functions exports.
- `docs/security-and-permissions.md`: Authentication, RBAC, and rules overview.
- `docs/testing-guide.md`: Test execution instructions and commands.
- `docs/production-readiness.md`: Cloud deployment prerequisites checklist.
- `docs/decisions-log.md`: Architectural decision history.

The next step is to expand the documentation suite to include deep, practical feature guides under `docs/features/` covering every real business scenario.

