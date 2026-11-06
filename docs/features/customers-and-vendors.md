# Feature Guide: Customers & Vendors (Parties & Sharing Scopes)

---

## 1. Purpose & Scope
This module manages external business counter-parties (customers and vendors), their multi-branch visibility permissions, credit limits, and financial balance ledgers:
- **Customer Master**: `customers/{customerId}` manages customer profiles, credit limits, and branch sharing scopes.
- **Customer Ledger**: `customerLedgers/{ledgerId}` maintains double-entry records of debits (invoices) and credits (payments, returns).
- **Vendor Master**: `vendors/{vendorId}` manages vendor profiles and branch sharing scopes.
- **Vendor Ledger**: `vendorLedgers/{ledgerId}` maintains records of payables (purchases) and disbursements (vendor payments).

---

## 2. Actors & Permissions
- **Sales & Credit Managers**: Possess `customer:create` and `customer:write`. Can onboard customers, assign credit limits, and configure branch visibility.
- **Purchasing & Accounts Payable Staff**: Possess `vendor:create` and `vendor:write`. Can onboard suppliers and manage vendor profiles.
- **Cashiers & Floor Staff**: Possess `customer:read` and `vendor:read`. Can search and select parties during billing or purchase intake within their active branch scope.

---

## 3. Branch Visibility Scopes & Sharing Policies

To support both centralized and decentralized business models, parties are assigned a `visibilityScope`:

| Visibility Scope | Semantics | Target Audience |
|---|---|---|
| `all_branches` | Accessible across every branch in the tenant organization. | Key corporate accounts, national vendors, or chain-wide customers. |
| `selected_branches` | Explicitly shared with an array of active branches (`sharedForBranchIds`). | Regional suppliers or commercial buyers operating across 2 specific branches. |
| `branch_only` | Restricted exclusively to the originating branch (`branchId`). | Local walk-in credit accounts or hyper-local farm suppliers. |

### Validation & Transition Rules
- **Branch Existence**: All branch IDs specified in `branchId` or `sharedForBranchIds` MUST exist and be active within the caller's organization. Cross-organization branch IDs are strictly rejected.
- **Scope Expansion**: A party created as `branch_only` can be updated to `selected_branches` or `all_branches`.
- **Scope Revocation**: Revoking branch access (e.g. removing a branch from `sharedForBranchIds`) immediately prevents staff at that branch from listing or referencing the party.
- **Master Ownership**: Party master records are owned by the tenant organization. Sharing read visibility across branches does NOT grant cashiers the ability to modify credit limits or delete party records.

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Onboarding a Customer with Branch Sharing
1. **User calls `customersCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "name": "Sunrise Groceries",
       "phone": "+919876543210",
       "creditLimit": 50000,
       "visibilityScope": "selected_branches",
       "sharedForBranchIds": ["main-branch", "branch-south"]
     }
     ```
2. **Backend Processing**:
   - Generates sequential customer code (`CUST-000001`).
   - Validates that `main-branch` and `branch-south` exist in `org_demo`.
   - Initializes `outstandingBalance: 0`.
   - Commits `customers/{customerId}`.

### 4.2 Querying Parties with Branch Scoping
1. **Cashier at `branch-south` calls `customersList`**:
   - Backend queries customers where `organizationId == org_demo`.
   - In-memory visibility filter matches:
     - `visibilityScope == "all_branches"`, OR
     - `visibilityScope == "branch_only"` AND `branchId == "branch-south"`, OR
     - `visibilityScope == "selected_branches"` AND `sharedForBranchIds` contains `"branch-south"`.
   - Customers restricted to `main-branch` are omitted.

---

## 5. Party Ledgers & Double-Entry Balance Tracking

### Customer Ledger
- **Invoice Issued**: Debits customer ledger (`entryType: "invoice_debit"`), increases `outstandingBalance`.
- **Payment Received**: Credits customer ledger (`entryType: "payment_credit"`), decreases `outstandingBalance`.
- **Sales Return**: Credits customer ledger (`entryType: "return_credit"`), decreases `outstandingBalance`.

### Vendor Ledger
- **Purchase Received**: Credits vendor payable (`entryType: "purchase_payable"`), increases `outstandingPayable`.
- **Payment Disbursed**: Debits vendor payable (`entryType: "disbursement_credit"`), decreases `outstandingPayable`.

### Party Ledger Reconciliation (`reconcilePartyLedgers`)
- The reconciliation tool sums all entries in `customerLedgers` and compares against `customers.outstandingBalance`.
- Discrepancies are reported with exact customer/vendor IDs and amounts.

---

## 6. Local Testing & Verification
- **Unit Tests**: `functions/src/test/unit/branchValidationAndSharing.test.ts` (Validates schema rules, visibility scopes, and in-memory filter logic).
- **Integration Tests**: `functions/scripts/test-branch-deep-e2e.js`
  - Scenarios 4–7 verify branch-only isolation, multi-branch sharing, and sharing revocation across branches.
  - Step 10 of `functions/scripts/test-e2e-business-flow.js` reconciles customer and vendor ledgers.

