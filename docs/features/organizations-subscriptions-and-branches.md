# Feature Guide: Organizations, Subscriptions & Branches

---

## 1. Purpose & Scope
This module provides tenant lifecycle management, multi-branch location hierarchy, and subscription capacity enforcement for Trado:
- **Organization**: The primary tenant boundary (`organizations/{orgId}`). All business transactions, staff, and configuration belong to an organization.
- **Branch**: Operating physical location subcollection (`organizations/{orgId}/branches/{branchId}`). Every organization contains at least one default branch (`main-branch`).
- **Subscription Plan**: Authoritative tier entitlements (`subscriptionPlans/{planId}`) defining active module flags, user limits, and branch capacity limits (`branchLimit`).

---

## 2. Actors & Permission Requirements
- **Platform Super Admin** (`isSuperAdmin: true`): Authorizes tenant provisioning (`organizationsCreate`), global listing (`organizationsList`), and plan catalog management (`plansCreate`, `plansUpdate`).
- **Organization Owner** (`role_owner`): Controls organization profile settings (`organizationsUpdate`), creates operating branches (`branchesCreate`), updates branch settings (`branchesUpdate`), deactivates secondary branches (`branchesDeactivate`), and configures branch sharing policies (`sharingPoliciesUpdate`).
- **Tenant Administrator** (`role_admin`): Can view branches and switch active branch context (`branchContextSwitch`). Cannot exceed subscription limits or modify structural organization settings.
- **Standard Employees** (`role_employee`): Can read branch metadata for their assigned branches and switch operating context among their assigned branches.

---

## 3. Supported Organizational Topologies & Scenarios

### Scenario 1: Single Owner / Sole Proprietor
- 1 Organization, 1 Default Branch (`main-branch`).
- The Owner holds `role_owner` and operates as cashier, manager, and administrator without additional staff.

### Scenario 2: Owner + General Store Administrator
- 1 Organization, 1 Branch (`main-branch`).
- Owner provisions an Admin (`role_admin`). Admin manages daily sales, catalog, and inventory. Owner retains exclusive control over subscription upgrades and structural organization profile.

### Scenario 3: Owner + Department Admins
- 1 Organization, 1 Branch.
- Admin A (Finance/Billing) has billing permissions enabled and inventory management denied via membership overrides.
- Admin B (Warehouse) has inventory management enabled and billing access restricted.

### Scenario 4: Multi-Branch Wholesale Distributor (Main Branch + 2 Depots)
- 1 Organization, 3 Branches (`main-branch`, `branch-north`, `branch-south`).
- Subscription plan allows 3+ branches.
- Inventory is tracked per-branch (`stockBalances`). Customers may be shared across branches or restricted to a specific branch.

### Scenario 5: Multi-Organization User (Consultant / Multi-Business Owner)
- User UID `user_consultant` has an active membership in Organization A (`role_owner`) and an active membership in Organization B (`role_admin`).
- Active tenant context is routed via `request.auth.token.primaryOrganizationId` and `request.auth.token.primaryBranchId`. Operating in Org A never leaks or affects Org B data.

### Scenario 6: Inactive / Suspended Tenant or Branch
- When an Organization is deactivated (`status: "inactive"`), all member requests fail immediately with `failed-precondition`.
- When a secondary branch is deactivated, existing transactions remain for audit, but new sales or inward stock attempts on that branch fail with `failed-precondition`.

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Provisioning a New Tenant Organization
1. **Super Admin calls `organizationsCreate`**:
   - Passes tenant details (`name`, `legalName`, `taxIdentifier`, `currency`, `planId`, `ownerEmail`, `ownerFullName`).
2. **Backend Execution**:
   - Provisions Firebase Auth user for owner if not existing.
   - Atomically commits:
     - `organizations/{orgId}`
     - `organizations/{orgId}/branches/main-branch` (isDefault: true)
     - `memberships/{ownerUid}_{orgId}` (`roleId: "role_owner"`, `assignedBranchIds: ["main-branch"]`)
     - `membershipBranches/{membershipId}_main-branch`
     - Sets custom claims `primaryOrganizationId = orgId` and `primaryBranchId = "main-branch"`.

### 4.2 Creating an Additional Branch
1. **Owner calls `branchesCreate`**:
   - Passes `{ organizationId, name: "Kochi Warehouse", branchCode: "KCH-01", address: { ... } }`.
2. **Backend Capacity & Uniqueness Check**:
   - Reads active `subscriptionPlans/{planId}`: checks `branchLimit`.
   - Reads `organizations/{orgId}.branchCount`: if `branchCount >= branchLimit`, throws `failed-precondition: "Branch limit exceeded"`.
   - Acquires concurrency lock `branchCodeLocks/{orgId}_KCH-01`. If document exists, throws `already-exists: "Branch code already in use"`.
3. **Atomic Commit**:
   - Writes `organizations/{orgId}/branches/{branchId}`.
   - Increments `organizations/{orgId}.branchCount`.
   - Assigns Owner to new branch in `membershipBranches`.

### 4.3 Switching Operating Branch Context
1. **Staff member calls `branchContextSwitch`**:
   - Passes `{ organizationId, branchId: "KCH-01" }`.
2. **Backend Validation**:
   - Verifies target branch exists and is active.
   - Verifies caller has an active record in `membershipBranches` for `KCH-01` (or is Org Owner).
3. **Claim Update**:
   - Updates caller's Auth Custom Claim `primaryBranchId = "KCH-01"`.
   - Returns refreshed branch metadata and context.

---

## 5. Alternate & Error Paths
- **Duplicate Branch Code**: Attempting to create a branch with code `MAIN` when `MAIN` exists fails atomically via `branchCodeLocks`.
- **Exceeding Branch Capacity**: Adding a second branch under `plan_standard` (limit: 1) rejects with `failed-precondition`. Upgrading plan or purchasing branch addon unlocks capacity.
- **Deactivating Default Branch**: Calling `branchesDeactivate` on `main-branch` throws `invalid-argument: "Default branch main-branch cannot be deactivated"`.
- **Unauthorized Branch Switch**: An employee assigned only to `main-branch` attempting to switch to `KCH-01` receives `permission-denied`.

---

## 6. Request Context & Header Conventions
- Clients do not need to send hardcoded branch IDs for standard operations; `resolveRequestContext` defaults to `request.auth.token.primaryBranchId`.
- Super Admin operations may pass explicit `organizationId` to target a tenant.

---

## 7. Data Storage & Side Effects
- **Primary Tenant**: `organizations/{orgId}`
- **Branches**: Subcollection `organizations/{orgId}/branches/{branchId}`
- **Uniqueness Locks**: `branchCodeLocks/{orgId}_{code}`
- **Staff Join**: `membershipBranches/{membershipId}_{branchId}`
- **Counters**: `organizations/{orgId}.branchCount`

---

## 8. Local Testing & Verification
- **Test File**: `functions/scripts/test-branch-deep-e2e.js`
- **Command**:
  ```powershell
  $env:Path = "C:\Users\jesil.p\node\node-v24.16.0-win-x64;$env:Path"
  node functions/scripts/test-branch-deep-e2e.js
  ```
- **Assertions Verified**:
  - Scenarios 1–3 verify multi-tenant isolation, branch creation, default branch protection, and branch context switching.
  - Unit test `functions/src/test/unit/branchLimitEnforcement.test.ts` validates plan capacity rules.

