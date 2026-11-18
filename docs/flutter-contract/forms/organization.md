# Form Contract: Organization (`organization`)

**Create Callable:** `organizationsCreate`  
**Update / Action Callable:** `organizationsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `legalName` | `string` | No | Yes | `text` | {"minLength":2,"maxLength":120} | `Sample legalName` |
| `businessType` | `enum` | **Yes** | Yes | `dropdown` | Enum: `retail_only`, `wholesale_only`, `wholesale_retail`, `distributor`, `restaurant`, `cafe_bakery`, `service`, `general_trading`, `manufacturer_b2b`, `pos_counter` | `retail_only` |
| `businessCategory` | `enum` | **Yes** | Yes | `date_picker` | Enum: `bicycle`, `motorcycle`, `car_automobile`, `auto_spare_parts`, `mobile_electronics`, `grocery_fmcg`, `pharmacy_medical`, `textile_garments`, `hardware_building`, `furniture_home`, `stationery_books`, `food_beverage`, `agri_products`, `jewellery`, `kitchenware_household`, `gifts_toys`, `restaurant_food_service`, `services_repair`, `general` | `bicycle` |
| `country` | `string` | **Yes** | No | `text` | {"maxLength":2,"minLength":2} | `Sample country` |
| `currency` | `string` | **Yes** | No | `text` | {"maxLength":3,"minLength":3} | `Sample currency` |
| `currencyDecimals` | `number` | No | No | `numeric` | {"format":"safeint","min":0,"minInclusive":true,"max":4,"maxInclusive":true} | `1` |
| `minorUnitName` | `string` | No | No | `text` | {"maxLength":30} | `Sample minorUnitName` |
| `minorUnitNamePlural` | `string` | No | No | `text` | {"maxLength":30} | `Sample minorUnitNamePlural` |
| `currencySymbol` | `string` | No | No | `text` | {"maxLength":10} | `Sample currencySymbol` |
| `taxRegimeCode` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":32} | `Sample taxRegimeCode` |
| `planId` | `string` | **Yes** | No | `text` | {"minLength":2,"maxLength":64} | `Sample planId` |
| `createOwner` | `boolean` | No | No | `date_picker` | {} | `true` |
| `confirmLinkExistingUser` | `boolean` | No | No | `switch` | {} | `true` |
| `ownerEmail` | `string` | No | No | `email` | {"format":"email"} | `Sample ownerEmail` |
| `ownerName` | `string` | No | No | `text` | {"minLength":2,"maxLength":100} | `Sample ownerName` |
| `ownerPhone` | `string` | No | No | `phone` | {} | `Sample ownerPhone` |
| `credentialMode` | `enum` | No | No | `dropdown` | Enum: `temporaryPassword`, `invite` | `temporaryPassword` |
| `initialPassword` | `string` | No | No | `password` | {"minLength":8,"maxLength":128} | `Sample initialPassword` |
| `financialYearStartMonth` | `number` | No | Yes | `numeric` | {"format":"safeint","min":1,"minInclusive":true,"max":12,"maxInclusive":true} | `1` |
| `taxId` | `string` | No | Yes | `text` | {"maxLength":30} | `Sample taxId` |
| `website` | `string` | No | Yes | `text` | {"format":"url"} | `Sample website` |
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
| `image.path` | `string` | No | Yes | `image_picker` | {"minLength":5,"maxLength":500} | `Sample image.path` |
| `image.contentType` | `enum` | No | Yes | `image_picker` | Enum: `image/jpeg`, `image/png`, `image/webp` | `image/jpeg` |
| `image.width` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10000,"maxInclusive":true} | `1` |
| `image.height` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10000,"maxInclusive":true} | `1` |
| `image.sizeBytes` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10485760,"maxInclusive":true} | `1` |
| `image.updatedAt` | `string` | No | Yes | `image_picker` | {} | `Sample image.updatedAt` |
| `image.thumbnailPath` | `string` | No | Yes | `image_picker` | {"minLength":5,"maxLength":500} | `Sample image.thumbnailPath` |
| `uploadId` | `string` | No | Yes | `text` | {} | `Sample uploadId` |
| `defaultBranchName` | `string` | No | No | `text` | {"minLength":2,"maxLength":100} | `Sample defaultBranchName` |
| `defaultBranchCode` | `string` | No | No | `text` | {"minLength":2,"maxLength":20,"format":"regex"} | `Sample defaultBranchCode` |
| `salesChannels[]` | `enum` | **Yes** | Yes | `dropdown` | Enum: `pos`, `b2b`, `order_taking`, `online` | `pos` |
| `timezone` | `string` | No | Yes | `text` | {"minLength":3,"maxLength":64} | `Sample timezone` |
| `contact.name` | `string` | No | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample contact.name` |
| `contact.email` | `string` | No | Yes | `email` | {"format":"email","maxLength":254} | `Sample contact.email` |
| `contact.phone` | `string` | No | Yes | `phone` | {"minLength":5,"maxLength":30} | `Sample contact.phone` |
| `contact.altPhone` | `string` | No | Yes | `phone` | {"minLength":5,"maxLength":30} | `Sample contact.altPhone` |
| `contacts[].id` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":64} | `Sample contacts[].id` |
| `contacts[].name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample contacts[].name` |
| `contacts[].designation` | `string` | No | Yes | `date_picker` | {"maxLength":100} | `Sample contacts[].designation` |
| `contacts[].phone` | `string` | No | Yes | `phone` | {"maxLength":30} | `Sample contacts[].phone` |
| `contacts[].email` | `string` | No | Yes | `email` | {"format":"email"} | `Sample contacts[].email` |
| `contacts[].type` | `enum` | No | Yes | `dropdown` | Enum: `primary`, `billing`, `technical`, `operations`, `other` | `primary` |
| `contacts[].isPrimary` | `boolean` | No | Yes | `switch` | {} | `true` |
| `contacts[].notifyBy` | `enum` | No | Yes | `dropdown` | Enum: `email`, `sms`, `both`, `none` | `email` |
| `contacts[].isActive` | `boolean` | No | Yes | `switch` | {} | `true` |
| `contacts[].createdAt` | `string` | No | Yes | `date_picker` | {"format":"datetime"} | `Sample contacts[].createdAt` |
| `contacts[].updatedAt` | `string` | No | Yes | `date_picker` | {"format":"datetime"} | `Sample contacts[].updatedAt` |
| `contacts[].createdBy` | `string` | No | Yes | `date_picker` | {} | `Sample contacts[].createdBy` |
| `contacts[].updatedBy` | `string` | No | Yes | `date_picker` | {} | `Sample contacts[].updatedBy` |
| `subscription.status` | `enum` | No | No | `date_picker` | Enum: `trial`, `active`, `grace`, `expired`, `suspended`, `cancelled` | `trial` |
| `subscription.startsAt` | `string` | No | No | `date_picker` | {"format":"datetime"} | `Sample subscription.startsAt` |
| `subscription.expiresOn` | `string` | No | No | `text` | {"format":"regex"} | `Sample subscription.expiresOn` |
| `subscription.durationDays` | `number` | No | No | `date_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":3660,"maxInclusive":true} | `1` |
| `subscription.graceDays` | `number` | No | No | `numeric` | {"format":"safeint","min":0,"minInclusive":true,"max":90,"maxInclusive":true} | `1` |
