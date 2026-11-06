# Workflow Runbook: Reports, Tasks, Live Location & Notifications

---

## 1. Overview & Business Context
This runbook covers operational intelligence and field management workflows for Trado:
- Real-time Firestore analytics, Profit & Loss reports, and multi-branch CSV exports (`reportsExportCsv`).
- Task assignment, self-assignment permission guards, and completion lifecycle.
- Privacy-compliant employee live location tracking with a 30-second rate-limiting throttle.
- Automated notification dispatch via event triggers and in-app inbox management.

---

## 2. Actors & Permissions
- **Store Manager / Accountant**: Requires `report:view` and `report:export`. Can access financial reports and export CSVs.
- **Store Admin**: Requires `task:create` and `task:assign`. Can assign tasks to staff members.
- **Delivery Rider / Field Agent**: Requires `location:ping`. Submits periodic GPS coordinates while on duty.
- **Fleet Supervisor**: Requires `location:view`. Can inspect real-time fleet overview (`locationsGetLatest`) and route trails (`locationsGetHistory`).

---

## 3. Step-by-Step Execution Sequences

### 3.1 Generating a Profit & Loss Report with CSV Export
1. **Manager calls `reportsGetProfitLoss`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "from": "2026-10-01",
         "to": "2026-10-31",
         "branchId": "main-branch"
       }
     }
     ```
2. **Backend Execution**:
   - Aggregates finalized bills for revenue (`₹42,000`).
   - Computes COGS based on product WAC (`₹28,500`).
   - Subtracts operating expenses from `outflows` (`₹4,500`).
   - Returns Net Profit: $42,000 - 28,500 - 4,500 = ₹9,000$.
3. **Manager calls `reportsExportCsv`**:
   - Payload: `{ "data": { "organizationId": "org_kochi_001", "reportType": "profit_loss", "branchId": "main-branch" } }`.
   - Returns RFC 4180-compliant CSV string.

### 3.2 Task Assignment & Completion Lifecycle
1. **Manager calls `tasksCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "title": "Audit warehouse bay 4 spice bags",
         "priority": "high",
         "assignedToMembershipId": "mem_emp_001",
         "dueDate": "2026-10-30T17:00:00Z"
       }
     }
     ```
2. **Backend Processing**:
   - Validates that `mem_emp_001` belongs to `org_kochi_001`.
   - Commits `tasks/{taskId}` with `status: "pending"`.
   - Generates automated in-app notification in `notifications` for `mem_emp_001`.
3. **Employee Completes Task**:
   - Calls `tasksUpdateStatus`: `{ "data": { "organizationId": "org_kochi_001", "taskId": "task_101", "status": "completed" } }`.

### 3.3 Employee Live Location Tracking & Throttling
1. **Field Agent calls `locationsRecordPing`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "latitude": 9.9312,
         "longitude": 76.2673,
         "accuracy": 4.8,
         "speed": 15.2
     }
     ```
2. **Backend Execution**:
   - Verifies `membership.locationTrackingEnabled === true`.
   - Checks last ping timestamp against `latestLocations`:
     - If $>5$ seconds: Atomically updates `latestLocations/{orgId}_{membershipId}` and appends ping record in `locationPings/{pingId}`.
     - If $<5$ seconds: Drops write to prevent database write exhaustion, returns `{ success: true, rateLimited: true }`.
3. **Supervisor Audits Fleet**:
   - Calls `locationsGetLatest`: returns current GPS coordinates of all active staff.
   - Calls `locationsGetHistory`: returns chronological breadcrumb trail for route playback.

### 3.4 Automated Notifications & Inbox Management
1. **Transaction Event Occurs**:
   - When a bill is finalized, trigger `onBillWritten` fires.
   - Writes notification to `notifications`:
     - `title`: `"New Bill Created"`
     - `body`: `"Invoice INV-2026-000001 for Rs 900 was generated."`
     - `type`: `"bill_created"`
2. **User Reads Notification**:
   - Calls `notificationsList`: retrieves notification inbox.
   - Calls `notificationsMarkRead`: `{ "data": { "notificationId": "notif_101" } }`.
   - Backend updates `notifications/notif_101`: `isRead: true`, `readAt: "<timestamp>"`.

---

## 4. Failure & Invariant Safeguards

| Scenario | Trigger | Outcome | Reason |
|---|---|:---:|---|
| **Employee Assigns Task to Manager** | Standard employee calls `tasksCreate` assigning to another staff member | Rejected with `permission-denied` | Standard employees can only assign tasks to themselves. Assigning to others requires `task:assign`. |
| **Location Ping Without Consent** | Agent has `locationTrackingEnabled: false` on membership | Rejected with `failed-precondition` | Location tracking requires explicit employee consent. |
| **High-Frequency GPS Pings** | Agent submits 5 pings in 10 seconds | Throttled safely | Pings under 30s interval are dropped (`rateLimited: true`) without writing to Firestore. |

---

## 5. Local Testing & Verification
- **Integration Tests**: Parts 1–4 of `functions/scripts/test-phase3-integration.js`.
  - Tests verify 7 report callables, task lifecycle, location throttling, and automated trigger notification generation.

