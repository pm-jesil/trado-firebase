# Form Contract: Subscription Plan (`plan`)

**Create Callable:** `plansCreate`  
**Update / Action Callable:** `plansUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `price` | `number` | **Yes** | Yes | `money_paise` | {"min":0,"minInclusive":true} | `2500` |
| `currency` | `string` | **Yes** | No | `text` | {"maxLength":3,"minLength":3} | `Sample currency` |
| `storageLimitMb` | `number` | **Yes** | No | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `monthlyDocumentVolumeLimit` | `number` | **Yes** | No | `numeric` | {"min":0,"minInclusive":false} | `1` |
| `seatLimits.admin` | `number` | **Yes** | No | `date_picker` | {"format":"safeint","min":0,"minInclusive":false} | `1` |
| `seatLimits.staff` | `number` | **Yes** | No | `date_picker` | {"format":"safeint","min":0,"minInclusive":false} | `1` |
| `branchLimit` | `number` | No | Yes | `numeric` | {"format":"safeint","min":0,"minInclusive":false} | `1` |
| `moduleFlags.*` | `boolean` | **Yes** | Yes | `switch` | {} | `true` |
| `isActive` | `boolean` | No | Yes | `switch` | {} | `true` |
