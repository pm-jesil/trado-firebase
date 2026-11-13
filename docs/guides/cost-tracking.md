# Cost tracking

## What Firebase bills, and what we can know

Firebase bills the **project** (`trado-x`): one invoice, one number per SKU. It does not bill organizations. A cost per organization is therefore an **estimate**: Firestore operations counted by this backend, attributed to the organization and user that caused them, multiplied by the rate card in force. It must be reconciled against what Google billed, which is cloud-only (Cloud Billing export to BigQuery; see the production checklist). Every screen and response that shows a cost says "estimate" and carries the rate-card version and whether its prices are verified.

## What the numbers contain

| Cost source | How it is known | Status |
|---|---|---|
| Firestore reads, writes, deletes by this backend | counted at the one data-access layer (`functions/src/services/meteredFirestore.ts`) | metered |
| gate reads (the authorization check) | counted, category `gate` | metered |
| audit and meter writes themselves | counted, categories `audit` / `meter` | metered (overhead) |
| trigger and scheduled-job operations | counted with a system context | metered |
| Cloud Functions compute | `durationMs` × configured memory: an upper bound (concurrency shares an instance) | estimated |
| response bytes | measured per request; only billable egress is charged | estimated |
| Firestore and Cloud Storage stored bytes | not measured yet | not included |
| client-direct reads allowed by the rules (own profile, devices, memberships, notifications, plans, catalogs) and Storage downloads | invisible to the backend | reconciliation residual |
| Auth, SMS, Hosting, Scheduler, Pub/Sub, Logging, platform admin work | not attributable to an organization | platform overhead / residual |

The same list is returned with every usage answer as `coverage`.

## Counting rules

From the Firestore pricing documentation (read 2026-11-13): a query costs at least one read even with no results; skipped `offset` rows are billed as reads; aggregations (`count()`, `sum()`, `avg()`) are billed by index entries read, minimum one read. The layer counts: a document get = 1 read (also when the document does not exist); a query = documents returned, minimum 1, plus skipped offset rows; `getAll` = 1 per reference; `count()` = ceil(count / 1000), minimum 1; each set / create / update = 1 write; delete = 1 delete; a transaction's reads per attempt and its writes once. Rules not stated on the page (missing-document gets, failed writes, entries per aggregation read) are marked unverified in the rate card. The test `functions/scripts/test-metering-layer.cjs` asserts every rule against the layer and an independent shadow counter.

## Attribution (D-21)

Each operation belongs to one organization (or `platform`), one user (or system) and one source (callable, trigger, scheduled job). A Super Admin's work and the scheduled sweep are attributed to `platform`, tagged with the organization they were for (`targets` in the platform rollup): they are **not** charged to the tenant.

## Where it is stored

| Rollup | Document | Content |
|---|---|---|
| organization × day | `organizationUsageDaily/{org}_{utcDate}` | calls, errors, denials, durations, bytes, operations total and by category, by callable, by collection template, by UTC hour |
| organization × user × day | `userUsageDaily/{org}_{uid}_{utcDate}` | the same, plus devices |

Quantities only: cost is computed when read (D-22). Days are UTC, so they line up with the billing export. Each document carries `expireAt` (default 25 months). Numbers the app reports itself (`usageRecordClientMetric`) are kept apart, under `clientReported`.

Writes are flushed in `exact` mode (before the response; emulator and tests) or `batched` mode (cloud default: per document, when the oldest entry is `METER_FLUSH_SECONDS` old or `METER_FLUSH_CALLS` calls accumulated, and on shutdown). A batched instance killed between flushes loses what it had not written; the measured overhead and the cost per call are in [the API cost profile](../reference/api-cost-profile.md).

## Who sees what (D-25)

| Reader | Sees |
|---|---|
| Super Admin | every organization: ranking, operations by type, platform overhead, estimated cost by SKU (`usageGetPlatformSummary`, `usageGetOrganizations`, `usageGetDetail`) |
| member with `usage:read` | the organization's quantities: by day or month, hour of day, operation type, callable, collection; top callables (`usageGetDetail`) |
| member with `usage:read_users` | every user's quantities and devices |
| every member | their own usage |
| tenants | the cost estimate only when the Super Admin turns on `showCostToTenant` for the organization |

Reading usage costs reads: one per day document in the range, plus one per user-day; each answer states it as `readCost`.

## Rate card

See [the rate card](../reference/rate-card.md): prices per SKU with their source and verification state, and the project free allowance (not allocated to organizations).
