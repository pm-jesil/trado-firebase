/**
 * Request and Response Data Transfer Objects (DTOs) for Cloud Functions Callables
 */

import type { EffectiveBusinessConfig } from "../constants/businessDefaults.js";
import { BusinessType, BusinessCategory, EntityStatus } from "../constants/enums.js";
import type { CurrencyDefinition } from "../constants/currencies.js";

// Canonical Session Context DTOs
export type AuthContextStatus =
  | "ready"
  | "platform"
  | "organization_selection_required"
  | "branch_selection_required"
  | "no_active_membership"
  | "organization_inactive" // Organization status is not active (Super Admin locked it)
  | "subscription_expired" // Past expiry + grace: no tenant operations
  | "subscription_suspended" // Suspended or cancelled by the platform
  | "subscription_not_started";

export interface AuthSubscriptionContext {
  state: string; // trial | active | grace | expired | suspended | cancelled | legacy_unset
  planId: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  daysRemaining: number | null;
}

export interface AuthUserContext {
  uid: string;
  email: string;
  name: string;
  phone: string | null;
  /** D-15: computed display URL for the user's image; derived from UserDoc.image.path at read time. Never stored. */
  imageUrl: string | null;
  accountType: string;
  isActive: boolean;
  isSuperAdmin: boolean;
}

export interface AuthRoleContext {
  scope: "platform" | "organization";
  roleId: string | null;
  roleName: string | null;
  roleCode: string | null;
}

export interface AuthJobRoleContext {
  jobRoleId: string;
  name: string;
  code: string;
}

export interface AuthOrganizationContext {
  organizationId: string;
  name?: string;
  roleId?: string;
  roleName?: string;
  isPrimary?: boolean;
}

export interface AuthPrimaryOrganizationContext {
  organizationId: string;
  name?: string;
  currency?: string;
  currencyInfo?: CurrencyDefinition;
  timezone?: string;
  country?: string;
  taxRegimeCode?: string;
  businessType?: string;
  businessCategory?: string;
}

export interface AuthBranchContext {
  branchId: string;
  name: string;
  code: string;
  isDefault: boolean;
}

export interface AuthPrimaryBranchContext {
  branchId: string;
  name: string;
  code: string;
}

export interface AuthDeviceContext {
  deviceId: string;
  recognized: boolean;
}

export interface AuthSessionContext {
  user: AuthUserContext;
  /** Effective business configuration: organization override ?? business-type default (computed). */
  businessConfig?: EffectiveBusinessConfig | null;
  role: AuthRoleContext | null;
  jobRoles: AuthJobRoleContext[];
  permissions: string[];
  platformPermissions: string[];
  organizations: AuthOrganizationContext[];
  primaryOrganization: AuthPrimaryOrganizationContext | null;
  branches: AuthBranchContext[];
  primaryBranch: AuthPrimaryBranchContext | null;
  device: AuthDeviceContext | null;
  contextStatus: AuthContextStatus;
  subscription?: AuthSubscriptionContext | null;
}

// Authentication Login DTOs (Emulator Adapter)
export interface AuthLoginRequest {
  email: string;
  password: string;
  deviceId?: string;
}

export interface AuthLoginResponse {
  /** D-18: single canonical response — `context` is the one source of truth. */
  context: AuthSessionContext;
  credentials: {
    idToken: string;
    expiresInSeconds: number;
    accessToken?: string;
    refreshToken?: string;
  };
  idToken?: string;
  accessToken?: string;
  refreshToken?: string | null;
}


export interface AuthMeResponse {
  /** D-18: single canonical response — `context` is the one source of truth. */
  context: AuthSessionContext;
  credentials: null;
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
  ownerUserId?: string | null;
  ownerMembershipId?: string | null;
  status: string;
  ownerStatus?: "pending" | "active";
  temporaryPassword?: string;
  userCreated?: boolean;
  message: string;
}

export interface UpdateOrganizationRequest {
  organizationId: string;
  name?: string;
  businessType?: BusinessType;
  businessCategory?: BusinessCategory;
  moduleToggles?: Record<string, boolean>;
  /** D-15: use `uploadId` or `image` (ImageRef without url) to set org logo; not a URL field. */
  uploadId?: string;
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


// ============================================================
// Operational Business Layer API Interfaces
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


// Customers
export interface CreateCustomerRequest {
  idempotencyKey?: string;
  organizationId: string;
  branchId?: string;
  name: string;
  mobile?: string;
  email?: string;
  taxId?: string;
  billingAddress?: string;
  shippingAddress?: string;
  priceGroup?: string;
  creditLimit?: number;
  creditPeriodDays?: number;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
  isDefault?: boolean;
}


// Vendors
export interface CreateVendorRequest {
  idempotencyKey?: string;
  organizationId: string;
  branchId?: string;
  name: string;
  mobile?: string;
  email?: string;
  taxId?: string;
  address?: string;
  contactPerson?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
  isDefault?: boolean;
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
    taxId?: string;
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


// Stock Adjustments
export interface StockAdjustRequest {
  idempotencyKey?: string;
  organizationId: string;
  productId: string;
  quantity: number;
  reason: string;
}


// ==========================================
// Operations & Intelligence API Interfaces
// ==========================================

// Reporting
export interface GetRevenueReportRequest {
  organizationId: string;
  branchId?: string;
  from?: string; // ISO date YYYY-MM-DD
  to?: string;
  groupBy?: "day" | "month" | "year";
}


export interface GetProfitLossReportRequest {
  organizationId: string;
  branchId?: string;
  from?: string;
  to?: string;
}


export interface GetStockValuationReportRequest {
  organizationId: string;
  branchId?: string;
  categoryId?: string;
}


export interface PlatformCurrencyTotals {
  revenue: number;
  outflows: number;
  netCashFlow: number;
  billsCount: number;
  outflowsCount: number;
}

export interface PlatformOverviewReportResponse {
  totalOrganizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  inactiveOrganizations: number;
  organizationsByStatus: Record<string, number>;
  organizationsByCountry: Record<string, number>;
  organizationsByPlan: Record<string, number>;
  availablePlansCount: number;
  totalUsers: number;
  subscriptionsExpiring: Array<{ organizationId: string; name: string; expiresAt: string; daysLeft: number }>;
  atRiskOrganizations: string[];
  topOrganizationsByUsage: Array<{ organizationId: string; currency: string; billsCount: number; revenue: number }>;
  totalsByCurrency: Record<string, PlatformCurrencyTotals>;
  platformFinancials: {
    totalsByCurrency: Record<string, PlatformCurrencyTotals>;
    billsCount: number;
    outflowsCount: number;
  };
  generatedAt: string;
}


// Live Location
export interface RecordLocationPingRequest {
  organizationId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  source?: "foreground" | "background";
}

export interface GetLatestLocationsRequest {
  organizationId: string;
  membershipIds?: string[];
}

export interface GetLocationHistoryRequest {
  organizationId: string;
  membershipId: string;
  from?: string;
  to?: string;
  limit?: number;
}


// ============================================================
// Super Admin Usage Metering & Platform Consumption API Types
// ============================================================


export interface ReconcileBranchCountsResponse {
  organizationId: string;
  recordedBranchCount: number;
  actualActiveBranches: number;
  difference: number;
  isDiscrepancy: boolean;
  repaired: boolean;
  activeBranchIds: string[];
  timestamp: string;
}

