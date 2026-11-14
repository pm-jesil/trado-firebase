# Form Contract: Department (`department`)

**Create Callable:** `departmentsCreate`  
**Update / Action Callable:** `departmentsDelete`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `headMembershipIds[]` | `string` | **Yes** | Yes | `text` | {} | `Sample headMembershipIds[]` |
