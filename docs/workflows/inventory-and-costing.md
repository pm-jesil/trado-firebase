# Workflow Runbook: Inventory Tracking, Costing & Stock Reconciliation

---

## 1. Overview & Business Context

This runbook covers physical inventory management, multi-branch stock balances, perpetual Weighted Average Costing (WAC), manual adjustments, and audit reconciliation:
- Product creation with initial opening stock.
- Maintaining authoritative branch balances in `stockBalances` vs aggregate mirrors in `products.currentStock`.
- 4-decimal WAC recalculation on purchases and COGS deduction on sales.
- Executing `reconcileStockBalances` to audit the movement ledger against physical balances.

---

## 2. Actors & Permissions

- **Inventory Controller / Store Manager**: Requires `inventory:write` and `stock:adjust`. Can record opening stock and manual count adjustments.
- **Auditor / Finance Lead**: Requires `reconciliation:read`. Can execute `reconcileStockBalances`.
- **System Automated Triggers**: Sales and purchases invoke internal stock mutations automatically.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Creating a Product with Initial Opening Stock
1. **Manager calls `productsCreate`**:
   - **Endpoint**: `POST /productsCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "name": "Organic Turmeric Powder 500g",
         "barcode": "8901234567891",
         "sellingPrice": 180.00,
         "costPrice": 120.00,
         "baseUnit": "pack",
         "trackStock": true,
         "initialStock": 60,
         "idempotencyKey": "prod_create_lease_001"
       }
     }
     ```
2. **Backend Execution**:
   - Acquires barcode lock `uniqueKeys/{uniqueKeyId(orgId, "barcode", "8901234567891")}`.
   - Creates `products/{productId}` with `currentStock: 60`, `weightedAvgCost: 120.0000`.
   - Creates `stockBalances/{orgId}_main-branch_{productId}` with `currentStock: 60`.
   - Appends `stockMovements` (`movementType: "adjustment_in"`, `quantity: 60`).

### 3.2 Inventory Costing & WAC Recalculation
When a new purchase arrives at a different rate:
- **Existing**: 60 packs @ WAC ₹120.00 = ₹7,200.
- **Incoming Purchase**: 40 packs @ ₹140.00 = ₹5,600.
- **Recalculated WAC**:
  $$\text{WAC} = \frac{7200 + 5600}{60 + 40} = \frac{12800}{100} = ₹128.0000$$
- Stored on `products/{productId}.weightedAvgCost = 128.0000`.

### 3.3 Manual Stock Adjustment (Physical Count Audit)
When physical stock count differs from system balance:
1. **Manager calls `stockAdjust`**:
   - **Endpoint**: `POST /stockAdjust`
   - **Request Payload**:
     ```json
     {
       "data": {
         "productId": "prod_turmeric_500g",
         "quantity": -2,
         "reasonCode": "count_verification",
         "reason": "Quarterly physical count deficit",
         "idempotencyKey": "stock_adj_lease_001"
       }
     }
     ```
2. **Backend Execution**:
   - Checks available stock in `stockBalances` (verifies $\ge 2$ units when `allowNegativeStock === false`).
   - Decrements branch stock by 2 in `stockBalances`.
   - Decrements aggregate `products.currentStock` by 2.
   - Appends `stockMovements` (`movementType: "adjustment_out"`, `quantity: -2`).

### 3.4 Executing Stock Reconciliation (`reconcileStockBalances`)
1. **Auditor calls `reconcileStockBalances`**:
   - **Endpoint**: `POST /reconcileStockBalances`
   - **Request Payload**:
     ```json
     {
       "data": {
         "productId": "prod_turmeric_500g"
       }
     }
     ```
2. **Backend Execution**:
   - Aggregates all entries in `stockMovements` for the product across all branches.
   - Compares ledger sum against `stockBalances.currentStock`.
   - Returns audit report confirming exact balance reconciliation.

---

## 4. Verification Checkpoints

1. **Verify WAC Precision**:
   Assert that `products/{productId}.weightedAvgCost` is preserved with 4 decimal places.
2. **Verify Stock Ledger Balance**:
   Sum of `stockMovements` must exactly equal `stockBalances.currentStock`.
3. **Verify Reorder Alerts**:
   When stock drops below `lowStockThreshold`, trigger `onBillWritten` writes an alert notification to store managers.
