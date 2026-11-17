# Form Contract: Capital Transaction (`capital_transaction`)

**Create Callable:** `capitalTransactionsCreate`  
**Update / Action Callable:** `capitalTransactionsList`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `type` | `enum` | **Yes** | Yes | `dropdown` | Enum: `owner_contribution`, `partner_contribution`, `additional_capital`, `drawings` | `owner_contribution` |
| `financialAccountId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample financialAccountId` |
| `amount` | `number` | **Yes** | Yes | `money_paise` | {"format":"safeint","min":0,"minInclusive":false} | `2500` |
| `currency` | `string` | No | Yes | `text` | {"maxLength":3,"minLength":3} | `Sample currency` |
| `sourceReference` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample sourceReference` |
| `description` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample description` |
| `supportingDocumentPath` | `string` | No | Yes | `date_picker` | {"maxLength":500} | `Sample supportingDocumentPath` |
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
