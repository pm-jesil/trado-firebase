# Form Contract: Stock Adjustment / Wastage (`stock_adjustment`)

**Create Callable:** `stockAdjust`  
**Update / Action Callable:** `stockGetLevels`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `storageLocationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample storageLocationId` |
| `productId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample productId` |
| `quantity` | `number` | **Yes** | Yes | `numeric` | {} | `1` |
| `reason` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":500} | `Sample reason` |
| `reasonCode` | `enum` | No | Yes | `dropdown` | Enum: `damaged`, `expired`, `lost_theft`, `sample`, `internal_use`, `damaged_on_receipt`, `count_correction`, `opening_stock`, `other` | `damaged` |
| `serialNumbers[]` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":64} | `Sample serialNumbers[]` |
