# Trado Production Readiness & Cloud Console Punch List

This document distinguishes what has been implemented and tested at the code/emulator level from the infrastructure prerequisites that must be configured in the Google Cloud / Firebase Web Console prior to serving production tenant traffic.

---

## 1. What is Fully Built & Verified in Code

The backend application code is fully complete and verified across all 102 exports:
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
- **Status**: Pending Cloud Activation.
- **Action Required**:
  1. Enable Cloud Firestore Time-to-Live (TTL) on the `locationPings` collection:
     ```bash
     gcloud firestore fields ttls update createdAt \
       --collection-group=locationPings \
       --enable-ttl
     ```
  2. This guarantees automated, zero-cost background expiration of ephemeral GPS breadcrumbs older than 7 days without consuming Cloud Functions invocation quota.

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

