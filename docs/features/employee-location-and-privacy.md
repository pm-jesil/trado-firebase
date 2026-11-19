# Feature Guide: Employee Live Location Tracking & Privacy

---

## 1. Purpose & Scope
This module provides real-time fleet visibility, delivery rider route monitoring, and privacy-compliant location telemetry for Trado:
- **Active Fleet Overview**: `latestLocations/{locationId}` (keyed deterministically as `${organizationId}_${membershipId}`) stores the single latest known GPS ping per employee for instant fleet dashboard rendering.
- **Historical Telemetry Trail**: `locationPings/{pingId}` (keyed as `${organizationId}_${membershipId}_${timestamp}`) stores chronological GPS pings for route audit and delivery proof.
- **5-Second Ingestion Throttle**: Enforces rate limiting on incoming telemetry pings (`MIN_PING_INTERVAL_MS = 5000`) to prevent Firestore write exhaustion.
- **Privacy & Consent Protection**: Requires explicit consent (`locationTrackingEnabled: true`) on the employee's membership before accepting location data.
- **Support-Access Privacy Fence (MG-40)**: Platform Super Admins are strictly prohibited from reading employee coordinates unless an active tenant-granted support access grant exists (`supportAccessExpiresAt > now`).

---

## 2. Actors & Permissions
- **Delivery Rider / Field Agent**: Requires `location:ping`. Submits periodic GPS coordinates (`latitude`, `longitude`, `accuracy`, `speed`) while on active duty. May view own location trail via `location:view_own`.
- **Fleet / Team Manager**: Requires `locations:view_team` (or admin/owner role). Scoped to viewing real-time coordinates (`locationsGetLatest`) and route history (`locationsGetHistory`) of employees within their assigned branch or team.
- **Tenant Administrator / Store Owner**: Has full organization-wide visibility over active delivery fleets and route pings.
- **Standard Cashiers / Non-Field Staff**: Cannot read or access location telemetry of peer employees.
- **Platform Super Admin**: Forbidden from accessing employee location coordinates. Access requires an explicit, expiring tenant-granted support token (`supportAccessExpiresAt > now`) and is fully audited.

---

## 3. Privacy, Consent & Rate-Limiting Guarantees

### Explicit Employee Consent Check
- Before ingesting a ping, `locationsRecordPing` checks `memberships/{membershipId}.locationTrackingEnabled`.
- If `locationTrackingEnabled !== true` and caller is not owner/admin, the ping is rejected with `failed-precondition: "Live location tracking is not enabled for this employee account. Admin consent configuration required."`.
- Location tracking can be toggled off at any time by the administrator or employee.

### 5-Second Ingestion Rate-Limiter & Ping Cost Facts
- High-frequency mobile GPS chips can emit pings every 1–2 seconds. Ingesting every ping directly would exhaust database write limits and client battery.
- `locationsRecordPing` reads `latestLocations/{orgId}_{membershipId}`.
- If:
  $$\text{Current Time} - \text{Last Ping Time} < 5\text{ seconds}$$
  The backend responds with `{ success: true, rateLimited: true, recordedAt: existing.recordedAt }`.
- **Cost Metrics**:
  - **Throttled Ping**: 1 Firestore document read (`latestLocations`), 0 document writes.
  - **Accepted Ping**: 1 Firestore document read (`latestLocations`) + 2 document writes (`latestLocations` update + `locationPings` insert).

---

## 4. Step-by-Step Workflows

### 4.1 Field Agent Submits GPS Ping
1. **Mobile Agent calls `locationsRecordPing`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "latitude": 9.9312,
       "longitude": 76.2673,
       "accuracy": 5.2,
       "heading": 180.0,
       "speed": 12.5,
       "source": "foreground"
     }
     ```
2. **Backend Execution**:
   - Verifies caller has active membership with `locationTrackingEnabled: true`.
   - Checks rate-limit timestamp against `latestLocations/{orgId}_{membershipId}`.
   - Atomically updates `latestLocations/{orgId}_{membershipId}` with latest coordinates and sets `expiresAt` (7 days TTL).
   - Appends historical ping record to `locationPings/{orgId}_{membershipId}_{timestamp}` with `createdAt: "<timestamp>"` and `expiresAt` (7 days TTL).

### 4.2 Manager Audits Delivery Route
1. **Manager calls `locationsGetHistory`**:
   - Payload: `{ "organizationId": "org_demo", "membershipId": "mem_rider_alex", "from": "2026-10-29T08:00:00Z", "to": "2026-10-29T18:00:00Z", "limit": 50 }`.
2. **Backend Processing**:
   - Requires `locations:view_team` (scoped to team/branch).
   - Queries `locationPings` where `organizationId == org_demo` and `membershipId == mem_rider_alex`.
   - Returns chronologically ordered coordinate points for map route playback.

---

## 5. Security & Isolation Invariants
- **Multi-Tenant Guard**: Managers can only view location telemetry of staff belonging to their own organization.
- **Reference-by-ID Compliance**: Location documents store `membershipId`, `userId`, and `organizationId` as bare IDs. Personal profiles or customer delivery documents are never embedded.
- **Automated TTL Retention Policy**: Ephemeral GPS breadcrumbs in both `locationPings` and `latestLocations` expire automatically after **7 days** using Firestore TTL (`expiresAt` field) and are pruned daily in `subscriptionAndUsageSweep`.
- **Super Admin Support Fence (MG-40)**: Super Admin attempts to read location coordinates without `supportAccessExpiresAt > now` are rejected with `permission-denied`.

---

## 6. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-operations-tasks-callables.cjs`.
  - Tests verify initial ping recording, rate-limiting on immediate follow-up ping (`rateLimited: true`), fleet view retrieval (`locationsGetLatest`), and route history retrieval (`locationsGetHistory`).
- **Unit Tests**: `functions/src/test/unit/locationsPrivacy.test.ts` (Super Admin access fence, TTL expiry calculation, team scope enforcement) and `functions/src/test/unit/operationsValidation.test.ts` (Coordinate boundary validation tests: latitudes -90 to +90, longitudes -180 to +180).
