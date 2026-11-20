#!/usr/bin/env node
/**
 * Trado Flutter Contract Pack & Complete Callable API Reference Generator (D-35, D-55, D-57)
 *
 * Generates docs/flutter-contract/ directly from backend Zod schemas, TypeScript response types,
 * callable registry, permissions, system role defaults, image policy, and audit registry.
 * Never hand-edit generated files — regenerate via:
 *   node scripts/generate-flutter-contract.js
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const truth = require("./lib/source-truth.js");

const ROOT = truth.ROOT;
const FUNCTIONS_DIR = path.join(ROOT, "functions");
const OUT_DIR = path.join(ROOT, "docs", "flutter-contract");
const FORMS_DIR = path.join(OUT_DIR, "forms");
const CALLABLES_DIR = path.join(OUT_DIR, "callables");

fs.mkdirSync(FORMS_DIR, { recursive: true });
fs.mkdirSync(CALLABLES_DIR, { recursive: true });

const exportsList = truth.getExports();
const callablesList = exportsList.filter((e) => e.type === "callable");
const callableMap = new Map(callablesList.map((c) => [c.name, c]));
const schemas = truth.getRequestSchemas();
const responseTypes = truth.getResponseTypes();

// Load compiled image policy & audit registry & default roles when available
const { IMAGE_POLICIES } = require(path.join(FUNCTIONS_DIR, "lib", "config", "imagePolicy.js"));
const { DEFAULT_SYSTEM_ROLES } = require(path.join(FUNCTIONS_DIR, "lib", "constants", "catalogs.js"));
const { AUDIT_REGISTRY } = require(path.join(FUNCTIONS_DIR, "lib", "constants", "auditRegistry.js"));
const { ORGANIZATION_FIELD_POLICY, ORGANIZATION_FIELD_CLASS } = require(path.join(FUNCTIONS_DIR, "lib", "callables", "organizations.js"));

console.log("Generating Flutter Contract Pack & Complete Callable API Reference...");

// ---------------------------------------------------------------------------
// 1. UI Hints & Valid Synthetic Examples (MG-05)
// ---------------------------------------------------------------------------

function uiHint(fieldPath, type) {
  const p = fieldPath.toLowerCase();
  if (p.includes("email")) return "email";
  if (p.includes("phone") || p.includes("mobile")) return "phone";
  if (p.includes("password")) return "password";
  if (p.includes("image") || p.includes("avatar") || p === "uploadid") return "image_picker";
  if (/(date|at|until|effectivefrom|neededby|starton|expiry|expires)$/i.test(p) || p.includes("date")) return "date_picker";
  if (p.includes("percent") || p.includes("rate") || p.includes("ratio") || p.includes("count") || p.includes("hour") || p.includes("user") || p.includes("org")) {
    if (type === "number") return "numeric";
  }
  // MG-05: money ONLY on numeric fields (never on strings like priceGroup!)
  if (type === "number" && (p.includes("price") || p.includes("amount") || p.includes("cost") || p.includes("creditlimit") || p.includes("requestedlimit") || p.includes("balance") || p.includes("fee") || p.includes("discount"))) {
    return "money";
  }
  if (p.includes("notes") || p.includes("description") || p.includes("address") || p.includes("reason")) return "textarea";
  if (type === "enum") return "dropdown";
  if (type === "boolean") return "switch";
  if (type === "number") return "numeric";
  return "text";
}

function syntheticExample(fieldPath, type, hint, enumValues, bounds) {
  const p = fieldPath.toLowerCase();
  if (type === "boolean") return true;
  if (type === "enum") return (enumValues && enumValues[0]) || "active";
  if (type === "number") {
    if (bounds && typeof bounds.min === "number") return Math.max(bounds.min, hint === "money" ? 25 : 1);
    return hint === "money" ? 25 : 1;
  }
  if (p.endsWith("pricegroup")) return "retail";
  if (p.includes("email")) return "owner@example.com";
  if (p.includes("phone")) return "+919876543210";
  if (p.includes("website") || p.includes("url")) return "https://example.com";
  if (p.includes("timezone")) return "Asia/Kolkata";
  if (p.includes("currency") && !p.includes("decimals") && !p.includes("symbol")) return "INR";
  if (p.includes("country")) return "IN";
  if (p.includes("date") || p.endsWith("on")) return "2026-11-18";
  if (p.endsWith("at")) return "2026-11-18T12:00:00.000Z";
  if (p.includes("idempotencykey") || p.includes("clientrequestid")) return "idem_20261118_0001";
  if (p.endsWith("id")) return `${fieldPath.replace(/Id$/, "").replace(/[^a-zA-Z0-9]/g, "_")}_001`;
  const minLen = bounds && typeof bounds.minLength === "number" ? bounds.minLength : 0;
  const base = `Sample ${fieldPath.split(".").pop()}`;
  return base.length >= minLen ? base : base.padEnd(minLen, "x");
}

// ---------------------------------------------------------------------------
// 2. Entity Forms Configuration (MG-04, MG-06, MG-15, MG-31, MG-38)
//    Structured callables: { create?, get?, list?, update?, delete?, void?, actions: [{name, kind}] }
//    Every callable MUST exist in functions/src/index.ts, and `update` MUST have kind === "update".
// ---------------------------------------------------------------------------

const ENTITY_CONFIG = [
  { name: "organization", label: "Organization", schemas: ["CreateOrganizationSchema", "UpdateOrganizationSchema"], callables: { create: "organizationsCreate", get: "organizationsGet", list: "organizationsList", update: "organizationsUpdate", actions: [{ name: "organizationsDeactivate", kind: "delete" }, { name: "organizationsReactivate", kind: "update" }, { name: "organizationsSetSubscription", kind: "update" }, { name: "organizationsTransferOwnership", kind: "action" }] } },
  { name: "branch", label: "Branch", schemas: ["CreateBranchSchema", "UpdateBranchSchema"], callables: { create: "branchesCreate", list: "branchesList", update: "branchesUpdate", delete: "branchesDeactivate", actions: [{ name: "branchesGetDefault", kind: "read" }, { name: "branchContextSwitch", kind: "action" }] } },
  { name: "employee", label: "Employee / User", schemas: ["CreateEmployeeSchema", "UpdateEmployeeSchema"], callables: { create: "employeesCreate", get: "employeesGet", list: "employeesList", update: "employeesUpdate", delete: "employeesDeactivate", actions: [] } },
  { name: "customer", label: "Customer", schemas: ["CreateCustomerSchema", "UpdateCustomerSchema"], callables: { create: "customersCreate", get: "customersGet", list: "customersList", update: "customersUpdate", actions: [] } },
  { name: "vendor", label: "Vendor", schemas: ["CreateVendorSchema", "UpdateVendorSchema"], callables: { create: "vendorsCreate", get: "vendorsGet", list: "vendorsList", update: "vendorsUpdate", actions: [] } },
  { name: "product", label: "Product", schemas: ["CreateProductSchema", "UpdateProductSchema"], callables: { create: "productsCreate", get: "productsGet", list: "productsList", update: "productsUpdate", actions: [{ name: "productsGetPriceHistory", kind: "read" }] } },
  { name: "category", label: "Category", schemas: ["CreateCategorySchema", "UpdateCategorySchema"], callables: { create: "categoriesCreate", list: "categoriesList", update: "categoriesUpdate", actions: [] } },
  { name: "unit", label: "Unit", schemas: ["CreateUnitSchema", "UpdateUnitSchema"], callables: { create: "unitsCreate", list: "unitsList", update: "unitsUpdate", actions: [] } },
  { name: "bill", label: "Bill / POS Sale", schemas: ["CreateBillSchema", "UpdateDraftBillSchema"], callables: { create: "billsCreate", get: "billsGet", list: "billsList", update: "billsUpdateDraft", void: "billsVoid", actions: [{ name: "billsFinalize", kind: "action" }, { name: "billsPreview", kind: "read" }] } },
  { name: "purchase", label: "Purchase (Outflow)", schemas: ["CreateOutflowSchema"], callables: { create: "outflowsCreate", get: "outflowsGet", list: "outflowsList", void: "outflowsVoid", actions: [] } },
  { name: "expense", label: "Expense (Outflow)", schemas: ["CreateOutflowSchema"], callables: { create: "outflowsCreate", get: "outflowsGet", list: "outflowsList", void: "outflowsVoid", actions: [] } },
  { name: "payment", label: "Payment", schemas: ["CreatePaymentSchema"], callables: { create: "paymentsCreate", list: "paymentsList", void: "paymentsVoid", actions: [] } },
  { name: "delivery", label: "Delivery", schemas: ["CreateDeliverySchema", "UpdateDeliveryStatusSchema"], callables: { create: "deliveriesCreate", get: "deliveriesGet", list: "deliveriesList", update: "deliveriesUpdateStatus", actions: [] } },
  { name: "return", label: "Return", schemas: ["CreateReturnSchema"], callables: { create: "returnsCreate", list: "returnsList", actions: [{ name: "documentsDecide", kind: "action" }] } },
  { name: "stock_adjustment", label: "Stock Adjustment / Wastage", schemas: ["StockAdjustSchema"], callables: { create: "stockAdjust", list: "stockMovementsList", actions: [{ name: "stockVerify", kind: "read" }] } },
  { name: "task", label: "Task", schemas: ["CreateTaskSchema", "UpdateTaskSchema"], callables: { create: "tasksCreate", list: "tasksList", update: "tasksUpdate", delete: "tasksDelete", actions: [{ name: "tasksUpdateStatus", kind: "update" }, { name: "tasksAssign", kind: "update" }] } },
  { name: "role", label: "Custom Role", schemas: ["CreateRoleSchema", "UpdateRoleSchema"], callables: { create: "rolesCreate", list: "rolesList", update: "rolesUpdate", actions: [] } },
  { name: "job_role", label: "Job Role", schemas: ["CreateJobRoleSchema", "UpdateJobRoleSchema"], callables: { create: "jobRolesCreate", list: "jobRolesList", update: "jobRolesUpdate", actions: [] } },
  { name: "department", label: "Department", schemas: ["CreateDepartmentSchema", "UpdateDepartmentSchema"], callables: { create: "departmentsCreate", list: "departmentsList", update: "departmentsUpdate", actions: [] } },
  { name: "team", label: "Team", schemas: ["CreateTeamSchema", "UpdateTeamSchema"], callables: { create: "teamsCreate", list: "teamsList", update: "teamsUpdate", actions: [{ name: "teamsAssignMember", kind: "action" }] } },
  { name: "approval_request", label: "Approval Decision (Maker-Checker)", schemas: ["DocumentDecisionSchema"], callables: { list: "approvalsList", actions: [{ name: "documentsDecide", kind: "action" }, { name: "approvalsCounts", kind: "read" }] } },
  { name: "recurring_expense", label: "Recurring Expense", schemas: ["CreateRecurringExpenseSchema", "UpdateRecurringExpenseSchema"], callables: { create: "recurringExpensesCreate", list: "recurringExpensesList", update: "recurringExpensesUpdate", actions: [] } },
  { name: "plan", label: "Subscription Plan", schemas: ["CreatePlanSchema", "UpdatePlanSchema"], callables: { create: "plansCreate", get: "plansGet", list: "plansList", update: "plansUpdate", delete: "plansDelete", actions: [{ name: "plansArchive", kind: "delete" }, { name: "plansPreviewImpact", kind: "read" }, { name: "plansCatalogList", kind: "list" }] } },
  { name: "request", label: "Request / Support Ticket", schemas: ["CreateRequestSchema", "UpdateRequestSchema"], callables: { create: "requestsCreate", get: "requestsGet", list: "requestsList", update: "requestsUpdate", actions: [{ name: "requestsTransition", kind: "action" }, { name: "requestsApply", kind: "action" }, { name: "requestsAddComment", kind: "action" }, { name: "requestsAddInternalNote", kind: "action" }, { name: "requestsAssign", kind: "update" }, { name: "requestsSetPriority", kind: "update" }, { name: "requestsActivityList", kind: "list" }, { name: "requestsCounts", kind: "read" }, { name: "requestsMeta", kind: "read" }] } },
  { name: "financial_account", label: "Financial Account", schemas: ["CreateFinancialAccountSchema", "UpdateFinancialAccountSchema"], callables: { create: "financialAccountsCreate", get: "financialAccountsGet", list: "financialAccountsList", update: "financialAccountsUpdate", actions: [{ name: "financialAccountsGetLedger", kind: "list" }] } },
  { name: "storage_location", label: "Storage Location", schemas: ["CreateStorageLocationSchema", "UpdateStorageLocationSchema"], callables: { create: "storageLocationsCreate", get: "storageLocationsGet", list: "storageLocationsList", update: "storageLocationsUpdate", actions: [] } },
  { name: "stock_transfer", label: "Stock Transfer", schemas: ["CreateStockTransferSchema"], callables: { create: "stockTransfersCreate", get: "stockTransfersGet", list: "stockTransfersList", actions: [{ name: "stockTransfersSubmit", kind: "action" }, { name: "stockTransfersDispatch", kind: "action" }, { name: "stockTransfersReceive", kind: "action" }, { name: "stockTransfersCancel", kind: "delete" }, { name: "stockTransfersResolveDiscrepancy", kind: "action" }] } },
  { name: "account_transfer", label: "Account Transfer (Contra)", schemas: ["CreateAccountTransferSchema"], callables: { create: "accountTransfersCreate", get: "accountTransfersGet", list: "accountTransfersList", actions: [] } },
  { name: "payment_processing_fee", label: "Payment Processing Fee", schemas: ["RecordPaymentFeeSchema"], callables: { create: "paymentsRecordFee", get: "paymentsGetFee", list: "paymentsListFees", actions: [{ name: "paymentsVerifyFee", kind: "action" }, { name: "paymentsDisputeFee", kind: "action" }, { name: "paymentsReverseFee", kind: "action" }] } },
  { name: "capital_transaction", label: "Capital Transaction", schemas: ["CreateCapitalTransactionSchema"], callables: { create: "capitalTransactionsCreate", list: "capitalTransactionsList", actions: [] } },
  // MG-04: Additional non-entity user/settings/action forms
  { name: "user_profile", label: "User Self-Profile", schemas: ["UpdateMeSchema"], callables: { update: "usersUpdateMe", get: "authMe", actions: [{ name: "notificationsRegisterFcmToken", kind: "action" }] } },
  { name: "ownership_transfer", label: "Organization Ownership Transfer", schemas: ["TransferOwnershipSchema"], callables: { actions: [{ name: "organizationsTransferOwnership", kind: "action" }] } },
  { name: "sharing_policy", label: "Multi-Branch Sharing Policy", schemas: ["UpdateSharingPoliciesSchema"], callables: { update: "sharingPoliciesUpdate", actions: [] } },
  { name: "usage_limits", label: "Organization Usage Limits", schemas: ["UpdateUsageLimitsSchema"], callables: { get: "usageGetLimits", update: "usageUpdateLimits", actions: [] } },
  { name: "requests_settings", label: "Platform Requests Settings", schemas: ["UpdateRequestsSettingsSchema"], callables: { get: "requestsSettingsGet", update: "requestsSettingsUpdate", actions: [] } },
];

function orgFieldEditableBy(topField) {
  const rule = ORGANIZATION_FIELD_CLASS && ORGANIZATION_FIELD_CLASS[topField];
  if (rule) {
    if (rule.fieldClass === "S0" || !rule.requiredPermission) return "super_admin";
    return `permission:${rule.requiredPermission}`;
  }
  if (ORGANIZATION_FIELD_POLICY.admin.has(topField)) return "permission:org:update";
  if (ORGANIZATION_FIELD_POLICY.owner.has(topField)) return "owner";
  if (ORGANIZATION_FIELD_POLICY.superAdmin.has(topField)) return "super_admin";
  return null;
}

const entityFormStats = [];

for (const ent of ENTITY_CONFIG) {
  const primarySchemaName = ent.schemas[0];
  const updateSchemaName = ent.schemas[1] || (ent.callables.update ? ent.schemas[0] : null);
  const primarySchema = schemas[primarySchemaName] || { leaves: [] };
  const updateSchema = updateSchemaName ? (schemas[updateSchemaName] || { leaves: [] }) : { leaves: [] };
  const updateFields = new Set(updateSchema.leaves.map((l) => l.path));

  const formFields = primarySchema.leaves.map((leaf) => {
    const isUpdatable = updateFields.has(leaf.path);
    const hint = uiHint(leaf.path, leaf.type);
    const example = syntheticExample(leaf.path, leaf.type, hint, leaf.enumValues, leaf.bounds);
    const fieldObj = {
      path: leaf.path,
      type: leaf.type,
      requiredCreate: leaf.required,
      updatable: isUpdatable,
      nullable: leaf.nullable,
      bounds: leaf.bounds || {},
      enumValues: leaf.enumValues || [],
      uiHint: hint,
      example,
    };
    if (hint === "money") {
      fieldObj.currencyExponentFrom = "organization.currencyInfo.exponent";
    }
    if (ent.name === "organization") {
      const top = leaf.path.split(".")[0].replace(/\[\]$/, "");
      const eb = orgFieldEditableBy(top);
      if (eb) fieldObj.editableBy = eb;
    }
    return fieldObj;
  });

  const reqCount = formFields.filter((f) => f.requiredCreate).length;
  const optCount = formFields.filter((f) => !f.requiredCreate).length;
  const updatableCount = formFields.filter((f) => f.updatable).length;

  const primaryCallable = ent.callables.create || ent.callables.update || (ent.callables.actions[0] && ent.callables.actions[0].name) || "—";
  entityFormStats.push({
    entity: ent.name,
    label: ent.label,
    primaryCallable,
    callables: ent.callables,
    required: reqCount,
    optional: optCount,
    updatable: updatableCount,
    totalFields: formFields.length,
  });

  const jsonContent = {
    entity: ent.name,
    label: ent.label,
    callables: ent.callables,
    ...(ent.name === "organization" ? {
      operations: {
        update: {
          super_admin: Object.keys(ORGANIZATION_FIELD_CLASS).sort(),
          "permission:org:manage_legal_profile": Object.entries(ORGANIZATION_FIELD_CLASS).filter(([, r]) => r.requiredPermission === "org:manage_legal_profile").map(([k]) => k).sort(),
          "permission:org:manage_bank_details": Object.entries(ORGANIZATION_FIELD_CLASS).filter(([, r]) => r.requiredPermission === "org:manage_bank_details").map(([k]) => k).sort(),
          "permission:org:update": Object.entries(ORGANIZATION_FIELD_CLASS).filter(([, r]) => r.requiredPermission === "org:update").map(([k]) => k).sort(),
        },
      },
    } : {}),
    fields: formFields,
  };
  fs.writeFileSync(path.join(FORMS_DIR, `${ent.name}.json`), JSON.stringify(jsonContent, null, 2) + "\n");

  const callableSummary = [
    ent.callables.create ? `Create: \`${ent.callables.create}\`` : null,
    ent.callables.get ? `Get: \`${ent.callables.get}\`` : null,
    ent.callables.list ? `List: \`${ent.callables.list}\`` : null,
    ent.callables.update ? `Update: \`${ent.callables.update}\`` : null,
    ent.callables.delete ? `Delete: \`${ent.callables.delete}\`` : null,
    ent.callables.void ? `Void: \`${ent.callables.void}\`` : null,
    ent.callables.actions?.length ? `Actions: ${ent.callables.actions.map((a) => `\`${a.name}\` (${a.kind})`).join(", ")}` : null,
  ].filter(Boolean).join(" · ");

  const mdLines = [
    `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->`,
    `# Form Contract: ${ent.label} (\`${ent.name}\`)`,
    "",
    `**Callables:** ${callableSummary}`,
    "",
    `| Field Path | Type | Req | Updatable | UI Hint | Bounds / Enums | Example |`,
    `|---|---|---|---|---|---|---|`,
    ...formFields.map((f) => {
      const boundsStr = f.enumValues?.length ? `Enum: \`${f.enumValues.join("`, `")}\`` : Object.keys(f.bounds || {}).length ? JSON.stringify(f.bounds) : "—";
      return `| \`${f.path}\` | \`${f.type}\` | ${f.requiredCreate ? "**Yes**" : "No"} | ${f.updatable ? "Yes" : "No"} | \`${f.uiHint}\` | ${boundsStr} | \`${f.example}\` |`;
    }),
    "",
  ];
  fs.writeFileSync(path.join(FORMS_DIR, `${ent.name}.md`), mdLines.join("\n"));
}

// 1b. Category details forms for 15 request categories (D-41)
const CATEGORY_SCHEMAS = {
  plan_change: "PlanChangeDetailsSchema",
  limit_increase: "LimitIncreaseDetailsSchema",
  module_request: "ModuleRequestDetailsSchema",
  org_profile_change: "OrgProfileChangeDetailsSchema",
  ownership_transfer: "OwnershipTransferDetailsSchema",
  data_request: "DataRequestDetailsSchema",
  access_request: "AccessRequestDetailsSchema",
  billing_query: "BillingQueryDetailsSchema",
  bug_report: "BugReportDetailsSchema",
  data_issue: "DataIssueDetailsSchema",
  feature_request: "FeatureRequestDetailsSchema",
  improvement: "ImprovementDetailsSchema",
  support_question: "SupportQuestionDetailsSchema",
  other: "OtherDetailsSchema",
  security_concern: "SecurityConcernDetailsSchema",
};

for (const [category, schemaName] of Object.entries(CATEGORY_SCHEMAS)) {
  const schema = schemas[schemaName] || { leaves: [] };
  const fields = schema.leaves.map((leaf) => {
    const hint = uiHint(leaf.path, leaf.type);
    const fieldObj = {
      path: leaf.path,
      type: leaf.type,
      required: leaf.required,
      nullable: leaf.nullable,
      bounds: leaf.bounds || {},
      enumValues: leaf.enumValues || [],
      uiHint: hint,
      example: syntheticExample(leaf.path, leaf.type, hint, leaf.enumValues, leaf.bounds),
    };
    if (hint === "money") {
      fieldObj.currencyExponentFrom = "organization.currencyInfo.exponent";
    }
    return fieldObj;
  });
  fs.writeFileSync(path.join(FORMS_DIR, `request-details-${category}.json`), JSON.stringify({ category, schemaName, fields }, null, 2) + "\n");
  const mdLines = [
    `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->`,
    `# Request Details Schema: \`${category}\``,
    "",
    `**Schema Name:** \`${schemaName}\`  `,
    `**Form Target:** \`requestsCreate\` / \`requestsUpdate\` (details payload)`,
    "",
    `| Field Path | Type | Required | UI Hint | Bounds / Enums | Example |`,
    `|---|---|---|---|---|---|`,
    ...fields.map((f) => {
      const boundsStr = f.enumValues?.length ? `Enum: \`${f.enumValues.join("`, `")}\`` : Object.keys(f.bounds || {}).length ? JSON.stringify(f.bounds) : "—";
      return `| \`${f.path}\` | \`${f.type}\` | ${f.required ? "**Yes**" : "No"} | \`${f.uiHint}\` | ${boundsStr} | \`${f.example}\` |`;
    }),
    "",
  ];
  fs.writeFileSync(path.join(FORMS_DIR, `request-details-${category}.md`), mdLines.join("\n"));
}

// ---------------------------------------------------------------------------
// 3. Permissions Catalog: permissions.json + permissions.md (MG-03, MG-07)
// ---------------------------------------------------------------------------

const permissionsFile = fs.readFileSync(path.join(FUNCTIONS_DIR, "src/constants/permissions.ts"), "utf8");
const permissionMatches = [...permissionsFile.matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)"(?:\s*,\s*\/\/\s*(.*))?/gm)];

const SCOPE_NOTES = {
  "audit:read_own": "Entries where actorUid equals the caller only (ownActivityOnly: true; A-02).",
  "audit:view": "All organization audit entries for the caller's tenant (IP addresses omitted).",
  "usage:read": "Organization-level operation quantities and quota limits; platform cost visible only when showCostToTenant is enabled (D-25).",
  "usage:read_users": "Per-user usage breakdown inside the caller's organization (every member may always view their own).",
  "location:view_own": "Caller's own latest location and ping history only.",
  "location:view_all": "Latest location and ping history across employees in the caller's organization.",
  "requests:read_own": "Requests submitted by the caller only (requester.uid == callerUid).",
  "requests:read_org": "All non-confidential requests of the caller's organization (excludes security_concern).",
  "requests:manage_org": "Transition and decide organization-audience requests (e.g. access_request) inside the caller's organization.",
  "bill:view_all": "View all bills across the caller's assigned branches, not just self-created bills.",
  "expense:view_sensitive": "View salary and employee-linked expense outflows inside the caller's organization.",
  "employee:manage_sensitive": "Manage sensitive employee attributes (compensation, bank details, statutory IDs).",
  "product:view_cost": "View product costPrice, weightedAverageCost (WAC), and margin fields.",
  "customer:view_balance": "View customer outstandingBalance, creditLimit, and totalSpend.",
  "vendor:view_balance": "View vendor outstandingPayable and totalPurchase.",
  "requests:create_sensitive": "Create sensitive requests (plan_change, limit_increase, module_request, org_profile_change, ownership_transfer, data_request).",
};

function defaultDescriptionForPerm(code, inlineComment) {
  if (inlineComment && inlineComment.trim().length > 3) return inlineComment.trim();
  if (code === "*") return "Wildcard granting all tenant organization permissions (held by Organization Owner role by default).";
  if (code === "platform:*") return "Wildcard granting all platform-level Super Admin capabilities.";
  const parts = code.split(":");
  const domain = parts[0].replace(/_/g, " ");
  const action = parts.slice(1).join(" ").replace(/_/g, " ");
  return `${action.charAt(0).toUpperCase() + action.slice(1)} access for ${domain} resources.`;
}

function defaultScopeNote(code) {
  if (SCOPE_NOTES[code]) return SCOPE_NOTES[code];
  if (code.startsWith("platform:")) return "Platform scope (Super Admin / platform operators only; cross-organization governance).";
  if (/_own$/.test(code)) return "Caller's own records only.";
  if (/_org$/.test(code)) return "Organization-wide scope within caller's active tenant.";
  if (/_branch$/.test(code)) return "Assigned branch scope within caller's active tenant.";
  if (/_all$/.test(code)) return "All records across caller's authorized tenant/branch scope.";
  return null;
}

const permissionEntries = permissionMatches.map(([, constName, code, comment]) => {
  const defaultRoles = code.startsWith("platform:")
    ? ["super_admin"]
    : DEFAULT_SYSTEM_ROLES
      .filter((r) => r.permissions.includes("*") || r.permissions.includes(code))
      .map((r) => r.code);
  return {
    key: code,
    constName,
    group: code === "*" ? "wildcard" : code.split(":")[0],
    isWildcard: code.includes("*"),
    description: defaultDescriptionForPerm(code, comment),
    defaultRoles,
    scopeNote: defaultScopeNote(code),
  };
});

const concretePermissions = permissionEntries.filter((p) => !p.isWildcard);

fs.writeFileSync(
  path.join(OUT_DIR, "permissions.json"),
  JSON.stringify({
    version: "2.0.0",
    totalConcrete: concretePermissions.length,
    wildcards: permissionEntries.filter((p) => p.isWildcard),
    permissions: concretePermissions,
  }, null, 2) + "\n"
);

const permissionsMd = `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Permission Catalog & UI Gating

Concrete permissions: **${concretePermissions.length}** (+ ${permissionEntries.length - concretePermissions.length} wildcards: \`*\`, \`platform:*\`). Machine-readable catalog: [permissions.json](./permissions.json).

> **Canonical Naming (MG-07):** No aliases exist. Use \`usage:read\`, \`audit:view\`, \`audit:read_own\`, \`product:view_cost\`.

## Permission Key Directory
| Wire Key | Group | Default Roles | Description | Scope Note |
|---|---|---|---|---|
${permissionEntries.map((p) => `| \`${p.key}\` | \`${p.group}\` | ${p.defaultRoles.map((r) => `\`${r}\``).join(", ") || "—"} | ${p.description} | ${p.scopeNote || "Tenant scope"} |`).join("\n")}

## UI Gating in Flutter
Every client session receives effective permissions inside the \`authMe\` bootstrap payload.
\`\`\`dart
bool can(String permissionKey) {
  return currentUser.effectivePermissions[permissionKey] == true;
}
\`\`\`
`;
fs.writeFileSync(path.join(OUT_DIR, "permissions.md"), permissionsMd);

// ---------------------------------------------------------------------------
// 4. Images Contract: images.md + fixed serialization.md & client-meta (MG-01)
// ---------------------------------------------------------------------------

const imagesMd = `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Image Pipeline & Payload Contract (D-5, D-6, D-15)

Derived directly from \`functions/src/config/imagePolicy.ts\` and \`ImageRefSchema\` in \`functions/src/validation/schemas.ts\`.

## 1. Upload & Attach Flow
1. Call \`imagesCreateUploadSession\` with \`{ purpose, entityType, entityId?, contentType, sizeBytes, organizationId?, clientRequestId? }\`.
2. Backend validates permission, MIME type, and size limit, returning \`{ uploadId, uploadPath, maxBytes, expiresAt }\` where \`uploadPath = tmp/{scope}/{uid}/{uploadId}\`.
3. Client uploads binary bytes directly to Firebase Storage at \`uploadPath\` (enforced by \`storage.rules\`).
4. Client either calls \`imagesAttach\` with \`{ uploadId, entityType, entityId, purpose }\` OR passes \`uploadId\` directly in entity create/update payloads (\`organizationsUpdate\`, \`usersUpdateMe\`, \`customersCreate\`, \`vendorsCreate\`, \`productsCreate\`, etc.).
5. Server validates bytes, strips EXIF, converts to WebP, writes permanent Storage object, and persists \`ImageRef\` on the entity. Raw URLs are **never stored** (D-15).

## 2. Wire Shapes
- **Write shape (preferred):** \`uploadId: "up_..."\` (server attaches and produces \`ImageRef\`), OR \`image: ImageRef\`:
\`\`\`json
{
  "path": "orgs/org_123/products/prod_1/main.webp",
  "contentType": "image/webp",
  "width": 800,
  "height": 600,
  "sizeBytes": 42100,
  "updatedAt": "2026-11-18T12:00:00.000Z",
  "thumbnailPath": "orgs/org_123/products/prod_1/thumb.webp"
}
\`\`\`
- **Read shape (hydrated at read time):** Stored \`image\` (\`ImageRef | null\`) plus computed display URLs \`imageUrl\` (string | null) and \`thumbnailUrl\` (when thumbnail exists).
- **Entity differences (current wire contract):**
  - \`organizations\`, \`users\`, \`customers\`, \`vendors\`: single \`image: ImageRef | null\` (hydrated as \`imageUrl\`).
  - \`products\`: primary \`image: ImageRef | null\` plus gallery \`imagePaths: string[]\` (max 8 paths, hydrated as \`imageUrl\` / \`imageUrls\`).

## 3. Policy Limits by Purpose (\`IMAGE_POLICIES\`)
| Purpose | Entity Fields | Accepted MIME Types | Raw Upload Max | Dimensions (min..max) | Output Format / Max Size | Thumbnail |
|---|---|---|---|---|---|---|
${Object.values(IMAGE_POLICIES).map((p) => `| \`${p.purpose}\` | ${p.entityFields.map((f) => `\`${f}\``).join(", ")} | ${p.acceptedMimeTypes.join(", ")} | ${(p.rawUploadMaxBytes / (1024 * 1024)).toFixed(0)} MB | ${p.minWidth}x${p.minHeight} .. ${p.maxWidth}x${p.maxHeight}${p.requireSquare ? " (square)" : ""} | \`${p.outputFormat}\` ≤ ${p.outputMaxWidth}x${p.outputMaxHeight} | ${p.thumbnailMaxWidth ? `${p.thumbnailMaxWidth}x${p.thumbnailMaxHeight}` : "—"} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT_DIR, "images.md"), imagesMd);

// ---------------------------------------------------------------------------
// 5. Auth Session Contract: auth.md (MG-02)
// ---------------------------------------------------------------------------

const authMeLeaves = (responseTypes.authMe?.leaves || []).filter((l) => l.path);
const authMd = `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Authentication & Session Bootstrap Contract (\`authMe\` / \`authLogin\`)

Derived directly from \`AuthMeSchema\`, \`AuthLoginSchema\`, and \`functions/src/services/sessionContext.ts\`.

## 1. \`authMe\` (Production & Emulator)
- **Gate:** Authenticated Firebase Auth ID token required (\`UNAUTHENTICATED\` if missing).
- **Input (\`AuthMeSchema\`, strict — unknown fields rejected with \`UNKNOWN_FIELD\`):**
  - \`deviceId\` (\`string\`, optional): Registers/updates \`users/{uid}/devices/{deviceId}\`.
  - \`requestedOrgId\` is **rejected with \`UNKNOWN_FIELD\`** (Multi-organization Switch is **ON HOLD**).
- **Response (\`AuthMeResponse\`):** \`{ context: AuthSessionContext, credentials: null }\`
  - \`context.primaryOrganization.timezone\`: Always populated as an IANA timezone string (e.g. \`"Asia/Kolkata"\`, \`"Asia/Bahrain"\`, \`"Asia/Dubai"\`) for client \`OrgClock\` hydration.
  - \`context.contextStatus\`: \`"platform"\` (Super Admin) | \`"active"\` (single or primary org) | \`"organization_selection_required"\` (multiple active memberships without primary) | \`"no_organization"\` | \`"organization_inactive"\` | \`"subscription_expired"\` | \`"subscription_not_started"\` | \`"subscription_suspended"\`.
  - When \`contextStatus === "organization_selection_required"\`: \`primaryOrganization: null\`, \`role: null\`, \`permissions: []\`, \`branches: []\`, and \`organizations\` lists candidate organizations.

### Response Field Inventory (\`AuthMeResponse\`)
| Path | Type | Optional |
|---|---|---|
${authMeLeaves.map((l) => `| \`${l.path}\` | \`${l.type}\` | ${l.optional ? "Yes" : "No"} |`).join("\n")}

## 2. \`authLogin\` (Local Emulator Testing Adapter Only)
- **Gate:** Fails closed with \`failed-precondition\` unless running on the local \`trado-x\` Firebase Emulator Suite.
- **Input (\`AuthLoginSchema\`):** \`{ email, password, deviceId? }\`
- **Response (\`AuthLoginResponse\`):** \`{ context, credentials: { idToken, expiresInSeconds, accessToken, refreshToken }, idToken, accessToken, refreshToken }\`.
`;
fs.writeFileSync(path.join(OUT_DIR, "auth.md"), authMd);

// ---------------------------------------------------------------------------
// 6. Errors Index: errors.md (ALL thrown reason codes in functions/src)
// ---------------------------------------------------------------------------

const REASON_META = {
  UNAUTHENTICATED: ["unauthenticated", "Caller lacks a valid Firebase Auth token.", false, "Redirect to login"],
  USER_INACTIVE: ["permission-denied", "User account is inactive or disabled.", false, "Show account disabled screen"],
  NO_MEMBERSHIP: ["permission-denied", "Authenticated user has no active membership in the organization.", false, "Show no-organization state"],
  MEMBERSHIP_INACTIVE: ["permission-denied", "Caller's organization membership is inactive or deactivated.", false, "Show workspace inactive state"],
  ORG_NOT_FOUND: ["not-found", "Target organization document does not exist.", false, "Show organization not found"],
  ORG_INACTIVE: ["failed-precondition", "Organization is deactivated or suspended.", false, "Show workspace status screen"],
  SUBSCRIPTION_NOT_STARTED: ["failed-precondition", "Organization subscription start date is in the future.", false, "Show subscription pending screen"],
  SUBSCRIPTION_EXPIRED: ["failed-precondition", "Organization subscription and grace period have expired.", false, "Prompt owner to request renewal"],
  SUBSCRIPTION_SUSPENDED: ["failed-precondition", "Organization subscription is suspended by platform.", false, "Show contact support notice"],
  SUBSCRIPTION_CANCELLED: ["failed-precondition", "Organization subscription has been cancelled.", false, "Show cancelled workspace screen"],
  MODULE_NOT_IN_PLAN: ["permission-denied", "Feature module is not included in the organization's subscription plan.", false, "Offer plan upgrade / module request"],
  MODULE_DISABLED: ["failed-precondition", "Feature module is toggled off for this organization.", false, "Direct owner to module settings / request"],
  PERMISSION_DENIED: ["permission-denied", "Member role and overrides lack the required permission.", false, "Hide or disable action; show access denied"],
  TENANT_MISMATCH: ["permission-denied", "Requested entity belongs to another organization.", false, "Show not-found / access denied"],
  BRANCH_NOT_FOUND: ["not-found", "Target branch does not exist in this organization.", false, "Refresh branch list"],
  BRANCH_INACTIVE: ["failed-precondition", "Target branch is deactivated.", false, "Switch to an active branch"],
  BRANCH_NOT_ASSIGNED: ["permission-denied", "Caller is not assigned to the target branch.", false, "Restrict branch selector to assigned branches"],
  SUPER_ADMIN_TENANT_FORBIDDEN: ["permission-denied", "Super Admin cannot perform tenant operational mutations (D-1).", false, "Use platform governance endpoints only"],
  USAGE_LIMIT_EXCEEDED: ["resource-exhausted", "Organization exceeded hard-block daily/monthly quota limit.", false, "Prompt owner to file limit_increase request"],
  PLAN_LIMIT_REACHED: ["failed-precondition", "Plan seat or branch limit reached.", false, "Prompt owner to file plan_change request"],
  FIELD_NOT_EDITABLE: ["permission-denied", "One or more supplied fields cannot be edited by the caller's permission level.", false, "Disable non-editable fields per contract"],
  UNKNOWN_FIELD: ["invalid-argument", "Client sent an unrecognized field rejected by strict Zod schema (D-11).", false, "Align client payload with generated contract"],
  INVALID_ARGUMENT: ["invalid-argument", "Schema or parameter validation failed.", false, "Display field-level validation errors"],
  ALREADY_EXISTS: ["already-exists", "Unique natural key or resource already exists.", false, "Highlight conflicting field"],
  NOT_FOUND: ["not-found", "Target entity does not exist or is outside caller's tenant scope.", false, "Show entity not found"],
  FAILED_PRECONDITION: ["failed-precondition", "Business rule precondition failed.", false, "Display server error message"],
  STALE_WRITE: ["aborted", "Optimistic concurrency version mismatch.", true, "Reload latest document and retry"],
  IDEMPOTENCY_CONFLICT: ["already-exists", "Idempotency key reused with a different request payload.", false, "Generate a fresh idempotencyKey for new payloads"],
  DUPLICATE_NATURAL_KEY: ["already-exists", "Duplicate natural key (SKU, code, phone, email, or name) within scope.", false, "Prompt user to choose a unique value"],
  EMAIL_ALREADY_EXISTS: ["already-exists", "User with this email already exists.", false, "Use a different email or confirm linking"],
  PHONE_ALREADY_EXISTS: ["already-exists", "Entity with this phone number already exists.", false, "Prompt user to check existing record"],
  OWNER_EMAIL_EXISTS: ["already-exists", "Owner email matches an existing Auth user; requires confirmLinkExistingUser: true.", false, "Prompt Super Admin to confirm linking"],
  ORGANIZATION_ALREADY_HAS_OWNER: ["failed-precondition", "Organization already has an active owner.", false, "Use ownership transfer workflow"],
  ORGANIZATION_DUPLICATE: ["already-exists", "Organization with matching legal name/code already exists.", false, "Check existing organizations"],
  DOCUMENT_IMMUTABLE: ["failed-precondition", "Finalized, voided, or terminal document cannot be mutated.", false, "Show read-only view"],
  SELF_APPROVAL_FORBIDDEN: ["permission-denied", "Maker-checker rule prevents creator from approving/verifying their own record.", false, "Assign another approver"],
  REFERENCE_ATTRIBUTE_COPY: ["invalid-argument", "Client supplied a copied descriptive field beside a reference ID (R1).", false, "Send only the reference ID"],
  REFERENCE_MISMATCH: ["invalid-argument", "Referenced entity does not match expected type, tenant, or document.", false, "Refresh referenced record"],
  AMBIGUOUS_SOURCE_LINE: ["invalid-argument", "Source document line could not be uniquely matched.", false, "Pass explicit sourceLineId"],
  DELIVERY_COMPLETE: ["failed-precondition", "Order/bill has already been fully delivered.", false, "Show delivered status"],
  DELIVERY_EXCEEDS_LINE: ["invalid-argument", "Delivery quantity exceeds remaining undelivered line quantity.", false, "Cap quantity at remaining deliverable amount"],
  PARTIAL_ORDER_DELIVERY: ["failed-precondition", "Delivery quantity or state violates partial delivery rules.", false, "Adjust delivery lines"],
  SERIALS_REQUIRED: ["invalid-argument", "Serial-tracked product requires exact serial numbers matching quantity.", false, "Prompt user to scan/enter serial numbers"],
  SERIALS_NOT_ALLOWED: ["invalid-argument", "Serial numbers supplied for a non-serial-tracked product.", false, "Remove serial numbers input"],
  SERIALS_NOT_TRACKED: ["failed-precondition", "Serial number is not currently available/tracked at source location.", false, "Verify stock serial inventory"],
  IMAGE_TOO_LARGE: ["invalid-argument", "Image exceeds maximum byte limit for its ImagePurpose.", false, "Compress image before upload"],
  IMAGE_TYPE_UNSUPPORTED: ["invalid-argument", "Unsupported MIME type (allowed: JPEG, PNG, WebP).", false, "Restrict picker to allowed image types"],
  IMAGE_CORRUPT: ["invalid-argument", "Uploaded image bytes could not be decoded.", false, "Prompt user to pick another image"],
  IMAGE_DIMENSIONS_INVALID: ["invalid-argument", "Image width/height or aspect ratio outside ImagePolicy bounds.", false, "Crop or resize image"],
  UPLOAD_ALREADY_USED: ["failed-precondition", "Image upload session has already been attached.", false, "Create a new upload session"],
  UPLOAD_SESSION_EXPIRED: ["failed-precondition", "Image upload session TTL (1 hour) expired.", true, "Create a new upload session and re-upload"],
  META_REQUIRED: ["invalid-argument", "Required client _meta telemetry header missing.", false, "Attach _meta from CallableClient"],
  META_INVALID: ["invalid-argument", "Client _meta telemetry header failed schema validation.", false, "Fix _meta shape"],
  FEATURE_DISABLED: ["failed-precondition", "Feature flag (e.g. platformSettings/requests.requestsEnabled) is disabled.", false, "Show feature unavailable notice"],
  REQUEST_NOT_FOUND: ["not-found", "Request ID does not exist or caller lacks visibility.", false, "Show request not found"],
  REQUEST_CATEGORY_FORBIDDEN: ["permission-denied", "Caller lacks permission for this request category (e.g. requests:create_sensitive).", false, "Hide restricted categories per requestsMeta"],
  REQUEST_DETAILS_INVALID: ["invalid-argument", "Category-specific details payload failed validation.", false, "Validate against request-details-<category>.json"],
  REQUEST_INVALID_TRANSITION: ["failed-precondition", "Requested action is not valid from current status and kind.", false, "Refresh request actions"],
  REQUEST_STALE_STATUS: ["aborted", "Optimistic concurrency conflict on expectedStatus.", true, "Reload request and retry transition"],
  REQUEST_DUPLICATE_OPEN: ["already-exists", "Organization already has an open plan_change request (D-43).", false, "Navigate to existing open plan_change request"],
  REQUEST_LIMIT_REACHED: ["resource-exhausted", "Open request limit reached (user or org cap).", false, "Ask user to close/resolve open requests"],
  REQUEST_RATE_LIMITED: ["resource-exhausted", "Hourly request creation rate limit reached.", true, "Show cooldown notice"],
  REQUEST_ATTACHMENT_INVALID: ["invalid-argument", "Attachment exceeds count (5), size (5 MB), or MIME (images/PDF) limit.", false, "Enforce contract limits client-side"],
  REQUEST_NOT_APPROVED: ["failed-precondition", "Cannot apply a request that is not in approved status.", false, "Approve request first"],
  REQUEST_ALREADY_APPLIED: ["failed-precondition", "Request has already been applied.", false, "Display applied result"],
  REQUEST_APPLY_BLOCKED: ["failed-precondition", "Target plan capacity exceeded by current usage/resources (D-44).", false, "Display blockers; Super Admin may override with reason"],
  REQUEST_PLAN_UNAVAILABLE: ["not-found", "Target subscription plan does not exist or is inactive.", false, "Refresh plansCatalogList"],
  REQUEST_REOPEN_WINDOW_CLOSED: ["failed-precondition", "Configured reopen window (reopenWindowDays, default 14 days post-resolution) has elapsed.", false, "Prompt user to file a new request"],
  REQUEST_ASSIGNEE_INVALID: ["invalid-argument", "Assignee is not a valid platform/organization handler.", false, "Choose a valid assignee"],
};

// Scan source for ALL thrown reason codes so none can be missing
const scannedReasons = new Map();
for (const abs of truth.productionSourceFiles()) {
  const src = fs.readFileSync(abs, "utf8");
  const relFile = truth.rel(abs);
  const add = (code) => {
    if (!scannedReasons.has(code)) scannedReasons.set(code, new Set());
    scannedReasons.get(code).add(relFile);
  };
  for (const m of src.matchAll(/\breason\s*:\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:GateReason|RequestReason)\.([A-Z][A-Z0-9_]+)\b/g)) add(m[1]);
  for (const m of src.matchAll(/new HttpsError\([^)]*`?["']\[([A-Z][A-Z0-9_]{2,})\]/g)) add(m[1]);
}
for (const k of Object.keys(REASON_META)) {
  if (!scannedReasons.has(k)) scannedReasons.set(k, new Set());
}

const allReasonCodes = [...scannedReasons.keys()].sort();
const errorsMd = `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Error Index & Handling

Total documented reason codes: **${allReasonCodes.length}** (every thrown reason literal scanned from \`functions/src/**/*.ts\` is included).

When a callable fails, Firebase throws a \`FirebaseFunctionsException\` with \`details.reason\`:
\`\`\`json
{
  "code": "failed-precondition",
  "message": "[FIELD_NOT_EDITABLE] Field(s) not editable.",
  "details": {
    "reason": "FIELD_NOT_EDITABLE",
    "fields": ["showCostToTenant"]
  }
}
\`\`\`

| Error Reason | gRPC / HTTP Code | Meaning | Retryable | UI Recommendation |
|---|---|---|---|---|
${allReasonCodes.map((code) => {
  const meta = REASON_META[code] || ["failed-precondition", `Domain error reason \`${code}\`.`, false, "Display server error message"];
  return `| \`${code}\` | \`${meta[0]}\` | ${meta[1]} | ${meta[2] ? "Yes" : "No"} | ${meta[3]} |`;
}).join("\n")}
`;
fs.writeFileSync(path.join(OUT_DIR, "errors.md"), errorsMd);

// ---------------------------------------------------------------------------
// 7. State Machines: state-machines.md (ALL 13 machines from code)
// ---------------------------------------------------------------------------

const STATE_MACHINES = [
  { name: "bill", initial: "`draft` (or `active`)", transitions: "`draft` → `active` (`billsFinalize`)<br>`active` → `voided` (`billsVoid`) / `cancelled` / `refunded`", terminal: "`voided`, `cancelled`, `refunded`", callables: "`billsCreate`, `billsUpdateDraft`, `billsFinalize`, `billsVoid`" },
  { name: "outflow", initial: "`confirmed` (or `draft`)", transitions: "`draft` → `confirmed`<br>`confirmed` → `voided` (`outflowsVoid`)", terminal: "`voided`", callables: "`outflowsCreate`, `outflowsVoid`" },
  { name: "delivery", initial: "`pending`", transitions: "`pending` → `assigned` → `picked_up` → `out_for_delivery` → `delivered` / `failed` / `returned`", terminal: "`delivered`, `returned`", callables: "`deliveriesCreate`, `deliveriesUpdateStatus`" },
  { name: "return", initial: "`pending` (or `completed`)", transitions: "`pending` → `completed` / `rejected` (`documentsDecide`)", terminal: "`completed`, `rejected`", callables: "`returnsCreate`, `documentsDecide`" },
  { name: "task", initial: "`todo`", transitions: "`todo` → `in_progress` → `completed` / `cancelled`", terminal: "`completed`, `cancelled`", callables: "`tasksCreate`, `tasksUpdateStatus`, `tasksAssign`, `tasksDelete`" },
  { name: "membership", initial: "`active`", transitions: "`active` → `inactive` / `suspended`", terminal: "`inactive`", callables: "`employeesCreate`, `employeesDeactivate`" },
  { name: "organization", initial: "`active`", transitions: "`active` → `inactive` (`organizationsDeactivate`) → `active` (`organizationsReactivate`) / `suspended`", terminal: "`suspended`", callables: "`organizationsCreate`, `organizationsDeactivate`, `organizationsReactivate`" },
  { name: "subscription", initial: "`trial` / `active`", transitions: "`trial` / `active` → `grace` → `expired` (sweep) · any → `suspended` / `cancelled` / `active` (`organizationsSetSubscription`)", terminal: "`cancelled`", callables: "`organizationsSetSubscription`, `subscriptionAndUsageSweep`" },
  { name: "request-approval", initial: "`submitted`", transitions: "`submitted` → `in_review`, `needs_info`, `on_hold`, `approved`, `rejected`, `cancelled`<br>`in_review` → `needs_info`, `on_hold`, `approved`, `rejected`, `cancelled`<br>`needs_info` / `on_hold` → `in_review`, `cancelled`<br>`approved` → `applied` (`requestsApply`), `rejected`", terminal: "`rejected`, `applied`, `cancelled`", callables: "`requestsCreate`, `requestsTransition`, `requestsApply`" },
  { name: "request-work", initial: "`submitted`", transitions: "`submitted` → `in_review`, `in_progress`, `needs_info`, `on_hold`, `resolved`, `declined`, `cancelled`<br>`in_review` → `in_progress`, `needs_info`, `on_hold`, `resolved`, `declined`, `cancelled`<br>`in_progress` → `needs_info`, `on_hold`, `resolved`, `declined`, `cancelled`<br>`needs_info` / `on_hold` → `in_review`, `cancelled`<br>`resolved` → `closed`, `in_review` (reopen)<br>`closed` → `in_review` (reopen within `reopenWindowDays`)", terminal: "`declined`, `cancelled` (`closed` reopenable within window)", callables: "`requestsCreate`, `requestsTransition`, `requestsSlaAndLifecycleSweep`" },
  { name: "stock-transfer", initial: "`draft`", transitions: "`draft` → `submitted` (`stockTransfersSubmit`) / `cancelled`<br>`submitted` → `approved` (`documentsDecide`) / `cancelled`<br>`approved` → `in_transit` (`stockTransfersDispatch`) / `cancelled`<br>`in_transit` → `received` / `discrepancy` (`stockTransfersReceive`)<br>`discrepancy` → `received` (`stockTransfersResolveDiscrepancy`)", terminal: "`received`, `cancelled`", callables: "`stockTransfersCreate`, `stockTransfersSubmit`, `documentsDecide`, `stockTransfersDispatch`, `stockTransfersReceive`, `stockTransfersResolveDiscrepancy`, `stockTransfersCancel`" },
  { name: "payment-processing-fee", initial: "`recorded`", transitions: "`recorded` → `verified` (`paymentsVerifyFee`) / `disputed` (`paymentsDisputeFee`)<br>`recorded` / `verified` / `disputed` → `reversed` (`paymentsReverseFee`)", terminal: "`reversed`", callables: "`paymentsRecordFee`, `paymentsVerifyFee`, `paymentsDisputeFee`, `paymentsReverseFee`" },
  { name: "approval-decision", initial: "`pending`", transitions: "`pending` → `approved` / `rejected` (`documentsDecide` across bills, outflows, returns, stock adjustments, stock transfers)", terminal: "`approved`, `rejected`", callables: "`approvalsList`, `approvalsCounts`, `documentsDecide`" },
];

const stateMachinesMd = `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Document State Machines & Status Transitions

Total state machines: **${STATE_MACHINES.length}**. Derived from backend enums and transition validators.

| Entity | Initial Status | Valid Transitions | Terminal States | Mutating Callables |
|---|---|---|---|---|
${STATE_MACHINES.map((sm) => `| **${sm.name}** | ${sm.initial} | ${sm.transitions} | ${sm.terminal} | ${sm.callables} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT_DIR, "state-machines.md"), stateMachinesMd);

// ---------------------------------------------------------------------------
// 8. Complete Callable API Reference: callables.json, callables/INDEX.md, callables/<domain>.md (B-2)
// ---------------------------------------------------------------------------

function extractHandlerSnippet(exp) {
  const abs = path.join(ROOT, exp.file);
  if (!fs.existsSync(abs)) return "";
  const src = fs.readFileSync(abs, "utf8");
  const start = src.indexOf(`export const ${exp.name} =`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport const ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

function domainOfCallable(exp) {
  const m = exp.file.match(/functions\/src\/callables\/([^/]+?)(?:\/|\.ts$)/);
  return m ? m[1] : "misc";
}

function gateOfCallable(exp, snippet) {
  if (exp.superAdminOnly) return "platform";
  if (/requirePlatformActor|isSuperAdmin\s*!==\s*true|!isSuperAdmin|platform:requests_/.test(snippet) && !exp.gated) return "platform";
  if (exp.gated) return "tenant";
  if (/^(healthCheck|authLogin|authMe|usersUpdateMe|notificationsRegisterFcmToken|notificationsList|notificationsMarkRead|permissionCatalogList|modulesList|taxRegimesList|plansCatalogList|plansList|plansGet|requestsMeta)$/.test(exp.name)) return "public_or_auth";
  return "mixed_tenant_or_platform";
}

function extractPermissions(snippet) {
  const perms = new Set();
  for (const m of snippet.matchAll(/AppPermissions\.([A-Z0-9_]+)/g)) {
    const entry = permissionEntries.find((p) => p.constName === m[1]);
    if (entry) perms.add(entry.key);
  }
  for (const m of snippet.matchAll(/["'](platform:[a-z_:]+|[a-z_]+:[a-z_]+)["']/g)) {
    if (permissionEntries.some((p) => p.key === m[1])) perms.add(m[1]);
  }
  return [...perms].sort();
}

function extractModuleGate(snippet) {
  const m = snippet.match(/requiredModule\s*:\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

function extractErrorsFromSnippet(snippet, gate) {
  const errs = new Set();
  if (gate !== "public_or_auth") errs.add("UNAUTHENTICATED");
  if (gate === "tenant") errs.add("PERMISSION_DENIED");
  if (gate === "platform") errs.add("PERMISSION_DENIED");
  for (const m of snippet.matchAll(/\breason\s*:\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) errs.add(m[1]);
  for (const m of snippet.matchAll(/\b(?:GateReason|RequestReason)\.([A-Z][A-Z0-9_]+)\b/g)) errs.add(m[1]);
  for (const m of snippet.matchAll(/new HttpsError\([^)]*`?["']\[([A-Z][A-Z0-9_]{2,})\]/g)) errs.add(m[1]);
  if (snippet.includes("parseInput(")) {
    errs.add("INVALID_ARGUMENT");
    errs.add("UNKNOWN_FIELD");
  }
  if (snippet.includes("reserveIdempotency(")) errs.add("IDEMPOTENCY_CONFLICT");
  return [...errs].sort();
}

function classifyResponseDescriptor(name, rt) {
  const leaves = (rt && Array.isArray(rt.leaves) ? rt.leaves : []).filter((l) => l.path && l.path.length > 0);
  const rawType = rt?.type ? String(rt.type) : "";
  const topKeys = [...new Set(leaves.map((l) => l.path.split(".")[0].replace(/\[\]$/, "")))];
  const isTopOptionalInType = (k) => new RegExp(`\\b${k}\\?:`).test(rawType);
  const requiredTopKeys = [...new Set(
    leaves
      .filter((l) => !l.optional)
      .map((l) => l.path.split(".")[0].replace(/\[\]$/, ""))
      .filter((k) => !isTopOptionalInType(k))
  )];
  let envelope = "ACTION";
  if (topKeys.includes("items")) envelope = "LIST";
  else if (topKeys.length === 1 && !["success", "message", "ok", "status"].includes(topKeys[0])) envelope = "ENTITY";
  else if (topKeys.includes("request") || topKeys.includes("organization") || topKeys.includes("context")) envelope = "ENTITY";
  else if (topKeys.length === 0) envelope = "CUSTOM";
  return {
    envelope,
    tsType: rt?.type ? String(rt.type).slice(0, 240) : "unknown",
    topLevelKeys: topKeys.sort(),
    requiredTopKeys: requiredTopKeys.sort(),
    leafCount: leaves.length,
    sampleLeaves: leaves.slice(0, 40).map((l) => ({ path: l.path, type: l.type, optional: !!l.optional })),
  };
}

function stateMachineForDomain(domain) {
  const map = {
    bills: "bill", outflows: "outflow", deliveries: "delivery", returns: "return",
    tasks: "task", employees: "membership", organizations: "organization",
    plans: "subscription", requests: "request-approval / request-work",
    stockTransfers: "stock-transfer", paymentFees: "payment-processing-fee",
    approvals: "approval-decision",
  };
  return map[domain] || null;
}

const callablesCatalog = [];
const callablesByDomain = new Map();

for (const exp of callablesList) {
  const snippet = extractHandlerSnippet(exp);
  const domain = domainOfCallable(exp);
  const gate = gateOfCallable(exp, snippet);
  const perms = extractPermissions(snippet);
  const moduleGate = extractModuleGate(snippet);
  const auditEntry = AUDIT_REGISTRY[exp.name] || { action: `${domain}.${exp.kind}`, category: "none", collection: null };
  const schemaName = exp.schemas[0] || null;
  const inputSchemaObj = schemaName ? schemas[schemaName] : null;
  const inputFields = (inputSchemaObj?.leaves || []).map((leaf) => {
    const hint = uiHint(leaf.path, leaf.type);
    return {
      path: leaf.path,
      type: leaf.type,
      required: !!leaf.required,
      nullable: !!leaf.nullable,
      bounds: leaf.bounds || {},
      enumValues: leaf.enumValues || [],
      uiHint: hint,
      example: syntheticExample(leaf.path, leaf.type, hint, leaf.enumValues, leaf.bounds),
    };
  });
  const responseDescriptor = classifyResponseDescriptor(exp.name, responseTypes[exp.name]);
  const errors = extractErrorsFromSnippet(snippet, gate);
  const idempotencyField = exp.idempotent
    ? (inputFields.some((f) => f.path === "clientRequestId") ? "clientRequestId" : "idempotencyKey")
    : null;
  const purpose = `${exp.kind.toUpperCase()} endpoint in ${domain} domain (${auditEntry.action}).`;

  const entry = {
    name: exp.name,
    domain,
    file: exp.file,
    line: exp.line,
    gate,
    kind: exp.kind,
    permissions: perms,
    moduleGate,
    featureFlag: domain === "requests" ? "platformSettings/requests.requestsEnabled" : null,
    idempotent: !!exp.idempotent,
    idempotencyField,
    audit: { action: auditEntry.action, category: auditEntry.category, collection: auditEntry.collection },
    purpose,
    inputSchema: schemaName,
    inputFields,
    response: responseDescriptor,
    errors,
    stateMachine: stateMachineForDomain(domain),
  };

  callablesCatalog.push(entry);
  if (!callablesByDomain.has(domain)) callablesByDomain.set(domain, []);
  callablesByDomain.get(domain).push(entry);
}

// Clean stale domain md files before writing
for (const f of fs.readdirSync(CALLABLES_DIR)) {
  if (f.endsWith(".md")) fs.unlinkSync(path.join(CALLABLES_DIR, f));
}

const responseDocumentedCount = callablesCatalog.filter((c) => c.response.topLevelKeys.length > 0 || c.response.tsType !== "unknown").length;
const errorsDeclaredCount = callablesCatalog.filter((c) => c.errors.length > 0).length;

fs.writeFileSync(
  path.join(OUT_DIR, "callables.json"),
  JSON.stringify({
    version: "2.0.0",
    totalCallables: callablesCatalog.length,
    responseDocumented: responseDocumentedCount,
    errorsDeclared: errorsDeclaredCount,
    callables: callablesCatalog,
  }, null, 2) + "\n"
);

// callables/INDEX.md
const sortedDomains = [...callablesByDomain.keys()].sort();
const indexMdLines = [
  "<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->",
  "# Trado Callable API Reference — Master Index",
  "",
  `Total documented callables: **${callablesCatalog.length}** across **${sortedDomains.length}** domains. Response shapes documented: **${responseDocumentedCount}/${callablesCatalog.length}**. Errors declared: **${errorsDeclaredCount}/${callablesCatalog.length}**.`,
  "",
  "| Callable | Domain | Gate | Permission(s) | Module | Purpose | Reference |",
  "|---|---|---|---|---|---|---|",
  ...callablesCatalog.map((c) => `| \`${c.name}\` | \`${c.domain}\` | \`${c.gate}\` | ${c.permissions.slice(0, 2).map((p) => `\`${p}\``).join(", ") || "—"}${c.permissions.length > 2 ? ` (+${c.permissions.length - 2})` : ""} | ${c.moduleGate ? `\`${c.moduleGate}\`` : "—"} | ${c.purpose} | [${c.domain}.md](./${c.domain}.md) |`),
  "",
];
fs.writeFileSync(path.join(CALLABLES_DIR, "INDEX.md"), indexMdLines.join("\n"));

function buildSyntheticReqObj(fields) {
  const obj = {};
  for (const f of fields.slice(0, 8)) {
    if (!f.path.includes(".") && !f.path.includes("[")) obj[f.path] = f.example;
  }
  return obj;
}

function buildSyntheticResObj(resp) {
  if (resp.envelope === "LIST") return { items: [], count: 0, nextCursor: null };
  const obj = {};
  for (const k of resp.topLevelKeys.slice(0, 8)) {
    obj[k] = k === "success" ? true : k === "count" ? 1 : k.endsWith("Id") ? `${k}_001` : "...";
  }
  return obj;
}

// callables/<domain>.md
for (const domain of sortedDomains) {
  const items = callablesByDomain.get(domain);
  const lines = [
    "<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->",
    `# Callable API Reference — \`${domain}\``,
    "",
    `Back to [Master Index](./INDEX.md).`,
    "",
  ];
  for (const c of items) {
    lines.push(`## \`${c.name}\``);
    lines.push(`- **Domain:** \`${c.domain}\` · **Gate:** \`${c.gate}\` · **Kind:** \`${c.kind}\` · **Source:** \`${c.file}:${c.line}\``);
    lines.push(`- **Permission(s):** ${c.permissions.length ? c.permissions.map((p) => `\`${p}\``).join(", ") : "None (authenticated / role-checked)"} · **Module:** ${c.moduleGate ? `\`${c.moduleGate}\`` : "—"} · **Feature Flag:** ${c.featureFlag ? `\`${c.featureFlag}\`` : "—"}`);
    lines.push(`- **Idempotency:** ${c.idempotent ? `Yes (\`${c.idempotencyField}\`)` : "No"} · **Audit:** \`${c.audit.action}\` (\`${c.audit.category}\`) · **State Machine:** ${c.stateMachine ? `[${c.stateMachine}](../state-machines.md)` : "—"}`);
    lines.push("");
    if (c.inputFields.length > 0) {
      lines.push(`**Input (\`${c.inputSchema}\` — strict, unknown fields rejected):**`);
      lines.push("");
      lines.push("| Field | Type | Required | Bounds / Enum | Example |");
      lines.push("|---|---|---|---|---|");
      for (const f of c.inputFields.slice(0, 35)) {
        const b = f.enumValues?.length ? `Enum: \`${f.enumValues.slice(0, 6).join("`, `")}\`` : Object.keys(f.bounds || {}).length ? JSON.stringify(f.bounds) : "—";
        lines.push(`| \`${f.path}\` | \`${f.type}\` | ${f.required ? "**Yes**" : "No"} | ${b} | \`${f.example}\` |`);
      }
      if (c.inputFields.length > 35) lines.push(`| *...* | *+${c.inputFields.length - 35} nested fields* | | | *See \`callables.json\`* |`);
    } else {
      lines.push(`**Input:** \`${c.inputSchema || "Empty object {}"}\` (no required fields).`);
    }
    lines.push("");
    lines.push(`**Response:** Envelope \`${c.response.envelope}\` · Top-level keys: ${c.response.topLevelKeys.length ? c.response.topLevelKeys.map((k) => `"${k}"`).join(", ") : "(see `callables.json`)"} (${c.response.leafCount} typed leaf paths).`);
    lines.push(`**Declared Errors:** ${c.errors.length ? c.errors.map((e) => `\`${e}\``).join(", ") : "Standard gRPC errors"} (see [errors.md](../errors.md)).`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify({ request: buildSyntheticReqObj(c.inputFields), response: buildSyntheticResObj(c.response) }, null, 2));
    lines.push("```");
    lines.push("");
  }
  fs.writeFileSync(path.join(CALLABLES_DIR, `${domain}.md`), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// 9. Core Top-Level Contract Docs (README, responses, serialization, activity-log, usage-limits, client-meta, CHANGES, SUMMARY)
// ---------------------------------------------------------------------------

fs.writeFileSync(path.join(OUT_DIR, "README.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Trado Flutter Contract Pack (v2.0.0)

Generated automatically by \`node scripts/generate-flutter-contract.js\` (D-35, D-55, D-57).
Freshness and integrity enforced by \`scripts/check-flutter-contract.js\`.

## Contents
- [SUMMARY.md](./SUMMARY.md) — Compact cheatsheet (≤ 250 lines) + contract changelog for Flutter.
- [callables/INDEX.md](./callables/INDEX.md) & [callables.json](./callables.json) — Authoritative reference for all ${callablesCatalog.length} callables (input, response shape, permissions, gate, errors).
- \`forms/\` — ${entityFormStats.length} entity/action forms + 15 request-detail schemas.
- [permissions.md](./permissions.md) & [permissions.json](./permissions.json) — ${concretePermissions.length} concrete permission keys with descriptions, default roles, and scope notes.
- [auth.md](./auth.md) — \`authMe\` / \`authLogin\` session bootstrap contract (\`primaryOrganization.timezone\`, \`organization_selection_required\`).
- [images.md](./images.md) — \`ImageRef\` (\`path\`, \`uploadId\`) pipeline, limits, and entity shapes.
- [errors.md](./errors.md) — All ${allReasonCodes.length} stable error reason codes.
- [state-machines.md](./state-machines.md) — All ${STATE_MACHINES.length} entity state machines.
- [responses.md](./responses.md) · [serialization.md](./serialization.md) · [activity-log.md](./activity-log.md) · [usage-limits.md](./usage-limits.md) · [client-meta-and-idempotency.md](./client-meta-and-idempotency.md) · [CHANGES.md](./CHANGES.md).

## Generation Command
\`\`\`bash
npm --prefix functions run contract:generate
\`\`\`
`);

fs.writeFileSync(path.join(OUT_DIR, "responses.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Response Conventions (D-18)

All Cloud Function callables return JSON objects adhering to standard response envelopes (see [callables.json](./callables.json) for exact per-callable keys):
- **Single Entity:** \`{ "<entity>": { ... } }\`
- **List:** \`{ "items": [...], "count": N, "totalCount": M, "nextCursor": "...", "included": { ... } }\`
- **Action Result:** Documented result keys (e.g. \`{ "success": true, "message": "..." }\`).
`);

fs.writeFileSync(path.join(OUT_DIR, "serialization.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Data Serialization & Type Conventions

## 1. Dates and Timestamps
- Server timestamps are serialized as ISO 8601 UTC strings: \`"2026-11-18T05:30:00.000Z"\`.
- Calendar dates without time are serialized as YYYY-MM-DD: \`"2026-11-18"\`.

## 2. Monetary Values (Decimal Major Units)
All prices, discounts, line totals, taxes, balances, and payments are stored and transferred as **decimal numbers in the major unit** of the organization's currency, rounded strictly via \`Money.amount(value, currency)\` to the currency's ISO 4217 exponent:
- ₹25.00 (2 decimals for INR/AED/USD/EUR) is serialized as \`25\` or \`25.5\`.
- BD 1.250 (3 decimals for BHD/OMR/KWD) is serialized as \`1.25\` or \`1.250\`.
- ¥1250 (0 decimals for JPY) is serialized as \`1250\` (integer major units).
Form amount fields include \`currencyExponentFrom: organization.currencyInfo.exponent\` and specify \`uiHint: money\`.

## 3. ImageRef Storage (D-5, D-15)
- Raw image URLs are **never stored** in Firestore.
- Stored field is \`image\` of type \`ImageRef\`: \`{ "path": "orgs/123/products/prod_1/main.webp", "contentType": "image/webp", "width": 800, "height": 600, "sizeBytes": 42100, "updatedAt": "2026-11-18T12:00:00.000Z" }\` (see [images.md](./images.md)).
- On write, clients upload to \`uploadPath\` from \`imagesCreateUploadSession\` and pass \`uploadId\`. Read-time hydration provides computed \`imageUrl\`.
`);

fs.writeFileSync(path.join(OUT_DIR, "activity-log.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Activity Log & Audit Trail

- \`auditLogsList\`: Filtered, cursor-paginated timeline (\`actorUserId\`, \`entityType\`, \`entityId\`, \`operation\`, \`status\`, \`branchId\`, \`from\`, \`to\`, \`limit\`, \`cursor\`).
- \`auditGetEntityHistory\`: Chronological field-level mutation history for a single entity ID.
- Scope rule (A-02): \`audit:read_own\` restricts results strictly to \`actorUid == callerUid\` (\`ownActivityOnly: true\`); \`audit:view\` returns organization-wide logs (IP addresses always omitted on tenant reads).
`);

fs.writeFileSync(path.join(OUT_DIR, "usage-limits.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Subscription Usage Limits & Real-Time Warnings

- \`usageGetLimits\`: Effective daily/monthly limits, observed counts, and warning flags.
- \`usageGetDetail\`: Time-series breakdown by day, service, and user (\`usage:read_users\`).
- \`usageUpdateLimits\`: Super Admin callable to configure tenant quota overrides (form: [usage_limits.json](./forms/usage_limits.json)).
- Enforcement: \`hard_block\` rejects with \`USAGE_LIMIT_EXCEEDED\` (\`resource-exhausted\`); \`warn_only\` attaches a "usageWarning" object in the response.
`);

fs.writeFileSync(path.join(OUT_DIR, "client-meta-and-idempotency.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Client Metadata & Idempotency

## 1. Request Telemetry (\`_meta\`)
Supply \`_meta\` in callable payloads:
\`\`\`json
{
  "_meta": {
    "clientRequestId": "req_uuid_1234",
    "deviceId": "dev_device_hardware_id",
    "platform": "android",
    "appVersion": "1.2.0"
  }
}
\`\`\`

## 2. Idempotency Key (\`idempotencyKey\`)
Critical mutation callables accept \`idempotencyKey\` (or \`clientRequestId\` on image pipeline callables). Identical key + payload replays cached result; identical key + different payload fails with \`IDEMPOTENCY_CONFLICT\`.

## 3. Image Upload Sequence (see [images.md](./images.md))
1. Call \`imagesCreateUploadSession\` with \`purpose\` (\`org_logo\` | \`user_photo\` | \`party_photo\` | \`product_image\`).
2. Upload binary bytes to Storage at the returned \`uploadPath\` (\`tmp/{scope}/{uid}/{uploadId}\`).
3. Pass \`uploadId\` in entity create/update (or call \`imagesAttach\`); backend stores \`ImageRef\` (\`{ path, contentType, width, height, sizeBytes, updatedAt, thumbnailPath? }\`) and hydrates \`imageUrl\` on read.
`);

fs.writeFileSync(path.join(OUT_DIR, "CHANGES.md"), `<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->
# Backend Contract Changes

## Hybrid Prompt 76 — BX1 Contract & API Reference Overhaul
1. **Complete Callable Reference (D-55):** Generated \`callables.json\`, \`callables/INDEX.md\`, and \`callables/<domain>.md\` for all ${callablesCatalog.length} callables with TypeScript-derived response descriptors.
2. **Structured Form Callables (MG-06, MG-38):** Replaced overloaded \`callables.update\` with \`{ create?, get?, list?, update?, delete?, void?, actions: [{name, kind}] }\`; removed 4 non-existent callable names.
3. **Approval Request & Action Forms (MG-04, MG-15):** Fixed \`forms/approval_request.json\` (\`DocumentDecisionSchema\` / \`documentsDecide\`, non-zero fields) and added \`user_profile\`, \`ownership_transfer\`, \`sharing_policy\`, \`usage_limits\`.
4. **UI Hint & ImageRef Fixes (MG-01, MG-05):** Restricted \`uiHint: "money"\` strictly to numeric fields (\`customer.priceGroup\` is now \`text\` with example \`"retail"\`); added \`images.md\` and fixed \`storagePath\` → \`path\`/\`uploadId\` docs.
5. **Auth & Permissions Machine Catalogs (MG-02, MG-03, MG-07):** Added \`auth.md\` (including \`primaryOrganization.timezone\`) and \`permissions.json\` (${concretePermissions.length} concrete keys with descriptions, default roles, and scope notes).
6. **Complete Errors & State Machines (TB-4, TB-5):** Expanded \`errors.md\` to all ${allReasonCodes.length} thrown reason codes (reopen window default 14 days) and \`state-machines.md\` to all ${STATE_MACHINES.length} code state machines.
7. **Money & Currency Convention (Prompt 77D):** All monetary values are decimal numbers in major units (ISO 4217 exponent), validated with \`assertAmountMatchesCurrency\`; forms specify \`uiHint: money\` and \`currencyExponentFrom: organization.currencyInfo.exponent\`.
`);

// 10. SUMMARY.md (strictly <= 250 lines, B-4)
const summaryLines = [
  "<!-- Generated by scripts/generate-flutter-contract.js. Do not edit. -->",
  "# Trado Flutter Backend Contract — Summary Cheatsheet",
  "<!-- ATTACH THIS FILE TO CLAUDE FOR FLUTTER CODE GENERATION -->",
  "",
  "## 1. Conventions & Authoritative References",
  `- **Callable Reference (${callablesCatalog.length}/${callablesCatalog.length}):** [callables/INDEX.md](./callables/INDEX.md) & [callables.json](./callables.json)`,
  `- **Single Entity / List (D-18):** \`{ "<entity>": { ... } }\` | \`{ "items": [...], "count": N, "nextCursor": "...", "included": { ... } }\``,
  `- **Money:** Decimal major units (e.g. 12.50 AED, 1.250 BHD, 500 INR) per org \`currencyInfo.exponent\` derived from \`currencies.ts\`.`,
  `- **Timestamps:** ISO 8601 UTC strings; local dates \`YYYY-MM-DD\`; org timezone from \`authMe\` → \`context.primaryOrganization.timezone\` ([auth.md](./auth.md)).`,
  `- **Images:** Upload to \`uploadPath\` via \`imagesCreateUploadSession\`, pass \`uploadId\`; stored as \`ImageRef { path, contentType, width, height, sizeBytes, updatedAt, thumbnailPath? }\`; read as hydrated \`imageUrl\` ([images.md](./images.md)).`,
  `- **Permissions (${concretePermissions.length} concrete):** [permissions.json](./permissions.json) · **Errors (${allReasonCodes.length} codes):** [errors.md](./errors.md) · **State Machines (${STATE_MACHINES.length}):** [state-machines.md](./state-machines.md)`,
  "",
  "## 2. Contract Changes Since Last Pack (Read First for Flutter Prompt 80)",
  `- \`forms/*.json\` \`callables\` shape changed from \`{ create, update }\` to \`{ create?, get?, list?, update?, delete?, void?, actions: [{ name, kind }] }\` (MG-06).`,
  `- Removed 4 non-existent form callables (\`approvalsDecide\` → \`documentsDecide\`, \`stockGetLevels\` → \`stockMovementsList\`, \`jobRolesDelete\` → \`jobRolesUpdate\`, \`departmentsDelete\` → \`departmentsUpdate\`).`,
  `- \`forms/approval_request.json\` now has real \`DocumentDecisionSchema\` fields (> 0 fields, MG-15).`,
  `- Added 4 new forms: \`user_profile\`, \`ownership_transfer\`, \`sharing_policy\`, \`usage_limits\` (total ${entityFormStats.length} entity/action forms + 15 request-detail forms).`,
  `- \`forms/organization.json\` now includes per-field \`editableBy\` and \`operations.update\` actor map (MG-12).`,
  `- \`customer.priceGroup\` fixed from \`uiHint: money\` to \`uiHint: text\` with example \`"retail"\` (MG-05).`,
  `- Added machine-readable \`callables.json\`, \`permissions.json\`, \`images.md\`, and \`auth.md\`.`,
  `- \`errors.md\` expanded from 24 to ${allReasonCodes.length} thrown reason codes; \`REQUEST_REOPEN_WINDOW_CLOSED\` now reflects configurable \`reopenWindowDays\` (default 14 days).`,
  `- \`state-machines.md\` expanded from 9 to ${STATE_MACHINES.length} machines (DeliveryStatus fixed to \`picked_up\`/\`out_for_delivery\`/\`returned\`; added \`subscription\`, \`stock-transfer\`, \`payment-processing-fee\`, \`approval-decision\`).`,
  "",
  `## 3. Entity & Action Forms Matrix (${entityFormStats.length} forms)`,
  "| Entity | Primary Callable | Req | Opt | Updatable |",
  "|---|---|---|---|---|",
  ...entityFormStats.map((s) => `| \`${s.entity}\` | \`${s.primaryCallable}\` | ${s.required} | ${s.optional} | ${s.updatable} |`),
  "",
  "## 4. Activity Logs & Usage Quotas",
  "- **Audit (`auditLogsList`):** Filters `actorUserId`, `entityType`, `entityId`, `operation`, `status`, `branchId`, `from`, `to`, `limit`, `cursor`. `audit:read_own` restricts to `actorUid == callerUid`.",
  "- **Usage (`usageGetLimits`):** Daily/monthly quotas; `hard_block` → `USAGE_LIMIT_EXCEEDED`, `warn_only` → attaches a usage-warning payload.",
  "",
];

const summaryContent = summaryLines.join("\n");
const summaryLineCount = summaryContent.split("\n").length;
if (summaryLineCount > 250) {
  throw new Error(`SUMMARY.md exceeded 250 lines (${summaryLineCount})`);
}
fs.writeFileSync(path.join(OUT_DIR, "SUMMARY.md"), summaryContent);

// ---------------------------------------------------------------------------
// 11. Deterministic Integrity Checksum Manifest (.checksum.json for BM-1 / D-N5)
// ---------------------------------------------------------------------------

const checksumFiles = {};
const walkOut = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkOut(abs);
    else if (entry.name !== ".checksum.json") {
      const relPath = path.relative(OUT_DIR, abs).replace(/\\/g, "/");
      const content = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
      checksumFiles[relPath] = crypto.createHash("sha256").update(content).digest("hex");
    }
  }
};
walkOut(OUT_DIR);
const sortedChecksums = Object.fromEntries(Object.keys(checksumFiles).sort().map((k) => [k, checksumFiles[k]]));
fs.writeFileSync(
  path.join(OUT_DIR, ".checksum.json"),
  JSON.stringify({ generator: "scripts/generate-flutter-contract.js", fileCount: Object.keys(sortedChecksums).length, files: sortedChecksums }, null, 2) + "\n"
);

console.log(`✓ Flutter Contract Pack generated: ${callablesCatalog.length} callables, ${entityFormStats.length} entity forms, ${concretePermissions.length} permissions, ${allReasonCodes.length} error codes, ${STATE_MACHINES.length} state machines, SUMMARY.md ${summaryLineCount} lines (${Object.keys(sortedChecksums).length} tracked files).`);
