# Request Details Schema: `data_issue`

**Schema Name:** `DataIssueDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `entityType` | `string` | **Yes** | `text` | {"minLength":2,"maxLength":100} | `Sample entityType` |
| `entityId` | `string` | No | `text` | {"maxLength":128} | `Sample entityId` |
| `whatIsWrong` | `string` | **Yes** | `date_picker` | {"minLength":5,"maxLength":2000} | `Sample whatIsWrong` |
| `expected` | `string` | **Yes** | `text` | {"minLength":2,"maxLength":2000} | `Sample expected` |
