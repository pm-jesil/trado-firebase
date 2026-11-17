# Permission Catalog & UI Gating

Total permissions: **146**

## Permission Key Directory
| Permission Constant | Wire Key | Category |
|---|---|---|
| `ALL` | `*` | `*` |
| `PLATFORM_ALL` | `platform:*` | `platform` |
| `PLATFORM_DASHBOARD` | `platform:dashboard` | `platform` |
| `PLATFORM_FINANCE_VIEW` | `platform:finance:view` | `platform` |
| `PLATFORM_FINANCE_MANAGE` | `platform:finance:manage` | `platform` |
| `PLATFORM_TENANTS_VIEW` | `platform:tenants:view` | `platform` |
| `PLATFORM_TENANTS_MANAGE` | `platform:tenants:manage` | `platform` |
| `PLATFORM_SUBSCRIPTIONS_VIEW` | `platform:subscriptions:view` | `platform` |
| `PLATFORM_SUBSCRIPTIONS_MANAGE` | `platform:subscriptions:manage` | `platform` |
| `PLATFORM_USERS_VIEW` | `platform:users:view` | `platform` |
| `PLATFORM_USERS_MANAGE` | `platform:users:manage` | `platform` |
| `PLATFORM_AUDIT_VIEW` | `platform:audit:view` | `platform` |
| `PLATFORM_REQUESTS_READ` | `platform:requests_read` | `platform` |
| `PLATFORM_REQUESTS_MANAGE` | `platform:requests_manage` | `platform` |
| `PLATFORM_REQUESTS_APPLY` | `platform:requests_apply` | `platform` |
| `PLATFORM_REQUESTS_INTERNAL_NOTES` | `platform:requests_internal_notes` | `platform` |
| `PLATFORM_REQUESTS_OVERRIDE_BLOCKERS` | `platform:requests_override_blockers` | `platform` |
| `PLATFORM_REQUESTS_CONFIGURE` | `platform:requests_configure` | `platform` |
| `ORG_VIEW` | `org:view` | `org` |
| `ORG_UPDATE` | `org:update` | `org` |
| `ORG_SETTINGS` | `org:settings` | `org` |
| `ORG_CREATE` | `org:create` | `org` |
| `ORG_MODULES` | `org:modules` | `org` |
| `ORG_DELETE` | `org:delete` | `org` |
| `BRANCH_CREATE` | `branch:create` | `branch` |
| `BRANCH_VIEW` | `branch:view` | `branch` |
| `BRANCH_UPDATE` | `branch:update` | `branch` |
| `BRANCH_DEACTIVATE` | `branch:deactivate` | `branch` |
| `BRANCH_MANAGE` | `branch:manage` | `branch` |
| `BRANCH_ASSIGN` | `branch:assign` | `branch` |
| `EMPLOYEE_VIEW` | `employee:view` | `employee` |
| `EMPLOYEE_CREATE` | `employee:create` | `employee` |
| `EMPLOYEE_UPDATE` | `employee:update` | `employee` |
| `EMPLOYEE_DELETE` | `employee:delete` | `employee` |
| `EMPLOYEE_SUSPEND` | `employee:suspend` | `employee` |
| `EMPLOYEE_RESET_PASSWORD` | `employee:reset_password` | `employee` |
| `EMPLOYEE_PERMISSION_UPDATE` | `employee:permission_update` | `employee` |
| `EMPLOYEE_MANAGE_SENSITIVE` | `employee:manage_sensitive` | `employee` |
| `ROLE_VIEW` | `role:view` | `role` |
| `ROLE_CREATE` | `role:create` | `role` |
| `ROLE_UPDATE` | `role:update` | `role` |
| `ROLE_DELETE` | `role:delete` | `role` |
| `ROLE_ASSIGN` | `role:assign` | `role` |
| `DEPARTMENT_MANAGE` | `department:manage` | `department` |
| `JOB_ROLE_MANAGE` | `job_role:manage` | `job_role` |
| `TEAM_MANAGE` | `team:manage` | `team` |
| `AUDIT_VIEW` | `audit:view` | `audit` |
| `AUDIT_READ_OWN` | `audit:read_own` | `audit` |
| `USAGE_READ` | `usage:read` | `usage` |
| `USAGE_READ_USERS` | `usage:read_users` | `usage` |
| `BILL_CREATE` | `bill:create` | `bill` |
| `BILL_VIEW` | `bill:view` | `bill` |
| `BILL_VIEW_ALL` | `bill:view_all` | `bill` |
| `BILL_UPDATE` | `bill:update` | `bill` |
| `BILL_PRINT` | `bill:print` | `bill` |
| `BILL_DISCOUNT` | `bill:discount` | `bill` |
| `BILL_VOID` | `bill:void` | `bill` |
| `BILL_RETURN` | `bill:return` | `bill` |
| `BILL_APPROVE` | `bill:approve` | `bill` |
| `SALE_CREATE` | `sale:create` | `sale` |
| `SALE_VIEW` | `sale:view` | `sale` |
| `INVENTORY_VIEW` | `inventory:view` | `inventory` |
| `INVENTORY_ADJUST` | `inventory:adjust` | `inventory` |
| `INVENTORY_MANAGE` | `inventory:manage` | `inventory` |
| `EXPENSE_CREATE` | `expense:create` | `expense` |
| `EXPENSE_VIEW` | `expense:view` | `expense` |
| `EXPENSE_APPROVE` | `expense:approve` | `expense` |
| `PURCHASE_CREATE` | `purchase:create` | `purchase` |
| `PURCHASE_VIEW` | `purchase:view` | `purchase` |
| `PURCHASE_APPROVE` | `purchase:approve` | `purchase` |
| `PURCHASE_VOID` | `purchase:void` | `purchase` |
| `EXPENSE_VOID` | `expense:void` | `expense` |
| `EXPENSE_VIEW_SENSITIVE` | `expense:view_sensitive` | `expense` |
| `CUSTOMER_CREATE` | `customer:create` | `customer` |
| `CUSTOMER_VIEW` | `customer:view` | `customer` |
| `CUSTOMER_UPDATE` | `customer:update` | `customer` |
| `CUSTOMER_DELETE` | `customer:delete` | `customer` |
| `CUSTOMER_VIEW_BALANCE` | `customer:view_balance` | `customer` |
| `VENDOR_CREATE` | `vendor:create` | `vendor` |
| `VENDOR_VIEW` | `vendor:view` | `vendor` |
| `VENDOR_UPDATE` | `vendor:update` | `vendor` |
| `VENDOR_DELETE` | `vendor:delete` | `vendor` |
| `VENDOR_VIEW_BALANCE` | `vendor:view_balance` | `vendor` |
| `PRODUCT_CREATE` | `product:create` | `product` |
| `PRODUCT_VIEW` | `product:view` | `product` |
| `PRODUCT_UPDATE` | `product:update` | `product` |
| `PRODUCT_DELETE` | `product:delete` | `product` |
| `PRODUCT_VIEW_COST` | `product:view_cost` | `product` |
| `CATEGORY_MANAGE` | `category:manage` | `category` |
| `CATEGORY_VIEW` | `category:view` | `category` |
| `UNIT_MANAGE` | `unit:manage` | `unit` |
| `UNIT_VIEW` | `unit:view` | `unit` |
| `STOCK_VIEW` | `stock:view` | `stock` |
| `STOCK_ADJUST` | `stock:adjust` | `stock` |
| `STOCK_TRANSFER` | `stock:transfer` | `stock` |
| `STOCK_APPROVE` | `stock:approve` | `stock` |
| `OUTFLOW_CREATE` | `outflow:create` | `outflow` |
| `OUTFLOW_VIEW` | `outflow:view` | `outflow` |
| `OUTFLOW_APPROVE` | `outflow:approve` | `outflow` |
| `OUTFLOW_VOID` | `outflow:void` | `outflow` |
| `PAYMENT_CREATE` | `payment:create` | `payment` |
| `PAYMENT_VIEW` | `payment:view` | `payment` |
| `PAYMENT_VOID` | `payment:void` | `payment` |
| `PAYMENT_FEE_MANAGE` | `payment:fee_manage` | `payment` |
| `DELIVERY_CREATE` | `delivery:create` | `delivery` |
| `DELIVERY_VIEW` | `delivery:view` | `delivery` |
| `DELIVERY_UPDATE` | `delivery:update` | `delivery` |
| `DELIVERY_ASSIGN` | `delivery:assign` | `delivery` |
| `RETURN_CREATE` | `return:create` | `return` |
| `RETURN_VIEW` | `return:view` | `return` |
| `RETURN_APPROVE` | `return:approve` | `return` |
| `REPORT_VIEW` | `report:view` | `report` |
| `REPORT_PROFIT` | `report:profit` | `report` |
| `REPORT_EXPORT` | `report:export` | `report` |
| `TASK_CREATE` | `task:create` | `task` |
| `TASK_VIEW` | `task:view` | `task` |
| `TASK_UPDATE` | `task:update` | `task` |
| `TASK_DELETE` | `task:delete` | `task` |
| `TASK_ASSIGN` | `task:assign` | `task` |
| `LOCATION_PING` | `location:ping` | `location` |
| `LOCATION_VIEW_OWN` | `location:view_own` | `location` |
| `LOCATION_VIEW_ALL` | `location:view_all` | `location` |
| `LOCATION_MANAGE` | `location:manage` | `location` |
| `NOTIFICATION_VIEW` | `notification:view` | `notification` |
| `REQUEST_CREATE` | `requests:create` | `requests` |
| `REQUEST_CREATE_SENSITIVE` | `requests:create_sensitive` | `requests` |
| `REQUEST_READ_OWN` | `requests:read_own` | `requests` |
| `REQUEST_READ_ORG` | `requests:read_org` | `requests` |
| `REQUEST_COMMENT` | `requests:comment` | `requests` |
| `REQUEST_MANAGE_ORG` | `requests:manage_org` | `requests` |
| `ACCOUNT_VIEW` | `accounts:view` | `accounts` |
| `ACCOUNT_MANAGE` | `accounts:manage` | `accounts` |
| `ACCOUNT_TRANSFER` | `accounts:transfer` | `accounts` |
| `ACCOUNT_RECONCILE` | `accounts:reconcile` | `accounts` |
| `LEDGER_VIEW` | `ledger:view` | `ledger` |
| `RECEIVABLES_VIEW` | `receivables:view` | `receivables` |
| `PAYABLES_VIEW` | `payables:view` | `payables` |
| `CAPITAL_MANAGE` | `capital:manage` | `capital` |
| `CAPITAL_VIEW` | `capital:view` | `capital` |
| `APPROVALS_VIEW` | `approvals:view` | `approvals` |
| `WAREHOUSE_VIEW` | `warehouse:view` | `warehouse` |
| `WAREHOUSE_MANAGE` | `warehouse:manage` | `warehouse` |
| `STOCK_TRANSFER_CREATE` | `stock:transfer_create` | `stock` |
| `STOCK_TRANSFER_APPROVE` | `stock:transfer_approve` | `stock` |
| `STOCK_TRANSFER_DISPATCH` | `stock:transfer_dispatch` | `stock` |
| `STOCK_TRANSFER_RECEIVE` | `stock:transfer_receive` | `stock` |

## UI Gating in Flutter
Every client session receives effective permissions inside the `authMe` bootstrap payload.
```dart
bool can(String permissionKey) {
  return currentUser.effectivePermissions[permissionKey] == true;
}

// Example: Gating a button
if (can('bill:create')) {
  ElevatedButton(onPressed: _onCreateBill, child: Text('New Bill'));
}
```
