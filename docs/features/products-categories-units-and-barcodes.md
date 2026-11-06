# Feature Guide: Products, Categories, Units & Barcodes

---

## 1. Purpose & Scope
This module manages the product master catalog for an organization:
- **Product Catalog**: `products/{productId}` stores catalog attributes, pricing, Weighted Average Cost (WAC), tax rates, and aggregate stock mirror.
- **Categories & Brands**: `productCategories/{categoryId}` and `productBrands/{brandId}` organize products hierarchically with support for subcategories (`parentCategoryId`).
- **Units**: `units/{unitId}` defines inventory counting units (e.g. `kg`, `pcs`, `box`, `bag`).
- **Barcode Concurrency Locks**: `barcodeLocks/{orgId}_{barcode}` ensures barcodes remain strictly unique within an organization under high-concurrency requests.

---

## 2. Actors & Permissions
- **Organization Owner & Inventory Admin**: Possess `inventory:write` and `inventory:create`. Can add or edit products, categories, units, and barcode assignments.
- **Sales & Cashier Staff**: Possess `inventory:read` and `bill:create`. Can search products, scan barcodes, and view prices and stock availability.
- **Cross-Tenant Guard**: Products are isolated per tenant (`products.organizationId == context.organizationId`). Catalog items from other organizations cannot be viewed or referenced.

---

## 3. Product Data Structure & Source of Truth

### Physical vs. Catalog Stock
- **`stockBalances/{orgId}_{branchId}_{productId}`**: Authoritative source of truth for physical inventory at each branch location.
- **`products/{productId}.currentStock`**: Read-optimized aggregate mirror representing total inventory across all branches in the organization.
- When initial stock is supplied during `productsCreate`, it is credited to the resolved active branch (`targetBranchId`) in `stockBalances`, a `stockMovements` inward record is created, and `products.currentStock` is initialized to that value.

### Weighted Average Cost (WAC)
- Products maintain `weightedAvgCost` with 4-decimal precision.
- Initial creation sets `weightedAvgCost = costPrice`.
- Subsequent inward purchases recalculate WAC:
  $$\text{WAC}_{\text{new}} = \frac{(\text{Current Stock} \times \text{Old WAC}) + (\text{Incoming Qty} \times \text{Purchase Rate})}{\text{Current Stock} + \text{Incoming Qty}}$$

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Creating a Tracked Product with Barcode
1. **Client calls `productsCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "name": "Basmati Rice 5kg",
       "barcode": "8901234567890",
       "sellingPrice": 450,
       "costPrice": 320,
       "baseUnit": "bag",
       "trackStock": true,
       "initialStock": 50,
       "branchId": "main-branch"
     }
     ```
2. **Backend Concurrency Guard**:
   - Reads `barcodeLocks/org_demo_8901234567890`. If document exists, throws `already-exists: "Barcode already in use"`.
3. **Atomic Commit**:
   - Creates `products/{productId}` with `currentStock: 50` and `weightedAvgCost: 320`.
   - Creates `barcodeLocks/org_demo_8901234567890`.
   - Creates `stockBalances/org_demo_main-branch_{productId}` with `currentStock: 50`.
   - Creates `stockMovements` entry with `movementType: "adjustment_in"`, `quantity: 50`.

### 4.2 Updating Product Prices & Attributes
1. **Client calls `productsUpdate`**:
   - Payload: `{ organizationId, productId, sellingPrice: 475 }`.
2. **Backend Validation**:
   - Ensures barcode cannot be changed to an existing barcode without releasing the old lock.
   - Price updates apply to future transactions; existing bills maintain historical `productSnapshot`.

---

## 5. Alternate Paths & Concurrency Guarantees
- **Duplicate Barcode Race**: If two staff members attempt to create different products with the same barcode simultaneously, the Firestore transaction ensures only one lock document is written; the second request fails with `already-exists`.
- **Cross-Tenant Same Barcode**: Two different organizations CAN use the same manufacturer barcode because lock keys are prefixed with `organizationId` (`barcodeLocks/{orgId}_{barcode}`).
- **Untracked Products**: Products with `trackStock: false` (services, delivery charges) bypass stock deductions and balance validation during billing.

---

## 6. Local Testing & Verification
- **Test File**: `functions/scripts/test-callables-integration.js`
  - Tests verify `productsCreate` barcode concurrency race, stock movement initialization, and catalog retrieval.
- **Unit Tests**: `functions/src/test/unit/branchValidationAndSharing.test.ts` (Product branch attribution tests).

