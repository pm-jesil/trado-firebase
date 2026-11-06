# Trado Production Readiness & Cloud Console Punch List

This document distinguishes what has been implemented and tested at the code/emulator level from the infrastructure prerequisites that must be configured in the Google Cloud / Firebase Web Console prior to serving production tenant traffic.

---

## 1. What is Fully Built & Verified in Code

The backend application code is fully complete and verified across all 105 exports:
- [x] **Strict Tenancy & Role-Based Access Control**: 4-layer dynamic permission engine, custom claims synchronization, cross-tenant isolation.
- [x] **Multi-Branch Location Model**: Option B subcollection architecture, per-branch stock balances, staff assignment join collection, customer/vendor visibility sharing policies.
- [x] **Operational Business Layer**: Product catalog, unified outflows, shared bills engine (invoice, quotation, order lifecycle), stock movements, returns, payments, deliveries.
- [x] **Financial Accuracy**: Weighted-Average Costing (WAC) engine, decimal-safe commercial rounding, multi-jurisdiction tax calculation (India GST, UAE VAT, US Sales Tax).
- [x] **Operations & Intelligence**: 7 report callables with branch-aware CSV exports, task assignment workflows, dual-collection live location tracking, dual-dispatch push notifications (FCM + in-app).
- [x] **Capacity Controls & Safety**: Subscription plan branch limit enforcement (`branchLimit`), transactional capacity guards, non-billing usage metering diagnostic telemetry.
- [x] **Cost Controls in Code**: `maxInstances: 10` configured globally in `functions/src/index.ts` to prevent runaway function auto-scaling costs.
- [x] **Security Rules**: Complete, tested `firestore.rules` and `storage.rules` preventing direct client database writes.

---

## 2. Cloud Console Prerequisites (The Real, Living Punch List)

The following items cannot be provisioned via local code; they require administrative activation in the Firebase and Google Cloud consoles:

### 1. Firebase App Check Enforcement
- **Status**: Documented & Code-Ready. Pending Cloud Activation.
- **Action Required**:
  1. Open Firebase Console -> **App Check**.
  2. Register apps with certified providers:
     - Android: **Play Integrity** (link Google Play SHA-256 fingerprint).
     - iOS: **DeviceCheck** or **App Attest**.
     - Web: **reCAPTCHA Enterprise**.
  3. Set enforcement mode from *Monitoring* to *Enforced* for Cloud Functions and Cloud Storage once client builds are distributed.

### 2. BigQuery Billing & Infrastructure Export
- **Status**: Pending Cloud Activation.
- **Action Required**:
  1. Open Google Cloud Console -> **Billing** -> **Billing export**.
  2. Create a BigQuery dataset `trado_billing_export` in region `asia-south1`.
  3. Enable **Standard usage cost export** and **Detailed usage cost export**.
  4. Enable Cloud Audit Logs sink to BigQuery for tamper-evident compliance audit trail.

### 3. Cloud Monitoring & Automated Budget Alerts
- **Status**: Pending Cloud Activation.
- **Action Required**:
  1. Open Google Cloud Console -> **Billing** -> **Budgets & alerts**.
  2. Configure monthly budget threshold (e.g. ₹5,000 / month) with alerts triggered at 50%, 80%, 100%, and 120%.
  3. Open Cloud Monitoring -> **Alerting**:
     - Alert 1: Cloud Functions Error Rate > 2% over 5-minute rolling window.
     - Alert 2: 95th Percentile Execution Latency > 2,000ms in `asia-south1`.
     - Alert 3: Firestore read operation spike (> 50,000 reads/hour).

### 4. Automated Firestore Backup Schedule
- **Status**: Pending Cloud Activation.
- **Action Required**:
  1. Configure recurring daily backups using Cloud Firestore backup schedules:
     ```bash
     gcloud firestore backups schedules create \
       --database='(default)' \
       --recurrence=daily \
       --retention=30d
     ```
  2. Backups must be retained in an isolated storage bucket for disaster recovery.

### 5. Firestore TTL Policy for Location Pings
- **Status**: Code-Ready (`expiresAt` computed on write). Pending Cloud Activation.
- **Action Required**:
  1. Enable Cloud Firestore Time-to-Live (TTL) on the `locationPings` collection:
     ```bash
     gcloud firestore fields ttls update expiresAt \
       --collection-group=locationPings \
       --enable-ttl
     ```
  2. This guarantees automated, zero-cost background expiration of ephemeral GPS breadcrumbs older than 7 days without consuming Cloud Functions invocation quota. Note: Enabling TTL on `createdAt` would delete documents immediately upon creation; `expiresAt` contains the exact 7-day expiration timestamp (`createdAt + 7 days`). The companion `latestLocations` collection intentionally does NOT use TTL to preserve the last known position.

---

## 3. Pre-Flight Production Deployment Checklist

When the project owner authorizes the first live production deployment:

1. **Verify Target Region & Project**:
   ```bash
   firebase use trado-x
   firebase functions:config:get
   ```
2. **Deploy Firestore Indexes**:
   ```bash
   firebase deploy --only firestore:indexes
   ```
   *Wait for index building to finish in Firebase Console before deploying functions.*
3. **Deploy Security Rules**:
   ```bash
   firebase deploy --only firestore:rules,storage:rules
   ```
4. **Deploy Cloud Functions (Gen 2)**:
   ```bash
   firebase deploy --only functions
   ```
5. **Post-Deployment Verification**:
   - Invoke `healthCheck` callable endpoint via HTTPS.
   - Run initial seed script against production using Super Admin credentials to provision the initial system roles (`role_super_admin`, `role_owner`, `role_admin`, `role_employee`) and standard subscription tiers.

---

## 4. Operational Simulation Sign-Off & Test Oracle Verification

The entire operational business engine was subjected to a comprehensive 26-step two-business simulation (`functions/scripts/run-two-business-simulation.cjs`) executed against the local Firebase Emulator Suite. The simulation evaluated all state transitions against an independent mathematical/financial oracle (`functions/scripts/accounting-oracle.cjs`).

### Simulation Execution Results

| Business Tenant | Plan & Profile | Scenarios Evaluated | Verification Oracle Match |
|---|---|---|---|
| **Apex Corner Retail** (`1IB3CO0VNqZMaPCimqCW`) | Starter Plan (Single-Branch) | Owner onboarding, Admin provisioning, 4-layer RBAC override verification, WAC intake recalculation, Quotation -> Invoice draft finalization, partial payments, damage write-off, over-return rejection & restock, P&L reporting, ledger reconciliation | **100% Exact Match** (0 discrepancies across Revenue, COGS, Gross Profit, Expenses, Net Profit, Stock Valuation, Party Balances) |
| **Apex Wholesale Supplies** (`uf2MneXRc2Nb0mXZzWoJ`) | Growth Plan (Multi-Branch) | Multi-branch provisioning, per-branch staff assignment (`membershipBranches`), branch-scoped stock balance intake, customer visibility scope (`all_branches` vs `branch_only`), context switching & security boundary enforcement, cross-branch sales, aggregated P&L reporting, subscription plan branch limit enforcement (at capacity 3), cross-tenant isolation attack prevention | **100% Exact Match** (All security boundaries held, 0 cross-tenant leaks, quota enforcement blocked 4th branch) |

### Financial & Inventory Oracle Comparison

| Metric | Live System Output | AccountingOracle Expected | Discrepancy |
|---|---|---|---|
| **Purchase 1 WAC** | ₹48.0000 | ₹48.0000 | ₹0.0000 |
| **Purchase 2 WAC** (after intake) | ₹52.0000 | ₹52.0000 | ₹0.0000 |
| **B1 Final Stock** | 139 units | 139 units | 0 units |
| **B1 Revenue** | ₹650.00 | ₹650.00 | ₹0.00 |
| **B1 Cost of Goods Sold (COGS)** | ₹520.00 | ₹520.00 | ₹0.00 |
| **B1 Gross Profit** | ₹130.00 | ₹130.00 | ₹0.00 |
| **B1 Operating Expenses** | ₹1,200.00 | ₹1,200.00 | ₹0.00 |
| **B1 Net Profit / (Loss)** | ₹-1,070.00 | ₹-1,070.00 | ₹0.00 |
| **B1 Stock Valuation** | ₹7,228.00 | ₹7,228.00 | ₹0.00 |
| **Customer Ledger Balance** | ₹185.00 | ₹185.00 | ₹0.00 |
| **Vendor Ledger Balance** | ₹800.00 | ₹800.00 | ₹0.00 |
| **B2 Total Inventory** | 230 bags (80 Main + 150 WH01) | 230 bags | 0 bags |
| **B2 Consolidated Valuation** | ₹329,666.66 | ₹329,666.66 | ₹0.00 |

---

## 5. Environment Readiness: Emulator-Verified vs. Cloud-Only Prerequisites

| Capability / Subsystem | Emulator Verified | Requires Cloud Console Activation | Notes & Configuration Required |
|---|:---:|:---:|---|
| **Tenant & Organization Boundary** | Yes | No | Enforced in code and security rules |
| **Option B Subcollection Branches** | Yes | No | Tested end-to-end (`organizations/{orgId}/branches/{branchId}`) |
| **RBAC (4-layer dynamic matrix)** | Yes | No | Verified with custom claims and Firestore rules |
| **Per-Branch Stock Balances & Movements** | Yes | No | Commits atomically via transactions |
| **Weighted Average Costing (WAC)** | Yes | No | Verified post-commit with previousStock invariant |
| **Quotation & Bill Lifecycle** | Yes | No | Draft isolation and atomic sequential counters |
| **Customer & Vendor Ledgers & Sharing** | Yes | No | `all_branches` vs `branch_only` visibility enforcement |
| **Dual Location Tracking** | Yes | No | `latestLocations` & `locationPings` verified |
| **In-App Notification Dispatch** | Yes | No | Transactional write to `notifications` collection |
| **Branch Limit Quota Enforcement** | Yes | No | Enforced in `branchesCreate` / `branchesUpdate` |
| **Usage Metering Diagnostics** | Yes | No | Internal telemetry statements generated |
| **Firebase App Check Enforcement** | No | **Yes** | Requires Play Integrity / App Attest / reCAPTCHA keys |
| **BigQuery Billing Export & Audit Sinks** | No | **Yes** | Requires Google Cloud Billing export configuration |
| **Automated Firestore Daily Backups** | No | **Yes** | Requires `gcloud firestore backups schedules create` |
| **Firestore Location Pings TTL Policy** | No | **Yes** | Requires `gcloud firestore fields ttls update` |
| **Cloud Monitoring Budget Alerts** | No | **Yes** | Requires GCP Budget & Alerting incident routing |
| **APNs Push Notification Certificates** | No | **Yes** | Requires Apple Developer account `.p8` key in Firebase Console |

---

## 6. Local-Only Developer Tools (Not for Production)

The following tools are **local development aids** that must never be deployed to production:

| Tool | Path | Purpose |
|------|------|---------|
| API Explorer (Swagger UI) | [`tools/api-explorer/server.js`](../tools/api-explorer/server.js) | Browser-based manual API testing via local proxy |
| OpenAPI Spec | [`docs/openapi.json`](openapi.json) | Machine-readable contract (100 callables, 43 example payloads) |
| CLI Workbench | [`functions/scripts/test-api-workbench.js`](../functions/scripts/test-api-workbench.js) | Terminal-based callable testing |
| .http Collection | [`scripts/manual-tests/trado-api.http`](../scripts/manual-tests/trado-api.http) | VS Code REST Client requests |

> [!IMPORTANT]
> The API Explorer binds exclusively to `127.0.0.1`, rejects `--target=live` and any production host environment variables, and contains a visible red "NOT PRODUCTION" banner. It is safe for local use only.

