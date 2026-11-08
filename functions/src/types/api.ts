/**
 * Request and Response Data Transfer Objects (DTOs) for Cloud Functions Callables
 */

import type { EffectiveBusinessConfig } from "../constants/businessDefaults.js";
import { BusinessType, BusinessCategory, EntityStatus } from "../constants/enums.js";

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
  avatarUrl: string | null;
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
  user?: AuthUserContext;
  profile?: AuthUserContext;
  role?: AuthRoleContext | null;
  jobRoles?: AuthJobRoleContext[];
  permissions?: string[];
  platformPermissions?: string[];
  organizations?: AuthOrganizationContext[];
  primaryOrganization?: AuthPrimaryOrganizationContext | null;
  branches?: AuthBranchContext[];
  primaryBranch?: AuthPrimaryBranchContext | null;
  device?: AuthDeviceContext | null;
  contextStatus?: AuthContextStatus;
}

// Session Bootstrap (/auth/me equivalent)
export interface AuthMeRequest {
  deviceId?: string;
  organizationId?: string;
  branchId?: string;
}

export interface AuthMeResponse {
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
  branchId?: string;
  name: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  billingAddress?: string;
  shippingAddress?: string;
  priceGroup?: string;
  creditLimit?: number;
  creditPeriodDays?: number;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
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
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
  isActive?: boolean;
}

export interface ListCustomersRequest {
  organizationId: string;
  branchId?: string;
  search?: string;
  limit?: number;
  startAfterId?: string;
}

// Vendors
export interface CreateVendorRequest {
  idempotencyKey?: string;
  organizationId: string;
  branchId?: string;
  name: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  address?: string;
  contactPerson?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
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
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
  isActive?: boolean;
}

export interface ListVendorsRequest {
  organizationId: string;
  branchId?: string;
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

export interface GetRevenueReportResponse {
  totalRevenue: number;
  billCount: number;
  averageBillValue: number;
  breakdown: Array<{
    period: string;
    revenue: number;
    count: number;
  }>;
}

export interface GetProfitLossReportRequest {
  organizationId: string;
  branchId?: string;
  from?: string;
  to?: string;
}

export interface GetProfitLossReportResponse {
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  totalExpenses: number;
  netProfit: number;
  netMarginPercent: number;
  billCount: number;
  outflowCount: number;
  costingMethod: "weighted_average" | "direct_expense";
}

export interface GetStockValuationReportRequest {
  organizationId: string;
  branchId?: string;
  categoryId?: string;
}

export interface GetStockValuationReportResponse {
  totalStockValuation: number;
  totalItemsCount: number;
  items: Array<{
    productId: string;
    name: string;
    currentStock: number;
    costPrice: number;
    weightedAverageCost: number;
    valuation: number;
  }>;
}

export interface GetTopEntitiesReportRequest {
  organizationId: string;
  branchId?: string;
  entityType: "products" | "customers" | "vendors";
  limit?: number;
  from?: string;
  to?: string;
}

export interface GetStaffReportRequest {
  organizationId: string;
  branchId?: string;
  staffMembershipId?: string;
  from?: string;
  to?: string;
}

export interface GetPlatformOverviewReportRequest {
  from?: string;
  to?: string;
}

export interface ExportReportRequest {
  organizationId: string;
  branchId?: string;
  reportType: "revenue" | "profit_loss" | "stock_valuation" | "top_products" | "staff_sales";
  from?: string;
  to?: string;
}

// Tasks
export interface CreateTaskRequest {
  idempotencyKey?: string;
  organizationId: string;
  title: string;
  description?: string;
  assignedToMembershipId: string;
  priority?: "low" | "medium" | "high" | "urgent";
  dueAt?: string;
  relatedEntityType?: "bill" | "outflow" | "delivery" | "customer" | "vendor" | "product" | null;
  relatedEntityId?: string | null;
}

export interface UpdateTaskRequest {
  taskId: string;
  title?: string;
  description?: string;
  assignedToMembershipId?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  dueAt?: string | null;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface AssignTaskRequest {
  taskId: string;
  assignedToMembershipId: string;
}

export interface UpdateTaskStatusRequest {
  taskId: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface ListTasksRequest {
  organizationId: string;
  assignedToMembershipId?: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "low" | "medium" | "high" | "urgent";
  limit?: number;
  startAfterId?: string;
}

export interface DeleteTaskRequest {
  taskId: string;
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

// In-app Notifications
export interface ListNotificationsRequest {
  limit?: number;
  unreadOnly?: boolean;
}

export interface MarkNotificationReadRequest {
  notificationId: string;
}

// ============================================================
// Super Admin Usage Metering & Platform Consumption API Types
// ============================================================

export interface GetPlatformUsageSummaryRequest {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface GetPlatformUsageSummaryResponse {
  timeframe: { startDate: string; endDate: string };
  platformActualTotals?: {
    firestoreReads: number;
    firestoreWrites: number;
    firestoreDeletes: number;
    functionsInvocations: number;
    functionsErrors: number;
    storageOperations: number;
  };
  applicationAttributedTotals: {
    firestoreReads: number;
    firestoreWrites: number;
    firestoreDeletes: number;
    functionsInvocations: number;
    functionsErrors: number;
    functionsExecutionMs: number;
    storageUploadBytes: number;
    storageDownloadBytes: number;
    storageOperations: number;
    authOperations: number;
    fcmDispatches: number;
    locationPings: number;
  };
  estimatedTotalPlatformCost: number;
  allocatedTenantCostSum: number;
  unallocatedPlatformOverhead: number;
  currency: string;
  activeRateCardVersion: string;
  dataCompletenessNotes: string[];
}

export interface GetOrganizationsUsageRequest {
  startDate?: string;
  endDate?: string;
  sortBy?: "activity" | "cost" | "name";
  limit?: number;
  startAfterOrgId?: string;
}

export interface OrganizationUsageSummaryItem {
  organizationId: string;
  name: string;
  planId: string;
  branchCount: number;
  totalOperations: number;
  estimatedCost: number;
  currency: string;
  completenessPercent: number;
  breakdown: {
    firestoreReads: number;
    firestoreWrites: number;
    firestoreDeletes: number;
    functionsInvocations: number;
    locationPings: number;
    fcmDispatches: number;
  };
}

export interface GetOrganizationsUsageResponse {
  timeframe: { startDate: string; endDate: string };
  count: number;
  items: OrganizationUsageSummaryItem[];
}

export interface GetBranchesUsageRequest {
  organizationId: string;
  startDate?: string;
  endDate?: string;
}

export interface BranchUsageSummaryItem {
  branchId: string;
  name: string;
  code: string;
  isActive: boolean;
  isDefault: boolean;
  totalOperations: number;
  estimatedCost: number;
  currency: string;
  dataFreshness: string;
  completenessPercent: number;
  counts: {
    firestoreReads: number;
    firestoreWrites: number;
    firestoreDeletes: number;
    functionsInvocations: number;
    locationPings: number;
  };
}

export interface GetBranchesUsageResponse {
  organizationId: string;
  organizationName: string;
  timeframe: { startDate: string; endDate: string };
  branches: BranchUsageSummaryItem[];
}

export interface GetUsageDetailRequest {
  organizationId?: string;
  branchId?: string;
  service?: "firestore" | "functions" | "storage" | "auth" | "fcm" | "location";
  startDate?: string;
  endDate?: string;
  granularity?: "daily" | "monthly";
}

export interface UsageDetailItem {
  date: string;
  organizationId: string;
  branchId?: string;
  counts: Record<string, number>;
  estimatedCost: number;
  currency: string;
  measurementClass: string;
}

export interface GetUsageDetailResponse {
  filters: GetUsageDetailRequest;
  items: UsageDetailItem[];
}

export interface CalculateDryRunStatementRequest {
  organizationId: string;
  billingPeriod: string; // YYYY-MM
  rateCardVersion?: string;
}

export interface DryRunStatementLineItem {
  service: string;
  metric: string;
  quantity: number;
  unit: string;
  unitRate: number;
  amount: number;
}

export interface CalculateDryRunStatementResponse {
  organizationId: string;
  organizationName: string;
  billingPeriod: string;
  status: "draft_estimate";
  legalDisclaimer: string;
  rateCardVersion: string;
  currency: string;
  lineItems: DryRunStatementLineItem[];
  subtotal: number;
  sharedOverheadAllocation: number;
  totalEstimatedCharge: number;
  generatedAt: string;
}

// Branch Reconciliation Types
export interface ReconcileBranchCountsRequest {
  organizationId: string;
  repair?: boolean;
}

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


