# Feature Guide: Purchases & Expenses (Unified Outflows)

---

## 1. Purpose & Scope
This module provides a unified financial disbursement and inventory intake engine for Trado:
- **Unified Outflows Collection**: `outflows/{outflowId}` consolidates both inventory purchases and non-inventory operational expenses into a single model discriminated by the `kind` field.
- **Purchase Outflows** (`kind: "purchase"`): Records vendor intake, increments physical stock at the receiving branch, calculates Weighted Average Cost (WAC), updates vendor payables, and records payment entries.
- **Expense Outflows** (`kind: "expense"`): Records operational overhead (rent, utilities, tea, transport) without affecting inventory balances or vendor supply ledgers.

---

## 2. Actors & Permissions
- **Warehouse Manager / Purchasing Agent**: Requires `purchase:create`. Can record inventory inward deliveries, select vendors, and verify received stock.
- **Office Manager / Accountant**: Requires `expense:create`. Can record business expenses, categorize operational disbursements, and attach receipts.
- **Finance Controller**: Requires `outflow:read` and `report:view`. Can audit total outflows and analyze expense breakdowns.

---

## 3. The Unified Outflows Architecture

### Model Differentiation by `kind`
| Aspect | Purchase Outflow (`kind: "purchase"`) | Expense Outflow (`kind: "expense"`) |
|---|---|---|
| **Primary Counterparty** | Requires registered `vendorId` | `vendorId` optional / generic payee name |
| **Document Number** | `PUR-YYYY-XXXXXX` | `EXP-YYYY-XXXXXX` |
| **Physical Inventory Effect** | Atomically increments branch stock in `stockBalances` | **Zero inventory effect** |
| **Costing Effect** | Recalculates product `weightedAvgCost` | No costing impact |
| **Ledger Effect** | Records payable credit in `vendorLedgers` | Records payment disbursement in `payments` |
| **Profit & Loss Impact** | Capitalized into inventory (COGS realized upon sale) | Deducted directly as Operational Expense |

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Inward Purchase from Supplier
1. **Purchasing Agent calls `outflowsCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "kind": "purchase",
       "vendorId": "vend_kerala_spices",
       "docDate": "2026-10-29",
       "items": [
         {
           "productId": "prod_cardamom",
           "quantity": 100,
           "unitCost": 200,
           "subtotal": 20000
         }
       ],
       "totalAmount": 20000,
       "paidAmount": 8000,
       "paymentMethod": "bank_transfer"
     }
     ```
2. **Backend Atomic Execution**:
   - Increments branch stock by 100 in `stockBalances/org_demo_main-branch_prod_cardamom`.
   - Increments aggregate `products/prod_cardamom.currentStock` by 100.
   - Recalculates `products/prod_cardamom.weightedAvgCost`.
   - Appends `stockMovements` (`purchase_in`, qty: 100).
   - Updates vendor payable in `vendors/vend_kerala_spices.outstandingPayable` (+12,000 net balance).
   - Appends payable entry in `vendorLedgers`.
   - Records partial payment of ₹8,000 in `payments` (`paymentNumber: "PAY-2026-000001"`).
   - Commits `outflows/{outflowId}` with `outflowNumber: "PUR-2026-000001"`, `paymentStatus: "partial"`.

### 4.2 Recording Operational Expenses
1. **Accountant calls `outflowsCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "kind": "expense",
       "expenseCategory": "utilities",
       "description": "Branch electricity bill October 2026",
       "totalAmount": 3500,
       "paidAmount": 3500,
       "paymentMethod": "upi"
     }
     ```
2. **Backend Execution**:
   - Generates document number `EXP-2026-000001`.
   - Records payment transaction in `payments`.
   - Commits `outflows/{outflowId}` with `status: "confirmed"`.
   - **Verification**: Zero stock movement documents created; no inventory balances altered.

---

## 5. Security & Invariant Rules
- **Cross-Tenant Product Inward Guard**: An outflow cannot receive stock for a product belonging to another tenant organization.
- **Branch Attribution**: Inward stock is credited exclusively to the receiving branch (`branchId`). If a multi-branch business receives goods at `branch-north`, stock at `main-branch` remains untouched.
- **Immutable Financial Trail**: Once confirmed, outflow amounts cannot be altered arbitrarily; adjustments require debit notes or return vouchers.

---

## 6. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify `outflowsCreate` with `kind: "purchase"` transactionally increments stock and `kind: "expense"` creates expense record without stock movement.
- **Connected Business Flow**: Steps 4–5 of `functions/scripts/test-e2e-business-flow.js`.

