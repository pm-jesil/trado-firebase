# Trado Firebase Backend

## 1. What Trado Is

**Trado** is a cloud-native, multi-tenant SaaS ERP, billing, and inventory management platform designed for wholesale and retail merchants. It features a Flutter-based client application (mobile, desktop, web) backed by a scalable Google Cloud serverless architecture built on Firebase Gen 2 Cloud Functions and Cloud Firestore. The platform organizes business entities through an intuitive **Organization → Branch → Staff** hierarchy: merchants manage one legal corporate account (Organization), operate across one or more physical stores or warehouses (Branches), assign employees to locations with granular 4-layer role-based capabilities, and execute POS sales, procurement, inventory tracking, dispatch deliveries, and real-time analytics with zero data drift.

---

## 2. Architecture at a Glance

For full architectural details, see [Architecture Specification](docs/architecture.md).

- **Authentication & Tenancy**: Firebase Authentication integrated with custom JWT claims (`primaryOrganizationId`, `isSuperAdmin`).
- **Data Partitioning**: Cloud Firestore partitioned at `organizations/{organizationId}`. Physical branch locations are modeled as subcollections: `organizations/{organizationId}/branches/{branchId}`.
- **Serverless API Layer**: 102 second-generation Cloud Functions (98 HTTPS Callables + 4 Firestore Event Triggers) running on Node.js 22 in primary region `asia-south1` (Mumbai).
- **Physical Inventory**: Product catalog definitions are shared tenant-wide, while physical stock balances (`stockBalances`) are strictly isolated per branch.
- **Costing & Precision**: Perpetual Weighted-Average Costing (WAC) with 4-decimal rate calculation and 2-decimal commercial rounding (`Number.EPSILON`).
- **Anti-Embedding Principle**: Strict reference-by-ID architecture. All foreign relationships store bare IDs; embedded entity documents are strictly prohibited.
- **Push Notifications & Event Bus**: Dual-dispatch automation (FCM push notifications + in-app notification inbox) triggered by Firestore document events.

---

## 3. Project Setup

### Prerequisites
- **Node.js**: v22.x or v24.x (Local development runs on v24.16.0; Cloud Functions runtime targets Node.js 22).
- **npm**: v10+ (Tested on v11.13.0).
- **Firebase CLI**: v13+ (Tested on v15.34.1). Install globally via:
  ```bash
  npm install -g firebase-tools
  ```
- **Java JRE**: Required by the Firebase Local Emulator Suite (Java 11 or higher). Verify with `java -version`.

### Clean Checkout Setup Instructions

1. **Clone the repository**:
   ```bash
   git clone <repository-url> trado-firebase
   cd trado-firebase
   ```

2. **Install Cloud Functions dependencies**:
   ```bash
   cd functions
   npm install
   cd ..
   ```

3. **Verify Build & Type Safety**:
   ```bash
   npm run build --prefix functions
   npm run lint --prefix functions
   ```
   *Expected result: Both commands exit with code 0.*

4. **Verify Offline Unit Tests**:
   ```bash
   npm run test:unit --prefix functions
   ```
   *Expected result: 95 tests pass across 26 suites.*

---

## 4. Running Locally (Firebase Emulator Suite)

All day-to-day backend development and testing is performed completely locally using the Firebase Emulator Suite without incurring cloud costs or requiring active cloud credentials.

### Start the Local Emulators
From the project root:
```bash
firebase emulators:start
```

Default Emulator Ports:
- **Authentication**: `127.0.0.1:9099`
- **Cloud Functions**: `127.0.0.1:5001`
- **Cloud Firestore**: `127.0.0.1:8080`
- **Cloud Storage**: `127.0.0.1:9199`
- **Emulator UI (Web Dashboard)**: `http://127.0.0.1:4000`

### Seed Sample Data (Optional)
While the emulator is running, open a second terminal to provision standard roles (`role_owner`, `role_admin`, `role_employee`), subscription plans, and a demo retail organization:
```bash
node functions/lib/scripts/seed-emulator.js
```

### Pointing Flutter Client to the Local Emulator
In your Flutter client's `main.dart` or Firebase initialization service:
```dart
import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_functions/cloud_functions.dart';

void configureFirebaseEmulators() {
  if (kDebugMode) {
    const localhost = '127.0.0.1';
    FirebaseFirestore.instance.useFirestoreEmulator(localhost, 8080);
    FirebaseAuth.instance.useAuthEmulator(localhost, 9099);
    FirebaseStorage.instance.useStorageEmulator(localhost, 9199);
    FirebaseFunctions.instanceFor(region: 'asia-south1').useFunctionsEmulator(localhost, 5001);
  }
}
```

---

## 5. Running Against Real Firebase (Cloud Deployment)

> [!WARNING]
> **Zero Live Production Data**: The cloud project `trado-x` currently contains zero production tenant data. No production deployment is permitted without owner authorization. All writes must target the local emulator suite.

When deployment to cloud infrastructure is authorized:

1. **Select Target Firebase Project**:
   ```bash
   firebase use trado-x
   ```

2. **Deploy Pre-Flight Checklist**:
   Consult [Production Readiness Guide](docs/production-readiness.md) before deployment. Deploy indexes and rules before deploying functions:
   ```bash
   # 1. Deploy Firestore composite indexes
   firebase deploy --only firestore:indexes

   # 2. Deploy Security Rules
   firebase deploy --only firestore:rules,storage:rules

   # 3. Deploy Cloud Functions Gen 2
   firebase deploy --only functions
   ```

---

## 6. Testing Guide

For complete testing details, see [Comprehensive Testing Guide](docs/testing-guide.md).

### Automated Test Matrix

| Suite / Tool | Command | Duration | Scope & Coverage |
|---|---|:---:|---|
| **Unit Tests** | `npm run test:unit --prefix functions` | ~9s | 95 unit tests: Zod schemas, tax math, WAC costing, money precision, 4-layer RBAC, branch capacity math, usage counters. |
| **Security Rules Tests** | `npm run test:rules --prefix functions` | ~8s | 16 rules tests: Multi-tenant read isolation, branch scoping, client write denials, storage bucket rules. |
| **Callable Integration Suite** | `node functions/scripts/test-callables-integration.js` | ~12s | 38 integration tests: Tenants, employees, custom roles, products, bills, outflows, payments, stock isolation. |
| **Branch Deep E2E Suite** | `node functions/scripts/test-branch-deep-e2e.js` | ~15s | 15 scenarios: Branch lifecycle, context switching, physical stock isolation, party sharing policies. |
| **Business Flow E2E Suite** | `node functions/scripts/test-e2e-business-flow.js` | ~10s | 10-step full ERP cycle: Intake -> bill -> payment -> return -> full ledger reconciliation. |
| **Operations & Usage Suite** | `node functions/scripts/test-phase3-integration.js` | ~18s | 6 parts: 7 report callables, tasks, live location, 4 event triggers to notifications, branch quotas, usage metering. |
| **API Drift Checker** | `node scripts/check-api-drift.js` | ~1s | Verifies all 102 exports are documented in `docs/api-reference.md`. |
| **Anti-Embedding Checker** | `node scripts/check-duplicate-embedding.js` | ~1s | Verifies AST/models of all 42 collections and codebase for zero forbidden foreign embeds. |
| **Schema Uniqueness Checker** | `node scripts/check-schema-duplicates.js` | ~1s | Audits models and schemas for duplicate field definitions or enum collisions. |

### Recommended CI/CD Pipeline Command
Every pull request or commit should run the following offline checks:
```bash
npm run build --prefix functions && npm run lint --prefix functions && npm run test:unit --prefix functions
node scripts/check-api-drift.js
node scripts/check-duplicate-embedding.js
node scripts/check-schema-duplicates.js
```

---

## 7. API Reference

The Trado backend exports **102 serverless functions** (98 HTTPS Callables + 4 Firestore Triggers). All parameters, authorization requirements, schemas, and return formats are documented in the centralized:

📖 **[Trado API Reference](docs/api-reference.md)**

---

## 8. Endpoints: Local Emulator vs. Cloud Deployment

Cloud Functions Gen 2 callable endpoints differ between local development and cloud production:

| Aspect | Local Emulator (`127.0.0.1`) | Cloud Production (`asia-south1`) |
|---|---|---|
| **Base URL** | `http://127.0.0.1:5001/trado-x/asia-south1` | `https://asia-south1-trado-x.cloudfunctions.net` |
| **Auth Tokens** | Locally generated mock JWTs via port `9099`. | Cryptographically signed Google RSA tokens verified against Firebase Auth public keys. |
| **Cold Starts** | Zero cold starts. Functions run directly in local Node process. | Idle instances experience ~500ms–1.5s cold starts in `asia-south1` on first invocation. |
| **App Check** | Optional / disabled in local emulator. | Valid `X-Firebase-AppCheck` token enforced at gateway before function execution. |
| **Inspection UI** | Real-time visual log and data viewer at `http://127.0.0.1:4000`. | Google Cloud Logging (`asia-south1`) and Firebase Console. |

### Concrete Endpoint Example: `billsCreate`

#### Calling via Local Emulator
```http
POST http://127.0.0.1:5001/trado-x/asia-south1/billsCreate HTTP/1.1
Content-Type: application/json
Authorization: Bearer <local-emulator-jwt>

{
  "data": {
    "organizationId": "org-retail-sample",
    "branchId": "main-branch",
    "salesMode": "pos",
    "items": [
      {
        "productId": "prod_sample_rice",
        "quantity": 2,
        "unitPrice": 500,
        "subtotal": 1000,
        "taxAmount": 0,
        "total": 1000
      }
    ],
    "totalAmount": 1000,
    "paidAmount": 1000
  }
}
```

#### Calling via Cloud Production
```http
POST https://asia-south1-trado-x.cloudfunctions.net/billsCreate HTTP/1.1
Content-Type: application/json
Authorization: Bearer <google-signed-firebase-id-token>
X-Firebase-AppCheck: <app-check-token>

{
  "data": {
    "organizationId": "org-production-merchant",
    "branchId": "main-branch",
    "salesMode": "pos",
    "items": [
      {
        "productId": "prod_real_123",
        "quantity": 2,
        "unitPrice": 500,
        "subtotal": 1000,
        "taxAmount": 0,
        "total": 1000
      }
    ],
    "totalAmount": 1000,
    "paidAmount": 1000
  }
}
```

---

## 9. Project Status & Outstanding Punch List

### Completed & Fully Verified
- 102/102 Cloud Function exports implemented, typed, and documented with zero drift.
- Full multi-branch architecture (Option B) with isolated branch physical stock balances and staff join collection.
- Perpetual Weighted-Average Costing (WAC) and decimal-safe financial calculations.
- Comprehensive local test coverage: 95 unit tests, 16 rules tests, 4 end-to-end integration suites.
- Consolidated permanent documentation set in `docs/` (7 core documents).

### Open Cloud Setup Punch List
The following operational items must be configured in Google Cloud Console prior to public production traffic:
1. **App Check Enforcement**: Configure Play Integrity / DeviceCheck / reCAPTCHA Enterprise certified providers.
2. **BigQuery Billing Export**: Configure daily standard and detailed billing export to BigQuery.
3. **Cloud Monitoring Alerts**: Configure error rate alerts (>2%) and latency thresholds (>2s).
4. **Firestore Automated Backup Schedule**: Activate 30-day recurring backup policy via Cloud Firestore.
5. **Location Pings TTL**: Enable 7-day TTL expiration policy on `locationPings.createdAt`.

For the complete punch list, see [Production Readiness Guide](docs/production-readiness.md).

