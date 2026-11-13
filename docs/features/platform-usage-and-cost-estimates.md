# Feature Guide: Platform Usage Metering & Cost Estimates

How the backend counts what each organization and user uses, and turns it into a cost **estimate**. The design, the counting rules and what the numbers include are in [the cost-tracking guide](../guides/cost-tracking.md); the prices in [the rate card](../reference/rate-card.md); measured costs per callable in [the API cost profile](../reference/api-cost-profile.md).

## What is recorded

Every callable, trigger and the scheduled job runs inside a request context (`functions/src/services/requestContext.ts`). Every Firestore operation goes through one counting layer (`functions/src/services/meteredFirestore.ts`) and is added to that request. At the end of the request the counts go into two rollups:

| Collection | Key | Holds |
|---|---|---|
| `organizationUsageDaily` | `{organizationId}_{utcDate}` (`platform_{utcDate}` for platform work) | organization × day quantities |
| `userUsageDaily` | `{organizationId}_{uid}_{utcDate}` | organization × user × day quantities, devices |

Quantities only: reads, writes, deletes (total and by category: gate / app / audit / meter), calls, errors, denials, durations, bytes, by callable, by collection, by UTC hour. No cost is stored (D-22).

Separate from this, the gate keeps exact **plan-limit counters** (`usageCounterShards`: one call counted per gated call, for `hard_block` limits). They count calls, not Firestore operations.

What the app reports itself (`usageRecordClientMetric`) is stored under `clientReported` and never mixed with what the server measured; `branchUsageDaily`, `branchUsageMonthly` and `organizationUsageMonthly` hold only such client-reported numbers.

## Callables

| Callable | Who | Answer |
|---|---|---|
| `usageGetPlatformSummary` | Super Admin | measured totals of all organizations and the platform; estimated cost by SKU; platform overhead (measured); top callables and collections |
| `usageGetOrganizations` | Super Admin | organizations ranked by operations or estimated cost; work the platform did for each (not charged to it); anomalies computed when read |
| `usageGetDetail` | Super Admin, or a member: `usage:read` for the organization, `usage:read_users` for every user, always their own | by day or month, hour of day, operation type, callable, collection, user, device; cost only for the Super Admin or with `showCostToTenant` |
| `usageCalculateDryRunStatement` | Super Admin | a month's measured quantities priced by the rate card; labelled as an estimate, never an invoice |
| `usageGetLimits`, `usageUpdateLimits` | owner / admin, Super Admin | plan limits and overrides (limit counters) |
| `usageRecordClientMetric` | any member | client-reported numbers (untrusted) |
| `usageGetBranches` | Super Admin | client-reported branch numbers |

## Boundaries

- Firebase bills the project, not organizations: every cost is an estimate, labelled with the rate-card version and whether its prices are verified, and must be reconciled against the Cloud Billing export (cloud-only, production checklist).
- No payment is ever triggered by these numbers.
