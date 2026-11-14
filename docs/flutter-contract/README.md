# Trado Flutter Contract Pack (v1.0.0)

Generated automatically by `node scripts/generate-flutter-contract.js` (D-35).
Freshness enforced by `scripts/check-flutter-contract.js` and verification coupling guards.

## How to Read This Contract Pack

This pack contains the authoritative backend API specification for the Flutter client application:
- `SUMMARY.md`: High-level cheatsheet (≤ 250 lines) to attach directly to Claude or reference when writing Flutter callables.
- `forms/`: Form schemas, required create fields, patchable update fields, bounds, and UI hints for every business entity.
- `responses.md`: Standard single-entity and list envelopes (D-18), included hydration, pagination cursors.
- `serialization.md`: Canonical serialization formats (ISO timestamps, integer minor-units paise for money, enums, ImageRef paths).
- `errors.md`: Every stable error reason, retryability, and UI message mappings.
- `permissions.md`: Complete permission key inventory, role assignments, and UI gating helper rules.
- `state-machines.md`: Status lifecycles and valid state transitions across bills, outflows, deliveries, and tasks.
- `activity-log.md`: Unified audit trail and entity history query models with privacy projection.
- `usage-limits.md`: Subscription quotas, limit counters, and real-time warning shapes.
- `client-meta-and-idempotency.md`: Client telemetry header, idempotency key replay, and ImageRef upload flow.
- `CHANGES.md`: Migration ledger of additions, renames, and removals.

## Generation Command
```bash
npm run contract:generate
```
