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
- **Decision**: Usage metering (`usageRecordClientMetric`, `usageCalculateDryRunStatement`) is strictly an internal diagnostic telemetry system for Super Admins to monitor tenant resource consumption.
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
  - **Server-Derived Context (originally `services/tenantContext.ts`, now the single gate `services/contextResolver.ts`)**: For all operational tenant callables (`bills`, `products`, `customers`, `vendors`, `outflows`, `deliveries`, `returns`, `payments`, `stock`), `organizationId` and `branchId` are derived server-side from the verified caller's Firebase Auth token (`request.auth.token.primaryOrganizationId`) or active Firestore `memberships` records.
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



## 2026-11-07 — Master flow, schema & gate audit

Decisions D-01 … D-12 (usage enforcement, starter plan contents, strictness bound, read-metering strategy, expiry/grace, date type, organization field policy, data-scope defaults, approval defaults, variant model, seat definition, purchase cost basis) are recorded with their defaults in [the issue ledger](audit/issue-ledger.md#decisions-defaults-implemented-change-by-configuration). The former `verifyTenantAccess` / `resolveBranchContext` helpers in `services/tenantContext.ts` were removed: every callable now uses the single gate `resolveRequestContext` in `services/contextResolver.ts`.

---

## Decision 14: Organization Structured Contacts, Platform Financials, and Streamlined Entity History

- **Date**: 2026-11-08
- **Context**: Final production readiness audit identified enhancements for organization contact persons, platform-wide financial aggregation, and comprehensive audit history queryability without breaking tenant boundary guarantees.
- **Decision**:
  - **Structured Contacts (`OrganizationContact[]`)**: Added to `OrganizationDoc`, bounded to 20 items (registered in `duplication-allowlist.json` as `DUP-063`). Supported in `organizationsCreate` and `organizationsUpdate`. Enforced invariant: at most one contact may have `isPrimary: true`.
  - **Platform-Wide Financial Aggregation**: `reportsGetPlatformOverview` aggregates revenue, outflows, and net cash flow across active organizations while strictly querying with `where("organizationId", "==", orgId)` per organization, preserving tenant query conformance.
  - **Audit Trail Stream Querying**: `EntityHistorySchema` expands `entityType` enum to cover all 18 business entity types, with optional `entityId` and optional `entityType` allowing callers to query full-stream activity logs for an organization.
  - **Strict Super Admin Platform Boundary**: Platform Super Admin is strictly isolated from executing tenant mutations directly through tenant callables (retaining `SUPER_ADMIN_TENANT_FORBIDDEN` invariant verified across all gated mutations). All tenant mutations must be executed within tenant user context.

## Decision 15 (open, owner decision required): how an image display URL is produced (prompt 65, Y-10)

**Status:** open. Recorded 2026-11-13. Not implemented: it changes the stored `ImageRef` and the image read path.

**What the code does today.** `hydrateImageUrl()` in `functions/src/services/imageEngine.ts` (the single hydration function since `organizations.ts` stopped returning a literal `computed:<path>` string) returns `https://storage.googleapis.com/<bucket>/<path>` in the cloud and an emulator `?alt=media` URL locally. No URL is signed and none carries a token. Nothing was "pre-signed"; the earlier CORS note was wrong.

**Why that is not finished.** A `storage.googleapis.com/<bucket>/<path>` URL is served only if the object is publicly readable (IAM `allUsers: objectViewer`). Public objects are not protected by `storage.rules` (the rules allow reads to authenticated users only), so user photos and organization logos would be readable by anyone who has or guesses the path. Without public IAM, every URL returned today is a 403 in the cloud. The emulator does not show this.

| Option | Lifetime | Who produces it | Cache behaviour | Notes |
|---|---|---|---|---|
| A. Signed read URL (`getSignedUrl`, V4) | at most 7 days; proposal 1 hour | `hydrateImageUrl` per response | URL changes on every read, so client image caches miss unless they key on `image.path` | needs `iam.serviceAccounts.signBlob` on the runtime service account; one signing call per image per response |
| B. Firebase download token (`firebaseStorageDownloadTokens` metadata) | until the token is rotated | token created by `attachUploadedImage`, URL built by `hydrateImageUrl` | stable URL, caches well; revoke by rotating the token | stores `downloadToken` in `ImageRef`; anyone holding the URL can read until rotation |
| C. Public objects | permanent | `hydrateImageUrl` (today's code) | best | no access control; not acceptable for user photos |

**Recommendation:** B for organization logos and product images (stable, cacheable, low cost), A for user and employee photos (personal data). Either way `hydrateImageUrl` stays the only producer.

**CORS:** the Flutter mobile app is not subject to CORS. A web client needs bucket CORS only if it reads image bytes with `fetch`/XHR (an `<img>` tag does not); then allow `GET` and `HEAD` from the web app's origins only. Uploads use the tmp upload session through the Firebase SDK, not a cross-origin PUT. CORS stays on the cloud checklist as "only if a web client fetches image bytes".

## Decision 16: idempotency compares the client's request; a password is never cached

- **Date**: 2026-11-13 (prompt 65, found by the idempotent-replay proof of the round-trip test)
- **Context**: a replay of a create with the same key and the same payload must return the first result. Four defects stopped that:
  - `reserveIdempotency` hashed the *parsed* input. Parsing gives addresses and bank accounts a random `id`, so two identical requests never hashed alike, and every retry of a create with an address was refused as `IDEMPOTENCY_CONFLICT`.
  - `branchesCreate` reserved a key and never finalized it. A retry got "creation in progress" for 30 seconds, and after that created a second branch.
  - `imagesCreateUploadSession` and `tasksCreate` stored the status `"COMPLETED"`, which is not an `IdempotencyStatus`. A replay ran the create again.
  - `organizationsCreate` cached its whole response, including the new Owner's `temporaryPassword`, in `idempotencyRecords` for 24 hours.
- **Decision**:
  - Every `reserveIdempotency` call passes `payload: request.data`, which is what the client sent (`IdempotencyConfig.payload` documents this).
  - Outside a transaction, success is recorded only through `finalizeIdempotencySuccess` (status `succeeded`, plus `updatedAt`). Creates that finalize inside their own transaction keep doing so, with `"succeeded"`.
  - `organizationsCreate` caches its response without `temporaryPassword`. A replay returns the same organization without the password; the client received it with the first response.
- **Client contract**: unchanged. The image family keeps `clientRequestId` as its key name. Renaming it to `idempotencyKey` would change the Flutter contract, which is not needed for correctness.
- **Proof**: `functions/scripts/helpers/persistence-recorder.cjs` replays every create sent with a key and asserts the same result. Null and absent are treated as equal, since the callable protocol sends `undefined` as null. Coverage Engine C-10 counts these replays.

## Decision 17: date fields accept dates only

- **Date**: 2026-11-13 (prompt 65, found by the data checks on generated maximal payloads)
- **Context**: four request fields stored any string. `organizationsCreate` `subscription.startsAt` (documented as an ISO instant), organization `contacts[].createdAt` / `updatedAt`, and outflow / recurring-expense line `expiryDate` accepted text such as `"startsat-pr"`. A recurring expense also accepted an `endOn` before its `startOn`.
- **Decision**: instants are validated with `z.string().trim().datetime({ offset: true })` (the pattern used by `dueAt`); `expiryDate` is `YYYY-MM-DD`; `CreateRecurringExpenseSchema` rejects `endOn < startOn` at `endOn`.
- **Open (owner decision)**: organization contacts accept client-supplied `createdAt`, `updatedAt`, `createdBy` and `updatedBy`. Stamping them on the server would remove them from the request contract, so that change is not made here.

## Decision 18: one request context, one counting layer, one audit recording point (prompt 66)

- **Date**: 2026-11-13. Facts first: [metering-audit-inventory.md](audit/metering-audit-inventory.md) (P-1…P-12, generated) and its design table DD-1…DD-9.
- **Decision**:
  - Every callable imports `onCall` from `functions/src/services/callable.ts`. It removes `_meta` before the handler's schema and opens the request context (AsyncLocalStorage). The gate adds the organization, membership, role and branch it already resolved, with no extra read. Triggers and the sweep open a system context.
  - Every Firestore operation goes through the single `db` of `services/firebase.ts`, a counting proxy (`services/meteredFirestore.ts`). An independent shadow counter (emulator only) checks it on every request.
  - Rollups `organizationUsageDaily` (reused) and `userUsageDaily` (new) hold quantities; cost is derived when read (`services/usageReport.ts`, D-22).
  - `auditLogs` events are written by `services/auditRecorder.ts`, in the same commit as the mutation; the 69 handler audit calls were removed.
- **Deviations from the prompt, with the reason**:
  - `changeHistory` never existed, so there was nothing to merge (D-24 holds already). `auditGetEntityHistory` is kept as a thin call to the same query as `auditLogsList`, because the Flutter app calls it.
  - Before-values come from documents the request already read anywhere in the request, not only in its transaction. Still no extra read.
  - Rollups keep the hour of day as a 24-key map (`hourly."00".."23"`), not an array: Firestore cannot increment array elements.
  - `firstSeenAt` is derived from the hourly map instead of being stored: Firestore has no "minimum" transform without a read.
  - `audit:view` stays the organization read permission; `audit:read_own` was added; `audit:export` was not added, because no audit export callable exists.
  - Reconciliation: the logic is here and tested on fixture export rows: the pure comparison, the BigQuery query template and the `platformCostReconciliation/{yyyyMMdd}` line schema (`services/costReconciliation.ts`). Running it needs the billing export, which is cloud-only (checklist items 1, 16, 17). No script runs it and nothing is scheduled.
- **Owner decisions left open**:
  - a per-instance cache of the gate's membership read (saves reads; delays revocation);
  - `REQUIRE_META` after the app ships `_meta`;
  - `showCostToTenant` per organization;
  - verifying the rate card (0 prices verified);
  - client-supplied audit fields on organization contacts (Decision 17).
