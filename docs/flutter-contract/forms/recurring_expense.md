# Form Contract: Recurring Expense (`recurring_expense`)

**Create Callable:** `recurringExpensesCreate`  
**Update / Action Callable:** `recurringExpensesUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":120} | `Sample name` |
| `vendorId` | `string` | No | No | `text` | {"minLength":2} | `Sample vendorId` |
| `payee` | `string` | No | No | `text` | {"minLength":1,"maxLength":200} | `Sample payee` |
| `payeeType` | `enum` | No | No | `dropdown` | Enum: `vendor`, `employee`, `other` | `vendor` |
| `payeeMembershipId` | `string` | No | No | `text` | {"minLength":2} | `Sample payeeMembershipId` |
| `expenseCategoryId` | `string` | No | No | `date_picker` | {"maxLength":60} | `Sample expenseCategoryId` |
| `lines[].productId` | `string` | No | Yes | `text` | {} | `Sample lines[].productId` |
| `lines[].itemName` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":150} | `Sample lines[].itemName` |
| `lines[].categoryId` | `string` | No | Yes | `date_picker` | {} | `Sample lines[].categoryId` |
| `lines[].quantity` | `number` | **Yes** | Yes | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `lines[].unit` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":30} | `Sample lines[].unit` |
| `lines[].unitPrice` | `number` | **Yes** | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `lines[].discountAmount` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `lines[].taxPercent` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true,"max":100,"maxInclusive":true} | `1` |
| `lines[].addToStock` | `boolean` | No | Yes | `switch` | {} | `true` |
| `lines[].batch` | `string` | No | Yes | `date_picker` | {} | `Sample lines[].batch` |
| `lines[].expiryDate` | `string` | No | Yes | `date_picker` | {"format":"regex"} | `Sample lines[].expiryDate` |
| `lines[].damagedQuantity` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `lines[].damageReason` | `string` | No | Yes | `text` | {"maxLength":300} | `Sample lines[].damageReason` |
| `lines[].serialNumbers[]` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":64} | `Sample lines[].serialNumbers[]` |
| `frequency` | `enum` | **Yes** | No | `dropdown` | Enum: `monthly`, `weekly` | `monthly` |
| `dayOfMonth` | `number` | No | No | `numeric` | {"format":"safeint","min":1,"minInclusive":true,"max":28,"maxInclusive":true} | `1` |
| `weekday` | `number` | No | No | `numeric` | {"format":"safeint","min":1,"minInclusive":true,"max":7,"maxInclusive":true} | `1` |
| `startOn` | `string` | **Yes** | No | `text` | {"format":"regex"} | `Sample startOn` |
| `endOn` | `string` | No | Yes | `text` | {"format":"regex"} | `Sample endOn` |
