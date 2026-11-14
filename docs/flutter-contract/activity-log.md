# Activity Log & Audit Trail

Provides organization owners and authorized staff with transparent audit logs.

## Query Callables
- `auditLogsList`: Filtered, cursor-paginated timeline of organization actions.
- `auditGetEntityHistory`: Chronological field-level mutation history for a single entity ID.

## Query Filter Parameters (`auditLogsList`)
- `actorUserId` (string): Filter by user UID.
- `entityType` (string): Filter by entity (`bill`, `purchase`, `expense`, `customer`, `vendor`, `delivery`, `wastage`, etc.).
- `entityId` (string): Filter by document ID.
- `operation` (enum): `create` | `update` | `delete` | `status_change`.
- `status` (string): Filter by current or post-mutation status.
- `branchId` (string): Filter by branch.
- `from` / `to` (YYYY-MM-DD): Date range in organization timezone.
- `limit` (int): 1 to 100 (default 50).
- `cursor` (string): Pagination cursor from previous page `nextCursor`.

## Response Item Shape
```json
{
  "logId": "req_xyz_1",
  "timestamp": "2026-11-14T05:30:00.000Z",
  "occurredLocalDate": "2026-11-14",
  "operation": "create",
  "action": "purchase.create",
  "entityType": "purchase",
  "entityId": "outflow_987",
  "humanLabel": "INV-2026-0042",
  "statusBefore": null,
  "statusAfter": "confirmed",
  "amount": 200000,
  "currency": "INR",
  "branchId": "branch_main",
  "actorUid": "user_owner_1",
  "actorName": "Acme Owner",
  "actorRole": "owner",
  "changes": [
    { "field": "amount", "op": "set", "from": null, "to": 200000 }
  ],
  "device": {
    "platform": "android",
    "appVersion": "1.0.0",
    "deviceId": "dev_pixel8"
  }
}
```
*(Note: IP addresses are strictly omitted from tenant audience responses for privacy compliance).*
