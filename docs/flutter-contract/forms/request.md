# Form Contract: Request / Support Ticket (`request`)

**Create Callable:** `requestsCreate`  
**Update / Action Callable:** `requestsUpdate`  

| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |
|---|---|---|---|---|---|---|
| `organizationId` | `string` | No | Yes | `date_picker` | {"minLength":2} | `Sample organizationId` |
| `branchId` | `string` | No | Yes | `text` | {} | `Sample branchId` |
| `audience` | `enum` | No | No | `dropdown` | Enum: `platform`, `organization` | `platform` |
| `category` | `enum` | **Yes** | No | `date_picker` | Enum: `plan_change`, `limit_increase`, `module_request`, `billing_query`, `org_profile_change`, `ownership_transfer`, `bug_report`, `data_issue`, `feature_request`, `improvement`, `support_question`, `other`, `data_request`, `security_concern`, `access_request` | `plan_change` |
| `title` | `string` | **Yes** | Yes | `text` | {"minLength":3,"maxLength":120} | `Sample title` |
| `description` | `string` | **Yes** | Yes | `textarea` | {"minLength":3,"maxLength":5000} | `Sample description` |
| `details.*` | `unknown` | **Yes** | Yes | `text` | {} | `Sample details.*` |
| `priority` | `enum` | No | No | `dropdown` | Enum: `low`, `normal`, `high`, `urgent` | `low` |
| `severity` | `enum` | No | No | `dropdown` | Enum: `minor`, `major`, `critical` | `minor` |
| `relatedEntity.type` | `string` | No | No | `date_picker` | {"minLength":2,"maxLength":50} | `Sample relatedEntity.type` |
| `relatedEntity.id` | `string` | No | No | `date_picker` | {"minLength":1,"maxLength":128} | `Sample relatedEntity.id` |
| `relatedEntity.label` | `string` | No | No | `date_picker` | {"minLength":1,"maxLength":120} | `Sample relatedEntity.label` |
| `attachments[].storagePath` | `string` | **Yes** | Yes | `date_picker` | {"minLength":5,"maxLength":500} | `Sample attachments[].storagePath` |
| `attachments[].filename` | `string` | **Yes** | Yes | `date_picker` | {"minLength":1,"maxLength":255} | `Sample attachments[].filename` |
| `attachments[].mimeType` | `enum` | **Yes** | Yes | `date_picker` | Enum: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | `image/jpeg` |
| `attachments[].sizeBytes` | `number` | **Yes** | Yes | `date_picker` | {"format":"safeint","min":0,"minInclusive":false,"max":5242880,"maxInclusive":true} | `1` |
| `attachments[].uploadedAt` | `string` | No | Yes | `date_picker` | {"format":"datetime"} | `Sample attachments[].uploadedAt` |
| `labels[]` | `string` | **Yes** | No | `text` | {"minLength":1,"maxLength":50} | `Sample labels[]` |
| `idempotencyKey` | `string` | No | No | `text` | {"minLength":8,"maxLength":128} | `Sample idempotencyKey` |
| `clientRequestId` | `string` | No | Yes | `text` | {"minLength":8,"maxLength":128} | `Sample clientRequestId` |
