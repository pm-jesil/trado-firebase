# Form Contract: Expense (Outflow) (`expense`)

**Create Callable:** `outflowsCreate`  
**Update / Action Callable:** `outflowsVoid`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `kind` | `enum` | **Yes** | Yes | `dropdown` | Enum: `purchase`, `expense` | `purchase` |
| `docDate` | `string` | No | Yes | `date_picker` | {} | `Sample docDate` |
| `vendorId` | `string` | No | Yes | `text` | {} | `Sample vendorId` |
| `payee` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":200} | `Sample payee` |
| `recurringTemplateId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample recurringTemplateId` |
| `invoiceNumber` | `string` | No | Yes | `text` | {} | `Sample invoiceNumber` |
| `dueDate` | `string` | No | Yes | `date_picker` | {} | `Sample dueDate` |
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
| `paidAmount` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `paymentMethod` | `enum` | No | Yes | `dropdown` | Enum: `cash`, `card`, `upi`, `bank_transfer`, `cheque`, `other` | `cash` |
| `financialAccountId` | `string` | No | Yes | `text` | {"minLength":2} | `Sample financialAccountId` |
| `storageLocationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample storageLocationId` |
| `splitPayments[].method` | `enum` | **Yes** | Yes | `dropdown` | Enum: `cash`, `card`, `upi`, `bank_transfer`, `cheque`, `other` | `cash` |
| `splitPayments[].amount` | `number` | **Yes** | Yes | `money_paise` | {"format":"safeint","min":0,"minInclusive":false} | `2500` |
| `splitPayments[].financialAccountId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample splitPayments[].financialAccountId` |
| `splitPayments[].notes` | `string` | No | Yes | `textarea` | {"maxLength":300} | `Sample splitPayments[].notes` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":1000} | `Sample notes` |
| `payeeType` | `enum` | No | Yes | `dropdown` | Enum: `vendor`, `employee`, `other` | `vendor` |
| `payeeMembershipId` | `string` | No | Yes | `text` | {"minLength":2} | `Sample payeeMembershipId` |
| `expenseCategoryId` | `string` | No | Yes | `date_picker` | {} | `Sample expenseCategoryId` |
| `billDiscountAmount` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `billDiscountPercent` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true,"max":100,"maxInclusive":true} | `1` |
| `attachmentPaths[]` | `string` | **Yes** | Yes | `date_picker` | {"maxLength":500} | `Sample attachmentPaths[]` |
