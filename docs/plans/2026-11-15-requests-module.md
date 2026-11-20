---
covers: [all]
verifiedAgainst: "a53b1cb110dd3955"
lastAttestedAt: "2026-11-15T12:22:29.060Z"
---

# Requests & Support Desk Module — Implementation Plan (RB1)

Plan document for Prompt 74 (Trado Firebase Backend Requests & Support Desk Module).

## 1. Architectural Decisions (D-36 through D-45)

| ID | Title | Principle | Enforced In |
|---|---|---|---|
| **D-36** | **Platform-Domain Request Exemption** | Request documents belong to the platform domain, not tenant data. Super Admin may transition requests even though tenant mutations are forbidden by `SUPER_ADMIN_TENANT_FORBIDDEN`. Exemption is explicit, narrow, and tested. | `contextResolver.ts`, `requests.ts` |
| **D-37** | **Unified State Machine (Compare-and-Set)** | One state machine with two kinds (`approval` and `work`). Every transition is atomic compare-and-set on `expectedStatus`. Illegal or stale transitions fail with `REQUEST_INVALID_TRANSITION` or `REQUEST_STALE_STATUS`. Single entry point: `requestsTransition`. | `requestsService.ts`, `requests.ts` |
| **D-38** | **Internal Notes Isolation** | Internal notes (`visibility: "internal"`) never leave the platform. Data access layer filters them out on all tenant read paths (`requestsGet`, `requestsList`, `requestsActivityList`). | `requestsService.ts`, data layer tests |
| **D-39** | **Shared Internal Service for Apply** | `requestsApply` invokes internal domain service functions directly (`setSubscriptionInternal`, `updateOrganizationUsageLimits`, `setModuleToggleInternal`) in the same Firestore commit as status change and audit entry. No callable calling callable. | `requestsService.ts`, `organizations.ts` |
| **D-40** | **Two Histories, One Commit** | Every change commits both user-visible timeline entry (`requests/{id}/activity`) and canonical audit entry (`auditLogs`). Both written in the same commit. Timeline is display content; audit is tamper-evident record. | `requestsService.ts`, `auditRecorder.ts` |
| **D-41** | **Static Category Detail Schemas** | All 15 category detail schemas are statically declared in TypeScript/Zod and exported to Flutter contract pack (`forms/request-details-<category>.json`). No dynamic server-driven forms. | `validation/schemas.ts`, contract pack |
| **D-42** | **Deterministic SLA Clock with Pauses** | SLA clock pauses during `needs_info` and `on_hold`. Times computed via injected `Clock` interface for 100% deterministic testing. | `requestsService.ts`, unit tests |
| **D-43** | **One Open Plan Change per Organization** | An organization may have at most one open `plan_change` request at any time. Duplicate attempts are rejected with `REQUEST_DUPLICATE_OPEN`. | `requestsService.ts` |
| **D-44** | **Server-Computed Blocker Guard** | Plan-change apply is guarded by server-computed blockers (usage, branches, users, active modules vs target plan). Overriding a blocker requires distinct permission `platform:requests_override_blockers` and an explicit reason. | `requestsService.ts` |
| **D-45** | **Idempotent Notification Dispatch** | Activity notifications use event-keyed delivery markers written in the same transaction to guarantee at-most-once user delivery under retry/trigger replays. | `eventTriggers.ts`, `requestsService.ts` |

## 2. Collections & Data Model (B-1)

### 2.1 Collections

- `requests/{requestId}`: Main request document.
- `requests/{requestId}/activity/{activityId}`: Timeline entries (`comment`, `status_change`, `assignment`, `priority_change`, `apply`, `system`).
- `counters/requests`: Per-calendar-year sequence counter (`{ year: 2026, currentSequence: 123 }`).
- `platformSettings/requests`: Configuration document (`requestsEnabled`, SLA target tables, limit thresholds, auto-close windows).

### 2.2 Request Document Schema (`RequestDoc`)

```typescript
export interface RequestDoc {
  requestId: string;
  requestNumber: string; // e.g. "REQ-2026-000123"
  audience: "platform" | "organization";
  category: RequestCategory; // 15 taxonomy categories
  kind: "approval" | "work"; // derived from category
  title: string; // 3..120 chars
  description: string; // <= 5,000 chars
  details: Record<string, unknown>; // typed per category schema
  priority: "low" | "normal" | "high" | "urgent";
  severity?: "minor" | "major" | "critical"; // for bug_report
  status: RequestStatus;
  statusReason?: string | null;
  statusChangedAt: string;
  requester: {
    uid: string;
    name: string;
    roleLabel: string;
  };
  organizationId: string;
  branchId?: string | null;
  relatedEntity?: {
    type: string;
    id: string;
    label: string;
  } | null;
  assignee?: {
    uid: string;
    name: string;
  } | null;
  attachments: Array<{
    storagePath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  labels: string[];
  idempotencyKey?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  lastActivityBy: {
    uid: string;
    name: string;
    isPlatform: boolean;
  };
  // SLA Tracking
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt?: string | null;
  slaState: "on_track" | "at_risk" | "breached" | "paused";
  slaPausedAt?: string | null;
  slaTotalPausedMs: number;
  // Lifecycle
  resolvedAt?: string | null;
  closedAt?: string | null;
  resumeOn?: string | null;
  // Apply Results
  appliedAt?: string | null;
  appliedBy?: string | null;
  applyResult?: Record<string, unknown> | null;
  // Denormalized Inbox Data
  organizationName: string;
  requesterName: string;
  currentPlanName?: string | null;
  requestedPlanName?: string | null;
}
```

### 2.3 Activity Entry Schema (`RequestActivityDoc`)

```typescript
export interface RequestActivityDoc {
  activityId: string;
  requestId: string;
  type: "comment" | "status_change" | "assignment" | "priority_change" | "apply" | "system";
  visibility: "public" | "internal";
  author: {
    uid: string;
    name: string;
    roleLabel: string;
    isPlatform: boolean;
  };
  content?: string | null;
  details?: Record<string, unknown> | null;
  attachments?: Array<{
    storagePath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  createdAt: string;
}
```

## 3. Database Indexes (`firestore.indexes.json`)

1. Inbox Query: `(audience, status, priority, createdAt DESC)`
2. Assignee Query: `(assignee.uid, status, lastActivityAt DESC)`
3. Tenant Org List: `(organizationId, status, createdAt DESC)`
4. Tenant User List: `(requester.uid, createdAt DESC)`
5. Category Breakdown: `(category, status, createdAt DESC)`
6. SLA Monitor: `(slaState, resolutionDueAt ASC)`
7. Number Lookup: `(requestNumber ASC)`

## 4. Visibility & Data Access Rules (B-3)

- **Requester:** Can read own submitted requests (`requester.uid == callerUid`).
- **Organization Readers (`requests:read_org`):** Can read all requests of their organization except `confidential` requests (`security_concern`).
- **Platform Readers (`platform:requests_read`):** Can read all `audience: "platform"` requests across all organizations. Cannot read `audience: "organization"` requests (internal tenant matters).
- **Internal Notes:** Visible **only** if caller has `platform:requests_internal_notes`. Stripped by data access layer for all tenant queries.
- **Requester Contact:** Phone/email hidden from tenant-wide readers; visible to requester and platform handlers.

## 5. Taxonomy & 15 Category Detail Schemas (Appendix A)

1. `plan_change` (Audience: platform, Kind: approval, Creator: Org Owner):
   `requestedPlanId` (required), `billingPeriod` (optional: monthly/yearly), `effectiveFrom` (optional), `reason` (required, min 10 chars).
2. `limit_increase` (Audience: platform, Kind: approval, Creator: Org Owner):
   `metric` (required, from `ServiceUsageCounts`), `period` (required: daily/monthly), `requestedLimit` (required, number > current), `reason` (required).
3. `module_request` (Audience: platform, Kind: approval, Creator: Org Owner):
   `moduleKey` (required, from catalog), `action` (required: enable/disable), `reason` (required).
4. `billing_query` (Audience: platform, Kind: work, Creator: Owner, billing roles):
   `subject` (required: invoice/payment/charge/other), `reference` (optional), `amount` (optional, decimal major units), `description` (required).
5. `org_profile_change` (Audience: platform, Kind: approval, Creator: Org Owner):
   `field` (required, in Super-Admin-only set), `proposedValue` (required, typed), `reason` (required).
6. `ownership_transfer` (Audience: platform, Kind: approval, Creator: Org Owner):
   `newOwnerUserId` or `newOwnerEmail` (required), `effectiveFrom` (optional), `reason` (required).
7. `bug_report` (Audience: platform, Kind: work, Creator: any member):
   `area` (required), `stepsToReproduce` (required), `expected` (required), `actual` (required), `severity` (required: minor/major/critical), `frequency` (optional), `diagnosticsOptIn` (boolean), `diagnostics` (optional object).
8. `data_issue` (Audience: platform, Kind: work, Creator: any member):
   `entityType` (required), `entityId` (optional), `whatIsWrong` (required), `expected` (required).
9. `feature_request` (Audience: platform, Kind: work, Creator: any member):
   `problem` (required), `businessImpact` (required), `area` (required), `proposedSolution` (optional), `neededBy` (optional), `alternatives` (optional).
10. `improvement` (Audience: platform, Kind: work, Creator: any member):
    `area` (required), `currentBehaviour` (required), `suggestedBehaviour` (required).
11. `support_question` (Audience: platform, Kind: work, Creator: any member):
    `topic` (required: how_to/account/billing/other), `question` (required).
12. `other` (Audience: platform, Kind: work, Creator: any member):
    `detailsText` (required).
13. `data_request` (Audience: platform, Kind: approval, Creator: Org Owner):
    `type` (required: export/correction/deletion), `scope` (required), `reason` (required), `confirmationText` (required for deletion).
14. `security_concern` (Audience: platform, Kind: work, Creator: any member, confidential, priority forced to urgent):
    `description` (required), `whenNoticed` (optional), `suspectedImpact` (optional).
15. `access_request` (Audience: organization, Kind: approval, Creator: any member):
    `permissionKeys` (string[]) or `roleId` (string), `branchId` (optional), `reason` (required), `until` (optional).

## 6. State Machine Matrix (Appendix B)

Statuses:
`submitted` (Pending), `in_review` (In review), `needs_info` (Action required), `on_hold` (On hold), `approved` (Approved), `applied` (Applied), `rejected` (Rejected), `in_progress` (In progress), `resolved` (Resolved), `declined` (Declined), `closed` (Closed), `cancelled` (Cancelled).

Actions:
- `start_review`: `submitted` -> `in_review` (both kinds, handler)
- `request_info`: `submitted`, `in_review` -> `needs_info` (both kinds, handler, SLA paused)
- `respond`: `needs_info` -> `in_review` (both kinds, requester, SLA resumed)
- `hold`: `submitted`, `in_review` -> `on_hold` (both kinds, handler, SLA paused)
- `resume`: `on_hold` -> `in_review` (both kinds, handler, SLA resumed)
- `approve`: `submitted`, `in_review` -> `approved` (approval kind, handler)
- `reject`: `submitted`, `in_review`, `approved` -> `rejected` (approval kind, handler, terminal)
- `apply`: `approved` -> `applied` (approval kind, handler with apply permission, terminal)
- `start_work`: `submitted`, `in_review` -> `in_progress` (work kind, handler)
- `resolve`: `in_review`, `in_progress` -> `resolved` (work kind, handler)
- `decline`: `in_review`, `in_progress` -> `declined` (work kind, handler, terminal)
- `close`: `resolved` -> `closed` (work kind, requester or auto-close, terminal)
- `reopen`: `resolved`, `closed` -> `in_review` (work kind, requester within 14d or handler anytime)
- `cancel`: `submitted`, `in_review`, `needs_info`, `on_hold` -> `cancelled` (both kinds, requester or system no-response, terminal)

## 7. Permissions & Role Matrix (Appendix E)

New Permission Keys:
- `requests:create`: Create general requests (bug, feature, support, access, etc.). Default: Owner, Manager, Cashier/Staff.
- `requests:create_sensitive`: Create sensitive requests (plan_change, limit_increase, module_request, org_profile_change, ownership_transfer, data_request). Default: Owner.
- `requests:read_own`: Read caller's own requests. Default: Owner, Manager, Cashier/Staff.
- `requests:read_org`: Read all non-confidential requests of organization. Default: Owner, Manager.
- `requests:comment`: Add public comments on requests. Default: Owner, Manager, Cashier/Staff.
- `requests:manage_org`: Review, transition, and decide organization-audience requests. Default: Owner.
- `platform:requests_read`: Read platform-audience requests cross-organization. Default: Super Admin.
- `platform:requests_manage`: Transition platform-audience requests, change priority, assign. Default: Super Admin.
- `platform:requests_apply`: Execute automated apply on approved requests. Default: Super Admin.
- `platform:requests_internal_notes`: Read and post internal notes. Default: Super Admin.
- `platform:requests_override_blockers`: Override blocker warnings during apply. Default: Super Admin.
- `platform:requests_configure`: Manage `platformSettings/requests`. Default: Super Admin.

## 8. Rollout & Rollback Sequence

1. **Deploy Backend:** Functions, rules, indexes deployed with `platformSettings/requests.requestsEnabled = false`. All callables return `FEATURE_DISABLED`.
2. **Run Migration:** Idempotent migration script adds new permissions to system roles in Firestore emulator/staging/prod.
3. **Verify Contract:** Regenerate contract pack, verify Flutter code generator and checks pass.
4. **Deploy Flutter App:** Flutter client containing requests screens shipped.
5. **Enable Feature:** Update `platformSettings/requests.requestsEnabled = true`.
6. **Rollback Plan:** Set `platformSettings/requests.requestsEnabled = false`. No destructive data migration required; system cleanly freezes mutations with `FEATURE_DISABLED`.
