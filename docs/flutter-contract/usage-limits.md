# Subscription Usage Limits & Real-Time Warnings

## Callables
- `usageGetLimits`: Returns effective daily/monthly limits, observed counts, and warning flags.
- `usageGetDetail`: Time-series usage breakdown by day, service, and user (`usage:read_users`).
- `usageUpdateLimits`: Super Admin callable to configure tenant quota overrides.

## Real-Time Warning In Responses
When an API call causes a metric to cross the 80% or 100% threshold, responses include:
```json
{
  "usageWarning": {
    "metric": "firestoreWrites",
    "period": "daily",
    "percentage": 85,
    "currentUsage": 5100,
    "limit": 6000,
    "enforcementMode": "warn_only"
  }
}
```
If `enforcementMode` is `hard_block` and 100% is reached, mutations fail with:
- Error Code: `resource-exhausted`
- Reason: `USAGE_LIMIT_EXCEEDED`
- Details: `{ "metric": "firestoreWrites", "limit": 6000, "used": 6000, "resetsAt": "2026-11-15T00:00:00.000Z" }`
