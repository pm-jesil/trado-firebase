# Workflow Runbook: Customers, Vendors & Branch Sharing Policies

---

## 1. Overview & Business Context
This runbook guides operators through customer and vendor onboarding, configuring multi-branch sharing policies, updating visibility scopes, and auditing party ledger balances:
- Three visibility scopes: `all_branches`, `selected_branches`, and `branch_only`.
- Strict validation that shared branch IDs exist within the tenant organization.
- Dynamic expanding or revoking of branch sharing.
- Double-entry customer credit ledgers and vendor payable ledgers.
- Running `reconcilePartyLedgers` to audit mathematical integrity.

---

## 2. Actors & Permissions
- **Sales / Credit Manager**: Requires `customer:create` and `customer:write`. Can onboard customers and assign credit limits.
- **Purchasing / Accounts Payable Manager**: Requires `vendor:create` and `vendor:write`. Can onboard suppliers.
- **Store Cashiers**: Requires `customer:read` or `vendor:read`. Can view parties permitted within their active branch scope.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Onboarding a Customer with Selected Branch Sharing
1. **Manager calls `customersCreate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "branchId": "main-branch",
         "name": "Emerald Retailers",
         "phone": "+919876543215",
         "creditLimit": 75000,
         "visibilityScope": "selected_branches",
         "sharedForBranchIds": ["main-branch", "branch-south"]
       }
     }
     ```
2. **Backend Processing**:
   - Validates that `main-branch` and `branch-south` are active branches in `org_kochi_001`.
   - Generates sequential customer code (`CUST-000001`).
   - Commits `customers/{customerId}` with `outstandingBalance: 0`.

### 3.2 Updating Sharing Scope to All Branches
When the customer expands operations across all company locations:
1. **Manager calls `customersUpdate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "customerId": "cust_emerald_001",
         "visibilityScope": "all_branches"
       }
     }
     ```
2. **Backend Processing**:
   - Updates `customers/cust_emerald_001`: `visibilityScope: "all_branches"`.
   - Cashiers at every existing and future branch can now search and bill this customer.

### 3.3 Revoking Branch Access (Restricting to Originating Branch)
1. **Manager calls `customersUpdate`**:
   - Payload:
     ```json
     {
       "data": {
         "organizationId": "org_kochi_001",
         "customerId": "cust_emerald_001",
         "visibilityScope": "branch_only"
       }
     }
     ```
2. **State Outcome**:
   - The customer is now visible ONLY to cashiers operating at `main-branch`.
   - Cashiers at `branch-south` receive empty search results when querying this customer.

### 3.4 Reconciling Party Ledgers (`reconcilePartyLedgers`)
1. **Auditor calls `reconcilePartyLedgers`**:
   - Payload: `{ "data": { "organizationId": "org_kochi_001", "partyType": "customer" } }`.
2. **Backend Audit Engine**:
   - Iterates all customers in `org_kochi_001`.
   - For each customer, computes:
     $$\text{Calculated Balance} = \sum \text{invoice\_debit} - \sum (\text{payment\_credit} + \text{return\_credit})$$
   - Compares calculated balance against `customers.outstandingBalance`.
   - Returns audit summary reporting 0 discrepancies.

---

## 4. Alternate Scenarios & Validation Safeguards

| Scenario | Trigger | Outcome | Reason |
|---|---|:---:|---|
| **Foreign Branch Injection** | `sharedForBranchIds` contains a branch ID from Org B | Rejected with `invalid-argument` | Backend verifies all shared branch IDs belong to the caller's organization. |
| **Missing Target Branches** | `visibilityScope: "selected_branches"` with empty `sharedForBranchIds` | Rejected with `invalid-argument` | Selected branches scope requires at least one active branch ID. |
| **Exceeding Credit Limit** | Invoicing customer whose balance would exceed `creditLimit` | Rejected with `failed-precondition` | Bill finalization checks `customer.outstandingBalance + billTotal <= creditLimit`. |

---

## 5. Local Testing & Verification
- **Integration Tests**: Scenarios 4–7 of `functions/scripts/test-branch-deep-e2e.js`.
- **Unit Tests**: `functions/src/test/unit/branchValidationAndSharing.test.ts`.

