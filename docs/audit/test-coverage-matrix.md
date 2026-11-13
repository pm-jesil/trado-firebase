# Trado Backend: Comprehensive Test Coverage Matrix

> Status: archived (2026-11-13). Point-in-time report of an earlier prompt; its counts and completeness statements are not current and are not evidence. Current, computed figures: [coverage.md](coverage.md) and the verification run records under .local/verification-runs.

This document provides the authoritative, exhaustive test mapping across all **102 Cloud Functions exports** (98 HTTPS Callables + 4 Firestore Triggers) and **43 concrete Firestore collection paths** in the Trado backend repository.

---

## 1. Cloud Functions Export Coverage Matrix (102 / 102 Exports)

| # | Export Symbol | Type | Domain | Primary Test Suite | Operations Covered | Status |
|---|---|---|---|---|---|:---:|
| 1 | `healthCheck` | Callable | System | `test-tenancy-auth-callables.cjs` | Unauthenticated probe, uptime check | PASS |
| 2 | `authMe` | Callable | Auth / RBAC | `test-tenancy-auth-callables.cjs` | Token verification, membership resolution | PASS |
| 3 | `permissionCatalogList` | Callable | Auth / RBAC | `test-tenancy-auth-callables.cjs` | List all 103 canonical permissions | PASS |
| 4 | `modulesList` | Callable | Platform | `test-tenancy-auth-callables.cjs` | List platform modules & feature flags | PASS |
| 5 | `taxRegimesList` | Callable | Platform | `test-analytics-platform-callables.cjs` | List supported international tax regimes | PASS |
| 6 | `plansCreate` | Callable | Platform | `test-analytics-platform-callables.cjs` | Create subscription plan (Super Admin) | PASS |
| 7 | `plansUpdate` | Callable | Platform | `test-analytics-platform-callables.cjs` | Update pricing & limits (Super Admin) | PASS |
| 8 | `plansList` | Callable | Platform | `test-analytics-platform-callables.cjs` | List active subscription plans | PASS |
| 9 | `organizationsCreate` | Callable | Tenancy | `test-tenancy-auth-callables.cjs` | Org creation, owner user, default branch | PASS |
| 10 | `organizationsUpdate` | Callable | Tenancy | `test-tenancy-auth-callables.cjs` | Org settings, tax regime, name updates | PASS |
| 11 | `organizationsDeactivate` | Callable | Tenancy | `test-tenancy-auth-callables.cjs` | Org suspension, membership deactivation | PASS |
| 12 | `organizationsList` | Callable | Tenancy | `test-tenancy-auth-callables.cjs` | Super Admin platform tenant listing | PASS |
| 13 | `branchesGetDefault` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | Default branch lookup | PASS |
| 14 | `branchesList` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | List organization branches | PASS |
| 15 | `branchesCreate` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | Create branch with plan limit check | PASS |
| 16 | `branchesUpdate` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | Update branch metadata and active state | PASS |
| 17 | `branchesDeactivate` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | Soft delete/deactivate branch | PASS |
| 18 | `branchContextSwitch` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | Switch active branch in Auth token | PASS |
| 19 | `sharingPoliciesUpdate` | Callable | Multi-Branch | `test-branch-lifecycle-callables.cjs` | Update customer/vendor sharing rules | PASS |
| 20 | `employeesCreate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Create staff with role & branch assignment | PASS |
| 21 | `employeesUpdate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Update staff details and branches | PASS |
| 22 | `employeesDeactivate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Multi-org safe employee deactivation | PASS |
| 23 | `employeesList` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | List organization staff members | PASS |
| 24 | `rolesCreate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Create custom tenant role with permissions | PASS |
| 25 | `rolesUpdate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Update role permissions and metadata | PASS |
| 26 | `rolesList` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | List system & tenant-specific roles | PASS |
| 27 | `departmentsCreate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Create organization department | PASS |
| 28 | `departmentsUpdate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Update department details | PASS |
| 29 | `departmentsList` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | List organization departments | PASS |
| 30 | `jobRolesCreate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Create organizational job role | PASS |
| 31 | `jobRolesUpdate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Update job role details | PASS |
| 32 | `jobRolesList` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | List organizational job roles | PASS |
| 33 | `teamsCreate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Create staff team (reference-by-ID) | PASS |
| 34 | `teamsUpdate` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | Update team details | PASS |
| 35 | `teamsList` | Callable | Staff / RBAC | `test-tenancy-auth-callables.cjs` | List organization teams | PASS |
| 36 | `categoriesCreate` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Create product category | PASS |
| 37 | `categoriesUpdate` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Update product category | PASS |
| 38 | `categoriesList` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | List product categories | PASS |
| 39 | `unitsCreate` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Create measurement unit | PASS |
| 40 | `unitsUpdate` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Update measurement unit | PASS |
| 41 | `unitsList` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | List measurement units | PASS |
| 42 | `productsCreate` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Create product with stock tracking | PASS |
| 43 | `productsUpdate` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Update product pricing & threshold | PASS |
| 44 | `productsList` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | List products with pagination & search | PASS |
| 45 | `productsGet` | Callable | Catalog | `test-catalog-inventory-callables.cjs` | Get single product by ID | PASS |
| 46 | `stockAdjust` | Callable | Inventory | `test-catalog-inventory-callables.cjs` | Manual physical inventory adjustment | PASS |
| 47 | `stockMovementsList` | Callable | Inventory | `test-catalog-inventory-callables.cjs` | List product stock audit movements | PASS |
| 48 | `reconcileStockBalances` | Callable | Inventory | `test-catalog-inventory-callables.cjs` | Verify stock balance vs movements ledger | PASS |
| 49 | `customersCreate` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Create customer with branch visibility | PASS |
| 50 | `customersUpdate` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Update customer credit limit & details | PASS |
| 51 | `customersList` | Callable | Parties | `test-parties-ledgers-callables.cjs` | List customers with branch visibility scope | PASS |
| 52 | `customersGet` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Get single customer by ID | PASS |
| 53 | `vendorsCreate` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Create vendor with payment terms | PASS |
| 54 | `vendorsUpdate` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Update vendor details & credit limit | PASS |
| 55 | `vendorsList` | Callable | Parties | `test-parties-ledgers-callables.cjs` | List vendors with branch visibility scope | PASS |
| 56 | `vendorsGet` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Get single vendor by ID | PASS |
| 57 | `paymentsCreate` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Create inbound & outbound payments | PASS |
| 58 | `paymentsList` | Callable | Parties | `test-parties-ledgers-callables.cjs` | List payment ledger records | PASS |
| 59 | `reconcilePartyLedgers` | Callable | Parties | `test-parties-ledgers-callables.cjs` | Verify party balances vs transactions | PASS |
| 60 | `outflowsCreate` | Callable | Procurement | `test-billing-procurement-callables.cjs` | Create purchase/expense with lines | PASS |
| 61 | `outflowsList` | Callable | Procurement | `test-billing-procurement-callables.cjs` | List outflows with filters | PASS |
| 62 | `outflowsGet` | Callable | Procurement | `test-billing-procurement-callables.cjs` | Get single outflow with line snapshots | PASS |
| 63 | `billsCreate` | Callable | Billing | `test-billing-procurement-callables.cjs` | Create POS bill / B2B sales quotation | PASS |
| 64 | `billsFinalize` | Callable | Billing | `test-billing-procurement-callables.cjs` | Finalize quotation into active invoice | PASS |
| 65 | `billsList` | Callable | Billing | `test-billing-procurement-callables.cjs` | List bills with date/status filters | PASS |
| 66 | `billsGet` | Callable | Billing | `test-billing-procurement-callables.cjs` | Get single bill by ID | PASS |
| 67 | `returnsCreate` | Callable | Operations | `test-billing-procurement-callables.cjs` | Process sales return & restock inventory | PASS |
| 68 | `returnsList` | Callable | Operations | `test-billing-procurement-callables.cjs` | List returns and refund disposition | PASS |
| 69 | `tasksCreate` | Callable | Operations | `test-operations-tasks-callables.cjs` | Create employee task with due date | PASS |
| 70 | `tasksUpdate` | Callable | Operations | `test-operations-tasks-callables.cjs` | Update task details | PASS |
| 71 | `tasksAssign` | Callable | Operations | `test-operations-tasks-callables.cjs` | Reassign task to employee | PASS |
| 72 | `tasksUpdateStatus` | Callable | Operations | `test-operations-tasks-callables.cjs` | Transition task through lifecycle | PASS |
| 73 | `tasksList` | Callable | Operations | `test-operations-tasks-callables.cjs` | List tasks filtered by assignee/status | PASS |
| 74 | `tasksDelete` | Callable | Operations | `test-operations-tasks-callables.cjs` | Delete task document | PASS |
| 75 | `locationsRecordPing` | Callable | Operations | `test-operations-tasks-callables.cjs` | Record employee GPS ping | PASS |
| 76 | `locationsGetLatest` | Callable | Operations | `test-operations-tasks-callables.cjs` | Get employee's latest coordinates | PASS |
| 77 | `locationsGetHistory` | Callable | Operations | `test-operations-tasks-callables.cjs` | Retrieve historical GPS trail | PASS |
| 78 | `notificationsRegisterFcmToken` | Callable | Operations | `test-operations-tasks-callables.cjs` | Register device push token | PASS |
| 79 | `notificationsList` | Callable | Operations | `test-operations-tasks-callables.cjs` | List in-app notifications | PASS |
| 80 | `notificationsMarkRead` | Callable | Operations | `test-operations-tasks-callables.cjs` | Mark in-app notifications as read | PASS |
| 81 | `deliveriesCreate` | Callable | Operations | `test-operations-tasks-callables.cjs` | Create delivery dispatch to rider | PASS |
| 82 | `deliveriesUpdateStatus` | Callable | Operations | `test-operations-tasks-callables.cjs` | Update delivery tracking status | PASS |
| 83 | `deliveriesList` | Callable | Operations | `test-operations-tasks-callables.cjs` | List deliveries by status | PASS |
| 84 | `deliveriesGet` | Callable | Operations | `test-operations-tasks-callables.cjs` | Get delivery details | PASS |
| 85 | `reportsGetRevenue` | Callable | Analytics | `test-analytics-platform-callables.cjs` | Revenue trends, discounts & sales | PASS |
| 86 | `reportsGetProfitLoss` | Callable | Analytics | `test-analytics-platform-callables.cjs` | P&L with WAC-computed COGS | PASS |
| 87 | `reportsGetStockValuation` | Callable | Analytics | `test-analytics-platform-callables.cjs` | Inventory valuation across products | PASS |
| 88 | `reportsGetTopEntities` | Callable | Analytics | `test-analytics-platform-callables.cjs` | Top-selling items and best customers | PASS |
| 89 | `reportsGetStaffActivity` | Callable | Analytics | `test-analytics-platform-callables.cjs` | Staff bill generation & revenue metrics | PASS |
| 90 | `reportsGetPlatformOverview` | Callable | Analytics | `test-analytics-platform-callables.cjs` | Platform-wide KPIs (Super Admin) | PASS |
| 91 | `reportsExportCsv` | Callable | Analytics | `test-analytics-platform-callables.cjs` | Stream CSV data for any report | PASS |
| 92 | `usageGetPlatformSummary` | Callable | Metering | `test-analytics-platform-callables.cjs` | Platform aggregated consumption | PASS |
| 93 | `usageGetOrganizations` | Callable | Metering | `test-analytics-platform-callables.cjs` | Organization-level usage summaries | PASS |
| 94 | `usageGetBranches` | Callable | Metering | `test-analytics-platform-callables.cjs` | Branch-level breakdown of usage | PASS |
| 95 | `usageGetDetail` | Callable | Metering | `test-analytics-platform-callables.cjs` | Granular daily usage logs | PASS |
| 96 | `usageCalculateDryRunStatement` | Callable | Metering | `test-analytics-platform-callables.cjs` | Dry-run invoice computation with rates | PASS |
| 97 | `usageRecordClientMetric` | Callable | Metering | `test-analytics-platform-callables.cjs` | Client sync telemetry intake | PASS |
| 98 | `reconcileBranchCounts` | Callable | Platform | `test-analytics-platform-callables.cjs` | Repair branch counter discrepancies | PASS |
| 99 | `onBillWritten` | Trigger | Background | `test-event-triggers.cjs` | Daily summary update, low stock alerts | PASS |
| 100| `onOutflowWritten` | Trigger | Background | `test-event-triggers.cjs` | Purchase WAC update, expense summaries | PASS |
| 101| `onPaymentWritten` | Trigger | Background | `test-event-triggers.cjs` | Payment received in-app notification | PASS |
| 102| `onDeliveryWritten` | Trigger | Background | `test-event-triggers.cjs` | Rider dispatch in-app notification | PASS |

---

## 2. Concrete Firestore Collections Coverage Matrix (43 / 43 Collections)

| # | Collection Path | Storage Model | Verifying Test Suite(s) | Verification Evidence |
|---|---|---|---|---|
| 1 | `users/{uid}` | Root | `test-tenancy-auth-callables.cjs`, `financialAndCoreServices.test.ts` | Multi-org active status, profile updates |
| 2 | `memberships/{membershipId}` | Root | `test-tenancy-auth-callables.cjs`, `firestore.rules.test.ts` | RBAC 4-layer resolution, overrides |
| 3 | `organizations/{organizationId}` | Root | `test-tenancy-auth-callables.cjs`, `test-retail-lifecycle.e2e.js` | Plan link, sharing policies, deactivation |
| 4 | `organizations/{organizationId}/branches/{branchId}` | Subcollection | `test-branch-lifecycle-callables.cjs`, `test-multibranch-isolation.e2e.js` | Subcollection isolation, lock binding |
| 5 | `users/{uid}/devices/{deviceId}` | Subcollection | `test-operations-tasks-callables.cjs` | FCM token registration, multi-device |
| 6 | `devices/{deviceId}` | Root | `test-operations-tasks-callables.cjs` | Reverse device index, FCM dispatch |
| 7 | `roles/{roleId}` | Root | `test-tenancy-auth-callables.cjs`, `financialAndCoreServices.test.ts` | System & tenant custom role permissions |
| 8 | `departments/{departmentId}` | Root | `test-tenancy-auth-callables.cjs` | Department CRUD, membership reference |
| 9 | `jobRoles/{jobRoleId}` | Root | `test-tenancy-auth-callables.cjs` | Job roles CRUD, membership reference |
| 10 | `teams/{teamId}` | Root | `test-tenancy-auth-callables.cjs` | Anti-embedding reference-by-ID validation |
| 11 | `subscriptionPlans/{planId}` | Root | `test-analytics-platform-callables.cjs`, `operationsValidation.test.ts` | Branch capacity limits, module toggles |
| 12 | `permissionCatalog/{permissionCode}` | Root | `test-tenancy-auth-callables.cjs`, `seed-emulator.js` | 103 canonical capability codes |
| 13 | `modules/{moduleCode}` | Root | `test-tenancy-auth-callables.cjs`, `financialAndCoreServices.test.ts` | 8 foundational ERP modules |
| 14 | `taxRegimes/{taxRegimeCode}` | Root | `test-analytics-platform-callables.cjs` | GST, VAT, zero-tax lookup |
| 15 | `idempotencyRecords/{recordId}` | Root | `financialAndCoreServices.test.ts`, `test-retail-lifecycle.e2e.js` | SHA-256 payload locks, lease recovery |
| 16 | `auditLogs/{logId}` | Root | `test-retail-lifecycle.e2e.js`, `firestore.rules.test.ts` | Immutable append-only operational audit |
| 17 | `notificationOutbox/{outboxId}` | Root | `financialAndCoreServices.test.ts` | Asynchronous push notification queue |
| 18 | `products/{productId}` | Root | `test-catalog-inventory-callables.cjs`, `test-event-triggers.cjs` | Stock tracking, WAC updates |
| 19 | `categories/{categoryId}` | Root | `test-catalog-inventory-callables.cjs` | Product taxonomy management |
| 20 | `units/{unitId}` | Root | `test-catalog-inventory-callables.cjs` | Measurement unit groups & conversions |
| 21 | `customers/{customerId}` | Root | `test-parties-ledgers-callables.cjs`, `test-multibranch-isolation.e2e.js` | Ledger balances, branch visibility scopes |
| 22 | `vendors/{vendorId}` | Root | `test-parties-ledgers-callables.cjs`, `test-multibranch-isolation.e2e.js` | Outflow payables, branch visibility |
| 23 | `outflows/{outflowId}` | Root | `test-billing-procurement-callables.cjs`, `test-event-triggers.cjs` | Purchases, expenses, line snapshots |
| 24 | `bills/{billId}` | Root | `test-billing-procurement-callables.cjs`, `test-event-triggers.cjs` | POS sales, B2B invoices, quotations |
| 25 | `stockMovements/{movementId}` | Root | `test-catalog-inventory-callables.cjs`, `test-retail-lifecycle.e2e.js` | Immutable stock audit ledger |
| 26 | `deliveries/{deliveryId}` | Root | `test-operations-tasks-callables.cjs`, `test-event-triggers.cjs` | Rider dispatch, tracking lifecycle |
| 27 | `returns/{returnId}` | Root | `test-billing-procurement-callables.cjs`, `test-retail-lifecycle.e2e.js` | Over-return checks, inventory restock |
| 28 | `payments/{paymentId}` | Root | `test-parties-ledgers-callables.cjs`, `test-event-triggers.cjs` | Inbound/outbound ledger allocations |
| 29 | `documentCounters/{counterId}` | Root | `test-retail-lifecycle.e2e.js` | Atomic sequential document numbering |
| 30 | `tasks/{taskId}` | Root | `test-operations-tasks-callables.cjs`, `operationsValidation.test.ts` | Task assignments, status lifecycle |
| 31 | `dailySummaries/{summaryId}` | Root | `test-event-triggers.cjs`, `test-analytics-platform-callables.cjs` | Incremental daily revenue aggregations |
| 32 | `monthlySummaries/{summaryId}` | Root | `test-event-triggers.cjs`, `test-analytics-platform-callables.cjs` | Incremental monthly financial summaries |
| 33 | `latestLocations/{locationId}` | Root | `test-operations-tasks-callables.cjs` | Real-time GPS coordinate snapshots |
| 34 | `locationPings/{pingId}` | Root | `test-operations-tasks-callables.cjs` | Historical employee location breadcrumbs |
| 35 | `notifications/{notificationId}` | Root | `test-operations-tasks-callables.cjs`, `test-event-triggers.cjs` | In-app user notifications |
| 36 | `branchCodeLocks/{lockId}` | Root | `test-branch-lifecycle-callables.cjs`, `test-multibranch-isolation.e2e.js` | Branch code uniqueness guarantee |
| 37 | `membershipBranches/{membershipBranchId}`| Root | `test-branch-lifecycle-callables.cjs`, `test-multibranch-isolation.e2e.js`| Staff branch assignment join records |
| 38 | `stockBalances/{stockBalanceId}` | Root | `test-catalog-inventory-callables.cjs`, `test-multibranch-isolation.e2e.js`| Per-branch isolated stock balances |
| 39 | `organizationUsageDaily/{docId}` | Root | `test-analytics-platform-callables.cjs`, `operationsValidation.test.ts` | Daily tenant API & event meters |
| 40 | `branchUsageDaily/{docId}` | Root | `test-analytics-platform-callables.cjs` | Daily branch-level consumption meters |
| 41 | `platformUsageSnapshots/{docId}` | Root | `test-analytics-platform-callables.cjs` | Super Admin platform aggregation |
| 42 | `usageRateCards/{docId}` | Root | `test-analytics-platform-callables.cjs`, `operationsValidation.test.ts` | Cost per operation rate configurations |
| 43 | `usageAllocationRuns/{docId}` | Root | `test-analytics-platform-callables.cjs` | Dry-run invoice & metering audit runs |

