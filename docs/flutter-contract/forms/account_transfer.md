# Form Contract: Account Transfer (`account_transfer`)

**Create Callable:** `accountTransfersCreate`  
**Update / Action Callable:** `accountTransfersList`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `sourceAccountId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample sourceAccountId` |
| `destinationAccountId` | `string` | **Yes** | Yes | `date_picker` | {"minLength":2} | `Sample destinationAccountId` |
| `amount` | `number` | **Yes** | Yes | `money_paise` | {"min":0,"minInclusive":false} | `2500` |
| `transferType` | `enum` | No | Yes | `dropdown` | Enum: `transfer`, `cash_deposit`, `cash_withdrawal`, `inter_bank`, `petty_cash` | `transfer` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
