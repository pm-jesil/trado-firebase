# Workflow Runbook: Subscriptions, Usage Metering & Platform Administration

---

## 1. Overview & Business Context

This runbook covers subscription plan enforcement, multi-tenant resource telemetry, and Super Admin diagnostic statement calculations for Trado:
- Managing platform subscription plans and capacity limits (`subscriptionPlans`).
- Enforcing branch quotas during branch creation (`branchesCreate`).
- Ingesting operational resource telemetry (`usageRecordClientMetric`).
- Super Admin platform-level usage overviews, tenant rankings, and branch consumption breakdowns.
- Evaluating diagnostic dry-run statements based on versioned rate cards with explicit non-invoice disclaimers.

---

## 2. Actors & Permissions

- **Platform Super Admin** (`isSuperAdmin: true`): Exclusively authorized to manage subscription plans, inspect cross-tenant usage summaries, and generate platform dry-run statements.
- **Organization Owner**: Can view their current subscription plan and branch limits. Can request plan upgrades to unlock multi-branch capacity.
- **Tenant Staff / Non-Super Admins**: Completely denied access to platform-level usage metering APIs.

---

## 3. Step-by-Step Execution Sequences

### 3.1 Super Admin Configures a Subscription Plan
1. **Super Admin calls `plansCreate`**:
   - **Endpoint**: `POST /plansCreate`
   - **Request Payload**:
     ```json
     {
       "data": {
         "name": "Growth Tier",
         "price": 2999.00,
         "currency": "INR",
         "storageLimitMb": 5120,
         "monthlyDocumentVolumeLimit": 10000,
         "seatLimits": {
           "admin": 3,
           "staff": 25
         },
         "branchLimit": 5,
         "moduleFlags": {
           "billing": true,
           "inventory": true,
           "sales": true,
           "staff": true,
           "reports": true,
           "deliveries": true
         },
         "isActive": true,
         "idempotencyKey": "plan_growth_create_001"
       }
     }
     ```
2. **Backend Processing**:
   - Validates plan structure against `CreatePlanSchema`.
   - Commits `subscriptionPlans/{planId}`.

### 3.2 Branch Quota Enforcement on Tenant
1. **Tenant on `plan_starter` (limit: 1) attempts to add a second branch**:
   - Calls `branchesCreate` with `{ name: "South Hub", code: "SOUTH" }`.
   - **Backend Guard**: Evaluates `org.branchCount (1) >= plan.branchLimit (1)`.
   - **Outcome**: Rejected with `resource-exhausted: "Branch limit reached for current subscription plan"`.
2. **Super Admin Upgrades Tenant Subscription (`organizationsSetSubscription`)**:
   - Calls `organizationsSetSubscription` with `{ organizationId: "org_demo", action: "change_plan", planId: "plan_growth" }`.
3. **Owner Retries `branchesCreate`**:
   - Backend evaluates `branchCount (1) < plan.branchLimit (5)`.
   - Branch created successfully. `organizations/org_demo.branchCount` increments to 2.

### 3.3 Auditing Branch Quotas (`reconcileBranchCounts`)
1. **Admin calls `reconcileBranchCounts`**:
   - **Endpoint**: `POST /reconcileBranchCounts`
   - **Request Payload**:
     ```json
     {
       "data": {}
     }
     ```
2. **Backend Engine**:
   - Counts actual active branch documents in `organizations/{orgId}/branches`.
   - Compares against cached `organizations/{orgId}.branchCount`.
   - Corrects cached count if drift occurred and returns audit report.

### 3.4 Ingesting Telemetry & Evaluating Diagnostic Statements
1. **Client / Server Ingests Telemetry**:
   - Calls `usageRecordClientMetric`:
     ```json
     {
       "data": {
         "metrics": {
           "pos_scans": 150,
           "receipt_prints": 85
         }
       }
     }
     ```
2. **Super Admin Evaluates Dry-Run Statement**:
   - Calls `usageCalculateDryRunStatement` with `{ organizationId: "org_demo", month: "2026-11" }`.
   - Returns platform consumption breakdown and calculated dry-run statement containing explicit disclaimer:
     `"THIS IS A NON-INVOICE DIAGNOSTIC USAGE ESTIMATE FOR INTERNAL PLATFORM EVALUATION ONLY"`.

---

## 4. Verification Checkpoints

1. **Verify Plan Capacity Rejection**:
   Attempting to add branches beyond `plan.branchLimit` throws `resource-exhausted`.
2. **Verify Non-Super-Admin Denial**:
   Calling `plansCreate` with a tenant user token throws `permission-denied`.
3. **Verify Dry-Run Disclaimer**:
   Assert that every output of `usageCalculateDryRunStatement` contains the non-invoice diagnostic disclaimer.
