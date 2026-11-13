# Feature Guide: Notifications & Automated Triggers

---

## 1. Purpose & Scope
This module provides in-app notification management, multi-device Firebase Cloud Messaging (FCM) token registration, and event-driven trigger automations for Trado:
- **In-App Notification Inbox**: `notifications/{notificationId}` stores persistent, auditable notification records for users with unread/read state tracking.
- **Dedicated Device Subcollection**: `users/{uid}/devices/{deviceId}` manages multiple active devices per user, tracking device platform, model, and app version.
- **Automated Event Triggers**: 4 Firestore triggers (`onBillWritten`, `onOutflowWritten`, `onPaymentWritten`, `onDeliveryWritten`) automatically dispatch notifications upon operational transactions.
- **Safe Local Testing**: Uses a modular notification adapter with a mock sender in local test environments to prevent accidental live FCM transmission.

---

## 2. Actors & Permissions
- **All Authenticated Staff**: Can register their device FCM tokens (`notificationsRegisterFcmToken`), list their notifications (`notificationsList`), and mark notifications as read (`notificationsMarkRead`).
- **Managers & System Triggers**: Can trigger operational events that automatically dispatch targeted notifications to employees.

---

## 3. Dedicated Device Subcollection Architecture

### Subcollection vs. Flat Array
In modern Trado architecture, FCM tokens are stored in:
`users/{userId}/devices/{deviceId}`
- **Benefits**:
  - Eliminates document size limits caused by unbounded `fcmTokens: string[]` array growth.
  - Enables per-device telemetry (`platform`: `android` | `ios` | `web`, `deviceModel`, `appVersion`).
  - Supports automatic cleanup of dead or replaced device tokens via `lastSeenAt`.
  - `UserDoc.fcmTokens` is maintained as an optional backward-compatible cache.

---

## 4. Automated Transaction Event Triggers

The module `functions/src/triggers/eventTriggers.ts` exports 4 Cloud Functions Gen 2 triggers that execute automatically when transactions are recorded:

| Event Trigger | Firestore Watch Path | Generated Notification Type | Target Recipient & Payload |
|---|---|---|---|
| **`onBillWritten`** | `bills/{billId}` | `bill_created` | Alerts store manager: "New Bill Created" (Invoice number and total amount). |
| **`onOutflowWritten`** | `outflows/{outflowId}` | `outflow_recorded` | Alerts finance lead: "Expense Recorded" (Outflow number, category, and amount). |
| **`onPaymentWritten`** | `payments/{paymentId}` | `payment_received` | Alerts cashier/admin: "Payment Received" (Amount and invoice reference). |
| **`onDeliveryWritten`**| `deliveries/{deliveryId}` | `delivery_assigned` | Alerts assigned rider: "New Delivery Assigned" (Recipient name and address). |

---

## 5. Step-by-Step Happy Path Workflows

### 5.1 Mobile Device Registration
1. **Flutter App calls `notificationsRegisterFcmToken`**:
   - Payload:
     ```json
     {
       "deviceId": "uuid_pixel_7_abc",
       "fcmToken": "fcm_token_string_here",
       "platform": "android",
       "deviceModel": "Pixel 7 Pro",
       "appVersion": "1.0.4"
     }
     ```
2. **Backend Execution**:
   - Commits `users/{callerUid}/devices/uuid_pixel_7_abc`.
   - Sets `lastSeenAt: "<timestamp>"`, `isActive: true`.

### 5.2 Reading In-App Notifications
1. **User calls `notificationsList`**:
   - Backend queries `notifications` where `recipientUserId == callerUid`.
   - Returns unread and read notification records ordered by `createdAt desc`.
2. **User calls `notificationsMarkRead`**:
   - Payload: `{ notificationId: "notif_001" }`.
   - Backend updates `notifications/notif_001`: `isRead: true`, `readAt: "<timestamp>"`.

---

## 6. Local Testing Safeguards
- **Mock Notification Adapter**: When `FIRESTORE_EMULATOR_HOST` is active, the notification service routes push dispatches to `MockNotificationSender`.
- **Zero Live FCM Dispatch**: Guarantees no real mobile devices receive spurious alerts during test runs.
- **Verification**: Part 4 of `functions/scripts/test-phase3-integration.js` verifies notification inbox listing, read-status updates, and asserts that all 4 triggers generate corresponding records.

