# Phase 1 Platform Architecture & Data Flow

**Document Version**: 1.0.0  
**Project**: Trado Firebase Backend (Phase 1)

---

## 1. System Topology & Boundaries

```mermaid
flowchart TB
    Client[Flutter Mobile / Web App]
    
    subgraph Firebase Platform [Firebase / Google Cloud asia-south1]
        Auth[Firebase Authentication]
        Storage[Cloud Storage\navatars & logos]
        
        subgraph Cloud Functions Gen 2 [Cloud Functions Server Boundary]
            Callables[Callable Functions\n29 Endpoints]
            Resolver[4-Layer Permission Resolver]
            IdemOrch[Idempotency Orchestrator]
            AuditService[Lean Audit Logger]
            CompService[Compensating Rollback]
            NotifSender[Notification Sender Adapter]
        end
        
        subgraph Firestore [Cloud Firestore Native Mode]
            UsersCol[(users)]
            MemCol[(memberships)]
            OrgCol[(organizations)]
            RolesCol[(roles)]
            CatCol[(catalogs / plans)]
            AuditCol[(auditLogs)]
            IdemCol[(idempotencyRecords)]
            OutboxCol[(notificationOutbox)]
        end
    end

    Client -- HTTPS Callable Protocol --> Callables
    Client -- Direct SDK Read with Rules --> Firestore
    Client -- Direct SDK Upload with Rules --> Storage
    Client -- Login / Credentials --> Auth
    
    Callables --> Resolver
    Callables --> IdemOrch
    Callables --> CompService
    Callables --> AuditService
    Callables --> NotifSender
    
    Callables --> Firestore
    Callables --> Auth
```

---

## 2. Multi-Tenancy Isolation Architecture

1. **Server-Side Enforcement**:
   - Multi-tenant isolation is never left to client-supplied tenant IDs.
   - For all tenant-scoped callables (`employees.*`, `roles.*`, `teams.*`, etc.), the server verifies the caller's membership in the target organization by querying `memberships/{callerUid}_{targetOrgId}`.
2. **Firestore Security Rules Perimeter**:
   - All direct client writes (`set`, `update`, `delete`) to Firestore are globally denied (`allow write: if false;`).
   - Client reads are strictly bounded:
     - A user may only read organizations where an active membership document `memberships/{request.auth.uid}_{orgId}` exists.
     - Cross-tenant queries are blocked.
     - Internal operational records (`auditLogs`, `idempotencyRecords`, `notificationOutbox`) deny all client reads and writes.

---

## 3. Provisioning & Two-Phase Compensation Flow

Because Firebase Auth and Cloud Firestore cannot participate in a single distributed ACID transaction, user provisioning utilizes a compensating rollback pattern:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Super Admin / Org Admin
    participant Fn as Cloud Function (Gen 2)
    participant Idem as idempotencyRecords
    participant Auth as Firebase Auth
    participant FS as Firestore Batched Write
    participant Outbox as notificationOutbox
    participant Audit as auditLogs

    Admin->>Fn: call organizationsCreate / employeesCreate (with idempotencyKey)
    Fn->>Idem: Reserve slot (transactional check)
    alt Duplicate Request Found
        Idem-->>Fn: Return cached safe result
        Fn-->>Admin: Cached response (0 side effects)
    end
    Fn->>Auth: createUser(email, password, displayName)
    Auth-->>Fn: createdAuthUid
    
    rect rgb(240, 248, 255)
        Note over Fn, FS: Attempt Firestore Batched Creation
        Fn->>FS: batch.commit(orgDoc, userDoc, membershipDoc)
        alt Firestore Write Fails
            FS-->>Fn: Write Error
            Fn->>Auth: deleteUser(createdAuthUid) [COMPENSATION ROLLBACK]
            Fn->>Idem: Record FAILED status
            Fn->>Audit: Log COMPENSATION event
            Fn-->>Admin: Error response (clean state, no orphan Auth account)
        else Firestore Write Succeeds
            FS-->>Fn: Success
            Fn->>Outbox: Queue Welcome Notification
            Fn->>Audit: Write Lean Audit Log
            Fn->>Idem: Finalize SUCCEEDED status & safe result
            Fn-->>Admin: Return provisioned IDs & status
        end
    end
```

---

## 4. Push Notification Foundation & Outbox Flow

1. **Local Isolation**:
   - Firebase Local Emulator Suite does not emulate APNs or live mobile FCM delivery.
   - A pluggable `NotificationSender` interface is used with a `MockNotificationSender` in emulator tests to ensure zero unexpected network calls or credential requirements.
2. **Delayed Welcome Dispatch**:
   - When an employee is provisioned, their mobile device token does not yet exist.
   - A pending record is placed in `notificationOutbox/{id}`.
   - Upon initial sign-in, the employee's client invokes `notificationsRegisterFcmToken` with their device hardware ID and FCM token.
   - The server stores the token at `users/{uid}/devices/{deviceId}`, inspects the outbox for pending welcome notifications for that user, dispatches them exactly once through the sender adapter, and marks the outbox status as `dispatched`.

---

## 5. Explicit Scope Boundaries (Phase 2 & 3 Non-Scope)

To maintain platform stability, Phase 1 code does **not** implement:
- **Phase 2 Exclusions**: POS sales register engine, B2B wholesale orders, purchases, expenses, inventory movements/stock adjustments, vendor/customer CRM, returns, delivery dispatcher, and country tax calculations.
- **Phase 3 Exclusions**: Executive reports/analytics dashboards, tasks, live location tracking, offline sync hardening, and cross-collection integrity auditing.

