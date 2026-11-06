# Feature Guide: Returns, Waste & Stock Adjustments

---

## 1. Purpose & Scope
This module provides inventory restoration, credit note generation, waste tracking, and manual count corrections for Trado:
- **Sales & Purchase Returns**: `returns/{returnId}` manages return vouchers for sold goods (restoring stock and issuing customer credits) and rejected purchases (returning goods to vendors).
- **Over-Return Guard**: Strict mathematical enforcement preventing customers from returning more quantity than was originally billed.
- **Waste & Damage Deductions**: Handled via `stockAdjust` with movement types `waste_out` and `damage_out`.
- **Note on Waste Module Scope**: Trado currently implements waste and damage tracking as verified movement types on `stockAdjust`. A standalone multi-step approval workflow UI for waste disposal is not part of the current core backend scope.

---

## 2. Actors & Permissions
- **Returns Officer / Cashier**: Requires `return:create`. Can process customer item returns and verify item condition.
- **Warehouse Manager**: Requires `stock:adjust`. Can record spoiled, expired, or physically broken items as waste/damage.
- **Store Manager**: Requires `return:delete` or `reconciliation:read`. Can audit return history and check restocked items.

---

## 3. Return Types & Mathematical Invariants

| Return Type | Reference Document | Inventory Effect | Financial / Ledger Effect |
|---|---|---|---|
| `sale_return` | `bills/{billId}` | Restores physical stock (`sale_return_in`) in `stockBalances` | Credits customer ledger (`return_credit`) or issues cash refund |
| `purchase_return`| `outflows/{outflowId}`| Deducts physical stock (`purchase_return_out`) in `stockBalances` | Debits vendor ledger (reduces outstanding payable) |

### Strict Over-Return Validation
When a return request is submitted for a bill:
1. The backend reads all line items from the original bill: retrieves `billedQuantity`.
2. The backend sums all previously returned quantities across prior returns for that bill: retrieves `priorReturnedQuantity`.
3. If:
   $$\text{Requested Return Qty} > (\text{Billed Qty} - \text{Prior Returned Qty})$$
   The transaction immediately fails with `invalid-argument: "Return quantity exceeds remaining returnable quantity"`.

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Processing a Sales Return (Restocking Goods)
1. **Cashier calls `returnsCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "returnType": "sale_return",
       "referenceId": "bill_inv_001",
       "partyId": "cust_sunrise",
       "items": [
         {
           "productId": "prod_cardamom",
           "quantity": 5,
           "unitPrice": 350,
           "subtotal": 1750,
           "restock": true
         }
       ],
       "refundAmount": 1750,
       "refundMode": "credit_note",
       "reason": "Customer ordered excess bags"
     }
     ```
2. **Backend Transaction Execution**:
   - Validates over-return limit (e.g. 5 <= remaining 20).
   - Generates sequential return number `RET-2026-000001`.
   - Restocks inventory:
     - Increments `stockBalances/org_demo_main-branch_prod_cardamom` by 5.
     - Increments `products/prod_cardamom.currentStock` by 5.
     - Appends `stockMovements` (`sale_return_in`, qty: 5).
   - Credits customer balance:
     - Decrements `customers/cust_sunrise.outstandingBalance` by ₹1,750.
     - Appends `customerLedgers` entry (`return_credit`).
   - Updates original bill line item `returnedQty = 5`.
   - Commits `returns/{returnId}`.

### 4.2 Recording Damaged or Expired Stock (Waste)
1. **Warehouse Manager calls `stockAdjust`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "productId": "prod_basmati",
       "quantity": 2,
       "movementType": "waste_out",
       "reason": "Bags torn during transport; grain spoiled"
     }
     ```
2. **Backend Execution**:
   - Decrements branch stock by 2 in `stockBalances`.
   - Decrements `products/prod_basmati.currentStock` by 2.
   - Appends audit entry in `stockMovements` (`waste_out`, qty: -2).

---

## 5. Security & Concurrency Rules
- **Concurrent Return Race**: If two terminals attempt to return the last 5 remaining items on a bill concurrently, the Firestore transaction ensures only the first succeeds. The second attempt detects that remaining quantity is 0 and rejects.
- **Reference-by-ID**: Returns store `referenceId` (bill ID) and `partyId` by ID only. The original sale document is never embedded.

---

## 6. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify over-return rejection (e.g. returning 25 on a 20-item bill), stock restoration on valid return, and movement logging.
- **Connected Business Flow**: Step 9 of `functions/scripts/test-e2e-business-flow.js`.

