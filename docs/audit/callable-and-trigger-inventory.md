# Trado Backend: Comprehensive Callable & Trigger Inventory

This document is the authoritative, source-verified inventory of all Cloud Functions exports in the Trado Firebase backend. It provides the programmatic breakdown of all 101 HTTPS Callable functions, 4 Firestore Event Triggers, and the context derivation exceptions allowlist.

--- 

## 1. Export Overview

| Category | Export Type | Count |
|---|---|:---:|
| **HTTPS Callables** | Public Auth & Health Adapter | 2 |
| | Caller Identity Bootstrap | 4 |
| | Working Branch Context Selection | 1 |
| | Organization & Branch Onboarding | 4 |
| | Platform Super Admin Governance | 9 |
| | Reference & System Catalog Data | 4 |
| | Derived Tenant Business Operations (Mutations) | 40 |
| | Tenant Query & Analytics Filters | 37 |
| **Subtotal Callables** | | **101** |
| **Firestore Event Triggers** | Asynchronous Background Triggers | **4** |
| **Total Cloud Functions Exports** | | **105** |

--- 

## 2. HTTPS Callable Inventory (101 Functions)

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

### E. Platform Super Admin Governance (9)
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

### F. Reference & System Catalog Data (4)
Global system reference data available to authenticated callers.
21. `plansList`
22. `permissionCatalogList`
23. `modulesList`
24. `taxRegimesList`

### G. Derived Tenant Business Operations — Mutations (40)
Operational mutations where tenant boundaries (`organizationId`, `branchId`) are derived server-side from the authenticated token and active Firestore context.

#### RBAC & Memberships (12)
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

#### Catalog & Parties (10)
37. `productsCreate`
38. `productsUpdate`
39. `categoriesCreate`
40. `categoriesUpdate`
41. `unitsCreate`
42. `unitsUpdate`
43. `customersCreate`
44. `customersUpdate`
45. `vendorsCreate`
46. `vendorsUpdate`

#### Transactions & Operations (7)
47. `outflowsCreate`
48. `billsCreate`
49. `billsFinalize`
50. `deliveriesCreate`
51. `deliveriesUpdateStatus`
52. `returnsCreate`
53. `paymentsCreate`

#### Stock & Reconciliation (4)
54. `stockAdjust`
55. `reconcileStockBalances`
56. `reconcilePartyLedgers`
57. `reconcileBranchCounts`

#### Tasks & Telemetry (7)
58. `tasksCreate`
59. `tasksUpdate`
60. `tasksAssign`
61. `tasksUpdateStatus`
62. `tasksDelete`
63. `locationsRecordPing`
64. `usageRecordClientMetric`

### H. Tenant Query & Analytics Filters (37)
Read operations and analytical aggregations scoped to the caller's authorized tenant context.

#### Entities & Catalog Lists (25)
65. `organizationsList`
66. `branchesGetDefault`
67. `branchesList`
68. `employeesList`
69. `rolesList`
70. `departmentsList`
71. `jobRolesList`
72. `teamsList`
73. `productsList`
74. `productsGet`
75. `categoriesList`
76. `unitsList`
77. `customersList`
78. `customersGet`
79. `vendorsList`
80. `vendorsGet`
81. `outflowsList`
82. `outflowsGet`
83. `billsList`
84. `billsGet`
85. `deliveriesList`
86. `deliveriesGet`
87. `returnsList`
88. `paymentsList`
89. `stockMovementsList`

#### Reports & Telemetry (9)
90. `reportsGetRevenue`
91. `reportsGetProfitLoss`
92. `reportsGetStockValuation`
93. `reportsGetTopEntities`
94. `reportsGetStaffActivity`
95. `reportsExportCsv`
96. `tasksList`
97. `locationsGetLatest`
98. `locationsGetHistory`

#### Usage & Quotas (3)
99. `usageGetBranches`
100. `usageGetDetail`
101. `usageGetLimits`

--- 

## 3. Firestore Event Triggers (4 Background Triggers)

All triggers are defined in `functions/src/triggers/eventTriggers.ts` and exported in `functions/src/index.ts`. All execute in the `asia-south1` region.

| # | Trigger Name | Firestore Path Filter | Trigger Event | Primary Side Effects & Business Responsibilities |
|---|---|---|---|---|
| 1 | `onBillWritten` | `bills/{billId}` | `onDocumentWritten` | • Updates daily & monthly sales summaries via recordBillSummary<br>• Dispatches low_stock notification to admin if currentStock <= threshold<br>• Dispatches bill_created notification to organization admin |
| 2 | `onOutflowWritten` | `outflows/{outflowId}` | `onDocumentWritten` | • Updates daily & monthly expense summaries via recordOutflowSummary<br>• Dispatches outflow_recorded notification to organization admin<br>• Recalculates Weighted-Average Cost (WAC) on products for purchase lines if not already computed |
| 3 | `onPaymentWritten` | `payments/{paymentId}` | `onDocumentWritten` | • Resolves bill salesperson / creator for incoming bill payments<br>• Dispatches payment_received push notification to salesperson |
| 4 | `onDeliveryWritten` | `deliveries/{deliveryId}` | `onDocumentWritten` | • Detects newly assigned rider on delivery document<br>• Dispatches delivery_assigned notification with customer details to rider |

*Note*: Historical reports mentioning `auditLogWritten`, `notificationDispatched`, `billFinalizedTrigger`, or `stockMovementWritten` were phantom labels; the four triggers above are the sole, authentic triggers.

--- 

## 4. Concrete Firestore Collection Paths (44 Collections)

| # | Collection Path | Storage Type | Domain |
|---|---|---|---|
| 1 | `users/{uid}` | Root Collection | Tenant & RBAC |
| 2 | `memberships/{membershipId}` | Root Collection | Tenant & RBAC |
| 3 | `organizations/{organizationId}` | Root Collection | Tenant & RBAC |
| 4 | `organizations/{organizationId}/branches/{branchId}` | Subcollection | Multi-Branch Architecture |
| 5 | `users/{uid}/devices/{deviceId}` | Subcollection | System Infrastructure |
| 6 | `roles/{roleId}` | Root Collection | Tenant & RBAC |
| 7 | `departments/{departmentId}` | Root Collection | Tenant & RBAC |
| 8 | `jobRoles/{jobRoleId}` | Root Collection | Tenant & RBAC |
| 9 | `teams/{teamId}` | Root Collection | Tenant & RBAC |
| 10 | `subscriptionPlans/{planId}` | Root Collection | Tenant & RBAC |
| 11 | `permissionCatalog/{permissionCode}` | Root Collection | Tenant & RBAC |
| 12 | `modules/{moduleCode}` | Root Collection | Tenant & RBAC |
| 13 | `taxRegimes/{taxRegimeCode}` | Root Collection | Tenant & RBAC |
| 14 | `idempotencyRecords/{recordId}` | Root Collection | System Infrastructure |
| 15 | `auditLogs/{logId}` | Root Collection | System Infrastructure |
| 16 | `notificationOutbox/{outboxId}` | Root Collection | Tenant & RBAC |
| 17 | `products/{productId}` | Root Collection | Catalog & Inventory |
| 18 | `categories/{categoryId}` | Root Collection | Catalog & Inventory |
| 19 | `units/{unitId}` | Root Collection | Catalog & Inventory |
| 20 | `customers/{customerId}` | Root Collection | Parties & Ledgers |
| 21 | `vendors/{vendorId}` | Root Collection | Parties & Ledgers |
| 22 | `outflows/{outflowId}` | Root Collection | Operations & Transactions |
| 23 | `bills/{billId}` | Root Collection | Operations & Transactions |
| 24 | `stockMovements/{movementId}` | Root Collection | Catalog & Inventory |
| 25 | `deliveries/{deliveryId}` | Root Collection | Operations & Transactions |
| 26 | `returns/{returnId}` | Root Collection | Operations & Transactions |
| 27 | `payments/{paymentId}` | Root Collection | Operations & Transactions |
| 28 | `documentCounters/{counterId}` | Root Collection | System Infrastructure |
| 29 | `tasks/{taskId}` | Root Collection | Tasks, Location & Notifications |
| 30 | `dailySummaries/{summaryId}` | Root Collection | Analytics & Usage Metering |
| 31 | `monthlySummaries/{summaryId}` | Root Collection | Analytics & Usage Metering |
| 32 | `latestLocations/{locationId}` | Root Collection | Tasks, Location & Notifications |
| 33 | `locationPings/{pingId}` | Root Collection | Tasks, Location & Notifications |
| 34 | `notifications/{notificationId}` | Root Collection | Tasks, Location & Notifications |
| 35 | `branchCodeLocks/{lockId}` | Root Collection | Multi-Branch Architecture |
| 36 | `membershipBranches/{membershipBranchId}` | Root Collection | Multi-Branch Architecture |
| 37 | `stockBalances/{stockBalanceId}` | Root Collection | Catalog & Inventory |
| 38 | `organizationUsageDaily/{docId}` | Root Collection | Analytics & Usage Metering |
| 39 | `organizationUsageMonthly/{docId}` | Root Collection | Analytics & Usage Metering |
| 40 | `branchUsageDaily/{docId}` | Root Collection | Analytics & Usage Metering |
| 41 | `branchUsageMonthly/{docId}` | Root Collection | Analytics & Usage Metering |
| 42 | `platformUsageSnapshots/{docId}` | Root Collection | Analytics & Usage Metering |
| 43 | `usageRateCards/{docId}` | Root Collection | Analytics & Usage Metering |
| 44 | `usageAllocationRuns/{docId}` | Root Collection | Analytics & Usage Metering |

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
