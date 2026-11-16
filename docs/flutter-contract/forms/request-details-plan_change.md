# Request Details Schema: `plan_change`

**Schema Name:** `PlanChangeDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `requestedPlanId` | `string` | **Yes** | `text` | {"minLength":1,"maxLength":100} | `Sample requestedPlanId` |
| `billingPeriod` | `enum` | No | `dropdown` | Enum: `monthly`, `yearly` | `monthly` |
| `effectiveFrom` | `string` | No | `text` | {} | `Sample effectiveFrom` |
| `reason` | `string` | **Yes** | `text` | {"minLength":10,"maxLength":2000} | `Sample reason` |
