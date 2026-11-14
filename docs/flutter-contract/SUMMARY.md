# Trado Flutter Backend Contract — Summary Cheatsheet
<!-- ATTACH THIS FILE TO CLAUDE FOR FLUTTER CODE GENERATION -->

## 1. Response & Serialization Conventions
- **Single Entity:** `{ "<entity>": { ... } }` | **List:** `{ "items": [...], "count": N, "nextCursor": "...", "included": { ... } }`
- **Money:** Stored and returned as **integer paise** (₹1.00 = 100 paise, ₹25.50 = 2550). Divide by 100 for display.
- **Timestamps:** ISO 8601 UTC strings (`2026-11-14T05:30:00.000Z`). Local dates: `YYYY-MM-DD`.
- **Images:** Pass ImageRef `{ storagePath: "..." }`. Download URLs hydrated dynamically as `imageUrl`.

## 2. Core Entities & Form Callables
### `organization` (Organization)
- **Callables:** `organizationsCreate`, `organizationsUpdate`
- **Fields:** 17 required on create, 65 optional, 63 patchable on update.
### `branch` (Branch)
- **Callables:** `branchesCreate`, `branchesUpdate`
- **Fields:** 3 required on create, 24 optional, 25 patchable on update.
### `employee` (Employee / User)
- **Callables:** `employeesCreate`, `employeesUpdate`
- **Fields:** 6 required on create, 17 optional, 18 patchable on update.
### `customer` (Customer)
- **Callables:** `customersCreate`, `customersUpdate`
- **Fields:** 11 required on create, 47 optional, 56 patchable on update.
### `vendor` (Vendor)
- **Callables:** `vendorsCreate`, `vendorsUpdate`
- **Fields:** 11 required on create, 46 optional, 55 patchable on update.
### `product` (Product)
- **Callables:** `productsCreate`, `productsUpdate`
- **Fields:** 6 required on create, 56 optional, 56 patchable on update.
### `category` (Category)
- **Callables:** `categoriesCreate`, `categoriesUpdate`
- **Fields:** 1 required on create, 5 optional, 5 patchable on update.
### `unit` (Unit)
- **Callables:** `unitsCreate`, `unitsUpdate`
- **Fields:** 2 required on create, 7 optional, 4 patchable on update.
### `bill` (Bill / POS Sale)
- **Callables:** `billsCreate`, `billsUpdateDraft`
- **Fields:** 3 required on create, 18 optional, 15 patchable on update.
### `purchase` (Purchase (Outflow))
- **Callables:** `outflowsCreate`, `outflowsVoid`
- **Fields:** 5 required on create, 28 optional, 33 patchable on update.
### `expense` (Expense (Outflow))
- **Callables:** `outflowsCreate`, `outflowsVoid`
- **Fields:** 5 required on create, 28 optional, 33 patchable on update.
### `payment` (Payment)
- **Callables:** `paymentsCreate`, `paymentsVoid`
- **Fields:** 3 required on create, 14 optional, 17 patchable on update.
### `delivery` (Delivery)
- **Callables:** `deliveriesCreate`, `deliveriesUpdateStatus`
- **Fields:** 6 required on create, 13 optional, 4 patchable on update.
### `return` (Return)
- **Callables:** `returnsCreate`, `returnsList`
- **Fields:** 7 required on create, 7 optional, 14 patchable on update.
### `stock_adjustment` (Stock Adjustment / Wastage)
- **Callables:** `stockAdjust`, `stockGetLevels`
- **Fields:** 4 required on create, 4 optional, 8 patchable on update.
### `task` (Task)
- **Callables:** `tasksCreate`, `tasksUpdateStatus`
- **Fields:** 2 required on create, 8 optional, 2 patchable on update.

## 3. Status Lifecycles & State Machines
- **bill:** `draft` → `active` (billsFinalize) → `paid` / `void` (billsVoid)
- **outflow:** `pending` → `confirmed` → `cancelled` / `void` (outflowsVoid)
- **delivery:** `pending` → `assigned` → `in_transit` → `delivered` / `failed` / `cancelled`
- **return:** `pending` → `completed` / `rejected`
- **task:** `todo` → `in_progress` → `completed` / `cancelled`

## 4. Activity Logs (`auditLogsList`)
- **Filters:** `actorUserId`, `entityType`, `entityId`, `operation`, `status`, `branchId`, `from`, `to`, `limit`, `cursor`.
- **Row Content:** `logId`, `timestamp`, `operation`, `action`, `entityType`, `entityId`, `humanLabel`, `statusBefore`, `statusAfter`, `amount`, `currency`, `branchId`, `actorName`, `actorRole`.

## 5. Usage Quotas & Limits (`usageGetLimits`)
- **Quota Limits:** Daily & monthly firestoreWrites, firestoreReads, functionsInvocations.
- **Enforcement:** `hard_block` rejects with `USAGE_LIMIT_EXCEEDED`; `warn_only` attaches quota warnings in response.

## 6. Entity Counts Matrix
| Entity | Callables | Req Fields | Opt Fields | Updatable |
|---|---|---|---|---|
| `organization` | `organizationsCreate` | 17 | 65 | 63 |
| `branch` | `branchesCreate` | 3 | 24 | 25 |
| `employee` | `employeesCreate` | 6 | 17 | 18 |
| `customer` | `customersCreate` | 11 | 47 | 56 |
| `vendor` | `vendorsCreate` | 11 | 46 | 55 |
| `product` | `productsCreate` | 6 | 56 | 56 |
| `category` | `categoriesCreate` | 1 | 5 | 5 |
| `unit` | `unitsCreate` | 2 | 7 | 4 |
| `bill` | `billsCreate` | 3 | 18 | 15 |
| `purchase` | `outflowsCreate` | 5 | 28 | 33 |
| `expense` | `outflowsCreate` | 5 | 28 | 33 |
| `payment` | `paymentsCreate` | 3 | 14 | 17 |
| `delivery` | `deliveriesCreate` | 6 | 13 | 4 |
| `return` | `returnsCreate` | 7 | 7 | 14 |
| `stock_adjustment` | `stockAdjust` | 4 | 4 | 8 |
| `task` | `tasksCreate` | 2 | 8 | 2 |
| `role` | `rolesCreate` | 4 | 3 | 5 |
| `job_role` | `jobRolesCreate` | 1 | 4 | 5 |
| `department` | `departmentsCreate` | 2 | 3 | 5 |
| `team` | `teamsCreate` | 1 | 5 | 5 |
| `approval_request` | `approvalsDecide` | 0 | 0 | 0 |
| `recurring_expense` | `recurringExpensesCreate` | 6 | 22 | 18 |
| `plan` | `plansCreate` | 8 | 5 | 7 |