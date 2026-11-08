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

- **Organization Owner (`role_org_owner`)**: Can provision any staff role, customize permissions, assign branches, and deactivate employees.
- **Organization Administrator (`role_admin`)**: Can provision standard employees (`role_employee`) and assign them to existing branches. Cannot provision Owners or peer Admins.
- **Standard Employees (`role_employee`)**: Can view their assigned branches and switch their operating context among authorized branches.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Provisioning an Operations Administrator
1. **Owner calls `employeesCreate`**:
   - **Endpoint**: `POST /employeesCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "email": "admin@kochispice.local",
         "name": "Ananya Sharma",
         "phone": "+919876543211",
         "roleId": "role_admin",
         "branchIds": ["main-branch"],
         "idempotencyKey": "emp_create_lease_001"
       }
     }
     ```
2. **Backend Processing**:
   - Verifies plan seat limits (`activeEmployeeCount < seatCapacity`).
   - Provisions Auth account if not existing.
   - Creates `memberships/{uid}_{orgId}` with `roleId: "role_admin"`.
   - Creates join record `membershipBranches/{membershipId}_main-branch`.
   - Increments `organizations/{orgId}.activeEmployeeCount` (+1).
   - Sets custom claim `primaryOrganizationId = org_kochi_001`.

### 3.2 Provisioning Cashiers across Multiple Branches
1. **Admin calls `employeesCreate`**:
   - **Endpoint**: `POST /employeesCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "email": "cashier1@kochispice.local",
         "name": "Rohan Das",
         "phone": "+919876543212",
         "roleId": "role_cashier",
         "branchIds": ["main-branch", "branch-south"],
         "defaultBranchId": "main-branch",
         "idempotencyKey": "emp_create_lease_002"
       }
     }
     ```
2. **Backend Execution**:
   - Validates that caller is authorized to provision employees.
   - Validates that `main-branch` and `branch-south` exist in `org_kochi_001`.
   - Creates membership record in `memberships`.
   - Creates two records in `membershipBranches`:
     - `membershipBranches/{membershipId}_main-branch` (`isDefaultForMembership: true`)
     - `membershipBranches/{membershipId}_branch-south` (`isDefaultForMembership: false`)

### 3.3 Switching Operating Branch Context (`branchContextSwitch`)
When Rohan reports for duty at the South Branch:
1. **Rohan's client calls `branchContextSwitch`**:
   - **Endpoint**: `POST /branchContextSwitch`
   - **Request Payload**:
     ```json
     {
       "data": {
         "targetBranchId": "branch-south"
       }
     }
     ```
2. **Backend Validation**:
   - Reads `membershipBranches/{membershipId}_branch-south` and verifies `status === "active"`.
   - Updates caller's Auth token claim `primaryBranchId = "branch-south"`.
   - Returns refreshed context with active branch metadata.

### 3.4 Deactivating an Employee (`employeesDeactivate`)
1. **Owner calls `employeesDeactivate`**:
   - **Endpoint**: `POST /employeesDeactivate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "membershipId": "usr_rohan_org_kochi_001",
         "reason": "Resigned from company"
       }
     }
     ```
2. **Backend Execution**:
   - Updates `memberships/usr_rohan_org_kochi_001`: `status = "inactive"`.
   - Decrements `organizations/{orgId}.activeEmployeeCount` (-1).
   - Subsequent API requests by Rohan to `org_kochi_001` fail with `failed-precondition: "User membership is inactive"`.
   - Rohan's global user account in Firebase Auth remains intact for other organizations.

---

## 4. Verification Checkpoints

1. **Verify Seat Capacity**:
   Assert that `activeEmployeeCount` matches the exact number of active non-owner memberships.
2. **Verify Cross-Branch Denial**:
   Attempting to call `branchContextSwitch` with a branch ID the employee is not assigned to returns `permission-denied`.
3. **Verify Anti-Escalation**:
   Attempting to provision an Owner or Admin using an Administrator account returns `permission-denied`.
