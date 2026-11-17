# Form Contract: Stock Transfer (`stock_transfer`)

**Create Callable:** `stockTransfersCreate`  
**Update / Action Callable:** `stockTransfersDispatch`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `sourceBranchId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample sourceBranchId` |
| `destinationBranchId` | `string` | **Yes** | Yes | `date_picker` | {"minLength":2} | `Sample destinationBranchId` |
| `sourceLocationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample sourceLocationId` |
| `destinationLocationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample destinationLocationId` |
| `items[].productId` | `string` | **Yes** | Yes | `text` | {"minLength":2} | `Sample items[].productId` |
| `items[].requestedQty` | `number` | **Yes** | Yes | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `items[].unit` | `string` | No | Yes | `text` | {"minLength":1,"maxLength":30} | `Sample items[].unit` |
| `items[].notes` | `string` | No | Yes | `textarea` | {"maxLength":200} | `Sample items[].notes` |
| `notes` | `string` | No | Yes | `textarea` | {"maxLength":500} | `Sample notes` |
| `idempotencyKey` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
