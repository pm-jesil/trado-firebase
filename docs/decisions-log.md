# Trado Architectural Decisions Log

This document records the foundational product and technical architecture decisions made during the design and implementation of the Trado Firebase backend. It provides permanent context for why specific patterns were chosen.

---

## Decision 1: Branch Architecture — Option B (Subcollection Model)

- **Date**: Confirmed Final Architecture
- **Decision**: Organizations contain physical branches as a Firestore subcollection: `organizations/{organizationId}/branches/{branchId}`. The default canonical branch is always `main-branch`.
- **Alternatives Considered**: Option A (each branch as a separate Organization document).
- **Rationale**:
  - A merchant operates as one legal corporate entity with unified billing, one subscription plan, and unified tax registration.
  - Multi-location merchants need shared catalog definitions, centralized employee directories, and cross-branch sales analytics without managing multiple independent tenant accounts.
  - Option B provides clean Firestore path hierarchy (`organizations/{orgId}/branches/{branchId}`) while maintaining physical inventory isolation.

---

## Decision 2: Inventory Architecture — Catalog Sharing vs. Physical Stock Isolation

- **Date**: Confirmed Final Architecture
- **Decision**: Product definitions (`products`) are shared tenant-wide, while physical stock balances (`stockBalances`) are strictly isolated per branch.
- **Data Model**:
  - Master product: `products/{productId}` (name, SKU, barcode, unit, sellingPrice, aggregate `currentStock`).
  - Branch physical stock: `stockBalances/{orgId}_{branchId}_{productId}` (`currentStock`, `lowStockThreshold`).
- **Rationale**:
  - A retailer selling "Basmati Rice 10kg" across 5 stores has one catalog entry, but store A may have 20 bags while store B has 0.
  - Secondary branches initialize at 0 stock on creation, preventing accidental aggregate stock inheritance.
  - Stock movements (`stockMovements`) audit every physical stock increment or decrement with branch attribution.

---

## Decision 3: Staff Branch Assignment — Normalized Join Collection (`membershipBranches`)

- **Date**: Confirmed Final Architecture
- **Decision**: Staff access to branches is modeled via a standalone join collection: `membershipBranches/{membershipId}_{branchId}`.
- **Alternatives Considered**: Storing an array of branch IDs on `memberships` or storing an array of member IDs on `branches`.
- **Rationale**:
  - Embedding arrays violates the standing anti-embedding principle and creates race conditions when multiple managers assign staff concurrently.
  - `membershipBranches` allows storing branch-specific metadata (e.g. branch-specific roles, temporary assignments, branch permission overrides) without mutating the core membership profile.

---

## Decision 4: Financial Costing Engine — Perpetual Weighted-Average Cost (WAC)

- **Date**: Confirmed Final Architecture
- **Decision**: Inventory valuation and Cost of Goods Sold (COGS) are calculated using perpetual Weighted-Average Costing.
- **Alternatives Considered**: First-In-First-Out (FIFO) or standard fixed cost price.
- **Rationale**:
  - In wholesale and grocery environments, stock batches arrive at varying purchase prices throughout the month.
  - WAC automatically smooths price fluctuations and provides accurate, continuous margin tracking without requiring complex FIFO lot-queue tracking in Firestore transactions.

---

## Decision 5: Decimal Precision & Float Drift Mitigation

- **Date**: Confirmed Final Architecture
- **Decision**: All financial operations use commercial rounding with `Number.EPSILON` (`services/money.ts`). Monetary amounts are stored to 2 decimals; unit rates and WAC costing are stored to 4 decimals.
- **Rationale**:
  - JavaScript IEEE 754 floating-point numbers produce fractional inaccuracies (e.g. `0.1 + 0.2 = 0.30000000000000004`).
  - Enforcing 2-decimal financial values with 4-decimal rate precision prevents rounding accumulation errors across large invoices or high-volume item orders.

---

## Decision 6: Standing Anti-Embedding Principle

- **Date**: Confirmed Final Architecture
- **Decision**: No document embeds another foreign entity document. Every relationship is modeled as a bare ID reference.
- **Exception**: Display snapshots ending with `...Snapshot` (e.g. `customerSnapshot`, `taxSnapshot`) are permitted solely for immutable invoice rendering and legal tax audit.
- **Rationale**:
  - Embedding full user or customer records leads to stale data drift (e.g. customer updates phone number, but old bills show old phone or duplicate writes fail halfway).
  - Referenced entities remain single sources of truth.

---

## Decision 7: Live Location Tracking — Dual-Collection & 7-Day TTL

- **Date**: Confirmed Final Architecture
- **Decision**: Location tracking uses a dual-collection design:
  - `latestLocations/{orgId}_{membershipId}`: Current real-time position for dispatch dashboards (overwritten on each ping).
  - `locationPings/{orgId}_{membershipId}_{timestamp}`: Ephemeral breadcrumb trail with 7-day retention.
- **Rationale**:
  - Dispatch operators query single documents for staff positions without scanning historical trails.
  - Historical trail pings expire automatically after 7 days via Firestore TTL, eliminating database bloat and operational storage costs.
  - Mandatory consent flag (`locationTrackingEnabled`) and 5-second rate-limiting prevent unauthorized battery and quota consumption.

---

## Decision 8: Subscription Capacity — Branch Limit Enforcement (`branchLimit`)

- **Date**: Confirmed Final Architecture
- **Decision**: Subscription plans enforce strict branch quotas via `branchLimit`. Creation, reactivation, and deactivation run inside transactional capacity checks.
- **Downgrade Policy**: If an organization downgrades to a plan with fewer branches than currently active, existing branches are grandfathered into read-only access (no automated deletion), and new branch provisioning is blocked until capacity is freed.

---

## Decision 9: Usage Metering — Internal Diagnostic Telemetry (Never Automated Billing)

- **Date**: Confirmed Final Architecture
- **Decision**: Usage metering (`usageRecordMetric`, `usageCalculateDryRunStatement`) is strictly an internal diagnostic telemetry system for Super Admins to monitor tenant resource consumption.
- **Legal Guarantee**: Generated dry-run usage statements are non-binding diagnostic estimates of infrastructure utilization. Every generated statement includes an explicit legal disclaimer confirming it is NOT an invoice and no automated charge has occurred.

---

## Decision 11: Canonical Authentication Flow for Flutter Clients vs. Local Testing Adapter

- **Date**: 2026-11-05
- **Context**: Mobile/web clients (Flutter) and developer testing tools (API Explorer, Swagger UI, curl, Postman) interact with Firebase backend services differently. Flutter clients integrate the official Firebase Auth and Cloud Functions client SDKs natively, while REST-based tools cannot execute the client SDK protocol.
- **Decision**: 
  - **Canonical Production Flow (Flutter Web / Mobile)**: The client authenticates directly using the official Firebase Authentication client SDK (`FirebaseAuth.instance.signInWithEmailAndPassword(email, password)`). Firebase Auth securely manages cryptographic session tokens, secure storage, and automatic ID token refreshing. The Firebase Functions callable SDK (`FirebaseFunctions.instance.httpsCallable(...)`) automatically attaches the caller's active Firebase ID token in the `Authorization: Bearer <idToken>` request header on every callable request. The client does NOT pass tokens in JSON request bodies. Upon successful sign-in, the Flutter client calls `authMe` to fetch the authoritative profile, organizations, active memberships, assigned branches, job roles, and permissions.
  - **Testing & Tooling Adapter (`authLogin` HTTPS Callable)**: The `authLogin` HTTPS callable is maintained strictly as an adapter for manual developer testing, Swagger UI, curl, and `.http` workbench scripts that run outside the Firebase client SDK ecosystem. It validates credentials against the Firebase Auth REST API (or emulator) and returns `idToken`, `accessToken`, `refreshToken`, `expiresInSeconds`, `profile`, `user`, `organizations`, `branches`, `jobRoles`, and `permissions`.
- **Security Hardening**:
  - `authLogin` emits generic authentication error messages (`"Invalid email or password."`) on any authentication failure, preventing email enumeration.
  - Password and refresh tokens are never written to audit logs or system logs.
  - Public login supports an optional `deviceId` for session audit logging without conflating device sessions with push notification FCM tokens (which are registered separately via `authUpdateProfile`).

---

## Decision 12: Server-Derived Tenant Context and Super Admin Platform Isolation

- **Date**: 2026-11-05
- **Context**: Relying on client-supplied `organizationId` and `branchId` in JSON request bodies creates severe security vulnerabilities, including tenant spoofing, cross-tenant data leaks, and unauthorized cross-branch stock modifications. Furthermore, Super Admins need platform management capabilities without possessing fake memberships in tenant organizations.
- **Decision**:
  - **Server-Derived Context (`services/tenantContext.ts`)**: For all operational tenant callables (`bills`, `products`, `customers`, `vendors`, `outflows`, `deliveries`, `returns`, `payments`, `stock`), `organizationId` and `branchId` are derived server-side from the verified caller's Firebase Auth token (`request.auth.token.primaryOrganizationId`) or active Firestore `memberships` records.
  - **Client Omission & Forgery Prevention**: Flutter clients do not need to send `organizationId` or `branchId` in request bodies. If a client does provide an `organizationId`, it is strictly verified against the caller's active membership; mismatches are rejected immediately with `permission-denied`.
  - **Super Admin Platform Isolation**: Super Admin (`isSuperAdmin: true`) is strictly platform-scoped. Super Admin possesses no tenant organization, no branch, and no tenant memberships. Their context returns:
    * `organizations: []`
    * `primaryOrganization: null`
    * `branches: []`
    * `primaryBranch: null`
    * `jobRoles: []`
    * `permissions: []` (zero tenant permissions!)
    * `platformPermissions: ["platform:*"]`
    * `contextStatus: "platform"`
    When a Super Admin performs a platform management operation on a specific organization (such as `organizationsDeactivate`), they must pass the target `organizationId` explicitly. Normal operational callables reject execution without an explicit or derived tenant context.

---

## Decision 13: Canonical AuthSessionContext Builder, Clean Response Envelope & Strict Fail-Closed Emulator Login Adapter

- **Date**: 2026-11-05
- **Context**: Authentication responses suffered from duplicate user/profile representations, legacy aliases (`accessToken` alongside `idToken`), browser-exposed refresh tokens, and divergent responses between `authMe` and `authLogin`.
- **Decision**:
  - **Unified Canonical Resolver (`services/sessionContext.ts`)**: `buildAuthSessionContext` is the single source of truth for constructing `AuthSessionContext` across both `authMe` and `authLogin`.
  - **Clean Response Envelopes**:
    * `authMe` returns `{ context: AuthSessionContext, credentials: null }`.
    * `authLogin` returns `{ context: AuthSessionContext, credentials: { idToken, expiresInSeconds } }`.
    * Eliminated duplicate `user`/`profile` copies, eliminated redundant top-level `name`/`email`, eliminated refresh token from browser callable responses, and eliminated the `accessToken` alias.
  - **Fail-Closed Local Emulator Guard for `authLogin`**:
    * Rejects execution immediately with `failed-precondition` unless `FUNCTIONS_EMULATOR === "true"`, `GCLOUD_PROJECT === "trado-x"`, and `FIREBASE_AUTH_EMULATOR_HOST` matches `127.0.0.1:9099` or `localhost:9099`.
    * Never falls back to production `identitytoolkit.googleapis.com`.
  - **Truthful Device Tracking**:
    * `deviceId` is an installation identifier upserted to `users/{uid}/devices/{deviceId}` with `{ deviceId, lastLoginAt, updatedAt }`.
    * FCM token registration remains strictly canonical in `notificationsRegisterFcmToken`.


