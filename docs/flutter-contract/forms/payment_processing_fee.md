# Form Contract: Payment Processing Fee (`payment_processing_fee`)

**Create Callable:** `paymentsRecordFee`  
**Update / Action Callable:** `paymentsGetFee`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `sourceDocumentType` | `enum` | **Yes** | Yes | `dropdown` | Enum: `bill`, `payment` | `bill` |
| `sourceDocumentId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample sourceDocumentId` |
| `paymentId` | `string` | No | Yes | `text` | {} | `Sample paymentId` |
| `financialAccountId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample financialAccountId` |
| `paymentMethod` | `enum` | **Yes** | Yes | `dropdown` | Enum: `cash`, `card`, `upi`, `bank_transfer`, `cheque`, `other` | `cash` |
| `feeAmount` | `number` | **Yes** | Yes | `money_paise` | {"format":"safeint","min":0,"minInclusive":false} | `2500` |
| `feeTaxAmount` | `number` | No | Yes | `money_paise` | {"format":"safeint","min":0,"minInclusive":true} | `2500` |
| `settlementTiming` | `enum` | No | Yes | `dropdown` | Enum: `immediate_deduction`, `billed_later` | `immediate_deduction` |
| `settlementReference` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample settlementReference` |
| `feeExpenseCategoryId` | `string` | No | Yes | `date_picker` | {} | `Sample feeExpenseCategoryId` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
