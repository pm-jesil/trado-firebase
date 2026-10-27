# Trado Firebase Backend — Phase 2 Data Model Specification

## 1. Catalog Domain

### 1.1 `products` Collection
Maintains tenant catalog items with real-time stock balances and tax mappings.
* **Path**: `products/{productId}`
* **Security**: Read permitted for active tenant members; all direct client writes strictly denied.

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `name` | `string` | Data | Product display name |
| `sku` | `string \| null` | Data | Stock Keeping Unit identifier |
| `barcode` | `string \| null` | Data | EAN/UPC barcode string |
| `categoryId` | `string \| null` | Foreign ID | Category reference ID |
| `categoryNameSnapshot` | `string \| null` | Snapshot | Category name snapshotted for UI display |
| `baseUnit` | `string` | Data | Primary measurement unit (e.g., piece, kg, pack) |
| `purchaseUnit` | `string \| null` | Data | Measurement unit used for purchase intake |
| `sellingPrice` | `number` | Data | Retail selling price |
| `costPrice` | `number` | Data | Inventory acquisition cost |
| `taxInclusive` | `boolean` | Data | Whether sellingPrice includes tax |
| `taxRatePercent` | `number` | Data | Applicable tax rate (e.g. 5, 12, 18) |
| `taxCode` | `string \| null` | Data | HSN/SAC code or tax category code |
| `hasExpiry` | `boolean` | Data | Canonical flag indicating batch expiry tracking |
| `trackStock` | `boolean` | Data | Whether inventory stock is tracked |
| `initialStock` | `number` | Audit | Initial stock balance at product creation |
| `currentStock` | `number` | State | Maintained real-time physical inventory balance |
| `lowStockThreshold` | `number` | Data | Threshold triggering low-stock alerts |
| `status` | `string` | State | `"active" \| "inactive"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |
| `updatedAt` | `string \| null` | Timestamp | ISO 8601 modification timestamp |

---

### 1.2 `categories` Collection
* **Path**: `categories/{categoryId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `name` | `string` | Data | Category name |
| `parentId` | `string \| null` | Foreign ID | Parent category ID for hierarchical nesting |
| `description` | `string \| null` | Data | Optional category description |
| `status` | `string` | State | `"active" \| "inactive"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 1.3 `units` Collection
* **Path**: `units/{unitId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `name` | `string` | Data | Display name (e.g. "Kilogram", "Piece") |
| `code` | `string` | Data | Standard code (e.g. "kg", "pcs", "box") |
| `group` | `string` | Data | Unit group (`"weight" \| "count" \| "volume" \| "length"`) |
| `baseMultiplier`| `number` | Data | Conversion factor to standard base unit |
| `status` | `string` | State | `"active" \| "inactive"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

## 2. Parties Domain

### 2.1 `customers` Collection
* **Path**: `customers/{customerId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `customerCode` | `string` | Sequence | Auto-generated code (`CUST-000001`) |
| `name` | `string` | Data | Customer name or company name |
| `mobile` | `string` | Data | Contact phone / mobile |
| `email` | `string \| null` | Data | Contact email |
| `taxNumber` | `string \| null` | Data | GSTIN / TRN / Tax registration number |
| `billingAddress` | `string \| null` | Data | Default billing address text |
| `shippingAddress`| `string \| null`| Data | Default shipping address text |
| `creditLimit` | `number` | Data | Maximum allowed credit balance |
| `currentBalance` | `number` | State | Current accounts receivable balance |
| `status` | `string` | State | `"active" \| "inactive"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 2.2 `vendors` Collection
* **Path**: `vendors/{vendorId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `vendorCode` | `string` | Sequence | Auto-generated code (`VEND-000001`) |
| `name` | `string` | Data | Vendor company name |
| `mobile` | `string` | Data | Vendor contact number |
| `email` | `string \| null` | Data | Vendor email |
| `taxNumber` | `string \| null` | Data | GSTIN / TRN registration |
| `address` | `string \| null` | Data | Vendor business address |
| `currentBalance` | `number` | State | Current accounts payable balance |
| `status` | `string` | State | `"active" \| "inactive"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

## 3. Financial & Operational Documents

### 3.1 `outflows` Collection (Unified Purchases & Expenses)
* **Path**: `outflows/{outflowId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `outflowNumber` | `string` | Sequence | Sequential voucher number (`PUR-2026-000001` or `EXP-2026-000001`) |
| `kind` | `string` | Type | `"purchase" \| "expense"` |
| `status` | `string` | State | `"draft" \| "confirmed" \| "cancelled"` |
| `docDate` | `string` | Data | Transaction / invoice date |
| `vendorId` | `string \| null` | Foreign ID | Vendor reference ID |
| `vendorName` | `string \| null` | Snapshot | Vendor name for receipt display |
| `payee` | `string \| null` | Data | Payee name (for operational expenses) |
| `lines` | `OutflowLine[]` | Sub-array | Lean line item data (never embeds foreign objects) |
| `subTotal` | `number` | Data | Gross line totals before discount/tax |
| `discountTotal` | `number` | Data | Total discounts applied |
| `taxTotal` | `number` | Data | Total tax applied |
| `totalAmount` | `number` | Data | Net payable amount |
| `paidAmount` | `number` | Data | Amount paid at confirmation |
| `balanceAmount` | `number` | State | Outstanding unpaid balance |
| `paymentStatus` | `string` | State | `"pending" \| "partial" \| "paid"` |
| `taxSnapshot` | `TaxSnapshot` | Snapshot | Immutable breakdown of taxes applied |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 3.2 `bills` Collection (Shared Sales & Billing Engine)
* **Path**: `bills/{billId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `billNumber` | `string` | Sequence | Sequential bill number (`POS-2026-000001`, `INV-2026-000001`, `QTN-2026-000001`) |
| `salesMode` | `string` | Type | `"pos" \| "b2b_wholesale"` |
| `documentType` | `string` | Type | `"invoice" \| "quotation" \| "proforma" \| "sales_order"` |
| `customerId` | `string \| null` | Foreign ID | Customer ID (optional for POS walk-ins) |
| `customerSnapshot`| `object \| null`| Snapshot | Lean customer snapshot: `{ name, phone, taxNumber }` |
| `items` | `BillItem[]` | Sub-array | Snapshotted line items (`nameSnapshot`, `priceSnapshot`, `costSnapshot`, `taxCodeSnapshot`) |
| `subTotal` | `number` | Data | Line totals sum before discount |
| `discountTotal` | `number` | Data | Order-level discount |
| `taxTotal` | `number` | Data | Total tax calculated |
| `roundOff` | `number` | Data | Rounding adjustment to integer/pennies |
| `totalAmount` | `number` | Data | Final payable amount |
| `paidAmount` | `number` | Data | Amount settled |
| `balanceAmount` | `number` | State | Outstanding balance |
| `paymentStatus` | `string` | State | `"pending" \| "partial" \| "paid"` |
| `taxSnapshot` | `TaxSnapshot` | Snapshot | Frozen tax calculation snapshot |
| `status` | `string` | State | `"draft" \| "active" \| "cancelled" \| "refunded"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 3.3 `payments` Collection (Financial Ledger)
* **Path**: `payments/{paymentId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `paymentNumber` | `string` | Sequence | Sequential receipt number (`PAY-2026-000001`) |
| `direction` | `string` | Type | `"in" \| "out"` |
| `partyType` | `string` | Type | `"customer" \| "vendor" \| "employee" \| "other"` |
| `partyId` | `string \| null` | Foreign ID | Linked party ID |
| `partyName` | `string` | Data | Party display name |
| `amount` | `number` | Data | Payment amount |
| `method` | `string` | Data | `"cash" \| "card" \| "upi" \| "bank_transfer" \| "credit"` |
| `referenceId` | `string \| null` | Foreign ID | ID reference only to source bill or outflow |
| `referenceModel` | `string \| null` | Data | `"bill" \| "outflow"` |
| `referenceNumber`| `string \| null`| Data | Display number of source bill/outflow |
| `status` | `string` | State | `"completed" \| "voided"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 3.4 `stockMovements` Collection (Inventory Audit Trail)
* **Path**: `stockMovements/{movementId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `productId` | `string` | Foreign ID | Product ID |
| `type` | `string` | Type | Movement type: `"purchase_in" \| "sale_out" \| "sale_return_in" \| "purchase_return_out" \| "return_in" \| "return_out" \| "adjustment_in" \| "adjustment_out"` |
| `quantity` | `number` | Data | Signed change (+ for intake, - for dispatch) |
| `balanceAfter` | `number` | State | Running `currentStock` balance immediately after movement |
| `unit` | `string` | Data | Measurement unit |
| `referenceId` | `string` | Foreign ID | ID reference only to triggering transaction |
| `referenceModel` | `string` | Data | `"bill" \| "outflow" \| "return" \| "manual_adjustment"` |
| `reason` | `string \| null` | Data | Adjustment reason or notes |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 3.5 `deliveries` Collection
* **Path**: `deliveries/{deliveryId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `billId` | `string` | Foreign ID | Bill reference by ID only (anti-embedding proof) |
| `customerId` | `string \| null` | Foreign ID | Optional customer ID |
| `customerName` | `string` | Data | Recipient customer name |
| `customerPhone` | `string` | Data | Contact phone number |
| `address` | `DeliveryAddress`| Snapshot | Value object: `{ line1, line2, city, pincode, landmark }` |
| `riderMembershipId`| `string \| null`| Foreign ID | Assigned delivery rider membership ID |
| `riderName` | `string \| null` | Data | Assigned rider name |
| `partner` | `string` | Data | `"internal" \| "dunzo" \| "shadowfax" \| "other"` |
| `deliveryFee` | `number` | Data | Delivery charge |
| `status` | `string` | State | `"pending" \| "assigned" \| "picked_up" \| "delivered" \| "failed" \| "cancelled"` |
| `cod` | `DeliveryCod \| null`| Data | Optional COD tracking: `{ isCod, amount, isCollected, collectedAt }` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 3.6 `returns` Collection
* **Path**: `returns/{returnId}`

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `returnNumber` | `string` | Sequence | Sequential return number (`RET-2026-000001`) |
| `returnType` | `string` | Type | `"sales_return" \| "purchase_return"` |
| `referenceId` | `string` | Foreign ID | Reference ID only to source bill or outflow |
| `referenceNumber`| `string \| null`| Data | Human-readable bill/outflow number |
| `partyId` | `string \| null` | Foreign ID | Customer or Vendor ID |
| `items` | `ReturnItem[]` | Sub-array | Returned items with `disposition` (`restocked_to_inventory` vs `damaged_discarded`) |
| `totalRefundAmount`| `number` | Data | Total amount refunded |
| `refundMethod` | `string` | Data | `"cash" \| "credit_note" \| "upi"` |
| `status` | `string` | State | `"completed" \| "cancelled"` |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |
| `createdBy` | `string` | Audit | UID of creator |

---

### 3.7 `documentCounters` Collection
* **Path**: `documentCounters/{counterId}`
* **ID Format**: `${organizationId}_${type}_${year}`
* **Security**: Client SDK access COMPLETELY DENIED (`allow read, write: if false`). Accessed only by trusted Admin SDK transactions.

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `type` | `string` | Type | Sequence prefix (`"INV" \| "POS" \| "PUR" \| "EXP" \| "PAY" \| "RET" \| "DEL"`) |
| `year` | `number` | State | Financial / calendar year |
| `currentSequence`| `number` | State | Monotonically incrementing integer sequence |
| `updatedAt` | `string` | Timestamp | ISO 8601 update timestamp |

---

### 3.8 `barcodeLocks` Collection (Concurrency Lock)
* **Path**: `barcodeLocks/{lockId}`
* **ID Format**: `${organizationId}_${barcode}`
* **Security**: Client SDK access COMPLETELY DENIED (`allow read, write: if false`). Managed strictly inside Admin SDK transactions to guarantee unique barcode enforcement across concurrent requests.

| Field Name | Type | Classification | Description |
| :--- | :--- | :--- | :--- |
| `organizationId` | `string` | Tenant Key | Owning organization ID |
| `barcode` | `string` | Data | Unique barcode string |
| `productId` | `string` | Foreign ID | Associated product ID |
| `createdAt` | `string` | Timestamp | ISO 8601 creation timestamp |


