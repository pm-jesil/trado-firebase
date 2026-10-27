# Trado Firebase Backend — Phase 2 Baseline Report

## 1. Executive Summary & Transition from Phase 1

This baseline documents the operational expansion of the Trado Firebase Backend into **Phase 2 (Operational Core)**, building directly upon the Phase 1 identity, multi-tenancy, RBAC, idempotency, and security rules foundation.

All work continues within the established project parameters:
- **Workspace**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`
- **Firebase Project ID**: `trado-x` (Number: `293471017332`)
- **Default Region**: `asia-south1` (Mumbai)
- **Execution Mode**: Local Firebase Emulator Suite (strictly NO `firebase deploy`, NO production changes)
- **Source of Truth for Business Rules**: `C:\Users\jesil.p\Project\Nest Js\testing-trado-api`

---

## 2. Phase 1 Closeout Verification (Part 0)

Before executing Phase 2 core operational modules, two critical Phase 1 architectural items were closed out and verified:

### 2.1 Generic `role_employee` System Role
- **Change**: Added `role_employee` as the 3rd built-in platform system role (`DEFAULT_SYSTEM_ROLES`), representing the baseline employee tier with default view permissions (`org:view`, `employee:view`).
- **Reclassification**: Reclassified operational specializations `role_cashier` and `role_inventory_clerk` out of system roles and into `jobRoles` (`job_cashier`, `job_inventory_clerk`) and `STARTER_CUSTOM_ROLE_TEMPLATES`.
- **Default Fallback**: `employeesCreate` now defaults `roleId` to `"role_employee"` whenever an explicit role is omitted during provisioning.
- **Verification**: Verified in both unit tests and integration tests (`employeesCreate defaults to role_employee when roleId is omitted`).

### 2.2 Idempotency Lease-Expiry and Recovery
- **Change**: Added `processingExpiresAt?: string` to `IdempotencyRecordDoc` with configurable lease timeout (default 30 seconds).
- **Stuck Slot Recovery**: When an operation encounters an existing `PROCESSING` record whose lease has expired (`now >= processingExpiresAt`), it triggers a `recoveryChecker` callback.
- **Double-Effect Guard**: If the previous attempt succeeded in creating its primary resource (e.g., Auth user, organization, bill) but died before writing its idempotency result, the recovery checker detects the existing resource and marks the idempotency record as `succeeded` without re-executing side effects. If the previous attempt crashed completely, the lease is re-acquired and the operation proceeds safely.
- **Verification**: Verified via test case simulating an expired lease from a crashed category creation attempt.

---

## 3. Legacy Codebase Inspection & Alignment

The legacy NestJS + MongoDB codebase at `C:\Users\jesil.p\Project\Nest Js\testing-trado-api` was inspected to confirm exact business schema definitions:

| Operational Domain | Legacy Schema Inspected | Key Architectural Decision Extracted |
| :--- | :--- | :--- |
| **Products & Inventory** | `src/database/schemas/item.schema.ts` | Confirmed canonical naming `hasExpiry: boolean` (NOT `isExpiry`). Stock tracking uses `trackStock: boolean` and `lowStockThreshold`. |
| **Unified Outflows** | `src/database/schemas/expense.schema.ts` | Confirmed `Expense` unified schema for both purchases (`kind: "purchase"`) and expenses (`kind: "expense"`). |
| **Sales & Billing** | `src/database/schemas/bill.schema.ts` | Confirmed snapshot naming convention: `nameSnapshot`, `priceSnapshot`, `costSnapshot`, `taxCodeSnapshot`, `baseQtyFactorSnapshot`. |
| **Deliveries** | `src/database/schemas/delivery.schema.ts` | Confirmed delivery references `bill: Types.ObjectId` by ID only, with destination `address` snapshot and optional COD. |
| **Returns** | `src/database/schemas/return.schema.ts` | Confirmed return references parent invoice/purchase by `referenceId` by ID only. Restocking updates stock transactionally. |
| **Payments** | `src/database/schemas/payment.schema.ts` | Confirmed standalone payment voucher collection recording `direction: "in" \| "out"`, referencing source documents by ID. |

---

## 4. Operational Core Architecture Baseline

Phase 2 introduces 11 operational collections and 11 callable modules into the Firebase environment:
1. **Catalog**: `products`, `categories`, `units`
2. **Parties**: `customers`, `vendors`
3. **Outflows**: `outflows` (unified purchases and operational expenses)
4. **Billing**: `bills` (shared engine for POS and B2B wholesale)
5. **Inventory**: `stockMovements` (immutable transactional audit trail)
6. **Logistics**: `deliveries` (lean order dispatch reference)
7. **Post-Sales**: `returns` (sales & purchase returns with stock disposition)
8. **Financial Ledger**: `payments` (cash/bank/UPI vouchers)
9. **Sequencing**: `documentCounters` (financial year-partitioned gap-free sequential numbers)

