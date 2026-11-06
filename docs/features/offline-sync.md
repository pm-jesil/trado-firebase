# Feature Guide: Offline-Sync Contract & Resilience

---

## 1. Purpose & Scope
This guide specifies the backend contract, idempotency guarantees, and data isolation policies supporting mobile offline synchronization for Trado:
- **Backend Idempotency Contract**: All write callables accept client-generated `idempotencyKey` strings and provide 24-hour request deduplication.
- **Transactional Safety**: Server-side transactions ensure network drops during multi-collection mutations either commit completely or roll back cleanly without partial corruption.
- **Client vs. Backend Boundary**: This document details verified backend capabilities. Client-side local SQLite caching, conflict resolution UI, and queueing in the Flutter mobile application are client responsibilities.

---

## 2. Backend Idempotency Architecture (`idempotencyRecords`)

Every financial and inventory write API (`billsCreate`, `billsFinalize`, `outflowsCreate`, `paymentsCreate`, `returnsCreate`, `organizationsCreate`) accepts an optional or required `idempotencyKey`.

```
                    [Client Request with IdempotencyKey]
                                     |
                                     v
                 [Check idempotencyRecords/{idempotencyKey}]
                                     |
            +------------------------+------------------------+
            |                                                 |
     (Exists & PROCESSING)                           (Exists & COMPLETED)
            |                                                 |
   Throws already-exists                           Returns cachedResult
   "Operation in progress"                         (Zero duplicate mutations)
            |
            v
     (Does Not Exist)
            |
   [Acquire Lease: status=PROCESSING]
            |
   [Execute Business Logic Transaction]
            |
            +-------------[Success]-------------> [Update status=COMPLETED, cachedResult]
            |
            +-------------[Error]---------------> [Update status=FAILED, error]
```

### Idempotency Invariants
1. **Duplicate Replay Protection**: If a mobile POS device loses Wi-Fi while submitting a ₹10,000 cash sale, the client may retry the request upon reconnecting. The backend detects the completed lease and returns the original bill receipt. Stock is deducted **only once**.
2. **Concurrent Request Lock**: If two client threads submit the same `idempotencyKey` simultaneously, the first acquires the lease; the second receives `already-exists: "Operation in progress. Please retry shortly."`.
3. **24-Hour TTL**: Records store `expiresAt: timestamp + 24 hours` for automatic cleanup.
4. **Lease Expiry Recovery**: If a server process crashes mid-transaction leaving a lease stuck in `PROCESSING`, a timeout guard allows safe recovery after 30 seconds rather than permanently bricking that key.

---

## 3. Optimistic Concurrency & Versioning

- Documents supporting high-concurrency updates (such as `bills`, `outflows`, `branches`) maintain `updatedAt` timestamps and status checks.
- When an offline client attempts to finalize an invoice that was already finalized or cancelled by another cashier while the device was offline, the transaction detects the status change and rejects with `failed-precondition: "Bill is already finalized"`.
- This ensures stale mobile states cannot overwrite completed cloud transactions.

---

## 4. Mobile Offline Recommendations (Flutter Client Guidance)

When integrating the Flutter client with Trado Cloud Functions:
1. **UUIDv4 Idempotency Keys**: Generate a unique UUIDv4 key for every user-initiated checkout or payment before enqueuing in the local database.
2. **Deterministic Retries**: When connectivity returns, replay queued transactions in chronological order using the stored `idempotencyKey`.
3. **Handling HTTP 409 / Already Exists**: If the server returns `already-exists`, wait 1.5 seconds and retry with the same key; if completed, the server will return the final result.
4. **Read-Only Offline Mode**: For offline product lookup, cashiers can search cached SQLite product catalogs. However, stock quantities should be marked as "Unverified Offline Stock" until online balance synchronization is confirmed.

---

## 5. Security & Isolation Rules
- **Tenant Scoping**: Idempotency records store `organizationId`. A client cannot query or reuse an idempotency key across different tenants.
- **Audit Logging**: Request deduplication events write minimal audit logs and never store sensitive credit card or user credentials.

---

## 6. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify idempotency replay for `organizationsCreate` and `billsCreate`.
  - Tests verify concurrent Promise.all calls with identical keys create exactly one document.
  - Tests verify lease recovery when an in-progress slot expires.

