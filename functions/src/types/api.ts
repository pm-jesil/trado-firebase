/**
 * Request and Response Data Transfer Objects (DTOs) for Cloud Functions Callables
 */

import { BusinessType, BusinessCategory, EntityStatus } from "../constants/enums.js";

// Session Bootstrap (/auth/me equivalent)
export interface AuthMeResponse {
  user: {
    uid: string;
    email: string;
    name: string;
    phone?: string;
    accountType: string;
    isActive: boolean;
  };
  isSuperAdmin: boolean;
  memberships: Array<{
    membershipId: string;
    organizationId: string;
    organizationName?: string;
    roleId: string;
    roleName?: string;
    status: string;
    isPrimary: boolean;
  }>;
  activeContext?: {
    organizationId: string;
    roleId: string;
    roleCode: string;
    isOrgOwner: boolean;
    effectivePermissions: string[];
    moduleToggles: Record<string, boolean>;
  };
}

// Organizations
export interface CreateOrganizationRequest {
  idempotencyKey?: string;
  name: string;
  businessType: BusinessType;
  businessCategory: BusinessCategory;
  country: string;
  currency: string;
  taxRegimeCode: string;
  planId: string;
  ownerEmail: string;
  ownerName: string;
  ownerPhone?: string;
  initialPassword?: string;
}

export interface CreateOrganizationResponse {
  organizationId: string;
  ownerUserId: string;
  ownerMembershipId: string;
  status: string;
  message: string;
}

export interface UpdateOrganizationRequest {
  organizationId: string;
  name?: string;
  businessType?: BusinessType;
  businessCategory?: BusinessCategory;
  moduleToggles?: Record<string, boolean>;
  logoUrl?: string;
}

export interface DeactivateOrganizationRequest {
  organizationId: string;
  reason?: string;
}

export interface ListOrganizationsRequest {
  limit?: number;
  startAfterId?: string;
  status?: EntityStatus;
}

// Employees / Memberships
export interface CreateEmployeeRequest {
  idempotencyKey?: string;
  organizationId: string;
  email: string;
  name: string;
  phone?: string;
  initialPassword?: string;
  roleId?: string;
  departmentId?: string;
  jobRoleIds?: string[];
  teamId?: string;
  reportingToIds?: string[];
  permissionOverrides?: Record<string, boolean>;
}

export interface CreateEmployeeResponse {
  userId: string;
  membershipId: string;
  organizationId: string;
  status: string;
  message: string;
}

export interface UpdateEmployeeRequest {
  organizationId: string;
  membershipId: string;
  name?: string;
  phone?: string;
  roleId?: string;
  departmentId?: string | null;
  jobRoleIds?: string[];
  teamId?: string | null;
  reportingToIds?: string[];
  permissionOverrides?: Record<string, boolean>;
  status?: EntityStatus;
}

export interface DeactivateEmployeeRequest {
  organizationId: string;
  membershipId: string;
  reason?: string;
}

export interface ListEmployeesRequest {
  organizationId: string;
  limit?: number;
  startAfterId?: string;
  status?: EntityStatus;
}

// Catalog Callables (Roles, Departments, Job Roles, Teams)
export interface CreateRoleRequest {
  idempotencyKey?: string;
  organizationId?: string | null; // Null for system roles (Super Admin only)
  name: string;
  code: string;
  permissions: string[];
  description: string;
}

export interface UpdateRoleRequest {
  roleId: string;
  name?: string;
  permissions?: string[];
  description?: string;
}

export interface ListRolesRequest {
  organizationId?: string;
}

export interface CreateDepartmentRequest {
  idempotencyKey?: string;
  organizationId?: string | null;
  name: string;
  headMembershipIds?: string[];
}

export interface UpdateDepartmentRequest {
  departmentId: string;
  name?: string;
  headMembershipIds?: string[];
}

export interface ListDepartmentsRequest {
  organizationId?: string;
}

export interface CreateJobRoleRequest {
  idempotencyKey?: string;
  organizationId?: string | null;
  name: string;
}

export interface UpdateJobRoleRequest {
  jobRoleId: string;
  name?: string;
}

export interface ListJobRolesRequest {
  organizationId?: string;
}

export interface CreateTeamRequest {
  idempotencyKey?: string;
  organizationId: string;
  name: string;
}

export interface UpdateTeamRequest {
  teamId: string;
  name?: string;
}

export interface ListTeamsRequest {
  organizationId: string;
}

// Plans
export interface CreatePlanRequest {
  idempotencyKey?: string;
  name: string;
  price: number;
  currency: string;
  storageLimitMb: number;
  monthlyDocumentVolumeLimit: number;
  seatLimits: {
    admin: number;
    staff: number;
  };
  moduleFlags: Record<string, boolean>;
  isActive?: boolean;
}

export interface UpdatePlanRequest {
  planId: string;
  name?: string;
  price?: number;
  moduleFlags?: Record<string, boolean>;
  isActive?: boolean;
}

export interface ListPlansRequest {
  includeInactive?: boolean;
}

// Push Notifications
export interface RegisterFcmTokenRequest {
  deviceId: string;
  fcmToken: string;
  platform: "android" | "ios" | "web";
}

// ============================================================
// Phase 2 DTOs
// ============================================================

// Products
export interface CreateProductRequest {
  idempotencyKey?: string;
  organizationId: string;
  name: string;
  description?: string;
  categoryId?: string | null;
  baseUnit?: string;
  sellingPrice: number;
  costPrice: number;
  mrp?: number | null;
  wholesalePrice?: number | null;
  taxInclusive?: boolean;
  taxRatePercent?: number;
  taxCode?: string;
  barcode?: string | null;
  sku?: string | null;
  hasExpiry?: boolean;
  trackStock?: boolean;
  initialStock?: number;
  lowStockThreshold?: number;
}

export interface UpdateProductRequest {
  organizationId: string;
  productId: string;
  name?: string;
  description?: string;
  categoryId?: string | null;
  baseUnit?: string;
  sellingPrice?: number;
  costPrice?: number;
  mrp?: number | null;
  wholesalePrice?: number | null;
  taxInclusive?: boolean;
  taxRatePercent?: number;
  taxCode?: string;
  barcode?: string | null;
  sku?: string | null;
  hasExpiry?: boolean;
  trackStock?: boolean;
  lowStockThreshold?: number;
  isActive?: boolean;
}

export interface ListProductsRequest {
  organizationId: string;
  categoryId?: string;
  isActive?: boolean;
  limit?: number;
  startAfterId?: string;
}

// Categories
export interface CreateCategoryRequest {
  idempotencyKey?: string;
  organizationId?: string | null;
  name: string;
  parentId?: string | null;
  nature?: string;
}

export interface UpdateCategoryRequest {
  categoryId: string;
  name?: string;
  parentId?: string | null;
  nature?: string;
  isActive?: boolean;
}

export interface ListCategoriesRequest {
  organizationId?: string;
  includeGlobal?: boolean;
}

// Units
export interface CreateUnitRequest {
  idempotencyKey?: string;
  organizationId?: string | null;
  name: string;
  code: string;
  group?: string;
  precision?: number;
  baseUnit?: string | null;
  conversionFactor?: number;
}

export interface UpdateUnitRequest {
  unitId: string;
  name?: string;
  precision?: number;
  isActive?: boolean;
}

export interface ListUnitsRequest {
  organizationId?: string;
  includeGlobal?: boolean;
}

// Customers
export interface CreateCustomerRequest {
  idempotencyKey?: string;
  organizationId: string;
  name: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  billingAddress?: string;
  shippingAddress?: string;
  priceGroup?: string;
  creditLimit?: number;
  creditPeriodDays?: number;
  isDefault?: boolean;
}

export interface UpdateCustomerRequest {
  organizationId: string;
  customerId: string;
  name?: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  billingAddress?: string;
  shippingAddress?: string;
  priceGroup?: string;
  creditLimit?: number;
  creditPeriodDays?: number;
  isActive?: boolean;
}

export interface ListCustomersRequest {
  organizationId: string;
  search?: string;
  limit?: number;
  startAfterId?: string;
}

// Vendors
export interface CreateVendorRequest {
  idempotencyKey?: string;
  organizationId: string;
  name: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  address?: string;
  contactPerson?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  isDefault?: boolean;
}

export interface UpdateVendorRequest {
  organizationId: string;
  vendorId: string;
  name?: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  address?: string;
  contactPerson?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  isActive?: boolean;
}

export interface ListVendorsRequest {
  organizationId: string;
  search?: string;
  limit?: number;
  startAfterId?: string;
}

// Outflows
export interface CreateOutflowRequest {
  idempotencyKey?: string;
  organizationId: string;
  kind: "purchase" | "expense";
  docDate?: string;
  vendorId?: string | null;
  vendorName?: string;
  payee?: string;
  invoiceNumber?: string;
  dueDate?: string;
  lines: Array<{
    productId?: string | null;
    itemName: string;
    sku?: string;
    categoryId?: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountAmount?: number;
    taxPercent?: number;
    addToStock?: boolean;
    batch?: string;
    expiryDate?: string;
  }>;
  paidAmount?: number;
  paymentMethod?: string;
  notes?: string;
}

export interface ListOutflowsRequest {
  organizationId: string;
  kind?: "purchase" | "expense";
  vendorId?: string;
  limit?: number;
  startAfterId?: string;
}

// Bills
export interface CreateBillRequest {
  idempotencyKey?: string;
  organizationId: string;
  salesMode?: "pos" | "b2b";
  customerId?: string | null;
  customerSnapshot?: {
    name: string;
    mobile?: string;
    email?: string;
    taxNumber?: string;
    billingAddress?: string;
    shippingAddress?: string;
  };
  items: Array<{
    productId: string;
    quantity: number;
    unitPriceOverride?: number;
    discountValue?: number;
    unit?: string;
  }>;
  discountTotal?: number;
  paidAmount?: number;
  paymentMethod?: string;
  notes?: string;
}

export interface ListBillsRequest {
  organizationId: string;
  salesMode?: "pos" | "b2b";
  customerId?: string;
  limit?: number;
  startAfterId?: string;
}

// Deliveries
export interface CreateDeliveryRequest {
  idempotencyKey?: string;
  organizationId: string;
  billId: string; // ID reference only!
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  address: {
    line1: string;
    line2?: string;
    landmark?: string;
    city: string;
    pincode: string;
  };
  riderMembershipId?: string | null;
  riderName?: string;
  partner?: string;
  deliveryFee?: number;
  cod?: {
    isCod: boolean;
    amount: number;
  };
  notes?: string;
}

export interface UpdateDeliveryStatusRequest {
  organizationId: string;
  deliveryId: string;
  status: string;
  riderMembershipId?: string;
  riderName?: string;
  codCollected?: boolean;
  notes?: string;
}

export interface ListDeliveriesRequest {
  organizationId: string;
  status?: string;
  limit?: number;
  startAfterId?: string;
}

// Returns
export interface CreateReturnRequest {
  idempotencyKey?: string;
  organizationId: string;
  returnType: "sales_return" | "purchase_return";
  referenceId: string;
  partyId?: string | null;
  partyName?: string;
  items: Array<{
    productId: string;
    quantity: number;
    refundAmount: number;
    reason: string;
    disposition?: "restocked_to_inventory" | "wasted_discarded";
  }>;
  refundMethod?: string;
  notes?: string;
}

export interface ListReturnsRequest {
  organizationId: string;
  returnType?: "sales_return" | "purchase_return";
  referenceId?: string;
  limit?: number;
  startAfterId?: string;
}

// Payments
export interface CreatePaymentRequest {
  idempotencyKey?: string;
  organizationId: string;
  direction: "in" | "out";
  partyType: "customer" | "vendor";
  partyId?: string | null;
  partyName: string;
  amount: number;
  method?: string;
  referenceId?: string | null;
  referenceModel?: "bill" | "outflow" | null;
  notes?: string;
}

export interface ListPaymentsRequest {
  organizationId: string;
  direction?: "in" | "out";
  partyId?: string;
  referenceId?: string;
  limit?: number;
  startAfterId?: string;
}

// Stock Adjustments
export interface StockAdjustRequest {
  idempotencyKey?: string;
  organizationId: string;
  productId: string;
  quantity: number;
  reason: string;
}

export interface ListStockMovementsRequest {
  organizationId: string;
  productId?: string;
  type?: string;
  limit?: number;
  startAfterId?: string;
}
