# API Audit Ledger

## Summary

| Total | PASS | WARN | FAIL |
|-------|------|------|------|
| 134 | 70 | 64 | 0 |

## Checks

| ID | Check | Scope |
|----|-------|-------|
| A | Exported from `index.ts` | All |
| B | Auth gate present | All |
| C | `parseInput()` validation | All |
| D | Strict schema (z.strictObject) | All |
| E | `createAuditLog()` for mutations | Mutations |
| F | No `as any` on write paths (global guard) | Mutations |
| G | Response has `return {` | All |
| H | Usage metering for billable ops | Billable creates |
| I | Idempotency for create ops | Creates |
| J | Test coverage | All |
| K | Documented in api-reference.md / openapi | All |

## Results by Group


### Auth

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `authLogin` | `authLogin.ts` | ✅ PASS | — |
| `authMe` | `authMe.ts` | ✅ PASS | — |
| `usersUpdateMe` | `users.ts` | ✅ PASS | — |

### Organizations

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `organizationsCreate` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `organizationsUpdate` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `organizationsDeactivate` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `organizationsList` | `organizations.ts` | ✅ PASS | — |
| `organizationsReactivate` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `organizationsPreviewDeactivationImpact` | `organizations.ts` | ✅ PASS | — |
| `organizationsGetSubscriptionHistory` | `organizations.ts` | ✅ PASS | — |
| `organizationsSetSubscription` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `organizationsGet` | `organizations.ts` | ✅ PASS | — |
| `organizationsProvisionUser` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `organizationsTransferOwnership` | `organizations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Branches

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `branchesGetDefault` | `branches.ts` | ✅ PASS | — |
| `branchesList` | `branches.ts` | ✅ PASS | — |
| `branchesCreate` | `branches.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `branchesUpdate` | `branches.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `branchesDeactivate` | `branches.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `branchContextSwitch` | `branches.ts` | ✅ PASS | — |
| `sharingPoliciesUpdate` | `branches.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Employees

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `employeesCreate` | `employees.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `employeesUpdate` | `employees.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `employeesDeactivate` | `employees.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `employeesList` | `employees.ts` | ✅ PASS | — |
| `employeesGet` | `employees.ts` | ✅ PASS | — |

### Platform Users

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `platformUsersList` | `platformUsers.ts` | ✅ PASS | — |
| `platformUsersGet` | `platformUsers.ts` | ✅ PASS | — |

### Plans

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `plansCreate` | `plans.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `plansUpdate` | `plans.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `plansList` | `plans.ts` | ✅ PASS | — |
| `plansPreviewImpact` | `plans.ts` | ✅ PASS | — |
| `plansGet` | `plans.ts` | ✅ PASS | — |
| `plansArchive` | `plans.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `plansDelete` | `plans.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Catalog

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `permissionCatalogList` | `catalogs.ts` | ✅ PASS | — |
| `modulesList` | `catalogs.ts` | ✅ PASS | — |
| `taxRegimesList` | `catalogs.ts` | ✅ PASS | — |
| `rolesCreate` | `roles.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `rolesUpdate` | `roles.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `rolesList` | `roles.ts` | ✅ PASS | — |
| `jobRolesCreate` | `jobRoles.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `jobRolesUpdate` | `jobRoles.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `jobRolesList` | `jobRoles.ts` | ✅ PASS | — |
| `departmentsCreate` | `departments.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `departmentsUpdate` | `departments.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `departmentsList` | `departments.ts` | ✅ PASS | — |
| `teamsCreate` | `teams.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `teamsUpdate` | `teams.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `teamsAssignMember` | `teams.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `teamsList` | `teams.ts` | ✅ PASS | — |
| `categoriesCreate` | `categories.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `categoriesUpdate` | `categories.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `categoriesList` | `categories.ts` | ✅ PASS | — |
| `unitsCreate` | `units.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `unitsUpdate` | `units.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `unitsList` | `units.ts` | ✅ PASS | — |

### Products

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `productsCreate` | `products.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `productsUpdate` | `products.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `productsList` | `products.ts` | ✅ PASS | — |
| `productsGet` | `products.ts` | ✅ PASS | — |
| `productsGetPriceHistory` | `products.ts` | ✅ PASS | — |

### Customers

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `customersCreate` | `customers.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `customersUpdate` | `customers.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `customersList` | `customers.ts` | ✅ PASS | — |
| `customersGet` | `customers.ts` | ✅ PASS | — |

### Vendors

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `vendorsCreate` | `vendors.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `vendorsUpdate` | `vendors.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `vendorsList` | `vendors.ts` | ✅ PASS | — |
| `vendorsGet` | `vendors.ts` | ✅ PASS | — |

### Bills

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `billsUpdateDraft` | `bills\billsMutations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `billsCreate` | `bills\billsMutations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `billsList` | `bills\billsQueries.ts` | ✅ PASS | — |
| `billsGet` | `bills\billsQueries.ts` | ✅ PASS | — |
| `billsFinalize` | `bills\billsMutations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `billsVoid` | `bills\billsMutations.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `billsPreview` | `bills\billsQueries.ts` | ✅ PASS | — |

### Outflows

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `outflowsCreate` | `outflows.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `outflowsList` | `outflows.ts` | ✅ PASS | — |
| `outflowsGet` | `outflows.ts` | ✅ PASS | — |
| `outflowsVoid` | `outflows.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Payments

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `paymentsCreate` | `payments.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `paymentsVoid` | `payments.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `paymentsList` | `payments.ts` | ✅ PASS | — |

### Returns

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `returnsCreate` | `returns.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `returnsList` | `returns.ts` | ✅ PASS | — |

### Deliveries

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `deliveriesCreate` | `deliveries.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `deliveriesUpdateStatus` | `deliveries.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `deliveriesList` | `deliveries.ts` | ✅ PASS | — |
| `deliveriesGet` | `deliveries.ts` | ✅ PASS | — |

### Stock

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `stockAdjust` | `stock.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `stockMovementsList` | `stock.ts` | ✅ PASS | — |

### Tasks

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `tasksCreate` | `tasks.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `tasksUpdate` | `tasks.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `tasksAssign` | `tasks.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `tasksUpdateStatus` | `tasks.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `tasksList` | `tasks.ts` | ✅ PASS | — |
| `tasksDelete` | `tasks.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Recurring Expenses

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `recurringExpensesCreate` | `recurringExpenses.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `recurringExpensesUpdate` | `recurringExpenses.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `recurringExpensesList` | `recurringExpenses.ts` | ✅ PASS | — |

### Images

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `imagesCreateUploadSession` | `images.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `imagesAttach` | `images.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `imagesRemove` | `images.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Approvals

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `documentsDecide` | `approvals.ts` | ✅ PASS | — |

### History

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `auditGetEntityHistory` | `history.ts` | ✅ PASS | — |
| `auditLogsList` | `history.ts` | ✅ PASS | — |

### Notifications

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `notificationsRegisterFcmToken` | `notifications.ts` | ✅ PASS | — |
| `notificationsList` | `notifications.ts` | ✅ PASS | — |
| `notificationsMarkRead` | `notifications.ts` | ✅ PASS | — |

### Locations

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `locationsRecordPing` | `locations.ts` | ✅ PASS | — |
| `locationsGetLatest` | `locations.ts` | ✅ PASS | — |
| `locationsGetHistory` | `locations.ts` | ✅ PASS | — |

### Reports

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `reportsGetRevenue` | `reports\financialReports.ts` | ✅ PASS | — |
| `reportsGetProfitLoss` | `reports\financialReports.ts` | ✅ PASS | — |
| `reportsGetStockValuation` | `reports\analyticsReports.ts` | ✅ PASS | — |
| `reportsGetTopEntities` | `reports\analyticsReports.ts` | ✅ PASS | — |
| `reportsGetStaffActivity` | `reports\analyticsReports.ts` | ✅ PASS | — |
| `reportsGetPlatformOverview` | `reports\analyticsReports.ts` | ✅ PASS | — |
| `reportsExportCsv` | `reports\analyticsReports.ts` | ✅ PASS | — |
| `reportsGetPartyStatement` | `reports\operationalReports.ts` | ✅ PASS | — |
| `reportsGetOutflowSummary` | `reports\operationalReports.ts` | ✅ PASS | — |

### Usage

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `usageGetPlatformSummary` | `usage.ts` | ✅ PASS | — |
| `usageGetOrganizations` | `usage.ts` | ✅ PASS | — |
| `usageGetBranches` | `usage.ts` | ✅ PASS | — |
| `usageGetDetail` | `usage.ts` | ✅ PASS | — |
| `usageCalculateDryRunStatement` | `usage.ts` | ✅ PASS | — |
| `usageRecordClientMetric` | `usage.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `usageGetLimits` | `usage.ts` | ✅ PASS | — |
| `usageUpdateLimits` | `usage.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Reconciliation

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `reconcileStockBalances` | `reconciliation.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `reconcilePartyLedgers` | `reconciliation.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |
| `reconcileBranchCounts` | `reconciliation.ts` | ⚠️ WARN | E: No createAuditLog() call for mutation |

### Health

| Callable | File | Status | Issues |
|----------|------|--------|--------|
| `healthCheck` | `healthCheck.ts` | ✅ PASS | — |
