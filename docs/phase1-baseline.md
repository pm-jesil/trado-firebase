# Phase 1 Baseline Inspection Report

**Date & Time**: 2026-10-27  
**Project**: Trado Firebase Backend (Phase 1)  
**Firebase Project ID**: `trado-x`  
**Firebase Project Number**: `293471017332`  
**Firestore Location**: `asia-south1` (Mumbai)  
**Functions Region**: `asia-south1` (configured in codebase options)  
**Workspace Path**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`

---

## 1. Firebase Platform & Emulator Configuration Baseline

| Service | Configured Port | Status | Configuration File |
| :--- | :--- | :--- | :--- |
| **Authentication** | `9099` | Configured in `firebase.json` | `firebase.json` (`emulators.auth`) |
| **Cloud Functions (2nd Gen)** | `5001` | Configured in `firebase.json` | `firebase.json` (`functions.source: "functions"`) |
| **Cloud Firestore (Native)** | `8080` | Configured in `firebase.json` | `firestore.rules`, `firestore.indexes.json` |
| **Emulator UI** | `4000` | Configured in `firebase.json` | `firebase.json` (`emulators.ui.enabled: true`) |
| **Cloud Storage** | `9199` *(Planned)* | Not yet in `firebase.json` | Needs `storage.rules` and port `9199` added |
| **Hosting / App Hosting** | — | Explicitly excluded | Not needed for Phase 1 backend |

### Configuration Files Inspected:
- **`firebase.json`**:
  - Points to `functions` source directory.
  - Points to `firestore.rules` and `firestore.indexes.json`.
  - Configures Auth (9099), Functions (5001), Firestore (8080), and UI (4000) with `singleProjectMode: true`.
- **`.firebaserc`**:
  - Maps `default` to `trado-x`.
- **`firestore.rules`**:
  - Currently contains default temporary open rule (`allow read, write: if request.time < timestamp.date(2026, 11, 26);`).
  - **Security Audit Status**: INSECURE default. Must be replaced with strict Phase 1 security rules denying direct client writes and isolating tenant reads.
- **`firestore.indexes.json`**:
  - Currently empty index and override arrays.
- **`storage.rules`**:
  - Does NOT exist yet. Needs to be created for avatar/logo upload rules under port 9199.

---

## 2. Cloud Functions Baseline

- **Directory**: `functions/`
- **Current `functions/package.json`**:
  - Dependencies: `firebase-admin: ^13.6.0`, `firebase-functions: ^7.0.0`
  - DevDependencies: `typescript: ^6.0.0`, `eslint: ^8.57.0`, `firebase-functions-test: ^3.4.1`
  - `engines.node`: Currently set to `"24"`. Target deployment runtime must be set to `"22"` per project requirements.
- **Host Node & NPM Versions**:
  - Node.js host executable: `v24.16.0` (`C:\Users\jesil.p\node\node-v24.16.0-win-x64\node.exe`)
  - NPM host executable: `11.13.0`
  - Firebase CLI version: `15.34.1`
- **Functions Source (`functions/src/index.ts`)**:
  - Only contains `setGlobalOptions({ maxInstances: 10 });` and commented-out boilerplate.
  - Zero named functions are currently exported (`Object.keys(require('./lib/index.js'))` returns `[]`).
- **Tests**:
  - `functions/test/` does NOT exist yet. Needs to be created with unit and integration tests.

---

## 3. Legacy Source Code & Specification Discovery

| Source Location | Type | Accessibility & Findings |
| :--- | :--- | :--- |
| `C:\Users\jesil.p\Project\Nest Js` | Directory | Empty directory. `testing-trado-api` was not found here or in user profile root. |
| `C:\Users\jesil.p\Project\Next Js\sample-trado-web` | Web Portal Repository | **ACCESSIBLE**. Contains `swagger.json` (106 API paths, complete DTOs), `PROJECT_REPORT.md`, `API_ISSUES.md`, and role/capability enforcement tables. |
| `C:\Users\jesil.p\Project\Flutter\pmj-samples\testing-trado` | Flutter Mobile Client | **ACCESSIBLE**. Contains canonical enums (`enums.dart`), permissions catalog (`permissions.dart`, `permission_model.dart`), auth models (`current_user.dart`), and multi-tenant test suites (`employee_multi_tenant_flow_test.dart`, `route_guard_and_permissions_test.dart`). |
| `.agents/skills` & `.claude/skills` | Agent Skills | 13 Firebase skills installed, including `firebase-firestore`, `firebase-auth-basics`, `firebase-security-rules-auditor`, and `firestore-rules-creation`. |

---

## 4. Key Business Decisions Extracted from Accessible Sources

1. **Tenant Representation**:
   - In legacy NestJS/MongoDB backend, the tenant was termed `Brand`. In the updated Trado platform architecture, the canonical entity is `Organization`.
2. **User & Membership Model**:
   - `users/{uid}` represents the global identity profile (name, email, phone, accountType, isActive).
   - `memberships/{membershipId}` joins a user to an organization, containing `roleId`, `departmentId`, `jobRoleIds`, `teamId`, `reportingToIds`, explicit `permissions` overrides, and `status`.
   - Client cannot supply its own actor UID; all mutations derive actor UID from `request.auth.uid`.
3. **Four-Layer Permission Model**:
   - **Layer 1 (Plan)**: Subscription Plan `moduleFlags`. If a module is false in the plan, all capabilities in that module are disabled.
   - **Layer 2 (Organization)**: Organization `moduleToggles`. Tenant admins can disable modules within plan limits.
   - **Layer 3 (Role)**: Base role permissions catalog codes assigned to the membership.
   - **Layer 4 (Membership Overrides)**: Granular grant and deny overrides on the individual membership. Deny overrides strictly supersede grants.
   - **Super Admin Bypass**: Unrestricted platform & tenant access verified by `token.isSuperAdmin === true`.
   - **Org Owner**: Unrestricted access to tenant capabilities (non-platform).
4. **Canonical Enums**:
   - `BusinessType`: `retail_only`, `wholesale_only`, `wholesale_retail`, `distributor`, `restaurant`, `cafe_bakery`, `service`, `general_trading`.
   - `BusinessCategory`: 14 categories (`bicycle`, `motorcycle`, `car_automobile`, `auto_spare_parts`, `mobile_electronics`, `grocery_fmcg`, `pharmacy_medical`, `textile_garments`, `hardware_building`, `furniture_home`, `stationery_books`, `food_beverage`, `agri_products`, `general`).
   - `SalesMode`: `pos`, `b2b`, `both`.
   - `UserRole`: `super_admin`, `org_owner`, `admin`, `employee`.
5. **Phase 2 & 3 Strict Exclusions**:
   - Operational sales/POS, purchase orders, inventory stock moves, deliveries, tax calculation engine, live location tracking, and reporting analytics are strictly excluded from Phase 1.
