# Trado Backend Testing Guide

This guide details how to verify, test, and audit the Trado Firebase backend locally using the Firebase Emulator Suite, semantic domain-driven integration suites, and automated completeness checkers.

---

## 1. Test Architecture Overview

Trado adopts a modular, layered test architecture designed for deterministic execution against the local Firebase Emulator Suite with strict anti-cloud safeguards:

```
functions/scripts/
├── helpers/
│   ├── emulator-helper.cjs     # Loopback safety guard (127.0.0.1) & Firestore Admin db instance
│   ├── callable-client.cjs     # Token exchange & type-safe HTTP callable client with error asserting
│   ├── auth-personas.cjs       # Deterministic persona provisioner (Super Admin, Owner, Employees)
│   └── domain-builders.cjs     # Typed test fixtures & payload builders (Products, Vendors, Customers)
├── test-tenancy-auth-callables.cjs     # 24 Callables: Tenancy, Memberships, Roles, Departments, Teams
├── test-branch-lifecycle-callables.cjs # 7 Callables: Branch CRUD, Context Switch, Sharing Policies
├── test-catalog-inventory-callables.cjs# 13 Callables: Products, Categories, Units, Stock Movements, Reconcile
├── test-parties-ledgers-callables.cjs  # 11 Callables: Customers, Vendors, Payments, Party Ledger Reconcile
├── test-billing-procurement-callables.cjs # 9 Callables: Outflows, Bills, Finalize, Returns
├── test-operations-tasks-callables.cjs # 16 Callables: Tasks, Live Locations, Notifications, Deliveries
├── test-analytics-platform-callables.cjs # 18 Callables: Reports, Usage Metering, Rate Cards, Branch Counts
├── test-event-triggers.cjs             # 4 Triggers: onBillWritten, onOutflowWritten, onPaymentWritten, onDeliveryWritten
├── test-retail-lifecycle.e2e.js        # 10-Step Connected ERP Retail Lifecycle E2E
└── test-multibranch-isolation.e2e.js   # 15-Scenario Branch Topology & Isolation Deep E2E
```

---

## 2. Test Suite Inventory

| Test Suite / Harness | Command | Duration | What It Verifies | Environment |
|---|---|:---:|---|---|
| **TypeScript Compilation & Build** | `npm run build --prefix functions` | ~4s | Full TypeScript strict typing across all 105 exports, types, models, schemas. | Local host |
| **Unit Test Suite** | `npm run test:unit --prefix functions` | ~9s | 26 suites, 99 unit tests: Schemas, tax math, WAC costing, money precision, RBAC 4-layer resolver, claims, branch capacity, usage counters. | Node test runner (offline) |
| **Security Rules Test Suite** | `npm run test:rules --prefix functions` | ~8s | 18 rules tests: Firestore tenant isolation, branch read scoping, client write denials, and Storage rules. | Firestore & Storage Emulators |
| **Tenancy & Staff Auth Callables** | `node functions/scripts/test-tenancy-auth-callables.cjs` | ~12s | 25 Callables: Org provisioning, update, deactivation, staff, roles, departments, job roles, teams, catalog list, authLogin. | Local Emulator Suite |
| **Branch Lifecycle Callables** | `node functions/scripts/test-branch-lifecycle-callables.cjs` | ~8s | 7 Callables: Default branch lookup, branch list/create/update/deactivate, context switch claim update, sharing policies. | Local Emulator Suite |
| **Catalog & Inventory Callables** | `node functions/scripts/test-catalog-inventory-callables.cjs` | ~10s | 13 Callables: Categories, units, products, stock adjustments, movements list, stock balance reconciliation. | Local Emulator Suite |
| **Parties & Ledgers Callables** | `node functions/scripts/test-parties-ledgers-callables.cjs` | ~10s | 11 Callables: Customers, vendors, customer payments, vendor disbursements, party ledger reconciliation. | Local Emulator Suite |
| **Billing & Procurement Callables** | `node functions/scripts/test-billing-procurement-callables.cjs` | ~12s | 9 Callables: Outflows (purchase/expense), bills (POS/B2B/quotation), quotation finalization, sales returns. | Local Emulator Suite |
| **Operations, Tasks & Locations** | `node functions/scripts/test-operations-tasks-callables.cjs` | ~14s | 16 Callables: Task lifecycle, live location pinging, history trail, in-app notifications, delivery assignments. | Local Emulator Suite |
| **Analytics & Platform Callables** | `node functions/scripts/test-analytics-platform-callables.cjs` | ~14s | 20 Callables: 7 report callables, usage metering, rate card calculation, client metrics, branch count reconciliation. | Local Emulator Suite |
| **Firestore Event Triggers** | `node functions/scripts/test-event-triggers.cjs` | ~15s | 4 Background Triggers: `onBillWritten` (daily summaries), `onOutflowWritten` (WAC calculation), `onPaymentWritten`, `onDeliveryWritten`. | Local Emulator Suite |
| **Retail Lifecycle E2E** | `node functions/scripts/test-retail-lifecycle.e2e.js` | ~15s | 10-step full ERP operational lifecycle: catalog -> vendor intake -> sales bill -> payment -> return -> reconciliation. | Local Emulator Suite |
| **Multi-Branch Isolation E2E** | `node functions/scripts/test-multibranch-isolation.e2e.js` | ~25s | 15 multi-branch scenarios: branch provisioning, context switching, stock isolation, shared catalog, zero aggregate leakage, ledger reconciliation. | Local Emulator Suite |
| **Static Completeness Checker** | `node scripts/check-test-completeness.js` | ~1s | Verifies 100% test coverage across all 105 exports and all 44 concrete Firestore collection paths. | Static analysis |
| **API Drift Checker** | `node scripts/check-api-drift.js` | ~1s | Verifies that all 105 exported functions match the single living API contract in `docs/api-reference.md`. | Static analysis |
| **Anti-Embedding Checker** | `node scripts/check-duplicate-embedding.js` | ~1s | Verifies that all collections and source code strictly follow the reference-by-ID architecture with zero embedded foreign entities. | Static analysis |

---

## 3. Local Environment Setup & Execution

### Prerequisites
- **Node.js**: v22.x or v24.x (Local dev uses v24.16.0; Cloud Functions runtime targets Node.js 22 Gen 2).
- **Firebase CLI**: v13+ (Tested on v15.34.1). Install via `npm install -g firebase-tools`.
- **Java JRE**: Required by Firebase Local Emulator Suite (Java 11 or higher).

### Starting the Emulators

Because the codebase exports **105 Cloud Functions**, the Firebase CLI discovery process on Windows requires an extended discovery timeout. Set the discovery timeout before launching:

**Windows (PowerShell)**:
```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x
```

**macOS / Linux (Bash)**:
```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 firebase emulators:start --project trado-x
```

Default Emulator Ports:
- **Auth**: `127.0.0.1:9099`
- **Functions**: `127.0.0.1:5001`
- **Firestore**: `127.0.0.1:8080`
- **Storage**: `127.0.0.1:9199`
- **Emulator UI**: `http://127.0.0.1:4000`

### Seeding Reference Catalogs
In a separate terminal while emulators are running:
```bash
node functions/lib/scripts/seed-emulator.js --all
```
This provisions default modules (8), subscription plans (3), tax regimes (4), default roles, and 103 permission catalog entries.

---

## 4. Running Tests via Package Scripts

All tests can be executed using standard `npm run` commands inside the `functions` directory:

```bash
# 1. Unit Tests (97 tests across 26 suites, offline)
npm run test:unit --prefix functions

# 2. Security Rules Tests (Firestore & Storage emulator)
npm run test:rules --prefix functions

# 3. All 98 HTTPS Callables Integration Suite
npm run test:callables --prefix functions

# 4. Background Firestore Event Triggers (4 triggers)
npm run test:triggers --prefix functions

# 5. Connected End-to-End Scenarios (Retail Lifecycle & Multi-Branch Isolation)
npm run test:e2e --prefix functions

# 6. Static Test Completeness Audit (105 exports + 44 collections)
npm run test:completeness --prefix functions

# 7. Complete Verification Suite (Executes unit + callables + triggers + e2e + completeness)
npm run test:all --prefix functions
```

---

## 5. Backward Compatibility Layer

Legacy test command names are maintained as transparent forwarding wrappers:
- `functions/scripts/test-callables-integration.js` $\rightarrow$ forwards to `test-tenancy-auth-callables.cjs`
- `functions/scripts/test-phase3-integration.js` $\rightarrow$ forwards to `test-operations-tasks-callables.cjs` and `test-analytics-platform-callables.cjs`
- `functions/scripts/test-branch-deep-e2e.js` $\rightarrow$ forwards to `test-multibranch-isolation.e2e.js`
- `functions/scripts/test-e2e-business-flow.js` $\rightarrow$ forwards to `test-retail-lifecycle.e2e.js`


---

## 6. API Explorer (Interactive Manual Testing)

For visual, browser-based testing of individual callables, use the **API Explorer** — a local Swagger UI powered by an auto-generated OpenAPI 3.0 contract.

### Quick Start

```powershell
# Generate the OpenAPI spec (after building)
node scripts/generate-openapi.js

# Start the explorer (with emulators running)
node tools/api-explorer/server.js
```

Open **http://127.0.0.1:3939** and select a persona to sign in.

### Package Scripts

| Script | Purpose |
|--------|---------|
| `npm --prefix functions run api:openapi:generate` | Regenerate `docs/openapi.json` from manifest + Zod schemas |
| `npm --prefix functions run api:openapi:check` | Verify OpenAPI is in sync with manifest (in `test:static`) |
| `npm --prefix functions run api:explorer` | Start the Swagger UI proxy on port 3939 |
| `npm --prefix functions run test:api-explorer` | Run API Explorer integration tests (13 assertions) |

### What's Covered

- 101 HTTPS callable operations with input schemas from Zod
- 4 Firestore triggers documented (not callable via HTTP)
- Persona-based authentication (one-click login)
- Safety: binds only to `127.0.0.1`, targets only `trado-x` emulator

> **Full walkthrough:** See [Manual API Testing Guide](manual-api-testing-guide.md) for step-by-step instructions.
