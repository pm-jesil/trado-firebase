/**
 * Built-in Reference Catalogs
 * Provides default module catalog, default system roles, plans, and tax regimes.
 */

import { AppPermissions } from "./permissions.js";

export interface ModuleDefinition {
  code: string;
  name: string;
  description: string;
}

export const DEFAULT_MODULES: ModuleDefinition[] = [
  { code: "billing", name: "Billing & Point of Sale", description: "Invoicing, receipts, and POS cashier operations" },
  { code: "sales", name: "Sales & Orders", description: "B2B and wholesale sales management" },
  { code: "inventory", name: "Inventory & Stock", description: "Stock balance, items, adjustments and ledger" },
  { code: "expenses", name: "Expenses & Petty Cash", description: "Petty cash and daily expense logging" },
  { code: "purchases", name: "Purchases & Procurement", description: "Supplier purchase orders and intake" },
  { code: "customers", name: "Customers & CRM", description: "Customer directory and account balances" },
  { code: "reports", name: "Reports & Analytics", description: "Daily sales summaries and performance analytics" },
  { code: "staff", name: "Staff & Organization", description: "Employee hierarchy, roles, and access management" },
];

export interface TaxRegimeDefinition {
  code: string;
  country: string;
  name: string;
  description: string;
  isDefault: boolean;
}

export const DEFAULT_TAX_REGIMES: TaxRegimeDefinition[] = [
  { code: "IN_GST", country: "IN", name: "India Goods & Services Tax (GST)", description: "Standard Indian GST regime", isDefault: true },
  { code: "AE_VAT", country: "AE", name: "UAE Value Added Tax (VAT)", description: "Standard UAE 5% VAT regime", isDefault: false },
  { code: "US_SALES_TAX", country: "US", name: "US State Sales Tax", description: "US Destination-based sales tax", isDefault: false },
  { code: "NONE", country: "GLOBAL", name: "No Tax / Tax Exempt", description: "Exempt or zero-tax business operations", isDefault: false },
];

export interface SubscriptionPlanDefinition {
  id: string;
  name: string;
  price: number;
  currency: string;
  storageLimitMb: number;
  monthlyDocumentVolumeLimit: number;
  branchLimit: number;
  seatLimits: {
    admin: number;
    staff: number;
  };
  moduleFlags: Record<string, boolean>;
  isActive: boolean;
}

export const DEFAULT_SUBSCRIPTION_PLANS: SubscriptionPlanDefinition[] = [
  {
    id: "plan_starter",
    name: "Starter",
    price: 999,
    currency: "INR",
    storageLimitMb: 500,
    monthlyDocumentVolumeLimit: 1000,
    branchLimit: 1,
    seatLimits: { admin: 1, staff: 4 },
    moduleFlags: {
      billing: true,
      sales: false,
      inventory: true,
      expenses: true,
      purchases: false,
      customers: true,
      reports: true,
      staff: true,
    },
    isActive: true,
  },
  {
    id: "plan_growth",
    name: "Growth",
    price: 2999,
    currency: "INR",
    storageLimitMb: 5000,
    monthlyDocumentVolumeLimit: 10000,
    branchLimit: 3,
    seatLimits: { admin: 3, staff: 20 },
    moduleFlags: {
      billing: true,
      sales: true,
      inventory: true,
      expenses: true,
      purchases: true,
      customers: true,
      reports: true,
      staff: true,
    },
    isActive: true,
  },
  {
    id: "plan_enterprise",
    name: "Enterprise",
    price: 9999,
    currency: "INR",
    storageLimitMb: 50000,
    monthlyDocumentVolumeLimit: 100000,
    branchLimit: 10,
    seatLimits: { admin: 10, staff: 100 },
    moduleFlags: {
      billing: true,
      sales: true,
      inventory: true,
      expenses: true,
      purchases: true,
      customers: true,
      reports: true,
      staff: true,
    },
    isActive: true,
  },
];

export interface SystemRoleDefinition {
  id: string;
  name: string;
  code: string;
  isSystem: boolean;
  description: string;
  permissions: string[];
}

export const DEFAULT_SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    id: "role_org_owner",
    name: "Organization Owner",
    code: "org_owner",
    isSystem: true,
    description: "Full control over all organization resources and settings",
    permissions: [AppPermissions.ALL],
  },
  {
    id: "role_admin",
    name: "Administrator",
    code: "admin",
    isSystem: true,
    description: "Manage day-to-day operations, employees, and reports",
    permissions: [
      AppPermissions.ORG_VIEW,
      AppPermissions.ORG_UPDATE,
      AppPermissions.EMPLOYEE_VIEW,
      AppPermissions.EMPLOYEE_CREATE,
      AppPermissions.EMPLOYEE_UPDATE,
      AppPermissions.ROLE_VIEW,
      AppPermissions.ROLE_ASSIGN,
      AppPermissions.DEPARTMENT_MANAGE,
      AppPermissions.JOB_ROLE_MANAGE,
      AppPermissions.TEAM_MANAGE,
      AppPermissions.BILL_CREATE,
      AppPermissions.BILL_VIEW,
      AppPermissions.BILL_VIEW_ALL,
      AppPermissions.BILL_PRINT,
      AppPermissions.BILL_DISCOUNT,
      AppPermissions.SALE_CREATE,
      AppPermissions.SALE_VIEW,
      AppPermissions.INVENTORY_VIEW,
      AppPermissions.INVENTORY_ADJUST,
      AppPermissions.INVENTORY_MANAGE,
      AppPermissions.EXPENSE_CREATE,
      AppPermissions.EXPENSE_VIEW,
      AppPermissions.EXPENSE_APPROVE,
      AppPermissions.PURCHASE_CREATE,
      AppPermissions.PURCHASE_VIEW,
      AppPermissions.PURCHASE_APPROVE,
      AppPermissions.CUSTOMER_CREATE,
      AppPermissions.CUSTOMER_VIEW,
      AppPermissions.REPORT_VIEW,
      AppPermissions.REPORT_PROFIT,
      AppPermissions.REPORT_EXPORT,
      AppPermissions.AUDIT_VIEW,
    ],
  },
  {
    id: "role_employee",
    name: "Standard Employee",
    code: "employee",
    isSystem: true,
    description: "Baseline organization access for standard employees",
    permissions: [
      AppPermissions.ORG_VIEW,
      AppPermissions.EMPLOYEE_VIEW,
    ],
  },
];

export const STARTER_CUSTOM_ROLE_TEMPLATES = [
  {
    name: "Counter Cashier / POS",
    code: "cashier",
    description: "Generate bills, record walk-in counter sales, accept customer payments",
    permissions: [
      AppPermissions.BILL_CREATE,
      AppPermissions.BILL_VIEW,
      AppPermissions.BILL_PRINT,
      AppPermissions.BILL_DISCOUNT,
      AppPermissions.SALE_CREATE,
      AppPermissions.SALE_VIEW,
      AppPermissions.CUSTOMER_CREATE,
      AppPermissions.CUSTOMER_VIEW,
    ],
  },
  {
    name: "Warehouse & Stock Clerk",
    code: "inventory_clerk",
    description: "Physical stock adjustments, catalog item management and inward purchases",
    permissions: [
      AppPermissions.INVENTORY_VIEW,
      AppPermissions.INVENTORY_ADJUST,
      AppPermissions.INVENTORY_MANAGE,
      AppPermissions.PURCHASE_CREATE,
      AppPermissions.PURCHASE_VIEW,
    ],
  },
];

export interface JobRoleDefinition {
  id: string;
  name: string;
  code: string;
  description: string;
  isSystem: boolean;
}

export const DEFAULT_JOB_ROLES: JobRoleDefinition[] = [
  {
    id: "job_role_store_manager",
    name: "Store Operations Manager",
    code: "store_manager",
    description: "Day-to-day store operations oversight, inventory review, and daily sales supervision",
    isSystem: true,
  },
  {
    id: "job_role_assistant_manager",
    name: "Assistant Store Manager",
    code: "assistant_manager",
    description: "Assists store manager with floor operations, shift supervision, and customer escalation",
    isSystem: true,
  },
  {
    id: "job_role_head_cashier",
    name: "Head Cashier / POS Operator",
    code: "cashier",
    description: "Point of sale checkout, cash drawer management, and customer receipt processing",
    isSystem: true,
  },
  {
    id: "job_role_inventory_specialist",
    name: "Inventory & Stock Specialist",
    code: "inventory_specialist",
    description: "Stock intake, bin management, physical count auditing, and wastage tracking",
    isSystem: true,
  },
  {
    id: "job_role_sales_associate",
    name: "Sales Associate",
    code: "sales_associate",
    description: "B2B client communication, retail sales assistance, and order intake",
    isSystem: true,
  },
  {
    id: "job_role_accountant",
    name: "Staff Accountant",
    code: "accountant",
    description: "Expense bookkeeping, vendor invoices, and financial reconciliation",
    isSystem: true,
  },
];

