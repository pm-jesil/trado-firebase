# Form Contract: Branch (`branch`)

**Create Callable:** `branchesCreate`  
**Update / Action Callable:** `branchesUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `code` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":20,"format":"regex"} | `Sample code` |
| `address.id` | `string` | No | Yes | `textarea` | {"minLength":1} | `Sample address.id` |
| `address.label` | `string` | No | Yes | `textarea` | {"maxLength":100} | `Sample address.label` |
| `address.line1` | `string` | No | Yes | `textarea` | {"minLength":1,"maxLength":200} | `Sample address.line1` |
| `address.line2` | `string` | No | Yes | `textarea` | {"maxLength":200} | `Sample address.line2` |
| `address.area` | `string` | No | Yes | `textarea` | {"maxLength":100} | `Sample address.area` |
| `address.city` | `string` | No | Yes | `textarea` | {"minLength":1,"maxLength":100} | `Sample address.city` |
| `address.state` | `string` | No | Yes | `date_picker` | {"minLength":1,"maxLength":100} | `Sample address.state` |
| `address.postalCode` | `string` | No | Yes | `textarea` | {"minLength":2,"maxLength":20} | `Sample address.postalCode` |
| `address.country` | `string` | No | Yes | `textarea` | {"maxLength":2,"minLength":2} | `Sample address.country` |
| `address.geoPoint.latitude` | `number` | No | Yes | `date_picker` | {"min":-90,"minInclusive":true,"max":90,"maxInclusive":true} | `1` |
| `address.geoPoint.longitude` | `number` | No | Yes | `textarea` | {"min":-180,"minInclusive":true,"max":180,"maxInclusive":true} | `1` |
| `address.contactName` | `string` | No | Yes | `textarea` | {"maxLength":100} | `Sample address.contactName` |
| `address.phone` | `string` | No | Yes | `phone` | {} | `Sample address.phone` |
| `address.isDefaultBilling` | `boolean` | No | Yes | `textarea` | {} | `true` |
| `address.isDefaultShipping` | `boolean` | No | Yes | `textarea` | {} | `true` |
| `contact.phone` | `string` | No | Yes | `phone` | {} | `Sample contact.phone` |
| `contact.email` | `string` | No | Yes | `email` | {"format":"email"} | `Sample contact.email` |
| `contact.contactPerson` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample contact.contactPerson` |
| `settings.taxId` | `string` | No | Yes | `text` | {} | `Sample settings.taxId` |
| `settings.allowNegativeStock` | `boolean` | No | Yes | `date_picker` | {} | `true` |
| `settings.defaultSalesMode` | `enum` | No | Yes | `dropdown` | Enum: `pos`, `b2b`, `both` | `pos` |
| `settings.moduleOverrides.*` | `boolean` | **Yes** | Yes | `switch` | {} | `true` |
