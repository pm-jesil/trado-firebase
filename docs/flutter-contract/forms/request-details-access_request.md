# Request Details Schema: `access_request`

**Schema Name:** `AccessRequestDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `permissionKeys[]` | `string` | **Yes** | `text` | {"minLength":2} | `Sample permissionKeys[]` |
| `roleId` | `string` | No | `text` | {"maxLength":100} | `Sample roleId` |
| `branchId` | `string` | No | `text` | {"maxLength":100} | `Sample branchId` |
| `reason` | `string` | **Yes** | `text` | {"minLength":5,"maxLength":2000} | `Sample reason` |
| `until` | `string` | No | `text` | {} | `Sample until` |
