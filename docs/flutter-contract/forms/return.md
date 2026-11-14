# Form Contract: Return (`return`)

**Create Callable:** `returnsCreate`  
**Update / Action Callable:** `returnsList`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `returnType` | `enum` | **Yes** | Yes | `dropdown` | Enum: `sales_return`, `purchase_return` | `sales_return` |
| `referenceId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample referenceId` |
| `items[].productId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample items[].productId` |
| `items[].sourceLineId` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":10} | `Sample items[].sourceLineId` |
| `items[].serialNumbers[]` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":64} | `Sample items[].serialNumbers[]` |
| `items[].quantity` | `number` | **Yes** | Yes | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `items[].refundAmount` | `number` | **Yes** | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `items[].reason` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":200} | `Sample items[].reason` |
| `items[].disposition` | `enum` | No | Yes | `dropdown` | Enum: `restocked_to_inventory`, `wasted_discarded` | `restocked_to_inventory` |
| `refundMethod` | `enum` | No | Yes | `dropdown` | Enum: `cash`, `credit_note`, `original_payment` | `cash` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
