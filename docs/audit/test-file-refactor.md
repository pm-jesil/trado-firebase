# Trado Backend: Test File Inventory & Refactor Documentation

This document records the migration of test files from historical phase-based naming (`phase1`, `phase2`, `phase3`, `deep-e2e`) to domain-oriented semantic naming, details the reusable test infrastructure, and explains the backward-compatibility layer.

---

## 1. Test Suite Refactor & Renaming Map

### A. Unit Tests (`functions/src/test/unit/`)

| Legacy / Phase Filename | Canonical Semantic Filename | Domain Focus | Test Count |
|---|---|---|:---:|
| `phase2Services.test.ts` | `financialAndCoreServices.test.ts` | WAC Costing, COGS, Stock Balances, Money Precision, Idempotency, 4-Layer RBAC | 46 tests |
| `phase3Validation.test.ts` | `operationsValidation.test.ts` | Tasks Validation, Location Coordinates, CSV Export, Branch Limits, Usage Metering | 24 tests |
| `businessRules.test.ts` | `businessRules.test.ts` | Tax Calculation, Document Numbering, Rounding | 11 tests |
| `authService.test.ts` | `authService.test.ts` | Custom Claims, Rollback Compensation, Token Resolution | 8 tests |
| `seedEmulator.test.ts` | `seedEmulator.test.ts` | Anti-Cloud Safety Guard Verification | 4 tests |
| `schemas.test.ts` | `schemas.test.ts` | Branch Validation, Customer/Vendor Sharing Schemas | 4 tests |

**Total Unit Tests**: **97 tests across 26 suites (0 failures)**.

---

### B. Integration & E2E Suites (`functions/scripts/`)

| Legacy / Monolithic Filename | Canonical Semantic Filenames | Functionality & Coverage |
|---|---|---|
| `test-callables-integration.js`<br>*(1,386 lines monolithic)* | 1. `test-tenancy-auth-callables.cjs`<br>2. `test-branch-lifecycle-callables.cjs`<br>3. `test-catalog-inventory-callables.cjs`<br>4. `test-parties-ledgers-callables.cjs`<br>5. `test-billing-procurement-callables.cjs` | Decomposed into 5 modular, focused domain suites covering 64 Callables. |
| `test-phase3-integration.js`<br>*(820 lines monolithic)* | 6. `test-operations-tasks-callables.cjs`<br>7. `test-analytics-platform-callables.cjs`<br>8. `test-event-triggers.cjs` | Decomposed into Operations, Analytics/Metering, and Event Triggers covering 34 Callables + 4 Triggers. |
| `test-e2e-business-flow.js` | 9. `test-retail-lifecycle.e2e.js` | 10-step full ERP retail lifecycle: intake -> bill -> payment -> return -> reconciliation. |
| `test-branch-deep-e2e.js` | 10. `test-multibranch-isolation.e2e.js`| 15 multi-branch scenarios: topology, context switching, stock isolation, cross-tenant security. |

---

## 2. Reusable Test Infrastructure Layer (`functions/scripts/helpers/`)

To eliminate code duplication, inconsistent token signing, and race conditions across integration scripts, four hardened reusable modules were created:

### 1. `emulator-helper.cjs`
- **Anti-Cloud Safety Enforcement**: Automatically inspects `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`. Strictly aborts with code 1 if remote/cloud hosts are detected.
- **Loopback Defaulting**: Automatically sets `127.0.0.1:8080`, `127.0.0.1:9099`, and `GCLOUD_PROJECT = "trado-x"` before any Admin SDK initialization, preventing hangs on GCP metadata servers.
- **Admin & Firestore Instances**: Pre-initializes and exports `admin` and `db` for direct assertion over Firestore documents.

### 2. `callable-client.cjs`
- **REST Token Exchange (`getIdToken`)**: Exchanges email and password for an Auth ID token via the local Auth Emulator REST endpoint.
- **Callable Invocation (`callFunction`)**: Dispatches POST requests to `http://127.0.0.1:5001/trado-x/asia-south1/{callableName}` with proper `Bearer` Authorization headers and payload formatting `{ data }`.
- **Callable Error Asserter (`assertCallableError`)**: Asserts that an asynchronous callable promise rejects with expected Firebase error codes (e.g., `["permission-denied", "failed-precondition"]`).

### 3. `auth-personas.cjs`
- **Deterministic Personas**:
  - `getSuperAdminPersona()`: Uses pre-seeded platform Super Admin credentials.
  - `createTenantOwnerPersona()`: Provisions a unique isolated Organization, sets up `main-branch`, creates the owner user, and returns fresh ID tokens.
  - `createEmployeePersona()`: Creates a tenant staff member with designated roles, branch assignments, and permissions.
  - `createUnassignedUserPersona()`: Authenticates a standalone user with zero organization memberships for boundary denial assertions.

### 4. `domain-builders.cjs`
- **Typed Payload Builders**:
  - `buildProductPayload(orgId, overrides)`: Produces valid `CreateProductSchema` payloads with stock tracking options.
  - `buildCustomerPayload(orgId, overrides)`: Produces valid `CreateCustomerSchema` payloads with branch visibility configurations.
  - `buildVendorPayload(orgId, overrides)`: Produces valid `CreateVendorSchema` payloads with payment terms.

---

## 3. Backward Compatibility Layer

To prevent breaking existing developer muscle-memory, CI scripts, or documentation links, the original test file paths remain functional as forwarding wrappers:

- `functions/scripts/test-callables-integration.js` forwards directly to `test-tenancy-auth-callables.cjs`
- `functions/scripts/test-phase3-integration.js` forwards to `test-operations-tasks-callables.cjs` and `test-analytics-platform-callables.cjs`
- `functions/scripts/test-e2e-business-flow.js` forwards directly to `test-retail-lifecycle.e2e.js`
- `functions/scripts/test-branch-deep-e2e.js` forwards directly to `test-multibranch-isolation.e2e.js`

Executing any of these legacy files continues to run the respective test suite with identical exit code behavior.

