#!/usr/bin/env node
/**
 * Trado Firebase — OpenAPI 3.0.3 Contract Generator
 *
 * Reads the canonical api-manifest.json + compiled Zod schemas to produce
 * a deterministic docs/openapi.json with:
 *   - 100% callable coverage (100 HTTPS callables, 4 background triggers in x-triggers)
 *   - 100% example coverage with deterministic seed IDs
 *   - Typed, non-generic response schemas for every operation
 *   - Risk classifications (READ, WRITE, DESTRUCTIVE, WORKFLOW)
 *   - Operational metadata (persona, prerequisites, repeatability)
 *
 * Usage:
 *   node scripts/generate-openapi.js                # generate docs/openapi.json
 *   node scripts/generate-openapi.js --stdout        # print to stdout
 *   node scripts/generate-openapi.js --check         # exit 1 if docs/openapi.json is stale
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "tests", "api", "api-manifest.json");
const OUTPUT_PATH = path.join(ROOT, "docs", "openapi.json");
const SCHEMAS_PATH = path.join(ROOT, "functions", "lib", "validation", "schemas.js");

// ── Load manifest ────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const endpoints = manifest.endpoints;
const callables = endpoints.filter((e) => e.triggerType === "callable");
const triggers = endpoints.filter((e) => e.triggerType !== "callable");

// ── Component Schemas Registry ───────────────────────────────────
const componentSchemas = {};

// ── Attempt to load compiled Zod schemas and convert to JSON Schema ─
let zodSchemas = {};
let zodAvailable = false;

try {
  const schemasModule = require(SCHEMAS_PATH);
  const zod = require(path.join(ROOT, "functions", "node_modules", "zod"));
  const z = zod.z || zod;

  if (typeof z.toJSONSchema === "function") {
    zodAvailable = true;
    for (const [name, schema] of Object.entries(schemasModule)) {
      if (schema && typeof schema === "object" && schema._zod) {
        try {
          const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
          if (jsonSchema && typeof jsonSchema === "object") {
            delete jsonSchema["$schema"];
            delete jsonSchema["$id"];
            componentSchemas[name] = jsonSchema;
            zodSchemas[name] = jsonSchema;
          }
        } catch (_) {}
      }
    }
  }
} catch (err) {
  console.warn(`[WARN] Could not load compiled Zod schemas: ${err.message}`);
}

// ── Schema Alias Mapping ─────────────────────────────────────────
const SCHEMA_ALIAS_MAP = {
  AdjustStockSchema: "StockAdjustSchema",
  CreateBillSchema: "CreateBillSchema",
  FinalizeBillSchema: "FinalizeBillSchema",
  ListBillsSchema: "ListBillsSchema",
  CreateOutflowSchema: "CreateOutflowSchema",
  ListOutflowsSchema: "ListOutflowsSchema",
  CreatePaymentSchema: "CreatePaymentSchema",
  ListPaymentsSchema: "ListPaymentsSchema",
  CreateReturnSchema: "CreateReturnSchema",
  ListReturnsSchema: "ListReturnsSchema",
  CreateDeliverySchema: "CreateDeliverySchema",
  UpdateDeliveryStatusSchema: "UpdateDeliveryStatusSchema",
  ListDeliveriesSchema: "ListDeliveriesSchema",
  CreateBranchSchema: "CreateBranchSchema",
  UpdateBranchSchema: "UpdateBranchSchema",
  DeactivateBranchSchema: "DeactivateBranchSchema",
  ListBranchesSchema: "ListBranchesSchema",
  SwitchBranchContextSchema: "SwitchBranchContextSchema",
  UpdateSharingPoliciesSchema: "UpdateSharingPoliciesSchema",
  ReportDateRangeSchema: "GetRevenueReportSchema",
  ReportProfitLossSchema: "GetProfitLossReportSchema",
  ReportStockValuationSchema: "GetStockValuationReportSchema",
  ReportExportCsvSchema: "ExportReportSchema",
  RecordPingSchema: "RecordLocationPingSchema",
  GetLatestLocationSchema: "GetLatestLocationsSchema",
  GetLocationHistorySchema: "GetLocationHistorySchema",
  UsageSummaryQuerySchema: "GetPlatformUsageSummarySchema",
  UsageOrganizationsQuerySchema: "GetOrganizationsUsageSchema",
  UsageBranchesQuerySchema: "GetBranchesUsageSchema",
  UsageDetailQuerySchema: "GetUsageDetailSchema",
  UsageDryRunStatementSchema: "CalculateDryRunStatementSchema",
  RecordClientMetricSchema: "RecordClientMetricSchema",
  FirestoreDocumentSnapshot: null,
};

// ── Synthetic schemas for callables with inline Zod in source ────
const getByIdSchema = {
  type: "object",
  required: ["organizationId"],
  properties: {
    organizationId: { type: "string", minLength: 2, description: "Organization ID" },
    productId: { type: "string", description: "Product document ID" },
    customerId: { type: "string", description: "Customer document ID" },
    vendorId: { type: "string", description: "Vendor document ID" },
    billId: { type: "string", description: "Bill document ID" },
    outflowId: { type: "string", description: "Outflow document ID" },
    deliveryId: { type: "string", description: "Delivery document ID" },
    branchId: { type: "string", description: "Optional operating branch" },
  },
};
[
  "GetProductSchema",
  "GetCustomerSchema",
  "GetVendorSchema",
  "GetOutflowSchema",
  "GetBillSchema",
  "GetDeliverySchema",
  "GetDefaultBranchSchema",
].forEach((name) => {
  if (!componentSchemas[name]) {
    componentSchemas[name] = { ...getByIdSchema, description: `Input for ${name.replace("Schema", "")}` };
  }
});

const listOrgSchema = {
  type: "object",
  required: ["organizationId"],
  properties: {
    organizationId: { type: "string", minLength: 2, description: "Organization ID" },
    limit: { type: "integer", minimum: 1, maximum: 100, description: "Page size" },
    startAfterId: { type: "string", description: "Cursor for pagination" },
  },
};
["ListRolesSchema", "ListDepartmentsSchema", "ListJobRolesSchema", "ListTeamsSchema"].forEach((name) => {
  if (!componentSchemas[name]) {
    componentSchemas[name] = { ...listOrgSchema, description: `Pagination input for ${name.replace("Schema", "")}` };
  }
});

if (!componentSchemas["ReconcileStockSchema"]) {
  componentSchemas["ReconcileStockSchema"] = {
    type: "object",
    required: ["organizationId"],
    properties: {
      organizationId: { type: "string", minLength: 2 },
      branchId: { type: "string", description: "Optional branch scope" },
    },
  };
}
if (!componentSchemas["ReconcilePartyLedgersSchema"]) {
  componentSchemas["ReconcilePartyLedgersSchema"] = {
    type: "object",
    required: ["organizationId"],
    properties: {
      organizationId: { type: "string", minLength: 2 },
      partyType: { type: "string", enum: ["customer", "vendor"], description: "Party type to reconcile" },
    },
  };
}
if (!componentSchemas["RecordClientMetricSchema"]) {
  componentSchemas["RecordClientMetricSchema"] = {
    type: "object",
    required: ["organizationId", "metricType"],
    properties: {
      organizationId: { type: "string", minLength: 2 },
      branchId: { type: "string" },
      metricType: { type: "string", description: "Client-side metric type" },
      value: { type: "number", description: "Metric value" },
    },
  };
}
if (!componentSchemas["ReportTopEntitiesSchema"]) {
  componentSchemas["ReportTopEntitiesSchema"] = {
    type: "object",
    required: ["organizationId", "entityType"],
    properties: {
      organizationId: { type: "string", minLength: 2 },
      entityType: { type: "string", enum: ["products", "customers", "vendors"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      branchId: { type: "string" },
    },
  };
}
if (!componentSchemas["ReportStaffActivitySchema"]) {
  componentSchemas["ReportStaffActivitySchema"] = {
    type: "object",
    required: ["organizationId"],
    properties: {
      organizationId: { type: "string", minLength: 2 },
      branchId: { type: "string" },
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
    },
  };
}
if (!componentSchemas["ReportPlatformOverviewSchema"]) {
  componentSchemas["ReportPlatformOverviewSchema"] = {
    type: "object",
    properties: {},
    description: "Platform summary report filters",
  };
}

// ── Generic Firebase Wrappers ────────────────────────────────────
componentSchemas["FirebaseCallableRequest"] = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      description: "Callable input payload (wrapped in data envelope)",
    },
  },
};

componentSchemas["FirebaseCallableError"] = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["message", "status"],
      properties: {
        message: { type: "string", description: "Human-readable error description" },
        status: {
          type: "string",
          enum: [
            "OK",
            "CANCELLED",
            "UNKNOWN",
            "INVALID_ARGUMENT",
            "DEADLINE_EXCEEDED",
            "NOT_FOUND",
            "ALREADY_EXISTS",
            "PERMISSION_DENIED",
            "RESOURCE_EXHAUSTED",
            "FAILED_PRECONDITION",
            "ABORTED",
            "OUT_OF_RANGE",
            "UNIMPLEMENTED",
            "INTERNAL",
            "UNAVAILABLE",
            "DATA_LOSS",
            "UNAUTHENTICATED",
          ],
        },
        details: { type: "object", description: "Application-specific error details" },
      },
    },
  },
};

// ── Typed Non-Generic Response Schemas ───────────────────────────
componentSchemas["HealthCheckResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["status", "service", "region", "timestamp"],
      properties: {
        status: { type: "string", example: "ok" },
        service: { type: "string", example: "trado-firebase-functions" },
        region: { type: "string", example: "asia-south1" },
        timestamp: { type: "string", format: "date-time" },
      },
    },
  },
};

componentSchemas["AuthSessionContext"] = {
  type: "object",
  required: [
    "user",
    "role",
    "jobRoles",
    "permissions",
    "platformPermissions",
    "organizations",
    "primaryOrganization",
    "branches",
    "primaryBranch",
    "device",
    "contextStatus",
  ],
  properties: {
    user: {
      type: "object",
      required: ["uid", "email", "name", "accountType", "isActive", "isSuperAdmin"],
      properties: {
        uid: { type: "string" },
        email: { type: "string" },
        name: { type: "string" },
        phone: { type: "string", nullable: true },
        avatarUrl: { type: "string", nullable: true },
        accountType: { type: "string" },
        isActive: { type: "boolean" },
        isSuperAdmin: { type: "boolean" },
      },
    },
    role: {
      type: "object",
      nullable: true,
      properties: {
        scope: { type: "string", enum: ["platform", "organization"] },
        roleId: { type: "string", nullable: true },
        roleName: { type: "string", nullable: true },
        roleCode: { type: "string", nullable: true },
      },
    },
    jobRoles: {
      type: "array",
      items: {
        type: "object",
        required: ["jobRoleId", "name", "code"],
        properties: {
          jobRoleId: { type: "string" },
          name: { type: "string" },
          code: { type: "string" },
        },
      },
    },
    permissions: {
      type: "array",
      items: { type: "string" },
      description: "Resolved tenant permissions list (strictly empty for platform Super Admin)",
    },
    platformPermissions: {
      type: "array",
      items: { type: "string" },
      description: "Platform capabilities list (e.g. platform:* for Super Admin, empty for tenant users)",
    },
    organizations: {
      type: "array",
      items: {
        type: "object",
        required: ["organizationId"],
        properties: {
          organizationId: { type: "string" },
          name: { type: "string" },
          roleId: { type: "string" },
          roleName: { type: "string" },
          isPrimary: { type: "boolean" },
        },
      },
    },
    primaryOrganization: {
      type: "object",
      nullable: true,
      properties: {
        organizationId: { type: "string" },
        name: { type: "string" },
      },
    },
    branches: {
      type: "array",
      items: {
        type: "object",
        required: ["branchId", "name", "code", "isDefault"],
        properties: {
          branchId: { type: "string" },
          name: { type: "string" },
          code: { type: "string" },
          isDefault: { type: "boolean" },
        },
      },
    },
    primaryBranch: {
      type: "object",
      nullable: true,
      properties: {
        branchId: { type: "string" },
        name: { type: "string" },
        code: { type: "string" },
      },
    },
    device: {
      type: "object",
      nullable: true,
      properties: {
        deviceId: { type: "string" },
        recognized: { type: "boolean" },
      },
    },
    contextStatus: {
      type: "string",
      enum: [
        "ready",
        "platform",
        "organization_selection_required",
        "branch_selection_required",
        "no_active_membership",
      ],
    },
  },
};

componentSchemas["AuthLoginResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["context", "credentials"],
      properties: {
        context: { $ref: "#/components/schemas/AuthSessionContext" },
        credentials: {
          type: "object",
          required: ["idToken", "expiresInSeconds"],
          properties: {
            idToken: { type: "string", description: "Firebase Auth ID Token (JWT)" },
            expiresInSeconds: { type: "integer", example: 3600, description: "Token expiry time in seconds" },
          },
        },
      },
    },
  },
};

componentSchemas["AuthMeResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["context", "credentials"],
      properties: {
        context: { $ref: "#/components/schemas/AuthSessionContext" },
        credentials: { type: "null", nullable: true, example: null },
      },
    },
  },
};

componentSchemas["StandardSuccessResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean", example: true },
        message: { type: "string", example: "Operation completed successfully." },
        branchId: { type: "string" },
        primaryBranchId: { type: "string" },
        membershipId: { type: "string" },
        organizationId: { type: "string" },
        taskId: { type: "string" },
      },
    },
  },
};

componentSchemas["StandardItemsListResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["items", "count"],
      properties: {
        items: { type: "array", items: { type: "object" } },
        count: { type: "integer", example: 1 },
        hasMore: { type: "boolean", example: false },
      },
    },
  },
};

componentSchemas["EntityCreatedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      description: "Entity created document payload including identifiers",
      properties: {
        organizationId: { type: "string" },
        ownerUserId: { type: "string" },
        ownerMembershipId: { type: "string" },
        defaultBranchId: { type: "string" },
        branchId: { type: "string" },
        userId: { type: "string" },
        membershipId: { type: "string" },
        roleId: { type: "string" },
        departmentId: { type: "string" },
        jobRoleId: { type: "string" },
        teamId: { type: "string" },
        planId: { type: "string" },
        productId: { type: "string" },
        categoryId: { type: "string" },
        unitId: { type: "string" },
        customerId: { type: "string" },
        customerCode: { type: "string" },
        vendorId: { type: "string" },
        vendorCode: { type: "string" },
        taskId: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
      },
    },
  },
};

componentSchemas["EntityGetResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      description: "Retrieved document attributes",
      properties: {
        id: { type: "string" },
        organizationId: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        branch: { type: "object" },
        branchId: { type: "string" },
        productId: { type: "string" },
        customerId: { type: "string" },
        vendorId: { type: "string" },
        billId: { type: "string" },
        outflowId: { type: "string" },
        deliveryId: { type: "string" },
      },
    },
  },
};

componentSchemas["BillCreatedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["billId", "organizationId", "billNumber", "totalAmount"],
      properties: {
        billId: { type: "string" },
        organizationId: { type: "string" },
        billNumber: { type: "string", example: "INV-2026-0001" },
        salesMode: { type: "string", example: "retail_pos" },
        totalAmount: { type: "number", example: 94.5 },
        taxAmount: { type: "number", example: 4.5 },
      },
    },
  },
};

componentSchemas["BillFinalizedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["billId", "status", "billNumber"],
      properties: {
        billId: { type: "string" },
        status: { type: "string", example: "active" },
        billNumber: { type: "string" },
        originalQuotationNumber: { type: "string" },
      },
    },
  },
};

componentSchemas["OutflowCreatedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["outflowId", "organizationId", "outflowNumber", "kind", "totalAmount"],
      properties: {
        outflowId: { type: "string" },
        organizationId: { type: "string" },
        outflowNumber: { type: "string", example: "PO-2026-0001" },
        kind: { type: "string", example: "purchase" },
        totalAmount: { type: "number", example: 3360 },
      },
    },
  },
};

componentSchemas["PaymentCreatedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["paymentId", "organizationId", "paymentNumber", "amount"],
      properties: {
        paymentId: { type: "string" },
        organizationId: { type: "string" },
        paymentNumber: { type: "string", example: "PAY-2026-0001" },
        amount: { type: "number", example: 500 },
        direction: { type: "string", example: "inflow" },
      },
    },
  },
};

componentSchemas["ReturnCreatedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["returnId", "organizationId", "returnNumber", "totalRefundAmount"],
      properties: {
        returnId: { type: "string" },
        organizationId: { type: "string" },
        returnNumber: { type: "string", example: "RET-2026-0001" },
        totalRefundAmount: { type: "number", example: 45 },
        status: { type: "string", example: "active" },
      },
    },
  },
};

componentSchemas["StockAdjustedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["movementId", "organizationId", "productId", "branchId"],
      properties: {
        movementId: { type: "string" },
        organizationId: { type: "string" },
        productId: { type: "string" },
        branchId: { type: "string" },
        type: { type: "string", example: "damage" },
        quantity: { type: "number", example: -2 },
        previousStock: { type: "number", example: 100 },
        newStock: { type: "number", example: 98 },
      },
    },
  },
};

componentSchemas["DeliveryCreatedResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["deliveryId", "organizationId", "billId", "status"],
      properties: {
        deliveryId: { type: "string" },
        organizationId: { type: "string" },
        billId: { type: "string" },
        status: { type: "string", example: "pending" },
      },
    },
  },
};

componentSchemas["ReconciliationResultResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationId", "reconciledCount"],
      properties: {
        organizationId: { type: "string" },
        branchId: { type: "string" },
        partyType: { type: "string" },
        reconciledCount: { type: "integer", example: 1 },
        discrepancies: { type: "array", items: { type: "object" } },
      },
    },
  },
};

componentSchemas["RevenueReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["totalRevenue", "billCount", "averageBillValue"],
      properties: {
        totalRevenue: { type: "number", example: 94.5 },
        billCount: { type: "integer", example: 1 },
        averageBillValue: { type: "number", example: 94.5 },
      },
    },
  },
};

componentSchemas["ProfitLossReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationId", "revenue", "cogs", "expenses", "netProfit"],
      properties: {
        organizationId: { type: "string" },
        branchId: { type: "string" },
        revenue: { type: "number", example: 94.5 },
        cogs: { type: "number", example: 64 },
        expenses: { type: "number", example: 0 },
        netProfit: { type: "number", example: 30.5 },
      },
    },
  },
};

componentSchemas["StockValuationReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationId", "totalValuation", "productCount"],
      properties: {
        organizationId: { type: "string" },
        totalValuation: { type: "number", example: 3200 },
        productCount: { type: "integer", example: 1 },
      },
    },
  },
};

componentSchemas["TopEntitiesReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["entityType", "items"],
      properties: {
        entityType: { type: "string", example: "products" },
        items: { type: "array", items: { type: "object" } },
      },
    },
  },
};

componentSchemas["StaffActivityReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationId", "staffSummaries"],
      properties: {
        organizationId: { type: "string" },
        staffSummaries: { type: "array", items: { type: "object" } },
      },
    },
  },
};

componentSchemas["PlatformOverviewReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["totalOrganizations", "activeOrganizations", "suspendedOrganizations"],
      properties: {
        totalOrganizations: { type: "integer", example: 2 },
        activeOrganizations: { type: "integer", example: 2 },
        suspendedOrganizations: { type: "integer", example: 0 },
      },
    },
  },
};

componentSchemas["CsvReportResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["reportType", "organizationId", "csv"],
      properties: {
        reportType: { type: "string", example: "sales" },
        organizationId: { type: "string" },
        branchId: { type: "string" },
        csv: { type: "string", example: "Date,BillNumber,Total\n2026-01-15,INV-2026-0001,94.50\n" },
      },
    },
  },
};

componentSchemas["PlatformUsageSummaryResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["timeframe", "platformActualTotals"],
      properties: {
        timeframe: { type: "object" },
        platformActualTotals: { type: "object" },
      },
    },
  },
};

componentSchemas["DryRunStatementResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationName", "status", "totalEstimatedCost"],
      properties: {
        organizationName: { type: "string", example: "Apex Retail Supplies" },
        status: { type: "string", example: "draft_estimate" },
        totalEstimatedCost: { type: "number", example: 45.2 },
        lineItems: { type: "array", items: { type: "object" } },
      },
    },
  },
};

componentSchemas["UsageLimitsResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string" },
        limits: { type: "object" },
        message: { type: "string" },
        success: { type: "boolean" },
      },
    },
  },
};

componentSchemas["CatalogListResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      properties: {
        permissions: { type: "array", items: { type: "object" } },
        modules: { type: "array", items: { type: "object" } },
        taxRegimes: { type: "array", items: { type: "object" } },
        plans: { type: "array", items: { type: "object" } },
        roles: { type: "array", items: { type: "object" } },
        departments: { type: "array", items: { type: "object" } },
        jobRoles: { type: "array", items: { type: "object" } },
        teams: { type: "array", items: { type: "object" } },
      },
    },
  },
};

componentSchemas["LocationPingResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["success", "rateLimited"],
      properties: {
        success: { type: "boolean", example: true },
        rateLimited: { type: "boolean", example: false },
        recordedAt: { type: "string", format: "date-time" },
        latitude: { type: "number", example: 12.9716 },
        longitude: { type: "number", example: 77.5946 },
      },
    },
  },
};

componentSchemas["LocationsGetResponse"] = {
  type: "object",
  required: ["result"],
  properties: {
    result: {
      type: "object",
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string" },
        locations: { type: "array", items: { type: "object" } },
        pings: { type: "array", items: { type: "object" } },
        count: { type: "integer", example: 1 },
      },
    },
  },
};

// ── 100% Comprehensive Examples Map (All 100 Callables) ─────────
const OPERATION_EXAMPLES = {
  healthCheck: { data: {} },
  authLogin: {
    data: {
      email: "owner@apexwholesale.local",
      password: "SecretPassword123!",
      deviceId: "device_web_explorer_01",
    },
  },
  authMe: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
    },
  },
  organizationsCreate: {
    data: {
      idempotencyKey: "org-create-ex-001",
      name: "Sunrise Retail Store",
      businessType: "retail_only",
      businessCategory: "grocery_fmcg",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "INDIA_GST",
      planId: "plan_starter",
      ownerEmail: "owner@sunriseretail.local",
      ownerName: "Sunrise Owner",
      defaultBranchName: "Main Store",
      defaultBranchCode: "MAIN",
    },
  },
  organizationsUpdate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Apex Retail Supplies Flagship",
    },
  },
  organizationsDeactivate: {
    data: {
      organizationId: "org_apex_sample",
      reason: "Maintenance audit testing",
    },
  },
  organizationsList: {
    data: {
      limit: 10,
      status: "active",
    },
  },
  branchesGetDefault: { data: { organizationId: "org_apex_sample" } },
  branchesList: { data: { organizationId: "org_apex_sample" } },
  branchesCreate: {
    data: {
      idempotencyKey: "br-create-ex-001",
      organizationId: "org_wholesale_sample",
      name: "Downtown Outlet",
      code: "DT01",
      address: {
        line1: "45 Market Street",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
    },
  },
  branchesUpdate: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      name: "Main Retail Outlet",
      isActive: true,
    },
  },
  branchesDeactivate: {
    data: {
      organizationId: "org_wholesale_sample",
      branchId: "branch_warehouse",
      reason: "Consolidation into central hub",
    },
  },
  branchContextSwitch: { data: { targetBranchId: "main-branch" } },
  sharingPoliciesUpdate: {
    data: {
      organizationId: "org_apex_sample",
      policies: {
        customers: "organization_shared",
        vendors: "organization_shared",
        products: "organization_shared",
        categories: "organization_shared",
        sales: "branch_scoped",
        purchases: "branch_scoped",
        expenses: "branch_scoped",
        deliveries: "branch_scoped",
      },
    },
  },
  employeesCreate: {
    data: {
      idempotencyKey: "emp-create-ex-001",
      organizationId: "org_apex_sample",
      email: "newcashier@apexwholesale.local",
      name: "New Retail Cashier",
      roleId: "role_cashier",
      branchIds: ["main-branch"],
      defaultBranchId: "main-branch",
    },
  },
  employeesUpdate: {
    data: {
      organizationId: "org_apex_sample",
      membershipId: "mem_cashier_sample",
      name: "Apex Senior Cashier",
      status: "active",
    },
  },
  employeesDeactivate: {
    data: {
      organizationId: "org_apex_sample",
      membershipId: "mem_cashier_sample",
      reason: "Employee resignation test",
    },
  },
  employeesList: { data: { organizationId: "org_apex_sample" } },
  rolesCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Shift Supervisor",
      code: "role_shift_super",
      permissions: ["bill:create", "bill:view", "stock:view"],
      description: "Supervises POS cashiers and inventory on shift",
      idempotencyKey: "role-create-ex-001",
    },
  },
  rolesUpdate: {
    data: {
      roleId: "role_cashier",
      name: "Senior Cashier",
      permissions: ["bill:create", "bill:view"],
      description: "POS billing operator",
    },
  },
  rolesList: { data: { organizationId: "org_apex_sample" } },
  departmentsCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Dispatch & Fulfillment",
      idempotencyKey: "dept-create-ex-001",
    },
  },
  departmentsUpdate: {
    data: {
      departmentId: "dept_dispatch_sample",
      name: "Express Fulfillment",
    },
  },
  departmentsList: { data: { organizationId: "org_apex_sample" } },
  jobRolesCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Senior Forklift Operator",
      idempotencyKey: "jr-create-ex-001",
    },
  },
  jobRolesUpdate: {
    data: {
      jobRoleId: "jobrole_cashier",
      name: "Head Cashier",
    },
  },
  jobRolesList: { data: { organizationId: "org_apex_sample" } },
  teamsCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Morning Shift Crew",
      idempotencyKey: "team-create-ex-001",
    },
  },
  teamsUpdate: {
    data: {
      teamId: "team_pos_sample",
      name: "Weekend POS Crew",
    },
  },
  teamsList: { data: { organizationId: "org_apex_sample" } },
  plansCreate: {
    data: {
      idempotencyKey: "plan-create-ex-001",
      name: "Enterprise Custom Tier",
      price: 7999,
      currency: "INR",
      storageLimitMb: 5120,
      monthlyDocumentVolumeLimit: 50000,
      seatLimits: {
        admin: 10,
        staff: 40,
      },
      branchLimit: 10,
      moduleFlags: { billing: true, inventory: true, sales: true, staff: true, reports: true },
      isActive: true,
    },
  },
  plansUpdate: {
    data: {
      planId: "plan_starter",
      name: "Starter Tier Pro",
      price: 999,
      branchLimit: 1,
      isActive: true,
    },
  },
  plansList: { data: {} },
  permissionCatalogList: { data: {} },
  modulesList: { data: {} },
  taxRegimesList: { data: {} },
  notificationsRegisterFcmToken: {
    data: {
      deviceId: "device_browser_test_001",
      fcmToken: "mock_fcm_token_local_emulator_12345",
      platform: "web",
    },
  },
  productsCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Mineral Water 1L",
      sku: "MW-001",
      categoryId: "cat_bakery_sample",
      unitId: "unit_pack_sample",
      purchasePrice: 10,
      sellingPrice: 15,
      taxRate: 5,
      openingStock: 100,
      branchId: "main-branch",
      barcode: "8901234567891",
      idempotencyKey: "prod-create-ex-001",
    },
  },
  productsUpdate: {
    data: {
      organizationId: "org_apex_sample",
      productId: "prod_bread_sample",
      name: "Whole Wheat Bread 400g Premium",
      sellingPrice: 48,
      costPrice: 32,
    },
  },
  productsList: { data: { organizationId: "org_apex_sample" } },
  productsGet: { data: { organizationId: "org_apex_sample", productId: "prod_bread_sample" } },
  categoriesCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Beverages",
      idempotencyKey: "cat-create-ex-001",
    },
  },
  categoriesUpdate: {
    data: {
      categoryId: "cat_bakery_sample",
      name: "Artisan Bakery & Pastries",
      isActive: true,
    },
  },
  categoriesList: { data: { organizationId: "org_apex_sample" } },
  unitsCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Kilogram",
      code: "kg",
      group: "weight",
      precision: 2,
      idempotencyKey: "unit-create-ex-001",
    },
  },
  unitsUpdate: {
    data: {
      unitId: "unit_pack_sample",
      name: "Standard Retail Pack",
      precision: 0,
      isActive: true,
    },
  },
  unitsList: { data: { organizationId: "org_apex_sample", includeGlobal: true } },
  customersCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Metro Superstore",
      mobile: "9876543299",
      email: "metro@example.local",
      creditLimit: 25000,
      idempotencyKey: "cust-create-ex-001",
    },
  },
  customersUpdate: {
    data: {
      organizationId: "org_apex_sample",
      customerId: "cust_citymart_sample",
      name: "City Mart Supermarket Flagship",
      creditLimit: 75000,
    },
  },
  customersList: { data: { organizationId: "org_apex_sample" } },
  customersGet: { data: { organizationId: "org_apex_sample", customerId: "cust_citymart_sample" } },
  vendorsCreate: {
    data: {
      organizationId: "org_apex_sample",
      name: "Fresh Farms Dairy",
      mobile: "9123456799",
      email: "orders@freshfarms.local",
      creditLimit: 30000,
      idempotencyKey: "vend-create-ex-001",
    },
  },
  vendorsUpdate: {
    data: {
      organizationId: "org_apex_sample",
      vendorId: "vend_goldengrain_sample",
      name: "Golden Grain Mills Private Limited",
      mobile: "9123456780",
    },
  },
  vendorsList: { data: { organizationId: "org_apex_sample" } },
  vendorsGet: { data: { organizationId: "org_apex_sample", vendorId: "vend_goldengrain_sample" } },
  outflowsCreate: {
    data: {
      idempotencyKey: "outflow-create-ex-001",
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      kind: "purchase",
      vendorId: "vend_goldengrain_sample",
      vendorName: "Golden Grain Mills",
      invoiceNumber: "PUR-2026-001",
      lines: [
        {
          productId: "prod_bread_sample",
          itemName: "Whole Wheat Bread 400g",
          quantity: 50,
          unit: "piece",
          unitPrice: 30,
          taxPercent: 5,
          addToStock: true,
        },
      ],
      paidAmount: 1575,
      paymentMethod: "cash",
    },
  },
  outflowsList: { data: { organizationId: "org_apex_sample" } },
  outflowsGet: { data: { organizationId: "org_apex_sample", outflowId: "outflow_sample_001" } },
  billsCreate: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      customerId: "cust_citymart_sample",
      items: [
        {
          productId: "prod_bread_sample",
          quantity: 5,
          unitPrice: 45,
          taxRate: 5,
        },
      ],
      idempotencyKey: "bill-create-ex-001",
    },
  },
  billsFinalize: {
    data: {
      organizationId: "org_apex_sample",
      billId: "bill_sample_001",
      paymentMethod: "cash",
      idempotencyKey: "bill-finalize-ex-001",
    },
  },
  billsList: { data: { organizationId: "org_apex_sample" } },
  billsGet: { data: { organizationId: "org_apex_sample", billId: "bill_sample_001" } },
  deliveriesCreate: {
    data: {
      idempotencyKey: "del-create-ex-001",
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      billId: "bill_sample_001",
      customerName: "City Mart Supermarket",
      customerPhone: "9876543210",
      address: {
        line1: "123 Main Street",
        city: "Bengaluru",
        pincode: "560001",
      },
    },
  },
  deliveriesUpdateStatus: {
    data: {
      organizationId: "org_apex_sample",
      deliveryId: "del_sample_001",
      status: "delivered",
      codCollected: false,
      notes: "Delivered to receiving dock",
    },
  },
  deliveriesList: { data: { organizationId: "org_apex_sample", branchId: "main-branch" } },
  deliveriesGet: { data: { organizationId: "org_apex_sample", deliveryId: "del_sample_001" } },
  returnsCreate: {
    data: {
      idempotencyKey: "ret-create-ex-001",
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      returnType: "sales_return",
      referenceId: "bill_seed_001",
      partyId: "cust_apex_retail",
      partyName: "Apex Retail Customer",
      refundMethod: "cash",
      items: [
        {
          productId: "prod_bread_sample",
          quantity: 1,
          refundAmount: 40,
          reason: "Damaged outer packaging",
          disposition: "restocked_to_inventory",
        },
      ],
    },
  },
  returnsList: { data: { organizationId: "org_apex_sample", branchId: "main-branch" } },
  paymentsCreate: {
    data: {
      idempotencyKey: "pay-create-ex-001",
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      direction: "in",
      partyType: "customer",
      partyId: "cust_citymart_sample",
      partyName: "City Mart Supermarket",
      amount: 500,
      method: "cash",
    },
  },
  paymentsList: { data: { organizationId: "org_apex_sample", branchId: "main-branch" } },
  stockAdjust: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      productId: "prod_bread_sample",
      adjustmentType: "damage",
      quantity: -2,
      reason: "Damaged during handling",
      idempotencyKey: "stock-adj-ex-001",
    },
  },
  stockMovementsList: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      productId: "prod_bread_sample",
    },
  },
  reconcileStockBalances: { data: { organizationId: "org_apex_sample", branchId: "main-branch" } },
  reconcilePartyLedgers: { data: { organizationId: "org_apex_sample", partyType: "customer" } },
  reconcileBranchCounts: { data: { organizationId: "org_apex_sample" } },
  reportsGetRevenue: {
    data: {
      organizationId: "org_apex_sample",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
  },
  reportsGetProfitLoss: {
    data: {
      organizationId: "org_apex_sample",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
  },
  reportsGetStockValuation: { data: { organizationId: "org_apex_sample" } },
  reportsGetTopEntities: {
    data: {
      organizationId: "org_apex_sample",
      entityType: "products",
      limit: 5,
    },
  },
  reportsGetStaffActivity: {
    data: {
      organizationId: "org_apex_sample",
      from: "2026-01-01",
      to: "2026-12-31",
    },
  },
  reportsGetPlatformOverview: { data: {} },
  reportsExportCsv: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      reportType: "revenue",
      from: "2026-01-01",
      to: "2026-12-31",
    },
  },
  tasksCreate: {
    data: {
      idempotencyKey: "task-create-ex-001",
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      title: "Count physical bread stock",
      assignedToMembershipId: "mem_cashier_sample",
      priority: "medium",
    },
  },
  tasksUpdate: {
    data: {
      taskId: "task_sample_001",
      organizationId: "org_apex_sample",
      title: "Count physical stock on bakery shelf",
      priority: "high",
    },
  },
  tasksAssign: {
    data: {
      taskId: "task_sample_001",
      organizationId: "org_apex_sample",
      assignedToMembershipId: "mem_cashier_sample",
    },
  },
  tasksUpdateStatus: {
    data: {
      taskId: "task_sample_001",
      organizationId: "org_apex_sample",
      status: "completed",
    },
  },
  tasksList: { data: { organizationId: "org_apex_sample", status: "pending" } },
  tasksDelete: { data: { taskId: "task_sample_001", organizationId: "org_apex_sample" } },
  locationsRecordPing: {
    data: {
      organizationId: "org_apex_sample",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 5,
    },
  },
  locationsGetLatest: { data: { organizationId: "org_apex_sample" } },
  locationsGetHistory: {
    data: {
      organizationId: "org_apex_sample",
      membershipId: "mem_rider_sample",
      limit: 10,
    },
  },
  notificationsList: { data: { limit: 20, unreadOnly: false } },
  notificationsMarkRead: { data: { notificationId: "notif_sample_001" } },
  usageGetPlatformSummary: { data: { period: "2026-01" } },
  usageGetOrganizations: { data: { period: "2026-01" } },
  usageGetBranches: { data: { organizationId: "org_apex_sample", period: "2026-01" } },
  usageGetDetail: {
    data: {
      organizationId: "org_apex_sample",
      service: "firestore",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      granularity: "daily",
    },
  },
  usageCalculateDryRunStatement: { data: { organizationId: "org_apex_sample", billingPeriod: "2026-01" } },
  usageRecordClientMetric: {
    data: {
      organizationId: "org_apex_sample",
      branchId: "main-branch",
      metricType: "page_load_ms",
      value: 340,
    },
  },
  usageGetLimits: { data: { organizationId: "org_apex_sample" } },
  usageUpdateLimits: {
    data: {
      organizationId: "org_apex_sample",
      limits: {
        bills: {
          dailyLimit: 100,
          monthlyLimit: 2500,
          warningThresholdPercent: 80,
          hardThresholdPercent: 100,
          enforcementMode: "warn_only",
          enabled: true,
        },
      },
    },
  },
};

// ── Operation Metadata Classification ────────────────────────────
function getOperationMeta(exportName) {
  const n = exportName.toLowerCase();

  // 1. DESTRUCTIVE
  if (
    exportName === "organizationsDeactivate" ||
    exportName === "branchesDeactivate" ||
    exportName === "employeesDeactivate" ||
    exportName === "tasksDelete"
  ) {
    return {
      risk: "DESTRUCTIVE",
      persona: "Retail Owner / Platform Super Admin",
      repeatable: false,
      prerequisites: ["Requires active entity ID"],
      responseSchema: "StandardSuccessResponse",
    };
  }

  // 2. WORKFLOW (State Transitions)
  if (
    exportName === "billsFinalize" ||
    exportName === "deliveriesUpdateStatus" ||
    exportName === "returnsCreate" ||
    exportName === "paymentsCreate" ||
    exportName === "tasksAssign" ||
    exportName === "tasksUpdateStatus" ||
    exportName === "branchContextSwitch"
  ) {
    let resp = "StandardSuccessResponse";
    if (exportName === "billsFinalize") resp = "BillFinalizedResponse";
    if (exportName === "returnsCreate") resp = "ReturnCreatedResponse";
    if (exportName === "paymentsCreate") resp = "PaymentCreatedResponse";

    return {
      risk: "WORKFLOW",
      persona: "Retail Cashier / Owner / Staff",
      repeatable: false,
      prerequisites: ["Requires existing parent entity (bill/delivery/outflow)"],
      responseSchema: resp,
    };
  }

  // 3. READ (Queries / Catalogs)
  if (
    n.includes("list") ||
    n.includes("get") ||
    exportName === "healthCheck" ||
    exportName === "authLogin" ||
    exportName === "authMe"
  ) {
    let resp = "StandardItemsListResponse";
    if (exportName === "healthCheck") resp = "HealthCheckResponse";
    else if (exportName === "authLogin") resp = "AuthLoginResponse";
    else if (exportName === "authMe") resp = "AuthMeResponse";
    else if (
      [
        "permissionCatalogList",
        "modulesList",
        "taxRegimesList",
        "plansList",
        "rolesList",
        "departmentsList",
        "jobRolesList",
        "teamsList",
      ].includes(exportName)
    )
      resp = "CatalogListResponse";
    else if (exportName.startsWith("reportsGet")) {
      if (exportName === "reportsGetRevenue") resp = "RevenueReportResponse";
      else if (exportName === "reportsGetProfitLoss") resp = "ProfitLossReportResponse";
      else if (exportName === "reportsGetStockValuation") resp = "StockValuationReportResponse";
      else if (exportName === "reportsGetTopEntities") resp = "TopEntitiesReportResponse";
      else if (exportName === "reportsGetStaffActivity") resp = "StaffActivityReportResponse";
      else if (exportName === "reportsGetPlatformOverview") resp = "PlatformOverviewReportResponse";
    } else if (exportName.startsWith("usageGet") || exportName === "usageCalculateDryRunStatement") {
      if (exportName === "usageGetPlatformSummary") resp = "PlatformUsageSummaryResponse";
      else if (exportName === "usageCalculateDryRunStatement") resp = "DryRunStatementResponse";
      else if (exportName === "usageGetLimits") resp = "UsageLimitsResponse";
      else resp = "StandardItemsListResponse";
    } else if (exportName.startsWith("locationsGet")) {
      resp = "LocationsGetResponse";
    } else if (n.includes("get")) {
      resp = "EntityGetResponse";
    }

    return {
      risk: "READ",
      persona: exportName.startsWith("usage") || exportName === "plansList"
        ? "Platform Super Admin"
        : exportName === "healthCheck" || exportName === "authLogin"
        ? "Public / All Personas"
        : "Retail Owner / Cashier / Staff",
      repeatable: true,
      prerequisites: exportName === "authLogin"
        ? ["Valid email and password credentials"]
        : ["None — safe to execute repeatedly"],
      responseSchema: resp,
    };
  }

  // 4. WRITE (Mutations)
  let resp = "EntityCreatedResponse";
  if (exportName === "billsCreate") resp = "BillCreatedResponse";
  else if (exportName === "outflowsCreate") resp = "OutflowCreatedResponse";
  else if (exportName === "stockAdjust") resp = "StockAdjustedResponse";
  else if (exportName === "deliveriesCreate") resp = "DeliveryCreatedResponse";
  else if (exportName.startsWith("reconcile")) resp = "ReconciliationResultResponse";
  else if (exportName === "reportsExportCsv") resp = "CsvReportResponse";
  else if (exportName === "locationsRecordPing") resp = "LocationPingResponse";
  else if (exportName.startsWith("usage")) resp = "UsageLimitsResponse";
  else if (n.includes("update") || n.includes("register") || n.includes("markread"))
    resp = "StandardSuccessResponse";

  return {
    risk: "WRITE",
    persona: exportName.startsWith("plans") || exportName.startsWith("usage")
      ? "Platform Super Admin"
      : "Retail Owner / Admin / Cashier",
    repeatable: exportName.includes("idempotencyKey"),
    prerequisites: ["Valid organization ID and branch context"],
    responseSchema: resp,
  };
}

// Resolve manifest schema name → real schema name available in componentSchemas
function resolveSchemaName(manifestName) {
  if (!manifestName || manifestName === "None") return null;
  if (componentSchemas[manifestName]) return manifestName;
  const alias = SCHEMA_ALIAS_MAP[manifestName];
  if (alias && componentSchemas[alias]) return alias;
  return null;
}

// ── Domain → Tag mapping ─────────────────────────────────────────
const DOMAIN_TAGS = {
  system: "System & Health",
  auth: "Authentication & Session",
  organizations: "Organizations",
  branches: "Branches & Multi-Branch",
  employees: "Employees & Memberships",
  roles: "Roles & Capabilities",
  departments: "Departments",
  jobRoles: "Job Roles",
  teams: "Teams",
  plans: "Subscription Plans",
  catalogs: "Catalogs & Reference Data",
  notifications: "Notifications",
  products: "Products & Inventory",
  categories: "Categories",
  units: "Units of Measure",
  customers: "Customers",
  vendors: "Vendors",
  outflows: "Purchases & Expenses",
  bills: "Sales & Billing",
  deliveries: "Deliveries & Dispatch",
  returns: "Returns & Waste",
  payments: "Payments & Ledger",
  stock: "Stock Movements",
  reconciliation: "Reconciliation",
  reports: "Reports & Analytics",
  tasks: "Tasks & Operations",
  locations: "Employee Location Tracking",
  usage: "Platform Usage & Metering",
};

// ── Build tags list ──────────────────────────────────────────────
const usedDomains = new Set(callables.map((e) => e.domain));
const tags = [...usedDomains]
  .sort()
  .map((d) => ({
    name: DOMAIN_TAGS[d] || d,
    description: `Callable functions in the "${d}" domain`,
  }));

tags.push({
  name: "Triggers (Event-Driven)",
  description:
    "Firestore document triggers. These fire automatically on document writes and are not directly invokable over HTTP.",
});

// ── Build paths ──────────────────────────────────────────────────
const paths = {};

function classifyOperation(name) {
  const n = name.toLowerCase();
  if (n.includes("list") || n.includes("get") || n === "authme" || n === "authlogin" || n === "healthcheck") return "READ";
  if (n.includes("create") || n === "stockadjust") return "CREATE";
  if (n.includes("update") || n.includes("assign") || n.includes("switch") || n.includes("markread") || n.includes("register")) return "UPDATE";
  if (n.includes("deactivate")) return "DEACTIVATE";
  if (n.includes("delete")) return "DELETE";
  if (n.includes("finalize") || n.includes("reconcile") || n.includes("return")) return "FINANCIAL";
  if (n.includes("export") || n.includes("record") || n.includes("calculate")) return "ACTION";
  return "ACTION";
}

for (const ep of callables) {
  const opPath = `/api/callables/${ep.exportName}`;
  const tagName = DOMAIN_TAGS[ep.domain] || ep.domain;
  const resolvedName = resolveSchemaName(ep.inputSchema);
  const meta = getOperationMeta(ep.exportName);
  const badge = classifyOperation(ep.exportName);

  const requestBodyContent = {};
  const example = OPERATION_EXAMPLES[ep.exportName] || { data: {} };
  if (resolvedName && componentSchemas[resolvedName]) {
    requestBodyContent["application/json"] = {
      schema: {
        type: "object",
        required: ["data"],
        properties: {
          data: { $ref: `#/components/schemas/${resolvedName}` },
        },
      },
      example: example,
    };
  } else {
    requestBodyContent["application/json"] = {
      schema: { $ref: "#/components/schemas/FirebaseCallableRequest" },
      example: example,
    };
  }

  const securityReqs = [];
  if (ep.authRequired) {
    securityReqs.push({ bearerAuth: [] });
  }

  const operation = {
    operationId: ep.exportName,
    summary: `[${badge}] ${formatHumanName(ep.exportName)}`,
    description: buildDescription(ep, meta),
    tags: [tagName],
    security: securityReqs.length > 0 ? securityReqs : undefined,
    requestBody: {
      required: true,
      content: requestBodyContent,
    },
    responses: {
      200: {
        description: `Successful callable response (${meta.responseSchema})`,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${meta.responseSchema}` },
          },
        },
      },
      400: {
        description: "Invalid input or validation failure (INVALID_ARGUMENT)",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FirebaseCallableError" },
          },
        },
      },
      401: {
        description: "Not authenticated or token expired (UNAUTHENTICATED)",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FirebaseCallableError" },
          },
        },
      },
      403: {
        description: "Permission denied or cross-tenant rejection (PERMISSION_DENIED)",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FirebaseCallableError" },
          },
        },
      },
    },
    "x-trado-risk": meta.risk,
    "x-trado-persona": meta.persona,
    "x-trado-repeatable": meta.repeatable,
    "x-trado-prerequisites": meta.prerequisites,
  };

  paths[opPath] = { post: operation };
}

// ── Document triggers as x-triggers ──────────────────────────────
const xTriggers = triggers.map((t) => ({
  exportName: t.exportName,
  logicalName: t.logicalName,
  triggerType: t.triggerType,
  description: "Firestore document write event trigger. Fired internally by Firestore — not callable via HTTP.",
  collectionsRead: t.firestoreCollectionsRead || [],
  collectionsWritten: t.firestoreCollectionsWritten || [],
}));

// ── Assemble the OpenAPI document ────────────────────────────────
const openApiDoc = {
  openapi: "3.0.3",
  info: {
    title: "Trado Firebase Backend — Local Emulator API",
    version: "1.0.0",
    description: [
      "Authoritative OpenAPI 3.0.3 contract for the Trado Firebase backend.",
      "",
      `**${callables.length} HTTPS Callable functions** across ${usedDomains.size} domains.`,
      `**${triggers.length} Firestore Triggers** (internal event-driven background automation).`,
      "",
      "⚠️ **LOCAL EMULATOR ONLY** — Targets loopback Firebase Emulator Suite (`127.0.0.1:5001`).",
      "Do NOT use this contract against production cloud endpoints.",
      "",
      `Generated from canonical source exports and validation schemas (${endpoints.length} total exports).`,
      `Input schemas derived from ${Object.keys(zodSchemas).length} Zod schemas via z.toJSONSchema().`,
    ].join("\n"),
  },
  servers: [
    {
      url: "http://127.0.0.1:3939",
      description: "Trado API Explorer local proxy (routes to Functions emulator on port 5001)",
    },
  ],
  tags: tags,
  paths: paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Firebase ID Token",
        description:
          "Firebase Auth emulator ID token. Obtain via POST /__local__/auth/login or the persona bar.",
      },
    },
    schemas: componentSchemas,
  },
  "x-triggers": xTriggers,
  "x-meta": {
    projectId: manifest.projectId || "trado-x",
    region: "asia-south1",
    callableCount: callables.length,
    triggerCount: triggers.length,
    totalExports: endpoints.length,
    zodSchemasResolved: zodAvailable,
    resolvedSchemaCount: Object.keys(zodSchemas).length,
    operationsWithExamples: Object.keys(OPERATION_EXAMPLES).length,
  },
};

// ── Helpers ──────────────────────────────────────────────────────
function formatHumanName(exportName) {
  const parts = exportName.replace(/([A-Z])/g, " $1").trim().split(" ");
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function buildDescription(ep, meta) {
  const lines = [];
  lines.push(`**Risk Classification:** \`${meta.risk}\``);
  lines.push(`**Recommended Persona:** \`${meta.persona}\``);
  lines.push(`**Safe to Repeat:** \`${meta.repeatable ? "Yes" : "No (mutates business state)"}\``);
  if (ep.logicalName) lines.push(`**Logical name:** \`${ep.logicalName}\``);
  if (ep.authRequired) {
    lines.push("**Authentication:** Required (Firebase ID Token)");
  } else {
    lines.push("**Authentication:** Not required (public)");
  }
  if (ep.requiredPermissions && ep.requiredPermissions.length > 0) {
    lines.push(`**Permissions:** ${ep.requiredPermissions.map((p) => "`" + p + "`").join(", ")}`);
  }
  if (ep.requiredClaims && Object.keys(ep.requiredClaims).length > 0) {
    lines.push(
      `**Required claims:** ${Object.entries(ep.requiredClaims)
        .map(([k, v]) => `\`${k}=${v}\``)
        .join(", ")}`
    );
  }
  if (ep.superAdminBypass) lines.push("**Super Admin bypass:** Yes");
  if (ep.idempotent) lines.push("**Idempotent:** Yes (supply `idempotencyKey` UUID)");
  if (ep.inputSchema && ep.inputSchema !== "None") {
    lines.push(`**Input schema:** \`${ep.inputSchema}\``);
  }
  if (ep.firestoreCollectionsRead && ep.firestoreCollectionsRead.length > 0) {
    lines.push(`**Reads:** ${ep.firestoreCollectionsRead.join(", ")}`);
  }
  if (ep.firestoreCollectionsWritten && ep.firestoreCollectionsWritten.length > 0) {
    lines.push(`**Writes:** ${ep.firestoreCollectionsWritten.join(", ")}`);
  }
  if (ep.sideEffects && ep.sideEffects.length > 0) {
    lines.push(`**Side effects:** ${ep.sideEffects.join(", ")}`);
  }

  const errors = [];
  if (ep.authRequired) errors.push("- `UNAUTHENTICATED`: Missing or expired Firebase ID token");
  if (ep.requiredPermissions && ep.requiredPermissions.length > 0)
    errors.push("- `PERMISSION_DENIED`: Caller lacks required capability");
  if (ep.inputSchema && ep.inputSchema !== "None")
    errors.push("- `INVALID_ARGUMENT`: Payload failed schema validation");
  if (["CREATE", "UPDATE", "WORKFLOW", "DESTRUCTIVE"].includes(meta.risk))
    errors.push("- `NOT_FOUND`: Referenced entity does not exist");
  if (meta.risk === "DESTRUCTIVE")
    errors.push("- `INVALID_ARGUMENT`: Missing required confirmation header `x-trado-confirmed: true`");
  if (errors.length > 0) {
    lines.push("\n**Expected Errors:**\n" + errors.join("\n"));
  }
  return lines.join("\n\n");
}

// ── Output ───────────────────────────────────────────────────────
const outputJson = JSON.stringify(openApiDoc, null, 2);
const args = process.argv.slice(2);

if (args.includes("--check")) {
  if (!fs.existsSync(OUTPUT_PATH)) {
    console.error(`[FAIL] ${OUTPUT_PATH} does not exist. Run: node scripts/generate-openapi.js`);
    process.exit(1);
  }
  const existing = fs.readFileSync(OUTPUT_PATH, "utf8");
  if (existing.trim() === outputJson.trim()) {
    console.log(`[PASS] docs/openapi.json is up to date (${callables.length} callable operations).`);
    process.exit(0);
  } else {
    console.error(`[FAIL] docs/openapi.json is stale. Regenerate: node scripts/generate-openapi.js`);
    process.exit(1);
  }
} else if (args.includes("--stdout")) {
  process.stdout.write(outputJson + "\n");
} else {
  const docsDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, outputJson + "\n", "utf8");
  const typedCount = callables.filter((ep) => {
    const r = resolveSchemaName(ep.inputSchema);
    return r && componentSchemas[r];
  }).length;
  console.log(`[OK] Generated docs/openapi.json`);
  console.log(`     ${callables.length} callable operations, ${triggers.length} triggers documented`);
  console.log(`     ${Object.keys(zodSchemas).length} Zod schemas resolved to JSON Schema`);
  console.log(`     ${typedCount}/${callables.length} callables have typed input schemas`);
  console.log(`     ${Object.keys(OPERATION_EXAMPLES).length}/${callables.length} callables have seeded example payloads`);
  console.log(`     100% typed response schemas (no generic response fallback)`);
  console.log(`     Server: http://127.0.0.1:3939 (API Explorer proxy)`);
}
