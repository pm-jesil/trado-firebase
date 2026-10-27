/**
 * Trado Firebase Cloud Functions - Phase 1 Entry Point
 * 
 * Target Runtime: Node.js 22 (Cloud Functions Gen 2)
 * Primary Region: asia-south1 (Mumbai)
 */

import { setGlobalOptions } from "firebase-functions/v2";

// Set global options across all Gen 2 functions
setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10,
});

// Diagnostic & Session
export { healthCheck } from "./callables/healthCheck.js";
export { authMe } from "./callables/authMe.js";

// Organizations
export {
  organizationsCreate,
  organizationsUpdate,
  organizationsDeactivate,
  organizationsList,
} from "./callables/organizations.js";

// Employees & Memberships
export {
  employeesCreate,
  employeesUpdate,
  employeesDeactivate,
  employeesList,
} from "./callables/employees.js";

// Roles & Capabilities
export {
  rolesCreate,
  rolesUpdate,
  rolesList,
} from "./callables/roles.js";

// Departments
export {
  departmentsCreate,
  departmentsUpdate,
  departmentsList,
} from "./callables/departments.js";

// Job Roles
export {
  jobRolesCreate,
  jobRolesUpdate,
  jobRolesList,
} from "./callables/jobRoles.js";

// Teams
export {
  teamsCreate,
  teamsUpdate,
  teamsList,
} from "./callables/teams.js";

// Subscription Plans
export {
  plansCreate,
  plansUpdate,
  plansList,
} from "./callables/plans.js";

// Catalogs & Reference Data
export {
  permissionCatalogList,
  modulesList,
  taxRegimesList,
} from "./callables/catalogs.js";

// Push Notifications & Devices
export {
  notificationsRegisterFcmToken,
} from "./callables/notifications.js";

// ============================================================
// Phase 2 Operational Core Callables
// ============================================================

// Products
export {
  productsCreate,
  productsUpdate,
  productsList,
  productsGet,
} from "./callables/products.js";

// Categories
export {
  categoriesCreate,
  categoriesUpdate,
  categoriesList,
} from "./callables/categories.js";

// Units
export {
  unitsCreate,
  unitsUpdate,
  unitsList,
} from "./callables/units.js";

// Customers
export {
  customersCreate,
  customersUpdate,
  customersList,
  customersGet,
} from "./callables/customers.js";

// Vendors
export {
  vendorsCreate,
  vendorsUpdate,
  vendorsList,
  vendorsGet,
} from "./callables/vendors.js";

// Unified Outflows (Purchases & Expenses)
export {
  outflowsCreate,
  outflowsList,
  outflowsGet,
} from "./callables/outflows.js";

// Shared Bills & Sales Engine (POS & B2B)
export {
  billsCreate,
  billsFinalize,
  billsList,
  billsGet,
} from "./callables/bills.js";

// Deliveries & Dispatch
export {
  deliveriesCreate,
  deliveriesUpdateStatus,
  deliveriesList,
  deliveriesGet,
} from "./callables/deliveries.js";

// Returns
export {
  returnsCreate,
  returnsList,
} from "./callables/returns.js";

// Payments Ledger
export {
  paymentsCreate,
  paymentsList,
} from "./callables/payments.js";

// Stock Movements & Adjustments
export {
  stockAdjust,
  stockMovementsList,
} from "./callables/stock.js";

// Ledger & Stock Reconciliation
export {
  reconcileStockBalances,
  reconcilePartyLedgers,
} from "./callables/reconciliation.js";
