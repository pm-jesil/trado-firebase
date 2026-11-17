# Form Contract: Storage Location (`storage_location`)

**Create Callable:** `storageLocationsCreate`  
**Update / Action Callable:** `storageLocationsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `code` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":30,"format":"regex"} | `Sample code` |
| `type` | `enum` | **Yes** | No | `dropdown` | Enum: `warehouse`, `stockyard`, `counter`, `backroom`, `quarantine`, `transit` | `warehouse` |
| `isDefault` | `boolean` | No | Yes | `switch` | {} | `true` |
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
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
