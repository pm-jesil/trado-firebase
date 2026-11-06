# Feature Guide: Tasks & Employee Field Operations

---

## 1. Purpose & Scope
This module provides internal work assignments, operational checklists, and task tracking for Trado:
- **Task Master**: `tasks/{taskId}` manages operational duties, deadlines, priority levels, and completion status.
- **Self-Assignment Guard**: Strict permission separation preventing standard employees from assigning tasks to managers or peers.
- **Reference-by-ID Architecture**: Tasks link to related orders (`billId`) or other operational records (`relatedEntityId`) by ID only.
- **Status Lifecycle**: Tracks work progression (`pending -> in_progress -> completed -> cancelled`).

---

## 2. Actors & Permissions
- **Organization Owner & Store Admin**: Requires `task:create` and `task:assign`. Can create tasks and assign them to any active employee in the tenant organization.
- **Standard Employees** (`role_employee`):
  - Can create personal reminder tasks for themselves.
  - **Cannot** assign tasks to other staff members (fails with `permission-denied`).
  - Can update the status of tasks assigned to them (`tasksUpdateStatus`).
  - Can list tasks assigned to them (`tasksList`).

---

## 3. Task Status Lifecycle

```
    [Create Task]
          |
          v
      (PENDING) ------[Staff starts work]------> (IN_PROGRESS)
          |                                            |
          |                                            +-----> (COMPLETED) [Done]
          +------------[Cancel / Void]-------------> (CANCELLED)
```

### Supported Priorities
- `low`: Non-urgent housekeeping or routine audits.
- `medium`: Normal stock replenishment or standard customer follow-ups.
- `high`: Expedited order packing or urgent vehicle dispatch.
- `urgent`: Discrepancy investigation, critical stock-out resolution.

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Manager Assigns an Inventory Audit Task
1. **Admin calls `tasksCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "title": "Inspect fresh produce shipment",
       "description": "Verify bag count and check for water damage in bay 3",
       "priority": "high",
       "assignedToMembershipId": "mem_emp_001",
       "dueDate": "2026-10-30T18:00:00Z"
     }
     ```
2. **Backend Processing**:
   - Validates that `mem_emp_001` belongs to `org_demo` and is active.
   - Commits `tasks/{taskId}` with `status: "pending"`.
   - Writes an automated in-app notification to `notifications` alerting `mem_emp_001`.

### 4.2 Employee Completes the Task
1. **Employee calls `tasksUpdateStatus`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "taskId": "task_produce_001",
       "status": "completed"
     }
     ```
2. **Backend Execution**:
   - Verifies caller is assigned to the task (or is an Admin/Owner).
   - Updates `tasks/task_produce_001`: sets `status: "completed"`, `completedAt: "<timestamp>"`.

---

## 5. Security & Boundary Rules
- **Cross-Tenant Guard**: Tasks cannot be assigned to memberships belonging to other tenant organizations.
- **Self-Assignment Enforcement**: If an employee without `task:assign` attempts to pass an `assignedToMembershipId` other than their own, the backend throws `permission-denied: "Employees can only assign tasks to themselves. Admin or Owner permission required to assign to others."`.
- **Anti-Embedding Compliance**: Related bills or parties are referenced by bare ID (`billId`, `relatedEntityId`). Full documents are not embedded.

---

## 6. Local Testing & Verification
- **Integration Tests**: Part 2 of `functions/scripts/test-phase3-integration.js`.
  - Tests verify task creation by manager, self-assignment by employee, rejection of employee attempting to assign to admin, task listing, status completion transition, and task deletion.

