# Trado Firebase Backend — Final Sign-off Baseline & Working-Tree Inspection

**Date of Audit**: 2026-10-28  
**Auditor**: Antigravity Final Sign-Off System  
**Workspace Root**: `C:\Users\jesil.p\Project\FireBase\trado-firebase`

---

## 1. Version Control & Working-Tree Status
* **Git Status**: Workspace is NOT a Git repository (`fatal: not a git repository (or any of the parent directories): .git`).
* **Source Checkpoint**: All changes are tracked through versioned documentation and audit reports in `docs/`.
* **Working-Tree Integrity**: No untracked binary files, no temporary credentials, and no `.env` files containing secrets exist.

---

## 2. Platform & Toolchain Baseline

| Component | Reported / Configured | Actual Verified on System | Verification Command / Evidence |
| :--- | :--- | :--- | :--- |
| **Node.js Host** | `v24.16.0` | `v24.16.0` | `node --version` |
| **npm Host** | `11.13.0` | `11.13.0` | `npm --version` |
| **Firebase CLI** | `15.34.1` | `15.34.1` | `firebase --version` |
| **Functions Runtime** | Node.js `22` | Engine `"22"` in `package.json` | Host Node 24 runs emulator safely with warning |
| **Firebase Project** | `trado-x` | `trado-x` | Bound in `.firebaserc` (`default: "trado-x"`) |
| **Project Number** | `293471017332` | `293471017332` | Canonical Google Cloud Project Number |
| **Primary Region** | `asia-south1` (Mumbai) | `asia-south1` | Hardcoded in `functions/src/index.ts` via `setGlobalOptions` |

---

## 3. Firebase Emulator Configuration (`firebase.json`)

| Service | Port | Rules / Source File | Safeguard Verification |
| :--- | :--- | :--- | :--- |
| **Authentication** | `9099` | Native emulator | REST API at `127.0.0.1:9099` |
| **Functions (Gen 2)**| `5001` | `functions/lib/index.js` | Exports loaded on `127.0.0.1:5001/trado-x/asia-south1/...` |
| **Firestore** | `8080` | `firestore.rules` (8,020 B) | Standard edition, strict client write lockdown |
| **Storage** | `9199` | `storage.rules` (1,575 B) | Image MIME & size checks |
| **Emulator UI** | `4000` | UI enabled | Single Project Mode active |
| **Indexes** | — | `firestore.indexes.json` (1,238 B)| Loaded by emulator |

### Production Safeguard Proof
All integration and seed scripts enforce an explicit environment check:
```typescript
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("ABORTED: Refusing to run against production!");
}
```
If emulator hosts are missing or unconfigured, scripts terminate immediately with exit code 1.

---

## 4. Exported Functions Inventory (`functions/src/index.ts`)
Total: Exactly **66 callable Cloud Functions** (29 Phase 1 + 37 Phase 2):
1. **Diagnostics & Identity (2)**: `healthCheck`, `authMe`
2. **Tenancy (4)**: `organizationsCreate`, `organizationsUpdate`, `organizationsDeactivate`, `organizationsList`
3. **Employees & Access Control (4)**: `employeesCreate`, `employeesUpdate`, `employeesDeactivate`, `employeesList`
4. **Roles & Permissions (3)**: `rolesCreate`, `rolesUpdate`, `rolesList`
5. **Organizational Structure (9)**: `departmentsCreate`, `departmentsUpdate`, `departmentsList`, `jobRolesCreate`, `jobRolesUpdate`, `jobRolesList`, `teamsCreate`, `teamsUpdate`, `teamsList`
6. **Platform Catalogs & Plans (6)**: `plansCreate`, `plansUpdate`, `plansList`, `permissionCatalogList`, `modulesList`, `taxRegimesList`
7. **Device Notifications (1)**: `notificationsRegisterFcmToken`
8. **Products & Catalog (4)**: `productsCreate`, `productsUpdate`, `productsList`, `productsGet`
9. **Categories & Units (6)**: `categoriesCreate`, `categoriesUpdate`, `categoriesList`, `unitsCreate`, `unitsUpdate`, `unitsList`
10. **Parties (8)**: `customersCreate`, `customersUpdate`, `customersList`, `customersGet`, `vendorsCreate`, `vendorsUpdate`, `vendorsList`, `vendorsGet`
11. **Unified Outflows (3)**: `outflowsCreate`, `outflowsList`, `outflowsGet`
12. **Shared Billing & Sales (4)**: `billsCreate`, `billsFinalize`, `billsList`, `billsGet`
13. **Logistics & Returns (6)**: `deliveriesCreate`, `deliveriesUpdateStatus`, `deliveriesList`, `deliveriesGet`, `returnsCreate`, `returnsList`
14. **Payments Ledger (2)**: `paymentsCreate`, `paymentsList`
15. **Stock Management (2)**: `stockAdjust`, `stockMovementsList`
16. **Ledger & Stock Reconciliation (2)**: `reconcileStockBalances`, `reconcilePartyLedgers`

---

## 5. Accessibility of Legacy & Reference Codebases

| Codebase Path | Found? | Type | Key Assets Inspected |
| :--- | :--- | :--- | :--- |
| `C:\Users\jesil.p\Project\Nest Js\testing-trado-api` | **YES** | NestJS Backend Source | `src/database/schemas/item.schema.ts`, `stock-movement.schema.ts`, `reports.controller.ts`, `purchases.service.ts`, `money.util.ts`, `users.integration.spec.ts` |
| `C:\Users\jesil.p\Project\Flutter\pmj-samples\testing-trado` | **YES** | Flutter Web/Desktop Client | `lib/features/organization/widgets/organization_detail_sheet.dart`, `dashboard_repository.dart`, `dashboard_summary_model.dart`, `api_client.dart` |
| `C:\Users\jesil.p\Project\Flutter\pmj-samples\testing-trado-mob` | **YES** | Flutter Mobile Client | `lib/features/super_admin/screens/organizations_list_screen.dart`, `employee_dashboard_screen.dart`, `api_client.dart`, `super_admin_analytics_screen.dart` |
