# Trado Backend Testing Guide

This guide details how to verify, test, and audit the Trado Firebase backend locally using the Firebase Emulator Suite and automated regression harnesses.

---

## 1. Test Suite Summary Table

The surviving, permanent test suites and verification harnesses:

| Test Suite / Harness | Command | Duration | What It Verifies | Environment |
|---|---|:---:|---|---|
| **TypeScript Compilation & Build** | `npm run build --prefix functions` | ~4s | Full TypeScript strict typing across all 102 exports, types, models, schemas. | Local host |
| **ESLint Code Quality** | `npm run lint --prefix functions` | ~3s | Zero lint warnings, zero unused variables, code style compliance. | Local host |
| **Unit Test Suite** | `npm run test:unit --prefix functions` | ~9s | 26 suites, 95 unit tests: Zod schemas, tax math, WAC costing, money precision, RBAC 4-layer resolver, claims, branch capacity math, usage counters. | Node test runner (offline) |
| **Security Rules Test Suite** | `npm run test:rules --prefix functions` | ~8s | 16 rules tests: Firestore tenant isolation, branch read scoping, client write denials, and Storage rules. | Firestore & Storage Emulators |
| **Callables Integration Suite** | `node functions/scripts/test-callables-integration.js` | ~12s | 38 end-to-end callable tests: tenancy creation, employees, RBAC overrides, products, bills, outflows, payments, stock isolation. | Full Emulator Suite |
| **Branch Deep E2E Suite** | `node functions/scripts/test-branch-deep-e2e.js` | ~15s | 15 multi-branch scenarios: branch provisioning, context switching, stock isolation, shared catalog, zero aggregate leakage, ledger reconciliation. | Full Emulator Suite |
| **Business Flow E2E Suite** | `node functions/scripts/test-e2e-business-flow.js` | ~10s | 10-step full ERP operational lifecycle: catalog -> vendor intake -> sales bill -> payment -> return -> reconciliation. | Full Emulator Suite |
| **Operations & Usage Suite** | `node functions/scripts/test-phase3-integration.js` | ~18s | Complete 6-part integration suite: 7 report callables, tasks, live location, 4 event triggers to notifications, branch capacity limits, and Super Admin usage metering. | Full Emulator Suite |
| **API Drift Checker** | `node scripts/check-api-drift.js` | ~1s | Verifies that all 102 exported functions match the single living API contract in `docs/api-reference.md`. | Static analysis |
| **Anti-Embedding Checker** | `node scripts/check-duplicate-embedding.js` | ~1s | Verifies that all 42 collections and source code strictly follow the reference-by-ID architecture with zero embedded foreign entities. | Static analysis |
| **Schema Uniqueness Checker** | `node scripts/check-schema-duplicates.js` | ~1s | Audits models and schemas for duplicate field definitions and enum conflicts. | Static analysis |

---

## 2. Local Environment Setup

### Prerequisites
- **Node.js**: v22.x or v24.x (Local dev uses v24.16.0; Cloud Functions runtime targets Node.js 22 Gen 2).
- **Firebase CLI**: v13+ (Tested on v15.34.1). Install via `npm install -g firebase-tools`.
- **Java JRE**: Required by Firebase Local Emulator Suite (Java 11 or higher).

### Step-by-Step Local Setup

1. **Clone & Install Dependencies**:
   ```bash
   cd trado-firebase/functions
   npm install
   cd ..
   ```

2. **Verify Environment Builds**:
   ```bash
   npm run build --prefix functions
   npm run lint --prefix functions
   ```

3. **Start the Firebase Emulator Suite**:
   From the repository root:
   ```bash
   firebase emulators:start
   ```
   Default Emulator Ports:
   - **Auth**: `127.0.0.1:9099`
   - **Functions**: `127.0.0.1:5001`
   - **Firestore**: `127.0.0.1:8080`
   - **Storage**: `127.0.0.1:9199`
   - **Emulator UI**: `http://127.0.0.1:4000`

4. **Seed Sample Data (Optional)**:
   In a separate terminal while emulators are running:
   ```bash
   node functions/lib/scripts/seed-emulator.js
   ```

---

## 3. Running Regression Tests

### Quick Local Check (No Emulators Required)
To verify compilation, lint, and all 95 unit tests offline:
```bash
npm run build --prefix functions && npm run lint --prefix functions && npm run test:unit --prefix functions
node scripts/check-api-drift.js
node scripts/check-duplicate-embedding.js
```

### Full Integration Run (Requires Emulator Running)
In a separate terminal while `firebase emulators:start` is running:
```bash
# 1. Security rules tests
npm run test:rules --prefix functions

# 2. End-to-end integration suites
node functions/scripts/test-callables-integration.js
node functions/scripts/test-branch-deep-e2e.js
node functions/scripts/test-e2e-business-flow.js
node functions/scripts/test-phase3-integration.js
```

### Single-Command Emulator Execution
Alternatively, execute tests using `firebase emulators:exec`:
```bash
firebase emulators:exec --only auth,functions,firestore,storage "node functions/scripts/test-callables-integration.js"
```

---

## 4. Endpoints: Local Emulator vs. Cloud Deployment

### How a Callable is Invoked in Local Development vs. Production

#### Local Emulator Mode
- **Host**: `http://127.0.0.1:5001`
- **Calling URL Pattern**: `http://127.0.0.1:5001/trado-x/asia-south1/<functionName>`
- **Example (`billsCreate`)**:
  ```http
  POST http://127.0.0.1:5001/trado-x/asia-south1/billsCreate HTTP/1.1
  Content-Type: application/json
  Authorization: Bearer <emulator-id-token>

  {
    "data": {
      "organizationId": "org_test",
      "branchId": "main-branch",
      "salesMode": "pos",
      "items": [
        {
          "productId": "prod_1",
          "quantity": 2,
          "unitPrice": 100,
          "subtotal": 200,
          "taxAmount": 0,
          "total": 200
        }
      ],
      "totalAmount": 200,
      "paidAmount": 200
    }
  }
  ```
- **Flutter SDK Configuration for Local Development**:
  ```dart
  if (kDebugMode) {
    FirebaseFirestore.instance.useFirestoreEmulator('127.0.0.1', 8080);
    FirebaseAuth.instance.useAuthEmulator('127.0.0.1', 9099);
    FirebaseStorage.instance.useStorageEmulator('127.0.0.1', 9199);
    FirebaseFunctions.instanceFor(region: 'asia-south1').useFunctionsEmulator('127.0.0.1', 5001);
  }
  ```

#### Production Cloud Mode
- **Host**: `https://asia-south1-trado-x.cloudfunctions.net`
- **Calling URL Pattern**: `https://asia-south1-trado-x.cloudfunctions.net/<functionName>`
- **Example (`billsCreate`)**:
  ```http
  POST https://asia-south1-trado-x.cloudfunctions.net/billsCreate HTTP/1.1
  Content-Type: application/json
  Authorization: Bearer <real-google-signed-jwt>

  {
    "data": { ... }
  }
  ```
- **Differences to Expect**:
  - **Cold Starts**: In `asia-south1`, first requests to an idle function instance take ~500ms–1.5s to initialize before running in sub-50ms.
  - **Authentication**: In production, tokens are cryptographically signed by Google RSA keys and expire every 60 minutes (the Firebase SDK auto-refreshes them). In the emulator, tokens are mock JWTs issued locally by port 9099.
  - **App Check**: When App Check enforcement is enabled in production, client requests without a valid `X-Firebase-AppCheck` token from Play Integrity / DeviceCheck are rejected before reaching function execution.

