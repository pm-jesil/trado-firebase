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
  ROLE_VIEW: "role:view",
  ROLE_CREATE: "role:create",
  ROLE_UPDATE: "role:update",
  ROLE_DELETE: "role:delete",
  ROLE_ASSIGN: "role:assign",
  DEPARTMENT_MANAGE: "department:manage",
  JOB_ROLE_MANAGE: "job_role:manage",
  TEAM_MANAGE: "team:manage",
  AUDIT_VIEW: "audit:view",

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
} as const;

export type PermissionCode = typeof AppPermissions[keyof typeof AppPermissions] | string;
