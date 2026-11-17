# Form Contract: Product (`product`)

**Create Callable:** `productsCreate`  
**Update / Action Callable:** `productsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":150} | `Sample name` |
| `description` | `string` | No | Yes | `textarea` | {"maxLength":1000} | `Sample description` |
| `categoryId` | `string` | No | Yes | `date_picker` | {} | `Sample categoryId` |
| `baseUnit` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":30} | `Sample baseUnit` |
| `sellingPrice` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `costPrice` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `mrp` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `wholesalePrice` | `number` | No | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `taxInclusive` | `boolean` | No | Yes | `switch` | {} | `true` |
| `taxRatePercent` | `number` | No | Yes | `date_picker` | {"min":0,"minInclusive":true,"max":100,"maxInclusive":true} | `1` |
| `taxCode` | `string` | No | Yes | `text` | {"maxLength":50} | `Sample taxCode` |
| `barcode` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample barcode` |
| `sku` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample sku` |
| `hasExpiry` | `boolean` | No | Yes | `switch` | {} | `true` |
| `trackStock` | `boolean` | No | Yes | `switch` | {} | `true` |
| `initialStock` | `number` | No | No | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `storageLocationId` | `string` | No | No | `date_picker` | {"minLength":2} | `Sample storageLocationId` |
| `lowStockThreshold` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `trackBatch` | `boolean` | No | Yes | `date_picker` | {} | `true` |
| `trackSerial` | `boolean` | No | Yes | `switch` | {} | `true` |
| `hasVariants` | `boolean` | No | No | `switch` | {} | `true` |
| `isPurchaseOnly` | `boolean` | No | No | `switch` | {} | `true` |
| `isExpenseOnly` | `boolean` | No | No | `switch` | {} | `true` |
| `isSaleOnly` | `boolean` | No | No | `switch` | {} | `true` |
| `brand` | `string` | No | Yes | `text` | {"maxLength":100} | `Sample brand` |
| `alternateUnits[].unit` | `string` | **Yes** | Yes | `date_picker` | {"minLength":1,"maxLength":30} | `Sample alternateUnits[].unit` |
| `alternateUnits[].factor` | `number` | **Yes** | Yes | `date_picker` | {"min":0,"minInclusive":false} | `1` |
| `alternateUnits[].sellingPrice` | `number` | No | Yes | `date_picker` | {"min":0,"minInclusive":true} | `1` |
| `alternateUnits[].wholesalePrice` | `number` | No | Yes | `date_picker` | {"min":0,"minInclusive":true} | `1` |
| `alternateUnits[].barcode` | `string` | No | Yes | `date_picker` | {"maxLength":100} | `Sample alternateUnits[].barcode` |
| `alternateUnits[].isPurchaseUnit` | `boolean` | No | Yes | `date_picker` | {} | `true` |
| `alternateUnits[].isSaleUnit` | `boolean` | No | Yes | `date_picker` | {} | `true` |
| `isTaxable` | `boolean` | No | Yes | `switch` | {} | `true` |
| `taxExemptionReason` | `string` | No | Yes | `text` | {"maxLength":200} | `Sample taxExemptionReason` |
| `isDiscountable` | `boolean` | No | Yes | `switch` | {} | `true` |
| `maxDiscountPercent` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true,"max":100,"maxInclusive":true} | `1` |
| `isReturnable` | `boolean` | No | Yes | `switch` | {} | `true` |
| `returnWindowDays` | `number` | No | Yes | `numeric` | {"format":"safeint","min":0,"minInclusive":true,"max":3650,"maxInclusive":true} | `1` |
| `reorderLevel` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `maxStockLevel` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `weight.value` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `weight.unit` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":10} | `Sample weight.unit` |
| `dimensions.length` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `dimensions.width` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `dimensions.height` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `dimensions.unit` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":10} | `Sample dimensions.unit` |
| `size` | `string` | No | Yes | `text` | {"maxLength":50} | `Sample size` |
| `imagePaths[]` | `string` | **Yes** | Yes | `image_picker` | {"maxLength":500} | `Sample imagePaths[]` |
| `warrantyMonths` | `number` | No | Yes | `numeric` | {"format":"safeint","min":0,"minInclusive":true,"max":240,"maxInclusive":true} | `1` |
| `jewellery.grossWeightGrams` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `jewellery.netWeightGrams` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `jewellery.purity` | `string` | No | Yes | `text` | {"maxLength":20} | `Sample jewellery.purity` |
| `jewellery.makingCharge` | `number` | No | Yes | `numeric` | {"min":0,"minInclusive":true} | `1` |
| `jewellery.makingChargeType` | `enum` | No | Yes | `dropdown` | Enum: `per_gram`, `flat`, `percent` | `per_gram` |
| `jewellery.hallmarkId` | `string` | No | Yes | `text` | {"maxLength":50} | `Sample jewellery.hallmarkId` |
| `jewellery.priceByDailyRate` | `boolean` | No | Yes | `date_picker` | {} | `true` |
| `variantGroupId` | `string` | No | Yes | `text` | {"maxLength":128} | `Sample variantGroupId` |
| `variantAttributes.*` | `string` | **Yes** | Yes | `date_picker` | {"maxLength":60} | `Sample variantAttributes.*` |
| `visibilityScope` | `enum` | No | Yes | `dropdown` | Enum: `all_branches`, `selected_branches`, `branch_only` | `all_branches` |
| `sharedForBranchIds[]` | `string` | **Yes** | Yes | `text` | {} | `Sample sharedForBranchIds[]` |
