# Workflow Runbook: Customers, Vendors & Branch Sharing Policies

---

## 1. Overview & Business Context

This runbook guides operators through customer and vendor onboarding, multi-channel contact configuration, branch sharing policies, visibility scopes, and party ledger reconciliation:
- Three visibility scopes: `all_branches`, `selected_branches`, and `branch_only`.
- Multi-phone support (`additionalPhones` bounded to 5 items) and WhatsApp integration.
- Strict validation that shared branch IDs exist within the tenant organization.
- Dynamic expanding or revoking of branch sharing.
- Double-entry customer credit ledgers and vendor payable ledgers.
- Running `reconcilePartyLedgers` to audit mathematical integrity.

---

## 2. Actors & Permissions

- **Sales / Credit Manager**: Requires `customer:create` and `customer:write`. Can onboard customers, assign credit limits, and set sharing scopes.
- **Purchasing / Accounts Payable Manager**: Requires `vendor:create` and `vendor:write`. Can onboard suppliers.
- **Store Cashiers**: Requires `customer:read` or `vendor:read`. Can view parties permitted within their active branch scope.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Onboarding a Customer with Selected Branch Sharing
1. **Manager calls `customersCreate`**:
   - **Endpoint**: `POST /customersCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "name": "Emerald Retailers",
         "mobile": "+919876543215",
         "additionalPhones": ["+919876543216", "+919876543217"],
         "whatsApp": "+919876543215",
         "creditLimit": 75000.00,
         "creditPeriodDays": 30,
         "visibilityScope": "selected_branches",
         "sharedForBranchIds": ["main-branch", "branch-south"],
         "idempotencyKey": "cust_onboard_lease_001"
       }
     }
     ```
2. **Backend Processing**:
   - Validates that `main-branch` and `branch-south` are active branches in the caller's organization.
   - Claims natural key locks for phone and tax ID in `uniqueKeys`.
   - Generates sequential customer code (`CUST-000001`).
   - Commits `customers/{customerId}` with `outstandingBalance: 0`, `totalSpend: 0`.

### 3.2 Updating Sharing Scope to All Branches
When the customer expands operations across all company locations:
1. **Manager calls `customersUpdate`**:
   - **Endpoint**: `POST /customersUpdate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "customerId": "cust_emerald_001",
         "visibilityScope": "all_branches"
       }
     }
     ```
2. **Backend Processing**:
   - Updates `customers/cust_emerald_001`: `visibilityScope: "all_branches"`.
   - Cashiers at every existing and future branch can now search and bill to this customer.

### 3.3 Reconciling Customer and Vendor Ledgers (`reconcilePartyLedgers`)
1. **Finance Controller calls `reconcilePartyLedgers`**:
   - **Endpoint**: `POST /reconcilePartyLedgers`
   - **Request Payload**:
     ```json
     {
       "data": {}
     }
     ```
2. **Backend Processing**:
   - Sums all entries in `customerLedgers` and compares against `customers.outstandingBalance`.
   - Sums all entries in `vendorLedgers` and compares against `vendors.outstandingPayable`.
   - Returns reconciliation report confirming zero ledger discrepancies.

---

## 4. Verification Checkpoints

1. **Verify Visibility Isolation**:
   A cashier at `branch-north` cannot view or select a customer whose `visibilityScope == "branch_only"` at `main-branch`.
2. **Verify Contact Channel Storage**:
   Verify `additionalPhones` array and `whatsApp` number are stored and returned in `customersGet`.
3. **Verify Ledger Audit**:
   `reconcilePartyLedgers` returns `discrepanciesCount == 0`.
