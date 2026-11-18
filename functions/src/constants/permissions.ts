/**
 * Canonical RBAC Permission Codes
 * Aligned with Flutter client contracts and legacy backend definitions.
 */

export const AppPermissions = {
  // Wildcards
  ALL: "*",

  // Platform Level (Super Admin)
  PLATFORM_ALL: "platform:*",
  PLATFORM_DASHBOARD: "platform:dashboard",
  PLATFORM_FINANCE_VIEW: "platform:finance:view",
  PLATFORM_FINANCE_MANAGE: "platform:finance:manage",
  PLATFORM_TENANTS_VIEW: "platform:tenants:view",
  PLATFORM_TENANTS_MANAGE: "platform:tenants:manage",
  PLATFORM_SUBSCRIPTIONS_VIEW: "platform:subscriptions:view",
  PLATFORM_SUBSCRIPTIONS_MANAGE: "platform:subscriptions:manage",
  PLATFORM_USERS_VIEW: "platform:users:view",
  PLATFORM_USERS_MANAGE: "platform:users:manage",
  PLATFORM_AUDIT_VIEW: "platform:audit:view",
  PLATFORM_REQUESTS_READ: "platform:requests_read",
  PLATFORM_REQUESTS_MANAGE: "platform:requests_manage",
  PLATFORM_REQUESTS_APPLY: "platform:requests_apply",
  PLATFORM_REQUESTS_INTERNAL_NOTES: "platform:requests_internal_notes",
  PLATFORM_REQUESTS_OVERRIDE_BLOCKERS: "platform:requests_override_blockers",
  PLATFORM_REQUESTS_CONFIGURE: "platform:requests_configure",

  // Organization Level
  ORG_VIEW: "org:view",
  ORG_UPDATE: "org:update",
  ORG_SETTINGS: "org:settings",
  ORG_CREATE: "org:create",
  ORG_MODULES: "org:modules",
  ORG_DELETE: "org:delete",

  // Branch Management
  BRANCH_CREATE: "branch:create",
  BRANCH_VIEW: "branch:view",
  BRANCH_UPDATE: "branch:update",
  BRANCH_DEACTIVATE: "branch:deactivate",
  BRANCH_MANAGE: "branch:manage",
  BRANCH_ASSIGN: "branch:assign",

  // Staff, Employees & Roles
  EMPLOYEE_VIEW: "employee:view",
  EMPLOYEE_CREATE: "employee:create",
  EMPLOYEE_UPDATE: "employee:update",
  EMPLOYEE_DELETE: "employee:delete",
  EMPLOYEE_SUSPEND: "employee:suspend",
  EMPLOYEE_RESET_PASSWORD: "employee:reset_password",
  EMPLOYEE_PERMISSION_UPDATE: "employee:permission_update",
  EMPLOYEE_MANAGE_SENSITIVE: "employee:manage_sensitive",
  ROLE_VIEW: "role:view",
  ROLE_CREATE: "role:create",
  ROLE_UPDATE: "role:update",
  ROLE_DELETE: "role:delete",
  ROLE_ASSIGN: "role:assign",
  DEPARTMENT_MANAGE: "department:manage",
  JOB_ROLE_MANAGE: "job_role:manage",
  TEAM_MANAGE: "team:manage",
  AUDIT_VIEW: "audit:view",
  AUDIT_READ_OWN: "audit:read_own", // a member's own activity only
  USAGE_READ: "usage:read", // the organization's usage quantities (prompt 66 Part 7)
  USAGE_READ_USERS: "usage:read_users", // usage per user (every member sees their own)

  // Billing & POS
  BILL_CREATE: "bill:create",
  BILL_VIEW: "bill:view",
  BILL_VIEW_ALL: "bill:view_all",
  BILL_UPDATE: "bill:update",
  BILL_PRINT: "bill:print",
  BILL_DISCOUNT: "bill:discount",
  BILL_VOID: "bill:void",
  BILL_RETURN: "bill:return",
  BILL_APPROVE: "bill:approve",

  // Sales
  SALE_CREATE: "sale:create",
  SALE_VIEW: "sale:view",

  // Inventory & Catalog
  INVENTORY_VIEW: "inventory:view",
  INVENTORY_ADJUST: "inventory:adjust",
  INVENTORY_MANAGE: "inventory:manage",

  // Expenses & Purchases
  EXPENSE_CREATE: "expense:create",
  EXPENSE_VIEW: "expense:view",
  EXPENSE_APPROVE: "expense:approve",
  PURCHASE_CREATE: "purchase:create",
  PURCHASE_VIEW: "purchase:view",
  PURCHASE_APPROVE: "purchase:approve",
  PURCHASE_VOID: "purchase:void",
  EXPENSE_VOID: "expense:void",
  EXPENSE_VIEW_SENSITIVE: "expense:view_sensitive", // Salary / employee-linked expenses

  // Customers
  CUSTOMER_CREATE: "customer:create",
  CUSTOMER_VIEW: "customer:view",
  CUSTOMER_UPDATE: "customer:update",
  CUSTOMER_DELETE: "customer:delete",
  CUSTOMER_VIEW_BALANCE: "customer:view_balance", // Outstanding, credit, total spend

  // Vendors & Suppliers
  VENDOR_CREATE: "vendor:create",
  VENDOR_VIEW: "vendor:view",
  VENDOR_UPDATE: "vendor:update",
  VENDOR_DELETE: "vendor:delete",
  VENDOR_VIEW_BALANCE: "vendor:view_balance", // Payables, total purchase

  // Products, Categories & Units
  PRODUCT_CREATE: "product:create",
  PRODUCT_VIEW: "product:view",
  PRODUCT_UPDATE: "product:update",
  PRODUCT_DELETE: "product:delete",
  PRODUCT_VIEW_COST: "product:view_cost", // Cost price, WAC, margins
  CATEGORY_MANAGE: "category:manage",
  CATEGORY_VIEW: "category:view",
  UNIT_MANAGE: "unit:manage",
  UNIT_VIEW: "unit:view",

  // Stock & Inventory Movements
  STOCK_VIEW: "stock:view",
  STOCK_ADJUST: "stock:adjust",
  STOCK_TRANSFER: "stock:transfer",
  STOCK_APPROVE: "stock:approve",

  // Outflows (Unified Purchases & Expenses)
  OUTFLOW_CREATE: "outflow:create",
  OUTFLOW_VIEW: "outflow:view",
  OUTFLOW_APPROVE: "outflow:approve",
  OUTFLOW_VOID: "outflow:void",

  // Payments Ledger
  PAYMENT_CREATE: "payment:create",
  PAYMENT_VIEW: "payment:view",
  PAYMENT_VOID: "payment:void",
  PAYMENT_FEE_MANAGE: "payment:fee_manage",
  PAYMENT_FEE_VERIFY: "payment:fee_verify",

  // Deliveries & Dispatch
  DELIVERY_CREATE: "delivery:create",
  DELIVERY_VIEW: "delivery:view",
  DELIVERY_UPDATE: "delivery:update",
  DELIVERY_ASSIGN: "delivery:assign",

  // Returns (Sales & Purchase Returns)
  RETURN_CREATE: "return:create",
  RETURN_VIEW: "return:view",
  RETURN_APPROVE: "return:approve",

  // Reports
  REPORT_VIEW: "report:view",
  REPORT_PROFIT: "report:profit",
  REPORT_EXPORT: "report:export",

  // Tasks
  TASK_CREATE: "task:create",
  TASK_VIEW: "task:view",
  TASK_UPDATE: "task:update",
  TASK_DELETE: "task:delete",
  TASK_ASSIGN: "task:assign",

  // Live Location Tracking
  LOCATION_PING: "location:ping",
  LOCATION_VIEW_OWN: "location:view_own",
  LOCATION_VIEW_ALL: "location:view_all",
  LOCATION_MANAGE: "location:manage",

  // Notifications
  NOTIFICATION_VIEW: "notification:view",

  // Requests & Support Desk
  REQUEST_CREATE: "requests:create",
  REQUEST_CREATE_SENSITIVE: "requests:create_sensitive",
  REQUEST_READ_OWN: "requests:read_own",
  REQUEST_READ_ORG: "requests:read_org",
  REQUEST_COMMENT: "requests:comment",
  REQUEST_MANAGE_ORG: "requests:manage_org",

  // Financial Accounts & Ledger
  ACCOUNT_VIEW: "accounts:view",
  ACCOUNT_MANAGE: "accounts:manage",
  ACCOUNT_TRANSFER: "accounts:transfer",
  ACCOUNT_RECONCILE: "accounts:reconcile",
  LEDGER_VIEW: "ledger:view",
  RECEIVABLES_VIEW: "receivables:view",
  PAYABLES_VIEW: "payables:view",
  CAPITAL_MANAGE: "capital:manage",
  CAPITAL_VIEW: "capital:view",

  // Approvals Inbox
  APPROVALS_VIEW: "approvals:view",

  // Warehouse & Storage Locations
  WAREHOUSE_VIEW: "warehouse:view",
  WAREHOUSE_MANAGE: "warehouse:manage",

  // Granular Stock Transfers
  STOCK_TRANSFER_CREATE: "stock:transfer_create",
  STOCK_TRANSFER_APPROVE: "stock:transfer_approve",
  STOCK_TRANSFER_DISPATCH: "stock:transfer_dispatch",
  STOCK_TRANSFER_RECEIVE: "stock:transfer_receive",
} as const;

export type PermissionCode = typeof AppPermissions[keyof typeof AppPermissions] | string;
