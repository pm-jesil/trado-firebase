/**
 * Runtime Input Validation Schemas (Zod)
 */

import { z } from "zod";
import {
  AddressSchema,
  BankAccountSchema,
  ContactPersonSchema,
} from "./sharedSchemas.js";
export {
  AddressSchema,
  AddressArraySchema,
  BankAccountSchema,
  BankAccountArraySchema,
  ContactPersonSchema,
  ContactPersonArraySchema,
  TaxIdentitySchema,
  NotesSchema,
  PartyCoreSchema,
} from "./sharedSchemas.js";

/** Cap on owned line arrays (bills.items, outflows.lines, returns.items): keeps documents far below 1 MiB. */
export const MAX_DOCUMENT_LINES = 200;

/** Request-context fields every callable may send (read by the gate; derived from the token when absent). */
/**
 * `_meta` (prompt 66 §3.2, docs/guides/client-meta.md): optional on every callable, removed by the
 * wrapper before the handler's schema runs. Untrusted (D-26): analytics and flags only.
 * `deviceId` is the app's random install id kept in secure storage, never a hardware identifier.
 */
export const ClientMetaSchema = z.strictObject({
  deviceId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, "letters, digits and . _ : - only").optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
  platform: z.enum(["android", "ios", "web"]).optional(),
  clientRequestId: z.string().trim().min(1).max(128).optional(),
  clientTime: z.string().trim().datetime({ offset: true }).optional(),
  locale: z.string().trim().min(2).max(35).optional(),
});

export const ContextFields = {
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
};

// Not added to AuthLoginSchema / AuthMeSchema: sign-in must never accept tenant context from the client.
/** Callables that take no business input still reject unknown keys. */
export const ContextOnlySchema = z.strictObject(ContextFields);

/** Single-document get by id: { <idField>: string } plus the context fields. */
function getByIdSchema<K extends string>(idField: K) {
  return z.strictObject({ ...ContextFields, [idField]: z.string().trim().min(2, `${idField} is required`) } as { organizationId: typeof ContextFields.organizationId; branchId: typeof ContextFields.branchId } & Record<K, z.ZodString>);
}
export const GetBillSchema = getByIdSchema("billId");
export const GetProductSchema = getByIdSchema("productId");
export const GetCustomerSchema = getByIdSchema("customerId");
export const GetVendorSchema = getByIdSchema("vendorId");
export const GetOutflowSchema = getByIdSchema("outflowId");
export const GetDeliverySchema = getByIdSchema("deliveryId");
export const ListPlansSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId, includeInactive: z.boolean().optional() });
export const RecordClientMetricSchema = z.strictObject({
  ...ContextFields,
  metrics: z.record(z.string(), z.number()), // keys/ranges validated against CLIENT_METRIC_KEYS in the callable
});
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
  StockAdjustmentReason,
  SalesChannel,
  SubscriptionStatus,
  RequestCategory,
  RequestAudience,
  RequestPriority,
  RequestSeverity,
  RequestStatus,
  SlaState,
  RequestAction,
  RequestResolutionType,
} from "../constants/enums.js";

export const AuthLoginSchema = z.strictObject({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1, "Password is required").max(512),
  deviceId: z.string().trim().min(4).max(128).optional(),
});
export type AuthLoginInput = z.infer<typeof AuthLoginSchema>;

export const AuthMeSchema = z.strictObject({
  deviceId: z.string().trim().min(4).max(128).optional(),
});
export type AuthMeInput = z.infer<typeof AuthMeSchema>;

export const ImageRefSchema = z.strictObject({
  path: z.string().trim().min(5).max(500),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  updatedAt: z.string().trim(),
  thumbnailPath: z.string().trim().min(5).max(500).optional(),
  /** D-15: `url` is NOT stored; rejected if present. The display URL is computed at read time. */
});

export const PersonNameSchema = z.string().trim().min(2).max(100);

export const ContactSchema = z.strictObject({
  name: PersonNameSchema.optional(),
  email: z.string().trim().email().toLowerCase().max(254).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
  altPhone: z.string().trim().min(5).max(30).optional(),
});

export const OrganizationContactSchema = z.strictObject({
  id: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(100),
  designation: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().toLowerCase().nullable().optional(),
  type: z.enum(["primary", "billing", "technical", "operations", "other"]).optional(),
  isPrimary: z.boolean().default(false),
  notifyBy: z.enum(["email", "sms", "both", "none"]).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().trim().datetime({ offset: true }).optional(),
  updatedAt: z.string().trim().datetime({ offset: true }).optional(),
  createdBy: z.string().trim().optional(),
  updatedBy: z.string().trim().optional(),
});
export type OrganizationContactInput = z.infer<typeof OrganizationContactSchema>;

export const CreateOrganizationSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  name: z.string().trim().min(2).max(100),
  legalName: z.string().trim().min(2).max(120).optional(),
  businessType: z.nativeEnum(BusinessType),
  businessCategory: z.nativeEnum(BusinessCategory),
  country: z.string().trim().length(2).toUpperCase(),
  currency: z.string().trim().length(3).toUpperCase(),
  taxRegimeCode: z.string().trim().min(2).max(32),
  planId: z.string().trim().min(2).max(64),
  createOwner: z.boolean().default(true).optional(),
  confirmLinkExistingUser: z.boolean().optional(),
  ownerEmail: z.string().trim().email().toLowerCase().optional(),
  ownerName: PersonNameSchema.optional(),
  ownerPhone: z.string().trim().optional(),
  credentialMode: z.enum(["temporaryPassword", "invite"]).default("temporaryPassword").optional(),
  initialPassword: z.string().min(8).max(128).optional(),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
  taxId: z.string().trim().max(30).optional(),
  website: z.string().trim().url().optional(),
  addresses: z.array(AddressSchema).max(20).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  defaultBranchName: z.string().trim().min(2).max(100).optional(),
  defaultBranchCode: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/).optional(),
  salesChannels: z.array(z.nativeEnum(SalesChannel)).min(1).max(4).optional(),
  timezone: z.string().trim().min(3).max(64).optional(), // IANA timezone, defaults from country
  contact: ContactSchema.optional(),
  contacts: z.array(OrganizationContactSchema).max(20).optional(),
  subscription: z.strictObject({
    status: z.nativeEnum(SubscriptionStatus).optional(), // default trial
    startsAt: z.string().trim().datetime({ offset: true }).optional(), // ISO instant, default now
    expiresOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // date in org timezone
    durationDays: z.number().int().min(1).max(3660).optional(), // default 30
    graceDays: z.number().int().min(0).max(90).optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  const willCreateOwner = data.createOwner !== false;
  if (willCreateOwner) {
    if (!data.ownerEmail) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ownerEmail is required when createOwner is true", path: ["ownerEmail"] });
    }
    if (!data.ownerName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ownerName is required when createOwner is true", path: ["ownerName"] });
    }
  } else {
    if (data.ownerEmail || data.ownerName || data.ownerPhone || data.initialPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Owner fields must not be provided when createOwner is false", path: ["createOwner"] });
    }
  }
});

/**
 * Field-level write policy is enforced in organizationsUpdate (ORGANIZATION_FIELD_POLICY).
 * Unknown fields are rejected (every schema is a z.strictObject; see validation/parseInput.ts).
 */
export const UpdateOrganizationSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2),
  // Super Admin only (identity, entitlements, billing-affecting)
  showCostToTenant: z.boolean().optional(), // D-25
  name: z.string().trim().min(2).max(100).optional(),
  legalName: z.string().trim().min(2).max(120).optional(),
  businessType: z.nativeEnum(BusinessType).optional(),
  businessCategory: z.nativeEnum(BusinessCategory).optional(),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
  moduleToggles: z.record(z.string(), z.boolean()).optional(),
  salesChannels: z.array(z.nativeEnum(SalesChannel)).min(1).max(4).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  // Owner-editable profile and operational settings
  displayName: z.string().trim().min(2).max(100).optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  /** D-15: `logoUrl` and `imageUrls` removed — use `uploadId` or `image: ImageRef` to set the org logo. */
  taxId: z.string().trim().max(30).nullable().optional(),
  website: z.string().url().nullable().optional(),
  contactEmail: z.string().trim().email().nullable().optional(),
  contactPhone: z.string().trim().max(20).nullable().optional(),
  contact: ContactSchema.optional(),
  contacts: z.array(OrganizationContactSchema).max(20).optional(),
  addresses: z.array(AddressSchema).max(20).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  settings: z.strictObject({
    approvals: z.strictObject({
      enabled: z.boolean(),
      modules: z.strictObject({
        sale: z.boolean().optional(),
        purchase: z.boolean().optional(),
        expense: z.boolean().optional(),
        return: z.boolean().optional(),
        stock_adjustment: z.boolean().optional(),
        account_transfer: z.boolean().optional(),
        stock_transfer: z.boolean().optional(),
      }).optional(),
      amountThreshold: z.number().min(0).optional(),
      allowSelfApproval: z.boolean().optional(),
      thresholds: z.record(z.string(), z.number().min(0)).optional(),
    }).optional(),
    numbering: z.record(z.string(), z.string()).optional(),
    // Overrides of the business-type defaults (absent = default; constants/businessDefaults.ts)
    businessConfig: z.strictObject({
      defaultUnits: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
      productFields: z.record(z.enum(["expiry", "batch", "serial", "variants", "alternateUnits", "jewellery"]), z.boolean()).optional(),
      salesMode: z.nativeEnum(SalesMode).optional(),
    }).optional(),
  }).optional(),
});

/** Super Admin subscription lifecycle. */
export const SetSubscriptionSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2),
  action: z.enum(["set", "renew", "extend", "suspend", "reactivate", "cancel", "change_plan"]),
  planId: z.string().trim().min(2).max(64).optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  expiresOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  durationDays: z.number().int().min(1).max(3660).optional(),
  extendDays: z.number().int().min(1).max(3660).optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const DeactivateOrganizationSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const RevealBankAccountSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2),
  bankAccountId: z.string().trim().min(1).max(128),
});

export const ListOrganizationsSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  limit: z.number().int().min(1).max(100).default(20).optional(),
  startAfterId: z.string().trim().optional(),
  status: z.nativeEnum(EntityStatus).optional(),
  planId: z.string().trim().optional(),
});

export const ReactivateOrganizationSchema = z.strictObject({
  organizationId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const PreviewDeactivationImpactSchema = z.strictObject({
  organizationId: z.string().trim().min(2),
});

export const GetSubscriptionHistorySchema = z.strictObject({
  organizationId: z.string().trim().min(2),
  limit: z.number().int().min(1).max(100).default(50).optional(),
});

export const GetOrganizationSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
});

export const CreateEmployeeSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(),
  email: z.string().trim().email().toLowerCase(),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  initialPassword: z.string().min(8).max(128).optional(),
  roleId: z.string().trim().min(2).default("role_employee").optional(),
  departmentId: z.string().trim().nullable().optional(),
  jobRoleIds: z.array(z.string().trim()).max(20).default([]).optional(),
  teamId: z.string().trim().nullable().optional(),
  reportingToIds: z.array(z.string().trim()).max(10).default([]).optional(),
  permissionOverrides: z.record(z.string(), z.boolean()).default({}).optional(),
  branchIds: z.array(z.string().trim()).max(100).optional(),
  defaultBranchId: z.string().trim().optional(),
});

export const UpdateEmployeeSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(),
  membershipId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  roleId: z.string().trim().optional(),
  departmentId: z.string().trim().nullable().optional(),
  jobRoleIds: z.array(z.string().trim()).max(20).optional(),
  teamId: z.string().trim().nullable().optional(),
  reportingToIds: z.array(z.string().trim()).max(10).optional(),
  permissionOverrides: z.record(z.string(), z.boolean()).optional(),
  status: z.nativeEnum(EntityStatus).optional(),
  dataScopes: z.record(
    z.enum(["sales", "purchases", "expenses", "deliveries", "returns", "payments", "stock", "tasks"]),
    z.enum(["self", "team", "branch", "organization"])
  ).optional(),
});

export const DeactivateEmployeeSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(),
  membershipId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const ListEmployeesSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
  status: z.nativeEnum(EntityStatus).optional(),
});

export const GetEmployeeSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(),
  membershipId: z.string().trim().min(2),
});

export const CreateRoleSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(50).toLowerCase(),
  permissions: z.array(z.string().trim()).max(300).min(1),
  description: z.string().trim().max(500),
});

export const UpdateRoleSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  roleId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  permissions: z.array(z.string().trim()).max(300).optional(),
  description: z.string().trim().max(500).optional(),
});

export const CreateDepartmentSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  headMembershipIds: z.array(z.string().trim()).max(20).optional(),
});

export const UpdateDepartmentSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  departmentId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  headMembershipIds: z.array(z.string().trim()).max(20).optional(),
});

export const CreateJobRoleSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  /** Machine-readable slug; auto-derived from name when omitted. e.g. "Warehouse Manager" → "warehouse_manager" */
  code: z.string().trim().min(2).max(60).regex(/^[a-z][a-z0-9_]*$/, "code must be lowercase letters, digits and underscores").optional(),
});

export const UpdateJobRoleSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  jobRoleId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
});

export const CreateTeamSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  leaderMembershipId: z.string().trim().min(2).optional(),
});

export const UpdateTeamSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(),
  teamId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  leaderMembershipId: z.string().trim().min(2).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const TeamMemberSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(),
  teamId: z.string().trim().min(2),
  membershipId: z.string().trim().min(2),
  action: z.enum(["add", "remove"]),
});

export const CreatePlanSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  name: z.string().trim().min(2).max(100),
  price: z.number().nonnegative(),
  currency: z.string().trim().length(3).toUpperCase(),
  storageLimitMb: z.number().positive(),
  monthlyDocumentVolumeLimit: z.number().positive(),
  seatLimits: z.strictObject({
    admin: z.number().int().positive(),
    staff: z.number().int().positive(),
  }),
  branchLimit: z.number().int().positive().default(1).optional(),
  moduleFlags: z.record(z.string(), z.boolean()),
  isActive: z.boolean().default(true).optional(),
});

export const UpdatePlanSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  planId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  price: z.number().nonnegative().optional(),
  branchLimit: z.number().int().positive().optional(),
  moduleFlags: z.record(z.string(), z.boolean()).optional(),
  isActive: z.boolean().optional(),
});

export const PreviewPlanImpactSchema = z.strictObject({
  planId: z.string().trim().min(2).optional(),
  organizationId: z.string().trim().min(2).optional(),
  targetPlanId: z.string().trim().min(2).optional(),
  branchLimit: z.number().int().positive().optional(),
  seatLimits: z.strictObject({
    admin: z.number().int().nonnegative().optional(),
    staff: z.number().int().nonnegative().optional(),
  }).optional(),
  monthlyDocumentVolumeLimit: z.number().int().nonnegative().optional(),
  moduleFlags: z.record(z.string(), z.boolean()).optional(),
});

export const GetPlanSchema = z.strictObject({
  planId: z.string().trim().min(2),
});

export const ArchivePlanSchema = z.strictObject({
  planId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const DeletePlanSchema = z.strictObject({
  planId: z.string().trim().min(2),
});

export const ListPlatformUsersSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  roleId: z.string().trim().optional(),
  jobRoleId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().trim().optional(),
});

export const GetPlatformUserSchema = z.strictObject({
  userId: z.string().trim().min(2),
});

export const ListAuditLogsSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  actorUserId: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  entityId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  operation: z.enum(["create", "update", "delete", "status_change"]).optional(),
  status: z.string().trim().optional(),
  outcome: z.enum(["success", "denied", "failed", "all"]).default("all").optional(),
  category: z.enum(["mutation", "read_sensitive", "export", "auth", "file", "security", "admin", "system"]).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
  requestId: z.string().trim().min(1).max(64).optional(),
  includeTotal: z.boolean().optional(), // a count() costs reads: only when asked
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, "to date must be YYYY-MM-DD").optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().trim().optional(),
});

export const RegisterFcmTokenSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  deviceId: z.string().trim().min(4).max(128),
  fcmToken: z.string().trim().min(10).max(512),
  platform: z.enum(["android", "ios", "web"]),
});

// ============================================================
// Operational Business Validation Schemas
// ============================================================

// 1. Products
export const ProductAlternateUnitSchema = z.strictObject({
  unit: z.string().trim().min(1).max(30), // e.g. "box"
  factor: z.number().positive(), // base units per this unit, e.g. 1 box = 12 piece
  sellingPrice: z.number().min(0).optional(), // price per this unit (defaults to factor * base price)
  wholesalePrice: z.number().min(0).optional(),
  barcode: z.string().trim().max(100).optional(),
  isPurchaseUnit: z.boolean().optional(),
  isSaleUnit: z.boolean().optional(),
});

const PhysicalMeasureSchema = z.strictObject({ value: z.number().min(0), unit: z.string().trim().min(1).max(10) });

const ProductAttributeFields = {
  brand: z.string().trim().max(100).optional(),
  alternateUnits: z.array(ProductAlternateUnitSchema).max(10).optional(),
  isTaxable: z.boolean().default(true).optional(),
  taxExemptionReason: z.string().trim().max(200).optional(),
  isDiscountable: z.boolean().default(true).optional(),
  maxDiscountPercent: z.number().min(0).max(100).optional(), // Enforced in billing
  isReturnable: z.boolean().optional(),
  returnWindowDays: z.number().int().min(0).max(3650).optional(),
  reorderLevel: z.number().min(0).optional(),
  maxStockLevel: z.number().min(0).optional(),
  weight: PhysicalMeasureSchema.optional(),
  dimensions: z.strictObject({
    length: z.number().min(0).optional(),
    width: z.number().min(0).optional(),
    height: z.number().min(0).optional(),
    unit: z.string().trim().min(1).max(10),
  }).optional(),
  size: z.string().trim().max(50).optional(),
  imagePaths: z.array(z.string().trim().max(500)).max(8).optional(), // Cloud Storage object paths
  warrantyMonths: z.number().int().min(0).max(240).optional(),
  jewellery: z.strictObject({
    grossWeightGrams: z.number().min(0).optional(),
    netWeightGrams: z.number().min(0).optional(),
    purity: z.string().trim().max(20).optional(), // e.g. "22K", "916", "925"
    makingCharge: z.number().min(0).optional(),
    makingChargeType: z.enum(["per_gram", "flat", "percent"]).optional(),
    hallmarkId: z.string().trim().max(50).optional(),
    priceByDailyRate: z.boolean().optional(),
  }).optional(),
  variantGroupId: z.string().trim().max(128).nullable().optional(), // Shared by all variants of one model
  variantAttributes: z.record(z.string().trim().max(30), z.string().trim().max(60)).optional(), // {size:"26in", colour:"red"}
  visibilityScope: z.enum(["all_branches", "selected_branches", "branch_only"]).optional(),
  sharedForBranchIds: z.array(z.string().trim()).max(100).optional(),
};

export const CreateProductSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
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
  storageLocationId: z.string().trim().min(2).optional(),
  lowStockThreshold: z.number().min(0).default(5),
  trackBatch: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  hasVariants: z.boolean().optional(),
  isPurchaseOnly: z.boolean().optional(),
  isExpenseOnly: z.boolean().optional(),
  isSaleOnly: z.boolean().optional(),
  ...ProductAttributeFields,
});

export const UpdateProductSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
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
  trackBatch: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  isActive: z.boolean().optional(),
  ...ProductAttributeFields,
});

export const ListProductsSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  categoryId: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  ids: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(50)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "Duplicate product IDs are not allowed in ids filter.",
    })
    .optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 2. Categories
export const CreateCategorySchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(), // Null for platform/global
  name: z.string().trim().min(1).max(100),
  parentId: z.string().trim().nullable().optional(),
  nature: z.string().trim().optional(),
});

export const UpdateCategorySchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  categoryId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(100).optional(),
  parentId: z.string().trim().nullable().optional(),
  nature: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

export const ListCategoriesSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
  includeGlobal: z.boolean().default(true).optional(),
});

// 3. Units
export const CreateUnitSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(1).max(50),
  code: z.string().trim().min(1).max(20).toLowerCase(),
  group: z.nativeEnum(UnitGroup).default(UnitGroup.COUNT),
  precision: z.number().int().min(0).max(4).default(0),
  baseUnit: z.string().trim().nullable().optional(),
  conversionFactor: z.number().positive().optional(),
});

export const UpdateUnitSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  unitId: z.string().trim().min(2),
  name: z.string().trim().min(1).max(50).optional(),
  precision: z.number().int().min(0).max(4).optional(),
  isActive: z.boolean().optional(),
});

/** Units and categories are listed with one input shape (tenant + optional global catalog). */
export const ListUnitsSchema = ListCategoriesSchema;

// 4. Customers
export const CreateCustomerSchema = z.strictObject({
  duplicateOverrideReason: z.string().trim().min(5).max(300).optional(), // Owner/Admin: allow a duplicate phone/tax id
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  partyType: z.enum(["organization", "person"]).default("organization").optional(),
  name: z.string().trim().min(1).max(100),
  legalName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().optional(),
  additionalPhones: z.array(z.string().trim().max(30)).max(5).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  taxId: z.string().trim().max(50).optional(),
  addresses: z.array(AddressSchema).max(20).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  contacts: z.array(ContactPersonSchema).max(20).optional(),
  priceGroup: z.string().trim().default("retail").optional(),
  creditLimit: z.number().min(0).default(0),
  creditPeriodDays: z.number().int().min(0).default(30),
  visibilityScope: z.enum(["all_branches", "selected_branches", "branch_only"]).default("all_branches").optional(),
  sharedForBranchIds: z.array(z.string().trim()).max(100).optional(),
  isDefault: z.boolean().default(false).optional(),
}).superRefine((data, ctx) => {
  if (!data.phone && !data.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one contact method (phone or email) is required.", path: ["phone"] });
  }
  if (data.partyType === "person" && data.legalName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "legalName is not applicable for individual persons.", path: ["legalName"] });
  }
});

export const UpdateCustomerSchema = z.strictObject({
  duplicateOverrideReason: z.string().trim().min(5).max(300).optional(), // Owner/Admin: allow a duplicate phone/tax id
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  customerId: z.string().trim().min(2),
  partyType: z.enum(["organization", "person"]).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  legalName: z.string().trim().min(2).max(120).nullable().optional(),
  phone: z.string().trim().optional(),
  additionalPhones: z.array(z.string().trim().max(30)).max(5).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  taxId: z.string().trim().max(50).optional(),
  addresses: z.array(AddressSchema).max(20).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  contacts: z.array(ContactPersonSchema).max(20).optional(),
  priceGroup: z.string().trim().optional(),
  creditLimit: z.number().min(0).optional(),
  creditPeriodDays: z.number().int().min(0).optional(),
  visibilityScope: z.enum(["all_branches", "selected_branches", "branch_only"]).optional(),
  sharedForBranchIds: z.array(z.string().trim()).max(100).optional(),
  isActive: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.partyType === "person" && data.legalName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "legalName is not applicable for individual persons.", path: ["legalName"] });
  }
});

export const ListCustomersSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  partyType: z.enum(["organization", "person"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 5. Vendors
export const CreateVendorSchema = z.strictObject({
  duplicateOverrideReason: z.string().trim().min(5).max(300).optional(), // Owner/Admin: allow a duplicate phone/tax id
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  partyType: z.enum(["organization", "person"]).default("organization").optional(),
  name: z.string().trim().min(1).max(100),
  legalName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().optional(),
  additionalPhones: z.array(z.string().trim().max(30)).max(5).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  taxId: z.string().trim().max(50).optional(),
  addresses: z.array(AddressSchema).max(20).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  contacts: z.array(ContactPersonSchema).max(20).optional(),
  paymentTermsDays: z.number().int().min(0).default(0).optional(),
  creditLimit: z.number().min(0).default(0).optional(),
  visibilityScope: z.enum(["all_branches", "selected_branches", "branch_only"]).default("all_branches").optional(),
  sharedForBranchIds: z.array(z.string().trim()).max(100).optional(),
  isDefault: z.boolean().default(false).optional(),
}).superRefine((data, ctx) => {
  if (!data.phone && !data.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one contact method (phone or email) is required.", path: ["phone"] });
  }
  if (data.partyType === "person" && data.legalName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "legalName is not applicable for individual persons.", path: ["legalName"] });
  }
});

export const UpdateVendorSchema = z.strictObject({
  duplicateOverrideReason: z.string().trim().min(5).max(300).optional(), // Owner/Admin: allow a duplicate phone/tax id
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  vendorId: z.string().trim().min(2),
  partyType: z.enum(["organization", "person"]).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  legalName: z.string().trim().min(2).max(120).nullable().optional(),
  phone: z.string().trim().optional(),
  additionalPhones: z.array(z.string().trim().max(30)).max(5).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  taxId: z.string().trim().max(50).optional(),
  addresses: z.array(AddressSchema).max(20).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  contacts: z.array(ContactPersonSchema).max(20).optional(),
  paymentTermsDays: z.number().int().min(0).optional(),
  creditLimit: z.number().min(0).optional(),
  visibilityScope: z.enum(["all_branches", "selected_branches", "branch_only"]).optional(),
  sharedForBranchIds: z.array(z.string().trim()).max(100).optional(),
  isActive: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.partyType === "person" && data.legalName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "legalName is not applicable for individual persons.", path: ["legalName"] });
  }
});

/** Vendors and customers are listed with one input shape. */
export const ListVendorsSchema = ListCustomersSchema;

// 6. Unified Outflows (Purchase / Expense)
export const OutflowLineSchema = z.strictObject({
  productId: z.string().trim().nullable().optional(),
  // Non-catalog lines only (expenses, unlisted items): a catalog line is the productId alone
  itemName: z.string().trim().min(1).max(150).optional(),
  categoryId: z.string().trim().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(30).default("piece"),
  unitPrice: z.number().min(0),
  discountAmount: z.number().min(0).default(0).optional(),
  taxPercent: z.number().min(0).max(100).default(0).optional(),
  addToStock: z.boolean().default(true).optional(),
  batch: z.string().trim().optional(),
  expiryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
  // Goods receipt: damaged-on-receipt units are billed by the vendor but never enter stock
  damagedQuantity: z.number().min(0).optional(),
  damageReason: z.string().trim().max(300).optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(), // IMEI / frame numbers
}).superRefine((line, ctx) => {
  if (line.productId && (line.itemName !== undefined || line.categoryId)) {
    ctx.addIssue({ code: "custom", message: "[REFERENCE_ATTRIBUTE_COPY] A catalog line references productId only; itemName/categoryId are for non-catalog lines." });
  }
  if (!line.productId && !line.itemName) {
    ctx.addIssue({ code: "custom", message: "A non-catalog line needs itemName." });
  }
});

export const SplitPaymentEntrySchema = z.strictObject({
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().positive("Payment amount must be positive"),
  financialAccountId: z.string().trim().min(2, "Valid financial account required"),
  notes: z.string().trim().max(300).optional(),
});

export const CreateOutflowSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  kind: z.nativeEnum(OutflowKind),
  docDate: z.string().trim().optional(), // ISO string, defaults to now
  vendorId: z.string().trim().nullable().optional(),
  // Free-text counterparty for an unregistered vendor / other payee (never beside vendorId or payeeMembershipId)
  payee: z.string().trim().min(1).max(200).optional(),
  recurringTemplateId: z.string().trim().min(2).optional(), // set by the recurring-expense generator
  invoiceNumber: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
  lines: z.array(OutflowLineSchema).min(1).max(MAX_DOCUMENT_LINES),
  paidAmount: z.number().min(0).default(0).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  financialAccountId: z.string().trim().min(2).optional(),
  storageLocationId: z.string().trim().min(2).optional(),
  splitPayments: z.array(SplitPaymentEntrySchema).max(5).optional(),
  notes: z.string().trim().max(1000).optional(),
  // Expense payee: vendor / employee (membership id, sensitive) / other (free-text payee snapshot)
  payeeType: z.enum(["vendor", "employee", "other"]).optional(),
  payeeMembershipId: z.string().trim().min(2).optional(),
  expenseCategoryId: z.string().trim().optional(),
  billDiscountAmount: z.number().min(0).optional(), // Bill-level (cash) discount after line totals
  billDiscountPercent: z.number().min(0).max(100).optional(),
  attachmentPaths: z.array(z.string().trim().max(500)).max(10).optional(), // Receipt images in Storage
});

export const ListOutflowsSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  kind: z.nativeEnum(OutflowKind).optional(),
  vendorId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  payeeMembershipId: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  minAmount: z.number().min(0).optional(),
  maxAmount: z.number().min(0).optional(),
  search: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 7. Shared Bills (POS / B2B)
export const BillItemSchema = z.strictObject({
  productId: z.string().trim().min(2),
  quantity: z.number().positive(),
  unitPriceOverride: z.number().min(0).optional(),
  discountValue: z.number().min(0).default(0).optional(),
  unit: z.string().trim().optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
});

export const CreateBillSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  salesMode: z.nativeEnum(SalesMode).default(SalesMode.POS),
  documentType: z.nativeEnum(DocumentType).default(DocumentType.INVOICE).optional(),
  status: z.enum(["draft", "active"]).default("active").optional(),
  customerId: z.string().trim().nullable().optional(),
  // Walk-in party details (only without customerId; a registered customer is referenced by id)
  walkInCustomer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(20).optional(),
    taxId: z.string().trim().max(30).optional(),
    billingAddress: z.string().trim().max(500).optional(),
  }).optional(),
  items: z.array(BillItemSchema).min(1).max(MAX_DOCUMENT_LINES),
  discountTotal: z.number().min(0).default(0).optional(),
  paidAmount: z.number().min(0).default(0).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH).optional(),
  financialAccountId: z.string().trim().min(2).optional(),
  storageLocationId: z.string().trim().min(2).optional(),
  splitPayments: z.array(SplitPaymentEntrySchema).max(5).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const PreviewBillSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  salesMode: z.nativeEnum(SalesMode).default(SalesMode.POS).optional(),
  documentType: z.nativeEnum(DocumentType).default(DocumentType.INVOICE).optional(),
  customerId: z.string().trim().nullable().optional(),
  walkInCustomer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(20).optional(),
    taxId: z.string().trim().max(30).optional(),
    billingAddress: z.string().trim().max(500).optional(),
  }).optional(),
  items: z.array(BillItemSchema).min(1).max(MAX_DOCUMENT_LINES),
  discountTotal: z.number().min(0).default(0).optional(),
  paidAmount: z.number().min(0).default(0).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH).optional(),
  financialAccountId: z.string().trim().min(2).optional(),
  storageLocationId: z.string().trim().min(2).optional(),
  splitPayments: z.array(SplitPaymentEntrySchema).max(5).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Edit of a quotation / proforma / draft invoice (re-priced; finalized documents are immutable). */
export const UpdateDraftBillSchema = z.strictObject({
  ...ContextFields,
  billId: z.string().trim().min(2),
  customerId: z.string().trim().nullable().optional(),
  walkInCustomer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(20).optional(),
    taxId: z.string().trim().max(30).optional(),
    billingAddress: z.string().trim().max(500).optional(),
  }).optional(),
  items: z.array(BillItemSchema).min(1).max(MAX_DOCUMENT_LINES).optional(),
  discountTotal: z.number().min(0).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const FinalizeBillSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  billId: z.string().trim().min(2),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ListBillsSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  salesMode: z.nativeEnum(SalesMode).optional(),
  customerId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  createdBy: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  minAmount: z.number().min(0).optional(),
  maxAmount: z.number().min(0).optional(),
  search: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 8. Deliveries
export const CreateDeliverySchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  billId: z.string().trim().min(2), // ID reference ONLY! The customer is the bill's customerId
  // Partial delivery: quantities per bill line (default: everything not yet out for delivery)
  lines: z.array(z.strictObject({ lineId: z.string().trim().min(1).max(10), quantity: z.number().positive() })).min(1).max(MAX_DOCUMENT_LINES).optional(),
  // Person at the door, only when different from the bill-to party (owned delivery fact)
  recipient: z.strictObject({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(4).max(30),
  }).optional(),
  address: z.strictObject({
    line1: z.string().trim().min(1),
    line2: z.string().trim().optional(),
    landmark: z.string().trim().optional(),
    city: z.string().trim().min(1),
    pincode: z.string().trim().min(1),
  }),
  riderMembershipId: z.string().trim().nullable().optional(),
  partner: z.nativeEnum(DeliveryPartner).default(DeliveryPartner.INTERNAL),
  deliveryFee: z.number().min(0).default(0),
  cod: z.strictObject({
    isCod: z.boolean().default(false),
    amount: z.number().min(0).default(0),
  }).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const UpdateDeliveryStatusSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  deliveryId: z.string().trim().min(2),
  status: z.nativeEnum(DeliveryStatus),
  riderMembershipId: z.string().trim().optional(),
  codCollected: z.boolean().optional(),
  collectedAmount: z.number().min(0).optional(), // Cash/UPI collected at the door (finalizes pre-sale orders)
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const ListDeliveriesSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  status: z.nativeEnum(DeliveryStatus).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 9. Returns
export const ReturnItemSchema = z.strictObject({
  productId: z.string().trim().min(2),
  // Required when the product appears on more than one line of the source document
  sourceLineId: z.string().trim().min(1).max(10).optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(), // required for serial-tracked products
  quantity: z.number().positive(),
  refundAmount: z.number().min(0),
  reason: z.string().trim().min(1).max(200),
  disposition: z.nativeEnum(ReturnDisposition).default(ReturnDisposition.RESTOCKED_TO_INVENTORY),
});

export const CreateReturnSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  returnType: z.nativeEnum(ReturnType),
  referenceId: z.string().trim().min(2), // billId or outflowId; the party is derived from it
  items: z.array(ReturnItemSchema).min(1).max(MAX_DOCUMENT_LINES),
  refundMethod: z.enum(["cash", "credit_note", "original_payment"]).default("cash"),
  refundFinancialAccountId: z.string().trim().min(2).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateReturnInput = z.infer<typeof CreateReturnSchema>;

export const ListReturnsSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  returnType: z.nativeEnum(ReturnType).optional(),
  referenceId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const PaymentAllocationInputSchema = z.strictObject({
  documentId: z.string().trim().min(2),
  documentType: z.enum(["bill", "outflow"]),
  amount: z.number().positive(),
});

// 10. Payments Ledger
export const CreatePaymentSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  direction: z.nativeEnum(PaymentDirection),
  partyType: z.nativeEnum(PartyType),
  partyId: z.string().trim().nullable().optional(),
  // Free text only for a standalone payment (no partyId, no referenceId); otherwise the party is referenced
  partyName: z.string().trim().min(1).max(100).optional(),
  amount: z.number().positive(),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  referenceId: z.string().trim().nullable().optional(), // billId or outflowId
  referenceModel: z.enum(["bill", "outflow"]).nullable().optional(),
  financialAccountId: z.string().trim().min(2).nullable().optional(),
  allocations: z.array(PaymentAllocationInputSchema).max(MAX_DOCUMENT_LINES).optional(),
  notes: z.string().trim().max(500).optional(),
  // Future payment-gateway extension point (no gateway integrated today). Never card numbers.
  gateway: z.strictObject({
    externalReference: z.string().trim().max(128).optional(), // UPI RRN, card auth code, cheque no.
    gatewayProvider: z.string().trim().max(50).optional(),
    gatewayStatus: z.enum(["initiated", "authorized", "captured", "failed", "refunded"]).optional(),
    cardBrand: z.string().trim().max(20).optional(),
    cardLast4: z.string().trim().regex(/^d{4}$/).optional(),
  }).optional(),
});

export const VoidPaymentSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  paymentId: z.string().trim().min(2),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ListPaymentsSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  direction: z.nativeEnum(PaymentDirection).optional(),
  partyId: z.string().trim().optional(),
  referenceId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// 11. Stock Movements / Adjustments
export const StockAdjustSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(), // Derived server-side from active context
  storageLocationId: z.string().trim().min(2).optional(),
  productId: z.string().trim().min(2),
  quantity: z.number(), // Positive to add, negative to deduct
  reason: z.string().trim().min(2).max(500),
  // Loss codes (damaged, expired, lost_theft, sample, internal_use) are P&L write-offs
  reasonCode: z.nativeEnum(StockAdjustmentReason).optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(), // required for serial-tracked products
});

export const ListStockMovementsSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  branchId: z.string().trim().optional(),
  productId: z.string().trim().optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// ============================================================
// Branch Validation Schemas
// ============================================================

export const BranchAddressSchema = AddressSchema;

export const BranchContactSchema = z.strictObject({
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email().toLowerCase().nullable().optional(),
  contactPerson: z.string().trim().max(100).nullable().optional(),
});

export const BranchSettingsSchema = z.strictObject({
  taxId: z.string().trim().nullable().optional(),
  allowNegativeStock: z.boolean().default(false).optional(),
  isOwnStockyard: z.boolean().default(false).optional(),
  defaultSalesMode: z.nativeEnum(SalesMode).default(SalesMode.POS).optional(),
  defaultFinancialAccountId: z.string().trim().min(2).nullable().optional(),
  moduleOverrides: z.record(z.string(), z.boolean()).default({}).optional(),
});

export const CreateBranchSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().min(8).max(128).optional(),
  organizationId: z.string().trim().optional(),
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/),
  address: BranchAddressSchema.optional(),
  contact: BranchContactSchema.optional(),
  settings: BranchSettingsSchema.optional(),
});

export const UpdateBranchSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  isActive: z.boolean().optional(),
  address: BranchAddressSchema.optional(),
  contact: BranchContactSchema.optional(),
  settings: BranchSettingsSchema.optional(),
});

export const DeactivateBranchSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
});

export const ListBranchesSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
  status: z.nativeEnum(EntityStatus).optional(),
});

export const SwitchBranchContextSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  targetBranchId: z.string().trim().min(2),
});

export const UpdateSharingPoliciesSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
  policies: z.strictObject({
    products: z.enum(["organization_shared", "branch_scoped"]).optional(),
    categories: z.enum(["organization_shared", "branch_scoped"]).optional(),
    customers: z.enum(["organization_shared", "branch_scoped"]).optional(),
    vendors: z.enum(["organization_shared", "branch_scoped"]).optional(),
    sales: z.enum(["organization_shared", "branch_scoped"]).optional(),
    purchases: z.enum(["organization_shared", "branch_scoped"]).optional(),
    expenses: z.enum(["organization_shared", "branch_scoped"]).optional(),
    stock: z.literal("branch_scoped").optional(),
    deliveries: z.enum(["organization_shared", "branch_scoped"]).optional(),
  }),
});

/**
 * -------------------------------------------------------------
 * Operations & Intelligence Validation Schemas
 * -------------------------------------------------------------
 */

// Reporting
export const GetRevenueReportSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
  groupBy: z.enum(["day", "month", "year"]).default("day").optional(),
});

export const GetProfitLossReportSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
  periodType: z.enum(["day", "week", "month", "year", "custom"]).default("custom").optional(),
  periodValue: z.string().trim().optional(),
  comparePreviousPeriod: z.boolean().default(false).optional(),
});

export const GetStockValuationReportSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
});

export const GetTopEntitiesReportSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  entityType: z.enum(["products", "customers", "vendors"]),
  limit: z.number().int().min(1).max(50).default(10).optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
});

export const GetStaffReportSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  staffMembershipId: z.string().trim().optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
});

export const GetPlatformOverviewReportSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
});

export const ExportReportSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  reportType: z.enum(["revenue", "profit_loss", "stock_valuation", "top_products", "staff_sales"]),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
});

// Tasks
export const CreateTaskSchema = z.strictObject({
  branchId: ContextFields.branchId,
  idempotencyKey: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  title: z.string().trim().min(2, "Task title must be at least 2 characters").max(200),
  description: z.string().trim().max(2000).optional(),
  assignedToMembershipId: z.string().trim().min(3, "Valid membershipId required"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium").optional(),
  dueAt: z.string().trim().datetime({ offset: true }).optional(),
  relatedEntityType: z.enum(["bill", "outflow", "delivery", "customer", "vendor", "product"]).nullable().optional(),
  relatedEntityId: z.string().trim().nullable().optional(),
});

export const UpdateTaskSchema = z.strictObject({
  branchId: ContextFields.branchId,
  taskId: z.string().trim().min(3, "taskId is required"),
  organizationId: z.string().trim().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  assignedToMembershipId: z.string().trim().min(3).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueAt: z.string().trim().datetime({ offset: true }).nullable().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
});

export const AssignTaskSchema = z.strictObject({
  branchId: ContextFields.branchId,
  taskId: z.string().trim().min(3, "taskId is required"),
  organizationId: z.string().trim().optional(),
  assignedToMembershipId: z.string().trim().min(3, "Valid membershipId required"),
});

export const UpdateTaskStatusSchema = z.strictObject({
  branchId: ContextFields.branchId,
  taskId: z.string().trim().min(3, "taskId is required"),
  organizationId: z.string().trim().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
});

export const ListTasksSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
  assignedToMembershipId: z.string().trim().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const DeleteTaskSchema = z.strictObject({
  branchId: ContextFields.branchId,
  taskId: z.string().trim().min(3, "taskId is required"),
  organizationId: z.string().trim().optional(),
});

// Live Location Tracking
export const RecordLocationPingSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  speed: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  source: z.enum(["foreground", "background"]).default("foreground").optional(),
  recordedAt: z.string().trim().optional(),
});

export const GetLatestLocationsSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
  membershipIds: z.array(z.string().trim()).max(50).optional(),
});

export const GetLocationHistorySchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
  membershipId: z.string().trim().min(3, "membershipId is required"),
  from: z.string().trim().datetime({ offset: true }).optional(),
  to: z.string().trim().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
});

// Notifications
export const ListNotificationsSchema = z.strictObject({
  ...ContextFields,
  limit: z.number().int().min(1).max(100).default(50).optional(),
  unreadOnly: z.boolean().default(false).optional(),
});

export const MarkNotificationReadSchema = z.strictObject({
  ...ContextFields,
  notificationId: z.string().trim().min(3, "notificationId is required"),
});

// Branch Reconciliation
export const ReconcileBranchCountsSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2).optional(), // Derived server-side from active context
  repair: z.boolean().default(false).optional(),
});

export const ReconcileStockSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  productId: z.string().trim().optional(),
  repair: z.boolean().default(false).optional(),
});

export const ReconcilePartySchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  partyType: z.enum(["customer", "vendor"]),
  partyId: z.string().trim().optional(),
});

// Super Admin Usage Metering Schemas
export const GetPlatformUsageSummarySchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
});

export const GetOrganizationsUsageSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  sortBy: z.enum(["activity", "cost", "name"]).default("activity").optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterOrgId: z.string().trim().optional(),
});

export const GetBranchesUsageSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
});

export const GetUsageDetailSchema = z.strictObject({
  organizationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  service: z.enum(["firestore", "functions", "storage", "auth", "fcm", "location"]).optional(),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  granularity: z.enum(["daily", "monthly"]).default("daily").optional(),
});

export const CalculateDryRunStatementSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2),
  billingPeriod: z.string().trim().regex(/^\d{4}-\d{2}$/, "Format must be YYYY-MM"),
  rateCardVersion: z.string().trim().optional(),
});

export const GetUsageLimitsSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().optional(),
});

export const MetricLimitConfigSchema = z.strictObject({
  dailyLimit: z.number().int().nonnegative().optional(),
  weeklyLimit: z.number().int().nonnegative().optional(),
  monthlyLimit: z.number().int().nonnegative().optional(),
  warningThresholdPercent: z.number().min(0).max(100).default(80),
  hardThresholdPercent: z.number().min(0).max(100).default(100),
  enforcementMode: z.enum(["warn_only", "hard_block"]).default("warn_only"),
  enabled: z.boolean().default(true),
});

export const UpdateUsageLimitsSchema = z.strictObject({
  branchId: ContextFields.branchId,
  organizationId: z.string().trim().min(2, "organizationId is required"),
  limits: z.record(z.string(), MetricLimitConfigSchema),
});


// ============================================================
// Document Lifecycle, Statements & History
// ============================================================

/** Approve or reject a pending (maker–checker) document. */
export const DocumentDecisionSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  // One approval entry point (documentsDecide) for every maker–checker document type
  documentType: z.enum(["bill", "outflow", "return", "stock_adjustment", "account_transfer", "stock_transfer", "account_entry"]),
  documentId: z.string().trim().min(2),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type DocumentDecisionInput = z.infer<typeof DocumentDecisionSchema>;

/** Void a finalized financial document (reversal entries) or cancel a draft/pending one. */
export const VoidDocumentSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  documentId: z.string().trim().min(2),
  reason: z.string().trim().min(3).max(500),
  paymentDisposition: z.enum(["reverse_entries", "keep_as_customer_credit"]).default("reverse_entries").optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const IsoDateOrDateTime = z.string().trim().regex(/^d{4}-d{2}-d{2}(T.*)?$/, "Expected YYYY-MM-DD or ISO-8601 date-time");

export const PartyStatementSchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  partyType: z.enum(["customer", "vendor"]),
  partyId: z.string().trim().min(2),
  from: IsoDateOrDateTime.optional(),
  to: IsoDateOrDateTime.optional(),
});

export const OutflowSummarySchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  from: IsoDateOrDateTime.optional(),
  to: IsoDateOrDateTime.optional(),
  groupBy: z.enum(["day", "category", "employee", "vendor", "branch"]).default("day").optional(),
});

export const PriceHistorySchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  productId: z.string().trim().min(2),
  vendorId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
});

export const EntityHistorySchema = z.strictObject({
  organizationId: z.string().trim().min(2).optional(),
  branchId: z.string().trim().optional(),
  entityType: z.enum([
    "product",
    "customer",
    "vendor",
    "bill",
    "outflow",
    "purchase",
    "expense",
    "wastage",
    "employee",
    "organization",
    "team",
    "return",
    "stock",
    "payment",
    "delivery",
    "role",
    "department",
    "job_role",
    "unit",
    "category",
    "recurring_expense",
  ]).optional(),
  entityId: z.string().trim().min(2).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
});

const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const CreateRecurringExpenseSchema = z.strictObject({
  ...ContextFields,
  idempotencyKey: z.string().min(8).max(128).optional(),
  name: z.string().trim().min(2).max(120),
  vendorId: z.string().trim().min(2).optional(),
  payee: z.string().trim().min(1).max(200).optional(),
  payeeType: z.enum(["vendor", "employee", "other"]).optional(),
  payeeMembershipId: z.string().trim().min(2).optional(),
  expenseCategoryId: z.string().trim().max(60).optional(),
  lines: z.array(OutflowLineSchema).min(1).max(20),
  frequency: z.enum(["monthly", "weekly"]),
  dayOfMonth: z.number().int().min(1).max(28).optional(), // monthly (1–28: exists every month)
  weekday: z.number().int().min(1).max(7).optional(), // weekly, ISO 1 = Monday
  startOn: CalendarDate,
  endOn: CalendarDate.optional(),
}).refine((d) => !d.endOn || d.endOn >= d.startOn, { path: ["endOn"], message: "endOn must not be before startOn" });
export const RecurringExpenseCreateSchema = CreateRecurringExpenseSchema;

export const UpdateRecurringExpenseSchema = z.strictObject({
  ...ContextFields,
  templateId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(120).optional(),
  lines: z.array(OutflowLineSchema).min(1).max(20).optional(),
  endOn: CalendarDate.nullable().optional(),
  isActive: z.boolean().optional(),
});
export const RecurringExpenseUpdateSchema = UpdateRecurringExpenseSchema;

export const ListRecurringExpensesSchema = z.strictObject({
  ...ContextFields,
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  startAfterId: z.string().trim().optional(),
});

// ── Image Pipeline Schemas (N-06 / N-07) ─────────────────────────
export const CreateImageUploadSessionSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  purpose: z.enum(["org_logo", "user_photo", "party_photo", "product_image"]),
  entityType: z.enum(["organization", "user", "customer", "vendor", "product"]),
  entityId: z.string().trim().optional(),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const AttachImageSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  uploadId: z.string().trim().min(5).max(100),
  entityType: z.enum(["organization", "user", "customer", "vendor", "product"]),
  entityId: z.string().trim().min(2),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const RemoveImageSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  entityType: z.enum(["organization", "user", "customer", "vendor", "product"]),
  entityId: z.string().trim().min(2),
  clientRequestId: z.string().min(8).max(128).optional(),
});

// ── Super Admin User Provisioning & Ownership Transfer (N-02 / N-03 / D-1) ──
export const ProvisionUserSchema = z.strictObject({
  organizationId: z.string().trim().min(2),
  role: z.enum(["owner", "admin"]),
  user: z.strictObject({
    name: PersonNameSchema,
    email: z.string().trim().email().toLowerCase(),
    phone: z.string().trim().min(5).max(30),
    jobTitle: z.string().trim().max(100).optional(),
    image: ImageRefSchema.optional(),
    uploadId: z.string().trim().optional(),
  }),
  credentialMode: z.enum(["temporaryPassword", "invite"]).default("temporaryPassword").optional(),
  reason: z.string().trim().min(5).max(300),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const TransferOwnershipSchema = z.strictObject({
  organizationId: z.string().trim().min(2),
  newOwnerUserId: z.string().trim().min(2),
  previousOwnerAction: z.enum(["demote_to_admin", "deactivate"]),
  reason: z.string().trim().min(5).max(300),
  clientRequestId: z.string().min(8).max(128).optional(),
});

// ── Self Profile Update (N-09.1) ─────────────────────────────────
export const UpdateMeSchema = z.strictObject({
  name: PersonNameSchema.optional(),
  phone: z.string().trim().min(5).max(30).optional(),
  image: ImageRefSchema.optional(),
  uploadId: z.string().trim().optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

// ── Requests & Support Desk Module (Prompt 74, D-36..D-45) ──────────────

export const RequestAttachmentSchema = z.strictObject({
  storagePath: z.string().trim().min(5).max(500),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  uploadedAt: z.string().datetime().optional(),
});

export const PlanChangeDetailsSchema = z.strictObject({
  requestedPlanId: z.string().trim().min(1).max(100),
  billingPeriod: z.enum(["monthly", "yearly"]).optional(),
  effectiveFrom: z.string().trim().optional(),
  reason: z.string().trim().min(10).max(2000),
});

export const LimitIncreaseDetailsSchema = z.strictObject({
  metric: z.enum([
    "firestoreReads",
    "firestoreWrites",
    "firestoreDeletes",
    "functionsInvocations",
    "functionsErrors",
    "functionsExecutionMs",
    "storageUploadBytes",
    "storageDownloadBytes",
    "storageOperations",
    "authOperations",
    "fcmDispatches",
    "locationPings",
  ]),
  period: z.enum(["daily", "monthly"]),
  requestedLimit: z.number().int().positive(),
  reason: z.string().trim().min(5).max(2000),
});

export const ModuleRequestDetailsSchema = z.strictObject({
  moduleKey: z.string().trim().min(2).max(50),
  action: z.enum(["enable", "disable"]),
  reason: z.string().trim().min(5).max(2000),
});

export const BillingQueryDetailsSchema = z.strictObject({
  subject: z.enum(["invoice", "payment", "charge", "other"]),
  reference: z.string().trim().max(100).optional(),
  amount: z.number().nonnegative().optional(),
  description: z.string().trim().min(5).max(5000),
});

export const OrgProfileChangeDetailsSchema = z.strictObject({
  field: z.enum([
    // S0 (Super Admin only)
    "name",
    "businessType",
    "businessCategory",
    "financialYearStartMonth",
    "moduleToggles",
    "salesChannels",
    "timezone",
    "showCostToTenant",
    // S1 (sensitive legal/bank fields — refused for callers who already hold the edit permission, BS-16)
    "legalName",
    "taxId",
    "bankAccounts",
  ]),
  proposedValue: z.unknown(),
  reason: z.string().trim().min(5).max(2000),
});

export const OwnershipTransferDetailsSchema = z.strictObject({
  newOwnerUserId: z.string().trim().min(2).optional(),
  newOwnerEmail: z.string().trim().email().toLowerCase().optional(),
  effectiveFrom: z.string().trim().optional(),
  reason: z.string().trim().min(10).max(2000),
}).refine((d) => Boolean(d.newOwnerUserId || d.newOwnerEmail), {
  message: "Either newOwnerUserId or newOwnerEmail must be provided",
  path: ["newOwnerUserId"],
});

export const BugReportDetailsSchema = z.strictObject({
  area: z.string().trim().min(2).max(100),
  stepsToReproduce: z.string().trim().min(5).max(5000),
  expected: z.string().trim().min(2).max(2000),
  actual: z.string().trim().min(2).max(2000),
  severity: z.nativeEnum(RequestSeverity),
  frequency: z.enum(["always", "often", "sometimes", "once"]).optional(),
  diagnosticsOptIn: z.boolean().default(false),
  diagnostics: z.record(z.string(), z.unknown()).optional(),
}).refine((d) => d.diagnosticsOptIn || !d.diagnostics, {
  message: "diagnostics requires diagnosticsOptIn to be true (D-27, A-15)",
  path: ["diagnostics"],
});

export const DataIssueDetailsSchema = z.strictObject({
  entityType: z.string().trim().min(2).max(100),
  entityId: z.string().trim().max(128).optional(),
  whatIsWrong: z.string().trim().min(5).max(2000),
  expected: z.string().trim().min(2).max(2000),
});

export const FeatureRequestDetailsSchema = z.strictObject({
  problem: z.string().trim().min(10).max(5000),
  businessImpact: z.string().trim().min(10).max(2000),
  area: z.string().trim().min(2).max(100),
  proposedSolution: z.string().trim().max(5000).optional(),
  neededBy: z.string().trim().optional(),
  alternatives: z.string().trim().max(2000).optional(),
});

export const ImprovementDetailsSchema = z.strictObject({
  area: z.string().trim().min(2).max(100),
  currentBehaviour: z.string().trim().min(5).max(2000),
  suggestedBehaviour: z.string().trim().min(5).max(2000),
});

export const SupportQuestionDetailsSchema = z.strictObject({
  topic: z.enum(["how_to", "account", "billing", "other"]),
  question: z.string().trim().min(5).max(5000),
});

export const OtherDetailsSchema = z.strictObject({
  detailsText: z.string().trim().min(5).max(5000),
});

export const DataRequestDetailsSchema = z.strictObject({
  type: z.enum(["export", "correction", "deletion"]),
  scope: z.string().trim().min(5).max(1000),
  reason: z.string().trim().min(10).max(2000),
  confirmationText: z.string().trim().max(100).optional(),
}).refine((d) => d.type !== "deletion" || (typeof d.confirmationText === "string" && d.confirmationText.length >= 4), {
  message: "confirmationText is required for deletion request",
  path: ["confirmationText"],
});

export const SecurityConcernDetailsSchema = z.strictObject({
  description: z.string().trim().min(10).max(5000),
  whenNoticed: z.string().trim().optional(),
  suspectedImpact: z.string().trim().max(2000).optional(),
});

export const AccessRequestDetailsSchema = z.strictObject({
  permissionKeys: z.array(z.string().trim().min(2)).max(50).optional(),
  roleId: z.string().trim().max(100).optional(),
  branchId: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(5).max(2000),
  until: z.string().trim().optional(),
}).refine((d) => Boolean((d.permissionKeys && d.permissionKeys.length > 0) || d.roleId), {
  message: "Either permissionKeys or roleId must be provided",
  path: ["permissionKeys"],
});

export const CATEGORY_DETAILS_SCHEMAS = {
  [RequestCategory.PLAN_CHANGE]: PlanChangeDetailsSchema,
  [RequestCategory.LIMIT_INCREASE]: LimitIncreaseDetailsSchema,
  [RequestCategory.MODULE_REQUEST]: ModuleRequestDetailsSchema,
  [RequestCategory.BILLING_QUERY]: BillingQueryDetailsSchema,
  [RequestCategory.ORG_PROFILE_CHANGE]: OrgProfileChangeDetailsSchema,
  [RequestCategory.OWNERSHIP_TRANSFER]: OwnershipTransferDetailsSchema,
  [RequestCategory.BUG_REPORT]: BugReportDetailsSchema,
  [RequestCategory.DATA_ISSUE]: DataIssueDetailsSchema,
  [RequestCategory.FEATURE_REQUEST]: FeatureRequestDetailsSchema,
  [RequestCategory.IMPROVEMENT]: ImprovementDetailsSchema,
  [RequestCategory.SUPPORT_QUESTION]: SupportQuestionDetailsSchema,
  [RequestCategory.OTHER]: OtherDetailsSchema,
  [RequestCategory.DATA_REQUEST]: DataRequestDetailsSchema,
  [RequestCategory.SECURITY_CONCERN]: SecurityConcernDetailsSchema,
  [RequestCategory.ACCESS_REQUEST]: AccessRequestDetailsSchema,
} as const;

export const CreateRequestSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  audience: z.nativeEnum(RequestAudience).optional(),
  category: z.nativeEnum(RequestCategory),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  details: z.record(z.string(), z.unknown()),
  priority: z.nativeEnum(RequestPriority).optional(),
  severity: z.nativeEnum(RequestSeverity).optional(),
  relatedEntity: z.strictObject({
    type: z.string().trim().min(2).max(50),
    id: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(120),
  }).optional(),
  attachments: z.array(RequestAttachmentSchema).max(5).default([]).optional(),
  labels: z.array(z.string().trim().min(1).max(50)).max(10).default([]).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const UpdateRequestSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(3).max(5000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(RequestAttachmentSchema).max(5).optional(),
  expectedVersion: z.number().int().positive(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const AddRequestCommentSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  content: z.string().trim().min(1).max(5000),
  attachments: z.array(RequestAttachmentSchema).max(5).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const TransitionRequestSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  action: z.nativeEnum(RequestAction),
  expectedStatus: z.nativeEnum(RequestStatus),
  reason: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(5000).optional(),
  resumeOn: z.string().trim().optional(),
  resolutionType: z.nativeEnum(RequestResolutionType).optional(),
  duplicateOf: z.string().trim().optional(),
  overrideReason: z.string().trim().max(2000).optional(),
  effectiveFrom: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const GetRequestSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const ListRequestsSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  scope: z.enum(["mine", "organization"]).default("mine").optional(),
  audience: z.nativeEnum(RequestAudience).optional(),
  status: z.array(z.nativeEnum(RequestStatus)).optional(),
  category: z.array(z.nativeEnum(RequestCategory)).optional(),
  priority: z.array(z.nativeEnum(RequestPriority)).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().trim().optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const ListRequestActivitySchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().trim().optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const RequestScopedQuerySchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const GetRequestCountsSchema = RequestScopedQuerySchema;

export const InboxListRequestsSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  status: z.array(z.nativeEnum(RequestStatus)).optional(),
  category: z.array(z.nativeEnum(RequestCategory)).optional(),
  priority: z.array(z.nativeEnum(RequestPriority)).optional(),
  targetOrganizationId: z.string().trim().min(2).optional(),
  assignee: z.string().trim().optional(), // "me" | "unassigned" | uid
  slaState: z.nativeEnum(SlaState).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(["createdAt", "lastActivityAt", "priority", "resolutionDueAt"]).default("lastActivityAt").optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().trim().optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const InboxCountsRequestsSchema = RequestScopedQuerySchema;

export const AssignRequestSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  assigneeUid: z.string().trim().min(2).nullable(),
  assigneeName: z.string().trim().max(100).optional(),
  startReview: z.boolean().default(false).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const SetRequestPrioritySchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  priority: z.nativeEnum(RequestPriority),
  severity: z.nativeEnum(RequestSeverity).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const AddInternalNoteSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  content: z.string().trim().min(1).max(5000),
  attachments: z.array(RequestAttachmentSchema).max(5).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const ApplyRequestSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  requestId: z.string().trim().min(2),
  expectedStatus: z.literal(RequestStatus.APPROVED).default(RequestStatus.APPROVED).optional(),
  overrideReason: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const ListPlansCatalogSchema = z.strictObject({
  organizationId: ContextFields.organizationId,
  branchId: ContextFields.branchId,
  includeInactive: z.boolean().default(false).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const GetRequestsMetaSchema = RequestScopedQuerySchema;

const SlaWindowBoundsSchema = z.strictObject({
  firstResponseHours: z.number().int().min(1).max(720),
  resolutionHours: z.number().int().min(1).max(2160),
});

export const GetRequestsSettingsSchema = z.strictObject({});

export const UpdateRequestsSettingsSchema = z.strictObject({
  requestsEnabled: z.boolean().optional(),
  sla: z.strictObject({
    urgent: SlaWindowBoundsSchema.optional(),
    high: SlaWindowBoundsSchema.optional(),
    normal: SlaWindowBoundsSchema.optional(),
    low: SlaWindowBoundsSchema.optional(),
  }).optional(),
  limits: z.strictObject({
    maxOpenPerUser: z.number().int().min(1).max(1000).optional(),
    maxOpenPerOrg: z.number().int().min(1).max(10000).optional(),
    maxCreationsPerHourPerUser: z.number().int().min(1).max(500).optional(),
  }).optional(),
  autoCloseDays: z.number().int().min(1).max(90).optional(),
  reopenWindowDays: z.number().int().min(1).max(90).optional(),
  needsInfoReminderDays: z.number().int().min(1).max(30).optional(),
  needsInfoAutoCancelDays: z.number().int().min(1).max(90).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

// ============================================================
// Financial Accounts & Ledger Validation Schemas
// ============================================================

export const FinancialAccountTypeSchema = z.enum(["cash", "bank", "digital", "clearing", "control"]);

export const BankDetailsInputSchema = z.strictObject({
  bankName: z.string().trim().min(2).max(100).optional(),
  accountNumberMasked: z.string().trim().min(4).max(30).optional(),
  ifscOrSwift: z.string().trim().min(4).max(20).optional(),
  bankBranchName: z.string().trim().max(100).optional(),
  upiId: z.string().trim().max(100).optional(),
});

export const FeeRuleInputSchema = z.strictObject({
  feePercent: z.number().min(0).max(100).optional(),
  feeFixed: z.number().min(0).optional(),
  feeTaxPercent: z.number().min(0).max(100).optional(),
  settlementDays: z.number().int().min(0).optional(),
});

export const CreateFinancialAccountSchema = z.strictObject({
  ...ContextFields,
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  accountType: FinancialAccountTypeSchema,
  currency: z.string().trim().length(3).toUpperCase().optional(),
  assignedBranchIds: z.array(z.string().trim().min(2)).max(100).optional(),
  bankDetails: BankDetailsInputSchema.optional(),
  feeRule: FeeRuleInputSchema.optional(),
  openingBalance: z.number().default(0).optional(),
  isDefault: z.boolean().default(false).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const UpdateFinancialAccountSchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  assignedBranchIds: z.array(z.string().trim().min(2)).max(100).optional(),
  bankDetails: BankDetailsInputSchema.optional(),
  feeRule: FeeRuleInputSchema.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const ListFinancialAccountsSchema = z.strictObject({
  ...ContextFields,
  accountType: FinancialAccountTypeSchema.optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetFinancialAccountSchema = getByIdSchema("financialAccountId");

export const GetAccountLedgerSchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().min(2),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD").optional(),
  type: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const CreateAccountTransferSchema = z.strictObject({
  ...ContextFields,
  sourceAccountId: z.string().trim().min(2),
  destinationAccountId: z.string().trim().min(2),
  amount: z.number().positive(),
  transferType: z.enum(["transfer", "cash_deposit", "cash_withdrawal", "inter_bank", "petty_cash", "cashier_handover", "settlement"]).default("transfer").optional(),
  mode: z.enum(["instant", "in_transit"]).default("instant").optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
}).refine((data) => data.sourceAccountId !== data.destinationAccountId, {
  message: "sourceAccountId and destinationAccountId must be different",
  path: ["destinationAccountId"],
});

export const ListAccountTransfersSchema = z.strictObject({
  ...ContextFields,
  sourceAccountId: z.string().trim().optional(),
  destinationAccountId: z.string().trim().optional(),
  status: z.enum(["pending_approval", "completed", "rejected", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetAccountTransferSchema = getByIdSchema("transferId");

// ============================================================
// Storage Locations Validation Schemas
// ============================================================

export const StorageLocationTypeSchema = z.enum(["warehouse", "stockyard", "counter", "backroom", "quarantine", "transit"]);

export const CreateStorageLocationSchema = z.strictObject({
  ...ContextFields,
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  type: StorageLocationTypeSchema,
  isDefault: z.boolean().default(false).optional(),
  address: AddressSchema.optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const UpdateStorageLocationSchema = z.strictObject({
  ...ContextFields,
  locationId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(100).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  address: AddressSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const ListStorageLocationsSchema = z.strictObject({
  ...ContextFields,
  type: StorageLocationTypeSchema.optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetStorageLocationSchema = getByIdSchema("locationId");

// ============================================================
// Stock Transfers Validation Schemas
// ============================================================

export const StockTransferLineInputSchema = z.strictObject({
  productId: z.string().trim().min(2),
  requestedQty: z.number().positive().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().min(1).max(30).default("piece").optional(),
  conversionFactor: z.number().positive().optional(),
  batchNumber: z.string().trim().max(100).optional(),
  expiryDate: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(200).optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
}).refine((data) => data.requestedQty !== undefined || data.quantity !== undefined, {
  message: "Either requestedQty or quantity must be provided",
});

export const CreateStockTransferSchema = z.strictObject({
  ...ContextFields,
  sourceBranchId: z.string().trim().min(2),
  destinationBranchId: z.string().trim().min(2),
  sourceLocationId: z.string().trim().min(2).optional(),
  destinationLocationId: z.string().trim().min(2).optional(),
  internal: z.boolean().optional(),
  items: z.array(StockTransferLineInputSchema).min(1).max(MAX_DOCUMENT_LINES),
  handlingFee: z.number().min(0).optional(),
  handlingFeeFinancialAccountId: z.string().trim().min(2).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const SubmitStockTransferSchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  version: z.number().int().min(0).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const CancelStockTransferSchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  reason: z.string().trim().max(500).optional(),
  version: z.number().int().min(0).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const DispatchStockTransferSchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  items: z.array(z.strictObject({
    productId: z.string().trim().min(2),
    dispatchedQty: z.number().positive(),
    serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
    batchNumber: z.string().trim().max(100).optional(),
    expiryDate: z.string().trim().max(50).optional(),
  })).min(1).max(MAX_DOCUMENT_LINES).optional(),
  transportMode: z.string().trim().max(100).optional(),
  trackingReference: z.string().trim().max(100).optional(),
  version: z.number().int().min(0).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ReceiveStockTransferSchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  destinationLocationId: z.string().trim().min(2).optional(),
  items: z.array(z.strictObject({
    productId: z.string().trim().min(2),
    receivedQty: z.number().min(0),
    rejectedQty: z.number().min(0).default(0).optional(),
    shortQty: z.number().min(0).default(0).optional(),
    discrepancyReason: z.string().trim().max(300).optional(),
    serialNumbers: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  })).min(1).max(MAX_DOCUMENT_LINES),
  version: z.number().int().min(0).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ResolveTransferDiscrepancySchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  productId: z.string().trim().min(2),
  resolution: z.enum(["return_to_source", "write_off", "claim_carrier"]),
  version: z.number().int().min(0).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const StockVerifySchema = z.strictObject({
  ...ContextFields,
  productId: z.string().trim().optional(),
  storageLocationId: z.string().trim().optional(),
});

export const ListStockTransfersSchema = z.strictObject({
  ...ContextFields,
  sourceBranchId: z.string().trim().optional(),
  destinationBranchId: z.string().trim().optional(),
  status: z.enum(["draft", "submitted", "approved", "dispatched", "received", "partially_received", "rejected", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetStockTransferSchema = getByIdSchema("transferId");

// ============================================================
// Approvals Inbox Validation Schemas
// ============================================================

export const ListApprovalsSchema = z.strictObject({
  ...ContextFields,
  documentType: z.enum(["bill", "outflow", "return", "stock_adjustment", "account_transfer", "stock_transfer", "account_entry"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetApprovalCountsSchema = z.strictObject({
  ...ContextFields,
});

// ============================================================
// Ageing Reports Validation Schemas
// ============================================================

export const GetReceivablesAgeingReportSchema = z.strictObject({
  ...ContextFields,
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must be YYYY-MM-DD").optional(),
  customerId: z.string().trim().optional(),
});

export const GetPayablesAgeingReportSchema = z.strictObject({
  ...ContextFields,
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must be YYYY-MM-DD").optional(),
  vendorId: z.string().trim().optional(),
});

// ============================================================
// Payment Processing Fees Validation Schemas
// ============================================================

export const RecordPaymentFeeSchema = z.strictObject({
  ...ContextFields,
  sourceDocumentType: z.enum(["bill", "payment"]),
  sourceDocumentId: z.string().trim().min(2),
  paymentId: z.string().trim().optional(),
  financialAccountId: z.string().trim().min(2),
  paymentMethod: z.nativeEnum(PaymentMethod),
  feeAmount: z.number().positive("Fee must be positive"),
  feeTaxAmount: z.number().min(0).default(0).optional(),
  settlementTiming: z.enum(["immediate_deduction", "billed_later"]).default("immediate_deduction"),
  settlementReference: z.string().trim().max(100).optional(),
  feeExpenseCategoryId: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ListPaymentFeesSchema = z.strictObject({
  ...ContextFields,
  sourceDocumentId: z.string().trim().optional(),
  paymentId: z.string().trim().optional(),
  financialAccountId: z.string().trim().optional(),
  status: z.enum(["expected", "pending_verification", "verified", "disputed", "reversed"]).optional(),
  highlight: z.enum(["needs_review"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetPaymentFeeSchema = getByIdSchema("feeId");

export const VerifyPaymentFeeSchema = z.strictObject({
  ...ContextFields,
  feeId: z.string().trim().min(2),
  settlementDate: z.string().trim().optional(),
  settlementReference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const DisputePaymentFeeSchema = z.strictObject({
  ...ContextFields,
  feeId: z.string().trim().min(2),
  reason: z.string().trim().min(3).max(500).describe("Dispute justification"),
});

export const ReversePaymentFeeSchema = z.strictObject({
  ...ContextFields,
  feeId: z.string().trim().min(2),
  reason: z.string().trim().min(3).max(500).describe("Reversal justification"),
});

export const LedgerVerifySchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().optional(),
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must be YYYY-MM-DD").optional(),
});

export const GetTrialBalanceSchema = z.strictObject({
  ...ContextFields,
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must be YYYY-MM-DD").optional(),
});

// ============================================================
// Capital Transactions Validation Schemas
// ============================================================

export const CreateCapitalTransactionSchema = z.strictObject({
  ...ContextFields,
  type: z.enum(["owner_contribution", "partner_contribution", "additional_capital", "drawings"]),
  financialAccountId: z.string().trim().min(2),
  amount: z.number().positive("Capital amount must be positive"),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  sourceReference: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  supportingDocumentPath: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ListCapitalTransactionsSchema = z.strictObject({
  ...ContextFields,
  type: z.enum(["owner_contribution", "partner_contribution", "additional_capital", "drawings"]).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

// ============================================================
// Cash & Bank Summary Validation Schemas
// ============================================================

export const GetCashBankSummarySchema = z.strictObject({
  ...ContextFields,
  includeInactive: z.boolean().default(false).optional(),
});

export const GetBranchSummarySchema = z.strictObject({
  ...ContextFields,
  branchId: z.string().trim().min(2).optional(),
  branchIds: z.array(z.string().trim().min(2)).max(50).optional(),
  scope: z.enum(["organization", "branch", "branches"]).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

// ============================================================
// Account Entries & Lifecycle Validation Schemas (U-2, U-3, U-15; D-F2..D-F4)
// ============================================================

export const ListAccountEntriesSchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().optional(),
  status: z.enum(["created", "added", "verified", "approved", "rejected", "reversed"]).optional(),
  needsReview: z.boolean().optional(),
  subEntryType: z.enum(["transaction_charge", "gateway_fee", "bank_charge", "adjustment", "rounding", "tip", "other"]).optional(),
  feeStatus: z.enum(["pending", "recorded", "waived", "disputed"]).optional(),
  parentEntryId: z.string().trim().optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetAccountEntrySchema = z.strictObject({
  ...ContextFields,
  entryId: z.string().trim().min(2),
});

export const GetAccountEntryCountsSchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().optional(),
});

export const VerifyAccountEntrySchema = z.strictObject({
  ...ContextFields,
  entryId: z.string().trim().min(2),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ApproveAccountEntrySchema = VerifyAccountEntrySchema;

export const RejectAccountEntrySchema = z.strictObject({
  ...ContextFields,
  entryId: z.string().trim().min(2),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ReverseAccountEntrySchema = RejectAccountEntrySchema;

export const UpdateAccountEntryNoteSchema = z.strictObject({
  ...ContextFields,
  entryId: z.string().trim().min(2),
  note: z.string().trim().min(1).max(500),
});

export const CreateSubEntrySchema = z.strictObject({
  ...ContextFields,
  parentEntryId: z.string().trim().min(2),
  subEntryType: z.enum(["transaction_charge", "gateway_fee", "bank_charge", "adjustment", "rounding", "tip", "other"]),
  amount: z.number().positive("Sub-entry amount must be positive"),
  financialAccountId: z.string().trim().optional(),
  direction: z.enum(["in", "out"]).optional(),
  notes: z.string().trim().max(500).optional(),
  description: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const RecordEntryFeeSchema = z.strictObject({
  ...ContextFields,
  entryId: z.string().trim().min(2),
  feeAmount: z.number().positive("Fee must be positive"),
  feeTaxAmount: z.number().min(0).default(0).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const GetAccountingPolicySchema = z.strictObject({
  ...ContextFields,
});

export const UpdateAccountingPolicySchema = z.strictObject({
  ...ContextFields,
  moneyConvention: z.literal("major").optional(),
  selfApprovalPolicy: z.enum(["off", "up_to_limit", "on"]).optional(),
  selfApprovalLimits: z.record(z.string(), z.number().min(0)).optional(),
  cashCountVarianceThreshold: z.number().min(0).optional(),
  roundingMode: z.enum(["half_up", "half_even"]).optional(),
  roundToNearestRupee: z.boolean().optional(),
  cashRoundingFils: z.boolean().optional(),
});

export const CreateCashCountSchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().min(2),
  denominations: z.record(z.string(), z.number().int().min(0)),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ListCashCountsSchema = z.strictObject({
  ...ContextFields,
  financialAccountId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  startAfterId: z.string().trim().optional(),
});

export const GetCashCountSchema = z.strictObject({
  ...ContextFields,
  countId: z.string().trim().min(2),
});

export const ConfirmAccountTransferSchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const DisputeAccountTransferSchema = z.strictObject({
  ...ContextFields,
  transferId: z.string().trim().min(2),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(128).optional(),
});


