# Feature Guide: Users, Memberships & Permissions

---

## 1. Purpose & Scope
This module provides identity management, tenant membership, and the Four-Layer Role-Based Access Control (RBAC) engine for Trado:
- **Global User Profile**: `users/{userId}` tracks authentication identity, contact details, system flags (`isSuperAdmin`), and active default tenant context.
- **Tenant Membership**: `memberships/{userId}_{orgId}` bridges a global user to a specific tenant organization, defining their base role (`roleId`), assigned branches (`assignedBranchIds`), and fine-grained capability overrides.
- **Four-Layer Permission Resolver**: Evaluates whether a requested action is permitted based on subscription plan flags, tenant module toggles, base role permissions, and individual membership overrides with strict deny precedence.

---

## 2. Actors & Permissions
- **Platform Super Admin**: Has unrestricted platform access (`platform:*`) and bypasses tenant RBAC when managing tenants.
- **Organization Owner** (`role_owner`): Can provision employees (`employee:create`), update roles (`role:write`), customize member permissions (`employee:update`), and deactivate staff. Owners have access to all capabilities within active tenant modules.
- **Tenant Administrator** (`role_admin`): Can provision standard employees (`role_employee`). Cannot provision an Owner, cannot provision peer Admins, and cannot create or modify custom roles.
- **Standard Employees** (`role_employee`): Limited to operational capabilities granted by their role and branch assignment.

---

## 3. The Four-Layer RBAC Architecture

When an authenticated user invokes a protected callable, `resolveRequestContext` evaluates permissions in four layers:

```
+-----------------------------------------------------------+
| Layer 1: Subscription Plan moduleFlags                    |
| (If module is false in Plan -> DENIED immediately)        |
+-----------------------------+-----------------------------+
                              |
+-----------------------------v-----------------------------+
| Layer 2: Organization moduleToggles & Branch Overrides     |
| (If module is false in Org or Branch -> DENIED)           |
+-----------------------------+-----------------------------+
                              |
+-----------------------------v-----------------------------+
| Layer 4: Membership Overrides (STRICT DENY FIRST)          |
| (If permission code or prefix:* is FALSE -> DENIED)       |
| (If permission code is TRUE -> GRANTED immediately)       |
+-----------------------------+-----------------------------+
                              |
+-----------------------------v-----------------------------+
| Org Owner Bypass: All capabilities in active modules      |
+-----------------------------+-----------------------------+
                              |
+-----------------------------v-----------------------------+
| Layer 3: Base Role Permissions & Wildcards                |
| (Check rolePermissions for exact code, *, or prefix:*)    |
+-----------------------------------------------------------+
```

### Precedence Rules
1. **Super Admin Bypass**: `isSuperAdmin === true` bypasses tenant evaluation.
2. **Module Gating**: If the parent module (e.g. `billing`, `inventory`, `reports`) is disabled in Plan or Org, no role or override can enable it.
3. **Explicit Deny Takes Precedence**: If a membership override sets `"bill:discount": false`, the user is denied even if their base role has `bill:*` or `*`.
4. **Wildcard Support**:
   - Deny wildcard: `"report:*": false` in membership overrides blocks all reporting capabilities.
   - Grant wildcard: `"bill:*"` in base role grants `bill:create`, `bill:finalize`, `bill:read`, etc.

---

## 4. Supported Staff Topologies & Workflows

### 4.1 Owner Provisions a New Cashier / Staff Member
1. **Owner calls `employeesCreate`**:
   - Payload: `{ organizationId, email, phone, fullName, roleId: "role_employee", branchIds: ["main-branch"] }`.
2. **Backend Processing**:
   - Creates or finds Firebase Auth user by email/phone.
   - Commits `memberships/{uid}_{orgId}`.
   - Commits join records in `membershipBranches`.
   - Sends onboarding invitation / sets initial password credentials.

### 4.2 Restricting Cashier Capabilities via Overrides
1. **Owner calls `employeesUpdate`**:
   - Payload: `{ organizationId, membershipId, permissions: { "bill:delete": false, "bill:discount": false } }`.
2. **Backend Processing**:
   - Merges overrides into `memberships/{membershipId}.permissions`.
   - Next API request immediately enforces the restriction without requiring token re-issuance.

### 4.3 Multi-Tenant Membership & Deactivation
- A user can belong to Organization 1 (as Owner) and Organization 2 (as Employee).
- If Org 2 deactivates the user via `employeesDeactivate`:
  - `memberships/{uid}_org2.status` becomes `"inactive"`.
  - The backend verifies if active memberships remain in other organizations.
  - Since Org 1 membership is active, the global `users/{uid}.isActive` remains `true`.
  - The user can still log in and operate within Org 1, but calls to Org 2 are rejected.

### 4.4 Unified Authentication API (`authLogin`)

To streamline client initialization (especially for web and mobile clients), Trado provides a single unified HTTPS callable: **`authLogin`**. This endpoint serves all user types across the entire system.

1. **Request Body**:
   - Strictly requires `email` and `password`.
   - Optionally accepts `deviceId` (string) for session tracking under `users/{uid}/devices/{deviceId}`.
   ```json
   {
     "data": {
       "email": "owner@apexwholesale.local",
       "password": "TestPassword123!",
       "deviceId": "device_pixel_01"
     }
   }
   ```

2. **Unified Response Model**:
   - Returns authentication tokens (`accessToken`, `refreshToken`, `expiresIn`).
   - Returns user profile (`uid`, `email`, `name`, `phone`, `avatarUrl`, `accountType`, `isActive`, `isSuperAdmin`).
   - Returns base role (`roleId`, `roleName`, `roleCode`).
   - Returns assigned job roles (`Array<{ jobRoleId, name, code }>`).
   - Returns fully evaluated 4-layer permissions array (`string[]`).
   - Returns tenant organizations list (`Array<{ organizationId, name, roleId, roleName, isPrimary }>`) and `primaryOrganization`.
   - Returns assigned branches list (`Array<{ branchId, name, code, isDefault }>`) and `primaryBranch`.

3. **Super Admin Architectural Invariant**:
   - Platform Super Admins exist globally above all tenant organizations and branches.
   - For a Super Admin user, `authLogin` returns:
     * `profile.isSuperAdmin = true`
     * `role = { roleId: null, roleName: "Platform Super Admin", roleCode: "super_admin" }`
     * `jobRoles = []`
     * `permissions = ["*"]`
     * `organizations = []`
     * `primaryOrganization = null`
     * `branches = []`
     * `primaryBranch = null`

---

## 5. Security & Invariant Rules
- **Anti-Escalation**: Admins cannot assign `role_owner` or `role_admin`. Admins cannot modify their own permissions.
- **Token Claims Refresh**: Claims are cached in JWTs. `resolveRequestContext` performs live Firestore checks on `memberships` status for every mutation. Revoking access takes effect instantly.
- **Auditing**: Employee creation, permission overrides, and deactivations write audit log entries to `auditLogs`.

---

## 6. Local Testing & Verification
- **Unit Tests**: `functions/src/test/unit/permissionResolver.test.ts` (16 unit tests covering all 4 layers, wildcards, and deny precedence).
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify unauthenticated 401, non-admin 403, Owner provisioning Admin, Admin escalation rejection, cross-tenant provisioning denial, and multi-tenant deactivation safety.

