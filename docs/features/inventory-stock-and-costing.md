# Feature Guide: Inventory, Stock & Costing Engine

---

## 1. Purpose & Scope
This module provides real-time physical stock tracking, multi-branch inventory balances, double-entry stock movement ledgers, and inventory costing for Trado:
- **Authoritative Balance**: Maintained in `stockBalances/{orgId}_{branchId}_{productId}`. Physical inventory is strictly branch-scoped.
- **Immutable Movement Ledger**: Every addition, deduction, transfer, damage, or adjustment is permanently recorded in `stockMovements/{movementId}`.
- **Costing Engine**: Weighted Average Cost (WAC) tracking and Cost of Goods Sold (COGS) computation with 4-decimal precision.
- **Stock Reconciliation**: `reconcileStockBalances` detects and reports discrepancies between the movement ledger, branch balances, and product aggregate mirrors.

---

## 2. Actors & Permissions
- **Warehouse / Inventory Manager**: Requires `inventory:write` or `stock:adjust`. Can record manual stock adjustments, count verifications, and waste/damage deductions.
- **Cashier / Sales Staff**: Requires `bill:create`. Finalizing bills triggers automatic stock deductions via the internal stock engine.
- **Purchasing Staff**: Requires `purchase:create`. Outflows with `kind: "purchase"` trigger inward stock increments.

---

## 3. Stock Architecture & Movement Types

### Movement Types & Mathematical Direction
| Movement Type | Direction | Sign | Triggering API / Source |
|---|---|---|---|
| `purchase_in` | Inward | `+` | Purchase Outflow confirmed |
| `adjustment_in` | Inward | `+` | Initial product stock or manual stock count increase (`stockAdjust`) |
| `sale_return_in` | Inward | `+` | Sales return restocked to inventory (`returnsCreate`) |
| `sale_out` | Outward | `-` | Bill finalized (`billsFinalize` or POS `billsCreate`) |
| `adjustment_out` | Outward | `-` | Manual inventory count reduction (`stockAdjust`) |
| `damage_out` | Outward | `-` | Damaged stock write-off (`stockAdjust`) |
| `waste_out` | Outward | `-` | Expired / spoiled perishable inventory write-off (`stockAdjust`) |
| `purchase_return_out`| Outward | `-` | Stock returned to vendor (`returnsCreate`) |

---

## 4. Multi-Branch Stock Isolation Invariants

1. **Strict Branch Scoping**: An organization with two branches (`main-branch` and `branch-south`) maintains independent balances:
   - `stockBalances/{orgId}_main-branch_{productId}`
   - `stockBalances/{orgId}_branch-south_{productId}`
2. **Initial Balance Zeroing**: If a product has never been stocked at `branch-south`, querying its balance returns `0` available stock. It never falls back to the organization-wide total.
3. **No Cross-Branch Depletion**: Selling 10 units at `main-branch` decrements only `main-branch` stock. `branch-south` stock remains completely untouched.
4. **Aggregate Mirror**: `products/{productId}.currentStock` stores the organization-wide sum across all branches for quick catalog display.

---

## 5. Costing Engine & COGS Arithmetic

### Weighted Average Cost (WAC) Formula
When incoming stock is received at unit rate $P_{\text{in}}$ and quantity $Q_{\text{in}}$:
$$\text{WAC}_{\text{new}} = \frac{(Q_{\text{current}} \times \text{WAC}_{\text{current}}) + (Q_{\text{in}} \times P_{\text{in}})}{Q_{\text{current}} + Q_{\text{in}}}$$

### Decimal Precision Safeguard
- Monetary amounts and quantities use `roundMoney` and `round2` from `money.ts`.
- WAC values are stored with 4 decimal places (e.g. `₹85.4250`) to eliminate rounding drift across fractional quantities (e.g. `0.250 kg`).

### COGS Calculation
When a bill is finalized, COGS is computed as:
$$\text{COGS} = \sum_{\text{items}} (\text{item.quantity} \times \text{product.weightedAvgCost})$$
This value is recorded on the bill and aggregated in `reportsGetProfitLoss`.

---

## 6. Stock Adjustments & Waste Operations

### Recording Manual Adjustments or Damage
1. **User calls `stockAdjust`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "productId": "prod_rice",
       "quantity": 5,
       "movementType": "damage_out",
       "reason": "Water damage in storage rack B"
     }
     ```
2. **Backend Processing**:
   - Atomically updates `stockBalances/org_demo_main-branch_prod_rice`.
   - Decrements `products/prod_rice.currentStock` by 5.
   - Appends audit entry in `stockMovements`.

---

## 7. Stock Reconciliation Engine (`reconcileStockBalances`)
- Scans `stockMovements` for each product across all branches.
- Computes mathematical ledger sum: $\sum \text{inward} - \sum \text{outward}$.
- Compares computed sum against `stockBalances.currentStock`.
- Compares sum of all branch balances against `products.currentStock`.
- Returns discrepancy report (`discrepanciesCount`, `itemsWithDiscrepancy`).
- **Policy**: Read-only verification tool. Does not silently overwrite balances unless explicit maintenance mode is engaged.

---

## 8. Local Testing & Verification
- **Unit Tests**: `functions/src/test/unit/costingEngine.test.ts` (WAC calculations, fractional quantities, and COGS).
- **Integration Tests**: `functions/scripts/test-branch-deep-e2e.js`
  - Scenarios 8–12 verify stock isolation between branch A1 and A2 across purchases, POS sales, and returns.
  - Step 10 of `functions/scripts/test-e2e-business-flow.js` runs `reconcileStockBalances` and asserts 0 discrepancies.

