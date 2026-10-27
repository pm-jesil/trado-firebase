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
  GENERAL = "general",
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
