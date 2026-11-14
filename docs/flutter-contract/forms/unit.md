# Form Contract: Unit (`unit`)

**Create Callable:** `unitsCreate`  
**Update / Action Callable:** `unitsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {} | `Sample organizationId` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":1,"maxLength":50} | `Sample name` |
| `code` | `string` | **Yes** | No | `text` | {"minLength":1,"maxLength":20} | `Sample code` |
| `group` | `enum` | No | No | `dropdown` | Enum: `count`, `weight`, `volume`, `length`, `area`, `time` | `count` |
| `precision` | `number` | No | Yes | `numeric` | {"format":"safeint","min":0,"minInclusive":true,"max":4,"maxInclusive":true} | `1` |
| `baseUnit` | `string` | No | No | `text` | {} | `Sample baseUnit` |
| `conversionFactor` | `number` | No | No | `numeric` | {"min":0,"minInclusive":false} | `1` |
