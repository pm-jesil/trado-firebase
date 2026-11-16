# Document State Machines & Status Transitions

Derived directly from backend transaction validators.

| Entity | Initial Status | Valid Transitions | Terminal States | Mutating Callables |
|---|---|---|---|---|
| **bill** | `draft` | `draft` → `active` (finalize)<br>`active` → `paid`<br>`active` → `void` | `void`, `paid` | `billsCreate`, `billsFinalize`, `billsVoid` |
| **outflow** | `pending` | `pending` → `confirmed`<br>`confirmed` → `void` | `void` | `outflowsCreate`, `outflowsVoid` |
| **delivery** | `pending` | `pending` → `assigned`<br>`assigned` → `in_transit`<br>`in_transit` → `delivered` / `failed` / `cancelled` | `delivered`, `cancelled` | `deliveriesCreate`, `deliveriesUpdateStatus` |
| **return** | `pending` | `pending` → `completed`<br>`pending` → `rejected` | `completed`, `rejected` | `returnsCreate`, `approvalsDecide` |
| **task** | `todo` | `todo` → `in_progress`<br>`in_progress` → `completed` / `cancelled` | `completed`, `cancelled` | `tasksCreate`, `tasksUpdateStatus` |
| **membership** | `active` | `active` → `deactivated` | `deactivated` | `employeesDeactivate` |
| **organization** | `active` | `active` → `deactivated` → `reactivated` / `suspended` | `suspended` | `organizationsDeactivate`, `organizationsReactivate` |
| **request-approval** | `submitted` | `submitted` → `in_review`, `needs_info`, `on_hold`, `approved`, `rejected`, `cancelled`<br>`in_review` → `needs_info`, `on_hold`, `approved`, `rejected`, `cancelled`<br>`needs_info` → `in_review`, `cancelled`<br>`on_hold` → `in_review`, `cancelled`<br>`approved` → `applied` | `rejected`, `applied`, `cancelled` | `requestsCreate`, `requestsTransition`, `requestsApply` |
| **request-work** | `submitted` | `submitted` → `in_review`, `in_progress`, `needs_info`, `on_hold`, `resolved`, `declined`, `cancelled`<br>`in_review` → `in_progress`, `needs_info`, `on_hold`, `resolved`, `declined`, `cancelled`<br>`in_progress` → `needs_info`, `on_hold`, `resolved`, `declined`, `cancelled`<br>`needs_info` → `in_review`, `cancelled`<br>`on_hold` → `in_review`, `cancelled`<br>`resolved` → `closed`, `in_review`<br>`closed` → `in_review` | `declined`, `closed`, `cancelled` | `requestsCreate`, `requestsTransition` |
