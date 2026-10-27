/**
 * Runtime Input Validation Schemas (Zod)
 */

import { z } from "zod";
import {
  BusinessType,
  BusinessCategory,
  EntityStatus,
  OutflowKind,
  SalesMode,
  PaymentMethod,
  StockMovementType,
  DeliveryStatus,
  DeliveryPartner,
  ReturnType,
  ReturnDisposition,
  PartyType,
  PaymentDirection,
  UnitGroup,
  DocumentType,
} from "../constants/enums.js";

export const CreateOrganizationSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  name: z.string().trim().min(2).max(100),
  businessType: z.nativeEnum(BusinessType),
  businessCategory: z.nativeEnum(BusinessCategory),
  country: z.string().trim().length(2).toUpperCase(),
  currency: z.string().trim().length(3).toUpperCase(),
  taxRegimeCode: z.string().trim().min(2).max(32),
  planId: z.string().trim().min(2).max(64),
  ownerEmail: z.string().trim().email().toLowerCase(),
  ownerName: z.string().trim().min(2).max(100),
  ownerPhone: z.string().trim().optional(),
  initialPassword: z.string().min(8).max(128).optional(),
});

export const UpdateOrganizationSchema = z.object({
  organizationId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  businessType: z.nativeEnum(BusinessType).optional(),
  businessCategory: z.nativeEnum(BusinessCategory).optional(),
  moduleToggles: z.record(z.string(), z.boolean()).optional(),
  logoUrl: z.string().url().optional(),
});

export const DeactivateOrganizationSchema = z.object({
  organizationId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const ListOrganizationsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).optional(),
  startAfterId: z.string().trim().optional(),
  status: z.nativeEnum(EntityStatus).optional(),
});

export const CreateEmployeeSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  email: z.string().trim().email().toLowerCase(),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().optional(),
  initialPassword: z.string().min(8).max(128).optional(),
  roleId: z.string().trim().min(2).default("role_employee").optional(),
  departmentId: z.string().trim().optional(),
  jobRoleIds: z.array(z.string().trim()).default([]).optional(),
  teamId: z.string().trim().optional(),
  reportingToIds: z.array(z.string().trim()).default([]).optional(),
  permissionOverrides: z.record(z.string(), z.boolean()).default({}).optional(),
});

export const UpdateEmployeeSchema = z.object({
  organizationId: z.string().trim().min(2),
  membershipId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().optional(),
  roleId: z.string().trim().optional(),
  departmentId: z.string().trim().nullable().optional(),
  jobRoleIds: z.array(z.string().trim()).optional(),
  teamId: z.string().trim().nullable().optional(),
  reportingToIds: z.array(z.string().trim()).optional(),
  permissionOverrides: z.record(z.string(), z.boolean()).optional(),
  status: z.nativeEnum(EntityStatus).optional(),
});

export const DeactivateEmployeeSchema = z.object({
  organizationId: z.string().trim().min(2),
  membershipId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const ListEmployeesSchema = z.object({
  organizationId: z.string().trim().min(2),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
  status: z.nativeEnum(EntityStatus).optional(),
});

export const CreateRoleSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(50).toLowerCase(),
  permissions: z.array(z.string().trim()).min(1),
  description: z.string().trim().max(500),
});

export const UpdateRoleSchema = z.object({
  roleId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  permissions: z.array(z.string().trim()).optional(),
  description: z.string().trim().max(500).optional(),
});

export const CreateDepartmentSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  headMembershipIds: z.array(z.string().trim()).optional(),
});

export const UpdateDepartmentSchema = z.object({
  departmentId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  headMembershipIds: z.array(z.string().trim()).optional(),
});

export const CreateJobRoleSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(2).max(100),
});

export const UpdateJobRoleSchema = z.object({
  jobRoleId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
});

export const CreateTeamSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100),
});

export const UpdateTeamSchema = z.object({
  teamId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
});

export const CreatePlanSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  name: z.string().trim().min(2).max(100),
  price: z.number().nonnegative(),
  currency: z.string().trim().length(3).toUpperCase(),
  storageLimitMb: z.number().positive(),
  monthlyDocumentVolumeLimit: z.number().positive(),
  seatLimits: z.object({
    admin: z.number().int().positive(),
    staff: z.number().int().positive(),
  }),
  moduleFlags: z.record(z.string(), z.boolean()),
  isActive: z.boolean().default(true).optional(),
});

export const UpdatePlanSchema = z.object({
  planId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  price: z.number().nonnegative().optional(),
  moduleFlags: z.record(z.string(), z.boolean()).optional(),
  isActive: z.boolean().optional(),
});

export const RegisterFcmTokenSchema = z.object({
  deviceId: z.string().trim().min(4).max(128),
  fcmToken: z.string().trim().min(10).max(512),
  platform: z.enum(["android", "ios", "web"]),
});

// ============================================================
// Phase 2 Validation Schemas
// ============================================================

// 1. Products
export const CreateProductSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(1000).optional(),
  categoryId: z.string().trim().nullable().optional(),
  baseUnit: z.string().trim().min(1).max(30).default("piece"),
  sellingPrice: z.number().min(0).default(0),
  costPrice: z.number().min(0).default(0),
  mrp: z.number().min(0).nullable().optional(),
  wholesalePrice: z.number().min(0).nullable().optional(),
  taxInclusive: z.boolean().default(false),
  taxRatePercent: z.number().min(0).max(100).optional(),
  taxCode: z.string().trim().max(50).optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  hasExpiry: z.boolean().default(false), // Canonical naming
  trackStock: z.boolean().default(true),
  initialStock: z.number().min(0).default(0),
  lowStockThreshold: z.number().min(0).default(5),
  trackBatch: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  hasVariants: z.boolean().optional(),
  isPurchaseOnly: z.boolean().optional(),
  isExpenseOnly: z.boolean().optional(),
  isSaleOnly: z.boolean().optional(),
});

export const UpdateProductSchema = z.object({
  organizationId: z.string().trim().min(2),
  productId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(1000).optional(),
  categoryId: z.string().trim().nullable().optional(),
  baseUnit: z.string().trim().min(1).max(30).optional(),
  sellingPrice: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  mrp: z.number().min(0).nullable().optional(),
  wholesalePrice: z.number().min(0).nullable().optional(),
  taxInclusive: z.boolean().optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
  taxCode: z.string().trim().max(50).optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  hasExpiry: z.boolean().optional(),
  trackStock: z.boolean().optional(),
  lowStockThreshold: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const ListProductsSchema = z.object({
  organizationId: z.string().trim().min(2),
  categoryId: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 2. Categories
export const CreateCategorySchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(), // Null for platform/global
  name: z.string().trim().min(1).max(100),
  parentId: z.string().trim().nullable().optional(),
  nature: z.string().trim().optional(),
});

export const UpdateCategorySchema = z.object({
  categoryId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(100).optional(),
  parentId: z.string().trim().nullable().optional(),
  nature: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

export const ListCategoriesSchema = z.object({
  organizationId: z.string().trim().optional(),
  includeGlobal: z.boolean().default(true).optional(),
});

// 3. Units
export const CreateUnitSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(1).max(50),
  code: z.string().trim().min(1).max(20).toLowerCase(),
  group: z.nativeEnum(UnitGroup).default(UnitGroup.COUNT),
  precision: z.number().int().min(0).max(4).default(0),
  baseUnit: z.string().trim().nullable().optional(),
  conversionFactor: z.number().positive().optional(),
});

export const UpdateUnitSchema = z.object({
  unitId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(50).optional(),
  precision: z.number().int().min(0).max(4).optional(),
  isActive: z.boolean().optional(),
});

export const ListUnitsSchema = z.object({
  organizationId: z.string().trim().optional(),
  includeGlobal: z.boolean().default(true).optional(),
});

// 4. Customers
export const CreateCustomerSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(100),
  mobile: z.string().trim().optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  taxNumber: z.string().trim().max(50).optional(),
  billingAddress: z.string().trim().max(500).optional(),
  shippingAddress: z.string().trim().max(500).optional(),
  priceGroup: z.string().trim().default("retail").optional(),
  creditLimit: z.number().min(0).default(0),
  creditPeriodDays: z.number().int().min(0).default(30),
  isDefault: z.boolean().default(false).optional(),
});

export const UpdateCustomerSchema = z.object({
  organizationId: z.string().trim().min(2),
  customerId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(100).optional(),
  mobile: z.string().trim().optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  taxNumber: z.string().trim().max(50).optional(),
  billingAddress: z.string().trim().max(500).optional(),
  shippingAddress: z.string().trim().max(500).optional(),
  priceGroup: z.string().trim().optional(),
  creditLimit: z.number().min(0).optional(),
  creditPeriodDays: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const ListCustomersSchema = z.object({
  organizationId: z.string().trim().min(2),
  search: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 5. Vendors
export const CreateVendorSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(100),
  mobile: z.string().trim().optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  taxNumber: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  contactPerson: z.string().trim().max(100).optional(),
  paymentTermsDays: z.number().int().min(0).default(0).optional(),
  creditLimit: z.number().min(0).default(0).optional(),
  isDefault: z.boolean().default(false).optional(),
});

export const UpdateVendorSchema = z.object({
  organizationId: z.string().trim().min(2),
  vendorId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(100).optional(),
  mobile: z.string().trim().optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  taxNumber: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  contactPerson: z.string().trim().max(100).optional(),
  paymentTermsDays: z.number().int().min(0).optional(),
  creditLimit: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const ListVendorsSchema = z.object({
  organizationId: z.string().trim().min(2),
  search: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 6. Unified Outflows (Purchase / Expense)
export const OutflowLineSchema = z.object({
  productId: z.string().trim().nullable().optional(),
  itemName: z.string().trim().min(1).max(150),
  sku: z.string().trim().optional(),
  categoryId: z.string().trim().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(30).default("piece"),
  unitPrice: z.number().min(0),
  discountAmount: z.number().min(0).default(0).optional(),
  taxPercent: z.number().min(0).max(100).default(0).optional(),
  addToStock: z.boolean().default(true).optional(),
  batch: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
});

export const CreateOutflowSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  kind: z.nativeEnum(OutflowKind),
  docDate: z.string().trim().optional(), // ISO string, defaults to now
  vendorId: z.string().trim().nullable().optional(),
  vendorName: z.string().trim().optional(),
  payee: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
  lines: z.array(OutflowLineSchema).min(1),
  paidAmount: z.number().min(0).default(0).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const ListOutflowsSchema = z.object({
  organizationId: z.string().trim().min(2),
  kind: z.nativeEnum(OutflowKind).optional(),
  vendorId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 7. Shared Bills (POS / B2B)
export const BillItemSchema = z.object({
  productId: z.string().trim().min(2),
  quantity: z.number().positive(),
  unitPriceOverride: z.number().min(0).optional(),
  discountValue: z.number().min(0).default(0).optional(),
  unit: z.string().trim().optional(),
});

export const CreateBillSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  salesMode: z.nativeEnum(SalesMode).default(SalesMode.POS),
  documentType: z.nativeEnum(DocumentType).default(DocumentType.INVOICE).optional(),
  status: z.enum(["draft", "active"]).default("active").optional(),
  customerId: z.string().trim().nullable().optional(),
  customerSnapshot: z.object({
    name: z.string().trim().min(1),
    mobile: z.string().trim().optional(),
    email: z.string().trim().optional(),
    taxNumber: z.string().trim().optional(),
    billingAddress: z.string().trim().optional(),
    shippingAddress: z.string().trim().optional(),
  }).optional(),
  items: z.array(BillItemSchema).min(1),
  discountTotal: z.number().min(0).default(0).optional(),
  paidAmount: z.number().min(0).default(0).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const FinalizeBillSchema = z.object({
  organizationId: z.string().trim().min(2),
  billId: z.string().trim().min(2),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ListBillsSchema = z.object({
  organizationId: z.string().trim().min(2),
  salesMode: z.nativeEnum(SalesMode).optional(),
  customerId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 8. Deliveries
export const CreateDeliverySchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  billId: z.string().trim().min(2), // ID reference ONLY!
  customerId: z.string().trim().nullable().optional(),
  customerName: z.string().trim().min(1).max(100),
  customerPhone: z.string().trim().min(4).max(30),
  address: z.object({
    line1: z.string().trim().min(1),
    line2: z.string().trim().optional(),
    landmark: z.string().trim().optional(),
    city: z.string().trim().min(1),
    pincode: z.string().trim().min(1),
  }),
  riderMembershipId: z.string().trim().nullable().optional(),
  riderName: z.string().trim().optional(),
  partner: z.nativeEnum(DeliveryPartner).default(DeliveryPartner.INTERNAL),
  deliveryFee: z.number().min(0).default(0),
  cod: z.object({
    isCod: z.boolean().default(false),
    amount: z.number().min(0).default(0),
  }).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const UpdateDeliveryStatusSchema = z.object({
  organizationId: z.string().trim().min(2),
  deliveryId: z.string().trim().min(2),
  status: z.nativeEnum(DeliveryStatus),
  riderMembershipId: z.string().trim().optional(),
  riderName: z.string().trim().optional(),
  codCollected: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const ListDeliveriesSchema = z.object({
  organizationId: z.string().trim().min(2),
  status: z.nativeEnum(DeliveryStatus).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 9. Returns
export const ReturnItemSchema = z.object({
  productId: z.string().trim().min(2),
  quantity: z.number().positive(),
  refundAmount: z.number().min(0),
  reason: z.string().trim().min(1).max(200),
  disposition: z.nativeEnum(ReturnDisposition).default(ReturnDisposition.RESTOCKED_TO_INVENTORY),
});

export const CreateReturnSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  returnType: z.nativeEnum(ReturnType),
  referenceId: z.string().trim().min(2), // billId or outflowId
  partyId: z.string().trim().nullable().optional(),
  partyName: z.string().trim().optional(),
  items: z.array(ReturnItemSchema).min(1),
  refundMethod: z.enum(["cash", "credit_note", "original_payment"]).default("cash"),
  notes: z.string().trim().max(500).optional(),
});

export const ListReturnsSchema = z.object({
  organizationId: z.string().trim().min(2),
  returnType: z.nativeEnum(ReturnType).optional(),
  referenceId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 10. Payments Ledger
export const CreatePaymentSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  direction: z.nativeEnum(PaymentDirection),
  partyType: z.nativeEnum(PartyType),
  partyId: z.string().trim().nullable().optional(),
  partyName: z.string().trim().min(1).max(100),
  amount: z.number().positive(),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  referenceId: z.string().trim().nullable().optional(), // billId or outflowId
  referenceModel: z.enum(["bill", "outflow"]).nullable().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const ListPaymentsSchema = z.object({
  organizationId: z.string().trim().min(2),
  direction: z.nativeEnum(PaymentDirection).optional(),
  partyId: z.string().trim().optional(),
  referenceId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 11. Stock Movements / Adjustments
export const StockAdjustSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2),
  productId: z.string().trim().min(2),
  quantity: z.number(), // Positive to add, negative to deduct
  reason: z.string().trim().min(2).max(500),
});

export const ListStockMovementsSchema = z.object({
  organizationId: z.string().trim().min(2),
  productId: z.string().trim().optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});
