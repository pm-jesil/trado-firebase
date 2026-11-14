# Form Contract: Customer (`customer`)

**Create Callable:** `customersCreate`  
**Update / Action Callable:** `customersUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `duplicateOverrideReason` | `string` | No | Yes | `date_picker` | {"minLength":5,"maxLength":300} | `Sample duplicateOverrideReason` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `partyType` | `enum` | No | Yes | `dropdown` | Enum: `organization`, `person` | `organization` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":100} | `Sample name` |
| `legalName` | `string` | No | Yes | `text` | {"minLength":2,"maxLength":120} | `Sample legalName` |
| `phone` | `string` | No | Yes | `phone` | {} | `Sample phone` |
| `additionalPhones[]` | `string` | **Yes** | Yes | `phone` | {"maxLength":30} | `Sample additionalPhones[]` |
| `email` | `string` | No | Yes | `email` | {"format":"email"} | `Sample email` |
| `image.path` | `string` | No | Yes | `image_picker` | {"minLength":5,"maxLength":500} | `Sample image.path` |
| `image.contentType` | `enum` | No | Yes | `image_picker` | Enum: `image/jpeg`, `image/png`, `image/webp` | `image/jpeg` |
| `image.width` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10000,"maxInclusive":true} | `1` |
| `image.height` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10000,"maxInclusive":true} | `1` |
| `image.sizeBytes` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10485760,"maxInclusive":true} | `1` |
| `image.updatedAt` | `string` | No | Yes | `image_picker` | {} | `Sample image.updatedAt` |
| `image.thumbnailPath` | `string` | No | Yes | `image_picker` | {"minLength":5,"maxLength":500} | `Sample image.thumbnailPath` |
| `uploadId` | `string` | No | Yes | `text` | {} | `Sample uploadId` |
| `taxId` | `string` | No | Yes | `text` | {"maxLength":50} | `Sample taxId` |
| `addresses[].id` | `string` | No | Yes | `textarea` | {"minLength":1} | `Sample addresses[].id` |
| `addresses[].label` | `string` | No | Yes | `textarea` | {"maxLength":100} | `Sample addresses[].label` |
| `addresses[].line1` | `string` | **Yes** | Yes | `textarea` | {"minLength":1,"maxLength":200} | `Sample addresses[].line1` |
| `addresses[].line2` | `string` | No | Yes | `textarea` | {"maxLength":200} | `Sample addresses[].line2` |
| `addresses[].area` | `string` | No | Yes | `textarea` | {"maxLength":100} | `Sample addresses[].area` |
| `addresses[].city` | `string` | **Yes** | Yes | `textarea` | {"minLength":1,"maxLength":100} | `Sample addresses[].city` |
| `addresses[].state` | `string` | **Yes** | Yes | `date_picker` | {"minLength":1,"maxLength":100} | `Sample addresses[].state` |
| `addresses[].postalCode` | `string` | **Yes** | Yes | `textarea` | {"minLength":2,"maxLength":20} | `Sample addresses[].postalCode` |
| `addresses[].country` | `string` | No | Yes | `textarea` | {"maxLength":2,"minLength":2} | `Sample addresses[].country` |
| `addresses[].geoPoint.latitude` | `number` | No | Yes | `date_picker` | {"min":-90,"minInclusive":true,"max":90,"maxInclusive":true} | `1` |
| `addresses[].geoPoint.longitude` | `number` | No | Yes | `textarea` | {"min":-180,"minInclusive":true,"max":180,"maxInclusive":true} | `1` |
| `addresses[].contactName` | `string` | No | Yes | `textarea` | {"maxLength":100} | `Sample addresses[].contactName` |
| `addresses[].phone` | `string` | No | Yes | `phone` | {} | `Sample addresses[].phone` |
| `addresses[].isDefaultBilling` | `boolean` | No | Yes | `textarea` | {} | `true` |
| `addresses[].isDefaultShipping` | `boolean` | No | Yes | `textarea` | {} | `true` |
| `bankAccounts[].id` | `string` | No | Yes | `text` | {"minLength":1} | `Sample bankAccounts[].id` |
| `bankAccounts[].label` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample bankAccounts[].label` |
| `bankAccounts[].accountHolderName` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":150} | `Sample bankAccounts[].accountHolderName` |
| `bankAccounts[].bankName` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":100} | `Sample bankAccounts[].bankName` |
| `bankAccounts[].accountNumber` | `string` | **Yes** | Yes | `text` | {"minLength":4,"maxLength":50} | `Sample bankAccounts[].accountNumber` |
| `bankAccounts[].routingType` | `enum` | No | Yes | `dropdown` | Enum: `ifsc`, `iban`, `swift`, `us_routing`, `sg_code`, `other` | `ifsc` |
| `bankAccounts[].routingCode` | `string` | No | Yes | `text` | {"maxLength":50} | `Sample bankAccounts[].routingCode` |
| `bankAccounts[].upiId` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample bankAccounts[].upiId` |
| `bankAccounts[].currency` | `string` | No | Yes | `text` | {"maxLength":3,"minLength":3} | `Sample bankAccounts[].currency` |
| `bankAccounts[].isDefault` | `boolean` | No | Yes | `switch` | {} | `true` |
| `bankAccounts[].showOnInvoice` | `boolean` | No | Yes | `switch` | {} | `true` |
| `bankAccounts[].status` | `enum` | No | Yes | `date_picker` | Enum: `active`, `archived` | `active` |
| `contacts[].id` | `string` | No | Yes | `text` | {"minLength":1} | `Sample contacts[].id` |
| `contacts[].name` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":100} | `Sample contacts[].name` |
| `contacts[].designation` | `string` | No | Yes | `date_picker` | {"maxLength":100} | `Sample contacts[].designation` |
| `contacts[].phone` | `string` | No | Yes | `phone` | {} | `Sample contacts[].phone` |
| `contacts[].email` | `string` | No | Yes | `email` | {} | `Sample contacts[].email` |
| `contacts[].whatsApp` | `string` | No | Yes | `date_picker` | {} | `Sample contacts[].whatsApp` |
| `priceGroup` | `string` | No | Yes | `money_paise` | {} | `Sample priceGroup` |
| `creditLimit` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `creditPeriodDays` | `number` | No | Yes | `numeric` | {"format":"safeint","min":0,"minInclusive":true} | `1` |
| `visibilityScope` | `enum` | No | Yes | `dropdown` | Enum: `all_branches`, `selected_branches`, `branch_only` | `all_branches` |
| `sharedForBranchIds[]` | `string` | **Yes** | Yes | `text` | {} | `Sample sharedForBranchIds[]` |
| `isDefault` | `boolean` | No | No | `switch` | {} | `true` |
