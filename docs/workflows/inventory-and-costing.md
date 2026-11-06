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
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "name": "Organic Turmeric Powder 500g",
         "barcode": "8901234567891",
         "sellingPrice": 180,
         "costPrice": 120,
         "baseUnit": "pack",
         "trackStock": true,
         "initialStock": 60
       }
     }
     ```
2. **Backend Execution**:
   - Acquires barcode lock `barcodeLocks/org_kochi_001_8901234567891`.
   - Creates `products/{productId}` with `currentStock: 60`, `weightedAvgCost: 120`.
   - Creates `stockBalances/org_kochi_001_main-branch_{productId}` with `currentStock: 60`.
   - Appends `stockMovements` (`adjustment_in`, qty: 60).

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
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "productId": "prod_turmeric_500g",
         "quantity": 2,
         "movementType": "adjustment_out",
         "reason": "Routine quarterly physical count verification"
       }
     }
     ```
2. **Backend Execution**:
   - Decrements branch stock by 2 in `stockBalances`.
   - Decrements `products.currentStock` by 2.
   - Appends `stockMovements` (`movementType: "adjustment_out"`, `quantity: -2`).

### 3.4 Running Stock Reconciliation (`reconcileStockBalances`)
1. **Auditor calls `reconcileStockBalances`**:
   - Payload: `{ "data": { "organizationId": "org_kochi_001" } }`.
2. **Backend Audit Engine**:
   - Iterates every active product.
   - For each branch, calculates: $\sum \text{inward} - \sum \text{outward}$ from `stockMovements`.
   - Compares against `stockBalances/{orgId}_{branchId}_{productId}.currentStock`.
   - Compares sum of all branch balances against `products.currentStock`.
   - Returns:
     ```json
     {
       "result": {
         "organizationId": "org_kochi_001",
         "totalProductsChecked": 15,
         "discrepanciesCount": 0,
         "inSync": true
       }
     }
     ```

---

## 4. Invariants & Safety Guarantees
- **Negative Stock Prohibition**: For tracked products (`trackStock: true`), if a sale would reduce stock below zero, the transaction aborts with `failed-precondition: "Insufficient stock"`.
- **Untracked Products**: Products with `trackStock: false` (services, delivery charges) bypass balance checks and do not write to `stockBalances`.
- **Zero-Balance Default**: Querying a product at a newly opened branch where it has not been received returns `currentStock: 0`. It never falls back to the organization total.

---

## 5. Local Testing & Verification
- **Unit Tests**: `functions/src/test/unit/costingEngine.test.ts` (7 unit tests covering initial intake, price increases, fractional units, and COGS).
- **Integration Tests**: Scenarios 8–12 of `functions/scripts/test-branch-deep-e2e.js` and Step 10 of `test-e2e-business-flow.js`.

