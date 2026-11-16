# Request Details Schema: `data_request`

**Schema Name:** `DataRequestDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `type` | `enum` | **Yes** | `dropdown` | Enum: `export`, `correction`, `deletion` | `export` |
| `scope` | `string` | **Yes** | `text` | {"minLength":5,"maxLength":1000} | `Sample scope` |
| `reason` | `string` | **Yes** | `text` | {"minLength":10,"maxLength":2000} | `Sample reason` |
| `confirmationText` | `string` | No | `date_picker` | {"maxLength":100} | `Sample confirmationText` |
