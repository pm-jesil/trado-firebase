/**
 * Domain Models for Firestore Collections
 * 
 * Strict architectural rule:
 * - Direct foreign relationships are modeled as Reference IDs, not embedded documents.
 * - Snapshots are permitted only when explicitly named *Snapshot and justified.
 */

import type { Timestamp } from "firebase-admin/firestore";
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
  SubscriptionStatus,
  SalesChannel,
  StockAdjustmentReason,
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
  updatedBy?: string;
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
  primaryBranchId?: string; // Canonical default active operating branch for this membership (assignments: membershipBranches)
  locationTrackingEnabled?: boolean; // Explicit consent flag for employee live-location tracking
  /** Optional per-module data scope override (self | team | branch | organization). */
  dataScopes?: Partial<Record<"sales" | "purchases" | "expenses" | "deliveries" | "returns" | "payments" | "stock" | "tasks", "self" | "team" | "branch" | "organization">>;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
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
  usageLimitOverrides?: UsageLimitsConfig; // Super Admin per-tenant usage limit overrides
  // Subscription (per organization; Super Admin only). ISO-8601 UTC instants, server-set.
  subscriptionStatus?: SubscriptionStatus;
  subscriptionStartsAt?: string;
  subscriptionExpiresAt?: string; // End of expiry date in `timezone`
  graceDays?: number;
  timezone?: string; // IANA zone, default "Asia/Kolkata"
  salesChannels?: SalesChannel[]; // One business can be e.g. wholesale + retail
  activeEmployeeCount?: number; // Transactional seat counter (excludes Owner)
  // Owner-editable profile (see ORGANIZATION_FIELD_POLICY)
  displayName?: string;
  taxNumber?: string | null; // GSTIN / VAT
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contacts?: OrganizationContact[];
  address?: BranchAddress;
  imageUrls?: string[];
  bankDetails?: OrganizationBankDetails | null;
  settings?: OrganizationSettings;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface OrganizationContact {
  id: string;
  name: string;
  designation?: string | null;
  phone?: string | null;
  email?: string | null;
  type?: "primary" | "billing" | "technical" | "operations" | "other";
  isPrimary: boolean;
  notifyBy?: "email" | "sms" | "both" | "none";
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface OrganizationBankDetails {
  accountName?: string;
  bankName?: string;
  accountNumber?: string; // Bank account for invoice printing; never a card number
  ifsc?: string;
  upiId?: string;
}

export interface OrganizationSettings {
  approvals?: ApprovalPolicy;
  /** Overrides of the business-type defaults (constants/businessDefaults.ts); absent = default. */
  businessConfig?: {
    defaultUnits?: string[];
    productFields?: Partial<Record<"expiry" | "batch" | "serial" | "variants" | "alternateUnits" | "jewellery", boolean>>;
    salesMode?: SalesMode;
  };
}

/**
 * Maker–checker policy. Off by default; when on, documents created by a user lacking the
 * module's approve permission are created as `pending` with no stock/ledger effect.
 * If no eligible approver other than the creator exists, the document auto-approves
 * with an audit note (small-org mode: never a deadlock).
 */
export interface ApprovalPolicy {
  enabled: boolean;
  modules?: Partial<Record<"sale" | "purchase" | "expense" | "return" | "stock_adjustment", boolean>>;
  amountThreshold?: number; // Only documents at/above this total need approval (0 = all)
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
  updatedBy?: string;
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
  updatedBy?: string;
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
  updatedBy?: string;
}

/**
 * 7. teams/{teamId}
 * Note: Teams NEVER embed members. Membership is queried via memberships.teamId == teamId.
 */
export interface TeamDoc {
  organizationId: string; // Reference to organizations/{organizationId}
  name: string;
  description?: string;
  leaderMembershipId?: string | null; // Team leader / manager (memberships/{id})
  isActive?: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
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
  usageLimits?: UsageLimitsConfig; // Plan baseline usage thresholds & limits
  isActive: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
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
  scope: string; // organizationId or "platform" (lets an organization's records be found and purged)
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
  changes?: AuditFieldChange[]; // Per-entity change history (immutable; never embedded on the entity)
  changedFields?: string[]; // Field names in `changes`, for array-contains queries (e.g. price history)
}

export interface AuditFieldChange {
  field: string;
  from: string | number | boolean | null | Record<string, unknown> | unknown[];
  to: string | number | boolean | null | Record<string, unknown> | unknown[];
}

/**
 * 14. users/{uid}/devices/{deviceId}
 */
export interface DeviceDoc {
  // Document id = deviceId (never repeated as a field)
  fcmToken: string;
  platform: "android" | "ios" | "web";
  createdAt: string;
  updatedAt: string;
}

/**
 * 15. notificationOutbox/{outboxId}
 */
export interface NotificationOutboxDoc {
  organizationId?: string;
  userId?: string;
  type: "welcome" | "system" | "usage_warning";
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
  isTaxable?: boolean;
  taxExemptionReason?: string;
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
  brand?: string;
  /** Stock is always held in `baseUnit`; alternate units convert by `factor` (1 box = 12 piece). */
  alternateUnits?: ProductAlternateUnit[];
  isDiscountable?: boolean;
  maxDiscountPercent?: number; // Billing rejects higher line discounts without bill:approve
  isReturnable?: boolean; // Default true; returnsCreate rejects non-returnable lines
  returnWindowDays?: number; // Sales returns allowed within N days of the bill
  reorderLevel?: number;
  maxStockLevel?: number;
  weight?: { value: number; unit: string };
  dimensions?: { length?: number; width?: number; height?: number; unit: string };
  size?: string;
  imagePaths?: string[]; // Cloud Storage object paths (see storage.rules size/MIME limits)
  warrantyMonths?: number;
  jewellery?: {
    grossWeightGrams?: number;
    netWeightGrams?: number;
    purity?: string;
    makingCharge?: number;
    makingChargeType?: "per_gram" | "flat" | "percent";
    hallmarkId?: string;
    priceByDailyRate?: boolean;
  };
  /** Variant model: each sellable variant is its own product (own SKU/stock/price) sharing a group id. */
  variantGroupId?: string | null;
  variantAttributes?: Record<string, string>;
  visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
  sharedForBranchIds?: string[];
  ownerBranchId?: string; // Branch that created the product (used by branch_only scope)
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ProductAlternateUnit {
  unit: string;
  factor: number; // base units per one of this unit
  sellingPrice?: number;
  wholesalePrice?: number;
  barcode?: string;
  isPurchaseUnit?: boolean;
  isSaleUnit?: boolean;
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
  updatedBy?: string;
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
  updatedBy?: string;
}

/**
 * 19. customers/{customerId}
 */
export interface CustomerDoc {
  organizationId: string;
  customerCode: string; // e.g. "CUST-000001"
  name: string;
  mobile?: string | null;
  additionalPhones?: string[];
  whatsApp?: string | null;
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
  updatedBy?: string;
}

/**
 * 20. vendors/{vendorId}
 */
export interface VendorDoc {
  organizationId: string;
  vendorCode: string; // e.g. "VEND-000001"
  name: string;
  mobile?: string | null;
  additionalPhones?: string[];
  whatsApp?: string | null;
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
  updatedBy?: string;
}

/**
 * Line item in Outflow (Purchase/Expense)
 */
export interface OutflowLine {
  lineId: string; // Stable line id ("L1", …): returns, stock movements and price history reference it
  productId?: string | null; // Reference to products/{productId} (name/SKU hydrated at read time)
  itemName?: string; // Non-catalog lines only (no productId)
  categoryId?: string | null; // Non-catalog lines only: reference to categories/{categoryId}
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
  conversionFactor?: number; // Base units per line unit, frozen at receipt
  baseQuantity?: number; // Good units added to stock, in base unit
  damagedQuantity?: number; // Damaged on receipt (line unit): billed, never stocked, written off
  damageReason?: string | null;
  // Serials received on this line live in serials/ (receivedLineId), never on the line
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
  status: OutflowStatus | "pending_approval" | "rejected"; // draft, confirmed, voided (approval state lives here)
  approvalNote?: string | null;
  requestedPaidAmount?: number;
  requestedPaymentMethod?: PaymentMethod;
  docDate: string; // ISO 8601 date-time of the purchase/expense (not date only)
  payeeType?: "vendor" | "employee" | "other";
  payeeMembershipId?: string | null; // Employee-linked expense (salary, advance, reimbursement)
  expenseCategoryId?: string | null;
  billDiscountAmount?: number;
  attachmentPaths?: string[];
  createdByMembershipId?: string | null;
  vendorId?: string | null; // Reference to vendors/{vendorId}
  payee?: string; // Free-text counterparty only when there is no vendorId / payeeMembershipId
  recurringTemplateId?: string; // recurringExpenses/{templateId} that generated this expense
  invoiceNumber?: string; // External vendor invoice #
  dueDate?: string | null;
  lines: OutflowLine[];
  productIds?: string[]; // Denormalized line product ids (array-contains queries: price history)
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
  updatedBy?: string;
}

/**
 * Line item in Bill (POS / B2B)
 */
export interface BillItem {
  lineId: string; // Stable line id ("L1", "L2", …): returns, deliveries and stock movements reference it
  productId: string; // Reference to products/{productId} (name/SKU are hydrated at read time)
  priceSnapshot: number; // Selling price at sale time
  costSnapshot: number; // Cost price at sale time
  taxCodeSnapshot?: string; // HSN/SAC snapshot
  quantity: number; // In the line unit
  unit: string;
  conversionFactor?: number; // Base units per line unit, frozen at sale time
  baseQuantity?: number; // quantity * conversionFactor (stock unit)
  trackStock?: boolean; // Product trackStock at sale time (serials sold on the line live in serials/, by soldLineId)
  isReturnable?: boolean; // false when the product was non-returnable at sale time
  subtotal: number;
  discountValue: number;
  taxAmount: number;
  lineTotal: number;
  returnedQty?: number;
}

/**
 * Bill-to party on a bill (register entry DUP-BILLTO, kind R2).
 * - Registered customer: frozen from customers/{customerId} only when the bill becomes a finalized
 *   tax invoice (GST Rule 46 requires the recipient's name, address and GSTIN as issued).
 * - Walk-in sale without customerId: the details typed at the counter (owned by the bill).
 */
export interface BillToSnapshot {
  name: string;
  mobile?: string;
  taxNumber?: string;
  billingAddress?: string;
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
  billToSnapshot?: BillToSnapshot | null;
  items: BillItem[];
  subTotal: number;
  discountTotal: number;
  taxTotal: number;
  roundOff: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PaymentStatus;
  status: BillStatus | "draft" | "active" | "voided" | "cancelled" | "refunded" | "pending_approval" | "rejected";
  approvalNote?: string | null; // Approval state lives in status (pending_approval / rejected) + approvedBy/rejectedBy
  requestedPaidAmount?: number; // Tender held until approval
  requestedPaymentMethod?: PaymentMethod;
  stockReserved?: boolean; // Sales order holding allocatedStock
  createdByMembershipId?: string | null;
  taxSnapshot?: TaxSnapshot | null;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * 23. stockMovements/{movementId}
 */
export interface StockMovementDoc {
  organizationId: string;
  branchId?: string;
  productId: string; // Reference to products/{productId}
  type: StockMovementType;
  quantity: number; // Signed change in the product's BASE unit (+ addition, - reduction)
  balanceAfter: number; // Branch stock after this movement (R4 ledger running balance)
  referenceId: string; // ID reference to bill, outflow, return, or adjustment
  referenceModel: "bill" | "outflow" | "return" | "manual_adjustment";
  referenceLineId?: string; // Source line (bills.items[].lineId / outflows.lines[].lineId / return sourceLineId)
  reason?: string | null;
  reasonCode?: StockAdjustmentReason | null; // Write-off classification for adjustments
  unitCostSnapshot?: number; // Cost per base unit at movement time (values write-offs)
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
  customerId?: string | null; // Copied reference of bills/{billId}.customerId (query index, R3)
  recipient?: { name: string; phone: string }; // Only when the person at the door differs from the bill-to party
  address: DeliveryAddress; // Destination delivery address (owned: may differ from the customer's address)
  lines: Array<{ lineId: string; quantity: number }>; // What this delivery carries (bills.items lineId, line unit)
  riderMembershipId?: string | null; // Rider name is hydrated at read time (included.members)
  partner: DeliveryPartner; // internal, swiggy, zomato, dunzo, other
  deliveryFee: number;
  status: DeliveryStatus;
  cod?: DeliveryCod;
  deliveredAt?: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Return Line Item
 */
export interface ReturnItem {
  sourceLineId: string; // lineId on the referenced bill/purchase: price and cost come from that line by reference
  productId: string; // Reference to products/{productId}
  quantity: number; // In the source line's unit
  baseQuantity: number; // quantity × the source line's frozen conversionFactor (stock unit)
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
  partyId?: string | null; // Derived from the referenced document (customerId / vendorId) for statements
  items: ReturnItem[];
  totalRefundAmount: number;
  refundMethod: string; // cash, credit_note, original_payment
  status: "completed" | "voided" | "pending_approval" | "rejected";
  /** Pending approval only: the requested lines (owned request data; replaced by `items` when approved). */
  requestedItems?: Array<{ productId: string; sourceLineId?: string; quantity: number; refundAmount: number; reason: string; disposition: ReturnDisposition; serialNumbers?: string[] }>;
  approvalNote?: string | null;
  notes?: string;
  createdAt: string;
  createdBy: string;
  createdByMembershipId?: string | null;
  updatedAt?: string;
  updatedBy?: string;
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
  partyName?: string; // Only for a standalone payment with no partyId and no referenceId (owned free text)
  amount: number;
  method: PaymentMethod;
  referenceId?: string | null; // billId or outflowId (ID reference only!)
  referenceModel?: "bill" | "outflow" | null;
  notes?: string;
  /** Gateway extension point (design only; no gateway integrated). Never store card numbers. */
  gateway?: {
    externalReference?: string;
    gatewayProvider?: string;
    gatewayStatus?: "initiated" | "authorized" | "captured" | "failed" | "refunded";
    cardBrand?: string;
    cardLast4?: string;
  };
  status: "completed" | "voided";
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
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
  updatedBy?: string;
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
  branchId?: string;
  membershipId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  source: "foreground" | "background";
  recordedAt: string; // ISO 8601 string from device
  createdAt: string; // ISO 8601 string of server ingestion time
  expiresAt: Timestamp; // Native Firestore Timestamp for Cloud Firestore TTL
}

export type NotificationType =
  | "task_assigned"
  | "task_due"
  | "delivery_assigned"
  | "payment_received"
  | "low_stock"
  | "bill_created"
  | "outflow_recorded"
  | "account_updated"
  | "usage_warning";

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
  gstin?: string;
  address?: BranchAddress;
  contact?: BranchContact;
  settings?: BranchSettings;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * uniqueKeys/{organizationId}_{kind}_{normalized key} — natural-key uniqueness locks (one collection
 * for barcodes, branch codes, vendor invoice numbers, party phones / tax ids, catalog names, serials).
 * The key is the document id; nothing of the entity is copied.
 */
export interface UniqueKeyDoc {
  organizationId: string;
  kind: string; // UniqueKeyKind (services/uniqueKeys.ts)
  entityType: string;
  entityId: string;
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
  updatedBy?: string;
}

export interface StockBalanceDoc {
  organizationId: string;
  branchId: string;
  productId: string;
  currentStock: number; // R3 cache of SUM(stockMovements.quantity) for (org, branch, product)
  allocatedStock?: number; // R3 cache of open sales-order reservations (available = current - allocated, computed)
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

export interface OrganizationUsageMonthlyDoc {
  organizationId: string;
  month: string; // YYYY-MM
  counts: ServiceUsageCounts;
  estimatedCost: number;
  currency: string;
  rateCardVersion: string;
  completenessPercent: number;
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

export interface BranchUsageMonthlyDoc {
  organizationId: string;
  branchId: string;
  month: string; // YYYY-MM
  counts: ServiceUsageCounts;
  estimatedCost: number;
  currency: string;
  rateCardVersion: string;
  completenessPercent: number;
  measurementClass: MeasurementClass;
  updatedAt: string;
}

// warn_only: warnings only; hard_block: the breached metric class is refused. (soft_throttle was removed:
// it only warned, i.e. duplicated warn_only — decision D-19.)
export type EnforcementMode = "warn_only" | "hard_block";

export interface MetricLimitConfig {
  dailyLimit?: number; // Maximum allowed operations per day (undefined/0 = disabled)
  weeklyLimit?: number; // Maximum per ISO week (Monday start, organization timezone)
  monthlyLimit?: number; // Maximum allowed operations per month
  warningThresholdPercent: number; // e.g. 80 (80%)
  hardThresholdPercent: number; // e.g. 100 (100%)
  enforcementMode: EnforcementMode; // "warn_only" default
  enabled: boolean;
}

export type UsageLimitsConfig = Partial<Record<keyof ServiceUsageCounts, MetricLimitConfig>>;


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



/**
 * serials/{organizationId}_{SERIAL} — one document per serial-tracked unit (IMEI, frame number…).
 * References only (product, receiving purchase line, holding/selling bill line); see services/serials.ts.
 */
export interface SerialDoc {
  organizationId: string;
  serial: string; // normalized (upper-case, no spaces); also the document id suffix
  productId: string;
  branchId: string;
  status: "pending_receipt" | "in_stock" | "reserved" | "sold" | "returned" | "damaged" | "vendor_returned";
  receivedOutflowId?: string;
  receivedLineId?: string;
  holdBillId?: string | null;
  holdLineId?: string | null;
  soldBillId?: string | null;
  soldLineId?: string | null;
  returnId?: string;
  adjustmentId?: string; // correlates the units of one stock adjustment
  createdAt: string;
  updatedAt: string;
}

/**
 * stockAdjustmentRequests/{requestId} — a stock adjustment waiting for approval (maker–checker).
 * Approval writes the stock movement through the stock engine and links it (movementId).
 */
export interface StockAdjustmentRequestDoc {
  organizationId: string;
  branchId: string;
  productId: string;
  quantity: number; // signed, base unit
  reason: string;
  reasonCode?: StockAdjustmentReason;
  serialNumbers?: string[]; // owned request data for serial-tracked products
  status: "pending_approval" | "approved" | "rejected";
  approvalNote?: string | null;
  movementId?: string;
  createdAt: string;
  createdBy: string;
  createdByMembershipId?: string | null;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}
