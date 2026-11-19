# Trado API Reference

This document is the single, authoritative reference for all **134 exported Cloud Functions** (128 HTTPS Callables + 5 Firestore/Auth Event Triggers + 1 scheduled sweep function) in the Trado backend. All HTTPS Callables are deployed to region `asia-south1` (Mumbai) using Cloud Functions Gen 2 on Node.js 22.

## Global Calling Convention

- **Authentication**: All endpoints require a Firebase Authentication ID token passed via the `Authorization: Bearer <token>` header or client SDK `FirebaseFunctions.instanceFor(region: "asia-south1").httpsCallable(name)`.
- **Tenant Scoping**: The active organization is derived from the caller's token custom claims (`primaryOrganizationId`); a client-supplied `organizationId` must match it (`TENANT_MISMATCH`). Subscription, plan module, permission, branch and usage checks run on every call — see [Gate, Error Reasons & Lifecycle Callables](#gate-error-reasons--lifecycle-callables-2026-11-07).
- **Branch Scoping**: When operating in multi-branch mode, requests accept `branchId`. If omitted, standard staff operate in their assigned `primaryBranchId`, and owners default to `main-branch`.
- **Idempotency**: State-mutating writes accept an optional or mandatory `idempotencyKey` UUID to guarantee zero-risk network retries.

## Function Catalog (116 Exports)

| # | Export Name | Type | Domain | Required Permission |
|---|---|---|---|---|
| 1 | `healthCheck` | Callable | General | `Public` |
| 2 | `authLogin` | Callable | General | `Public` |
| 3 | `authMe` | Callable | General | `Authenticated` |
| 3 | `organizationsCreate` | Callable | Tenancy | `Platform Super Admin` |
| 4 | `organizationsUpdate` | Callable | Tenancy | `org:manage / org:view` |
| 5 | `organizationsDeactivate` | Callable | Tenancy | `org:manage / org:view` |
| 6 | `organizationsList` | Callable | Tenancy | `org:manage / org:view` |
| 6a | `organizationsGet` | Callable | Tenancy | `org:manage / org:view` |
| 6b | `organizationsRevealBankAccount` | Callable | Tenancy | `org:manage_bank_details` |
| 7 | `branchesGetDefault` | Callable | Branch Management | `branch:view` |
| 8 | `branchesList` | Callable | Branch Management | `branch:view` |
| 9 | `branchesCreate` | Callable | Branch Management | `branch:create` |
| 10 | `branchesUpdate` | Callable | Branch Management | `branch:update` |
| 11 | `branchesDeactivate` | Callable | Branch Management | `branch:view` |
| 12 | `branchContextSwitch` | Callable | Branch Management | `branch:view` |
| 13 | `sharingPoliciesUpdate` | Callable | Branch Management | `branch:update` |
| 14 | `employeesCreate` | Callable | Staff & Memberships | `employee:create` |
| 15 | `employeesUpdate` | Callable | Staff & Memberships | `employee:update` |
| 16 | `employeesDeactivate` | Callable | Staff & Memberships | `employee:view` |
| 17 | `employeesList` | Callable | Staff & Memberships | `employee:view` |
| 17a | `employeesGet` | Callable | Staff & Memberships | `employee:view` |
| 18 | `rolesCreate` | Callable | RBAC Roles | `role:create / role:update` |
| 19 | `rolesUpdate` | Callable | RBAC Roles | `role:create / role:update` |
| 20 | `rolesList` | Callable | RBAC Roles | `role:view` |
| 21 | `departmentsCreate` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 22 | `departmentsUpdate` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 23 | `departmentsList` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 24 | `jobRolesCreate` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 25 | `jobRolesUpdate` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 26 | `jobRolesList` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 27 | `teamsCreate` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 28 | `teamsUpdate` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 29 | `teamsList` | Callable | Organization Structure | `department:manage / job_role:manage / team:manage` |
| 30 | `plansCreate` | Callable | Subscription Plans | `Platform Super Admin` |
| 31 | `plansUpdate` | Callable | Subscription Plans | `Platform Super Admin` |
| 32 | `plansList` | Callable | Subscription Plans | `Platform Super Admin` |
| 32a | `plansPreviewImpact` | Callable | Subscription Plans | `Platform Super Admin` |
| 33 | `permissionCatalogList` | Callable | General | `Authenticated` |
| 34 | `modulesList` | Callable | General | `Authenticated` |
| 35 | `taxRegimesList` | Callable | General | `Authenticated` |
| 36 | `notificationsRegisterFcmToken` | Callable | Notifications | `notification:view / Authenticated` |
| 37 | `productsCreate` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 38 | `productsUpdate` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 39 | `productsList` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 40 | `productsGet` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 41 | `categoriesCreate` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 42 | `categoriesUpdate` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 43 | `categoriesList` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 44 | `unitsCreate` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 45 | `unitsUpdate` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 46 | `unitsList` | Callable | Catalog Management | `product:* / category:* / unit:*` |
| 47 | `customersCreate` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 48 | `customersUpdate` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 49 | `customersList` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 50 | `customersGet` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 51 | `vendorsCreate` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 52 | `vendorsUpdate` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 53 | `vendorsList` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 54 | `vendorsGet` | Callable | Parties & Ledgers | `customer:* / vendor:*` |
| 55 | `outflowsCreate` | Callable | Purchases & Expenses | `outflow:create / outflow:view / outflow:approve` |
| 56 | `outflowsList` | Callable | Purchases & Expenses | `outflow:create / outflow:view / outflow:approve` |
| 57 | `outflowsGet` | Callable | Purchases & Expenses | `outflow:create / outflow:view / outflow:approve` |
| 58 | `billsCreate` | Callable | Billing & POS | `bill:create / bill:view / bill:void` |
| 59 | `billsFinalize` | Callable | Billing & POS | `bill:create / bill:view / bill:void` |
| 60 | `billsList` | Callable | Billing & POS | `bill:create / bill:view / bill:void` |
| 61 | `billsGet` | Callable | Billing & POS | `bill:create / bill:view / bill:void` |
| 61a | `billsPreview` | Callable | Billing & POS | `bill:create / bill:view / bill:void` |
| 62 | `deliveriesCreate` | Callable | Dispatch & Delivery | `delivery:view / delivery:create / delivery:assign` |
| 63 | `deliveriesUpdateStatus` | Callable | Dispatch & Delivery | `delivery:view / delivery:create / delivery:assign` |
| 64 | `deliveriesList` | Callable | Dispatch & Delivery | `delivery:view / delivery:create / delivery:assign` |
| 65 | `deliveriesGet` | Callable | Dispatch & Delivery | `delivery:view / delivery:create / delivery:assign` |
| 66 | `returnsCreate` | Callable | Returns Management | `return:create / return:view / return:approve` |
| 67 | `returnsList` | Callable | Returns Management | `return:create / return:view / return:approve` |
| 68 | `paymentsCreate` | Callable | Payments Ledger | `payment:create / payment:view / payment:void` |
| 69 | `paymentsList` | Callable | Payments Ledger | `payment:create / payment:view / payment:void` |
| 70 | `paymentsVoid` | Callable | Payments Ledger | `payment:void` |
| 71 | `stockAdjust` | Callable | Inventory & Stock | `stock:view / stock:adjust / stock:transfer` |
| 72 | `stockMovementsList` | Callable | Inventory & Stock | `stock:view / stock:adjust / stock:transfer` |
| 73 | `reconcileStockBalances` | Callable | Reconciliation Tooling | `Admin / Org Owner / Super Admin` |
| 74 | `reconcilePartyLedgers` | Callable | Reconciliation Tooling | `Admin / Org Owner / Super Admin` |
| 75 | `reconcileBranchCounts` | Callable | Reconciliation Tooling | `Admin / Org Owner / Super Admin` |
| 76 | `reportsGetRevenue` | Callable | Reporting & Analytics | `report:view` |
| 77 | `reportsGetProfitLoss` | Callable | Reporting & Analytics | `report:profit` |
| 78 | `reportsGetStockValuation` | Callable | Reporting & Analytics | `report:view` |
| 79 | `reportsGetTopEntities` | Callable | Reporting & Analytics | `report:view` |
| 80 | `reportsGetStaffActivity` | Callable | Reporting & Analytics | `report:view` |
| 81 | `reportsGetPlatformOverview` | Callable | Reporting & Analytics | `report:view` |
| 82 | `reportsExportCsv` | Callable | Reporting & Analytics | `report:export` |
| 83 | `tasksCreate` | Callable | Task Management | `task:create` |
| 84 | `tasksUpdate` | Callable | Task Management | `task:view` |
| 85 | `tasksAssign` | Callable | Task Management | `task:assign` |
| 86 | `tasksUpdateStatus` | Callable | Task Management | `task:view` |
| 87 | `tasksList` | Callable | Task Management | `task:view` |
| 88 | `tasksDelete` | Callable | Task Management | `task:view` |
| 89 | `locationsRecordPing` | Callable | Live Location Tracking | `location:ping` |
| 90 | `locationsGetLatest` | Callable | Live Location Tracking | `location:view_own / location:view_all` |
| 91 | `locationsGetHistory` | Callable | Live Location Tracking | `location:view_own / location:view_all` |
| 92 | `notificationsList` | Callable | Notifications | `notification:view / Authenticated` |
| 93 | `notificationsMarkRead` | Callable | Notifications | `notification:view / Authenticated` |
| 94 | `usageGetPlatformSummary` | Callable | Usage Metering | `Platform Super Admin (Diagnostic Only)` |
| 95 | `usageGetOrganizations` | Callable | Usage Metering | `Platform Super Admin (Diagnostic Only)` |
| 96 | `usageGetBranches` | Callable | Usage Metering | `Platform Super Admin (Diagnostic Only)` |
| 97 | `usageGetDetail` | Callable | Usage Metering | `Platform Super Admin (Diagnostic Only)` |
| 98 | `usageCalculateDryRunStatement` | Callable | Usage Metering | `Platform Super Admin (Diagnostic Only)` |
| 99 | `usageRecordClientMetric` | Callable | Usage Metering | `Platform Super Admin (Diagnostic Only)` |
| 100 | `usageGetLimits` | Callable | Usage Metering & Quotas | `Platform Super Admin / Tenant Owner` |
| 101 | `usageUpdateLimits` | Callable | Usage Metering & Quotas | `Platform Super Admin Only` |
| 102 | `organizationsReactivate` | Callable | Tenancy Governance | `Platform Super Admin` |
| 103 | `organizationsPreviewDeactivationImpact` | Callable | Tenancy Governance | `Platform Super Admin` |
| 104 | `organizationsGetSubscriptionHistory` | Callable | Tenancy Governance | `Platform Super Admin` |
| 105 | `plansGet` | Callable | Subscription Plans | `Public / Authenticated` |
| 106 | `plansArchive` | Callable | Subscription Plans | `Platform Super Admin` |
| 107 | `plansDelete` | Callable | Subscription Plans | `Platform Super Admin` |
| 108 | `platformUsersList` | Callable | Platform Directory | `Platform Super Admin` |
| 109 | `platformUsersGet` | Callable | Platform Directory | `Platform Super Admin` |
| 110 | `auditLogsList` | Callable | Audit & Compliance | `Platform Super Admin` |
| 111 | `usersUpdateMe` | Callable | User Profile | `Authenticated` |
| 112 | `imagesCreateUploadSession` | Callable | Image Pipeline | `Authenticated` |
| 113 | `imagesAttach` | Callable | Image Pipeline | `Entity Update Permission` |
| 114 | `imagesRemove` | Callable | Image Pipeline | `Entity Update Permission` |
| 115 | `organizationsProvisionUser` | Callable | Tenancy & Governance | `Platform Super Admin` |
| 116 | `organizationsTransferOwnership` | Callable | Tenancy & Governance | `Super Admin / Org Owner` |
| 117 | `onBillWritten` | Firestore Trigger | Event Automation | `System Trigger (Internal)` |
| 118 | `onOutflowWritten` | Firestore Trigger | Event Automation | `System Trigger (Internal)` |
| 119 | `onPaymentWritten` | Firestore Trigger | Event Automation | `System Trigger (Internal)` |
| 120 | `onDeliveryWritten` | Firestore Trigger | Event Automation | `System Trigger (Internal)` |
| 121 | `onStorageObjectFinalized` | Storage Trigger | Usage Metering | `System Trigger (Internal)` |
| 122 | `subscriptionAndUsageSweep` | Scheduled | Subscription Lifecycle | `System Trigger (Internal)` |

---

## API Details by Domain

### Module: `./callables/healthCheck.js` (HealthCheck)

#### `healthCheck`

- **Function Export**: `healthCheck`
- **Source File**: `functions/src/callables/healthCheck.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/healthCheck` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/healthCheck` (Emulator)
- **Summary**: Cloud function handling `healthCheck` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/authLogin.js` (AuthLogin)

#### `authLogin`

- **Function Export**: `authLogin`
- **Source File**: `functions/src/callables/authLogin.ts`
- **Calling Path**: `http://127.0.0.1:5001/trado-x/asia-south1/authLogin` (Emulator Only — strictly fails closed outside local emulator)
- **Input Schema**: `AuthLoginSchema` (`email`, `password`, `deviceId`)
- **Output Schema**: `AuthLoginResponse` (`context: AuthSessionContext`, `credentials: { idToken, expiresInSeconds }`)
- **Summary**: Local emulator testing adapter for Swagger UI / REST Client / curl. Authenticates credentials against local Auth Emulator, registers device ID, and returns canonical `AuthSessionContext` plus transport credentials (`idToken`, `expiresInSeconds`). Fails closed outside local emulator.

### Module: `./callables/authMe.js` (AuthMe)

#### `authMe`

- **Function Export**: `authMe`
- **Source File**: `functions/src/callables/authMe.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/authMe` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/authMe` (Emulator)
- **Input Schema**: `AuthMeSchema` (`deviceId`, `organizationId`, `branchId`)
- **Output Schema**: `AuthMeResponse` (`context: AuthSessionContext`, `credentials: null`)
- **Summary**: Canonical session bootstrap endpoint for Flutter Web / Mobile and web clients. Verifies caller token, registers installation device ID, and returns authoritative `AuthSessionContext` with user profile, active memberships, role, job roles, branches, 4-layer permissions, and context status. Transport credentials are null.

### Module: `./callables/organizations.js` (Organizations)

#### `organizationsCreate`

- **Function Export**: `organizationsCreate`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsCreate` (Emulator)
- **Summary**: Cloud function handling `organizationsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `organizationsUpdate`

- **Function Export**: `organizationsUpdate`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsUpdate` (Emulator)
- **Summary**: Cloud function handling `organizationsUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `organizationsDeactivate`

- **Function Export**: `organizationsDeactivate`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsDeactivate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsDeactivate` (Emulator)
- **Summary**: Cloud function handling `organizationsDeactivate` business workflow with transactional integrity and anti-embedding validation.

#### `organizationsList`

- **Function Export**: `organizationsList`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsList` (Emulator)
- **Summary**: Cloud function handling `organizationsList` business workflow with transactional integrity and anti-embedding validation.

#### `organizationsGet`

- **Function Export**: `organizationsGet`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsGet` (Emulator)
- **Summary**: Cloud function handling single organization retrieval with permission-based field trimming (Super Admin any org, Tenant Owner/Admin own org).

#### `organizationsRevealBankAccount`

- **Function Export**: `organizationsRevealBankAccount`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsRevealBankAccount` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsRevealBankAccount` (Emulator)
- **Summary**: Audited, rate-limited endpoint revealing the unmasked bank account number and routing code exclusively to authorized holders of `org:manage_bank_details`.

### Module: `./callables/branches.js` (Branches)

#### `branchesGetDefault`

- **Function Export**: `branchesGetDefault`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/branchesGetDefault` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/branchesGetDefault` (Emulator)
- **Summary**: Cloud function handling `branchesGetDefault` business workflow with transactional integrity and anti-embedding validation.

#### `branchesList`

- **Function Export**: `branchesList`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/branchesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/branchesList` (Emulator)
- **Summary**: Cloud function handling `branchesList` business workflow with transactional integrity and anti-embedding validation.

#### `branchesCreate`

- **Function Export**: `branchesCreate`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/branchesCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/branchesCreate` (Emulator)
- **Summary**: Cloud function handling `branchesCreate` business workflow with transactional integrity and anti-embedding validation.

#### `branchesUpdate`

- **Function Export**: `branchesUpdate`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/branchesUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/branchesUpdate` (Emulator)
- **Summary**: Cloud function handling `branchesUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `branchesDeactivate`

- **Function Export**: `branchesDeactivate`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/branchesDeactivate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/branchesDeactivate` (Emulator)
- **Summary**: Cloud function handling `branchesDeactivate` business workflow with transactional integrity and anti-embedding validation.

#### `branchContextSwitch`

- **Function Export**: `branchContextSwitch`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/branchContextSwitch` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/branchContextSwitch` (Emulator)
- **Summary**: Cloud function handling `branchContextSwitch` business workflow with transactional integrity and anti-embedding validation.

#### `sharingPoliciesUpdate`

- **Function Export**: `sharingPoliciesUpdate`
- **Source File**: `functions/src/callables/branches.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/sharingPoliciesUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/sharingPoliciesUpdate` (Emulator)
- **Summary**: Cloud function handling `sharingPoliciesUpdate` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/employees.js` (Employees)

#### `employeesCreate`

- **Function Export**: `employeesCreate`
- **Source File**: `functions/src/callables/employees.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/employeesCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/employeesCreate` (Emulator)
- **Summary**: Cloud function handling `employeesCreate` business workflow with transactional integrity and anti-embedding validation.

#### `employeesUpdate`

- **Function Export**: `employeesUpdate`
- **Source File**: `functions/src/callables/employees.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/employeesUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/employeesUpdate` (Emulator)
- **Summary**: Cloud function handling `employeesUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `employeesDeactivate`

- **Function Export**: `employeesDeactivate`
- **Source File**: `functions/src/callables/employees.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/employeesDeactivate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/employeesDeactivate` (Emulator)
- **Summary**: Cloud function handling `employeesDeactivate` business workflow with transactional integrity and anti-embedding validation.

#### `employeesList`

- **Function Export**: `employeesList`
- **Source File**: `functions/src/callables/employees.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/employeesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/employeesList` (Emulator)
- **Summary**: Cloud function handling `employeesList` business workflow with transactional integrity and anti-embedding validation.

#### `employeesGet`

- **Function Export**: `employeesGet`
- **Source File**: `functions/src/callables/employees.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/employeesGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/employeesGet` (Emulator)
- **Summary**: Cloud function handling detailed employee profile retrieval with permission-based trimming (phone hidden unless `employee:manage_sensitive`, overrides hidden unless Owner/Admin).

### Module: `./callables/roles.js` (Roles)

#### `rolesCreate`

- **Function Export**: `rolesCreate`
- **Source File**: `functions/src/callables/roles.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/rolesCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/rolesCreate` (Emulator)
- **Summary**: Cloud function handling `rolesCreate` business workflow with transactional integrity and anti-embedding validation.

#### `rolesUpdate`

- **Function Export**: `rolesUpdate`
- **Source File**: `functions/src/callables/roles.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/rolesUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/rolesUpdate` (Emulator)
- **Summary**: Cloud function handling `rolesUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `rolesList`

- **Function Export**: `rolesList`
- **Source File**: `functions/src/callables/roles.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/rolesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/rolesList` (Emulator)
- **Summary**: Cloud function handling `rolesList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/departments.js` (Departments)

#### `departmentsCreate`

- **Function Export**: `departmentsCreate`
- **Source File**: `functions/src/callables/departments.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/departmentsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/departmentsCreate` (Emulator)
- **Summary**: Cloud function handling `departmentsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `departmentsUpdate`

- **Function Export**: `departmentsUpdate`
- **Source File**: `functions/src/callables/departments.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/departmentsUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/departmentsUpdate` (Emulator)
- **Summary**: Cloud function handling `departmentsUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `departmentsList`

- **Function Export**: `departmentsList`
- **Source File**: `functions/src/callables/departments.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/departmentsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/departmentsList` (Emulator)
- **Summary**: Cloud function handling `departmentsList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/jobRoles.js` (JobRoles)

#### `jobRolesCreate`

- **Function Export**: `jobRolesCreate`
- **Source File**: `functions/src/callables/jobRoles.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/jobRolesCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/jobRolesCreate` (Emulator)
- **Summary**: Cloud function handling `jobRolesCreate` business workflow with transactional integrity and anti-embedding validation.

#### `jobRolesUpdate`

- **Function Export**: `jobRolesUpdate`
- **Source File**: `functions/src/callables/jobRoles.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/jobRolesUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/jobRolesUpdate` (Emulator)
- **Summary**: Cloud function handling `jobRolesUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `jobRolesList`

- **Function Export**: `jobRolesList`
- **Source File**: `functions/src/callables/jobRoles.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/jobRolesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/jobRolesList` (Emulator)
- **Summary**: Cloud function handling `jobRolesList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/teams.js` (Teams)

#### `teamsCreate`

- **Function Export**: `teamsCreate`
- **Source File**: `functions/src/callables/teams.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/teamsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/teamsCreate` (Emulator)
- **Summary**: Cloud function handling `teamsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `teamsUpdate`

- **Function Export**: `teamsUpdate`
- **Source File**: `functions/src/callables/teams.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/teamsUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/teamsUpdate` (Emulator)
- **Summary**: Cloud function handling `teamsUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `teamsList`

- **Function Export**: `teamsList`
- **Source File**: `functions/src/callables/teams.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/teamsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/teamsList` (Emulator)
- **Summary**: Cloud function handling `teamsList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/plans.js` (Plans)

#### `plansCreate`

- **Function Export**: `plansCreate`
- **Source File**: `functions/src/callables/plans.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/plansCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/plansCreate` (Emulator)
- **Summary**: Cloud function handling `plansCreate` business workflow with transactional integrity and anti-embedding validation.

#### `plansUpdate`

- **Function Export**: `plansUpdate`
- **Source File**: `functions/src/callables/plans.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/plansUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/plansUpdate` (Emulator)
- **Summary**: Cloud function handling `plansUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `plansList`

- **Function Export**: `plansList`
- **Source File**: `functions/src/callables/plans.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/plansList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/plansList` (Emulator)
- **Summary**: Cloud function handling `plansList` business workflow with transactional integrity and anti-embedding validation.

#### `plansPreviewImpact`

- **Function Export**: `plansPreviewImpact`
- **Source File**: `functions/src/callables/plans.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/plansPreviewImpact` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/plansPreviewImpact` (Emulator)
- **Summary**: Cloud function handling read-only preview of plan downgrade or upgrade impact on tenant branch limits, seat capacity, and module features.

### Module: `./callables/catalogs.js` (Catalogs)

#### `permissionCatalogList`

- **Function Export**: `permissionCatalogList`
- **Source File**: `functions/src/callables/catalogs.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/permissionCatalogList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/permissionCatalogList` (Emulator)
- **Summary**: Cloud function handling `permissionCatalogList` business workflow with transactional integrity and anti-embedding validation.

#### `modulesList`

- **Function Export**: `modulesList`
- **Source File**: `functions/src/callables/catalogs.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/modulesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/modulesList` (Emulator)
- **Summary**: Cloud function handling `modulesList` business workflow with transactional integrity and anti-embedding validation.

#### `taxRegimesList`

- **Function Export**: `taxRegimesList`
- **Source File**: `functions/src/callables/catalogs.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/taxRegimesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/taxRegimesList` (Emulator)
- **Summary**: Cloud function handling `taxRegimesList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/notifications.js` (Notifications)

#### `notificationsRegisterFcmToken`

- **Function Export**: `notificationsRegisterFcmToken`
- **Source File**: `functions/src/callables/notifications.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/notificationsRegisterFcmToken` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/notificationsRegisterFcmToken` (Emulator)
- **Summary**: Cloud function handling `notificationsRegisterFcmToken` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/products.js` (Products)

#### `productsCreate`

- **Function Export**: `productsCreate`
- **Source File**: `functions/src/callables/products.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/productsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/productsCreate` (Emulator)
- **Summary**: Cloud function handling `productsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `productsUpdate`

- **Function Export**: `productsUpdate`
- **Source File**: `functions/src/callables/products.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/productsUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/productsUpdate` (Emulator)
- **Summary**: Cloud function handling `productsUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `productsList`

- **Function Export**: `productsList`
- **Source File**: `functions/src/callables/products.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/productsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/productsList` (Emulator)
- **Summary**: Cloud function handling `productsList` business workflow with transactional integrity and anti-embedding validation.

#### `productsGet`

- **Function Export**: `productsGet`
- **Source File**: `functions/src/callables/products.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/productsGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/productsGet` (Emulator)
- **Summary**: Cloud function handling `productsGet` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/categories.js` (Categories)

#### `categoriesCreate`

- **Function Export**: `categoriesCreate`
- **Source File**: `functions/src/callables/categories.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/categoriesCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/categoriesCreate` (Emulator)
- **Summary**: Cloud function handling `categoriesCreate` business workflow with transactional integrity and anti-embedding validation.

#### `categoriesUpdate`

- **Function Export**: `categoriesUpdate`
- **Source File**: `functions/src/callables/categories.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/categoriesUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/categoriesUpdate` (Emulator)
- **Summary**: Cloud function handling `categoriesUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `categoriesList`

- **Function Export**: `categoriesList`
- **Source File**: `functions/src/callables/categories.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/categoriesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/categoriesList` (Emulator)
- **Summary**: Cloud function handling `categoriesList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/units.js` (Units)

#### `unitsCreate`

- **Function Export**: `unitsCreate`
- **Source File**: `functions/src/callables/units.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/unitsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/unitsCreate` (Emulator)
- **Summary**: Cloud function handling `unitsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `unitsUpdate`

- **Function Export**: `unitsUpdate`
- **Source File**: `functions/src/callables/units.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/unitsUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/unitsUpdate` (Emulator)
- **Summary**: Cloud function handling `unitsUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `unitsList`

- **Function Export**: `unitsList`
- **Source File**: `functions/src/callables/units.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/unitsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/unitsList` (Emulator)
- **Summary**: Cloud function handling `unitsList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/customers.js` (Customers)

#### `customersCreate`

- **Function Export**: `customersCreate`
- **Source File**: `functions/src/callables/customers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/customersCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/customersCreate` (Emulator)
- **Summary**: Cloud function handling `customersCreate` business workflow with transactional integrity and anti-embedding validation.

#### `customersUpdate`

- **Function Export**: `customersUpdate`
- **Source File**: `functions/src/callables/customers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/customersUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/customersUpdate` (Emulator)
- **Summary**: Cloud function handling `customersUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `customersList`

- **Function Export**: `customersList`
- **Source File**: `functions/src/callables/customers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/customersList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/customersList` (Emulator)
- **Summary**: Cloud function handling `customersList` business workflow with transactional integrity and anti-embedding validation.

#### `customersGet`

- **Function Export**: `customersGet`
- **Source File**: `functions/src/callables/customers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/customersGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/customersGet` (Emulator)
- **Summary**: Cloud function handling `customersGet` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/vendors.js` (Vendors)

#### `vendorsCreate`

- **Function Export**: `vendorsCreate`
- **Source File**: `functions/src/callables/vendors.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/vendorsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/vendorsCreate` (Emulator)
- **Summary**: Cloud function handling `vendorsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `vendorsUpdate`

- **Function Export**: `vendorsUpdate`
- **Source File**: `functions/src/callables/vendors.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/vendorsUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/vendorsUpdate` (Emulator)
- **Summary**: Cloud function handling `vendorsUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `vendorsList`

- **Function Export**: `vendorsList`
- **Source File**: `functions/src/callables/vendors.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/vendorsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/vendorsList` (Emulator)
- **Summary**: Cloud function handling `vendorsList` business workflow with transactional integrity and anti-embedding validation.

#### `vendorsGet`

- **Function Export**: `vendorsGet`
- **Source File**: `functions/src/callables/vendors.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/vendorsGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/vendorsGet` (Emulator)
- **Summary**: Cloud function handling `vendorsGet` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/outflows.js` (Outflows)

#### `outflowsCreate`

- **Function Export**: `outflowsCreate`
- **Source File**: `functions/src/callables/outflows.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/outflowsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/outflowsCreate` (Emulator)
- **Summary**: Cloud function handling `outflowsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `outflowsList`

- **Function Export**: `outflowsList`
- **Source File**: `functions/src/callables/outflows.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/outflowsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/outflowsList` (Emulator)
- **Summary**: Cloud function handling `outflowsList` business workflow with transactional integrity and anti-embedding validation.

#### `outflowsGet`

- **Function Export**: `outflowsGet`
- **Source File**: `functions/src/callables/outflows.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/outflowsGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/outflowsGet` (Emulator)
- **Summary**: Cloud function handling `outflowsGet` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/bills.js` (Bills)

#### `billsCreate`

- **Function Export**: `billsCreate`
- **Source File**: `functions/src/callables/bills.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/billsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/billsCreate` (Emulator)
- **Summary**: Cloud function handling `billsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `billsFinalize`

- **Function Export**: `billsFinalize`
- **Source File**: `functions/src/callables/bills.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/billsFinalize` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/billsFinalize` (Emulator)
- **Summary**: Cloud function handling `billsFinalize` business workflow with transactional integrity and anti-embedding validation.

#### `billsList`

- **Function Export**: `billsList`
- **Source File**: `functions/src/callables/bills.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/billsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/billsList` (Emulator)
- **Summary**: Cloud function handling `billsList` business workflow with transactional integrity and anti-embedding validation.

#### `billsGet`

- **Function Export**: `billsGet`
- **Source File**: `functions/src/callables/bills.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/billsGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/billsGet` (Emulator)
- **Summary**: Cloud function handling `billsGet` business workflow with transactional integrity and anti-embedding validation.

#### `billsPreview`

- **Function Export**: `billsPreview`
- **Source File**: `functions/src/callables/bills.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/billsPreview` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/billsPreview` (Emulator)
- **Summary**: Read-only pricing preview endpoint using identical calculation pipeline as `billsCreate`, providing non-blocking warnings for stock shortfalls, discount ceiling breaches, and non-discountable items without writing records or mutating counters.

### Module: `./callables/deliveries.js` (Deliveries)

#### `deliveriesCreate`

- **Function Export**: `deliveriesCreate`
- **Source File**: `functions/src/callables/deliveries.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/deliveriesCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/deliveriesCreate` (Emulator)
- **Summary**: Cloud function handling `deliveriesCreate` business workflow with transactional integrity and anti-embedding validation.

#### `deliveriesUpdateStatus`

- **Function Export**: `deliveriesUpdateStatus`
- **Source File**: `functions/src/callables/deliveries.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/deliveriesUpdateStatus` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/deliveriesUpdateStatus` (Emulator)
- **Summary**: Cloud function handling `deliveriesUpdateStatus` business workflow with transactional integrity and anti-embedding validation.

#### `deliveriesList`

- **Function Export**: `deliveriesList`
- **Source File**: `functions/src/callables/deliveries.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/deliveriesList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/deliveriesList` (Emulator)
- **Summary**: Cloud function handling `deliveriesList` business workflow with transactional integrity and anti-embedding validation.

#### `deliveriesGet`

- **Function Export**: `deliveriesGet`
- **Source File**: `functions/src/callables/deliveries.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/deliveriesGet` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/deliveriesGet` (Emulator)
- **Summary**: Cloud function handling `deliveriesGet` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/returns.js` (Returns)

#### `returnsCreate`

- **Function Export**: `returnsCreate`
- **Source File**: `functions/src/callables/returns.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/returnsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/returnsCreate` (Emulator)
- **Summary**: Cloud function handling `returnsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `returnsList`

- **Function Export**: `returnsList`
- **Source File**: `functions/src/callables/returns.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/returnsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/returnsList` (Emulator)
- **Summary**: Cloud function handling `returnsList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/payments.js` (Payments)

#### `paymentsCreate`

- **Function Export**: `paymentsCreate`
- **Source File**: `functions/src/callables/payments.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/paymentsCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/paymentsCreate` (Emulator)
- **Summary**: Cloud function handling `paymentsCreate` business workflow with transactional integrity and anti-embedding validation.

#### `paymentsList`

- **Function Export**: `paymentsList`
- **Source File**: `functions/src/callables/payments.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/paymentsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/paymentsList` (Emulator)
- **Summary**: Cloud function handling `paymentsList` business workflow with transactional integrity and anti-embedding validation.

#### `paymentsVoid`

- **Function Export**: `paymentsVoid`
- **Source File**: `functions/src/callables/payments.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/paymentsVoid` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/paymentsVoid` (Emulator)
- **Permission**: `payment:void`
- **Summary**: Voids a completed payment entry. Reverses the settlement on the linked bill/outflow (restores paidAmount/balanceAmount/paymentStatus) and restores the party's outstanding balance (customer receivable or vendor payable). Idempotent — rejects double-void with `failed-precondition`. Cross-tenant access rejected. Only reverses document settlement when the linked document is still active/confirmed.
- **Input**: `{ paymentId: string, reason: string, idempotencyKey?: string }`
- **Output**: `{ paymentId, paymentNumber, status: "voided", reversedDocumentId, message }`

### Module: `./callables/stock.js` (Stock)

#### `stockAdjust`

- **Function Export**: `stockAdjust`
- **Source File**: `functions/src/callables/stock.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/stockAdjust` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/stockAdjust` (Emulator)
- **Summary**: Cloud function handling `stockAdjust` business workflow with transactional integrity and anti-embedding validation.

#### `stockMovementsList`

- **Function Export**: `stockMovementsList`
- **Source File**: `functions/src/callables/stock.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/stockMovementsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/stockMovementsList` (Emulator)
- **Summary**: Cloud function handling `stockMovementsList` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/reconciliation.js` (Reconciliation)

#### `reconcileStockBalances`

- **Function Export**: `reconcileStockBalances`
- **Source File**: `functions/src/callables/reconciliation.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reconcileStockBalances` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reconcileStockBalances` (Emulator)
- **Summary**: Cloud function handling `reconcileStockBalances` business workflow with transactional integrity and anti-embedding validation.

#### `reconcilePartyLedgers`

- **Function Export**: `reconcilePartyLedgers`
- **Source File**: `functions/src/callables/reconciliation.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reconcilePartyLedgers` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reconcilePartyLedgers` (Emulator)
- **Summary**: Cloud function handling `reconcilePartyLedgers` business workflow with transactional integrity and anti-embedding validation.

#### `reconcileBranchCounts`

- **Function Export**: `reconcileBranchCounts`
- **Source File**: `functions/src/callables/reconciliation.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reconcileBranchCounts` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reconcileBranchCounts` (Emulator)
- **Summary**: Cloud function handling `reconcileBranchCounts` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/reports.js` (Reports)

#### `reportsGetRevenue`

- **Function Export**: `reportsGetRevenue`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsGetRevenue` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsGetRevenue` (Emulator)
- **Summary**: Cloud function handling `reportsGetRevenue` business workflow with transactional integrity and anti-embedding validation.

#### `reportsGetProfitLoss`

- **Function Export**: `reportsGetProfitLoss`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsGetProfitLoss` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsGetProfitLoss` (Emulator)
- **Summary**: Cloud function handling `reportsGetProfitLoss` business workflow with transactional integrity and anti-embedding validation.

#### `reportsGetStockValuation`

- **Function Export**: `reportsGetStockValuation`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsGetStockValuation` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsGetStockValuation` (Emulator)
- **Summary**: Cloud function handling `reportsGetStockValuation` business workflow with transactional integrity and anti-embedding validation.

#### `reportsGetTopEntities`

- **Function Export**: `reportsGetTopEntities`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsGetTopEntities` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsGetTopEntities` (Emulator)
- **Summary**: Cloud function handling `reportsGetTopEntities` business workflow with transactional integrity and anti-embedding validation.

#### `reportsGetStaffActivity`

- **Function Export**: `reportsGetStaffActivity`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsGetStaffActivity` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsGetStaffActivity` (Emulator)
- **Summary**: Cloud function handling `reportsGetStaffActivity` business workflow with transactional integrity and anti-embedding validation.

#### `reportsGetPlatformOverview`

- **Function Export**: `reportsGetPlatformOverview`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsGetPlatformOverview` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsGetPlatformOverview` (Emulator)
- **Summary**: Cloud function handling `reportsGetPlatformOverview` business workflow with transactional integrity and anti-embedding validation.

#### `reportsExportCsv`

- **Function Export**: `reportsExportCsv`
- **Source File**: `functions/src/callables/reports.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/reportsExportCsv` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/reportsExportCsv` (Emulator)
- **Summary**: Cloud function handling `reportsExportCsv` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/tasks.js` (Tasks)

#### `tasksCreate`

- **Function Export**: `tasksCreate`
- **Source File**: `functions/src/callables/tasks.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/tasksCreate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/tasksCreate` (Emulator)
- **Summary**: Cloud function handling `tasksCreate` business workflow with transactional integrity and anti-embedding validation.

#### `tasksUpdate`

- **Function Export**: `tasksUpdate`
- **Source File**: `functions/src/callables/tasks.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/tasksUpdate` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/tasksUpdate` (Emulator)
- **Summary**: Cloud function handling `tasksUpdate` business workflow with transactional integrity and anti-embedding validation.

#### `tasksAssign`

- **Function Export**: `tasksAssign`
- **Source File**: `functions/src/callables/tasks.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/tasksAssign` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/tasksAssign` (Emulator)
- **Summary**: Cloud function handling `tasksAssign` business workflow with transactional integrity and anti-embedding validation.

#### `tasksUpdateStatus`

- **Function Export**: `tasksUpdateStatus`
- **Source File**: `functions/src/callables/tasks.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/tasksUpdateStatus` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/tasksUpdateStatus` (Emulator)
- **Summary**: Cloud function handling `tasksUpdateStatus` business workflow with transactional integrity and anti-embedding validation.

#### `tasksList`

- **Function Export**: `tasksList`
- **Source File**: `functions/src/callables/tasks.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/tasksList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/tasksList` (Emulator)
- **Summary**: Cloud function handling `tasksList` business workflow with transactional integrity and anti-embedding validation.

#### `tasksDelete`

- **Function Export**: `tasksDelete`
- **Source File**: `functions/src/callables/tasks.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/tasksDelete` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/tasksDelete` (Emulator)
- **Summary**: Cloud function handling `tasksDelete` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/locations.js` (Locations)

#### `locationsRecordPing`

- **Function Export**: `locationsRecordPing`
- **Source File**: `functions/src/callables/locations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/locationsRecordPing` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/locationsRecordPing` (Emulator)
- **Summary**: Cloud function handling `locationsRecordPing` business workflow with transactional integrity and anti-embedding validation.

#### `locationsGetLatest`

- **Function Export**: `locationsGetLatest`
- **Source File**: `functions/src/callables/locations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/locationsGetLatest` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/locationsGetLatest` (Emulator)
- **Summary**: Cloud function handling `locationsGetLatest` business workflow with transactional integrity and anti-embedding validation.

#### `locationsGetHistory`

- **Function Export**: `locationsGetHistory`
- **Source File**: `functions/src/callables/locations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/locationsGetHistory` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/locationsGetHistory` (Emulator)
- **Summary**: Cloud function handling `locationsGetHistory` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/notifications.js` (Notifications)

#### `notificationsList`

- **Function Export**: `notificationsList`
- **Source File**: `functions/src/callables/notifications.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/notificationsList` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/notificationsList` (Emulator)
- **Summary**: Cloud function handling `notificationsList` business workflow with transactional integrity and anti-embedding validation.

#### `notificationsMarkRead`

- **Function Export**: `notificationsMarkRead`
- **Source File**: `functions/src/callables/notifications.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/notificationsMarkRead` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/notificationsMarkRead` (Emulator)
- **Summary**: Cloud function handling `notificationsMarkRead` business workflow with transactional integrity and anti-embedding validation.

### Module: `./callables/usage.js` (Usage)

#### `usageGetPlatformSummary`

- **Function Export**: `usageGetPlatformSummary`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageGetPlatformSummary` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageGetPlatformSummary` (Emulator)
- **Summary**: Cloud function handling `usageGetPlatformSummary` business workflow with transactional integrity and anti-embedding validation.

#### `usageGetOrganizations`

- **Function Export**: `usageGetOrganizations`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageGetOrganizations` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageGetOrganizations` (Emulator)
- **Summary**: Cloud function handling `usageGetOrganizations` business workflow with transactional integrity and anti-embedding validation.

#### `usageGetBranches`

- **Function Export**: `usageGetBranches`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageGetBranches` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageGetBranches` (Emulator)
- **Summary**: Cloud function handling `usageGetBranches` business workflow with transactional integrity and anti-embedding validation.

#### `usageGetDetail`

- **Function Export**: `usageGetDetail`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageGetDetail` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageGetDetail` (Emulator)
- **Summary**: Cloud function handling `usageGetDetail` business workflow with transactional integrity and anti-embedding validation.

#### `usageCalculateDryRunStatement`

- **Function Export**: `usageCalculateDryRunStatement`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageCalculateDryRunStatement` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageCalculateDryRunStatement` (Emulator)
- **Summary**: Cloud function handling `usageCalculateDryRunStatement` business workflow with transactional integrity and anti-embedding validation.

#### `usageRecordClientMetric`

- **Function Export**: `usageRecordClientMetric`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageRecordClientMetric` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageRecordClientMetric` (Emulator)
- **Summary**: Cloud function handling `usageRecordClientMetric` business workflow with transactional integrity and anti-embedding validation.

#### `usageGetLimits`

- **Function Export**: `usageGetLimits`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageGetLimits` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageGetLimits` (Emulator)
- **Summary**: Retrieves effective daily and monthly usage limits, current consumption, and threshold warning status for an organization. Accessible by Super Admin or Tenant Owner/Admin.

#### `usageUpdateLimits`

- **Function Export**: `usageUpdateLimits`
- **Source File**: `functions/src/callables/usage.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usageUpdateLimits` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usageUpdateLimits` (Emulator)
- **Summary**: Configures organization-specific usage limit overrides (thresholds, daily/monthly allowances, enforcement mode). Strictly Super Admin only; audited to auditLogs.

### Module: `./triggers/eventTriggers.js` (EventTriggers)

#### `onBillWritten`

- **Function Export**: `onBillWritten`
- **Source File**: `functions/src/callables/eventTriggers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/onBillWritten` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/onBillWritten` (Emulator)
- **Summary**: Cloud function handling `onBillWritten` business workflow with transactional integrity and anti-embedding validation.

#### `onOutflowWritten`

- **Function Export**: `onOutflowWritten`
- **Source File**: `functions/src/callables/eventTriggers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/onOutflowWritten` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/onOutflowWritten` (Emulator)
- **Summary**: Cloud function handling `onOutflowWritten` business workflow with transactional integrity and anti-embedding validation.

#### `onPaymentWritten`

- **Function Export**: `onPaymentWritten`
- **Source File**: `functions/src/callables/eventTriggers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/onPaymentWritten` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/onPaymentWritten` (Emulator)
- **Summary**: Cloud function handling `onPaymentWritten` business workflow with transactional integrity and anti-embedding validation.

#### `onDeliveryWritten`

- **Function Export**: `onDeliveryWritten`
- **Source File**: `functions/src/callables/eventTriggers.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/onDeliveryWritten` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/onDeliveryWritten` (Emulator)
- **Summary**: Cloud function handling `onDeliveryWritten` business workflow with transactional integrity and anti-embedding validation.

---

## Gate, Error Reasons & Lifecycle Callables (2026-11-07)

> The authoritative callable → permission → plan-module matrix is generated from source by
> `scripts/check-gate-conformance.js` into [the callable inventory](audit/callable-and-trigger-inventory.md#gate--permission-matrix-generated-by-scriptscheck-gate-conformancejs).
> Where the catalog table above disagrees, the generated matrix wins.

### Gate order and stable error reasons

Every tenant callable runs one gate (`functions/src/services/contextResolver.ts`): authenticated → user active → membership active → organization active → subscription valid → plan includes module → org/branch module toggle → permission (deny wins) → branch exists/active/assigned → usage limit → business logic.
Failures carry `error.details.reason` and a `[REASON]` message prefix:

| Reason | HTTPS code | Client action |
|---|---|---|
| `UNAUTHENTICATED` | unauthenticated | sign in |
| `USER_INACTIVE`, `NO_MEMBERSHIP`, `MEMBERSHIP_INACTIVE` | permission-denied | sign out / contact admin |
| `ORG_NOT_FOUND`, `ORG_INACTIVE` | not-found / failed-precondition | locked tenant screen |
| `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_SUSPENDED`, `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_NOT_STARTED` | failed-precondition | renewal screen (also `authMe.contextStatus`) |
| `MODULE_NOT_IN_PLAN` | permission-denied | upgrade prompt |
| `MODULE_DISABLED` | permission-denied | feature turned off by Owner |
| `PERMISSION_DENIED` | permission-denied | hide action |
| `TENANT_MISMATCH` | permission-denied / invalid-argument | client bug: wrong organizationId |
| `BRANCH_NOT_FOUND`, `BRANCH_INACTIVE`, `BRANCH_NOT_ASSIGNED` | not-found / failed-precondition / permission-denied | branch picker |
| `SUPER_ADMIN_TENANT_FORBIDDEN` | permission-denied | Super Admin is platform-only |
| `USAGE_LIMIT_EXCEEDED` | resource-exhausted | limit banner; `details` has metric, period, usage, limit |
| `PLAN_LIMIT_REACHED` | resource-exhausted | seat/branch limit |
| `FIELD_NOT_EDITABLE` | permission-denied | `details.fields` lists rejected fields |

Super Admin may run `platform:*` callables and read-only tenant views (support); never tenant mutations.

### Module: `./callables/bills.js` — lifecycle

- `billsUpdateDraft` — `bill:update`. Input `{ billId, items?, notes?, idempotencyKey? }`. Updates a draft invoice or quotation (recalculates pricing and total). Audited with field changes in entity history. Finalized invoices are immutable and reject draft updates with `DOCUMENT_IMMUTABLE`.
- `documentsDecide` — `bill:approve`. Unified maker-checker decision router. Input `{ documentType: "bill", documentId, decision: "approve"|"reject", reason? }`. Applies the held stock, customer-ledger and tender payment on approve; `rejected` leaves no effect. Makers cannot approve their own bills.
- `billsVoid` — `bill:void`. Input `{ documentId, reason, idempotencyKey? }`. Active bill → `voided` with stock returned, customer `totalSpend`/`outstandingBalance` reversed and linked payments voided; drafts / pending → `cancelled` (reservation released). Rejected when non-voided returns exist.
- `billsCreate` changes: sales orders reserve stock (`allocatedStock`) instead of deducting; line `unit` may be an alternate unit (`conversionFactor`, `baseQuantity` frozen); discounts need `bill:discount`; discount above `maxDiscountPercent` or a credit-limit breach routes the bill to `pending_approval`; B2B requires `customerId`.

### Module: `./callables/approvals.js` — unified maker-checker

- `documentsDecide` — maker-checker decision router across bills, purchases/expenses, returns, and stock adjustments. Input `{ documentType: "bill"|"outflow"|"return"|"stock_adjustment", documentId, decision: "approve"|"reject", reason?, idempotencyKey? }`.

### Module: `./callables/recurringExpenses.js` — recurring expense templates

- `recurringExpensesCreate` — `expense:create` / `outflow:create`. Creates a recurring expense schedule.
- `recurringExpensesUpdate` — `expense:create` / `outflow:create`. Updates template details or active state.
- `recurringExpensesList` — `expense:view` / `outflow:view`. Lists recurring expense templates for the organization.

### Module: `./callables/outflows.js` — lifecycle

- `documentsDecide` — `purchase:approve` / `expense:approve` / `outflow:approve`. Unified maker-checker decision router across document types.
- `outflowsVoid` — `purchase:void` / `expense:void` / `outflow:void`. Reverses good units received, vendor payable/total purchase, voids payments, releases the vendor-invoice lock.
- `outflowsCreate` changes: per-vendor unique `invoiceNumber`; lines accept `damagedQuantity`/`damageReason` (written off at receipt) and `serialNumbers`; `payeeType` (`vendor`|`employee`|`other`), `payeeMembershipId` (sensitive, needs `expense:view_sensitive` to read), `expenseCategoryId`, `billDiscountAmount`/`billDiscountPercent`, `attachmentPaths`.

### Module: `./callables/organizations.js` — subscriptions

- `organizationsSetSubscription` — Super Admin only. Input `{ organizationId, action: "set"|"renew"|"extend"|"suspend"|"reactivate"|"cancel"|"change_plan", planId?, expiresOn? (YYYY-MM-DD), durationDays?, extendDays?, graceDays?, reason? }`. Returns the stored fields, an `evaluation`, and `overLimit` (`branches`/`employees`) after a downgrade.
- `organizationsUpdate` field policy: Super Admin — `name`, `businessType`, `businessCategory`, `moduleToggles`, `salesChannels`, `timezone` (+ all Owner fields); Owner — `displayName`, `image`, `uploadId`, `taxId`, `website`, `contact`, `contacts`, `addresses`, `bankAccounts`, `settings.approvals`; Admin — none. Unknown fields → `INVALID_ARGUMENT`.

### Module: `./callables/teams.js`

- `teamsAssignMember` — `team:manage`, or the team leader (own reportees / unassigned staff). Input `{ teamId, membershipId, action: "add"|"remove" }`.

### Module: `./callables/products.js`

- `productsGetPriceHistory` — product read permission. Purchase cost trend per base unit (last/min/max/quantity-weighted average, per vendor) derived from purchase lines (cost needs `product:view_cost`), and selling-price/MRP/wholesale/cost changes from change history.

### Module: `./callables/history.js`

- `auditGetEntityHistory` — `audit:view`. Input `{ entityType, entityId, limit? }`. Immutable change history: action, actor (name resolved at read), time, `changes[{field, from, to}]`.

### Module: `./callables/reports.js` — statements & outflow

- `reportsGetPartyStatement` — vendor: `vendor:view_balance` or `payment:view`; customer: `customer:view_balance` or `payment:view`. Input `{ partyType, partyId, from?, to?, branchId? }`. Opening/closing balance, entries with running balance, per-document paid status, day-wise totals, ageing (current, 1–30, 31–60, 61–90, 90+), and `ledgerBalance` for cross-check.
- `reportsGetOutflowSummary` — `report:view` / `outflow:view`. `accrual.totalOutflow = purchases + expenses`, `cash.paid`, grouped by day/category/employee/vendor/branch. Never add `totalOutflow` to the P&L (purchases reach it only as COGS).
- `reportsGetProfitLoss` now returns `inventoryWriteOff` (damage/expiry/theft/samples/internal use/count shortfall/damaged on receipt at movement cost) and `netProfit = grossProfit − expenses − inventoryWriteOff`.
- `reportsGetStaffActivity` now covers sales, purchases, expenses, returns, deliveries, stock adjustments, approvals and tasks per employee, scoped (Owner/Admin all, managers team, others self).

### Module: `./callables/platformUsers.js` (Super Admin Platform Users Directory)

- `platformUsersList` — `platform:user:view`. Super Admin only. Input `{ organizationId?, roleId?, status?, branchId?, q?, limit?, cursor? }`. Cursor pagination, embedded user memberships, and normalized `included` map of organizations and roles.
- `platformUsersGet` — `platform:user:view`. Super Admin only. Input `{ userId }`. Detailed user profile, all organization memberships, assigned branch IDs, and server-computed effective permissions across all four layers.

### Module: `./callables/plans.js` (Extended Platform Callables)

- `plansGet` — Public / Authenticated. Input `{ planId }`. Retrieves subscription plan details. Direct reads in rules restricted to active, public plans; private/archived plans accessible by Super Admin.
- `plansArchive` — `platform:plan:manage`. Super Admin only. Input `{ planId, reason? }`. Safely sets `isArchived: true` so no new organizations can select it while preserving existing subscriptions.
- `plansDelete` — `platform:plan:manage`. Super Admin only. Input `{ planId }`. Permanently deletes unreferenced, unused plans; strictly rejects deletion with `FAILED_PRECONDITION` if any organization references it.

### Module: `./callables/organizations.js` (Extended Tenancy Governance)

- `organizationsReactivate` — `platform:org:deactivate`. Super Admin only. Input `{ organizationId, reason? }`. Reactivates a suspended organization and records audit log.
- `organizationsPreviewDeactivationImpact` — `platform:org:deactivate`. Super Admin only. Input `{ organizationId }`. Read-only impact report calculating total affected users, active branches, open unpaid bills/outflows, outstanding balances, and active subscription details.
- `organizationsGetSubscriptionHistory` — `platform:org:view`. Super Admin only. Input `{ organizationId, limit? }`. Returns immutable subscription change chronology derived from audit logs with actor and plan name hydration.

### Module: `./callables/history.js` (Extended Platform Activity Logs)

- `auditLogsList` — `platform:audit:view`. Super Admin only. Input `{ actorUserId?, organizationId?, entityType?, entityId?, action?, from?, to?, limit?, cursor? }`. Platform-wide audit trail search with cursor pagination, secret scrubbing (redacted passwords, tokens, API keys), and normalized `included` references for actors and organizations.

### Scheduled: `./triggers/scheduled.js`

- `subscriptionAndUsageSweep` — daily 02:00 Asia/Kolkata. Expiry reminders 7/3/1 days before, `subscriptionStatus → expired` after expiry + grace, usage warnings; idempotent (re-runs never duplicate notifications).

## Interactive API Explorer & OpenAPI Contract

The Trado backend includes a **generated OpenAPI 3.0.3 specification** ([`docs/openapi.json`](openapi.json)) covering all 101 HTTPS callables with typed request schemas derived from Zod validation.

### Quick Start

```powershell
# 1. Compile backend functions
npm --prefix functions run build

# 2. Start Firebase Emulators (Terminal 1)
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x

# 3. Seed demo organizations & personas (Terminal 2)
node functions/lib/scripts/seed-emulator.js --profile api-explorer-demo

# 4. Generate OpenAPI specification (Terminal 2)
node scripts/generate-openapi.js

# 5. Launch Local API Explorer (Terminal 2)
node tools/api-explorer/server.js
# → Open browser to http://127.0.0.1:3939
```

### Module: `./callables/users.js` (User Profile)

#### `usersUpdateMe`
- **Function Export**: `usersUpdateMe`
- **Source File**: `functions/src/callables/users.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/usersUpdateMe` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/usersUpdateMe` (Emulator)
- **Input Schema**: `UpdateMeSchema` (`name`, `phone`, `image`, `uploadId`, `clientRequestId`)
- **Output Schema**: `{ success: boolean, message: string, user: UserDoc }`
- **Summary**: Updates authenticated user's profile including name, normalized phone, and avatar image.

### Module: `./callables/images.js` (Image Pipeline)

#### `imagesCreateUploadSession`
- **Function Export**: `imagesCreateUploadSession`
- **Source File**: `functions/src/callables/images.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/imagesCreateUploadSession` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/imagesCreateUploadSession` (Emulator)
- **Input Schema**: `CreateImageUploadSessionSchema` (`organizationId`, `branchId`, `purpose`, `entityType`, `entityId`, `contentType`, `sizeBytes`, `clientRequestId`)
- **Output Schema**: `{ uploadId: string, uploadPath: string, expiresAt: string, maxBytes: number, purpose: string }`
- **Summary**: Creates a scoped temporary upload session for raw client asset uploads (raw max 5MB).

#### `imagesAttach`
- **Function Export**: `imagesAttach`
- **Source File**: `functions/src/callables/images.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/imagesAttach` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/imagesAttach` (Emulator)
- **Input Schema**: `AttachImageSchema` (`organizationId`, `branchId`, `uploadId`, `entityType`, `entityId`, `clientRequestId`)
- **Output Schema**: `{ success: boolean, image: ImageRef, previousImageDeleted: boolean }`
- **Summary**: Processes temporary upload via sharp (WebP conversion, metadata stripping, magic byte validation) and links to target entity.

#### `imagesRemove`
- **Function Export**: `imagesRemove`
- **Source File**: `functions/src/callables/images.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/imagesRemove` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/imagesRemove` (Emulator)
- **Input Schema**: `RemoveImageSchema` (`organizationId`, `branchId`, `entityType`, `entityId`, `clientRequestId`)
- **Output Schema**: `{ success: boolean, message: string }`
- **Summary**: Unlinks and purges image asset from target entity and storage bucket.

### Module: `./callables/organizations.js` (Onboarding & Governance Additions)

#### `organizationsProvisionUser`
- **Function Export**: `organizationsProvisionUser`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsProvisionUser` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsProvisionUser` (Emulator)
- **Input Schema**: `ProvisionUserSchema` (`organizationId`, `role`, `user`, `credentialMode`, `reason`, `clientRequestId`)
- **Output Schema**: `{ success: boolean, userId: string, membershipId: string, role: string, temporaryPassword?: string, inviteLink?: string, userCreated: boolean }`
- **Summary**: Platform Super Admin provisions an Owner or Admin for an organization with transactional membership creation and rollback compensation.

#### `organizationsTransferOwnership`
- **Function Export**: `organizationsTransferOwnership`
- **Source File**: `functions/src/callables/organizations.ts`
- **Calling Path**: `POST https://asia-south1-trado-x.cloudfunctions.net/organizationsTransferOwnership` (Production) or `http://127.0.0.1:5001/trado-x/asia-south1/organizationsTransferOwnership` (Emulator)
- **Input Schema**: `TransferOwnershipSchema` (`organizationId`, `newOwnerUserId`, `previousOwnerAction`, `reason`, `clientRequestId`)
- **Output Schema**: `{ success: boolean, organizationId: string, newOwnerUserId: string, previousOwnerUserId: string | null, previousOwnerAction: string }`
- **Summary**: Transfers organization ownership to an active member while demoting or deactivating the previous owner in a single atomic transaction.

### Module: `./callables/approvals.js` (Maker-Checker Decisions)
- `approvalsList`
- `approvalsCounts`

### Module: `./callables/financialAccounts.js` (Financial Accounts & Transfers)
- `financialAccountsCreate`
- `financialAccountsUpdate`
- `financialAccountsList`
- `financialAccountsGet`
- `financialAccountsGetLedger`
- `accountTransfersCreate`
- `accountTransfersList`
- `accountTransfersGet`
- `capitalTransactionsCreate`
- `capitalTransactionsList`

### Module: `./callables/paymentFees.js` (Payment Gateway & Fee Tracking)
- `paymentsRecordFee`
- `paymentsVerifyFee`
- `paymentsDisputeFee`
- `paymentsReverseFee`
- `paymentsListFees`
- `paymentsGetFee`

### Module: `./callables/ledgerVerify.js` (Ledger Invariant Verification)
- `ledgerVerify`
- `reportsGetTrialBalance`

### Module: `./callables/storageLocations.js` (Warehouse & Storage Locations)
- `storageLocationsCreate`
- `storageLocationsUpdate`
- `storageLocationsList`
- `storageLocationsGet`

### Module: `./callables/stockTransfers.js` (Inter-Branch Stock Transfers)
- `stockTransfersCreate`
- `stockTransfersSubmit`
- `stockTransfersCancel`
- `stockTransfersDispatch`
- `stockTransfersReceive`
- `stockTransfersResolveDiscrepancy`
- `stockTransfersList`
- `stockTransfersGet`

### Module: `./callables/stockVerify.js` (Stock Invariant Verification)
- `stockVerify`

### Module: `./callables/reports.js` (Operational Reports Additions)
- `reportsGetReceivablesAgeing`
- `reportsGetPayablesAgeing`
- `reportsGetCashBankSummary`

### Module: `./callables/requests.js` (Tenant Requests & Support Desk)
- `requestsMeta`
- `plansCatalogList`
- `requestsCreate`
- `requestsUpdate`
- `requestsAddComment`
- `requestsTransition`
- `requestsGet`
- `requestsList`
- `requestsActivityList`
- `requestsCounts`
- `requestsInboxList`
- `requestsInboxCounts`
- `requestsAssign`
- `requestsSetPriority`
- `requestsAddInternalNote`
- `requestsApply`
- `requestsSettingsGet`
- `requestsSettingsUpdate`

### Money, Stock & Account Integrity (Prompt 77)
- `accountEntriesList`
- `accountEntriesGet`
- `accountEntriesCounts`
- `accountEntriesVerify`
- `accountEntriesApprove`
- `accountEntriesReject`
- `accountEntriesReverse`
- `accountEntriesUpdateNote`
- `accountEntriesCreateSubEntry`
- `accountingPolicyGet`
- `accountingPolicyUpdate`
- `accountTransfersConfirm`
- `accountTransfersDispute`
- `cashCountsCreate`
- `cashCountsList`
- `cashCountsGet`
- `accountEntriesRecordFee`
- `reportsGetBranchSummary`

### Triggers & Scheduled Jobs
- `onRequestActivityWritten`
- `requestsSlaAndLifecycleSweep`

### Related Resources

| Resource | Path | Purpose |
|----------|------|---------|
| OpenAPI Spec | [`docs/openapi.json`](openapi.json) | Machine-readable 101-callable contract |
| Flutter Client Guide | [`docs/flutter-client-integration.md`](flutter-client-integration.md) | Canonical Flutter Web integration & DTO guide |
| API Explorer | [`tools/api-explorer/server.js`](../tools/api-explorer/server.js) | Local Swagger UI with persona login |
| Manual Testing Guide | [`docs/manual-api-testing-guide.md`](manual-api-testing-guide.md) | Step-by-step beginner walkthrough |
| .http Collection | [`scripts/manual-tests/trado-api.http`](../scripts/manual-tests/trado-api.http) | VS Code REST Client requests |
| CLI Workbench | [`functions/scripts/test-api-workbench.js`](../functions/scripts/test-api-workbench.js) | Terminal-based callable testing |

> [!NOTE]
> The API Explorer is a **local-only developer tool** — it binds exclusively to `127.0.0.1` and rejects any production target configuration.

