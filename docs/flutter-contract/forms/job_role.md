# Form Contract: Job Role (`job_role`)

**Create Callable:** `jobRolesCreate`  
**Update / Action Callable:** `jobRolesDelete`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `code` | `string` | No | Yes | `text` | {"minLength":2,"maxLength":60,"format":"regex"} | `Sample code` |
