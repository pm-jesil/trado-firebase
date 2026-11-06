# Feature Guide: Platform Usage Metering & Cost Estimates

---

## 1. Purpose & Scope
This module provides tenant-level infrastructure resource tracking, usage aggregation, and diagnostic dry-run statements for Trado Platform Super Administrators:
- **Tenant & Branch Telemetry**: Aggregates daily Firestore reads, writes, and Cloud Function invocations across organizations (`organizationUsageDaily`) and branches (`branchUsageDaily`).
- **Platform Aggregates**: Generates global platform rollups (`platformUsageSnapshots`) across all tenants.
- **Diagnostic Dry-Run Statements**: `usageCalculateDryRunStatement` evaluates tenant consumption against versioned rate cards (`usageRateCards`) to produce internal resource cost estimates.
- **Strict Legal & Billing Boundaries**: Clearly marks all cost reports as non-invoice diagnostic estimates. Does not initiate payment gateway transactions or real cloud billing charges.

---

## 2. Actors & Permissions
- **Platform Super Admin** (`isSuperAdmin: true`): Exclusively authorized to access platform summary metrics (`usageGetPlatformSummary`), tenant consumption rankings (`usageGetOrganizations`), branch details (`usageGetBranches`), time series history (`usageGetDetail`), and dry-run cost calculations.
- **Tenant Users / Non-Super Admins**: Completely denied access to usage metering APIs (fails with `permission-denied`).
- **Telemetry Ingestion**: Clients report operational telemetry counters via `usageRecordClientMetric`.

---

## 3. Resource Metering Architecture

### Aggregation Hierarchy
```
[Client Telemetry & Server Operations]
                |
                +---> branchUsageDaily/{orgId}_{branchId}_{date}
                |
                +---> organizationUsageDaily/{orgId}_{date}
                |
                +---> platformUsageSnapshots/{date}
```

### Versioned Rate Cards (`usageRateCards`)
Pricing for diagnostic estimates is stored in versioned rate cards (e.g. `ratecard_v1`):
- `firestoreRates`:
  - `readPer100k`: ₹15.00 INR
  - `writePer100k`: ₹45.00 INR
  - `deletePer100k`: ₹15.00 INR
- `functionRates`:
  - `invocationsPerMillion`: ₹35.00 INR
  - `computeGpuGbSecond`: ₹0.0025 INR
- `storageRates`:
  - `gbMonth`: ₹2.00 INR

---

## 4. Step-by-Step Workflows

### 4.1 Ingesting Client-Attributed Metrics
1. **Client calls `usageRecordClientMetric`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "service": "firestore",
       "operation": "read",
       "count": 15
     }
     ```
2. **Backend Execution**:
   - Increments daily counters in `branchUsageDaily` and `organizationUsageDaily` using Firestore `FieldValue.increment`.

### 4.2 Super Admin Evaluates Diagnostic Statement
1. **Super Admin calls `usageCalculateDryRunStatement`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "period": "2026-10",
       "rateCardVersion": "v1"
     }
     ```
2. **Backend Execution**:
   - Aggregates daily usage records for `org_demo` across October 2026.
   - Evaluates consumption against `ratecard_v1`.
   - Computes estimated resource costs broken down by service.
   - Logs audit record in `usageAllocationRuns`.
   - Returns statement with explicit disclaimer:
     > *"This statement is an internal diagnostic estimate of infrastructure resource consumption. It is NOT an invoice and no automated charge has occurred."*

---

## 5. Security & Boundary Rules
- **Super Admin Guard**: Any non-superadmin attempting to invoke `usageGetPlatformSummary` or `usageCalculateDryRunStatement` is rejected with `permission-denied`.
- **Anti-Recursion Safeguard**: Metering writes use lightweight counter increments and do not trigger recursive event triggers.
- **Attribution Coverage Notice**: Client-reported telemetry covers approximately 90% of user-initiated operations. Server background triggers and cache hits are accounted for in platform snapshots. Authoritative cloud billing requires Google Cloud Billing Export to BigQuery.

---

## 6. Local Testing & Verification
- **Unit Tests**: `functions/src/test/unit/usageMetering.test.ts` (Validates schemas, rate card cost formulas, and zero-count edge cases).
- **Integration Tests**: Part 6 of `functions/scripts/test-phase3-integration.js` (Tests metric ingestion, platform summaries, organization rankings, branch breakdowns, dry-run statements, and security rejection of non-superadmins).

