# Trado Backend: Comprehensive Callable & Trigger Inventory

This document is the authoritative, source-verified inventory of all Cloud Functions exports in the Trado Firebase backend. It provides the programmatic breakdown of all 115 HTTPS Callable functions, 6 triggers (Firestore event + scheduled), and the context derivation exceptions allowlist.

--- 

## 1. Export Overview

| Category | Export Type | Count |
|---|---|:---:|
| **HTTPS Callables** | Public Auth & Health Adapter | 2 |
| | Caller Identity Bootstrap | 4 |
| | Working Branch Context Selection | 1 |
| | Organization & Branch Onboarding | 4 |
| | Platform Super Admin Governance | 10 |
| | Reference & System Catalog Data | 4 |
| | Derived Tenant Business Operations (Mutations) | 48 |
| | Tenant Query & Analytics Filters | 42 |
| **Subtotal Callables** | | **115** |
| **Firestore Event Triggers** | Asynchronous Background Triggers | **6** |
| **Total Cloud Functions Exports** | | **121** |

--- 

## 2. HTTPS Callable Inventory (115 Functions)

### A. Public Auth & Health Adapter (2)
Unauthenticated entrypoints for system liveness and local emulator authentication.
1. `healthCheck`
2. `authLogin`

### B. Caller Identity Bootstrap (4)
Session resolution and caller-specific notifications. Never accept tenant or branch context parameters in the request payload.
3. `authMe`
4. `notificationsRegisterFcmToken`
5. `notificationsList`
6. `notificationsMarkRead`

### C. Context Selection (1)
Caller branch context switching.
7. `branchContextSwitch`

### D. Organization & Branch Onboarding (4)
Initial tenant creation and administrative configuration.
8. `organizationsCreate`
9. `organizationsUpdate`
10. `branchesCreate`
11. `branchesUpdate`

### E. Platform Super Admin Governance (10)
Restricted exclusively to platform administrators (`customClaims.isSuperAdmin === true`). Super Admin has zero tenant permissions, no organizations, and no branches.
12. `organizationsDeactivate`
13. `branchesDeactivate`
14. `plansCreate`
15. `plansUpdate`
16. `reportsGetPlatformOverview`
17. `usageGetPlatformSummary`
18. `usageGetOrganizations`
19. `usageCalculateDryRunStatement`
20. `usageUpdateLimits`
21. `organizationsSetSubscription`

### F. Reference & System Catalog Data (4)
Global system reference data available to authenticated callers.
21. `plansList`
22. `permissionCatalogList`
23. `modulesList`
24. `taxRegimesList`

### G. Derived Tenant Business Operations — Mutations (48)
Operational mutations where tenant boundaries (`organizationId`, `branchId`) are derived server-side from the authenticated token and active Firestore context.

#### RBAC & Memberships (13)
25. `sharingPoliciesUpdate`
26. `employeesCreate`
27. `employeesUpdate`
28. `employeesDeactivate`
29. `rolesCreate`
30. `rolesUpdate`
31. `departmentsCreate`
32. `departmentsUpdate`
33. `jobRolesCreate`
34. `jobRolesUpdate`
35. `teamsCreate`
36. `teamsUpdate`
37. `teamsAssignMember`

#### Catalog & Parties (10)
38. `productsCreate`
39. `productsUpdate`
40. `categoriesCreate`
41. `categoriesUpdate`
42. `unitsCreate`
43. `unitsUpdate`
44. `customersCreate`
45. `customersUpdate`
46. `vendorsCreate`
47. `vendorsUpdate`

#### Transactions & Operations (14)
48. `outflowsCreate`
49. `billsCreate`
50. `billsFinalize`
51. `billsUpdateDraft`
52. `billsVoid`
53. `outflowsVoid`
54. `documentsDecide`
55. `deliveriesCreate`
56. `deliveriesUpdateStatus`
57. `returnsCreate`
58. `paymentsCreate`
59. `paymentsVoid`
60. `recurringExpensesCreate`
61. `recurringExpensesUpdate`

#### Stock & Reconciliation (4)
62. `stockAdjust`
63. `reconcileStockBalances`
64. `reconcilePartyLedgers`
65. `reconcileBranchCounts`

#### Tasks & Telemetry (7)
66. `tasksCreate`
67. `tasksUpdate`
68. `tasksAssign`
69. `tasksUpdateStatus`
70. `tasksDelete`
71. `locationsRecordPing`
72. `usageRecordClientMetric`

### H. Tenant Query & Analytics Filters (42)
Read operations and analytical aggregations scoped to the caller's authorized tenant context.

#### Entities & Catalog Lists (28)
73. `organizationsList`
74. `branchesGetDefault`
75. `branchesList`
76. `employeesList`
77. `rolesList`
78. `departmentsList`
79. `jobRolesList`
80. `teamsList`
81. `productsList`
82. `productsGet`
83. `categoriesList`
84. `unitsList`
85. `customersList`
86. `customersGet`
87. `vendorsList`
88. `vendorsGet`
89. `outflowsList`
90. `outflowsGet`
91. `billsList`
92. `billsGet`
93. `deliveriesList`
94. `deliveriesGet`
95. `returnsList`
96. `paymentsList`
97. `stockMovementsList`
98. `productsGetPriceHistory`
99. `auditGetEntityHistory`
100. `recurringExpensesList`

#### Reports & Telemetry (11)
101. `reportsGetRevenue`
102. `reportsGetProfitLoss`
103. `reportsGetStockValuation`
104. `reportsGetTopEntities`
105. `reportsGetStaffActivity`
106. `reportsExportCsv`
107. `reportsGetPartyStatement`
108. `reportsGetOutflowSummary`
109. `tasksList`
110. `locationsGetLatest`
111. `locationsGetHistory`

#### Usage & Quotas (3)
112. `usageGetBranches`
113. `usageGetDetail`
114. `usageGetLimits`

--- 

## 3. Firestore Event Triggers (6 Background Triggers)

All triggers are defined in `functions/src/triggers/eventTriggers.ts` and exported in `functions/src/index.ts`. All execute in the `asia-south1` region.

| # | Trigger Name | Firestore Path Filter | Trigger Event | Primary Side Effects & Business Responsibilities |
|---|---|---|---|---|
| 1 | `onBillWritten` | `bills/{billId}` | `onDocumentWritten` | • Updates daily & monthly sales summaries via recordBillSummary<br>• Dispatches low_stock notification to admin if currentStock <= threshold<br>• Dispatches bill_created notification to organization admin |
| 2 | `onOutflowWritten` | `outflows/{outflowId}` | `onDocumentWritten` | • Updates daily & monthly expense summaries via recordOutflowSummary<br>• Dispatches outflow_recorded notification to organization admin<br>• Recalculates Weighted-Average Cost (WAC) on products for purchase lines if not already computed |
| 3 | `onPaymentWritten` | `payments/{paymentId}` | `onDocumentWritten` | • Resolves bill salesperson / creator for incoming bill payments<br>• Dispatches payment_received push notification to salesperson |
| 4 | `onDeliveryWritten` | `deliveries/{deliveryId}` | `onDocumentWritten` | • Detects newly assigned rider on delivery document<br>• Dispatches delivery_assigned notification with customer details to rider |
| 5 | `onStorageObjectFinalized` | `(storage: onObjectFinalized)` | `onObjectFinalized` | • Tracks uploaded storage bytes per organization via sharded counters<br>• Deletes file and refunds counter if organization hard_block storage limit is exceeded |
| 6 | `subscriptionAndUsageSweep` | `(scheduled: 0 2 * * * Asia/Kolkata)` | `onSchedule` | • Sends 7/3/1-day subscription expiry reminders to organization Owners<br>• Flips subscriptionStatus to expired after expiry + grace (audited)<br>• Sends server-observed usage warnings (>= warning threshold) to Owners |

*Note*: Historical reports mentioning `auditLogWritten`, `notificationDispatched`, `billFinalizedTrigger`, or `stockMovementWritten` were phantom labels; the four triggers above are the sole, authentic triggers.

--- 

## 4. Concrete Firestore Collection Paths (46 Collections)

| # | Collection Path | Storage Type | Domain |
|---|---|---|---|
| 1 | `auditLogs/{id}` | Root Collection | System Infrastructure |
| 2 | `bills/{id}` | Root Collection | Operations & Transactions |
| 3 | `branchUsageDaily/{id}` | Root Collection | Analytics & Usage Metering |
| 4 | `branchUsageMonthly/{id}` | Root Collection | Analytics & Usage Metering |
| 5 | `organizations/{organizationId}/branches/{branchId}` | Subcollection | Multi-Branch Architecture |
| 6 | `categories/{id}` | Root Collection | Catalog & Inventory |
| 7 | `customers/{id}` | Root Collection | Parties & Ledgers |
| 8 | `dailySummaries/{id}` | Root Collection | Analytics & Usage Metering |
| 9 | `deliveries/{id}` | Root Collection | Operations & Transactions |
| 10 | `departments/{id}` | Root Collection | Tenant & RBAC |
| 11 | `users/{uid}/devices/{deviceId}` | Subcollection | System Infrastructure |
| 12 | `documentCounters/{id}` | Root Collection | System Infrastructure |
| 13 | `idempotencyRecords/{id}` | Root Collection | System Infrastructure |
| 14 | `jobRoles/{id}` | Root Collection | Tenant & RBAC |
| 15 | `latestLocations/{id}` | Root Collection | Tasks, Location & Notifications |
| 16 | `locationPings/{id}` | Root Collection | Tasks, Location & Notifications |
| 17 | `membershipBranches/{id}` | Root Collection | Multi-Branch Architecture |
| 18 | `memberships/{id}` | Root Collection | Tenant & RBAC |
| 19 | `modules/{id}` | Root Collection | Tenant & RBAC |
| 20 | `monthlySummaries/{id}` | Root Collection | Analytics & Usage Metering |
| 21 | `notificationOutbox/{id}` | Root Collection | Tenant & RBAC |
| 22 | `notifications/{id}` | Root Collection | Tasks, Location & Notifications |
| 23 | `organizationUsageDaily/{id}` | Root Collection | Analytics & Usage Metering |
| 24 | `organizationUsageMonthly/{id}` | Root Collection | Analytics & Usage Metering |
| 25 | `organizations/{id}` | Root Collection | Tenant & RBAC |
| 26 | `outflows/{id}` | Root Collection | Operations & Transactions |
| 27 | `payments/{id}` | Root Collection | Operations & Transactions |
| 28 | `permissionCatalog/{id}` | Root Collection | Tenant & RBAC |
| 29 | `products/{id}` | Root Collection | Catalog & Inventory |
| 30 | `recurringExpenses/{id}` | Root Collection | Operations & Transactions |
| 31 | `returns/{id}` | Root Collection | Operations & Transactions |
| 32 | `roles/{id}` | Root Collection | Tenant & RBAC |
| 33 | `serials/{id}` | Root Collection | Catalog & Inventory |
| 34 | `stockAdjustmentRequests/{id}` | Root Collection | Catalog & Inventory |
| 35 | `stockBalances/{id}` | Root Collection | Catalog & Inventory |
| 36 | `stockMovements/{id}` | Root Collection | Catalog & Inventory |
| 37 | `subscriptionPlans/{id}` | Root Collection | Tenant & RBAC |
| 38 | `tasks/{id}` | Root Collection | Tasks, Location & Notifications |
| 39 | `taxRegimes/{id}` | Root Collection | Tenant & RBAC |
| 40 | `teams/{id}` | Root Collection | Tenant & RBAC |
| 41 | `uniqueKeys/{id}` | Root Collection | System Infrastructure |
| 42 | `units/{id}` | Root Collection | Catalog & Inventory |
| 43 | `usageCounterShards/{id}` | Root Collection | Analytics & Usage Metering |
| 44 | `usageRateCards/{id}` | Root Collection | Analytics & Usage Metering |
| 45 | `users/{id}` | Root Collection | Tenant & RBAC |
| 46 | `vendors/{id}` | Root Collection | Parties & Ledgers |

--- 

## 5. Context Exceptions Allowlist

To eliminate security vulnerabilities, ordinary operational callables derive `organizationId` and `branchId` server-side from `request.auth` and verified active Firestore records. Callers are blocked from supplying arbitrary tenant IDs.

The table below lists the **only sanctioned exceptions** where `organizationId` or `branchId` may be provided by the client:

| Parameter | Allowed Callable(s) | Architectural Justification |
|---|---|---|
| `organizationId` | `branchesCreate` | Creating a branch inside a specific tenant organization during onboarding. |
| `organizationId` | `organizationsDeactivate`, `branchesDeactivate` | Platform Super Admin actions targeting a specific tenant. |
| `organizationId` | `usageGetBranches`, `usageGetDetail`, `usageCalculateDryRunStatement`, `usageUpdateLimits` | Super Admin platform usage calculation and quota management. |
| `organizationId` | `reportsGet...`, `reportsExportCsv` (Super Admin mode only) | Super Admin auditing cross-tenant reporting data. |
| `organizationId` | Read Lists (`productsList`, `billsList`, etc.) | Super Admin platform view across organizations. Ignored/overridden for standard tenant users. |
| `branchId` | `branchContextSwitch` | Primary mechanism for multi-branch staff to switch their active working branch. Validated against `membershipBranches`. |
| `branchId` | `stockAdjust` | Physical location where stock intake or discrepancy adjustment takes place. |
| `branchId` | `outflowsCreate` | Operating branch incurring the purchase or operational expense. |
| `branchId` | `productsCreate` (optional) | Initial stock balance attribution during catalog creation. |
| `branchId` | `customersCreate`, `vendorsCreate` (optional) | Originating branch assignment for party ledger records. |
| `branchId` | `tasksCreate`, `tasksList` | Branch assignment for localized operational tasks. |
| `branchId` | Reports (`reportsGetRevenue`, etc.) | Optional branch-level filtering on analytical aggregations. |

<!-- GATE-MATRIX:START -->
## Gate & Permission Matrix (generated by scripts/check-gate-conformance.js)

Gate order for `tenant-gate`: authenticated → user active → membership active → organization active → subscription valid → plan includes module → org/branch module toggle → permission (deny wins) → branch assignment → usage limit → business logic. Super Admin passes only when every required permission is read-only.

| Callable | Source | Gate | Permission (any of) | Plan module(s) | Allowlist reason |
|---|---|---|---|---|---|
| `auditGetEntityHistory` | history.ts | tenant-gate | `audit:view` | staff |  |
| `authLogin` | authLogin.ts | NONE | — | — | emulator auth adapter (credentials -> token) |
| `authMe` | authMe.ts | NONE | — | — | session bootstrap; reports contextStatus incl. subscription_expired |
| `billsCreate` | bills.ts | tenant-gate | `sale:create`, `bill:create` | sales, billing |  |
| `billsFinalize` | bills.ts | tenant-gate | `bill:create`, `bill:update`, `delivery:update` | billing, delivery |  |
| `billsGet` | bills.ts | tenant-gate | `bill:view`, `bill:view_all`, `sale:view` | billing, sales |  |
| `billsList` | bills.ts | tenant-gate | `bill:view`, `bill:view_all`, `sale:view` | billing, sales |  |
| `billsUpdateDraft` | bills.ts | tenant-gate | `bill:create`, `sale:create` | billing, sales |  |
| `billsVoid` | bills.ts | tenant-gate | `bill:void` | billing |  |
| `branchContextSwitch` | branches.ts | member-gate | — | — | member switches own working branch (assignment checked) |
| `branchesCreate` | branches.ts | tenant-gate | `branch:create` | staff |  |
| `branchesDeactivate` | branches.ts | tenant-gate | `branch:deactivate` | staff |  |
| `branchesGetDefault` | branches.ts | member-gate | — | — | member reads default branch (gate without permission: any active member) |
| `branchesList` | branches.ts | member-gate | — | — | member lists own branches (gate without permission: any active member) |
| `branchesUpdate` | branches.ts | tenant-gate | `branch:update` | staff |  |
| `categoriesCreate` | categories.ts | catalog-gate | `category:manage`, `inventory:manage` | inventory |  |
| `categoriesList` | categories.ts | NONE | — | — | reference list visible to members |
| `categoriesUpdate` | categories.ts | catalog-gate | `category:manage`, `inventory:manage` | inventory |  |
| `customersCreate` | customers.ts | tenant-gate | `customer:create` | customers |  |
| `customersGet` | customers.ts | tenant-gate | `customer:view`, `bill:create` | customers, billing |  |
| `customersList` | customers.ts | tenant-gate | `customer:view`, `bill:create` | customers, billing |  |
| `customersUpdate` | customers.ts | tenant-gate | `customer:update` | customers |  |
| `deliveriesCreate` | deliveries.ts | tenant-gate | `delivery:create`, `delivery:assign` | delivery |  |
| `deliveriesGet` | deliveries.ts | tenant-gate | `delivery:view` | delivery |  |
| `deliveriesList` | deliveries.ts | tenant-gate | `delivery:view` | delivery |  |
| `deliveriesUpdateStatus` | deliveries.ts | tenant-gate | `delivery:update`, `delivery:assign` | delivery |  |
| `departmentsCreate` | departments.ts | catalog-gate | `department:manage` | staff |  |
| `departmentsList` | departments.ts | NONE | — | — | reference list visible to members |
| `departmentsUpdate` | departments.ts | catalog-gate | `department:manage` | staff |  |
| `documentsDecide` | approvals.ts | tenant-gate | `...PERMISSIONS[input.documentType]` | system |  |
| `employeesCreate` | employees.ts | tenant-gate | `employee:create` | staff |  |
| `employeesDeactivate` | employees.ts | tenant-gate | `employee:suspend`, `employee:delete`, `employee:update` | staff |  |
| `employeesList` | employees.ts | tenant-gate | `employee:view` | staff |  |
| `employeesUpdate` | employees.ts | tenant-gate | `employee:update` | staff |  |
| `healthCheck` | healthCheck.ts | NONE | — | — | public liveness probe |
| `jobRolesCreate` | jobRoles.ts | catalog-gate | `job_role:manage` | staff |  |
| `jobRolesList` | jobRoles.ts | NONE | — | — | reference list visible to members |
| `jobRolesUpdate` | jobRoles.ts | catalog-gate | `job_role:manage` | staff |  |
| `locationsGetHistory` | locations.ts | tenant-gate | `location:view_own`, `location:view_all` | employee_tracking |  |
| `locationsGetLatest` | locations.ts | tenant-gate | `location:view_own`, `location:view_all` | employee_tracking |  |
| `locationsRecordPing` | locations.ts | tenant-gate | `location:ping` | employee_tracking |  |
| `modulesList` | catalogs.ts | NONE | — | — | platform reference catalog |
| `notificationsList` | notifications.ts | NONE | — | — | caller reads own notifications (userId == caller) |
| `notificationsMarkRead` | notifications.ts | NONE | — | — | caller marks own notification (ownership checked) |
| `notificationsRegisterFcmToken` | notifications.ts | NONE | — | — | caller registers own device token |
| `organizationsCreate` | organizations.ts | platform-only | — | — |  |
| `organizationsDeactivate` | organizations.ts | platform-only | — | — |  |
| `organizationsList` | organizations.ts | platform-only | — | — |  |
| `organizationsSetSubscription` | organizations.ts | platform-only | — | — |  |
| `organizationsUpdate` | organizations.ts | NONE | — | — | field-policy matrix (ORGANIZATION_FIELD_POLICY) + subscription check, hand-rolled tiers |
| `outflowsCreate` | outflows.ts | tenant-gate | `purchase:create`, `outflow:create`, `expense:create`, `(by input)` | purchases, expenses |  |
| `outflowsGet` | outflows.ts | tenant-gate | `outflow:view`, `purchase:view`, `expense:view` | expenses, purchases |  |
| `outflowsList` | outflows.ts | tenant-gate | `outflow:view`, `purchase:view`, `expense:view` | expenses, purchases |  |
| `outflowsVoid` | outflows.ts | tenant-gate | `purchase:void`, `expense:void`, `outflow:void` | purchases, expenses |  |
| `paymentsCreate` | payments.ts | tenant-gate | `payment:create` | billing |  |
| `paymentsList` | payments.ts | tenant-gate | `payment:view` | billing |  |
| `paymentsVoid` | payments.ts | tenant-gate | `payment:void` | billing |  |
| `permissionCatalogList` | catalogs.ts | NONE | — | — | platform reference catalog |
| `plansCreate` | plans.ts | platform-only | — | — |  |
| `plansList` | plans.ts | NONE | — | — | platform reference catalog |
| `plansUpdate` | plans.ts | platform-only | — | — |  |
| `productsCreate` | products.ts | tenant-gate | `product:create`, `inventory:manage` | inventory |  |
| `productsGet` | products.ts | tenant-gate | `product:view`, `inventory:view`, `bill:create`, `purchase:create` | inventory, billing, purchases |  |
| `productsGetPriceHistory` | products.ts | tenant-gate | `product:view`, `inventory:view`, `bill:create`, `purchase:create` | inventory, billing, purchases |  |
| `productsList` | products.ts | tenant-gate | `product:view`, `inventory:view`, `bill:create`, `purchase:create` | inventory, billing, purchases |  |
| `productsUpdate` | products.ts | tenant-gate | `product:update`, `inventory:manage` | inventory |  |
| `reconcileBranchCounts` | reconciliation.ts | tenant-gate | `org:settings`, `inventory:manage` | staff, inventory |  |
| `reconcilePartyLedgers` | reconciliation.ts | tenant-gate | `org:settings`, `inventory:manage` | staff, inventory |  |
| `reconcileStockBalances` | reconciliation.ts | tenant-gate | `org:settings`, `inventory:manage` | staff, inventory |  |
| `recurringExpensesCreate` | recurringExpenses.ts | tenant-gate | `expense:create` | expenses |  |
| `recurringExpensesList` | recurringExpenses.ts | tenant-gate | `expense:view` | expenses |  |
| `recurringExpensesUpdate` | recurringExpenses.ts | tenant-gate | `expense:create` | expenses |  |
| `reportsExportCsv` | reports.ts | tenant-gate | `report:export` | reports |  |
| `reportsGetOutflowSummary` | reports.ts | tenant-gate | `report:view`, `outflow:view` | reports, expenses |  |
| `reportsGetPartyStatement` | reports.ts | tenant-gate | `(dynamic: isVendor)` | — |  |
| `reportsGetPlatformOverview` | reports.ts | tenant-gate | `platform:dashboard` | platform |  |
| `reportsGetProfitLoss` | reports.ts | tenant-gate | `report:profit` | reports |  |
| `reportsGetRevenue` | reports.ts | tenant-gate | `report:view` | reports |  |
| `reportsGetStaffActivity` | reports.ts | tenant-gate | `report:view`, `employee:view` | reports, staff |  |
| `reportsGetStockValuation` | reports.ts | tenant-gate | `inventory:view` | inventory |  |
| `reportsGetTopEntities` | reports.ts | tenant-gate | `report:view` | reports |  |
| `returnsCreate` | returns.ts | tenant-gate | `return:create` | returns |  |
| `returnsList` | returns.ts | tenant-gate | `return:view` | returns |  |
| `rolesCreate` | roles.ts | platform-only | — | — | Owner-only custom roles (role_org_owner check) / Super Admin system roles |
| `rolesList` | roles.ts | NONE | — | — | role catalog visible to members |
| `rolesUpdate` | roles.ts | NONE | — | — | Owner-only custom roles / Super Admin system roles |
| `sharingPoliciesUpdate` | branches.ts | tenant-gate | `org:settings` | staff |  |
| `stockAdjust` | stock.ts | tenant-gate | `stock:adjust`, `inventory:adjust` | inventory |  |
| `stockMovementsList` | stock.ts | tenant-gate | `stock:view`, `inventory:view` | inventory |  |
| `tasksAssign` | tasks.ts | tenant-gate | `task:assign` | tasks |  |
| `tasksCreate` | tasks.ts | tenant-gate | `task:create` | tasks |  |
| `tasksDelete` | tasks.ts | tenant-gate | `task:delete` | tasks |  |
| `tasksList` | tasks.ts | tenant-gate | `task:view` | tasks |  |
| `tasksUpdate` | tasks.ts | tenant-gate | `task:update`, `task:view` | tasks |  |
| `tasksUpdateStatus` | tasks.ts | tenant-gate | `task:update`, `task:view` | tasks |  |
| `taxRegimesList` | catalogs.ts | NONE | — | — | platform reference catalog |
| `teamsAssignMember` | teams.ts | tenant-gate | `team:manage`, `employee:view` | staff |  |
| `teamsCreate` | teams.ts | tenant-gate | `team:manage` | staff |  |
| `teamsList` | teams.ts | tenant-gate | `team:manage`, `employee:view` | staff |  |
| `teamsUpdate` | teams.ts | tenant-gate | `team:manage`, `employee:view` | staff |  |
| `unitsCreate` | units.ts | catalog-gate | `unit:manage`, `inventory:manage` | inventory |  |
| `unitsList` | units.ts | NONE | — | — | reference list visible to members |
| `unitsUpdate` | units.ts | catalog-gate | `unit:manage`, `inventory:manage` | inventory |  |
| `usageCalculateDryRunStatement` | usage.ts | tenant-gate | `platform:finance:view` | platform |  |
| `usageGetBranches` | usage.ts | tenant-gate | `platform:finance:view` | platform |  |
| `usageGetDetail` | usage.ts | tenant-gate | `platform:finance:view` | platform |  |
| `usageGetLimits` | usage.ts | tenant-gate | `org:view` | staff |  |
| `usageGetOrganizations` | usage.ts | tenant-gate | `platform:finance:view` | platform |  |
| `usageGetPlatformSummary` | usage.ts | tenant-gate | `platform:finance:view` | platform |  |
| `usageRecordClientMetric` | usage.ts | member-gate | — | — | client_estimate telemetry (validated, non-negative); gated without permission |
| `usageUpdateLimits` | usage.ts | tenant-gate | `platform:subscriptions:manage` | platform |  |
| `vendorsCreate` | vendors.ts | tenant-gate | `vendor:create` | purchases |  |
| `vendorsGet` | vendors.ts | tenant-gate | `vendor:view`, `purchase:create` | purchases |  |
| `vendorsList` | vendors.ts | tenant-gate | `vendor:view`, `purchase:create` | purchases |  |
| `vendorsUpdate` | vendors.ts | tenant-gate | `vendor:update` | purchases |  |

<!-- GATE-MATRIX:END -->
