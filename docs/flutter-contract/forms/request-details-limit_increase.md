# Request Details Schema: `limit_increase`

**Schema Name:** `LimitIncreaseDetailsSchema`  
**Form Target:** `requestsCreate` / `requestsUpdate` (details payload)

| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|
| `metric` | `enum` | **Yes** | `dropdown` | Enum: `firestoreReads`, `firestoreWrites`, `firestoreDeletes`, `functionsInvocations`, `functionsErrors`, `functionsExecutionMs`, `storageUploadBytes`, `storageDownloadBytes`, `storageOperations`, `authOperations`, `fcmDispatches`, `locationPings` | `firestoreReads` |
| `period` | `enum` | **Yes** | `dropdown` | Enum: `daily`, `monthly` | `daily` |
| `requestedLimit` | `number` | **Yes** | `numeric` | {"format":"safeint","min":0,"minInclusive":false} | `1` |
| `reason` | `string` | **Yes** | `text` | {"minLength":5,"maxLength":2000} | `Sample reason` |
