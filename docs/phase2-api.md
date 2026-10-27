# Trado Firebase Backend — Phase 2 Callable API Reference

All Phase 2 endpoints are implemented as HTTPS onCall Cloud Functions deployed to the `asia-south1` (Mumbai) region. Each function enforces authentication, tenant membership validation, permission checks, Zod input validation, idempotency caching, and structured error responses.

---

## 1. Products API (`callables/products.ts`)

### 1.1 `productsCreate`
Creates a new catalog product, optionally initializes inventory balance, and records an initial stock movement.
* **Permissions**: `product:create`, `product:*`, or Org Owner / Super Admin.
* **Idempotency**: Supported.
* **Input**:
```json
{
  "organizationId": "string",
  "name": "string",
  "sku": "string (optional)",
  "barcode": "string (optional)",
  "categoryId": "string (optional)",
  "baseUnit": "string",
  "purchaseUnit": "string (optional)",
  "sellingPrice": "number",
  "costPrice": "number (optional)",
  "taxInclusive": "boolean (default: false)",
  "taxRatePercent": "number (optional)",
  "taxCode": "string (optional)",
  "hasExpiry": "boolean (default: false)",
  "trackStock": "boolean (default: true)",
  "initialStock": "number (default: 0)",
  "lowStockThreshold": "number (optional)",
  "idempotencyKey": "string"
}
```
* **Response**:
```json
{
  "productId": "string",
  "organizationId": "string",
  "name": "string",
  "sellingPrice": 45,
  "currentStock": 100,
  "hasExpiry": true,
  "status": "active"
}
```

### 1.2 `productsUpdate`
Updates product metadata, pricing, tax configuration, or status.
* **Input**: `{ organizationId, productId, name?, sellingPrice?, costPrice?, taxRatePercent?, hasExpiry?, trackStock?, status? }`

### 1.3 `productsList`
Lists products with pagination and category/status filtering.
* **Input**: `{ organizationId, categoryId?, status?, limit?, startAfter? }`

### 1.4 `productsGet`
Retrieves single product by ID.
* **Input**: `{ organizationId, productId }`

---

## 2. Categories API (`callables/categories.ts`)

* `categoriesCreate`: `{ organizationId, name, parentId?, description?, idempotencyKey }`
* `categoriesUpdate`: `{ organizationId, categoryId, name?, description?, status? }`
* `categoriesList`: `{ organizationId, status?, limit? }`

---

## 3. Units API (`callables/units.ts`)

* `unitsCreate`: `{ organizationId, name, code, group: "weight"|"count"|"volume"|"length", baseMultiplier?, idempotencyKey }`
* `unitsUpdate`: `{ organizationId, unitId, name?, baseMultiplier?, status? }`
* `unitsList`: `{ organizationId, status?, limit? }`

---

## 4. Customers API (`callables/customers.ts`)

### 4.1 `customersCreate`
Creates customer profile and auto-allocates `customerCode` (`CUST-000001`).
* **Input**:
```json
{
  "organizationId": "string",
  "name": "string",
  "mobile": "string",
  "email": "string (optional)",
  "taxNumber": "string (optional)",
  "billingAddress": "string (optional)",
  "shippingAddress": "string (optional)",
  "creditLimit": "number (optional)",
  "idempotencyKey": "string"
}
```
* **Response**: `{ customerId, organizationId, customerCode: "CUST-000001", name, mobile, status: "active" }`
* `customersUpdate`, `customersList`, `customersGet`.

---

## 5. Vendors API (`callables/vendors.ts`)

### 5.1 `vendorsCreate`
Creates vendor profile and auto-allocates `vendorCode` (`VEND-000001`).
* **Input**: `{ organizationId, name, mobile, email?, taxNumber?, address?, idempotencyKey }`
* **Response**: `{ vendorId, organizationId, vendorCode: "VEND-000001", name, mobile, status: "active" }`
* `vendorsUpdate`, `vendorsList`, `vendorsGet`.

---

## 6. Outflows API (`callables/outflows.ts` — Purchases & Expenses)

### 6.1 `outflowsCreate`
Unified recording of purchases and expenses.
* **Purchase**: Increments inventory `currentStock` for items with `addToStock: true`, generates `PUR-YYYY-XXXXXX`.
* **Expense**: Records operational expense, generates `EXP-YYYY-XXXXXX`.
* **Payments**: Automatically writes payment voucher (`PAY-YYYY-XXXXXX`) when `paidAmount > 0`.
* **Input**:
```json
{
  "organizationId": "string",
  "kind": "purchase | expense",
  "vendorId": "string (optional)",
  "vendorName": "string (optional)",
  "payee": "string (optional)",
  "docDate": "ISO date string (optional)",
  "lines": [
    {
      "productId": "string (optional)",
      "itemName": "string",
      "quantity": 50,
      "unit": "pack",
      "unitPrice": 30,
      "discountAmount": 0,
      "taxPercent": 5,
      "addToStock": true,
      "batch": "string (optional)",
      "expiryDate": "string (optional)"
    }
  ],
  "paidAmount": 1500,
  "paymentMethod": "bank_transfer",
  "idempotencyKey": "string"
}
```
* **Response**:
```json
{
  "outflowId": "string",
  "organizationId": "string",
  "outflowNumber": "PUR-2026-000001",
  "kind": "purchase",
  "totalAmount": 1500,
  "paidAmount": 1500,
  "balanceAmount": 0,
  "paymentStatus": "paid",
  "paymentId": "string",
  "status": "confirmed"
}
```
* `outflowsList`, `outflowsGet`.

---

## 7. Bills API (`callables/bills.ts` — Shared Sales & Billing Engine)

### 7.1 `billsCreate`
Shared billing callable supporting both POS counter sales and B2B wholesale orders.
* **Transactionality**: Atomically allocates sequence number (`POS-` or `INV-`), decrements `currentStock` (preventing negative inventory), records payment (`PAY-`) if settled, and commits frozen `TaxSnapshot`.
* **Anti-Embedding**: Line items store display snapshot strings only (`nameSnapshot`, `priceSnapshot`, `costSnapshot`, `taxCodeSnapshot`).
* **Input**:
```json
{
  "organizationId": "string",
  "salesMode": "pos | b2b_wholesale",
  "customerId": "string (optional)",
  "customerSnapshot": { "name": "Walk-in Customer", "phone": "9876543210" },
  "items": [
    {
      "productId": "string",
      "quantity": 20,
      "unitPrice": 45,
      "discountValue": 0
    }
  ],
  "discountTotal": 0,
  "paidAmount": 900,
  "paymentMethod": "cash",
  "idempotencyKey": "string"
}
```
* **Response**:
```json
{
  "billId": "string",
  "organizationId": "string",
  "billNumber": "POS-2026-000001",
  "salesMode": "pos",
  "totalAmount": 900,
  "paidAmount": 900,
  "balanceAmount": 0,
  "paymentStatus": "paid",
  "paymentId": "string",
  "status": "active"
}
```

### 7.2 `billsFinalize`
Finalizes a draft bill, quotation, or sales order into an active confirmed invoice.
* **Permissions**: `bill:create`, `sale:create`, Org Owner, or Super Admin.
* **Behavior**:
  - Atomically validates sufficient stock for all line items.
  - Decrements `currentStock` and emits `stockMovements` records.
  - Updates document status to `"active"` and document number from `QTN-` to official `INV-`.
  - Records tender payment voucher if `paidAmount > 0`.
* **Input**:
```json
{
  "organizationId": "string",
  "billId": "string",
  "paidAmount": 900,
  "paymentMethod": "cash",
  "idempotencyKey": "string"
}
```
* **Response**: `{ billId, billNumber: "INV-2026-000001", status: "active", totalAmount, paidAmount, balanceAmount }`

* `billsList`, `billsGet`.

---

## 8. Deliveries API (`callables/deliveries.ts`)

### 8.1 `deliveriesCreate`
Creates delivery dispatch order referencing a completed bill strictly by `billId` without embedding bill data.
* **Input**:
```json
{
  "organizationId": "string",
  "billId": "string",
  "customerId": "string (optional)",
  "customerName": "City Mart Supermarket",
  "customerPhone": "9876543210",
  "address": {
    "line1": "42 Market Street",
    "city": "Bangalore",
    "pincode": "560001"
  },
  "partner": "internal",
  "deliveryFee": 50,
  "idempotencyKey": "string"
}
```
* `deliveriesUpdateStatus`: Updates delivery stage (`"pending" -> "assigned" -> "picked_up" -> "delivered"`).
* `deliveriesList`, `deliveriesGet`.

---

## 9. Returns API (`callables/returns.ts`)

### 9.1 `returnsCreate`
Processes sales return or purchase return. When `disposition` is `"restocked_to_inventory"`, physical stock is restored transactionally via `prepareStockChangesInTxn`.
* **Input**:
```json
{
  "organizationId": "string",
  "returnType": "sales_return | purchase_return",
  "referenceId": "string (billId or outflowId)",
  "items": [
    {
      "productId": "string",
      "quantity": 5,
      "refundAmount": 225,
      "reason": "Excess packs",
      "disposition": "restocked_to_inventory"
    }
  ],
  "refundMethod": "cash",
  "idempotencyKey": "string"
}
```
* **Response**: `{ returnId, organizationId, returnNumber: "RET-2026-000001", totalRefundAmount: 225, status: "completed" }`
* `returnsList`.

---

## 10. Payments API (`callables/payments.ts`)

* `paymentsCreate`: Manual payment voucher recording (standalone accounts receivable / payable voucher).
* `paymentsList`: Filters payment ledger by date range, direction (`"in"` vs `"out"`), party, or method.

---

## 11. Stock Adjustments API (`callables/stock.ts`)

* `stockAdjust`: Manual inventory balance adjustment (damage write-off, count reconciliation).
  - Input: `{ organizationId, productId, quantity: -5, reason: "Expired stock", idempotencyKey }`
  - Atomically updates `currentStock` and appends `stockMovements` audit record.
* `stockMovementsList`: Paged audit history of stock changes for any product.

---

## 12. Ledger & Stock Reconciliation API (`callables/reconciliation.ts`)

### 12.1 `reconcileStockBalances`
Audits the physical `currentStock` recorded on product documents against the sum of all historical `stockMovements` records.
* **Permissions**: `inventory:adjust`, `inventory:manage`, Org Owner, or Super Admin.
* **Input**:
```json
{
  "organizationId": "string",
  "productId": "string (optional)",
  "repair": "boolean (default: false)"
}
```
* **Response**:
```json
{
  "organizationId": "string",
  "productCount": 120,
  "discrepancyCount": 0,
  "repairedCount": 0,
  "discrepancies": []
}
```

### 12.2 `reconcilePartyLedgers`
Audits party financial balances against bills, outflows, and payment ledger entries.
* **Permissions**: `customer:view`, `report:view`, Org Owner, or Super Admin.
* **Input**:
```json
{
  "organizationId": "string",
  "partyType": "customer | vendor",
  "partyId": "string (optional)"
}
```
* **Response**:
```json
{
  "organizationId": "string",
  "partyType": "customer",
  "partyCount": 45,
  "discrepancyCount": 0,
  "discrepancies": []
}
```

---

## 13. Comprehensive Callable Export Inventory (66 Functions)

### Phase 1 Callables (29 Endpoints)
1. `healthCheck`: Emulator and service discovery health probe.
2. `authMe`: Returns active user profile, tenant context, and resolved permissions.
3. `organizationsCreate`: Atomic provisioning of tenant organization and owner.
4. `organizationsUpdate`: Updates tenant metadata, settings, and module toggles.
5. `organizationsDeactivate`: Suspends tenant organization access.
6. `organizationsList`: Lists organizations accessible to user or super admin.
7. `employeesCreate`: Provisions employee membership with default `role_employee`.
8. `employeesUpdate`: Updates employee job roles and permission overrides.
9. `employeesDeactivate`: Multi-tenant safe employee membership deactivation.
10. `employeesList`: Lists employees for an organization.
11. `rolesCreate`: Creates custom tenant role (Owner-only).
12. `rolesUpdate`: Modifies custom tenant role permissions.
13. `rolesList`: Lists roles available to the tenant.
14. `departmentsCreate`: Creates organization department.
15. `departmentsUpdate`: Modifies organization department.
16. `departmentsList`: Lists organization departments.
17. `jobRolesCreate`: Creates descriptive job title.
18. `jobRolesUpdate`: Modifies descriptive job title.
19. `jobRolesList`: Lists descriptive job titles.
20. `teamsCreate`: Creates organization team.
21. `teamsUpdate`: Modifies organization team.
22. `teamsList`: Lists organization teams.
23. `plansCreate`: Creates subscription plan tier (Super Admin).
24. `plansUpdate`: Modifies subscription plan tier.
25. `plansList`: Lists subscription plan tiers.
26. `permissionCatalogList`: Lists canonical permission codes.
27. `modulesList`: Lists platform modules.
28. `taxRegimesList`: Lists country tax regime catalogs.
29. `notificationsRegisterFcmToken`: Registers device push token.

### Phase 2 Callables (37 Endpoints)
30. `productsCreate`: Catalog creation with maintained stock and barcode locking.
31. `productsUpdate`: Product pricing, details, and status update.
32. `productsList`: Paged product listing with filtering.
33. `productsGet`: Single product lookup.
34. `categoriesCreate`: Product category creation.
35. `categoriesUpdate`: Category modification.
36. `categoriesList`: Category listing.
37. `unitsCreate`: Measurement unit creation.
38. `unitsUpdate`: Measurement unit modification.
39. `unitsList`: Unit listing.
40. `customersCreate`: Customer profile creation with auto `CUST-` code.
41. `customersUpdate`: Customer profile modification.
42. `customersList`: Customer listing.
43. `customersGet`: Customer profile lookup.
44. `vendorsCreate`: Vendor profile creation with auto `VEND-` code.
45. `vendorsUpdate`: Vendor profile modification.
46. `vendorsList`: Vendor listing.
47. `vendorsGet`: Vendor profile lookup.
48. `outflowsCreate`: Unified purchase intake and expense recording.
49. `outflowsList`: Paged outflows listing.
50. `outflowsGet`: Outflow voucher lookup.
51. `billsCreate`: POS and B2B bill generation with stock decrement.
52. `billsFinalize`: Converts draft quotation to invoice with stock decrement.
53. `billsList`: Paged bill listing.
54. `billsGet`: Single bill lookup.
55. `deliveriesCreate`: Delivery dispatch referencing `billId` without embedding.
56. `deliveriesUpdateStatus`: Updates delivery tracking status.
57. `deliveriesList`: Paged delivery listing.
58. `deliveriesGet`: Single delivery lookup.
59. `returnsCreate`: Sales and purchase return handling with restock logic.
60. `returnsList`: Return vouchers listing.
61. `paymentsCreate`: Financial ledger payment recording.
62. `paymentsList`: Payment transaction listing.
63. `stockAdjust`: Manual stock adjustment with audit movement.
64. `stockMovementsList`: Paged audit history of stock movements.
65. `reconcileStockBalances`: Verifies `currentStock` against `stockMovements`.
66. `reconcilePartyLedgers`: Verifies customer and vendor balances against ledgers.


