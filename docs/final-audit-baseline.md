# Trado Firebase Backend — Final Audit Baseline & Working-Tree Inspection

## 1. Environment & Workspace Metadata

* **Absolute Workspace Path**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`
* **Version Control Status**: Not a Git repository (`fatal: not a git repository (or any of the parent directories): .git`). Local directory backup & audit trail maintained in `docs/`.
* **Node.js Host Version**: `v24.16.0` (npm: `11.13.0`)
* **Functions Target Runtime Engine**: Node.js `22` (defined in `functions/package.json` line 18: `"engines": { "node": "22" }`)
* **Firebase CLI Version**: `15.34.1`
* **Firebase Project Configuration**:
  - Configured project in `.firebaserc`: `trado-x`
  - Canonical Project Number: `293471017332`
  - Primary Region: `asia-south1` (Mumbai)
  - Cloud Platform Billing: Blaze via Google Cloud Free Trial (live deployments strictly prohibited in audit scope)

---

## 2. Firebase Emulator Configuration (`firebase.json`)

| Emulator | Port | Configured in `firebase.json` | Active Port Conflict |
| :--- | :--- | :--- | :--- |
| **Authentication** | `9099` | Yes | None (Port free) |
| **Cloud Functions (Gen 2)** | `5001` | Yes | None (Port free) |
| **Cloud Firestore** | `8080` | Yes | None (Port free) |
| **Cloud Storage** | `9199` | Yes (`storage.rules`) | None (Port free) |
| **Emulator UI** | `4000` | Yes (`"ui": { "enabled": true }`) | None (Port free) |
| **Firestore WebSocket** | `9150` | Standard emulator daemon | None (Port free) |

* **Single Project Mode**: `true`
* **Rules Files**:
  - Firestore Security Rules: `firestore.rules` (8,020 bytes)
  - Firestore Indexes: `firestore.indexes.json` (1,238 bytes)
  - Storage Security Rules: `storage.rules` (1,575 bytes)

---

## 3. Cloud Functions Exports & Entry Points (`functions/src/index.ts`)

Exported 2nd Generation Cloud Functions (total: 39 callables):
1. **Diagnostic & Identity**: `healthCheck`, `authMe`
2. **Tenancy & Orgs**: `organizationsCreate`, `organizationsUpdate`, `organizationsDeactivate`, `organizationsList`
3. **Employees & Access Control**: `employeesCreate`, `employeesUpdate`, `employeesDeactivate`, `employeesList`
4. **Roles & Permissions**: `rolesCreate`, `rolesUpdate`, `rolesList`
5. **Organizational Structure**: `departmentsCreate`, `departmentsUpdate`, `departmentsList`, `jobRolesCreate`, `jobRolesUpdate`, `jobRolesList`, `teamsCreate`, `teamsUpdate`, `teamsList`
6. **Platform Catalogs & Subscription**: `plansCreate`, `plansUpdate`, `plansList`, `permissionCatalogList`, `modulesList`, `taxRegimesList`
7. **Notifications & FCM**: `notificationsRegisterFcmToken`
8. **Products & Catalog**: `productsCreate`, `productsUpdate`, `productsList`, `productsGet`
9. **Categories & Units**: `categoriesCreate`, `categoriesUpdate`, `categoriesList`, `unitsCreate`, `unitsUpdate`, `unitsList`
10. **Customers & Vendors**: `customersCreate`, `customersUpdate`, `customersList`, `customersGet`, `vendorsCreate`, `vendorsUpdate`, `vendorsList`, `vendorsGet`
11. **Unified Outflows**: `outflowsCreate`, `outflowsList`, `outflowsGet`
12. **Shared Sales & Billing**: `billsCreate`, `billsFinalize`, `billsList`, `billsGet`
13. **Logistics & Returns**: `deliveriesCreate`, `deliveriesUpdateStatus`, `deliveriesList`, `deliveriesGet`, `returnsCreate`, `returnsList`
14. **Payments Ledger**: `paymentsCreate`, `paymentsList`
15. **Stock Management**: `stockAdjust`, `stockMovementsList`
16. **Ledger & Stock Reconciliation**: `reconcileStockBalances`, `reconcilePartyLedgers`

---

## 4. Test Harnesses & Tooling Inventory

1. **Unit Test Suite**:
   - Location: `functions/src/test/unit/` (compiled to `functions/lib/test/unit/`)
   - Command: `npm run test:unit --prefix functions` (runs `node --test lib/test/unit/**/*.test.js`)
   - Suites: 11 suites covering custom claims, provisioning compensation, employee multi-org deactivation, idempotency lease recovery, notification sender mock, 4-layer permission resolver, tax calculation, document counter formatting, stock arithmetic, decimal-safe money utility, and seed safety guard.
2. **Security Rules Test Suite**:
   - Location: `functions/src/test/rules/` (compiled to `functions/lib/test/rules/`)
   - Command: `firebase emulators:exec --only firestore,storage "npm run test:rules --prefix functions"`
   - Suites: 2 suites (Firestore Rules matrix covering tenant isolation, cross-tenant rejection, role-gating, private collection denial; Storage Rules matrix covering MIME validation, size limits, avatar isolation).
3. **Callable Integration Test Suite**:
   - Location: `functions/scripts/test-callables-integration.js`
   - Command: `firebase emulators:exec --only auth,firestore,functions "node functions/scripts/test-callables-integration.js"`
   - Tests: 32 sequential & concurrent tests spanning Phase 1 RBAC and Phase 2 operational flows.
4. **Anti-Embedding Source Static Checker**:
   - Location: `scripts/check-duplicate-embedding.js`
   - Commands:
     - Real-source scan: `node scripts/check-duplicate-embedding.js`
     - Self-test guard: `node scripts/check-duplicate-embedding.js --test`
5. **Emulator Seed Script**:
   - Location: `functions/src/scripts/seed-emulator.ts` (compiled to `functions/lib/scripts/seed-emulator.js`)
   - Command: `firebase emulators:exec --only auth,firestore "node functions/lib/scripts/seed-emulator.js"`

---

## 5. Primary Source-of-Truth Artifacts Inspected

1. **Legacy NestJS / MongoDB API**:
   - Path: `C:\Users\jesil.p\Project\Nest Js\testing-trado-api`
   - Accessibility: **Full local read access**
   - Key Schemas inspected:
     - `src/database/schemas/organization.schema.ts` (Multi-tenant org boundaries)
     - `src/database/schemas/item.schema.ts` (`currentStock: number; trackStock: boolean;` no branchId)
     - `src/database/schemas/stock-movement.schema.ts` (organization + item references only)
     - `src/database/schemas/expense.schema.ts` (unified purchase + expense model)
     - `src/database/schemas/bill.schema.ts` (shared billing model)
     - `src/common/money/money.util.ts` (canonical precision rounding and ISO currency exponent logic)
     - `src/common/constants/enums.constant.ts` (canonical business enums)
2. **Flutter Mobile Applications**:
   - Path: `C:\Users\jesil.p\Project\Flutter\pmj-samples\testing-trado` & `testing-trado-mob`
   - Accessibility: **Full local read access**
   - Key Findings:
     - Zero occurrences of `branchId` or `branch_id` across the entire Dart codebase.
     - Multi-branch is explicitly implemented as multi-org switching: `${user?.organizationName ?? 'Branch Outlet'}`.

---

## 6. Pre-Audit Repository File Inventory

```
C:\Users\jesil.p\Project\FireBase\trado-firebase\
├── .agents/ (Installed Antigravity skills and tools)
├── .claude/
├── docs/ (Phase 1 and Phase 2 architecture, data model, and API specifications)
├── functions/
│   ├── src/ (TypeScript source code for Gen 2 Cloud Functions)
│   ├── lib/ (Compiled JavaScript build output)
│   ├── node_modules/ (Runtime dependencies)
│   ├── scripts/ (Integration test harness)
│   ├── package.json, package-lock.json, tsconfig.json, tsconfig.dev.json
├── scripts/
│   ├── fixtures/
│   ├── check-duplicate-embedding.js
│   ├── test-callable-invocation.js
│   └── test-callables-integration.js (Older version - candidate for consolidation)
├── .firebaserc
├── .gitignore
├── firebase.json
├── firestore-debug.log (Emulator execution log - generated)
├── firestore.indexes.json
├── firestore.rules
├── skills-lock.json
└── storage.rules
```
