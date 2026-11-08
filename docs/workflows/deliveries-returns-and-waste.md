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
   - **Endpoint**: `POST /deliveriesCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "billId": "bill_inv_001",
         "recipient": {
           "name": "Rahul Sharma",
           "phone": "+919876543210"
         },
         "address": {
           "line1": "Flat 4B, Emerald Heights",
           "city": "Kochi",
           "pincode": "682001"
         },
         "riderMembershipId": "usr_rider_alex_org_kochi_001",
         "partner": "internal",
         "deliveryFee": 50.00,
         "cod": {
           "isCod": true,
           "amount": 1450.00
         },
         "notes": "Call customer before arrival",
         "idempotencyKey": "del_create_lease_001"
       }
     }
     ```
2. **Backend Execution**:
   - Verifies `bill_inv_001` exists and belongs to caller's organization.
   - Generates sequential delivery number `DEL-2026-000001`.
   - Commits `deliveries/{deliveryId}` with `status: "pending"`.
   - **Automated Trigger**: `onDeliveryWritten` automatically generates an in-app notification in `notifications` for rider `usr_rider_alex_org_kochi_001` ("New Delivery Assigned").

### 3.2 Rider Completes Delivery
1. **Rider calls `deliveriesUpdateStatus`**:
   - **Endpoint**: `POST /deliveriesUpdateStatus`
   - **Request Payload**:
     ```json
     {
       "data": {
         "deliveryId": "del_001",
         "status": "delivered",
         "codCollected": true,
         "collectedAmount": 1450.00,
         "paymentMethod": "cash",
         "notes": "Delivered to customer Rahul S."
       }
     }
     ```
2. **Backend Execution**:
   - Updates `deliveries/del_001`: `status: "delivered"`, `completedAt: "<timestamp>"`.
   - Because `codCollected === true`, records payment in `payments` (`direction: "in"`).

### 3.3 Processing a Customer Return (Restocking Stock)
1. **Cashier calls `returnsCreate`**:
   - **Endpoint**: `POST /returnsCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "returnType": "sales_return",
         "referenceId": "bill_inv_001",
         "refundMethod": "credit_note",
         "items": [
           {
             "productId": "prod_cardamom_100g",
             "quantity": 1,
             "refundAmount": 450.00,
             "reason": "Customer ordered excess quantity",
             "disposition": "restocked_to_inventory"
           }
         ],
         "idempotencyKey": "ret_create_lease_001"
       }
     }
     ```
2. **Backend Execution**:
   - Checks that product `isReturnable !== false`.
   - Verifies return quantity does not exceed un-returned billed quantity.
   - Restocks 1 unit in `stockBalances` and increments aggregate `products.currentStock`.
   - Appends `stockMovements` entry (`movementType: "sale_return_in"`).
   - Decrements customer `outstandingBalance` by ₹450.00 in `customers` and appends `customerLedgers` (`return_credit`).
   - Issues return number `RET-2026-000001` and commits `returns/{returnId}`.

---

## 4. Verification Checkpoints

1. **Verify Stock Restoration on Return**:
   Assert that `stockBalances` increased by returned quantity when `disposition == "restocked_to_inventory"`.
2. **Verify Non-Returnable Denial**:
   Attempting to return a product with `isReturnable: false` throws `invalid-argument`.
3. **Verify Over-Return Denial**:
   Attempting to return more than billed quantity throws `invalid-argument`.
