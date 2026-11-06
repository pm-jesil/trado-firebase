# Workflow Runbook: Purchases & Expenses (Unified Outflows)

---

## 1. Overview & Business Context
This runbook covers supplier procurement and operational overhead management using Trado's Unified Outflows engine:
- Inward stock receiving from suppliers (`kind: "purchase"`).
- Branch inventory intake, stock movement logging, and Weighted Average Cost (WAC) recalculation.
- Vendor debt management via `vendorLedgers` and partial supplier payments.
- Recording non-inventory business expenses (`kind: "expense"`) without creating unintended stock movements.

---

## 2. Actors & Permissions
- **Purchasing Agent / Warehouse Inward Staff**: Requires `purchase:create`. Can record inventory receipts from registered vendors.
- **Office Administrator / Accountant**: Requires `expense:create`. Can log operational overhead (rent, electricity, tea, travel).
- **Accounts Payable Lead**: Requires `payment:create`. Can disburse payments to suppliers against purchase invoices.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Inventory Procurement from Supplier (`kind: "purchase"`)
1. **Purchasing Agent calls `outflowsCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "kind": "purchase",
         "vendorId": "vend_spices_ltd",
         "docDate": "2026-10-29",
         "items": [
           {
             "productId": "prod_black_pepper_1kg",
             "quantity": 100,
             "unitCost": 400,
             "subtotal": 40000
           }
         ],
         "totalAmount": 40000,
         "paidAmount": 15000,
         "paymentMethod": "bank_transfer",
         "idempotencyKey": "pur_outflow_uuid_101"
       }
     }
     ```
2. **Backend Execution**:
   - Verifies vendor `vend_spices_ltd` is active in `org_kochi_001`.
   - Increments physical stock by 100 in `stockBalances/org_kochi_001_main-branch_prod_black_pepper_1kg`.
   - Increments aggregate `products/prod_black_pepper_1kg.currentStock` by 100.
   - Recalculates product `weightedAvgCost` using 4-decimal precision formula.
   - Appends `stockMovements` entry (`movementType: "purchase_in"`, `quantity: 100`).
   - Updates vendor payable in `vendors/vend_spices_ltd.outstandingPayable` (+25,000 net balance).
   - Appends payable credit entry in `vendorLedgers`.
   - Records partial disbursement of ₹15,000 in `payments` (`paymentNumber: "PAY-2026-000001"`).
   - Commits `outflows/{outflowId}` with `outflowNumber: "PUR-2026-000001"`, `paymentStatus: "partial"`.

### 3.2 Recording Operational Expenses (`kind: "expense"`)
1. **Accountant calls `outflowsCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "kind": "expense",
         "expenseCategory": "utilities",
         "description": "Warehouse electricity bill",
         "totalAmount": 4500,
         "paidAmount": 4500,
         "paymentMethod": "upi",
         "idempotencyKey": "exp_outflow_uuid_101"
       }
     }
     ```
2. **Backend Execution**:
   - Issues document number `EXP-2026-000001`.
   - Records payment transaction in `payments`.
   - Commits `outflows/{outflowId}` with `status: "confirmed"`.
   - **Verification**: Zero stock movement documents created; no inventory balances altered.

---

## 4. Alternate Scenarios & Safety Rules

| Scenario | Trigger / Cause | Outcome | Mechanism |
|---|---|:---:|---|
| **Cross-Tenant Product Inward** | Outflow references a product belonging to another tenant | Rejected with `permission-denied` | Transaction validates `product.organizationId == caller.organizationId`. |
| **Branch Stock Isolation** | Goods received at `branch-south` | Only `branch-south` stock increases | Stock credited strictly to receiving branch in `stockBalances`. `main-branch` stock remains untouched. |
| **Duplicate Inward Submit** | Network timeout causes duplicate submit with same idempotency key | Returns cached purchase receipt | 24-hour lease in `idempotencyRecords` prevents double stock addition. |

---

## 5. Local Testing & Verification
- **E2E Business Flow**: Steps 4–5 of `functions/scripts/test-e2e-business-flow.js`.
- **Integration Tests**: `functions/scripts/test-callables-integration.js` (Tests purchase inward stock increment vs. expense zero-stock isolation).

