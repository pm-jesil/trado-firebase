# Trado Firebase Backend — Local Emulator Test Personas & Credentials

> **Target Environment**: Local Firebase Emulator Suite ONLY (127.0.0.1)  
> **Firebase Project**: `trado-x`  
> **Auth Port**: `9099` | **Functions Port**: `5001` | **Firestore Port**: `8080` | **Storage Port**: `9199`  
> **API Explorer**: `http://127.0.0.1:3939`  
> **Default Test Password**: **`TestPassword123!`** (for all test personas)

This document provides the canonical testing reference for developers, QA engineers, and Flutter client integrators to authenticate against the local Firebase Emulator Suite using seeded test personas, organizations, branches, and roles.

---

## 1. Master Persona & Credential Directory

All accounts are automatically provisioned when executing:
```powershell
node functions/lib/scripts/seed-emulator.js --profile api-explorer-demo
```

| Persona Label | Email | Password | Role | Organization Context | Operating Branch | Assigned Branches | Primary Capabilities |
|---|---|---|---|---|---|---|---|
| **Platform Super Admin** | `superadmin@trado.local` | `TestPassword123!` | Platform Super Admin | `None (Platform)` | None | None | Global platform overview, plans, rate cards, usage limits, tenant deactivations. |
| **Apex Retail Owner** | `owner@apexwholesale.local` | `TestPassword123!` | Organization Owner (`role_org_owner`) | `org_apex_sample`<br>*(Apex Retail Supplies)* | `main-branch`<br>(`MAIN`) | `main-branch` | Full tenant configuration, staff onboarding, P&L, stock adjustments, branch management. |
| **Apex Retail Admin** | `admin@apexwholesale.local` | `TestPassword123!` | Organization Admin (`role_admin`) | `org_apex_sample`<br>*(Apex Retail Supplies)* | `main-branch`<br>(`MAIN`) | `main-branch` | Catalog management, purchase outflows, vendor bills, customer onboarding. |
| **Apex Retail Cashier** | `cashier@apexwholesale.local` | `TestPassword123!` | Cashier (`role_cashier`) | `org_apex_sample`<br>*(Apex Retail Supplies)* | `main-branch`<br>(`MAIN`) | `main-branch` | POS counter billing, receipt printing, cash collection, customer balance queries. |
| **Apex Retail Manager** | `manager@apexwholesale.local` | `TestPassword123!` | Store Manager (`role_store_manager`) | `org_apex_sample`<br>*(Apex Retail Supplies)* | `main-branch`<br>(`MAIN`) | `main-branch` | Stock adjustments, inventory valuation, daily reconciliation, purchase orders. |
| **Apex Retail Rider** | `rider@apexwholesale.local` | `TestPassword123!` | Delivery Rider (`role_rider`) | `org_apex_sample`<br>*(Apex Retail Supplies)* | `main-branch`<br>(`MAIN`) | `main-branch` | Delivery order status updates, dispatch acknowledgment, live GPS location pings. |
| **Wholesale Owner** | `owner@wholesale.trado.local` | `TestPassword123!` | Organization Owner (`role_org_owner`) | `org_wholesale_sample`<br>*(Apex Wholesale Hub)* | `main-branch`<br>(`MAIN`) | `main-branch`,<br>`branch_warehouse` | Multi-branch management, branch capacity quotas, enterprise consolidated reports. |
| **Wholesale Manager** | `manager@wholesale.trado.local` | `TestPassword123!` | Store Manager (`role_store_manager`) | `org_wholesale_sample`<br>*(Apex Wholesale Hub)* | `main-branch`<br>(`MAIN`) | `main-branch`,<br>`branch_warehouse` | Cross-branch inventory transfers, warehouse replenishments, branch context switching. |
| **Wholesale Cashier** | `cashier@wholesale.trado.local` | `TestPassword123!` | Cashier (`role_cashier`) | `org_wholesale_sample`<br>*(Apex Wholesale Hub)* | `main-branch`<br>(`MAIN`) | `main-branch` *(Branch Locked)* | Branch-locked B2B invoicing and payment collection strictly at Main Headquarters. |
| **Wholesale Rider** | `rider@wholesale.trado.local` | `TestPassword123!` | Delivery Rider (`role_rider`) | `org_wholesale_sample`<br>*(Apex Wholesale Hub)* | `main-branch`<br>(`MAIN`) | `main-branch` | Wholesale parcel delivery tracking, signature captures, status transitions. |

---

## 2. Organization & Branch Hierarchy

### 2.1 Organization A: Apex Retail Supplies (Single-Branch Retail)
- **Organization ID**: `org_apex_sample`
- **Business Type**: `retail_only` | **Category**: `general` | **Currency**: `INR` | **Tax Regime**: `IN_GST` (18%)
- **Subscription Plan**: `plan_starter` (Allows up to 1 active branch)
- **Branches**:
  * **Main Storefront (`main-branch`)**: Code: `MAIN` | Status: `active` | Default Branch: `true`
  * **Inactive Annex (`branch_inactive`)**: Code: `INACT` | Status: `deactivated` | Default Branch: `false` *(Used for negative testing)*
- **Data Sharing Policies**:
  * Customers: `all_branches`
  * Vendors: `all_branches`
  * Products: Catalog-wide (stock isolated per branch)

### 2.2 Organization B: Apex Wholesale Hub (Multi-Branch Wholesale)
- **Organization ID**: `org_wholesale_sample`
- **Business Type**: `wholesale_only` | **Category**: `grocery_fmcg` | **Currency**: `INR` | **Tax Regime**: `IN_GST` (18%)
- **Subscription Plan**: `plan_growth` (Allows up to 3 active branches)
- **Branches**:
  * **Headquarters (`main-branch`)**: Code: `MAIN` | Status: `active` | Default Branch: `true`
  * **Central Warehouse (`branch_warehouse`)**: Code: `WH01` | Status: `active` | Default Branch: `false`
- **Data Sharing Policies**:
  * Customers: `all_branches`
  * Vendors: `all_branches`
  * Products: Catalog-wide (stock isolated per branch)

### 2.3 Platform Super Admin Context (Zero Organization)
- **Authority Source**: Firebase Auth custom claim `isSuperAdmin === true`.
- **Tenant Context**:
  * `organizationId`: `null`
  * `branchId`: `null`
  * `role`: `null`
  * Tenant permissions: `[]`
  * Platform permissions: `["platform:*"]`
- **Super Admin Invariant**: Super Admin cannot execute routine tenant mutations (e.g. `billsCreate`, `outflowsCreate`) without a tenant membership.

---

## 3. Negative Testing Personas (Security & Revocation Testing)

Use these seeded entities to verify authorization error handling, token revocation guards, and edge-case boundary enforcement:

| Negative Entity / Persona | Email / Identifier | Target Org / Branch | Configured Failure Condition | Expected Error Code |
|---|---|---|---|---|
| **Deactivated User** | `inactive@apexwholesale.local` | `org_apex_sample` | Profile has `isActive: false` | `permission-denied` ("User profile is inactive") |
| **Revoked Member** | `deactivated_member@apexwholesale.local` | `org_apex_sample` | Membership has `status: "deactivated"` | `permission-denied` ("Membership is suspended") |
| **Inactive Branch** | `branch_inactive` (`INACT`) | `org_apex_sample` | Branch has `status: "deactivated"`, `isActive: false` | `permission-denied` ("Operating branch is deactivated") |
| **Suspended Tenant** | `suspended_org_user@apexwholesale.local` | `org_suspended_sample` | Organization has `status: "deactivated"` | `permission-denied` ("Organization is not active") |
| **Unassigned Branch Switch** | `cashier@wholesale.trado.local` | `org_wholesale_sample` | Attempting `branchContextSwitch` to `branch_warehouse` | `permission-denied` ("User is not assigned to target branch") |
| **Cross-Tenant Breach** | `owner@apexwholesale.local` | `org_wholesale_sample` | Attempting to read/write Org B's products or bills | `permission-denied` |

---

## 4. Seeded Inventory, Catalog & Party Data

### 4.1 Sample Products & Stock Balances

| Product Name | Product ID | Barcode | Cost Price (₹) | Selling Price (₹) | Initial Stock (`main-branch`) | Initial Stock (`branch_warehouse`) |
|---|---|---|:---:|:---:|:---:|:---:|
| **Whole Wheat Bread 400g** | `prod_bread_sample` | `BC10000001` | 30.00 | 45.00 | 50 pk | *(Retail Only)* |
| **Fresh Milk 1L** | `prod_milk_sample` | `BC10000002` | 42.00 | 60.00 | 100 pk | *(Retail Only)* |
| **Basmati Rice 25kg Sack** | `prod_rice_sample` | `BC20000001` | 1,400.00 | 1,850.00 | 100 bags *(Main HQ)* | 250 bags *(Central WH)* |

### 4.2 Sample Parties (Customers & Vendors)

| Party Name | Party ID | Type | Organization | Sharing Scope | Assigned Branch |
|---|---|---|---|---|---|
| **City Mart Supermarket** | `cust_citymart_sample` | Customer | `org_apex_sample` | `all_branches` | `main-branch` |
| **Golden Grain Mills** | `vend_goldengrain_sample` | Vendor | `org_apex_sample` | `all_branches` | `main-branch` |
| **Metro Hypermarkets India** | `cust_metro_sample` | Customer | `org_wholesale_sample` | `all_branches` | Shared across all |
| **Regional Retail Mart** | `cust_regional_sample` | Customer | `org_wholesale_sample` | `branch_only` | Restricted to `main-branch` |
| **National Grain Producers** | `vend_nationalgrain_sample`| Vendor | `org_wholesale_sample` | `all_branches` | Shared across all |

---

## 5. How to Authenticate & Test

### 5.1 In Flutter Web & Mobile Client
```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';

Future<void> signInAndBootstrap() async {
  // 1. Sign in with Firebase Auth Emulator
  final credential = await FirebaseAuth.instance.signInWithEmailAndPassword(
    email: 'owner@apexwholesale.local',
    password: 'TestPassword123!',
  );

  // 2. Bootstrap application session context
  final authMeCallable = FirebaseFunctions.instanceFor(region: 'asia-south1').httpsCallable('authMe');
  final result = await authMeCallable.call(<String, dynamic>{
    'deviceId': 'flutter-web-client-id-01',
  });

  print('Session context initialized: ${result.data}');
}
```

### 5.2 In Local API Explorer (Swagger UI)
1. Open **`http://127.0.0.1:3939`** in your browser.
2. Click any of the **Quick Persona Login** buttons:
   - 🛡️ **Super Admin** (`superadmin@trado.local`)
   - 🏢 **Retail Owner** (`owner@apexwholesale.local`)
   - 🛒 **Retail Cashier** (`cashier@apexwholesale.local`)
   - 📦 **Wholesale Owner** (`owner@wholesale.trado.local`)
   - 🏬 **Wholesale Manager** (`manager@wholesale.trado.local`)
3. The session is immediately active with verified JWT tokens and preloaded context. You can now execute any callable directly from the Swagger UI.

### 5.3 Automated Local Credentials File
Whenever the seeder executes, it writes an updated credential file for manual tools and scripts to:
```
.local/api-explorer-credentials.json
```
*(This file is strictly Git-ignored and contains zero production secrets).*

