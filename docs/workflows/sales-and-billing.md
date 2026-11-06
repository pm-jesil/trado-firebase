# Workflow Runbook: Sales, Billing & Invoicing Lifecycle

---

## 1. Overview & Business Context
This runbook details sales execution across retail Point-of-Sale (POS) and B2B wholesale quotation workflows:
- Rapid POS sales with immediate stock decrement and cash/UPI receipt issuance.
- B2B quotation issuance (preserving physical stock and zero ledger balance).
- Atomic quotation finalization into a legal Tax Invoice via `billsFinalize`.
- Concurrency protection preventing duplicate stock deductions under simultaneous finalization requests.
- Payment recording and double-entry customer credit ledger tracking.

---

## 2. Actors & Permissions
- **Cashier**: Requires `bill:create`. Can generate POS bills and cash receipts.
- **B2B Sales Representative**: Requires `bill:create`. Can issue quotations.
- **Store / Billing Manager**: Requires `bill:finalize`. Can finalize draft quotations into active Tax Invoices and apply authorized discounts.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Point-of-Sale (POS) Cash Sale
1. **Cashier calls `billsCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "salesMode": "pos",
         "documentType": "invoice",
         "items": [
           {
             "productId": "prod_cardamom_100g",
             "quantity": 2,
             "unitPrice": 450,
             "subtotal": 900,
             "taxAmount": 0,
             "total": 900
           }
         ],
         "totalAmount": 900,
         "paidAmount": 900,
         "paymentMethod": "cash",
         "idempotencyKey": "pos_sale_uuid_101"
       }
     }
     ```
2. **Backend Execution**:
   - Verifies product exists in `org_kochi_001` and stock is available in `stockBalances/org_kochi_001_main-branch_prod_cardamom_100g`.
   - Decrements branch stock by 2; decrements aggregate `products.currentStock` by 2.
   - Appends `stockMovements` entry (`movementType: "sale_out"`, `quantity: -2`).
   - Issues sequential receipt number: `POS-2026-000001`.
   - Records payment entry in `payments` (`paymentNumber: "PAY-2026-000001"`).
   - Commits `bills/{billId}` with `status: "active"`, `paymentStatus: "paid"`.

### 3.2 B2B Quotation Workflow
1. **Sales Rep calls `billsCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "salesMode": "b2b",
         "documentType": "quotation",
         "customerId": "cust_sunrise_supermarket",
         "items": [
           {
             "productId": "prod_cardamom_100g",
             "quantity": 50,
             "unitPrice": 420,
             "subtotal": 21000
           }
         ],
         "totalAmount": 21000,
         "status": "draft"
       }
     }
     ```
2. **State Outcome**:
   - Document created with `billNumber: "QTN-2026-000001"`, `status: "draft"`.
   - **Verification**: `stockBalances` remains untouched. Zero stock movement entries are created. Customer balance remains 0.

### 3.3 Finalizing Quotation to Tax Invoice (`billsFinalize`)
When the customer confirms the purchase:
1. **Manager calls `billsFinalize`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "billId": "bill_qtn_001",
         "idempotencyKey": "finalize_qtn_uuid_101"
       }
     }
     ```
2. **Backend Atomic Transaction**:
   - Verifies `bill.status === "draft"`.
   - Checks available stock in `stockBalances`: verifies 50 units available.
   - Generates sequential Tax Invoice number: `INV-2026-000001`.
   - Atomically decrements branch stock by 50 in `stockBalances` and `products.currentStock`.
   - Appends `stockMovements` (`sale_out`, qty: -50).
   - Updates `customers/cust_sunrise_supermarket.outstandingBalance` (+21,000 receivable debit).
   - Appends debit record in `customerLedgers`.
   - Commits `bills/bill_qtn_001`: `status: "active"`, `billNumber: "INV-2026-000001"`.

---

## 4. Concurrency & Failure Guarantees

| Scenario | Trigger | Expected Outcome | Safeguard Mechanism |
|---|---|:---:|---|
| **Simultaneous Double-Finalization** | Two cashiers click Finalize simultaneously (`Promise.all`) | Exactly 1 succeeds; second fails with `failed-precondition` | Firestore atomic transaction checks `status == "draft"`. Stock decremented exactly once. |
| **Network Replay** | Client resubmits identical `idempotencyKey` | Returns cached receipt; zero duplicate mutations | 24-hour lease in `idempotencyRecords`. |
| **Insufficient Stock at Finalize** | Stock sold to another customer while quotation was pending | Rejected with `failed-precondition: "Insufficient stock"` | Transaction verifies real-time stock balance before committing final invoice. |

---

## 5. Local Testing & Verification
- **E2E Business Flow**: Steps 6–8 of `functions/scripts/test-e2e-business-flow.js`.
- **Integration Tests**: `functions/scripts/test-callables-integration.js` (Quotations vs. Invoice stock deduction and concurrent finalization race tests).

