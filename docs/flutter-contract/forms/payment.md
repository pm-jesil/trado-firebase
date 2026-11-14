# Form Contract: Payment (`payment`)

**Create Callable:** `paymentsCreate`  
**Update / Action Callable:** `paymentsVoid`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `direction` | `enum` | **Yes** | Yes | `dropdown` | Enum: `in`, `out` | `in` |
| `partyType` | `enum` | **Yes** | Yes | `dropdown` | Enum: `customer`, `vendor`, `employee`, `other` | `customer` |
| `partyId` | `string` | No | Yes | `text` | {} | `Sample partyId` |
| `partyName` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":100} | `Sample partyName` |
| `amount` | `number` | **Yes** | Yes | `money_paise` | {"min":0,"minInclusive":false} | `2500` |
| `method` | `enum` | No | Yes | `dropdown` | Enum: `cash`, `card`, `upi`, `bank_transfer`, `cheque`, `other` | `cash` |
| `referenceId` | `string` | No | Yes | `text` | {} | `Sample referenceId` |
| `referenceModel` | `enum` | No | Yes | `dropdown` | Enum: `bill`, `outflow` | `bill` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
| `gateway.externalReference` | `string` | No | Yes | `date_picker` | {"maxLength":128} | `Sample gateway.externalReference` |
| `gateway.gatewayProvider` | `string` | No | Yes | `date_picker` | {"maxLength":50} | `Sample gateway.gatewayProvider` |
| `gateway.gatewayStatus` | `enum` | No | Yes | `date_picker` | Enum: `initiated`, `authorized`, `captured`, `failed`, `refunded` | `initiated` |
| `gateway.cardBrand` | `string` | No | Yes | `date_picker` | {"maxLength":20} | `Sample gateway.cardBrand` |
| `gateway.cardLast4` | `string` | No | Yes | `date_picker` | {"format":"regex"} | `Sample gateway.cardLast4` |
