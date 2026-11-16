# Request Details Schema: `security_concern`

**Schema Name:** `SecurityConcernDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `description` | `string` | **Yes** | `textarea` | {"minLength":10,"maxLength":5000} | `Sample description` |
| `whenNoticed` | `string` | No | `text` | {} | `Sample whenNoticed` |
| `suspectedImpact` | `string` | No | `text` | {"maxLength":2000} | `Sample suspectedImpact` |
