# Form Contract: Financial Account (`financial_account`)

**Create Callable:** `financialAccountsCreate`  
**Update / Action Callable:** `financialAccountsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `code` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":30,"format":"regex"} | `Sample code` |
| `accountType` | `enum` | **Yes** | No | `dropdown` | Enum: `cash`, `bank`, `digital`, `clearing`, `control` | `cash` |
| `currency` | `string` | No | No | `text` | {"maxLength":3,"minLength":3} | `Sample currency` |
| `bankDetails.bankName` | `string` | No | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample bankDetails.bankName` |
| `bankDetails.accountNumberMasked` | `string` | No | Yes | `text` | {"minLength":4,"maxLength":30} | `Sample bankDetails.accountNumberMasked` |
| `bankDetails.ifscOrSwift` | `string` | No | Yes | `text` | {"minLength":4,"maxLength":20} | `Sample bankDetails.ifscOrSwift` |
| `bankDetails.bankBranchName` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample bankDetails.bankBranchName` |
| `bankDetails.upiId` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample bankDetails.upiId` |
| `openingBalance` | `number` | No | No | `numeric` | {} | `1` |
| `isDefault` | `boolean` | No | Yes | `switch` | {} | `true` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
