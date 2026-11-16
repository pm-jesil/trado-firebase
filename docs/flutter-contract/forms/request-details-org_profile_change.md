# Request Details Schema: `org_profile_change`

**Schema Name:** `OrgProfileChangeDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `field` | `enum` | **Yes** | `dropdown` | Enum: `name`, `businessType`, `businessCategory`, `financialYearStartMonth`, `moduleToggles`, `salesChannels`, `timezone`, `showCostToTenant` | `name` |
| `proposedValue` | `unknown` | **Yes** | `text` | {} | `Sample proposedValue` |
| `reason` | `string` | **Yes** | `text` | {"minLength":5,"maxLength":2000} | `Sample reason` |
