# Workflow Runbook: Sales, Billing & Invoicing Lifecycle

---

## 1. Overview & Business Context

This runbook details sales execution across retail Point-of-Sale (POS) and B2B wholesale quotation workflows:
- Rapid POS sales with immediate stock decrement and cash/card/UPI receipt issuance.
- B2B quotation issuance (preserving physical stock and zero ledger balance).
- Atomic quotation finalization into a legal Tax Invoice via `billsFinalize`.
- Concurrency protection preventing duplicate stock deductions under simultaneous finalization requests.
- Customer debt tracking and payment recording via double-entry party ledgers.

---

## 2. Actors & Permissions

- **Cashier**: Requires `bill:create`. Can generate POS bills and collect customer payments.
- **B2B Sales Representative**: Requires `bill:create`. Can issue price quotations and sales orders.
- **Store / Billing Manager**: Requires `bill:finalize`. Can finalize draft quotations into active Tax Invoices and apply discounts.
- **Finance Controller**: Requires `bill:delete` or `bill:cancel`. Can cancel draft quotations.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Point-of-Sale (POS) Cash Sale
1. **Cashier calls `billsCreate`**:
   - **Endpoint**: `POST /billsCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "salesMode": "pos",
         "documentType": "invoice",
         "items": [
           {
             "productId": "prod_cardamom_100g",
             "quantity": 2
           }
         ],
         "paidAmount": 900.00,
         "paymentMethod": "cash",
         "idempotencyKey": "pos_sale_lease_101"
       }
     }
     ```
2. **Backend Execution**:
   - Resolves active tenant and branch from caller's Auth token (`main-branch`).
   - Prices bill lines server-side: fetches `sellingPrice: 450` from product, applies tax calculation.
   - Verifies available stock in `stockBalances/{orgId}_main-branch_prod_cardamom_100g`.
   - Atomically:
     - Decrements branch stock by 2; decrements aggregate `products.currentStock` by 2.
     - Appends `stockMovements` (`movementType: "sale_out"`, `quantity: -2`).
     - Issues sequential receipt number: `POS-2026-000001`.
     - Records payment entry in `payments` (`paymentNumber: "PAY-2026-000001"`).
     - Commits `bills/{billId}` with `status: "active"`, `paymentStatus: "paid"`.

### 3.2 B2B Quotation Workflow
1. **Sales Rep calls `billsCreate`**:
   - **Endpoint**: `POST /billsCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "salesMode": "b2b",
         "documentType": "quotation",
         "customerId": "cust_sunrise_supermarket",
         "items": [
           {
             "productId": "prod_cardamom_100g",
             "quantity": 50,
             "unitPriceOverride": 420.00
           }
         ],
         "idempotencyKey": "qtn_create_lease_201"
       }
     }
     ```
2. **Backend Execution**:
   - Validates customer exists and belongs to caller's organization.
   - Prices items using authorized unit price override ₹420.00.
   - Issues sequential quotation number: `QTN-2026-000001`.
   - Commits `bills/{billId}` with `status: "draft"`, `documentType: "quotation"`.
   - **Verification**: Zero physical stock is deducted from `stockBalances`; zero stock movements are appended.

### 3.3 Quotation Finalization into Tax Invoice
1. **Manager calls `billsFinalize`**:
   - **Endpoint**: `POST /billsFinalize`
   - **Request Payload**:
     ```json
     {
       "data": {
         "billId": "bill_qtn_001",
         "idempotencyKey": "finalize_lease_301"
       }
     }
     ```
2. **Backend Atomic Execution**:
   - Reads `bills/bill_qtn_001`: verifies `status === "draft"` and `documentType === "quotation"`.
   - Verifies 50 units are physically available in `stockBalances`.
   - Reserves sequential Tax Invoice number: `INV-2026-000001`.
   - Atomically:
     - Decrements branch stock by 50 in `stockBalances`.
     - Appends `stockMovements` (`movementType: "sale_out"`, `quantity: -50`).
     - Updates customer total spend and outstanding balance (+₹21,000).
     - Appends customer ledger debit in `customerLedgers`.
     - Updates bill: `status = "active"`, `billNumber = "INV-2026-000001"`, `originalQuotationNumber = "QTN-2026-000001"`.

---

## 4. Verification Checkpoints

1. **Verify Stock Deduction**:
   Query `stockBalances/{orgId}_main-branch_prod_cardamom_100g` and assert stock decreased exactly by billed quantity.
2. **Verify Ledger Balance**:
   Query `customerLedgers` and assert entry `entryType == "invoice_debit"` exists with matching invoice amount.
3. **Verify Concurrency Guard**:
   Calling `billsFinalize` twice concurrently with `Promise.all` yields exactly 1 success and 1 `failed-precondition` rejection. Stock is never deducted twice.
