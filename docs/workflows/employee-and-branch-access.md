# Workflow Runbook: Employee Provisioning & Branch Access Management

---

## 1. Overview & Business Context
This runbook covers staff administration, role assignment, multi-branch access management, context switching, and safe employee offboarding for Trado:
- Provisioning Store Admins and standard employees.
- Assigning employees to one or more physical branches.
- Switching active operating branch context via `branchContextSwitch`.
- Enforcing privilege escalation boundaries.
- Deactivating memberships safely without affecting a user's memberships in other organizations.

---

## 2. Actors & Permissions
- **Organization Owner** (`role_owner`): Can provision any staff role, customize permissions, assign branches, and deactivate employees.
- **Organization Administrator** (`role_admin`): Can provision standard employees (`role_employee`) and assign them to existing branches. Cannot provision Owners or peer Admins.
- **Standard Employees** (`role_employee`): Can view their assigned branches and switch their operating context among authorized branches.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Provisioning a Store Administrator
1. **Owner calls `employeesCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "email": "admin@kochispice.local",
         "phone": "+919876543211",
         "fullName": "Ananya Sharma",
         "roleId": "role_admin",
         "branchIds": ["main-branch"]
       }
     }
     ```
2. **Backend Processing**:
   - Provisions Auth account if not existing.
   - Creates `memberships/{uid}_{orgId}` with `roleId: "role_admin"`.
   - Creates join record `membershipBranches/{membershipId}_main-branch`.
   - Sets custom claim `primaryOrganizationId = org_kochi_001`.

### 3.2 Provisioning Cashiers across Multiple Branches
1. **Admin calls `employeesCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "email": "cashier1@kochispice.local",
         "phone": "+919876543212",
         "fullName": "Rohan Das",
         "roleId": "role_employee",
         "branchIds": ["main-branch", "branch-south"]
       }
     }
     ```
2. **Backend Execution**:
   - Validates that caller is authorized to provision employees.
   - Validates that `main-branch` and `branch-south` exist in `org_kochi_001`.
   - Creates membership with `assignedBranchIds: ["main-branch", "branch-south"]`.
   - Creates two records in `membershipBranches`:
     - `membershipBranches/{membershipId}_main-branch`
     - `membershipBranches/{membershipId}_branch-south`

### 3.3 Switching Operating Branch Context (`branchContextSwitch`)
When Rohan reports for duty at the South Branch:
1. **Rohan's client calls `branchContextSwitch`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "branch-south"
       }
     }
     ```
2. **Backend Validation**:
   - Checks `membershipBranches/{membershipId}_branch-south`: status must be `"active"`.
   - Updates Rohan's Auth Custom Claim: `primaryBranchId = "branch-south"`.
   - Future POS sales, stock lookups, and cash drawer pings automatically scope to `branch-south`.

### 3.4 Revoking Branch Access or Offboarding an Employee
1. **Manager calls `employeesUpdate`**:
   - Payload: `{ organizationId, membershipId, branchIds: ["main-branch"] }`.
   - Backend updates `assignedBranchIds` and deactivates the `branch-south` record in `membershipBranches`.
2. **Manager calls `employeesDeactivate`**:
   - Payload: `{ organizationId, membershipId }`.
   - Backend sets `memberships/{membershipId}.status = "inactive"`.
   - Subsequent calls from this employee fail immediately with `permission-denied`.
   - **Multi-Tenant Protection**: If this user belongs to another organization (e.g. Org B), their global `users/{uid}.isActive` remains `true`, and they continue working in Org B undisturbed.

---

## 4. Failure & Escalation Safeguards

| Attempted Action | Calling Actor | Result | Error Code | Reason |
|---|---|:---:|:---:|---|
| **Admin Provisions Owner** | `role_admin` | Rejected | `permission-denied` | Admin cannot escalate privileges to Owner. |
| **Admin Provisions Peer Admin** | `role_admin` | Rejected | `permission-denied` | Admin cannot provision another Admin. |
| **Switch to Unassigned Branch** | Employee assigned to `main-branch` | Rejected | `permission-denied` | Target branch is not in user's `assignedBranchIds`. |
| **Cross-Tenant Staff Creation** | Admin in Org A | Rejected | `permission-denied` | Cannot create employees in Org B. |

---

## 5. Local Testing & Verification
- **Test File**: `functions/scripts/test-callables-integration.js`
  - Tests verify Admin provisioning, escalation guards, and multi-tenant deactivation safety.
- **Branch Deep E2E**: Scenario 2 in `functions/scripts/test-branch-deep-e2e.js`.

