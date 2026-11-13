# Audit trail

One collection, `auditLogs`, and one place that writes it: `functions/src/services/auditRecorder.ts` (D-23, D-24). Handlers never write audit; a guard (`scripts/check-recording-points.js`, rule `no-handler-audit`) fails the build if one does.

## When an event is written

| Kind of request | Event | Atomicity |
|---|---|---|
| a commit that changes business documents (transaction, batch or single write) | one event per commit, id `{requestId}_{seq}` | **same commit**: the counting layer adds the event to the transaction or batch, so a mutation never commits without its event and an event never exists without its mutation |
| a denied request (permission, tenant, plan, subscription, membership) | category `security`, outcome `denied` | separate write, **rate-limited**: one event per (actor, reason) per minute per server instance; the rest are counted into the next event (`suppressedSincePrevious`) |
| a failed mutation (validation, not found, conflict) | the action's category, outcome `failed` | separate write, rate-limited the same way |
| export, auth, file and sensitive reads without a commit | the action's category, outcome `success` | separate write |
| plain reads (`category: none` in the registry) | none | — |

Actions come from the generated registry [audit-actions.md](../reference/audit-actions.md): `<entity>.<verb>`, one per callable and trigger.

## What an event holds

Captured from the emulator on 2026-11-13 (a Super Admin renaming an organization; fields abridged):

```json
{
  "action": "organization.update",
  "category": "mutation",
  "outcome": "success",
  "organizationId": "Y1ekueVNVvJwTXzTHy8U",
  "actorUid": "s4Vkeo3euwqeBPJLU51174dZJTBh",
  "actor": { "kind": "user", "role": null, "membershipId": null, "branchId": null },
  "source": { "callable": "organizationsUpdate", "requestId": "mwer3e5q984a59e39bbc", "clientRequestId": null, "eventId": null },
  "entityType": "organization",
  "entityId": "Y1ekueVNVvJwTXzTHy8U",
  "targets": [{ "type": "organization", "id": "Y1ekueVNVvJwTXzTHy8U", "path": "organizations/Y1ekueVNVvJwTXzTHy8U", "op": "update" }],
  "changes": {
    "fields": [
      { "path": "legalName", "op": "set", "before": "TenancySuiteOrg 1794560535418_844", "after": "TenancySuiteOrg Renamed" },
      { "path": "taxId", "op": "set", "before": "***", "after": "***" }
    ],
    "truncated": false,
    "redacted": ["taxId"],
    "beforeAvailable": true
  },
  "changedFields": ["legalName", "taxId"],
  "ops": { "reads": 2, "writes": 1, "deletes": 0 }
}
```

`occurredAt` is a Firestore `Timestamp` (server clock), `occurredLocalDate` the date in the organization's timezone, `expireAt` the TTL time. A Super Admin's work on an organization is stored in that organization's trail with `actor.kind: superAdminOnBehalf` and category `admin`; its cost is attributed to the platform (D-21).

## Before-values

No event adds a read. `before` is recorded only for documents the request had **already read** (in its transaction or earlier in the request); otherwise the field carries `after` only and `beforeAvailable` is `false`.

## Redaction (D-27)

| Field name (anywhere in a value) | Stored as |
|---|---|
| passwords, tokens, secrets, credentials | dropped, path listed in `redacted` |
| `accountNumber`, `iban` | last 4 characters (`••••5678`) |
| `taxId`, `pan`, `licenceNumber`, `registrationNumber`, `salary`, `upiId` | `***` |

`changes` is capped at 8 KiB; beyond that only the paths are kept and `truncated` is `true`. No payload is stored; `details` holds only the request's reason fields listed in the registry. Names are resolved when the trail is read, not stored.

## Reading it

`auditLogsList` (organization trail with `audit:view`; own activity only with `audit:read_own`; any organization or the platform for a Super Admin) filters by `actorUserId`, `entityType`, `entityId`, `action`, `category`, `outcome`, `deviceId`, `requestId`, `from`, `to`, with `cursor` pagination; `includeTotal: true` adds a `count()` (one read per 1,000 matching events). `auditGetEntityHistory` is the same query with an entity filter and returns `changes` as `{ field, from, to }`.

## Limits stated plainly

- Sign-out and failed sign-ins happen in Firebase Auth, not in a callable: they are not in this trail (they are in the Auth / Identity Platform logs).
- `authLogin` records the session start; a later `authMe` is not an event.
- The denial rate limit is per server instance, so with many instances more than one event per minute can be written for one actor and reason.
- Derived rollups (`dailySummaries`, `monthlySummaries`), locks, counters, idempotency records, notifications and the meter collections are not audit targets (`AUDIT_EXCLUDED_COLLECTIONS`).
- Retention: `expireAt` = occurrence + `AUDIT_RETENTION_MONTHS` (default 24). Deleting expired events needs a TTL policy on `auditLogs.expireAt`, which is a cloud setting (production checklist).
