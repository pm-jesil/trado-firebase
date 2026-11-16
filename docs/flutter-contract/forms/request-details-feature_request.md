# Request Details Schema: `feature_request`

**Schema Name:** `FeatureRequestDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `problem` | `string` | **Yes** | `text` | {"minLength":10,"maxLength":5000} | `Sample problem` |
| `businessImpact` | `string` | **Yes** | `text` | {"minLength":10,"maxLength":2000} | `Sample businessImpact` |
| `area` | `string` | **Yes** | `text` | {"minLength":2,"maxLength":100} | `Sample area` |
| `proposedSolution` | `string` | No | `text` | {"maxLength":5000} | `Sample proposedSolution` |
| `neededBy` | `string` | No | `text` | {} | `Sample neededBy` |
| `alternatives` | `string` | No | `date_picker` | {"maxLength":2000} | `Sample alternatives` |
