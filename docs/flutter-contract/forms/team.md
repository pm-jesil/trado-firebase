# Form Contract: Team (`team`)

**Create Callable:** `teamsCreate`  
**Update / Action Callable:** `teamsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `description` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample description` |
| `leaderMembershipId` | `string` | No | Yes | `text` | {"minLength":2} | `Sample leaderMembershipId` |
