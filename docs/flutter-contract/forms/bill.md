# Form Contract: Bill / POS Sale (`bill`)

**Create Callable:** `billsCreate`  
**Update / Action Callable:** `billsUpdateDraft`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `salesMode` | `enum` | No | No | `dropdown` | Enum: `pos`, `b2b`, `both` | `pos` |
| `documentType` | `enum` | No | No | `dropdown` | Enum: `invoice`, `receipt`, `delivery_challan`, `proforma`, `quotation`, `sales_order` | `invoice` |
| `status` | `enum` | No | No | `date_picker` | Enum: `draft`, `active` | `draft` |
| `customerId` | `string` | No | Yes | `text` | {} | `Sample customerId` |
| `walkInCustomer.name` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":200} | `Sample walkInCustomer.name` |
| `walkInCustomer.phone` | `string` | No | Yes | `phone` | {"maxLength":20} | `Sample walkInCustomer.phone` |
| `walkInCustomer.taxId` | `string` | No | Yes | `text` | {"maxLength":30} | `Sample walkInCustomer.taxId` |
| `walkInCustomer.billingAddress` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample walkInCustomer.billingAddress` |
| `items[].productId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample items[].productId` |
| `items[].quantity` | `number` | **Yes** | Yes | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `items[].unitPriceOverride` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `items[].discountValue` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `items[].unit` | `string` | No | Yes | `text` | {} | `Sample items[].unit` |
| `items[].serialNumbers[]` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":64} | `Sample items[].serialNumbers[]` |
| `discountTotal` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `paidAmount` | `number` | No | No | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `paymentMethod` | `enum` | No | No | `dropdown` | Enum: `cash`, `card`, `upi`, `bank_transfer`, `cheque`, `other` | `cash` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":1000} | `Sample notes` |
