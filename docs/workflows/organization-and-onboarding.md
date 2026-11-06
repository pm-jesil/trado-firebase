# Workflow Runbook: Organization Creation & Onboarding

---

## 1. Overview & Business Context
This runbook guides developers and operators through the end-to-end lifecycle of onboarding a new merchant organization onto Trado:
1. Local Super Admin bootstrap in the Firebase Emulator.
2. Tenant provisioning via `organizationsCreate`.
3. First Organization Owner account creation and credential setup.
4. Automatic default branch (`main-branch`) initialization.
5. First Owner login and session bootstrap via `authMe`.

---

## 2. Preconditions & Actors
- **Actor**: Platform Super Admin (`isSuperAdmin: true`).
- **Preconditions**:
  - Firebase Local Emulator Suite running on ports 9099 (Auth), 5001 (Functions), 8080 (Firestore).
  - Reference catalogs (`modules`, `taxRegimes`, `subscriptionPlans`) seeded.
  - Super Admin authenticated with trusted custom claim `{ isSuperAdmin: true }`.

---

## 3. Step-by-Step Execution Sequence

### Step 1: Bootstrap the Local Super Admin (Emulator Only)
The very first Super Admin cannot be created via normal tenant APIs because those APIs require Super Admin privilege. In the local emulator, execute:
```powershell
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
node functions/lib/scripts/seed-emulator.js --seed-reference-data
```
This provisions:
- Auth user: `superadmin@trado.local`
- Custom Claim: `{ isSuperAdmin: true }`
- Profile document: `users/{superAdminUid}`

### Step 2: Super Admin Provisions New Organization (`organizationsCreate`)
- **API**: `POST /organizationsCreate`
- **Caller**: Super Admin Bearer Token
- **Request Payload**:
  ```json
  {
    "data": {
      "name": "Kochi Spice Exporters",
      "legalName": "Kochi Spice Exporters Pvt Ltd",
      "businessType": "wholesale_retail",
      "businessCategory": "general",
      "country": "IN",
      "currency": "INR",
      "taxRegimeCode": "IN_GST",
      "planId": "plan_standard",
      "ownerEmail": "owner@kochispice.local",
      "ownerFullName": "Vijay Menon",
      "ownerPhone": "+919876543210"
    }
  }
  ```

### Step 3: Backend State Changes & Database Side Effects
The backend executes an atomic batch:
1. **Auth User**: Provisions Firebase Auth user for `owner@kochispice.local`.
2. **Organization**: Creates `organizations/{orgId}`:
   - `status`: `"active"`
   - `planId`: `"plan_standard"`
   - `defaultBranchId`: `"main-branch"`
   - `branchCount`: `1`
   - `branchLimit`: `1` (inherited from plan)
3. **Default Branch**: Creates `organizations/{orgId}/branches/main-branch`:
   - `name`: `"Main Branch"`
   - `branchCode`: `"MAIN"`
   - `isDefault`: `true`
   - `isActive`: `true`
4. **Branch Code Lock**: Creates `branchCodeLocks/{orgId}_MAIN`.
5. **Owner Membership**: Creates `memberships/{ownerUid}_{orgId}`:
   - `roleId`: `"role_owner"`
   - `assignedBranchIds`: `["main-branch"]`
   - `status`: `"active"`
6. **Membership Branch Join**: Creates `membershipBranches/{membershipId}_main-branch`.
7. **Custom Claims**: Sets `{ primaryOrganizationId: orgId, primaryBranchId: "main-branch" }` on the Owner's Auth account.

### Step 4: First Owner Login & Session Bootstrap (`authMe`)
1. Owner signs in via Firebase Auth (`signInWithEmailAndPassword`).
2. Client calls `authMe` to resolve operational context:
   - **Request**: `POST /authMe` (empty body)
   - **Response**:
     ```json
     {
       "result": {
         "userId": "owner_uid_123",
         "email": "owner@kochispice.local",
         "isSuperAdmin": false,
         "activeContext": {
           "organizationId": "org_kochi_001",
           "organizationName": "Kochi Spice Exporters",
           "primaryBranchId": "main-branch",
           "defaultBranchId": "main-branch",
           "branchCount": 1,
           "currency": "INR",
           "taxRegimeCode": "IN_GST",
           "assignedBranches": [
             {
               "id": "main-branch",
               "name": "Main Branch",
               "code": "MAIN",
               "isDefault": true
             }
           ]
         },
         "role": {
           "id": "role_owner",
           "code": "org_owner",
           "name": "Organization Owner"
         },
         "effectivePermissions": ["*"]
       }
     }
     ```

---

## 4. Failure & Alternate Scenarios

| Scenario | Trigger / Payload | Expected Error Code | Behavior |
|---|---|:---:|---|
| **Non-Superadmin Caller** | Standard user calls `organizationsCreate` | `permission-denied` | Rejected; only platform administrators can provision organizations. |
| **Duplicate Owner Email** | Calling `organizationsCreate` with existing user email | Handled safely | Reuses existing Auth user; creates new membership for the new organization. |
| **Invalid Plan Reference** | `planId: "nonexistent_plan"` | `invalid-argument` | Validation rejects unknown plan ID. |
| **Idempotency Replay** | Same `idempotencyKey` submitted twice | `success` | Returns cached organization ID without creating a duplicate tenant. |

---

## 5. Local Testing & Verification
- **Test Script**: Step 1 of `functions/scripts/test-e2e-business-flow.js`
- **Command**:
  ```powershell
  $env:Path = "C:\Users\jesil.p\node\node-v24.16.0-win-x64;$env:Path"
  node functions/scripts/test-e2e-business-flow.js
  ```
- **Firestore State to Inspect**:
  - `http://127.0.0.1:4000/firestore/default/data/organizations`
  - `http://127.0.0.1:4000/firestore/default/data/memberships`

