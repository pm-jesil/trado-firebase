# Workflow Runbook: Purchases & Expenses (Unified Outflows)

---

## 1. Overview & Business Context

This runbook covers supplier procurement and operational overhead management using Trado's Unified Outflows engine:
- Inward stock receiving from suppliers (`kind: "purchase"`).
- Branch inventory intake, stock movement logging, and Weighted Average Cost (WAC) recalculation.
- Vendor debt management via `vendorLedgers` and supplier disbursements.
- Recording operational business expenses (`kind: "expense"`) without creating stock movements.

---

## 2. Actors & Permissions

- **Purchasing Agent / Store Inward Staff**: Requires `purchase:create`. Can record inventory receipts from registered vendors.
- **Office Administrator / Accountant**: Requires `expense:create`. Can log operational overhead (rent, electricity, tea, travel).
- **Accounts Payable Lead**: Requires `payment:create`. Can disburse payments to suppliers against purchase invoices.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Inventory Procurement from Supplier (`kind: "purchase"`)
1. **Purchasing Agent calls `outflowsCreate`**:
   - **Endpoint**: `POST /outflowsCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "kind": "purchase",
         "vendorId": "vend_spices_ltd",
         "invoiceNumber": "INV-SPL-882",
         "docDate": "2026-11-08T10:00:00.000Z",
         "lines": [
           {
             "productId": "prod_black_pepper_1kg",
             "quantity": 100,
             "unit": "kg",
             "unitPrice": 400.00,
             "taxPercent": 5.0
           }
         ],
         "paidAmount": 15000.00,
         "paymentMethod": "bank_transfer",
         "idempotencyKey": "pur_outflow_lease_101"
       }
     }
     ```
2. **Backend Execution**:
   - Acquires vendor invoice lock: `uniqueKeys/{uniqueKeyId(orgId, "vendor_invoice", "vend_spices_ltd_INV-SPL-882")}`.
   - Calculates totals: Subtotal = ₹40,000, Tax = ₹2,000, Total = ₹42,000.
   - Calculates balance: Paid = ₹15,000, Remaining Payable = ₹27,000.
   - Increments physical stock by 100 in `stockBalances/{orgId}_main-branch_prod_black_pepper_1kg`.
   - Increments aggregate `products/prod_black_pepper_1kg.currentStock` by 100.
   - Recalculates product `weightedAvgCost` with 4-decimal precision.
   - Appends `stockMovements` (`movementType: "purchase_in"`, `quantity: 100`).
   - Updates vendor payable in `vendors/vend_spices_ltd.outstandingPayable` (+₹27,000).
   - Appends payable credit entry in `vendorLedgers`.
   - Records partial disbursement of ₹15,000 in `payments` (`paymentNumber: "PAY-2026-000001"`).
   - Commits `outflows/{outflowId}` with `outflowNumber: "PUR-2026-000001"`, `paymentStatus: "partial"`.

### 3.2 Recording Operational Expenses (`kind: "expense"`)
1. **Accountant calls `outflowsCreate`**:
   - **Endpoint**: `POST /outflowsCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "kind": "expense",
         "expenseCategoryId": "cat_utilities",
         "payee": "Kerala State Electricity Board",
         "payeeType": "other",
         "lines": [
           {
             "itemName": "Main warehouse electricity bill October 2026",
             "quantity": 1,
             "unit": "month",
             "unitPrice": 3500.00,
             "addToStock": false
           }
         ],
         "paidAmount": 3500.00,
         "paymentMethod": "upi",
         "notes": "Payment receipt UTR #992811772",
         "idempotencyKey": "exp_outflow_lease_201"
       }
     }
     ```
2. **Backend Execution**:
   - Issues sequential expense number: `EXP-2026-000001`.
   - Records payment transaction in `payments` (`paymentNumber: "PAY-2026-000002"`, `direction: "out"`).
   - Commits `outflows/{outflowId}` with `status: "confirmed"`.
   - **Verification**: Zero inventory movements created; no stock balances altered.

---

## 4. Verification Checkpoints

1. **Verify Stock Increment**:
   Query `stockBalances/{orgId}_main-branch_prod_black_pepper_1kg` and assert stock increased by 100.
2. **Verify WAC Recalculation**:
   Query `products/prod_black_pepper_1kg` and assert `weightedAvgCost` reflects new purchase cost and quantity.
3. **Verify Vendor Payable Ledger**:
   Query `vendorLedgers` and assert entry `entryType == "purchase_payable"` exists with balance ₹27,000.
4. **Verify Zero Stock Effect on Expense**:
   Assert that recording an expense outflow creates zero entries in `stockMovements`.
