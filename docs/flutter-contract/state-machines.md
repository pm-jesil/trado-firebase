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
