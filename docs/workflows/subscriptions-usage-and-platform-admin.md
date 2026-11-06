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
   - Payload:
     ```json
     {
       "data": {
         "planKey": "plan_growth",
         "name": "Growth Tier",
         "description": "Multi-branch tier for growing wholesale businesses",
         "branchLimit": 3,
         "userLimit": 15,
         "modules": { "billing": true, "inventory": true, "sales": true, "reports": true },
         "priceMonthly": 2999,
         "currency": "INR",
         "isActive": true
       }
     }
     ```
2. **Backend Processing**:
   - Validates plan structure.
   - Commits `subscriptionPlans/{planId}`.

### 3.2 Branch Quota Enforcement on Tenant
1. **Tenant on `plan_standard` (limit: 1) attempts to add a second branch**:
   - Calls `branchesCreate` with `{ organizationId: "org_demo", branchCode: "SOUTH" }`.
   - **Backend Guard**: Checks `org.branchCount (1) >= plan.branchLimit (1)`.
   - **Outcome**: Rejected with `failed-precondition: "Branch limit exceeded. Upgrade your subscription plan."`.
2. **Owner Upgrades to `plan_growth`**:
   - Super Admin or Billing engine updates `organizations/org_demo`: `planId = "plan_growth"`, `branchLimit = 3`.
3. **Owner Retries `branchesCreate`**:
   - Backend evaluates `branchCount (1) < branchLimit (3)`.
   - Branch created successfully. `organizations/org_demo.branchCount` increments to 2.

### 3.3 Auditing Branch Quotas (`reconcileBranchCounts`)
1. **Admin calls `reconcileBranchCounts`**:
   - Payload: `{ "data": { "organizationId": "org_demo" } }`.
2. **Backend Engine**:
   - Counts actual active branch documents in `organizations/org_demo/branches`.
   - Compares against cached `organizations/org_demo.branchCount`.
   - Corrects cached count if drift occurred and returns audit report.

### 3.4 Ingesting Telemetry & Evaluating Diagnostic Statements
1. **Client / Server Ingests Telemetry**:
   - Calls `usageRecordClientMetric`:
     ```json
     {
       "data": {
         "organizationId": "org_demo",
         "branchId": "main-branch",
         "service": "firestore",
         "operation": "read",
         "count": 50
       }
     }
     ```
   - Increments daily counters in `organizationUsageDaily` and `branchUsageDaily`.
2. **Super Admin Generates Diagnostic Dry-Run Statement**:
   - Calls `usageCalculateDryRunStatement`:
     ```json
     {
       "data": {
         "organizationId": "org_demo",
         "period": "2026-10",
         "rateCardVersion": "v1"
       }
     }
     ```
   - Evaluates monthly consumption against `ratecard_v1`.
   - Appends audit entry in `usageAllocationRuns`.
   - Returns estimated infrastructure cost with mandatory disclaimer:
     > *"This statement is an internal diagnostic estimate of infrastructure resource consumption. It is NOT an invoice and no automated charge has occurred."*

---

## 4. Failure & Invariant Safeguards

| Scenario | Trigger | Outcome | Reason |
|---|---|:---:|---|
| **Non-Superadmin Accesses Platform Metrics** | Tenant Owner calls `usageGetPlatformSummary` | Rejected with `permission-denied` | Platform usage metrics are strictly Super Admin-only. |
| **Branch Limit Exceeded** | Calling `branchesCreate` when active count equals plan limit | Rejected with `failed-precondition` | Subscription capacity enforcement. |
| **Recursive Telemetry Loop** | Telemetry ingestion triggers usage metrics | Prevented | Metering writes use direct `FieldValue.increment` without triggering background notification triggers. |

---

## 5. Local Testing & Verification
- **Unit Tests**: `functions/src/test/unit/branchLimitEnforcement.test.ts` and `usageMetering.test.ts`.
- **Integration Tests**: Parts 5 & 6 of `functions/scripts/test-phase3-integration.js`.

