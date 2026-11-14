# Form Contract: Task (`task`)

**Create Callable:** `tasksCreate`  
**Update / Action Callable:** `tasksUpdateStatus`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `title` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":200} | `Sample title` |
| `description` | `string` | No | No | `textarea` | {"maxLength":2000} | `Sample description` |
| `assignedToMembershipId` | `string` | **Yes** | No | `text` | {"minLength":3} | `Sample assignedToMembershipId` |
| `priority` | `enum` | No | No | `dropdown` | Enum: `low`, `medium`, `high`, `urgent` | `low` |
| `dueAt` | `string` | No | No | `date_picker` | {"format":"datetime"} | `Sample dueAt` |
| `relatedEntityType` | `enum` | No | No | `date_picker` | Enum: `bill`, `outflow`, `delivery`, `customer`, `vendor`, `product` | `bill` |
| `relatedEntityId` | `string` | No | No | `date_picker` | {} | `Sample relatedEntityId` |
