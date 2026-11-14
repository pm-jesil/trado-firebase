# Form Contract: Category (`category`)

**Create Callable:** `categoriesCreate`  
**Update / Action Callable:** `categoriesUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":100} | `Sample name` |
| `parentId` | `string` | No | Yes | `text` | {} | `Sample parentId` |
| `nature` | `string` | No | Yes | `date_picker` | {} | `Sample nature` |
