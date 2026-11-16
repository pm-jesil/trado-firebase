# Request Details Schema: `module_request`

**Schema Name:** `ModuleRequestDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `moduleKey` | `string` | **Yes** | `text` | {"minLength":2,"maxLength":50} | `Sample moduleKey` |
| `action` | `enum` | **Yes** | `dropdown` | Enum: `enable`, `disable` | `enable` |
| `reason` | `string` | **Yes** | `text` | {"minLength":5,"maxLength":2000} | `Sample reason` |
