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
| `FEATURE_DISABLED` | `failed-precondition` | Feature toggle is disabled globally or for tenant | No | Show feature unavailable notice |
| `REQUEST_NOT_FOUND` | `not-found` | Request ID does not exist or access denied | No | Show request not found |
| `REQUEST_CATEGORY_FORBIDDEN` | `permission-denied` | Caller lacks permission for category (e.g. sensitive) | No | Restrict category in UI |
| `REQUEST_DETAILS_INVALID` | `invalid-argument` | Request detail payload failed category schema | No | Show field validation error |
| `REQUEST_INVALID_TRANSITION` | `failed-precondition` | Action not permitted from current status | No | Refresh status and update actions |
| `REQUEST_STALE_STATUS` | `aborted` | Optimistic concurrency conflict on expectedStatus/version | Yes | Refresh request and prompt retry |
| `REQUEST_DUPLICATE_OPEN` | `already-exists` | Organization already has an open plan_change request | No | Guide user to existing open request |
| `REQUEST_LIMIT_REACHED` | `resource-exhausted` | Open request volume limit reached (user: 10, org: 50) | No | Prompt user to resolve existing requests |
| `REQUEST_RATE_LIMITED` | `resource-exhausted` | Hourly creation limit reached (10 requests/hour) | Yes | Display cooldown message |
| `REQUEST_ATTACHMENT_INVALID` | `invalid-argument` | Attachment exceeds size/count limit or invalid mime | No | Validate files before upload |
| `REQUEST_NOT_APPROVED` | `failed-precondition` | Cannot apply request that is not in approved status | No | Ensure request is approved first |
| `REQUEST_ALREADY_APPLIED` | `failed-precondition` | Request has already been applied | No | Show already applied message |
| `REQUEST_APPLY_BLOCKED` | `failed-precondition` | Target plan capacity exceeded by current usage/resources | No | Show blocker items and override option |
| `REQUEST_PLAN_UNAVAILABLE` | `not-found` | Target plan does not exist or is inactive | No | Prompt user to choose available plan |
| `REQUEST_REOPEN_WINDOW_CLOSED` | `failed-precondition` | Reopen window (30 days post-resolution) has elapsed | No | Prompt user to open a new request |
| `REQUEST_ASSIGNEE_INVALID` | `invalid-argument` | Assigned user is not a valid platform operator | No | Select valid assignee from list |
