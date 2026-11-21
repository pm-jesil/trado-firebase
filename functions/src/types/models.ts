/**
 * Domain Models for Firestore Collections
 * 
 * Strict architectural rule:
 * - Direct foreign relationships are modeled as Reference IDs, not embedded documents.
 * - Snapshots are permitted only when explicitly named *Snapshot and justified.
 */

import type { Timestamp } from "firebase-admin/firestore";
import type { z } from "zod";
import type { AddressSchema, BankAccountSchema, ContactPersonSchema } from "../validation/sharedSchemas.js";
import type { BranchSettingsSchema, CreateRecurringExpenseSchema } from "../validation/schemas.js";
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
  RequestCategory,
  type RequestAudience,
  type RequestKind,
  type RequestPriority,
  type RequestSeverity,
  RequestStatus,
  type SlaState,
  type RequestAction,
  type RequestResolutionType,
} from "../constants/enums.js";

/**
 * 1. users/{uid}
 * Document ID = Firebase Auth UID
 *
 * D-15: ONE stored image field: `image: ImageRef`. No URL inside it.
 * The computed display URL (`imageUrl`) is added by the hydration layer at read time.
 * `photoUrl` and `avatarUrl` are REMOVED — they are D-15 violations and compile errors.
 */
export interface UserDoc {
  name: string;
  nameParts?: { first: string; last: string };
  email: string;
  phone?: string | null;
  accountType: "standard" | "admin" | "system";
  /** D-15: single stored image reference; no URL stored inside it. */
  image?: ImageRef;
  primaryOrganizationId?: string;
  mustChangePassword?: boolean;
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
  reportsToUid?: string | null; // Direct reporting person UID (Q-F23 hierarchy routing)
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
 * D-15: ImageRef — the ONLY stored image structure in the system.
 * - `path`: Cloud Storage object path (never a full URL — paths are stable; URLs expire).
 * - `url` is NOT stored; it is computed at read time by the hydration layer.
 * - Every entity that carries an image stores ONE field named `image` of this type.
 * - `photoUrl`, `avatarUrl`, `logoUrl`, `imageUrls` are REMOVED from all stored documents.
 *
 * D-16: No `as any` cast on write paths — ImageRef is used end-to-end without casts.
 */
export interface ImageRef {
  path: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
  updatedAt: string;
  /** thumbnailPath: storage path of the smaller thumbnail asset (products only). */
  thumbnailPath?: string;
}

/**
 * D-15 compliant. ONE stored image: `image: ImageRef`. No `logoUrl`, no `imageUrls`.
 * Computed `imageUrl` added at read time by the hydration layer.
 *
 * D-16: `bankAccounts` typed as `BankAccountRecord[]` — no `any[]`.
 *
 * Contact model: `contact` (flat primary contact) + `contacts` (list up to 20).
 * `contactEmail` and `contactPhone` are TOP-LEVEL convenience shortcuts for the primary
 * contact stored flat — preserved for query efficiency but must stay in sync with `contact`.
 * `address` is the primary/registered address; `addresses` is the full list.
 * `bankDetails` removed — superseded by `bankAccounts: BankAccountRecord[]`.
 */
export interface OrganizationDoc {
  name: string;
  code?: string;
  legalName?: string;
  legalNameKey?: string; // normalized legalName, unique-lookup key (written by organizationsCreate / Update)
  businessType: BusinessType;
  businessCategory: BusinessCategory;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217 code
  taxRegimeCode: string; // Reference to taxRegimes/{taxRegimeCode}
  status: EntityStatus;
  planId: string; // Reference to subscriptionPlans/{planId}
  moduleToggles: Record<string, boolean>; // Per-tenant feature switches
  /** D-15: single stored image reference (org logo); no URL inside. */
  image?: ImageRef;
  ownerStatus?: "pending" | "active";
  ownerUserId?: string | null;
  financialYearStartMonth?: number;
  defaultBranchId?: string;
  branchCount?: number;
  sharingPolicies?: OrganizationSharingPolicies;
  usageLimitOverrides?: UsageLimitsConfig; // Super Admin per-tenant usage limit overrides
  showCostToTenant?: boolean; // D-25: tenants see the cost estimate (labelled) only when the Super Admin enables it
  supportAccessExpiresAt?: string | null; // BC3 / MG-40: Tenant-granted expiring support access grant for Super Admin
  // Subscription (per organization; Super Admin only). ISO-8601 UTC instants, server-set.
  subscriptionStatus?: SubscriptionStatus;
  subscriptionStartsAt?: string;
  subscriptionExpiresAt?: string; // End of expiry date in `timezone`
  graceDays?: number;
  timezone?: string; // IANA zone from country defaults
  salesChannels?: SalesChannel[]; // One business can be e.g. wholesale + retail
  activeEmployeeCount?: number; // Transactional seat counter (excludes Owner)
  // Owner-editable profile (see ORGANIZATION_FIELD_POLICY)
  displayName?: string;
  taxId?: string | null;
  website?: string | null; // R1: external reference — URL is intentional here (D-15 exception)
  /** R3: convenience shortcut duplicating contact.email — single writer: organizationsUpdate */
  contactEmail?: string | null;
  /** R3: convenience shortcut duplicating contact.phone — single writer: organizationsUpdate */
  contactPhone?: string | null;
  contact?: OrganizationPrimaryContact;
  contacts?: OrganizationContact[];
  address?: AddressRecord;
  addresses?: AddressRecord[];
  /** D-16: typed bank accounts — no `any`. Single source: BankAccountRecord[]. */
  bankAccounts?: BankAccountRecord[];
  settings?: OrganizationSettings;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}


/** Flat primary contact stored as a convenience field (R3 cache, single writer: organizationsUpdate). */
export interface OrganizationPrimaryContact {
  name: string;
  email: string;
  phone: string;
  altPhone?: string;
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


export interface AccountingPolicy {
  selfApprovalPolicy?: "off" | "up_to_limit" | "on";
  selfApprovalLimits?: Record<string, number>;
  roundingMode?: "half_up" | "half_even";
  roundToNearestRupee?: boolean;
  cashRoundingFils?: boolean;
  cashCountVarianceThreshold?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface OrganizationSettings {
  approvals?: ApprovalPolicy;
  accountingPolicy?: AccountingPolicy;
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
  modules?: Partial<Record<"sale" | "purchase" | "expense" | "return" | "stock_adjustment" | "account_transfer" | "stock_transfer", boolean>>;
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
  code: string; // e.g. "warehouse_manager", "delivery_executive"
  isSystem: boolean;
  description?: string;
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
  isArchived?: boolean; // set by the plan archive callable; archived plans cannot be assigned
  isPublic?: boolean; // visible in tenant plans catalog (D-35, Prompt 74)
  showPriceToTenants?: boolean; // whether tenants can see price (Q-RQ4 / A-09)
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

export interface TaxSlab {
  name: string; // e.g. "Standard", "Zero", "Reduced", "Exempt"
  rate: number; // e.g. 0, 5, 10, 18
  hsnPrefixes?: string[]; // Optional HSN prefix matching
  isDefault?: boolean;
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
  taxType?: "gst" | "vat" | "sales_tax" | "none";
  defaultRate?: number;
  rates?: number[];
  slabs?: TaxSlab[];
  labels?: {
    taxName: string;
    registrationLabel: string;
    invoiceTitle: string;
  };
  supportsInterState?: boolean;
  roundingMethod?: "commercial" | "floor" | "ceil";
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
  updatedAt?: string; // set when a timed-out PROCESSING record self-heals to SUCCEEDED
  processingExpiresAt?: string; // ISO 8601 lease timeout for PROCESSING status
  expiresAt: string; // ISO 8601
}

/**
 * 13. auditLogs/{requestId}_{seq}: written only by services/auditRecorder.ts (prompt 66 §6.2).
 * Mutation events are written in the same commit as the mutation; the id makes a replay idempotent.
 */
export interface AuditLogDoc {
  occurredAt: Timestamp; // server clock
  occurredLocalDate: string; // YYYY-MM-DD in the organization timezone
  organizationId: string; // the organization the event belongs to, or "platform" (D-21)
  targetOrgId?: string | null; // the organization platform work was done for
  actorUid: string | null; // null for triggers and scheduled jobs
  actor: { kind: "user" | "system" | "trigger" | "scheduled" | "superAdminOnBehalf"; role?: string | null; membershipId?: string | null; branchId?: string | null };
  source: { callable?: string; trigger?: string; scheduled?: string; requestId: string; clientRequestId?: string | null; eventId?: string | null };
  device?: { deviceId: string | null; deviceRegistered: boolean | null; platform: string | null; appVersion: string | null; ipTruncated: string | null; userAgentFamily: string | null; appCheckVerified: boolean | null };
  action: string; // "<entity>.<verb>" from constants/auditRegistry.ts
  category: "mutation" | "read_sensitive" | "export" | "auth" | "file" | "security" | "admin" | "system";
  outcome: "success" | "denied" | "failed";
  reason: string | null; // stable details.reason of a denial or failure
  attemptedAction?: string | null; // the action a denied request tried
  entityType: string | null; // the primary target (query key)
  entityId: string | null;
  targets?: Array<{ type: string; id: string; path: string | null; op: string | null }>; // every changed document, primary first
  changes?: { fields: AuditFieldChange[]; truncated: boolean; redacted: string[]; beforeAvailable: boolean };
  changedFields?: string[]; // top-level fields in "changes", for array-contains queries (price history)
  details?: Record<string, unknown>; // reason fields of the request (registry inputFields), redacted
  ops?: { reads: number; writes: number; deletes: number }; // operations of the request at commit
  suppressedSincePrevious?: number; // rate-limited security events folded into this one
  operation?: "create" | "update" | "delete" | "status_change";
  statusBefore?: string | null;
  statusAfter?: string | null;
  humanLabel?: string | null;
  amount?: number | null;
  currency?: string | null;
  branchId?: string | null;
  expireAt: Timestamp; // TTL (system setting AUDIT_RETENTION_MONTHS, default 24)
}

export interface AuditFieldChange {
  path: string;
  op: string; // set | unset | inc | server_time | array
  before?: unknown; // only when the request had already read the document (no extra read)
  after?: unknown;
}

/**
 * 14. users/{uid}/devices/{deviceId}
 */
export interface DeviceDoc {
  // Document id = deviceId (never repeated as a field)
  fcmToken: string;
  platform: "android" | "ios" | "web";
  lastLoginAt?: string; // written by authLogin on every sign-in from this device
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

export interface TaxBreakdownItem {
  name: string;
  rate: number;
  amount: number;
  taxableAmount?: number;
}

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
  breakdown?: TaxBreakdownItem[];
  isInterState?: boolean;
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
 * Stored address / bank account / contact person records. Derived from the shared Zod schemas that
 * produce the stored values (validation/sharedSchemas.ts), so the stored type cannot drift from what
 * the callables write. Used by organizations, branches, customers and vendors.
 */
export type AddressRecord = z.output<typeof AddressSchema>;
export type BankAccountRecord = z.output<typeof BankAccountSchema>;
export type ContactPersonRecord = z.output<typeof ContactPersonSchema>;

/**
 * 19. customers/{customerId}
 */
export interface CustomerDoc {
  organizationId: string;
  customerCode: string; // e.g. "CUST-000001"
  name: string;
  legalName?: string | null;
  partyType?: "organization" | "person";
  image?: ImageRef | null;
  /** Structured contact persons (replaces contactPerson: any). */
  contacts?: ContactPersonRecord[];
  phone?: string | null;
  additionalPhones?: string[];
  email?: string | null;
  taxId?: string | null;
  /** Structured address array (replaces flat billingAddress/shippingAddress strings). */
  addresses?: AddressRecord[];
  bankAccounts?: BankAccountRecord[];
  priceGroup?: string; // "retail", "wholesale", "distributor"
  creditLimit: number;
  creditPeriodDays: number;
  outstandingBalance: number; // Udhaar amount customer owes
  advanceBalance?: number; // Advance payments / credits unapplied
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
  legalName?: string | null;
  partyType?: "organization" | "person";
  image?: ImageRef | null;
  phone?: string | null;
  additionalPhones?: string[];
  email?: string | null;
  taxId?: string | null;
  /** Structured address array (replaces flat address string). */
  addresses?: AddressRecord[];
  bankAccounts?: BankAccountRecord[];
  /** Structured contact persons (replaces contactPerson: any). */
  contacts?: ContactPersonRecord[];
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
/**
 * Who approved, rejected or voided a document and why. Written only by the decide / void callables
 * (bills, outflows, payments, returns, stock adjustment requests). `approvalNote` is the requester's
 * note; `approvalReason` is the decider's reason.
 */
export interface DecisionStamps {
  submittedAt?: string;
  submittedBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  approvalReason?: string | null;
  postedAt?: string;
  postedBy?: string;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface SplitPaymentEntry {
  method: PaymentMethod;
  amount: number;
  financialAccountId: string;
  notes?: string;
}

export interface OutflowDoc extends DecisionStamps {
  organizationId: string;
  branchId?: string;
  financialAccountId?: string | null;
  storageLocationId?: string | null;
  splitPayments?: SplitPaymentEntry[];
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
  phone?: string;
  taxId?: string;
  billingAddress?: string;
}

/**
 * 22. bills/{billId}
 * Shared Sales & Billing engine (POS & B2B)
 */
export interface BillDoc extends DecisionStamps {
  organizationId: string;
  branchId?: string;
  financialAccountId?: string | null;
  storageLocationId?: string | null;
  splitPayments?: SplitPaymentEntry[];
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
  stockReserved?: boolean;
  finalizedAt?: string; // quotation / proforma converted to an invoice
  finalizedBy?: string;
  originalQuotationNumber?: string; // R2: number of the quotation this invoice was finalized from // Sales order holding allocatedStock
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
  storageLocationId?: string; // Reference to storageLocations/{id}
  productId: string; // Reference to products/{productId}
  type: StockMovementType;
  quantity: number; // Signed change in the product's BASE unit (+ addition, - reduction)
  balanceAfter: number; // Branch stock after this movement (R4 ledger running balance)
  referenceId: string; // ID reference to bill, outflow, return, adjustment, or transfer
  referenceModel: "bill" | "outflow" | "return" | "manual_adjustment" | "stock_transfer";
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
export interface ReturnDoc extends DecisionStamps {
  organizationId: string;
  branchId?: string;
  returnNumber: string; // e.g. "RET-2026-000001"
  returnType: ReturnType; // sales_return or purchase_return
  referenceId: string; // billId or outflowId (ID reference only!)
  partyId?: string | null; // Derived from the referenced document (customerId / vendorId) for statements
  items: ReturnItem[];
  totalRefundAmount: number;
  refundMethod: string; // cash, credit_note, original_payment
  financialAccountId?: string | null;
  accountTransactionId?: string | null;
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
 * Payment allocation against an individual bill or outflow
 */
export interface PaymentAllocation {
  documentId: string;
  documentType: "bill" | "outflow";
  amount: number;
}

/**
 * 26. payments/{paymentId}
 * Payment ledger record
 */
export interface PaymentDoc extends DecisionStamps {
  organizationId: string;
  branchId?: string;
  financialAccountId?: string | null; // Operational cash/bank account ledger reference
  allocations?: PaymentAllocation[]; // Multi-document settlement breakdown
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
  expiresAt?: Timestamp; // BC3: Firestore Timestamp TTL for pruning inactive latestLocations
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
  | "request_updated"
  | "usage_warning";

/**
 * 33. notifications/{notificationId}
 */
export interface NotificationDoc {
  organizationId: string;
  userId: string; // Recipient user ID
  membershipId?: string | null; // Recipient membership ID
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


export interface BranchContact {
  phone?: string | null;
  email?: string | null;
  managerName?: string | null;
  contactPerson?: string | null;
}

/** Stored branch settings: the output of BranchSettingsSchema (validation/schemas.ts). */
export type BranchSettings = z.output<typeof BranchSettingsSchema>;

export interface BranchDoc {
  organizationId: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
  taxId?: string;
  address?: AddressRecord;
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
  inTransitQty?: number; // Physical inventory in transit between branches
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

export interface UsageOps {
  reads: number;
  writes: number;
  deletes: number;
  aggregationReads?: number; // reads billed for count() / aggregations (part of reads)
}

/** Quantities of one rollup document (prompt 66 Part 5): written by services/requestRecorder.ts only. */
export interface UsageRollupQuantities {
  calls?: number;
  errors?: number;
  denied?: number;
  durationMsSum?: number;
  bytesIn?: number; // request payload bytes
  bytesOut?: number; // response bytes
  redundantReads?: number; // a document read twice in one request with no write in between
  ops?: UsageOps; // every Firestore operation of the requests, overhead included
  byCategory?: Partial<Record<"gate" | "app" | "audit" | "meter", UsageOps>>; // gate reads, business, audit and meter writes
  byCallable?: Record<string, UsageOps & { calls: number }>;
  byCollection?: Record<string, UsageOps>; // collection templates ("organizations/{id}/branches"), bounded, overflow "other"
  hourly?: Record<string, UsageOps & { calls: number }>; // "00".."23" (UTC hour)
  shadowChecked?: number; // emulator only: requests whose counts the independent shadow counter checked
  shadowMismatch?: number; // emulator only: requests where it disagreed (must stay 0)
  shadowMismatchLast?: string;
  lastSeenAt?: Timestamp; // last flush (within the flush interval of the last call)
  expireAt?: Timestamp; // TTL (system setting METER_RETENTION_MONTHS, default 25)
}

/**
 * organizationUsageDaily/{organizationId|platform}_{utcDate}: organization × day cost rollup, quantities
 * only (D-22); cost is derived when read (services/usageReport.ts). "platform" holds platform work with
 * targets per organization (D-21). `clientReported`: numbers the app reported (usageRecordClientMetric),
 * untrusted and kept apart from what the server measured.
 */
export interface OrganizationUsageDailyDoc extends UsageRollupQuantities {
  organizationId: string;
  date: string; // YYYY-MM-DD (UTC: reconciles with the billing export)
  targets?: Record<string, UsageOps & { calls: number }>;
  clientReported?: Partial<ServiceUsageCounts>;
  updatedAt?: string;
}

/** branchUsageDaily/{organizationId}_{branchId}_{date}: client-reported numbers (usageRecordClientMetric) only. */
export interface BranchUsageDailyDoc {
  organizationId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  clientReported?: Partial<ServiceUsageCounts>; // untrusted client estimates
  updatedAt?: string;
}

// warn_only: warnings only; hard_block: the breached metric class is refused. (soft_throttle was removed:
// it only warned, i.e. duplicated warn_only — decision A-01.)
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
  /** Per rate: where the price comes from and whether it was checked against the official pricing (prompt 66 §2.3). */
  verification?: Partial<Record<keyof UsageRateCardDoc["rates"], { verified: boolean; source: string; verifiedAt: string | null; region?: string }>>;
  /** Project-level free allowance (not allocated to organizations); with its source. */
  freeTier?: { firestoreReadsPerDay: number; firestoreWritesPerDay: number; firestoreDeletesPerDay: number; firestoreStoredGiB: number; egressGiBPerMonth: number; source: string; verifiedAt: string };
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
export interface StockAdjustmentRequestDoc extends DecisionStamps {
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
  updatedAt?: string;
  updatedBy?: string;
}


/**
 * recurringExpenses/{templateId}: one template per recurring cost; the daily sweep turns each due
 * period into an outflow through outflowsCreate. Client fields are the create schema's output.
 */
export interface RecurringExpenseDoc extends Omit<z.output<typeof CreateRecurringExpenseSchema>, "idempotencyKey" | "organizationId" | "branchId" | "endOn"> {
  organizationId: string;
  branchId: string;
  endOn?: string | null;
  nextRunOn: string; // calendar date (organization timezone) of the next generation
  lastGeneratedPeriod?: string; // YYYY-MM (monthly) or YYYY-MM-DD (weekly)
  isActive: boolean;
  createdBy: string;
  createdByMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

/** imageUploadSessions/{uploadId}: one client upload slot (imagesCreateUploadSession); consumed once by imagesAttach. */
export interface ImageUploadSessionDoc {
  uploadId: string;
  scope: string; // organizationId, "platform" or "users"
  callerUid: string;
  purpose: string;
  entityType: string;
  entityId: string | null;
  contentType: string;
  maxBytes: number;
  uploadPath: string; // tmp/{scope}/{uid}/{uploadId}
  isUsed: boolean;
  createdAt: string;
  expiresAt: string;
  attachedAt?: string; // set by attachUploadedImage when the upload is attached
  finalPath?: string; // storage path of the processed image, set on attach
}

/**
 * Request Attachment Ref
 */
export interface RequestAttachment {
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt?: string;
}

/**
 * 24. requests/{requestId} (Prompt 74, D-36..D-45)
 * Platform-domain request document. Never holds internal notes (D-38).
 */
export interface RequestDoc {
  requestNumber: string; // REQ-YYYY-000123
  audience: RequestAudience | "platform" | "organization";
  category: RequestCategory;
  kind: RequestKind | "approval" | "work";
  title: string;
  description: string;
  details: Record<string, unknown>;
  priority: RequestPriority | "low" | "normal" | "high" | "urgent";
  severity?: RequestSeverity | "minor" | "major" | "critical";
  status: RequestStatus;
  statusReason?: string | null;
  statusChangedAt: string;
  requester: {
    uid: string;
    name: string;
    roleLabel: string;
  };
  organizationId: string;
  branchId?: string | null;
  relatedEntity?: {
    type: string;
    id: string;
    label: string;
  } | null;
  assignee?: {
    uid: string;
    name: string;
  } | null;
  attachments: RequestAttachment[];
  labels: string[];
  idempotencyKey?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  lastActivityBy: {
    uid: string;
    name: string;
    isPlatform: boolean;
  };
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt?: string | null;
  slaState: SlaState | "on_track" | "at_risk" | "breached" | "paused";
  slaPausedAt?: string | null;
  slaTotalPausedMs: number;
  resolvedAt?: string | null;
  closedAt?: string | null;
  resumeOn?: string | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  applyResult?: Record<string, unknown> | null;
  requesterName: string;
  currentPlanName?: string | null;
  requestedPlanName?: string | null;
}

export type { RequestAction, RequestResolutionType };

/**
 * 25. requests/{requestId}/activity/{activityId}
 * Timeline entry. Visibility 'internal' is stripped for tenants (D-38).
 */
export interface RequestActivityDoc {
  requestId: string;
  type: "comment" | "status_change" | "assignment" | "priority_change" | "apply" | "system";
  visibility: "public" | "internal";
  author: {
    uid: string;
    name: string;
    roleLabel: string;
    isPlatform: boolean;
  };
  content?: string | null;
  details?: Record<string, unknown> | null;
  attachments?: RequestAttachment[];
  createdAt: string;
}

/**
 * 26. counters/{counterId}
 * Per-year sequential counter for request numbers (e.g. counters/requests).
 */
export interface RequestCounterDoc {
  year: number;
  currentSequence: number;
  updatedAt: string;
}

/**
 * 27. platformSettings/{settingId}
 * Global requests module settings (e.g. platformSettings/requests).
 */
export interface PlatformSettingsRequestsDoc {
  requestsEnabled: boolean;
  sla: {
    urgent: { firstResponseHours: number; resolutionHours: number };
    high: { firstResponseHours: number; resolutionHours: number };
    normal: { firstResponseHours: number; resolutionHours: number };
    low: { firstResponseHours: number; resolutionHours: number };
  };
  limits: {
    maxOpenPerUser: number;
    maxOpenPerOrg: number;
    maxCreationsPerHourPerUser: number;
  };
  autoCloseDays: number;
  reopenWindowDays: number;
  needsInfoReminderDays: number;
  needsInfoAutoCancelDays: number;
  categoryAvailability?: Record<string, boolean>;
  updatedAt?: string;
  updatedBy?: string;
}


export type FinancialAccountType = "cash" | "bank" | "digital" | "clearing" | "control";

/**
 * 28. financialAccounts/{id}
 * Operational financial accounts (cash desks, bank current accounts, digital wallets).
 */
export interface FinancialAccountDoc {
  organizationId: string;
  branchId?: string | null; // null for organization-shared accounts
  assignedBranchIds?: string[]; // Multiple branch assignment (Section 8.1)
  name: string;
  code: string;
  accountType: FinancialAccountType;
  currency: string;
  bankDetails?: {
    bankName?: string;
    accountNumberMasked?: string;
    ifscOrSwift?: string;
    bankBranchName?: string;
    upiId?: string;
  };
  openingBalance: number;
  currentBalance: number;
  feeRule?: {
    feePercent?: number;
    feeFixed?: number;
    feeTaxPercent?: number;
    settlementDays?: number;
  };
  isDefault: boolean;
  printOnInvoice?: boolean;
  feeMode?: "manual" | "estimated" | "none";
  isActive: boolean;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}


export type AccountTransactionType =
  | "sale_collection"
  | "customer_payment"
  | "vendor_payment"
  | "expense"
  | "transfer_in"
  | "transfer_out"
  | "opening_balance"
  | "capital_contribution"
  | "capital_drawings"
  | "processing_fee"
  | "adjustment"
  | "refund"
  | "reversal";

export type AccountEntryStatus =
  | "created"
  | "added"
  | "verified"
  | "approved"
  | "rejected"
  | "reversed";

export type SubEntryType =
  | "transaction_charge"
  | "gateway_fee"
  | "bank_charge"
  | "adjustment"
  | "rounding"
  | "tip"
  | "other";

export interface AccountWorkflowHistory {
  createdBy: string;
  createdAt: string;
  updatedByUids?: string[];
  verifiedBy?: Array<{ uid: string; verifiedAt: string; note?: string }>;
  approvedBy?: Array<{ uid: string; approvedAt: string; note?: string }>;
  rejectedBy?: { uid: string; rejectedAt: string; reason: string };
  reversedBy?: { uid: string; reversedAt: string; reason: string };
  selfApproved?: boolean;
  notes?: string;
}

/**
 * 29. accountTransactions/{id}
 * Append-only immutable financial ledger entry (R4).
 */
export interface AccountTransactionDoc {
  organizationId: string;
  branchId?: string | null;
  financialAccountId: string;
  transactionNumber: string;
  type: AccountTransactionType;
  direction: "in" | "out";
  amount: number;
  balanceAfter: number;
  currency?: string;
  status?: AccountEntryStatus;
  sourceDocumentType:
    | "bill"
    | "outflow"
    | "payment"
    | "account_transfer"
    | "reconciliation"
    | "manual"
    | "fee"
    | "capital"
    | "return"
    | "cash_count";
  sourceDocumentId: string;
  partyType?: "customer" | "vendor" | null;
  partyId?: string | null;
  description?: string;
  parentEntryId?: string | null;
  subEntryType?: SubEntryType | null;
  feeStatus?: "pending" | "recorded" | "waived" | "disputed" | null;
  needsReview?: boolean;
  reviewReasons?: string[];
  reversedTransactionId?: string | null;
  reversalTransactionId?: string | null;
  selfApproved?: boolean;
  workflow?: AccountWorkflowHistory;
  reconciled?: boolean;
  reconciledAt?: string | null;
  reconciliationId?: string | null;
  actorUid: string;
  createdAt: string;
}

/**
 * 30. accountTransfers/{id}
 * Inter-account fund transfers with maker-checker support.
 */
export interface AccountTransferDoc {
  organizationId: string;
  transferNumber: string;
  transferType?: "transfer" | "cash_deposit" | "cash_withdrawal" | "inter_bank" | "petty_cash" | "cashier_handover" | "settlement";
  mode?: "instant" | "in_transit";
  reference?: string;
  sourceAccountId: string;
  destinationAccountId: string;
  sourceBranchId?: string | null;
  destinationBranchId?: string | null;
  amount: number;
  status: "pending_approval" | "in_transit" | "pending_confirmation" | "completed" | "disputed" | "rejected" | "cancelled";
  notes?: string;
  sourceTransactionId?: string;
  destinationTransactionId?: string;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  confirmedByUid?: string | null;
  confirmedAt?: string | null;
  disputedByUid?: string | null;
  disputedAt?: string | null;
  disputeReason?: string | null;
  createdAt: string;
  createdBy: string;
  createdByMembershipId?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface CashCountDoc {
  organizationId: string;
  branchId?: string | null;
  countNumber: string;
  financialAccountId: string;
  countedAmount: number;
  systemBalance: number;
  varianceAmount: number;
  denominations: Record<string, number>;
  varianceTransactionId?: string | null;
  needsApproval?: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}


export type StorageLocationType = "warehouse" | "stockyard" | "counter" | "backroom" | "quarantine" | "transit";

/**
 * 32. storageLocations/{id}
 * Storage locations and warehouses per branch or central org.
 */
export interface StorageLocationDoc {
  organizationId: string;
  branchId?: string | null;
  name: string;
  code: string;
  type: StorageLocationType;
  isDefault: boolean;
  isActive: boolean;
  address?: AddressRecord;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}


export type StockTransferStatus = "draft" | "submitted" | "approved" | "dispatched" | "received" | "partially_received" | "rejected" | "cancelled";

export interface StockTransferLine {
  productId: string;
  requestedQty: number;
  quantity?: number; // alias for requestedQty
  unit?: string;
  conversionFactor?: number;
  baseQuantity?: number;
  dispatchedQty?: number;
  dispatchedBaseQuantity?: number;
  receivedQty?: number;
  receivedBaseQuantity?: number;
  shortQty?: number;
  rejectedQty?: number;
  discrepancyReason?: string;
  discrepancyResolution?: "return_to_source" | "write_off" | "claim_carrier";
  discrepancyResolvedAt?: string;
  discrepancyResolvedBy?: string;
  unitCost?: number; // Frozen source WAC at dispatch
  totalCost?: number; // unitCost * dispatchedBaseQuantity
  serialNumbers?: string[];
  batchNumber?: string;
  expiryDate?: string;
  notes?: string;
}

/**
 * 33. stockTransfers/{id}
 * Inter-branch stock transfer workflow document.
 */
export interface StockTransferDoc {
  organizationId: string;
  transferNumber: string;
  sourceBranchId: string;
  destinationBranchId: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  internal?: boolean; // Intra-branch transfer (same branch, different locations)
  status: StockTransferStatus;
  items: StockTransferLine[];
  transportMode?: string;
  trackingReference?: string;
  notes?: string;
  rejectionReason?: string;
  version?: number;
  handlingFee?: number;
  handlingFeeFinancialAccountId?: string;
  totalValuation?: number;
  discrepancyStatus?: "none" | "pending_resolution" | "resolved";
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  receivedAt?: string;
  receivedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  createdAt: string;
  createdBy: string;
  createdByMembershipId?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export type PaymentFeeSettlementTiming = "immediate_deduction" | "billed_later";
export type PaymentFeeStatus = "expected" | "pending_verification" | "verified" | "disputed" | "reversed";

/**
 * 34. paymentProcessingFees/{id}
 * Linked merchant payment processing fee record.
 */
export interface PaymentProcessingFeeDoc {
  organizationId: string;
  branchId?: string | null;
  feeNumber: string;
  sourceDocumentType: "bill" | "payment";
  sourceDocumentId: string;
  paymentId?: string | null;
  financialAccountId: string;
  feeExpenseCategoryId?: string | null;
  paymentMethod: PaymentMethod;
  grossAmount: number;
  feeAmount: number;
  feeTaxAmount?: number;
  netSettlementAmount: number;
  settlementTiming: PaymentFeeSettlementTiming;
  settlementReference?: string;
  accountTransactionId?: string;
  notes?: string;
  status: PaymentFeeStatus;
  isManualEntry: boolean;
  enteredBy: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  expectedFeeAmount?: number;
  varianceAmount?: number;
  settlementDate?: string | null;
  highlight?: "green" | "amber" | "red" | "needs_review" | null;
  expenseOutflowId?: string | null;
  reversalReason?: string | null;
  disputeReason?: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export type CapitalTransactionType = "owner_contribution" | "partner_contribution" | "additional_capital" | "drawings";

/**
 * 35. capitalTransactions/{id}
 * Owner/partner capital introduction and drawings.
 */
export interface CapitalTransactionDoc {
  organizationId: string;
  branchId?: string | null;
  transactionNumber: string;
  type: CapitalTransactionType;
  financialAccountId: string;
  amount: number;
  currency: string;
  sourceReference?: string;
  description?: string;
  supportingDocumentPath?: string;
  accountTransactionId: string;
  createdAt: string;
  createdBy: string;
}

export interface JournalLineItem {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description?: string;
}

/**
 * 37. journalEntries/{id}
 * Balanced double-entry general journal record (totalDebit === totalCredit).
 */
export interface JournalEntryDoc {
  organizationId: string;
  branchId?: string | null;
  entryNumber: string;
  entryDate: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  eventKey: string;
  lines: JournalLineItem[];
  totalDebit: number;
  totalCredit: number;
  currency?: string;
  notes?: string;
  actorUid: string;
  createdAt: string;
}



