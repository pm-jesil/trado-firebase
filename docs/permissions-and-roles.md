# Trado Permissions, Roles & Privilege Matrix

> **Canonical Authority**: `functions/src/services/permissionResolver.ts`, `functions/src/services/contextResolver.ts`, `functions/src/constants/permissions.ts`  
> **Status**: Exhaustive Role-Based Access Control (RBAC) Specification  
> **Date**: October 29, 2026

---

## 1. System Role Hierarchy & Privilege Tiers

Trado enforces a four-tier role architecture to maintain strict administrative separation:

```
+-------------------------------------------------------------+
| TIER 0: Platform Super Admin (Global Scope)                 |
| Custom Claim: isSuperAdmin === true                         |
| Scope: Across all tenants and platform-level infrastructure |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| TIER 1: Organization Owner (Tenant Scope)                   |
| Role Code: role_owner                                       |
| Scope: All capabilities within active tenant modules        |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| TIER 2: Organization Administrator (Tenant Scope)           |
| Role Code: role_admin                                       |
| Scope: Day-to-day administrative & operational management   |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| TIER 3: Operational Staff & Custom Roles (Branch Scope)     |
| Role Code: role_employee / custom tenant roles              |
| Scope: Operational workflows (cashier, inventory, delivery) |
+-------------------------------------------------------------+
```

### Role Tiers Defined
1. **Platform Super Admin (Tier 0)**:
   - Authenticated user with trusted custom claim `{ isSuperAdmin: true }` and `contextStatus: "platform"`.
   - Strictly isolated from tenant operations: `organizations: []`, `primaryOrganization: null`, `branches: []`, `primaryBranch: null`, and `permissions: []` (zero tenant permissions).
   - Holds platform-only capabilities in `platformPermissions: ["platform:*"]` for platform administration (`organizationsCreate`, `plansCreate`, `usageGetPlatformSummary`, etc.).
   - Super Admin cannot bypass tenant permissions or invoke operational callables without an explicit target tenant and membership.
2. **Organization Owner (Tier 1)**:
   - The creator and legal master of the tenant account (`memberships.roleId == "role_owner"`).
   - Implicitly granted **all capabilities** across any active module in the organization.
   - Holds exclusive authority to create custom roles (`rolesCreate`), modify structural organization profile (`organizationsUpdate`), and manage subscriptions.
   - Holds tenant-wide branch access by default across all current and future branches.
3. **Organization Administrator (Tier 2)**:
   - High-privilege staff member (`memberships.roleId == "role_admin"`).
   - Can manage day-to-day business operations, catalog, parties, and staff.
   - **Anti-Escalation Guards**:
     - Cannot provision an Owner or another Admin (`employeesCreate`).
     - Cannot create or edit custom roles (`rolesCreate` / `rolesUpdate`).
     - Cannot modify structural organization settings or deactivate the default branch.
4. **Standard Employee / Staff (Tier 3)**:
   - Base operational staff (`memberships.roleId == "role_employee"`).
   - Capabilities are restricted to their explicit base role permissions and branch assignments.
   - Can only assign operational tasks to themselves.
5. **Custom Tenant Roles**:
   - Tenant-created roles (`roles/{roleId}`) holding a defined array of capability strings.
   - Assigned to memberships via `memberships.roleId = roleId`.

---

## 2. Four-Layer Permission Resolution Engine

Permission checks are resolved dynamically on every protected Cloud Function invocation via `resolvePermission()` in `permissionResolver.ts`:

```
+-------------------------------------------------------------+
| Layer 1: Subscription Plan moduleFlags                      |
| If plan.moduleFlags[module] === false -> DENIED             |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| Layer 2: Organization moduleToggles & Branch Overrides       |
| If org.moduleToggles[module] === false -> DENIED            |
| If branch.moduleOverrides[module] === false -> DENIED       |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| Layer 4: Membership Overrides (STRICT DENY PRECEDENCE)       |
| If branchOverrides[perm] === false -> DENIED                |
| If membershipOverrides[perm] === false -> DENIED            |
| If prefix:* === false -> DENIED                             |
| If branchOverrides[perm] === true -> GRANTED                |
| If membershipOverrides[perm] === true -> GRANTED            |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| Org Owner Bypass: Granted all permissions in active modules |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
| Layer 3: Base Role Permissions & Wildcards                  |
| If rolePermissions contains '*', code, or prefix:* -> GRANTED|
+-------------------------------------------------------------+
```

### Strict Deny Precedence
If an explicit `false` is set on a user's membership (e.g. `permissions: { "bill:discount": false }`), the user is **strictly denied** that action, even if their base role has `bill:*` or `*`.

---

## 3. Comprehensive Privilege Matrix

The following matrix documents effective authorization across canonical resources and actions for each role tier:

| Module / Resource | Permission Code | Super Admin | Org Owner | Org Admin | Standard Employee | Cashier (Template) | Warehouse (Template) |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Platform Management** | `platform:org:create` | **ALLOW** | DENY | DENY | DENY | DENY | DENY |
| | `platform:plan:write` | **ALLOW** | DENY | DENY | DENY | DENY | DENY |
| | `platform:usage:read` | **ALLOW** | DENY | DENY | DENY | DENY | DENY |
| **Organization Master** | `org:read` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** |
| | `org:update` | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY |
| | `org:deactivate` | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY |
| **Branch Management** | `branch:create` | **ALLOW** | **ALLOW** | COND* | DENY | DENY | DENY |
| | `branch:read` | **ALLOW** | **ALLOW** | **ALLOW** | COND** | COND** | COND** |
| | `branch:switch` | **ALLOW** | **ALLOW** | **ALLOW** | COND** | COND** | COND** |
| | `branch:deactivate` | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY |
| **Staff & Memberships** | `employee:create` | **ALLOW** | **ALLOW** | COND***| DENY | DENY | DENY |
| | `employee:update` | **ALLOW** | **ALLOW** | COND***| DENY | DENY | DENY |
| | `employee:deactivate` | **ALLOW** | **ALLOW** | COND***| DENY | DENY | DENY |
| | `role:write` (Custom) | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY |
| **Catalog & Products** | `inventory:product:create`| **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | **ALLOW** |
| | `inventory:product:read` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** |
| | `inventory:product:update`| **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | **ALLOW** |
| | `inventory:stock:adjust` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | **ALLOW** |
| **Parties (CRM)** | `customer:create` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY |
| | `customer:read` | **ALLOW** | **ALLOW** | **ALLOW** | COND****| COND****| COND****|
| | `customer:update` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| | `vendor:create` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | **ALLOW** |
| | `vendor:read` | **ALLOW** | **ALLOW** | **ALLOW** | COND****| DENY | COND****|
| **Sales & Billing** | `bill:create` (POS) | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY |
| | `bill:create:quotation` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY |
| | `bill:finalize` | **ALLOW** | **ALLOW** | **ALLOW** | COND*****| DENY | DENY |
| | `bill:discount` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| | `bill:cancel` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| **Purchases & Outflows**| `purchase:create` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | **ALLOW** |
| | `expense:create` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| **Payments** | `payment:create` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY |
| | `payment:read` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY |
| **Deliveries** | `delivery:create` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY |
| | `delivery:status` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY |
| **Returns** | `return:create` | **ALLOW** | **ALLOW** | **ALLOW** | COND*****| DENY | DENY |
| **Tasks** | `task:create` | **ALLOW** | **ALLOW** | **ALLOW** | COND******| DENY | DENY |
| | `task:assign` (to others)| **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| | `task:status` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** |
| **Location Telemetry** | `location:ping` | DENY | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** |
| | `location:view` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| **Reporting & Export** | `report:view` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| | `report:export` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |
| **Reconciliation** | `reconciliation:run` | **ALLOW** | **ALLOW** | **ALLOW** | DENY | DENY | DENY |

### Condition Explanations
- `COND*`: Admin can create branches only if granted explicit `branch:create` and subscription capacity permits.
- `COND**`: Employee can only read/switch to branches explicitly assigned in `memberships.assignedBranchIds`.
- `COND***`: Admin can only provision or update standard employees (`role_employee`). Cannot provision an Owner or peer Admin.
- `COND****`: Party read access respects `visibilityScope` (`all_branches`, `selected_branches`, `branch_only`).
- `COND*****`: Finalizing quotations or processing returns requires explicit `bill:finalize` or `return:create` capability.
- `COND******`: Standard employees can only assign tasks to **themselves**. Assigning to others requires `task:assign`.

---

## 4. Organizational Graph: Roles vs. Designations

Trado cleanly separates **Permission Roles** from **Organizational Job Designations**:

```
+-------------------------------------------------------------+
| Permission Role (RBAC Security Context)                    |
| Stored: memberships.roleId -> roles/{roleId}               |
| Determines: Exact API and database mutation permissions    |
| Examples: role_owner, role_admin, role_employee, custom    |
+-------------------------------------------------------------+
                               |
                               | (Associated with)
                               v
+-------------------------------------------------------------+
| Organizational Designations (Display & HR Metadata Only)   |
| Stored:                                                     |
| - memberships.departmentId -> departments/{departmentId}   |
| - memberships.jobRoleId -> jobRoles/{jobRoleId}             |
| - memberships.teamId -> teams/{teamId}                      |
| Determines: Team grouping, UI labels, hierarchy charts      |
| Does NOT grant security permissions.                        |
+-------------------------------------------------------------+
```

---

## 5. Specific Authorization Failure Scenarios & Error Codes

| Scenario | Calling State | Attempted Action | Expected Result | Error Code | Reason |
|---|---|---|:---:|---|---|
| **Unauthenticated Request** | `request.auth === null` | Any protected callable | Rejected | `unauthenticated` | Missing Firebase Auth ID token |
| **No Active Membership** | Valid token, no active record in `memberships` | Any tenant callable | Rejected | `permission-denied` | Caller does not belong to target organization |
| **Deactivated User** | Valid token, `membership.status == "inactive"` | Operational callable | Rejected | `permission-denied` | Membership has been deactivated |
| **Unassigned Branch Switch** | Employee assigned to `main-branch` only | `branchContextSwitch("branch-south")` | Rejected | `permission-denied` | Branch not in `assignedBranchIds` |
| **Admin Privilege Escalation** | Admin (`role_admin`) | `employeesCreate(roleId: "role_owner")` | Rejected | `permission-denied` | Admin cannot provision an Owner |
| **Peer Admin Provisioning** | Admin (`role_admin`) | `employeesCreate(roleId: "role_admin")` | Rejected | `permission-denied` | Admin cannot provision another Admin |
| **Custom Role Creation** | Admin (`role_admin`) | `rolesCreate(...)` | Rejected | `permission-denied` | Creating custom roles is Owner-only |
| **Employee Self-Assignment** | Standard employee | `tasksCreate(assignedTo: "other_uid")` | Rejected | `permission-denied` | Employees can only assign tasks to themselves |
| **Cross-Tenant Access** | User in Org A | Query product in Org B | Rejected | `permission-denied` | Cross-tenant data boundary violation |
| **Super Admin Platform Access** | Super Admin (`isSuperAdmin: true`) | `usageGetPlatformSummary()` | **Allowed** | `success` | Super Admin platform authorization |
| **Non-Admin Platform Access** | Org Owner (`role_owner`) | `usageGetPlatformSummary()` | Rejected | `permission-denied` | Platform metrics are Super Admin-only |

---

## 6. Local Testing & Verification
- **Unit Test File**: `functions/src/test/unit/permissionResolver.test.ts` (16 tests verifying all 4 layers, wildcards, and deny precedence).
- **Integration Test File**: `functions/scripts/test-callables-integration.js` (Verifies unauthenticated 401, non-admin 403, Owner provisioning Admin, escalation rejection, and multi-tenant deactivation safety).

