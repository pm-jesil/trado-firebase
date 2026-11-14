# Form Contract: Custom Role (`role`)

**Create Callable:** `rolesCreate`  
**Update / Action Callable:** `rolesUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `code` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":50} | `Sample code` |
| `permissions[]` | `string` | **Yes** | Yes | `text` | {} | `Sample permissions[]` |
| `description` | `string` | **Yes** | Yes | `textarea` | {"maxLength":500} | `Sample description` |
