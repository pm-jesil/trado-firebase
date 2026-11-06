# Workflow Runbook: Deliveries, Returns & Waste Management

---

## 1. Overview & Business Context
This runbook guides operators through post-sale operations, order fulfillment, customer returns, and damaged/waste inventory write-offs:
- Scheduling deliveries and tracking fulfillment status (`deliveriesCreate`, `deliveriesUpdateStatus`).
- Automatic push notification dispatch to assigned riders via trigger `onDeliveryWritten`.
- Processing customer returns, validating against over-return limits, and restocking goods.
- Recording inventory waste/damage deductions via `stockAdjust`.

---

## 2. Actors & Permissions
- **Dispatch Manager / Cashier**: Requires `delivery:create`. Can schedule deliveries and assign riders.
- **Delivery Rider**: Requires `delivery:status`. Can update delivery progress (`dispatched`, `delivered`, `failed`).
- **Returns Officer**: Requires `return:create`. Can process sale returns and issue credit notes.
- **Warehouse Manager**: Requires `stock:adjust`. Can write off damaged or spoiled items.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Scheduling an Order Delivery
1. **Cashier calls `deliveriesCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "billId": "bill_inv_001",
         "riderMembershipId": "mem_rider_alex",
         "recipientName": "Rahul Sharma",
         "recipientPhone": "+919876543210",
         "deliveryAddress": "Flat 4B, Emerald Heights, Kochi",
         "notes": "Call customer before arrival"
       }
     }
     ```
2. **Backend Execution**:
   - Verifies `bill_inv_001` exists.
   - Generates sequential delivery number `DEL-2026-000001`.
   - Commits `deliveries/{deliveryId}` with `status: "pending"`.
   - **Automated Trigger**: `onDeliveryWritten` automatically generates an in-app notification in `notifications` for rider `mem_rider_alex` ("New Delivery Assigned").

### 3.2 Rider Completes Delivery
1. **Rider calls `deliveriesUpdateStatus`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "deliveryId": "del_001",
         "status": "delivered",
         "proofOfDelivery": "Delivered to security desk per customer request"
       }
     }
     ```
2. **Backend Execution**:
   - Updates `deliveries/del_001`: `status: "delivered"`, `completedAt: "<timestamp>"`.

### 3.3 Processing a Customer Return (Restocking Stock)
1. **Cashier calls `returnsCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "returnType": "sale_return",
         "referenceId": "bill_inv_001",
         "partyId": "cust_emerald_001",
         "items": [
           {
             "productId": "prod_black_pepper_1kg",
             "quantity": 5,
             "unitPrice": 420,
             "subtotal": 2100,
             "restock": true
           }
         ],
         "refundAmount": 2100,
         "refundMode": "credit_note",
         "reason": "Customer ordered excess stock"
       }
     }
     ```
2. **Backend Execution**:
   - Validates that returned quantity (5) does not exceed remaining billed quantity.
   - Restocks inventory:
     - Increments `stockBalances/org_kochi_001_main-branch_prod_black_pepper_1kg` by 5.
     - Increments `products/prod_black_pepper_1kg.currentStock` by 5.
     - Appends `stockMovements` (`movementType: "sale_return_in"`, `quantity: 5`).
   - Credits customer balance:
     - Decrements `customers/cust_emerald_001.outstandingBalance` by ₹2,100.
     - Appends `customerLedgers` entry (`return_credit`).
   - Updates original bill line item `returnedQty = 5`.
   - Generates return number `RET-2026-000001` and commits `returns/{returnId}`.

### 3.4 Writing Off Damaged Stock (Waste)
1. **Warehouse Manager calls `stockAdjust`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "productId": "prod_black_pepper_1kg",
         "quantity": 2,
         "movementType": "waste_out",
         "reason": "Water ingress damaged bags during monsoon"
       }
     }
     ```
2. **Backend Execution**:
   - Decrements branch stock by 2 in `stockBalances`.
   - Decrements `products.currentStock` by 2.
   - Appends audit entry in `stockMovements` (`movementType: "waste_out"`, `quantity: -2`).

---

## 4. Failure & Invariant Safeguards

| Scenario | Trigger | Outcome | Reason |
|---|---|:---:|---|
| **Over-Return Attempt** | Customer attempts to return 10 items on a bill where only 5 were purchased | Rejected with `invalid-argument` | Backend enforces: $\text{Return Qty} \le (\text{Billed Qty} - \text{Prior Returned Qty})$. |
| **Concurrent Return Race** | Two staff members attempt to return the last remaining units simultaneously | Exactly 1 succeeds; second rejected | Firestore atomic transaction checks real-time remaining billed quantity. |
| **Anti-Embedding Guard** | Inspecting delivery or return records | Verified compliant | Stores `billId` and `partyId` as ID strings; zero full document copies. |

---

## 5. Local Testing & Verification
- **E2E Business Flow**: Step 9 of `functions/scripts/test-e2e-business-flow.js`.
- **Integration Tests**: `functions/scripts/test-callables-integration.js` (Over-return validation and delivery reference-by-ID tests).

