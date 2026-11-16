/**
 * Canonical Business Enums
 * Aligned with Flutter client contracts and legacy backend definitions.
 */

export enum BusinessType {
  RETAIL_ONLY = "retail_only",
  WHOLESALE_ONLY = "wholesale_only",
  WHOLESALE_RETAIL = "wholesale_retail",
  DISTRIBUTOR = "distributor",
  RESTAURANT = "restaurant",
  CAFE_BAKERY = "cafe_bakery",
  SERVICE = "service",
  GENERAL_TRADING = "general_trading",
  MANUFACTURER_B2B = "manufacturer_b2b", // B2B supplier / manufacturer
  POS_COUNTER = "pos_counter", // Counter-sales only shop
}

export enum BusinessCategory {
  BICYCLE = "bicycle",
  MOTORCYCLE = "motorcycle",
  CAR_AUTOMOBILE = "car_automobile",
  AUTO_SPARE_PARTS = "auto_spare_parts",
  MOBILE_ELECTRONICS = "mobile_electronics",
  GROCERY_FMCG = "grocery_fmcg",
  PHARMACY_MEDICAL = "pharmacy_medical",
  TEXTILE_GARMENTS = "textile_garments",
  HARDWARE_BUILDING = "hardware_building",
  FURNITURE_HOME = "furniture_home",
  STATIONERY_BOOKS = "stationery_books",
  FOOD_BEVERAGE = "food_beverage",
  AGRI_PRODUCTS = "agri_products",
  JEWELLERY = "jewellery",
  KITCHENWARE_HOUSEHOLD = "kitchenware_household",
  GIFTS_TOYS = "gifts_toys",
  RESTAURANT_FOOD_SERVICE = "restaurant_food_service",
  SERVICES_REPAIR = "services_repair",
  GENERAL = "general",
}

/**
 * Sales channels an organization operates (one business can run several).
 */
export enum SalesChannel {
  POS = "pos", // Counter / walk-in
  B2B = "b2b", // Credit invoices to registered businesses
  ORDER_TAKING = "order_taking", // Pre-sale: salesperson takes order, delivery completes it
  ONLINE = "online",
}

export enum SalesMode {
  POS = "pos",
  B2B = "b2b",
  BOTH = "both",
}

export enum UserRole {
  SUPER_ADMIN = "super_admin",
  ORG_OWNER = "org_owner",
  ADMIN = "admin",
  EMPLOYEE = "employee",
}

export enum EmployeeType {
  FULL_TIME = "full_time",
  PART_TIME = "part_time",
  CONTRACT = "contract",
}

export enum EntityStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  SUSPENDED = "suspended",
}

export enum IdempotencyStatus {
  PROCESSING = "processing",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
}

export enum OutflowKind {
  PURCHASE = "purchase",
  EXPENSE = "expense",
}

export enum OutflowStatus {
  DRAFT = "draft",
  CONFIRMED = "confirmed",
  VOIDED = "voided",
}

export enum PaymentStatus {
  PAID = "paid",
  PENDING = "pending",
  PARTIAL = "partial",
}

export enum StockMovementType {
  PURCHASE_IN = "purchase_in",
  SALE_OUT = "sale_out",
  ADJUSTMENT_IN = "adjustment_in",
  ADJUSTMENT_OUT = "adjustment_out",
  RETURN_IN = "return_in", // Sales return (alias for SALE_RETURN_IN)
  RETURN_OUT = "return_out", // Purchase return (alias for PURCHASE_RETURN_OUT)
  SALE_RETURN_IN = "sale_return_in",
  PURCHASE_RETURN_OUT = "purchase_return_out",
  DAMAGE_OUT = "damage_out",
  TRANSFER = "transfer",
}

export enum DeliveryStatus {
  PENDING = "pending",
  ASSIGNED = "assigned",
  PICKED_UP = "picked_up",
  OUT_FOR_DELIVERY = "out_for_delivery",
  DELIVERED = "delivered",
  FAILED = "failed",
  RETURNED = "returned",
}

export enum DeliveryPartner {
  INTERNAL = "internal",
  SWIGGY = "swiggy",
  ZOMATO = "zomato",
  DUNZO = "dunzo",
  OTHER = "other",
}

export enum ReturnType {
  SALES_RETURN = "sales_return",
  PURCHASE_RETURN = "purchase_return",
}

export enum ReturnDisposition {
  RESTOCKED_TO_INVENTORY = "restocked_to_inventory",
  WASTED_DISCARDED = "wasted_discarded",
}

export enum PaymentMethod {
  CASH = "cash",
  CARD = "card",
  UPI = "upi",
  BANK_TRANSFER = "bank_transfer",
  CHEQUE = "cheque",
  OTHER = "other",
}

export enum PaymentDirection {
  IN = "in",
  OUT = "out",
}

export enum PartyType {
  CUSTOMER = "customer",
  VENDOR = "vendor",
  EMPLOYEE = "employee", // Employee-linked expense payouts (partyId = membershipId)
  OTHER = "other",
}

export enum UnitGroup {
  COUNT = "count",
  WEIGHT = "weight",
  VOLUME = "volume",
  LENGTH = "length",
  AREA = "area",
  TIME = "time",
}

export enum BillStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  VOIDED = "voided",
  CANCELLED = "cancelled",
  REFUNDED = "refunded",
}

export enum DocumentType {
  INVOICE = "invoice",
  RECEIPT = "receipt",
  DELIVERY_CHALLAN = "delivery_challan",
  PROFORMA = "proforma",
  QUOTATION = "quotation",
  SALES_ORDER = "sales_order",
}

/**
 * Organization subscription lifecycle (per organization, never per plan).
 */
export enum SubscriptionStatus {
  TRIAL = "trial",
  ACTIVE = "active",
  GRACE = "grace",
  EXPIRED = "expired",
  SUSPENDED = "suspended",
  CANCELLED = "cancelled",
}

/**
 * Stable machine-readable gate failure reasons.
 * Returned in HttpsError.details.reason and as a "[REASON]" message prefix so clients can
 * distinguish e.g. an expired subscription from a missing permission.
 */
export enum GateReason {
  UNAUTHENTICATED = "UNAUTHENTICATED",
  USER_INACTIVE = "USER_INACTIVE",
  NO_MEMBERSHIP = "NO_MEMBERSHIP",
  MEMBERSHIP_INACTIVE = "MEMBERSHIP_INACTIVE",
  ORG_NOT_FOUND = "ORG_NOT_FOUND",
  ORG_INACTIVE = "ORG_INACTIVE",
  SUBSCRIPTION_NOT_STARTED = "SUBSCRIPTION_NOT_STARTED",
  SUBSCRIPTION_EXPIRED = "SUBSCRIPTION_EXPIRED",
  SUBSCRIPTION_SUSPENDED = "SUBSCRIPTION_SUSPENDED",
  SUBSCRIPTION_CANCELLED = "SUBSCRIPTION_CANCELLED",
  MODULE_NOT_IN_PLAN = "MODULE_NOT_IN_PLAN",
  MODULE_DISABLED = "MODULE_DISABLED",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  TENANT_MISMATCH = "TENANT_MISMATCH",
  BRANCH_NOT_FOUND = "BRANCH_NOT_FOUND",
  BRANCH_INACTIVE = "BRANCH_INACTIVE",
  BRANCH_NOT_ASSIGNED = "BRANCH_NOT_ASSIGNED",
  SUPER_ADMIN_TENANT_FORBIDDEN = "SUPER_ADMIN_TENANT_FORBIDDEN",
  USAGE_LIMIT_EXCEEDED = "USAGE_LIMIT_EXCEEDED",
  PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED",
  FIELD_NOT_EDITABLE = "FIELD_NOT_EDITABLE",
}

/**
 * Reason codes for manual stock adjustments. Loss reasons are inventory write-offs that reach
 * the P&L as "inventoryWriteOff" valued at the movement's unitCostSnapshot.
 */
export enum StockAdjustmentReason {
  DAMAGED = "damaged",
  EXPIRED = "expired",
  LOST_THEFT = "lost_theft",
  SAMPLE = "sample",
  INTERNAL_USE = "internal_use",
  DAMAGED_ON_RECEIPT = "damaged_on_receipt",
  COUNT_CORRECTION = "count_correction", // Physical count difference (gain or loss)
  OPENING_STOCK = "opening_stock",
  OTHER = "other",
}

/** Adjustment reasons treated as inventory losses in the P&L. */
export const WRITE_OFF_REASONS: ReadonlySet<string> = new Set([
  StockAdjustmentReason.DAMAGED,
  StockAdjustmentReason.EXPIRED,
  StockAdjustmentReason.LOST_THEFT,
  StockAdjustmentReason.SAMPLE,
  StockAdjustmentReason.INTERNAL_USE,
  StockAdjustmentReason.DAMAGED_ON_RECEIPT,
]);

export enum RequestCategory {
  PLAN_CHANGE = "plan_change",
  LIMIT_INCREASE = "limit_increase",
  MODULE_REQUEST = "module_request",
  BILLING_QUERY = "billing_query",
  ORG_PROFILE_CHANGE = "org_profile_change",
  OWNERSHIP_TRANSFER = "ownership_transfer",
  BUG_REPORT = "bug_report",
  DATA_ISSUE = "data_issue",
  FEATURE_REQUEST = "feature_request",
  IMPROVEMENT = "improvement",
  SUPPORT_QUESTION = "support_question",
  OTHER = "other",
  DATA_REQUEST = "data_request",
  SECURITY_CONCERN = "security_concern",
  ACCESS_REQUEST = "access_request",
}

export enum RequestAudience {
  PLATFORM = "platform",
  ORGANIZATION = "organization",
}

export enum RequestKind {
  APPROVAL = "approval",
  WORK = "work",
}

export enum RequestPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  URGENT = "urgent",
}

export enum RequestSeverity {
  MINOR = "minor",
  MAJOR = "major",
  CRITICAL = "critical",
}

export enum RequestStatus {
  SUBMITTED = "submitted",
  IN_REVIEW = "in_review",
  NEEDS_INFO = "needs_info",
  ON_HOLD = "on_hold",
  APPROVED = "approved",
  APPLIED = "applied",
  REJECTED = "rejected",
  IN_PROGRESS = "in_progress",
  RESOLVED = "resolved",
  DECLINED = "declined",
  CLOSED = "closed",
  CANCELLED = "cancelled",
}

export enum SlaState {
  ON_TRACK = "on_track",
  AT_RISK = "at_risk",
  BREACHED = "breached",
  PAUSED = "paused",
}

export enum RequestAction {
  START_REVIEW = "start_review",
  REQUEST_INFO = "request_info",
  RESPOND = "respond",
  HOLD = "hold",
  RESUME = "resume",
  APPROVE = "approve",
  REJECT = "reject",
  APPLY = "apply",
  START_WORK = "start_work",
  RESOLVE = "resolve",
  DECLINE = "decline",
  CLOSE = "close",
  REOPEN = "reopen",
  CANCEL = "cancel",
}

export enum RequestResolutionType {
  FIXED = "fixed",
  ANSWERED = "answered",
  IMPLEMENTED = "implemented",
  DUPLICATE = "duplicate",
  CANNOT_REPRODUCE = "cannot_reproduce",
  WORKAROUND = "workaround",
}

export enum RequestReason {
  FEATURE_DISABLED = "FEATURE_DISABLED",
  REQUEST_NOT_FOUND = "REQUEST_NOT_FOUND",
  REQUEST_CATEGORY_FORBIDDEN = "REQUEST_CATEGORY_FORBIDDEN",
  REQUEST_DETAILS_INVALID = "REQUEST_DETAILS_INVALID",
  REQUEST_INVALID_TRANSITION = "REQUEST_INVALID_TRANSITION",
  REQUEST_STALE_STATUS = "REQUEST_STALE_STATUS",
  REQUEST_DUPLICATE_OPEN = "REQUEST_DUPLICATE_OPEN",
  REQUEST_LIMIT_REACHED = "REQUEST_LIMIT_REACHED",
  REQUEST_RATE_LIMITED = "REQUEST_RATE_LIMITED",
  REQUEST_ATTACHMENT_INVALID = "REQUEST_ATTACHMENT_INVALID",
  REQUEST_NOT_APPROVED = "REQUEST_NOT_APPROVED",
  REQUEST_ALREADY_APPLIED = "REQUEST_ALREADY_APPLIED",
  REQUEST_APPLY_BLOCKED = "REQUEST_APPLY_BLOCKED",
  REQUEST_PLAN_UNAVAILABLE = "REQUEST_PLAN_UNAVAILABLE",
  REQUEST_REOPEN_WINDOW_CLOSED = "REQUEST_REOPEN_WINDOW_CLOSED",
  REQUEST_ASSIGNEE_INVALID = "REQUEST_ASSIGNEE_INVALID",
}


