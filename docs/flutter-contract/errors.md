# Error Index & Handling

When a callable fails, the Firebase SDK throws a `FirebaseFunctionsException`. The response contains:
```json
{
  "code": "failed-precondition",
  "message": "Stock insufficient for product prod_123",
  "details": {
    "reason": "STOCK_INSUFFICIENT",
    "field": "items[0].quantity",
    "retryable": false
  }
}
```

| Error Reason | HTTP Code | Meaning | Retryable | UI Recommendation |
|---|---|---|---|---|
| `USAGE_LIMIT_EXCEEDED` | `resource-exhausted` | Organization has exceeded daily or monthly operation limit | No | Prompt owner to upgrade subscription plan |
| `PERMISSION_DENIED` | `permission-denied` | Member role or overrides lack required permission | No | Show access denied banner |
| `ALREADY_EXISTS` | `already-exists` | Natural key collision (duplicate code, name, phone) | No | Highlight form field with validation error |
| `NOT_FOUND` | `not-found` | Referenced entity ID does not exist or cross-tenant access | No | Show entity not found message |
| `FAILED_PRECONDITION` | `failed-precondition` | Business rule violated (insufficient stock, invalid transition) | No | Display server error message to user |
| `STALE_WRITE` | `aborted` | Optimistic concurrency conflict | Yes | Reload document and retry mutation |
| `INVALID_ARGUMENT` | `invalid-argument` | Schema validation failure | No | Show field-level form validation error |
| `UNKNOWN_FIELD` | `invalid-argument` | Client sent unrecognized schema attribute | No | Ensure client payload matches contract |
