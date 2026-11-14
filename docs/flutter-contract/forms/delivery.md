# Form Contract: Delivery (`delivery`)

**Create Callable:** `deliveriesCreate`  
**Update / Action Callable:** `deliveriesUpdateStatus`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `billId` | `string` | **Yes** | No | `text` | {"minLength":2} | `Sample billId` |
| `lines[].lineId` | `string` | **Yes** | No | `text` | {"minLength":1,"maxLength":10} | `Sample lines[].lineId` |
| `lines[].quantity` | `number` | **Yes** | No | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `recipient.name` | `string` | No | No | `text` | {"minLength":1,"maxLength":100} | `Sample recipient.name` |
| `recipient.phone` | `string` | No | No | `phone` | {"minLength":4,"maxLength":30} | `Sample recipient.phone` |
| `address.line1` | `string` | **Yes** | No | `textarea` | {"minLength":1} | `Sample address.line1` |
| `address.line2` | `string` | No | No | `textarea` | {} | `Sample address.line2` |
| `address.landmark` | `string` | No | No | `textarea` | {} | `Sample address.landmark` |
| `address.city` | `string` | **Yes** | No | `textarea` | {"minLength":1} | `Sample address.city` |
| `address.pincode` | `string` | **Yes** | No | `textarea` | {"minLength":1} | `Sample address.pincode` |
| `riderMembershipId` | `string` | No | Yes | `text` | {} | `Sample riderMembershipId` |
| `partner` | `enum` | No | No | `dropdown` | Enum: `internal`, `swiggy`, `zomato`, `dunzo`, `other` | `internal` |
| `deliveryFee` | `number` | No | No | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `cod.isCod` | `boolean` | No | No | `switch` | {} | `true` |
| `cod.amount` | `number` | No | No | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
