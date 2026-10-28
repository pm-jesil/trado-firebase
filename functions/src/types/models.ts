/**
 * Domain Models for Firestore Collections
 * 
 * Strict architectural rule:
 * - Direct foreign relationships are modeled as Reference IDs, not embedded documents.
 * - Snapshots are permitted only when explicitly named *Snapshot and justified.
 */

import {
  BusinessType,
  BusinessCategory,
  EntityStatus,
  IdempotencyStatus,
  OutflowKind,
  OutflowStatus,
  PaymentStatus,
  StockMovementType,
  DeliveryStatus,
  DeliveryPartner,
  ReturnType,
  ReturnDisposition,
  PaymentMethod,
  PaymentDirection,
  PartyType,
  UnitGroup,
  SalesMode,
  DocumentType,
  BillStatus,
} from "../constants/enums.js";

/**
 * 1. users/{uid}
 * Document ID = Firebase Auth UID
 */
export interface UserDoc {
  name: string;
  email: string;
  phone?: string | null;
  accountType: "standard" | "admin" | "system";
  isActive: boolean;
  createdAt: string; // ISO 8601
  createdBy?: string;
  updatedAt?: string;
}

/**
 * 2. memberships/{membershipId}
 * Document ID = `${userId}_${organizationId}`
 * User <-> Organization join record
 */
export interface MembershipDoc {
  userId: string; // Reference to users/{uid}
  organizationId: string; // Reference to organizations/{organizationId}
  roleId: string; // Reference to roles/{roleId}
  departmentId?: string | null; // Reference to departments/{departmentId}
  jobRoleIds: string[]; // References to jobRoles/{jobRoleId}
  teamId?: string | null; // Reference to teams/{teamId}
  reportingToIds: string[]; // References to memberships/{membershipId} (multi-manager graph)
  permissions: Record<string, boolean>; // Explicit user-level override grants/denies
  status: EntityStatus;
  isPrimary: boolean;
  primaryBranchId?: string; // Canonical default active operating branch for this membership
  assignedBranchIds?: string[]; // Materialized projection of active membershipBranches IDs
  locationTrackingEnabled?: boolean; // Explicit consent flag for employee live-location tracking
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 3. organizations/{organizationId}
 */
export interface OrganizationDoc {
  name: string;
  businessType: BusinessType;
  businessCategory: BusinessCategory;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217 code
  taxRegimeCode: string; // Reference to taxRegimes/{taxRegimeCode}
  status: EntityStatus;
  planId: string; // Reference to subscriptionPlans/{planId}
  moduleToggles: Record<string, boolean>; // Per-tenant feature switches
  logoUrl?: string;
  defaultBranchId?: string;
  branchCount?: number;
  sharingPolicies?: OrganizationSharingPolicies;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 4. roles/{roleId}
 */
export interface RoleDoc {
  organizationId: string | null; // Null for system/platform roles
  name: string;
  code: string;
  permissions: string[]; // Canonical permission catalog codes
  isSystem: boolean;
  description: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

/**
 * 5. departments/{departmentId}
 */
export interface DepartmentDoc {
  organizationId: string | null; // Null for system catalog
  name: string;
  headMembershipIds?: string[]; // References to memberships/{membershipId}
  isSystem: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

/**
 * 6. jobRoles/{jobRoleId}
 */
export interface JobRoleDoc {
  organizationId: string | null; // Null for system catalog
  name: string;
  isSystem: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

/**
 * 7. teams/{teamId}
 * Note: Teams NEVER embed members. Membership is queried via memberships.teamId == teamId.
 */
export interface TeamDoc {
  organizationId: string; // Reference to organizations/{organizationId}
  name: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

/**
 * 8. subscriptionPlans/{planId}
 */
export interface SubscriptionPlanDoc {
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
  branchLimit?: number;
  isActive: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

/**
 * 9. permissionCatalog/{permissionCode}
 */
export interface PermissionCatalogDoc {
  code: string;
  description: string;
  module: string;
  isSystem: boolean;
}

/**
 * 10. modules/{moduleCode}
 */
export interface ModuleDoc {
  code: string;
  name: string;
  description: string;
}

/**
 * 11. taxRegimes/{taxRegimeCode}
 */
export interface TaxRegimeDoc {
  code: string;
  country: string;
  name: string;
  description: string;
  isDefault: boolean;
}

/**
 * 12. idempotencyRecords/{recordId}
 */
export interface IdempotencyRecordDoc {
  operationId: string;
  requestHash: string;
  status: IdempotencyStatus;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  processingExpiresAt?: string; // ISO 8601 lease timeout for PROCESSING status
  expiresAt: string; // ISO 8601
}

/**
 * 13. auditLogs/{logId}
 */
export interface AuditLogDoc {
  organizationId?: string | null; // Tenant ID or "platform"
  branchId?: string | null;
  actorUid: string;
  actorMembershipId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/**
 * 14. users/{uid}/devices/{deviceId}
 */
export interface DeviceDoc {
  deviceId: string;
  fcmToken: string;
  platform: "android" | "ios" | "web";
  createdAt: string;
  updatedAt: string;
}

/**
 * 15. notificationOutbox/{outboxId}
 */
export interface NotificationOutboxDoc {
  userId: string;
  type: "welcome" | "system";
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
  };
  status: "pending" | "dispatched" | "failed";
  retryCount: number;
  createdAt: string;
  dispatchedAt?: string;
}

/**
 * -------------------------------------------------------------
 * Operational Business Collections & Subdocuments
 * -------------------------------------------------------------
 */

/**
 * Shared Tax Snapshot (frozen at document creation)
 */
export interface TaxSnapshot {
  regime: string;
  country: string;
  taxRatePercent: number;
  taxAmount: number;
  taxType: string;
  isRegistered: boolean;
  registrationNumber?: string;
  labels?: {
    taxName: string;
    registrationLabel: string;
    invoiceTitle: string;
  };
}

/**
 * 16. products/{productId}
 */
export interface ProductDoc {
  organizationId: string; // Tenant reference
  name: string;
  nameKey: string; // Lower-case trimmed for uniqueness search
  description?: string;
  categoryId?: string | null; // Reference to categories/{categoryId}
  baseUnit: string; // Code e.g. "piece", "kg", "box"
  sellingPrice: number;
  costPrice: number;
  weightedAverageCost?: number; // Maintained weighted-average cost for valuation & COGS
  mrp?: number | null;
  wholesalePrice?: number | null;
  taxInclusive: boolean;
  taxRatePercent?: number; // e.g. 5, 12, 18
  taxCode?: string; // HSN/SAC code
  barcode?: string | null;
  sku?: string | null;
  hasExpiry: boolean; // Confirmed canonical name
  trackStock: boolean;
  currentStock: number; // Maintained aggregate stock total
  lowStockThreshold: number;
  trackBatch?: boolean;
  trackSerial?: boolean;
  hasVariants?: boolean;
  isPurchaseOnly?: boolean;
  isExpenseOnly?: boolean;
  isSaleOnly?: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 17. categories/{categoryId}
 */
export interface CategoryDoc {
  organizationId: string | null; // Null for global/system categories
  name: string;
  nameKey: string;
  parentId?: string | null; // Parent category ID for hierarchical structure
  nature?: string; // "operational", "administrative", "cogs", etc.
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 18. units/{unitId}
 */
export interface UnitDoc {
  organizationId: string | null; // Null for system units
  name: string; // e.g. "Kilogram", "Piece", "Liter"
  code: string; // e.g. "kg", "pcs", "ltr"
  group: UnitGroup; // count, weight, volume, length, area, time
  precision: number; // 0-4
  baseUnit?: string | null; // Reference code if derived
  conversionFactor?: number; // Relative to baseUnit
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 19. customers/{customerId}
 */
export interface CustomerDoc {
  organizationId: string;
  customerCode: string; // e.g. "CUST-000001"
  name: string;
  mobile?: string | null;
  email?: string | null;
  taxNumber?: string | null; // GSTIN / VAT registration
  billingAddress?: string | null;
  shippingAddress?: string | null;
  priceGroup?: string; // "retail", "wholesale", "distributor"
  creditLimit: number;
  creditPeriodDays: number;
  outstandingBalance: number; // Udhaar amount customer owes
  totalSpend: number;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only"; // Branch visibility scope (default: all_branches)
  sharedForBranchIds?: string[]; // Branch IDs allowed to access this customer record
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 20. vendors/{vendorId}
 */
export interface VendorDoc {
  organizationId: string;
  vendorCode: string; // e.g. "VEND-000001"
  name: string;
  mobile?: string | null;
  email?: string | null;
  taxNumber?: string | null; // GSTIN / TRN
  address?: string | null;
  contactPerson?: string | null;
  paymentTermsDays?: number;
  creditLimit?: number;
  outstandingPayable: number; // Amount owed to vendor
  totalPurchase: number;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only"; // Branch visibility scope (default: all_branches)
  sharedForBranchIds?: string[]; // Branch IDs allowed to access this vendor record
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * Line item in Outflow (Purchase/Expense)
 */
export interface OutflowLine {
  productId?: string | null; // Reference to products/{productId}
  itemName: string;
  sku?: string | null;
  categoryId?: string | null; // Reference to categories/{categoryId}
  quantity: number;
  unit: string;
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  addToStock: boolean;
  batch?: string | null;
  expiryDate?: string | null;
  returnedQty?: number;
}

/**
 * 21. outflows/{outflowId}
 * Unified Outflow collection for both purchases and expenses
 */
export interface OutflowDoc {
  organizationId: string;
  branchId?: string;
  outflowNumber: string; // e.g. "PUR-2026-000001" or "EXP-2026-000001"
  kind: OutflowKind; // purchase or expense
  status: OutflowStatus; // draft, confirmed, voided
  docDate: string; // ISO 8601
  vendorId?: string | null; // Reference to vendors/{vendorId}
  vendorName?: string;
  payee?: string;
  invoiceNumber?: string; // External vendor invoice #
  dueDate?: string | null;
  lines: OutflowLine[];
  subTotal: number;
  discountTotal: number;
  taxTotal: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PaymentStatus; // paid, pending, partial
  taxSnapshot?: TaxSnapshot | null;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * Line item in Bill (POS / B2B)
 */
export interface BillItem {
  productId: string; // Reference to products/{productId}
  nameSnapshot: string; // Product name at sale time
  priceSnapshot: number; // Selling price at sale time
  costSnapshot: number; // Cost price at sale time
  taxCodeSnapshot?: string; // HSN/SAC snapshot
  quantity: number;
  unit: string;
  subtotal: number;
  discountValue: number;
  taxAmount: number;
  lineTotal: number;
  returnedQty?: number;
}

/**
 * Customer Snapshot on Bill
 */
export interface BillCustomerSnapshot {
  name: string;
  mobile?: string;
  email?: string;
  taxNumber?: string;
  billingAddress?: string;
  shippingAddress?: string;
}

/**
 * 22. bills/{billId}
 * Shared Sales & Billing engine (POS & B2B)
 */
export interface BillDoc {
  organizationId: string;
  branchId?: string;
  billNumber: string; // e.g. "INV-2026-000001", "POS-2026-000001", "QTN-2026-000001"
  salesMode: SalesMode; // pos or b2b
  documentType?: DocumentType; // invoice, quotation, sales_order, proforma
  salespersonMembershipId?: string | null;
  customerId?: string | null; // Reference to customers/{customerId}
  customerSnapshot?: BillCustomerSnapshot | null;
  items: BillItem[];
  subTotal: number;
  discountTotal: number;
  taxTotal: number;
  roundOff: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PaymentStatus;
  status: BillStatus | "draft" | "active" | "voided" | "cancelled" | "refunded";
  taxSnapshot?: TaxSnapshot | null;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 23. stockMovements/{movementId}
 */
export interface StockMovementDoc {
  organizationId: string;
  branchId?: string;
  productId: string; // Reference to products/{productId}
  type: StockMovementType;
  quantity: number; // Signed change (+ addition, - reduction)
  balanceAfter: number; // Maintained product stock after this movement
  unit: string;
  referenceId: string; // ID reference to bill, outflow, return, or adjustment
  referenceModel: "bill" | "outflow" | "return" | "manual_adjustment";
  reason?: string | null;
  createdAt: string;
  createdBy: string;
}

/**
 * Destination Delivery Address
 */
export interface DeliveryAddress {
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  pincode: string;
}

/**
 * Delivery Cash on Delivery (COD) Info
 */
export interface DeliveryCod {
  isCod: boolean;
  amount: number;
  isCollected: boolean;
  collectedAt?: string | null;
}

/**
 * 24. deliveries/{deliveryId}
 * Anti-embedding rule: references billId by ID only! Never embeds bill document.
 */
export interface DeliveryDoc {
  organizationId: string;
  branchId?: string;
  billId: string; // ID reference ONLY! No embedded bill object.
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  address: DeliveryAddress; // Destination delivery address
  riderMembershipId?: string | null;
  riderName?: string;
  partner: DeliveryPartner; // internal, swiggy, zomato, dunzo, other
  deliveryFee: number;
  status: DeliveryStatus;
  cod?: DeliveryCod;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * Return Line Item
 */
export interface ReturnItem {
  productId: string; // Reference to products/{productId}
  nameSnapshot: string;
  quantity: number;
  unit?: string;
  priceSnapshot: number;
  refundAmount: number;
  reason: string;
  disposition: ReturnDisposition; // restocked_to_inventory | wasted_discarded
}

/**
 * 25. returns/{returnId}
 */
export interface ReturnDoc {
  organizationId: string;
  branchId?: string;
  returnNumber: string; // e.g. "RET-2026-000001"
  returnType: ReturnType; // sales_return or purchase_return
  referenceId: string; // billId or outflowId (ID reference only!)
  referenceNumber: string;
  partyId?: string | null; // customerId or vendorId
  partyName?: string;
  items: ReturnItem[];
  totalRefundAmount: number;
  refundMethod: string; // cash, credit_note, original_payment
  status: "completed" | "voided";
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 26. payments/{paymentId}
 * Payment ledger record
 */
export interface PaymentDoc {
  organizationId: string;
  branchId?: string;
  paymentNumber: string; // e.g. "PAY-2026-000001"
  direction: PaymentDirection; // in (collection from customer) or out (payment to vendor)
  partyType: PartyType; // customer or vendor
  partyId?: string | null; // ID reference to customer or vendor
  partyName: string;
  amount: number;
  method: PaymentMethod;
  referenceId?: string | null; // billId or outflowId (ID reference only!)
  referenceModel?: "bill" | "outflow" | null;
  referenceNumber?: string | null;
  notes?: string;
  status: "completed" | "voided";
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 27. documentCounters/{counterId}
 * Document ID format: `${organizationId}_${type}_${year}` e.g. "org123_INV_2026"
 */
export interface DocumentCounterDoc {
  organizationId: string;
  type: string; // "INV", "POS", "PUR", "EXP", "PAY", "RET", "DEL"
  year: number;
  currentSequence: number;
  updatedAt: string;
}

/**
 * -------------------------------------------------------------
 * Operations & Intelligence Collections & Subdocuments
 * -------------------------------------------------------------
 */

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskRelatedEntityType = "bill" | "outflow" | "delivery" | "customer" | "vendor" | "product";

/**
 * 28. tasks/{taskId}
 */
export interface TaskDoc {
  organizationId: string; // Tenant reference
  title: string;
  description?: string;
  assignedToMembershipId: string; // Reference to memberships/{uid}_{orgId}
  assignedByMembershipId: string; // Reference to memberships/{uid}_{orgId}
  status: TaskStatus;
  priority: TaskPriority;
  dueAt?: string; // ISO 8601 string
  relatedEntityType?: TaskRelatedEntityType | null;
  relatedEntityId?: string | null; // ID-only reference
  completedAt?: string | null;
  completedByMembershipId?: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/**
 * 29. dailySummaries/{organizationId}_{date}
 */
export interface DailySummaryDoc {
  organizationId: string;
  date: string; // YYYY-MM-DD
  totalRevenue: number; // Gross bill total amount
  totalExpenses: number; // Outflow expenses total amount
  cogs: number; // Cost of goods sold (WAC * sold quantity)
  grossProfit: number; // totalRevenue - cogs
  netProfit: number; // grossProfit - totalExpenses
  billCount: number;
  outflowCount: number;
  paymentBreakdown: {
    cash: number;
    upi: number;
    card: number;
    bank_transfer: number;
    credit: number;
    other: number;
  };
  topProducts?: Array<{
    productId: string;
    nameSnapshot: string;
    quantity: number;
    revenue: number;
  }>;
  updatedAt: string;
}

/**
 * 30. monthlySummaries/{organizationId}_{yearMonth}
 */
export interface MonthlySummaryDoc {
  organizationId: string;
  yearMonth: string; // YYYY-MM
  totalRevenue: number;
  totalExpenses: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
  billCount: number;
  outflowCount: number;
  daysRecorded: number;
  updatedAt: string;
}

/**
 * 31. latestLocations/{organizationId}_{membershipId}
 */
export interface LatestLocationDoc {
  organizationId: string;
  membershipId: string; // Reference to memberships/{uid}_{orgId}
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number; // Accuracy in meters
  speed?: number; // Speed in m/s
  heading?: number; // Heading in degrees
  source: "foreground" | "background";
  recordedAt: string; // ISO 8601 string
  updatedAt: string;
}

/**
 * 32. locationPings/{organizationId}_{membershipId}_{timestamp}
 */
export interface LocationPingDoc {
  organizationId: string;
  membershipId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  source: "foreground" | "background";
  recordedAt: string;
  createdAt: string;
}

export type NotificationType =
  | "task_assigned"
  | "task_due"
  | "delivery_assigned"
  | "payment_received"
  | "low_stock"
  | "bill_created"
  | "outflow_recorded"
  | "account_updated";

/**
 * 33. notifications/{notificationId}
 */
export interface NotificationDoc {
  organizationId: string;
  userId: string; // Recipient user ID
  membershipId: string; // Recipient membership ID
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  data?: Record<string, string>;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

/**
 * -------------------------------------------------------------
 * Branch Architecture Models
 * -------------------------------------------------------------
 */

export interface BranchAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export interface BranchContact {
  phone?: string | null;
  email?: string | null;
  managerName?: string | null;
  contactPerson?: string | null;
}

export interface BranchSettings {
  allowNegativeStock?: boolean;
  autoFulfillDeliveries?: boolean;
  receiptPrefix?: string;
  taxInclusivePrices?: boolean;
  moduleOverrides?: Record<string, boolean>;
}

export interface BranchDoc {
  organizationId: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
  status?: EntityStatus;
  gstin?: string;
  address?: BranchAddress;
  contact?: BranchContact;
  settings?: BranchSettings;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export interface BranchCodeLockDoc {
  organizationId: string;
  code?: string;
  branchId: string;
  branchCode?: string;
  createdAt: string;
}

export interface MembershipBranchDoc {
  membershipId: string;
  userId: string;
  organizationId: string;
  branchId: string;
  status: EntityStatus;
  isDefaultForMembership: boolean;
  permissions?: Record<string, boolean>;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export interface StockBalanceDoc {
  organizationId: string;
  branchId: string;
  productId: string;
  currentStock: number;
  allocatedStock?: number;
  availableStock?: number;
  reorderPoint?: number;
  lowStockThreshold?: number;
  lastMovementId?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface OrganizationSharingPolicies {
  products?: "organization_shared" | "branch_scoped";
  categories?: "organization_shared" | "branch_scoped";
  customers?: "organization_shared" | "branch_scoped";
  vendors?: "organization_shared" | "branch_scoped";
  sales?: "organization_shared" | "branch_scoped";
  purchases?: "organization_shared" | "branch_scoped";
  expenses?: "organization_shared" | "branch_scoped";
  stock?: "branch_scoped";
  deliveries?: "organization_shared" | "branch_scoped";
}

// ============================================================
// Super Admin Usage Metering & Platform Consumption Models
// ============================================================

export type MeasurementClass =
  | "platform_actual" // Provider metrics from Cloud Monitoring / Billing Export
  | "app_attributed" // Server-instrumented operations attributed to Org/Branch
  | "client_estimate" // Direct client activity estimates
  | "allocated_cost"; // Calculated cost share using rate-card formula

export type ServiceType =
  | "firestore"
  | "functions"
  | "storage"
  | "auth"
  | "fcm"
  | "location";

export interface ServiceUsageCounts {
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
}

export interface OrganizationUsageDailyDoc {
  organizationId: string;
  date: string; // YYYY-MM-DD
  counts: ServiceUsageCounts;
  estimatedCost: number;
  currency: string;
  rateCardVersion: string;
  completenessPercent: number; // Indicates confidence/coverage (e.g., 90)
  measurementClass: MeasurementClass;
  updatedAt: string;
}

export interface BranchUsageDailyDoc {
  organizationId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  counts: ServiceUsageCounts;
  estimatedCost: number;
  currency: string;
  rateCardVersion: string;
  completenessPercent: number;
  measurementClass: MeasurementClass;
  updatedAt: string;
}

export interface PlatformUsageSnapshotDoc {
  date: string; // YYYY-MM-DD
  source: "cloud_monitoring" | "emulator_mock" | "app_aggregation";
  platformTotals: ServiceUsageCounts;
  platformActualCost?: number;
  currency: string;
  asOf: string;
}

export interface UsageRateCardDoc {
  version: string;
  effectiveDate: string;
  currency: string;
  rates: {
    firestoreReadPer100k: number;
    firestoreWritePer100k: number;
    firestoreDeletePer100k: number;
    functionsInvocationPerMillion: number;
    functionsComputeGbSecond: number;
    storageGbMonth: number;
    fcmPerThousand: number;
    locationPingPer100k: number;
  };
  status: "active" | "draft" | "deprecated";
  createdAt: string;
  createdBy: string;
}

export interface UsageAllocationRunDoc {
  runId: string;
  billingPeriod: string; // YYYY-MM
  rateCardVersion: string;
  totalPlatformCost: number;
  allocatedTenantCost: number;
  unallocatedPlatformOverhead: number;
  currency: string;
  status: "draft_estimate" | "audited";
  createdAt: string;
  createdBy: string;
}

