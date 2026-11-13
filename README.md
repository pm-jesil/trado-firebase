# Trado Firebase Backend

## 1. Overview & System Mission

**Trado** is a multi-tenant SaaS ERP, Point of Sale (POS), and inventory management platform designed for wholesale and retail merchants. It features a Flutter-based client application (mobile, desktop, web) backed by a Google Cloud serverless architecture built on Firebase Gen 2 Cloud Functions and Cloud Firestore.

The platform organizes business entities through an **Organization → Branch → Staff** hierarchy:
- **Organizations**: Legal corporate entities that own business configuration, subscriptions, customer/vendor relationships, and product catalogs.
- **Branches**: Physical storefronts, fulfillment centers, or warehouses modeled as subcollections under the organization. Physical inventory (`stockBalances`) is tracked and maintained per branch.
- **Staff**: Employees assigned to one or more branches via `membershipBranches` with granular capabilities enforced by an evaluate-in-order 4-layer Role-Based Access Control (RBAC) resolver.

All business operations—sales, purchases, expenses, stock adjustments, dispatches, payments, tasks, and analytics—run through transactional Cloud Functions callables designed for zero data drift and strict multi-tenant isolation.

---

## 2. Architecture Specification

For exhaustive system diagrams and deep architectural foundations, refer to:
- 🏗️ **[Architecture Specification](docs/architecture.md)**
- 📊 **[Data Model & Collection Reference](docs/data-model.md)**
- 🛡️ **[Privilege Matrix & 4-Layer RBAC](docs/permissions-and-roles.md)**
- 📘 **[Production Readiness & Release Gates](docs/production-readiness.md)**
- 📑 **[Authoritative Callable & Trigger Inventory](docs/audit/callable-and-trigger-inventory.md)**
- 📋 **[Master Issue & Findings Ledger](docs/audit/issue-ledger.md)**
- 🔑 **[Local Testing Personas & Credentials Directory](docs/testing-personas-and-credentials.md)**

### Core Architectural Invariants

1. **Authentication & Token Context**:
   - Firebase Authentication integrated with custom JWT claims: `primaryOrganizationId` (tenant anchor) and `isSuperAdmin` (platform administrator).
   - Dynamic branch context switching via `branchContextSwitch` callable, updating the user's active branch without token re-issuance.
   - **Organization switching is intentionally deferred**: Multi-tenant context is deterministic. When a user belongs to multiple organizations without an unambiguous primary membership, the session resolver returns `contextStatus: "organization_selection_required"` with `permissions: []` and `role: null`. Tenant operations are safely denied until an organization selection workflow is supported. Never guess or merge permissions across tenants.

2. **Branch Hierarchy (Option B Subcollections)**:
   - Branch documents reside at: `organizations/{organizationId}/branches/{branchId}`.
   - Staff assignment to branches is modeled via the top-level join collection: `membershipBranches` (`{userId}_{orgId}_{branchId}`).
   - Subscription plans define hard branch capacity quotas (`branchLimit`) enforced during `branchesCreate` and branch activation.

3. **Per-Branch Stock & Perpetual Costing**:
   - Product definitions (`products`) are catalog-wide across the organization.
   - Physical inventory (`stockBalances`) is strictly isolated per branch: `{organizationId}_{branchId}_{productId}`.
   - Inventory movements use Perpetual Weighted-Average Costing (WAC) with 4-decimal calculation precision and decimal-safe monetary rounding.

4. **Anti-Embedding Principle**:
   - Strict reference-by-ID architecture across all 46 collections. Foreign records store bare entity IDs (e.g. `billId`, `partyId`, `productId`).
   - Deep nested documents and arbitrary JSON blobs are forbidden.

5. **Write Boundary & Exactly-Once Semantics**:
   - Direct client SDK writes are rejected by Firestore Security Rules across all 46 collections (`writesDenied()`).
   - Transactional business state (stock adjustments, customer/vendor balances, counter allocations) is modified exclusively via synchronous Cloud Functions HTTPS callables running in atomic transactions.
   - Background Firestore triggers (`onBillWritten`, `onOutflowWritten`, `onPaymentWritten`, `onDeliveryWritten`) provide telemetry, summary rollups, and push notifications without mutating core financial state.

---

## 3. Project Structure

```
trado-firebase/
├── firestore.rules               # Security rules covering 45 root collections + 1 subcollection (46 total)
├── storage.rules                 # Cloud Storage bucket access rules
├── firestore.indexes.json        # Composite indexes for multi-tenant and branch queries
├── firebase.json                 # Emulator configuration, port allocations, and runtime targets
├── docs/                         # Canonical project documentation
│   ├── api-reference.md          # Complete contract for all 121 Cloud Function exports
│   ├── architecture.md           # Deep architectural specification
│   ├── data-model.md             # Concrete schema reference for all 44 collections
│   ├── permissions-and-roles.md  # 4-layer permission hierarchy and role definitions
│   ├── production-readiness.md   # Cloud deployment pre-flight verification checklist
│   ├── testing-guide.md          # Testing guide and automation architecture
│   └── features/                 # 16 deep feature-by-feature implementation guides
├── scripts/                      # Static codebase integrity and test checkers
│   ├── check-api-drift.js        # Verifies export documentation parity
│   ├── check-duplicate-embedding.js # Audits AST and schemas against anti-embedding rules
│   ├── check-schema-duplicates.js  # Verifies schema definitions and enum integrity
│   ├── check-test-completeness.js  # Static AST test coverage audit (121 exports & 46 collections)
│   └── check-markdown-links.js   # Verifies markdown link integrity across all documentation files
└── functions/                    # Cloud Functions for Firebase codebase (Node.js 22, TypeScript)
    ├── package.json              # Canonical dependencies, build, and test scripts
    ├── tsconfig.json             # TypeScript compiler configuration
    ├── src/
    │   ├── index.ts              # Canonical barrel exporting all 121 Cloud Functions
    │   ├── callables/            # 111 HTTPS callable implementations across 7 modular domains
    │   ├── triggers/             # 4 Firestore background event triggers
    │   ├── shared/               # RBAC engine, schemas, costing utility, context resolver
    │   └── test/
    │       ├── unit/             # 127 unit tests across 36 describe suites
    │       └── rules/            # 18 security rules tests (12 Firestore + 6 Storage)
    └── scripts/                  # Modular integration suites, E2E runners, and simulation
        ├── test-tenancy-auth-callables.cjs     # 25 tenancy & staff auth callables
        ├── test-branch-lifecycle-callables.cjs # 7 multi-branch lifecycle callables
        ├── test-catalog-inventory-callables.cjs # 13 catalog & stock callables
        ├── test-parties-ledgers-callables.cjs  # 11 customer, vendor & payment callables
        ├── test-billing-procurement-callables.cjs # 9 billing, outflow & return callables
        ├── test-operations-tasks-callables.cjs # 16 task, delivery & location callables
        ├── test-analytics-platform-callables.cjs # 20 report, plan & usage metering callables
        ├── test-event-triggers.cjs             # 4 Firestore background event triggers
        ├── test-retail-lifecycle.e2e.js        # 10-step full ERP commerce lifecycle
        ├── test-multibranch-isolation.e2e.js   # 15-scenario branch isolation E2E suite
        ├── run-two-business-simulation.cjs     # Dual-business simulation with Accounting Oracle
        └── seed-emulator.ts                    # Safe emulator seed script (protected against production)
```

---

## 4. Local Emulator Setup & Quickstart

All development, debugging, and testing is designed to run completely inside the local **Firebase Emulator Suite** without incurring cloud infrastructure costs or requiring live Google Cloud access.

### Prerequisites

- **Node.js**: v22.x or v24.x (Local development verified on `v24.16.0`; Cloud Functions runtime targets Node.js 22).
- **npm**: v10+ (Verified on `v11.13.0`).
- **Firebase CLI**: v13+ (Verified on `v15.34.1`). Install globally via:
  ```bash
  npm install -g firebase-tools
  ```
- **Java JRE**: Required by Firestore and Storage emulators (Java 11 or higher). Verify with `java -version`.

### Quickstart (Windows PowerShell)

1. **Clone the repository**:
   ```powershell
   git clone <repository-url> trado-firebase
   cd trado-firebase
   ```

2. **Install Cloud Functions dependencies**:
   ```powershell
   cd functions
   npm install
   cd ..
   ```

3. **Compile TypeScript**:
   ```powershell
   npm run build --prefix functions
   ```

4. **Start Firebase Emulator Suite**:
   On Windows, set the functions discovery timeout to accommodate cold startup of all 140 exports (134 callables + 6 triggers):
   ```powershell
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
   firebase emulators:start --project trado-x
   ```

### 4.1 End-to-End Local Startup & API Explorer Quickstart

For the fastest local onboarding experience (compile, run emulators, seed demo personas, generate OpenAPI spec, and explore all 134 callables in Swagger UI):

```powershell
# 1. Compile backend functions
npm --prefix functions run build

# 2. Start Firebase Emulators (Terminal 1)
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x

# 3. Seed demo organizations & personas (Terminal 2)
node functions/lib/scripts/seed-emulator.js --profile api-explorer-demo

# 4. Generate OpenAPI specification (Terminal 2)
node scripts/generate-openapi.js

# 5. Launch Local API Explorer (Terminal 2)
node tools/api-explorer/server.js
# → Open browser to http://127.0.0.1:3939
```

### Configured Emulator Ports

| Service | Host | Port | Purpose |
|---|---|:---:|---|
| **Firebase Auth** | `127.0.0.1` | `9099` | Local mock JWT generation & token claims |
| **Cloud Functions** | `127.0.0.1` | `5001` | HTTPS Callable invocations & HTTP triggers |
| **Cloud Firestore** | `127.0.0.1` | `8080` | Document database & Security Rules evaluation |
| **Cloud Storage** | `127.0.0.1` | `9199` | File upload/download & Storage rules evaluation |
| **Emulator UI** | `127.0.0.1` | `4000` | Real-time web visual inspection interface |

### Seed Local Emulator Data

To provision standard roles, plans, demo organizations, and sample catalog products:
```powershell
# From project root:
node functions/lib/scripts/seed-emulator.js
```
*(The seed utility contains automated environment guards and will refuse to execute against any live cloud project).*

### Connecting the Flutter Client

To point your Flutter application to the local emulators during development:
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

## 5. Test Suite & Verification Matrix

Trado includes a layered test architecture providing coverage across unit logic, security rules, individual callables, triggers, end-to-end flows, and GAAP accounting calculations.

### Test Command Hierarchy

Run commands from the project root or functions folder:

| Test Layer | Canonical Command | Duration | Scope & Verification Coverage |
|---|---|:---:|---|
| **Unit Tests** | `npm run test:unit --prefix functions` | ~25s | **127 unit tests** across 36 suites: Zod validation, tax formulas, WAC costing, decimal rounding, 4-layer RBAC, branch quota math, idempotency leases, usage meters, native Firestore Timestamp TTL, auth revocation, Super Admin platform isolation. |
| **Rules Tests** | `npm run test:rules --prefix functions` | ~8s | **18 security rules tests** (12 Firestore + 6 Storage): Multi-tenant read isolation, branch scoping, direct client write denials across all 44 collections, avatar/logo upload rules. |
| **Callable Contracts** | `npm run test:callables --prefix functions` | ~90s | **111 HTTPS callables** verified across 8 suites (incl. table-driven gate conformance) with persona authentication, positive CRUD, unauthorized callers, and schema validations. |
| **Event Triggers** | `npm run test:triggers --prefix functions` | ~20s | **4 Firestore triggers** (`onBillWritten`, `onOutflowWritten`, `onPaymentWritten`, `onDeliveryWritten`) verified with real emulator writes, WAC updates, daily summary rollups, and in-app notifications. |
| **E2E Business Flows** | `npm run test:e2e --prefix functions` | ~25s | **25 E2E business scenarios**: 10-step full ERP retail cycle (quotation → invoice → partial payment → sales return → ledger sync) + 15-scenario multi-branch isolation suite. |
| **Simulation & Oracle** | `npm run test:simulation --prefix functions` | ~12s | **Dual-business simulation** (Single-branch retail + Multi-branch wholesale) with 100% mathematical parity against an independent GAAP Accounting Oracle. |
| **Static Completeness** | `npm run test:static --prefix functions` | ~5s | **5 static checkers**: Anti-embedding AST verification, schema duplicate audit, API documentation drift checker (105/105), static test completeness checker (116 exports & 46 collections), and markdown link integrity checker (132 doc files). |
| **All Tests Pipeline** | `npm run test:all --prefix functions` | ~3m | Executes the complete verification pipeline (`unit` → `rules` → `callables` → `triggers` → `e2e` → `simulation` → `static`). |

---

## 6. Calling Endpoints: Local vs. Cloud

Cloud Functions Gen 2 HTTPS callable endpoints follow standard protocols:

| Aspect | Local Emulator (`127.0.0.1`) | Cloud Production (`asia-south1`) |
|---|---|---|
| **Base URL** | `http://127.0.0.1:5001/trado-x/asia-south1` | `https://asia-south1-trado-x.cloudfunctions.net` |
| **Authentication** | Locally minted mock JWTs via port `9099`. | Cryptographically signed Google Firebase ID tokens. |
| **App Check** | Disabled or set to mock token. | Enforced at gateway (`X-Firebase-AppCheck`) before execution. |
| **Network Security** | Loopback binding only (`127.0.0.1`). | Public HTTPS endpoints secured with Google IAM and TLS 1.3. |

### Callable HTTP Invocations (curl / HTTP Client)

All HTTPS Callables accept a JSON payload in the format `{"data": { ... }}` and return `{"result": { ... }}`.

#### Example: `billsCreate` (POS Sale)

```http
POST http://127.0.0.1:5001/trado-x/asia-south1/billsCreate HTTP/1.1
Content-Type: application/json
Authorization: Bearer <local-or-firebase-jwt>

{
  "data": {
    "organizationId": "org-retail-sample",
    "branchId": "main-branch",
    "salesMode": "pos",
    "paymentMethod": "cash",
    "items": [
      {
        "productId": "prod_mango_smoothie",
        "quantity": 2,
        "unitPrice": 500,
        "taxRate": 18,
        "subtotal": 1000,
        "taxAmount": 180,
        "total": 1180
      }
    ],
    "subtotalAmount": 1000,
    "taxAmount": 180,
    "totalAmount": 1180,
    "paidAmount": 1180
  }
}
```

---

## 6. Local API Explorer & Manual Testing Suite

Trado includes a modern, browser-based, Swagger-style **API Explorer** (`http://127.0.0.1:3939`) providing interactive discovery, schema validation, one-click persona authentication, and live request execution against the local Firebase Emulator Suite.

### 6.1 Quickstart Walkthrough (PowerShell)

```powershell
# 1. Compile backend functions
npm --prefix functions run build

# 2. Start Firebase Emulators (Terminal 1)
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x

# 3. Seed demo organizations & personas (Terminal 2)
node functions/lib/scripts/seed-emulator.js --profile api-explorer-demo

# 4. Generate OpenAPI specification (Terminal 2)
node scripts/generate-openapi.js

# 5. Launch Local API Explorer (Terminal 2)
node tools/api-explorer/server.js
# → Open browser to http://127.0.0.1:3939
```

### 6.2 Configured Local Ports

| Service | Host | Port | Purpose |
|---|---|:---:|---|
| **API Explorer** | `127.0.0.1` | `3939` | Swagger UI, local proxy, and one-click auth |
| **Firebase Auth** | `127.0.0.1` | `9099` | Local mock JWT generation & persona accounts |
| **Cloud Functions** | `127.0.0.1` | `5001` | HTTPS Callable invocations & event triggers |
| **Cloud Firestore** | `127.0.0.1` | `8080` | Multi-tenant document database |
| **Cloud Storage** | `127.0.0.1` | `9199` | File upload/download & bucket storage |
| **Emulator UI** | `127.0.0.1` | `4000` | Real-time visual Firebase Emulator inspection |

### 6.3 Demo Persona Credentials Quick Reference

All personas share the default local password: **`TestPassword123!`**. Demo credentials are automatically saved to `.local/api-explorer-credentials.json` upon seeding. For the exhaustive list including negative testing accounts, see **[Local Testing Personas & Credentials Directory](docs/testing-personas-and-credentials.md)**.

| Persona | Email | Organization Context | Branch Scope | Primary Role |
|---|---|---|---|---|
| **Platform Super Admin** | `superadmin@trado.local` | Platform (`None`) | All | Full system & usage controls |
| **Apex Retail Owner** | `owner@apexwholesale.local` | `org_apex_sample` (Starter Plan) | `main-branch` | Tenant configuration & P&L |
| **Apex Retail Admin** | `admin@apexwholesale.local` | `org_apex_sample` | `main-branch` | Catalog & procurement |
| **Apex Retail Cashier** | `cashier@apexwholesale.local` | `org_apex_sample` | `main-branch` | POS sales & invoices |
| **Wholesale Owner** | `owner@wholesale.trado.local` | `org_wholesale_sample` (Growth Plan)| Both (`MAIN`, `WH01`)| Multi-branch management |
| **Wholesale Manager** | `manager@wholesale.trado.local`| `org_wholesale_sample` | Both (`MAIN`, `WH01`)| Cross-branch operations |
| **Wholesale Cashier** | `cashier@wholesale.trado.local`| `org_wholesale_sample` | Main Only (`MAIN`)| Branch-locked invoicing |

### 6.4 Unified Authentication & Session Architecture

Trado provides a clean, unified authentication architecture with two entry points sharing the exact same canonical `AuthSessionContext` resolver:

1. **Normal Application Login (`authMe` with Firebase Auth SDK)**:
   - In Flutter Web, Flutter Mobile, and production web apps, the client uses the native Firebase Auth SDK for email/password sign-in (`signInWithEmailAndPassword`).
   - Immediately following sign-in or session restoration, the client calls `authMe` with its local installation `deviceId`. The callable SDK automatically attaches the verified caller's Firebase ID token.
   - `authMe` returns `{ context: AuthSessionContext, credentials: null }`.

2. **Developer / Manual Testing Login (`authLogin` Emulator Adapter)**:
   - For Swagger UI (`http://127.0.0.1:3939`), REST Client, curl, and automated test runners that cannot embed the Firebase Auth client SDK.
   - Strictly fails closed outside the local emulator (`FUNCTIONS_EMULATOR === "true"`, `GCLOUD_PROJECT === "trado-x"`, loopback port).
   - Authenticates against the local Auth Emulator REST API and returns `{ context: AuthSessionContext, credentials: { idToken, expiresInSeconds } }`.

- **Canonical `AuthSessionContext` Structure**:
  * `user`: `{ uid, email, name, phone, avatarUrl, accountType, isActive, isSuperAdmin }`
  * `role`: `{ scope, roleId, roleName, roleCode } | null`
  * `jobRoles`: `Array<{ jobRoleId, name, code }>`
  * `permissions`: Granular 4-layer resolved tenant permissions array (`string[]`; strictly empty for Super Admin)
  * `platformPermissions`: Platform capability codes (`string[]`; e.g. `["platform:*"]` for Super Admin, empty for tenant users)
  * `organizations`: `Array<{ organizationId, name, roleId, roleName, isPrimary }>`
  * `primaryOrganization`: `{ organizationId, name } | null`
  * `branches`: `Array<{ branchId, name, code, isDefault }>`
  * `primaryBranch`: `{ branchId, name, code } | null`
  * `device`: `{ deviceId, recognized } | null`
  * `contextStatus`: `"ready" | "platform" | "organization_selection_required" | "branch_selection_required" | "no_active_membership"`

- **Super Admin Platform Isolation Invariant**: Super Admin operates exclusively at platform scope with zero tenant memberships (`isSuperAdmin: true`, `organizations: []`, `primaryOrganization: null`, `branches: []`, `primaryBranch: null`, `role: { scope: "platform", roleId: null, roleName: "Platform Super Admin", roleCode: "super_admin" }`, `jobRoles: []`, `permissions: []`, `platformPermissions: ["platform:*"]`, `contextStatus: "platform"`). Super Admin never leaks tenant permissions into tenant operations.

### 6.5 Manual Testing Tools Comparison

| Feature | API Explorer (Swagger UI) | .http Collection | CLI Test Workbench | Automated Test Suite |
|---|:---:|:---:|:---:|:---:|
| **Interface** | Browser UI (`:3939`) | VS Code REST Client | Terminal CLI | Node Test Runner |
| **Best For** | Interactive discovery & testing | In-editor request scratchpad | Automated CLI batch sweeps | CI/CD & full regression |
| **1-Click Persona Auth** | ✅ Pre-configured buttons | ❌ Manual token copy | ✅ Automated in script | ✅ Automated fixtures |
| **Typed Schemas & Forms**| ✅ 100% Zod → JSON Schema | ❌ Static JSON text | ❌ Manual code payloads | ✅ TypeScript assert |
| **Confirmation Safety Guard**| ✅ UI prompt + header check | ❌ Manual header | ❌ Direct invocation | ✅ Dedicated test guards |
| **Target Endpoints** | 134 Callables (+ 6 triggers info) | 134 Callables | Selected callable workflows | All 140 exports |

### 6.6 Explorer Package Scripts

| Task | Command |
|---|---|
| **Generate OpenAPI Spec** | `npm --prefix functions run api:openapi:generate` |
| **Verify OpenAPI Drift** | `npm --prefix functions run api:openapi:check` |
| **Launch Explorer** | `npm --prefix functions run api:explorer` |
| **Run Explorer Safety Tests** | `npm --prefix functions run test:api-explorer` |
| **Run Runtime Acceptance** | `npm --prefix functions run test:api-explorer:acceptance` |

### 6.7 Integration Documentation Links

- 📱 **[Flutter Web Client Integration Guide](docs/flutter-client-integration.md)**: Dedicated integration guide for Flutter Web developers covering setup, session bootstrap, typed callables, and DTO generation.
- 📖 **[Manual API Testing Guide](docs/manual-api-testing-guide.md)**: Step-by-step beginner guide to Swagger UI navigation, read/write testing, and error handling.
- 🌱 **[Local Development Seed Guide](docs/local-development-seed-guide.md)**: Complete guide to seed profiles, deterministic test fixtures, and safety guards.
- 📜 **[API Reference Contract](docs/api-reference.md)**: Canonical reference documentation for all 105 exported Cloud Functions.

---

## 7. Feature Documentation Index

For in-depth domain specifications, business rules, and step-by-step developer walkthroughs, consult the dedicated feature guides:

1. 🏢 [Organizations, Subscriptions & Branches](docs/features/organizations-subscriptions-and-branches.md)
2. 👥 [Users, Memberships & Permissions (4-Layer RBAC)](docs/features/users-memberships-and-permissions.md)
3. 🏷️ [Products, Categories, Units & Barcodes](docs/features/products-categories-units-and-barcodes.md)
4. 📦 [Inventory, Stock & Costing Engine](docs/features/inventory-stock-and-costing.md)
5. 🤝 [Customers & Vendors (Parties & Sharing Policies)](docs/features/customers-and-vendors.md)
6. 🧾 [Sales, Billing & Quotations Engine](docs/features/sales-billing-and-quotations.md)
7. 💸 [Purchases & Expenses (Unified Outflows)](docs/features/purchases-and-expenses.md)
8. 💳 [Payments & Party Ledgers](docs/features/payments-and-party-ledgers.md)
9. 🔄 [Returns, Waste & Stock Adjustments](docs/features/returns-waste-and-stock-adjustments.md)
10. 🚚 [Deliveries & Dispatch](docs/features/deliveries.md)
11. 📈 [Reports & Analytics Engine](docs/features/reports-and-analytics.md)
12. 📋 [Tasks & Employee Operations](docs/features/tasks-and-employee-operations.md)
13. 📍 [Employee Live Location & Privacy](docs/features/employee-location-and-privacy.md)
14. 🔔 [Notifications & Event Triggers](docs/features/notifications.md)
15. 📊 [Platform Usage Metering & Cost Estimates](docs/features/platform-usage-and-cost-estimates.md)
16. ⚡ [Offline-Sync Contract & Resilience](docs/features/offline-sync.md)

---

## 8. Production Readiness & Release Gates

> [!WARNING]
> **Safety Boundary**: The live Google Cloud project `trado-x` has zero tenant data. All backend development and integration tests target the local Firebase Emulator Suite. Direct deployment without owner authorization is prohibited.

Before deploying to live Google Cloud infrastructure, the following release gates must be fulfilled (see [Production Readiness Guide](docs/production-readiness.md) for full runbook):

1. **Composite Indexes**: Deploy composite index definitions:
   ```bash
   firebase deploy --only firestore:indexes
   ```
2. **Security Rules**: Deploy Firestore and Storage security rules:
   ```bash
   firebase deploy --only firestore:rules,storage:rules
   ```
3. **Cloud Functions**: Deploy Gen 2 serverless functions to `asia-south1`:
   ```bash
   firebase deploy --only functions
   ```
4. **App Check Enforcement**: Configure certified attestation providers (Play Integrity for Android, DeviceCheck for iOS, reCAPTCHA Enterprise for Web).
5. **BigQuery Billing Export**: Activate detailed daily billing export in Google Cloud Console.
6. **Automated Firestore Backups**: Configure 30-day recurring backup policy via Google Cloud Firestore.
7. **TTL Policies**: Configure 7-day TTL expiration on `locationPings.createdAt`.
