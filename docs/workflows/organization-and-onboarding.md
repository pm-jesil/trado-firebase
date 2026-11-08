# Workflow Runbook: Organization Creation & Onboarding

---

## 1. Overview & Business Context

This runbook guides developers and operators through the end-to-end lifecycle of onboarding a new merchant organization onto Trado:
1. Local Super Admin bootstrap in the Firebase Emulator.
2. Tenant provisioning via `organizationsCreate`.
3. First Organization Owner account creation and credential setup.
4. Automatic default branch (`main-branch`) initialization.
5. First Owner login and session bootstrap via `authLogin` and `authMe`.

---

## 2. Preconditions & Actors

- **Actor**: Platform Super Admin (`isSuperAdmin: true`).
- **Preconditions**:
  - Firebase Local Emulator Suite running on ports 9099 (Auth), 5001 (Functions), 8080 (Firestore).
  - Reference catalogs (`modules`, `taxRegimes`, `subscriptionPlans`, `roles`, `jobRoles`) seeded.
  - Super Admin authenticated with trusted custom claim `{ isSuperAdmin: true }`.

---

## 3. Step-by-Step Execution Sequence

### Step 1: Bootstrap the Local Super Admin (Emulator Only)
In the local emulator, execute the seeding tool to provision reference catalogs and the Platform Super Admin:
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
      "businessType": "wholesale_retail",
      "businessCategory": "general",
      "country": "IN",
      "currency": "INR",
      "taxRegimeCode": "IN_GST",
      "planId": "plan_starter",
      "ownerEmail": "owner@kochispice.local",
      "ownerName": "Vijay Menon",
      "ownerPhone": "+919876543210",
      "defaultBranchName": "Main Branch",
      "defaultBranchCode": "MAIN",
      "idempotencyKey": "org_provision_uuid_001"
    }
  }
  ```

### Step 3: Backend State Changes & Database Side Effects
The backend executes an atomic multi-document transaction:
1. **Auth User**: Provisions Firebase Auth user for `owner@kochispice.local`.
2. **Organization**: Creates `organizations/{orgId}`:
   - `status`: `"active"`
   - `planId`: `"plan_starter"`
   - `defaultBranchId`: `"main-branch"`
   - `branchCount`: `1`
   - `activeEmployeeCount`: `0`
3. **Default Branch**: Creates `organizations/{orgId}/branches/main-branch`:
   - `name`: `"Main Branch"`
   - `code`: `"MAIN"`
   - `isDefault`: `true`
   - `isActive`: `true`
4. **Branch Code Lock**: Creates `uniqueKeys/{uniqueKeyId(orgId, "branch_code", "MAIN")}`.
5. **Owner Membership**: Creates `memberships/{ownerUid}_{orgId}`:
   - `roleId`: `"role_org_owner"`
   - `status`: `"active"`
   - `isPrimary`: `true`
   - `primaryBranchId`: `"main-branch"`
6. **Membership Branch Join**: Creates `membershipBranches/{membershipId}_main-branch`.
7. **Custom Claims**: Sets `{ primaryOrganizationId: orgId, primaryBranchId: "main-branch" }` on the Owner's Auth account.

### Step 4: First Owner Login (`authLogin`)
The newly provisioned Organization Owner logs in:
- **API**: `POST /authLogin`
- **Payload**:
  ```json
  {
    "data": {
      "email": "owner@kochispice.local",
      "password": "GeneratedOrProvidedPassword123!",
      "deviceId": "dev_pixel7_owner"
    }
  }
  ```
- **Response**: Returns session context (`AuthSessionContext`) with active role `role_org_owner`, primary organization `org_kochi_001`, default branch `main-branch`, and full permission bypass on all active modules (`["*"]`).

---

## 4. Verification Checkpoints

1. **Verify Organization Document**:
   Check `organizations/{orgId}` has `status == "active"` and `activeEmployeeCount == 0`.
2. **Verify Main Branch Document**:
   Check `organizations/{orgId}/branches/main-branch` exists and `isDefault == true`.
3. **Verify Owner Membership**:
   Check `memberships/{ownerUid}_{orgId}` has `roleId == "role_org_owner"`.
4. **Verify Branch Assignment**:
   Check `membershipBranches/{ownerMembershipId}_main-branch` has `status == "active"`.
