# Request Details Schema: `ownership_transfer`

**Schema Name:** `OwnershipTransferDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `newOwnerUserId` | `string` | No | `text` | {"minLength":2} | `Sample newOwnerUserId` |
| `newOwnerEmail` | `string` | No | `email` | {"format":"email"} | `Sample newOwnerEmail` |
| `effectiveFrom` | `string` | No | `text` | {} | `Sample effectiveFrom` |
| `reason` | `string` | **Yes** | `text` | {"minLength":10,"maxLength":2000} | `Sample reason` |
