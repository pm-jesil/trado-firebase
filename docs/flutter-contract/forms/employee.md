# Form Contract: Employee / User (`employee`)

**Create Callable:** `employeesCreate`  
**Update / Action Callable:** `employeesUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `email` | `string` | **Yes** | No | `email` | {"format":"email"} | `Sample email` |
| `name` | `string` | **Yes** | Yes | `text` | {"minLength":2,"maxLength":100} | `Sample name` |
| `phone` | `string` | No | Yes | `phone` | {} | `Sample phone` |
| `image.path` | `string` | No | Yes | `image_picker` | {"minLength":5,"maxLength":500} | `Sample image.path` |
| `image.contentType` | `enum` | No | Yes | `image_picker` | Enum: `image/jpeg`, `image/png`, `image/webp` | `image/jpeg` |
| `image.width` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10000,"maxInclusive":true} | `1` |
| `image.height` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10000,"maxInclusive":true} | `1` |
| `image.sizeBytes` | `number` | No | Yes | `image_picker` | {"format":"safeint","min":1,"minInclusive":true,"max":10485760,"maxInclusive":true} | `1` |
| `image.updatedAt` | `string` | No | Yes | `image_picker` | {} | `Sample image.updatedAt` |
| `image.thumbnailPath` | `string` | No | Yes | `image_picker` | {"minLength":5,"maxLength":500} | `Sample image.thumbnailPath` |
| `uploadId` | `string` | No | Yes | `text` | {} | `Sample uploadId` |
| `initialPassword` | `string` | No | No | `password` | {"minLength":8,"maxLength":128} | `Sample initialPassword` |
| `roleId` | `string` | No | Yes | `text` | {"minLength":2} | `Sample roleId` |
| `departmentId` | `string` | No | Yes | `text` | {} | `Sample departmentId` |
| `jobRoleIds[]` | `string` | **Yes** | Yes | `text` | {} | `Sample jobRoleIds[]` |
| `teamId` | `string` | No | Yes | `text` | {} | `Sample teamId` |
| `reportingToIds[]` | `string` | **Yes** | Yes | `text` | {} | `Sample reportingToIds[]` |
| `permissionOverrides.*` | `boolean` | **Yes** | Yes | `switch` | {} | `true` |
| `branchIds[]` | `string` | **Yes** | No | `text` | {} | `Sample branchIds[]` |
| `defaultBranchId` | `string` | No | No | `text` | {} | `Sample defaultBranchId` |
