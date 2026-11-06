# Feature Guide: Deliveries & Dispatch Management

---

## 1. Purpose & Scope
This module provides delivery dispatch, rider assignment, and order fulfillment tracking for Trado:
- **Delivery Document**: `deliveries/{deliveryId}` tracks fulfillment lifecycle, recipient contact details, delivery addresses, and rider assignments.
- **Reference-by-ID Architecture**: Deliveries reference their parent order via `billId` by bare ID only. The entire bill document is never embedded.
- **Status Lifecycle**: Tracks shipment progression (`pending -> dispatched -> delivered -> failed`).
- **Automated Push Notifications**: The trigger `onDeliveryWritten` automatically dispatches an in-app and push notification when a rider is assigned to a delivery.

---

## 2. Actors & Permissions
- **Dispatch Manager / Cashier**: Requires `delivery:create` or `delivery:write`. Can schedule deliveries upon bill creation, enter shipping addresses, and assign riders.
- **Delivery Rider**: Requires `delivery:read` and `delivery:status`. Can view assigned delivery orders, access customer phone/address, and update transit status (`dispatched`, `delivered`, `failed`).
- **Customer Support / Auditor**: Requires `delivery:read`. Can inspect delivery logs and retrieve tracking information.

---

## 3. Delivery Status Lifecycle

```
    [Create Delivery]
           |
           v
       (PENDING) ------[Rider Assigned / Dispatched]------> (DISPATCHED)
           |                                                      |
           |                                                      +-----> (DELIVERED) [Success]
           +------------[Immediate Cancel / Abort]---------> (FAILED)   [Address Not Found / Rejected]
```

### Supported Status Transitions
- `pending`: Delivery order created, awaiting packing or vehicle assignment.
- `dispatched`: Goods handed over to rider or transport courier; in transit to customer.
- `delivered`: Goods successfully handed over to customer; electronic proof or receipt confirmed.
- `failed`: Delivery attempted but unsuccessful (customer unavailable, incorrect address, goods refused).

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Creating a Delivery Order
1. **Cashier calls `deliveriesCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "billId": "bill_inv_001",
       "riderMembershipId": "mem_rider_alex",
       "recipientName": "Rahul Sharma",
       "recipientPhone": "+919876543210",
       "deliveryAddress": "Flat 4B, Emerald Heights, Kochi",
       "notes": "Fragile items inside"
     }
     ```
2. **Backend Execution**:
   - Verifies `bill_inv_001` exists in `org_demo`.
   - Generates sequential delivery number `DEL-2026-000001`.
   - Commits `deliveries/{deliveryId}` with `status: "pending"`.
   - Fires trigger `onDeliveryWritten`: writes in-app notification to `notifications` assigned to rider `mem_rider_alex`.

### 4.2 Rider Updates Delivery Status to Delivered
1. **Rider calls `deliveriesUpdateStatus`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "deliveryId": "del_001",
       "status": "delivered",
       "proofOfDelivery": "Received by customer Rahul S."
     }
     ```
2. **Backend Execution**:
   - Updates `deliveries/del_001`: sets `status: "delivered"`, `completedAt: "<timestamp>"`.
   - Records audit log entry in `auditLogs`.

---

## 5. Security & Anti-Embedding Compliance
- **Anti-Embedding**: The delivery document stores `billId` as a reference string. It does not duplicate invoice line items, tax breakdowns, or customer master records.
- **Branch Attribution**: Deliveries belong to the originating dispatch branch (`branchId`). Riders only see deliveries originating from their assigned operating branches.

---

## 6. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify `deliveriesCreate` stores `billId` by ID only without embedding the bill document.
- **Trigger Test**: Part 4 of `functions/scripts/test-phase3-integration.js` verifies automated notification generation on delivery assignment.

