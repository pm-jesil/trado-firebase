# Trado Local Development & Safe Emulator Seed Guide

> **Target Environment**: Local Firebase Emulator Suite ONLY  
> **Host**: `127.0.0.1` (Auth `9099`, Functions `5001`, Firestore `8080`, Storage `9199`, UI `4000`)  
> **Target Project ID**: `trado-x`  
> **Production Safety Guarantee**: Hard-coded safety guards abort execution unless emulator endpoints are explicitly confirmed. Never connects to live Firebase.

---

## 1. Safety Architecture & Safeguards

The Trado emulator seed tooling is built with fail-closed safety controls:

1. **Mandatory Emulator Environment Variables**:
   - `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
   - `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`
   - If either variable is missing, the seed script **aborts immediately** with exit code 1.
2. **Project ID Lockdown**:
   - The script enforces `projectId === "trado-x"`.
   - Running with an unauthorized or cloud project ID immediately aborts execution.
3. **Deterministic Fixture IDs & Idempotency**:
   - All seeded records use deterministic document keys (e.g. `org_apex_sample`, `main-branch`, `role_owner`).
   - Running the seed multiple times produces identical, idempotent results without creating duplicate documents or corrupting existing data.
4. **Test-Only Credentials**:
   - All test users use local `.local` domains (e.g. `superadmin@trado.local`, `owner.wholesale@apexwholesale.local`).
   - Passwords are test-only credentials (`TestPassword123!`) configured via local environment variables. Real passwords, API keys, or production service-account JSON files are never accepted or logged.

---

## 2. Seed Tool Execution Modes & CLI Flags

The canonical seed script is located at `functions/src/scripts/seed-emulator.ts` (compiled to `functions/lib/scripts/seed-emulator.js`).

### CLI Options
- `--check`: Read-only audit of local Firestore. Reports existing and missing reference catalogs and test accounts without writing any data.
- `--seed-reference-data`: Seeds platform catalogs only (Modules, Tax Regimes, Subscription Plans, Permission Catalog, System Roles, and Default Job Roles).
- `--seed-demo-organization`: Seeds a complete sample wholesale organization (`org_apex_sample`), default branch (`main-branch`), Owner, Admin, Cashier, and catalog products.
- `--reset-seed-data`: Safely deletes only documents positively identified as seed fixtures from the local emulator. Does not affect non-seed user data.
- `--all`: Seeds all reference catalogs, demo organizations, and sample operational transactions.

### Seed Profiles
- `minimal`: Super Admin + reference catalogs + one subscription plan + one sample organization + `main-branch` + Owner.
- `staff-demo`: Adds Store Admin and Cashier test identities with assigned branch records in `membershipBranches`.
- `operations-demo`: Adds catalog products, customer, vendor, and a consistent sample transaction history (purchase inward, POS bill, payment).
- `multi-branch-test`: Adds an isolated two-branch organization (`main-branch` and `branch-south`) for testing branch-scoped stock and sharing policies.
- `api-explorer-demo`: Comprehensive seed profile for API Explorer, Flutter frontend development, and manual testing. Provisions:
  * Platform Super Admin (`superadmin@trado.local`)
  * Retail Demo Organization A (`org_apex_sample`, `plan_starter`, single `main-branch`)
  * Multi-Branch Wholesale Demo Organization B (`org_wholesale_sample`, `plan_growth`, two branches: `main-branch` + `branch_warehouse`)
  * Branch-isolated stock balances (100 in Main, 250 in Warehouse for Rice Sack)
  * Multi-branch and branch-restricted customers and vendors
  * Automatically exports safe credentials to `.local/api-explorer-credentials.json` (git-ignored)

---

## 3. Step-by-Step PowerShell Walkthrough

### Step 1: Start the Local Firebase Emulators
Open Terminal 1:
```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x
```
*Wait until the Emulator UI is available at `http://127.0.0.1:4000`.*

### Step 2: Configure Local Emulator Environment Variables
Open Terminal 2:
```powershell
$env:Path = "C:\Users\jesil.p\node\node-v24.16.0-win-x64;$env:Path"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
```

### Step 3: Run Seed Pre-Flight Inspection (`--check`)
```powershell
node functions/lib/scripts/seed-emulator.js --check
```
*Prints a status report of present vs. missing seed collections.*

### Step 4: Execute Full Seed (`--all`)
```powershell
node functions/lib/scripts/seed-emulator.js --all
```
*Expected output: Seeds modules, tax regimes, plans, permissions, system roles, Super Admin, sample organization, branches, staff, products, and parties with exit code 0.*

### Step 5: Verify Idempotency (Run Seed Twice)
```powershell
node functions/lib/scripts/seed-emulator.js --all
```
*Expected output: Detects existing deterministic fixtures, updates existing records in place, and reports 0 duplicate collections.*

---

## 4. Test Accounts & Personas (Local Emulator Only)

> [!NOTE]
> These accounts exist solely within the local Emulator Auth database (port `9099`) and cannot be used against cloud production.

### Platform Super Admin (Belongs to NO Organization)
The Super Admin is a global platform operator with unrestricted privileges across all organizations, rate cards, and system catalogs.

| Persona | Email Address | Default Password | Trusted Custom Claims | Organization Context |
|---|---|---|---|---|
| **Platform Super Admin** | `superadmin@trado.local` | `TestPassword123!` | `{ isSuperAdmin: true }` | **None** (`primaryOrganizationId: null`) |

### Business 1: Apex Corner Retail (Single-Branch / Starter Plan)
A grocery and retail corner store operating under `plan_starter` (hard branch limit = 1). Demonstrates POS billing, quotation-to-invoice finalization, perpetual WAC dilution handling, damage adjustments, and partial returns.

| Persona / Role | Email Address | Default Password | Trusted Custom Claims | Assigned Branches | Purpose |
|---|---|---|---|---|---|
| **Retail Store Owner** | `owner.retail@apexretail.local` | `TestPassword123!` | `{ primaryOrganizationId: "<org1_id>", primaryBranchId: "main-branch" }` | `main-branch` | Tenant configuration, staff management, P&L reporting |
| **Store Administrator** | `admin.retail@apexretail.local` | `TestPassword123!` | `{ primaryOrganizationId: "<org1_id>", primaryBranchId: "main-branch" }` | `main-branch` | Catalog management, purchase inflows, quotation finalization, stock write-offs |

#### Operational History in Business 1:
1. **Catalog**: `Organic Farm Milk 1L` created with barcode locks (`sellingPrice: Rs 65`, initial `costPrice: Rs 48`, starting stock 0).
2. **Parties**: Vendor `Nandini Dairy Producers Ltd` and Customer `Mrs. Shanti Sharma` created.
3. **Inward Purchase 1**: 100 liters @ Rs 48 recorded against Nandini Dairy (`paidAmount: Rs 3,000`, vendor balance Rs 1,800). Initial WAC = Rs 48.00.
4. **Vendorless Expense**: Monthly store electricity power utility (Rs 1,200 to BESCOM City Power) recorded without vendor association; physical stock unaffected.
5. **Inward Purchase 2 (WAC Test)**: 50 liters @ Rs 60 recorded against Nandini Dairy (`paidAmount: Rs 3,000`). Dynamic Perpetual WAC smoothly recomputed to:
   $$\text{New WAC} = \frac{(100 \times 48) + (50 \times 60)}{150} = \frac{7800}{150} = \mathbf{Rs\ 52.0000}$$
6. **Quotation to Invoice**: POS quotation created for 10 units @ Rs 65 (stock remains 150). Finalized via `billsFinalize` to `INV-2026-000001` (stock decrements to 140, customer balance increases to Rs 650). Sequential duplicate finalization rejected with `FAILED_PRECONDITION`.
7. **Customer Partial Payment**: Mrs. Shanti Sharma tenders Rs 400 cash against invoice (`PAY-2026-000004`), reducing outstanding balance to Rs 250.
8. **Damage Adjustment**: 2 units written off due to carton leakage (`stockAdjust -2`), reducing physical inventory to 138 units.
9. **Sales Return (Restocked)**: Attempted excess return of 15 units rejected with `INVALID_ARGUMENT`. Valid return of 1 unit restocked to inventory (`RET-2026-000001`), reducing customer debt to Rs 185 and restoring stock to **139 units**.
10. **Vendor Partial Payment**: Rs 1,000 paid to Nandini Dairy via bank transfer, reducing payable balance to Rs 800.
11. **P&L & Valuation Alignment**: Profit & Loss and Stock Valuation reports match the independent GAAP Accounting Oracle with 0 discrepancies.

---

### Business 2: Apex Wholesale Supplies (Multi-Branch / Growth Plan)
A wholesale distributor operating under `plan_growth` (hard branch limit = 3). Demonstrates multi-branch staff assignment, branch context switching, branch-isolated physical inventory, and cross-branch sales reporting.

| Persona / Role | Email Address | Default Password | Trusted Custom Claims | Assigned Branches | Purpose |
|---|---|---|---|---|---|
| **Wholesale Owner** | `owner.wholesale@apexwholesale.local` | `TestPassword123!` | `{ primaryOrganizationId: "<org2_id>", primaryBranchId: "main-branch" }` | `main-branch`, `WH01` | Multi-branch tenant controls, branch creation, consolidated analytics |
| **Dual-Branch Manager** | `manager.wholesale@apexwholesale.local` | `TestPassword123!` | `{ primaryOrganizationId: "<org2_id>", primaryBranchId: "main-branch" }` | `main-branch`, `WH01` | Swapping operating branch context, managing stock at both locations |
| **Single-Branch Cashier** | `cashier.wholesale@apexwholesale.local`| `TestPassword123!` | `{ primaryOrganizationId: "<org2_id>", primaryBranchId: "main-branch" }` | `main-branch` only | POS/B2B invoicing at Main Depot; unauthorized to operate at WH01 |

#### Operational History in Business 2:
1. **Branch Hierarchy**: Default branch `MAIN` (Main Depot) plus second branch `WH01` (`Central Warehouse Hub`) created under `organizations/{org2_id}/branches/{branchId}`.
2. **Staff Assignments**: Cashier assigned strictly to `main-branch`; Manager assigned to both `main-branch` and `WH01` via `membershipBranches`.
3. **Branch-Scoped Stock Intake**: Product `Royal Basmati Rice 25kg` created across catalog. Inward purchase of 100 bags @ Rs 1,500 recorded at `main-branch` and 200 bags @ Rs 1,400 recorded at `WH01`. Physical balances strictly isolated: 100 bags at Main, 200 bags at WH01 (Total Org Stock = 300 bags).
4. **Party Visibility Scopes**: Global Customer `Metro Hypermarkets India` (`visibilityScope: "all_branches"`) and Local Customer `Depot Corner Store` (`visibilityScope: "branch_only"` restricted to Main Depot) created.
5. **Context Switching**: Manager successfully invokes `branchContextSwitch` to set operating pointer to `WH01`. Cashier attempt to switch to `WH01` is rejected with `permission-denied`.
6. **Cross-Branch Sales**: 20 bags invoiced at Main Depot (remaining stock: 80 bags) and 50 bags invoiced at Central Warehouse (remaining stock: 150 bags). Total remaining organization stock: **230 bags**.
7. **Consolidated Valuation**: Valuation at Main Depot (Rs 114,666.66) + Valuation at WH01 (Rs 215,000.00) equals Org-scoped Valuation (Rs 329,666.66).
8. **Branch Limit Quota Boundary**: 3rd branch (`EAST`) successfully created reaching plan quota (3). Attempt to create 4th branch (`WEST`) rejected with `FAILED_PRECONDITION`. Deactivating branch 3 reduces active count to 2; reactivating it restores count to 3.
9. **Cross-Tenant Security**: Tenant 1 Admin attempts to read Tenant 2 products or generate bills in Tenant 2 are rejected with `permission-denied`.

---

## 5. Seed Reset & Database Cleanup

### Resetting Seed-Owned Fixtures (`--reset-seed-data`)
To delete only the seeded test fixtures while keeping the emulator running:
```powershell
node functions/lib/scripts/seed-emulator.js --reset-seed-data
```

### Full Clean Emulator Reset
To wipe all emulator state and start completely fresh:
1. Stop the emulator in Terminal 1 (`Ctrl+C`).
2. Start the emulator without importing prior snapshots:
   ```powershell
   firebase emulators:start --project trado-x
   ```
3. Re-run the seed script in Terminal 2.

---

## 6. Related Resources

- 📱 [Flutter Web Client Integration Guide](flutter-client-integration.md)
- 📖 [Manual API Testing Guide (API Explorer Walkthrough)](manual-api-testing-guide.md)
- 📜 [Canonical API Reference](api-reference.md)
- 🏗️ [Architecture Specification](architecture.md)

