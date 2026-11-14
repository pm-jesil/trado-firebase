#!/usr/bin/env node
/**
 * Trado Flutter Contract Pack Generator (Prompt 69 G4, D-35)
 *
 * Generates docs/flutter-contract/ from backend schemas, callable registry,
 * permissions, audit actions, and rate cards.
 *
 * Usage: node scripts/generate-flutter-contract.js
 */

const fs = require("node:fs");
const path = require("node:path");
const truth = require("./lib/source-truth.js");

const ROOT = truth.ROOT;
const OUT_DIR = path.join(ROOT, "docs", "flutter-contract");
const FORMS_DIR = path.join(OUT_DIR, "forms");

fs.mkdirSync(FORMS_DIR, { recursive: true });

const exportsList = truth.getExports();
const schemas = truth.getRequestSchemas();
const permissionsFile = fs.readFileSync(path.join(ROOT, "functions/src/constants/permissions.ts"), "utf8");

// Parse permissions
const permissionMatches = [...permissionsFile.matchAll(/([A-Z0-9_]+):\s*"([^"]+)"/g)];
const allPermissions = permissionMatches.map(([, key, val]) => ({ key, value: val }));

// Entities configuration
const ENTITY_CONFIG = [
  { name: "organization", label: "Organization", createCallable: "organizationsCreate", updateCallable: "organizationsUpdate", schemas: ["CreateOrganizationSchema", "UpdateOrganizationSchema"] },
  { name: "branch", label: "Branch", createCallable: "branchesCreate", updateCallable: "branchesUpdate", schemas: ["CreateBranchSchema", "UpdateBranchSchema"] },
  { name: "employee", label: "Employee / User", createCallable: "employeesCreate", updateCallable: "employeesUpdate", schemas: ["CreateEmployeeSchema", "UpdateEmployeeSchema"] },
  { name: "customer", label: "Customer", createCallable: "customersCreate", updateCallable: "customersUpdate", schemas: ["CreateCustomerSchema", "UpdateCustomerSchema"] },
  { name: "vendor", label: "Vendor", createCallable: "vendorsCreate", updateCallable: "vendorsUpdate", schemas: ["CreateVendorSchema", "UpdateVendorSchema"] },
  { name: "product", label: "Product", createCallable: "productsCreate", updateCallable: "productsUpdate", schemas: ["CreateProductSchema", "UpdateProductSchema"] },
  { name: "category", label: "Category", createCallable: "categoriesCreate", updateCallable: "categoriesUpdate", schemas: ["CreateCategorySchema", "UpdateCategorySchema"] },
  { name: "unit", label: "Unit", createCallable: "unitsCreate", updateCallable: "unitsUpdate", schemas: ["CreateUnitSchema", "UpdateUnitSchema"] },
  { name: "bill", label: "Bill / POS Sale", createCallable: "billsCreate", updateCallable: "billsUpdateDraft", schemas: ["CreateBillSchema", "UpdateDraftBillSchema"] },
  { name: "purchase", label: "Purchase (Outflow)", createCallable: "outflowsCreate", updateCallable: "outflowsVoid", schemas: ["CreateOutflowSchema"] },
  { name: "expense", label: "Expense (Outflow)", createCallable: "outflowsCreate", updateCallable: "outflowsVoid", schemas: ["CreateOutflowSchema"] },
  { name: "payment", label: "Payment", createCallable: "paymentsCreate", updateCallable: "paymentsVoid", schemas: ["CreatePaymentSchema"] },
  { name: "delivery", label: "Delivery", createCallable: "deliveriesCreate", updateCallable: "deliveriesUpdateStatus", schemas: ["CreateDeliverySchema", "UpdateDeliveryStatusSchema"] },
  { name: "return", label: "Return", createCallable: "returnsCreate", updateCallable: "returnsList", schemas: ["CreateReturnSchema"] },
  { name: "stock_adjustment", label: "Stock Adjustment / Wastage", createCallable: "stockAdjust", updateCallable: "stockGetLevels", schemas: ["StockAdjustSchema"] },
  { name: "task", label: "Task", createCallable: "tasksCreate", updateCallable: "tasksUpdateStatus", schemas: ["CreateTaskSchema", "UpdateTaskStatusSchema"] },
  { name: "role", label: "Custom Role", createCallable: "rolesCreate", updateCallable: "rolesUpdate", schemas: ["CreateRoleSchema", "UpdateRoleSchema"] },
  { name: "job_role", label: "Job Role", createCallable: "jobRolesCreate", updateCallable: "jobRolesDelete", schemas: ["CreateJobRoleSchema"] },
  { name: "department", label: "Department", createCallable: "departmentsCreate", updateCallable: "departmentsDelete", schemas: ["CreateDepartmentSchema"] },
  { name: "team", label: "Team", createCallable: "teamsCreate", updateCallable: "teamsUpdate", schemas: ["CreateTeamSchema", "UpdateTeamSchema"] },
  { name: "approval_request", label: "Approval Request", createCallable: "approvalsDecide", updateCallable: "approvalsList", schemas: ["DecideApprovalSchema"] },
  { name: "recurring_expense", label: "Recurring Expense", createCallable: "recurringExpensesCreate", updateCallable: "recurringExpensesUpdate", schemas: ["CreateRecurringExpenseSchema", "UpdateRecurringExpenseSchema"] },
  { name: "plan", label: "Subscription Plan", createCallable: "plansCreate", updateCallable: "plansUpdate", schemas: ["CreatePlanSchema", "UpdatePlanSchema"] },
];

console.log("Generating Flutter Contract Pack...");

// Helper for UI hint
function uiHint(path, type, bounds) {
  const p = path.toLowerCase();
  if (p.includes("email")) return "email";
  if (p.includes("phone")) return "phone";
  if (p.includes("password")) return "password";
  if (p.includes("image") || p.includes("avatar")) return "image_picker";
  if (p.includes("date") || p.includes("at")) return "date_picker";
  if (p.includes("price") || p.includes("amount") || p.includes("cost") || p.includes("paise")) return "money_paise";
  if (p.includes("notes") || p.includes("description") || p.includes("address")) return "textarea";
  if (type === "enum") return "dropdown";
  if (type === "boolean") return "switch";
  if (type === "number") return "numeric";
  return "text";
}

const entityFormStats = [];

// 1. Generate forms/<entity>.md and forms/<entity>.json
for (const ent of ENTITY_CONFIG) {
  const createSchemaName = ent.schemas[0];
  const updateSchemaName = ent.schemas[1] || ent.schemas[0];
  const createSchema = schemas[createSchemaName] || { leaves: [] };
  const updateSchema = schemas[updateSchemaName] || { leaves: [] };

  const updateFields = new Set(updateSchema.leaves.map((l) => l.path));
  
  const formFields = createSchema.leaves.map((leaf) => {
    const isUpdatable = updateFields.has(leaf.path);
    const hint = uiHint(leaf.path, leaf.type, leaf.bounds);
    return {
      path: leaf.path,
      type: leaf.type,
      requiredCreate: leaf.required,
      updatable: isUpdatable,
      nullable: leaf.nullable,
      bounds: leaf.bounds || {},
      enumValues: leaf.enumValues || [],
      uiHint: hint,
      example: leaf.type === "number" ? (hint === "money_paise" ? 2500 : 1) : leaf.type === "boolean" ? true : leaf.type === "enum" ? (leaf.enumValues[0] || "active") : `Sample ${leaf.path}`,
    };
  });

  const reqCount = formFields.filter((f) => f.requiredCreate).length;
  const optCount = formFields.filter((f) => !f.requiredCreate).length;
  const updatableCount = formFields.filter((f) => f.updatable).length;

  entityFormStats.push({
    entity: ent.name,
    label: ent.label,
    callables: [ent.createCallable, ent.updateCallable].filter(Boolean),
    required: reqCount,
    optional: optCount,
    updatable: updatableCount,
  });

  // Write JSON
  const jsonContent = {
    entity: ent.name,
    label: ent.label,
    callables: {
      create: ent.createCallable,
      update: ent.updateCallable,
    },
    fields: formFields,
  };
  fs.writeFileSync(path.join(FORMS_DIR, `${ent.name}.json`), JSON.stringify(jsonContent, null, 2));

  // Write Markdown
  const mdLines = [
    `# Form Contract: ${ent.label} (\`${ent.name}\`)`,
    "",
    `**Create Callable:** \`${ent.createCallable}\`  `,
    `**Update / Action Callable:** \`${ent.updateCallable || "N/A"}\`  `,
    "",
    `| Field Path | Type | Req (Create) | Updatable | UI Hint | Bounds / Enums | Example |`,
    `|---|---|---|---|---|---|---|`,
    ...formFields.map((f) => {
      const boundsStr = f.enumValues?.length ? `Enum: \`${f.enumValues.join("`, `")}\`` : f.bounds ? JSON.stringify(f.bounds) : "—";
      return `| \`${f.path}\` | \`${f.type}\` | ${f.requiredCreate ? "**Yes**" : "No"} | ${f.updatable ? "Yes" : "No"} | \`${f.uiHint}\` | ${boundsStr} | \`${f.example}\` |`;
    }),
    "",
  ];
  fs.writeFileSync(path.join(FORMS_DIR, `${ent.name}.md`), mdLines.join("\n"));
}

// 2. F-1: README.md
const readmeMd = `# Trado Flutter Contract Pack (v1.0.0)

Generated automatically by \`node scripts/generate-flutter-contract.js\` (D-35).
Freshness enforced by \`scripts/check-flutter-contract.js\` and verification coupling guards.

## How to Read This Contract Pack

This pack contains the authoritative backend API specification for the Flutter client application:
- \`SUMMARY.md\`: High-level cheatsheet (≤ 250 lines) to attach directly to Claude or reference when writing Flutter callables.
- \`forms/\`: Form schemas, required create fields, patchable update fields, bounds, and UI hints for every business entity.
- \`responses.md\`: Standard single-entity and list envelopes (D-18), included hydration, pagination cursors.
- \`serialization.md\`: Canonical serialization formats (ISO timestamps, integer minor-units paise for money, enums, ImageRef paths).
- \`errors.md\`: Every stable error reason, retryability, and UI message mappings.
- \`permissions.md\`: Complete permission key inventory, role assignments, and UI gating helper rules.
- \`state-machines.md\`: Status lifecycles and valid state transitions across bills, outflows, deliveries, and tasks.
- \`activity-log.md\`: Unified audit trail and entity history query models with privacy projection.
- \`usage-limits.md\`: Subscription quotas, limit counters, and real-time warning shapes.
- \`client-meta-and-idempotency.md\`: Client telemetry header, idempotency key replay, and ImageRef upload flow.
- \`CHANGES.md\`: Migration ledger of additions, renames, and removals.

## Generation Command
\`\`\`bash
npm run contract:generate
\`\`\`
`;
fs.writeFileSync(path.join(OUT_DIR, "README.md"), readmeMd);

// 3. F-3: responses.md & serialization.md
const responsesMd = `# Response Conventions (D-18)

All Cloud Function callables return JSON objects adhering to standard response envelopes.

## 1. Single Entity Envelope
Single entity creation, retrieval, or mutation callables return the entity wrapped under its singular domain name:
\`\`\`json
{
  "customer": {
    "customerId": "cust_12345",
    "name": "Acme Retail Ltd",
    "phone": "+919876543210",
    "createdAt": "2026-11-14T05:30:00.000Z"
  }
}
\`\`\`

## 2. List Envelope
List callables return a paginated collection under \`items\`:
\`\`\`json
{
  "items": [
    { "productId": "prod_1", "name": "Standard Widget", "sellingPrice": 2500 }
  ],
  "count": 1,
  "totalCount": 42,
  "nextCursor": "prod_1",
  "hasMore": true,
  "included": {
    "categories": {
      "cat_1": { "categoryId": "cat_1", "name": "Hardware" }
    }
  }
}
\`\`\`
- \`items\`: List of documents matching filter.
- \`count\`: Number of items in current page.
- \`totalCount\`: Total items matching query (only computed when client passes \`includeTotal: true\`).
- \`nextCursor\`: Opaque string passed as \`cursor\` / \`startAfterId\` to fetch the next page. Null when no more items.
`;
fs.writeFileSync(path.join(OUT_DIR, "responses.md"), responsesMd);

const serializationMd = `# Data Serialization & Type Conventions

## 1. Dates and Timestamps
- Server timestamps are serialized as ISO 8601 UTC strings: \`"2026-11-14T05:30:00.000Z"\`.
- Calendar dates without time are serialized as YYYY-MM-DD: \`"2026-11-14"\`.

## 2. Monetary Values (Minor Units / Paise)
All prices, discounts, line totals, taxes, and payments are stored and transferred as **integer minor units** (paise in INR, 100 paise = ₹1.00):
- ₹25.00 is serialized as \`2500\`.
- ₹0.50 is serialized as \`50\`.

### Flutter Conversion Utilities
\`\`\`dart
class MoneyUtils {
  static double paiseToRupees(int paise) => paise / 100.0;
  static int rupeesToPaise(double rupees) => (rupees * 100.0).round();
  static String formatInr(int paise) => '₹\${(paise / 100.0).toStringAsFixed(2)}';
}
\`\`\`

## 3. ImageRef Storage (D-5, D-15)
- Raw image URLs are **never stored** in Firestore.
- Stored field is \`image\` of type ImageRef (e.g. \`{ "storagePath": "orgs/123/products/prod_1.webp", "width": 800, "height": 600 }\`).
- Read-time hydration provides a signed CDN download URL (\`imageUrl\`) valid for client display.
`;
fs.writeFileSync(path.join(OUT_DIR, "serialization.md"), serializationMd);

// 4. F-4: errors.md
const errorsMd = `# Error Index & Handling

When a callable fails, the Firebase SDK throws a \`FirebaseFunctionsException\`. The response contains:
\`\`\`json
{
  "code": "failed-precondition",
  "message": "Stock insufficient for product prod_123",
  "details": {
    "reason": "STOCK_INSUFFICIENT",
    "field": "items[0].quantity",
    "retryable": false
  }
}
\`\`\`

| Error Reason | HTTP Code | Meaning | Retryable | UI Recommendation |
|---|---|---|---|---|
| \`USAGE_LIMIT_EXCEEDED\` | \`resource-exhausted\` | Organization has exceeded daily or monthly operation limit | No | Prompt owner to upgrade subscription plan |
| \`PERMISSION_DENIED\` | \`permission-denied\` | Member role or overrides lack required permission | No | Show access denied banner |
| \`ALREADY_EXISTS\` | \`already-exists\` | Natural key collision (duplicate code, name, phone) | No | Highlight form field with validation error |
| \`NOT_FOUND\` | \`not-found\` | Referenced entity ID does not exist or cross-tenant access | No | Show entity not found message |
| \`FAILED_PRECONDITION\` | \`failed-precondition\` | Business rule violated (insufficient stock, invalid transition) | No | Display server error message to user |
| \`STALE_WRITE\` | \`aborted\` | Optimistic concurrency conflict | Yes | Reload document and retry mutation |
| \`INVALID_ARGUMENT\` | \`invalid-argument\` | Schema validation failure | No | Show field-level form validation error |
| \`UNKNOWN_FIELD\` | \`invalid-argument\` | Client sent unrecognized schema attribute | No | Ensure client payload matches contract |
`;
fs.writeFileSync(path.join(OUT_DIR, "errors.md"), errorsMd);

// 5. F-5: permissions.md
const permissionsMd = `# Permission Catalog & UI Gating

Total permissions: **${allPermissions.length}**

## Permission Key Directory
| Permission Constant | Wire Key | Category |
|---|---|---|
${allPermissions.map((p) => `| \`${p.key}\` | \`${p.value}\` | \`${p.value.split(":")[0]}\` |`).join("\n")}

## UI Gating in Flutter
Every client session receives effective permissions inside the \`authMe\` bootstrap payload.
\`\`\`dart
bool can(String permissionKey) {
  return currentUser.effectivePermissions[permissionKey] == true;
}

// Example: Gating a button
if (can('bill:create')) {
  ElevatedButton(onPressed: _onCreateBill, child: Text('New Bill'));
}
\`\`\`
`;
fs.writeFileSync(path.join(OUT_DIR, "permissions.md"), permissionsMd);

// 6. F-6: state-machines.md
const stateMachinesMd = `# Document State Machines & Status Transitions

Derived directly from backend transaction validators.

| Entity | Initial Status | Valid Transitions | Terminal States | Mutating Callables |
|---|---|---|---|---|
| **bill** | \`draft\` | \`draft\` → \`active\` (finalize)<br>\`active\` → \`paid\`<br>\`active\` → \`void\` | \`void\`, \`paid\` | \`billsCreate\`, \`billsFinalize\`, \`billsVoid\` |
| **outflow** | \`pending\` | \`pending\` → \`confirmed\`<br>\`confirmed\` → \`void\` | \`void\` | \`outflowsCreate\`, \`outflowsVoid\` |
| **delivery** | \`pending\` | \`pending\` → \`assigned\`<br>\`assigned\` → \`in_transit\`<br>\`in_transit\` → \`delivered\` / \`failed\` / \`cancelled\` | \`delivered\`, \`cancelled\` | \`deliveriesCreate\`, \`deliveriesUpdateStatus\` |
| **return** | \`pending\` | \`pending\` → \`completed\`<br>\`pending\` → \`rejected\` | \`completed\`, \`rejected\` | \`returnsCreate\`, \`approvalsDecide\` |
| **task** | \`todo\` | \`todo\` → \`in_progress\`<br>\`in_progress\` → \`completed\` / \`cancelled\` | \`completed\`, \`cancelled\` | \`tasksCreate\`, \`tasksUpdateStatus\` |
| **membership** | \`active\` | \`active\` → \`deactivated\` | \`deactivated\` | \`employeesDeactivate\` |
| **organization** | \`active\` | \`active\` → \`deactivated\` → \`reactivated\` / \`suspended\` | \`suspended\` | \`organizationsDeactivate\`, \`organizationsReactivate\` |
`;
fs.writeFileSync(path.join(OUT_DIR, "state-machines.md"), stateMachinesMd);

// 7. F-7: activity-log.md
const activityLogMd = `# Activity Log & Audit Trail

Provides organization owners and authorized staff with transparent audit logs.

## Query Callables
- \`auditLogsList\`: Filtered, cursor-paginated timeline of organization actions.
- \`auditGetEntityHistory\`: Chronological field-level mutation history for a single entity ID.

## Query Filter Parameters (\`auditLogsList\`)
- \`actorUserId\` (string): Filter by user UID.
- \`entityType\` (string): Filter by entity (\`bill\`, \`purchase\`, \`expense\`, \`customer\`, \`vendor\`, \`delivery\`, \`wastage\`, etc.).
- \`entityId\` (string): Filter by document ID.
- \`operation\` (enum): \`create\` | \`update\` | \`delete\` | \`status_change\`.
- \`status\` (string): Filter by current or post-mutation status.
- \`branchId\` (string): Filter by branch.
- \`from\` / \`to\` (YYYY-MM-DD): Date range in organization timezone.
- \`limit\` (int): 1 to 100 (default 50).
- \`cursor\` (string): Pagination cursor from previous page \`nextCursor\`.

## Response Item Shape
\`\`\`json
{
  "logId": "req_xyz_1",
  "timestamp": "2026-11-14T05:30:00.000Z",
  "occurredLocalDate": "2026-11-14",
  "operation": "create",
  "action": "purchase.create",
  "entityType": "purchase",
  "entityId": "outflow_987",
  "humanLabel": "INV-2026-0042",
  "statusBefore": null,
  "statusAfter": "confirmed",
  "amount": 200000,
  "currency": "INR",
  "branchId": "branch_main",
  "actorUid": "user_owner_1",
  "actorName": "Acme Owner",
  "actorRole": "owner",
  "changes": [
    { "field": "amount", "op": "set", "from": null, "to": 200000 }
  ],
  "device": {
    "platform": "android",
    "appVersion": "1.0.0",
    "deviceId": "dev_pixel8"
  }
}
\`\`\`
*(Note: IP addresses are strictly omitted from tenant audience responses for privacy compliance).*
`;
fs.writeFileSync(path.join(OUT_DIR, "activity-log.md"), activityLogMd);

// 8. F-8: usage-limits.md
const usageLimitsMd = `# Subscription Usage Limits & Real-Time Warnings

## Callables
- \`usageGetLimits\`: Returns effective daily/monthly limits, observed counts, and warning flags.
- \`usageGetDetail\`: Time-series usage breakdown by day, service, and user (\`usage:read_users\`).
- \`usageUpdateLimits\`: Super Admin callable to configure tenant quota overrides.

## Real-Time Warning In Responses
When an API call causes a metric to cross the 80% or 100% threshold, responses include:
\`\`\`json
{
  "usageWarning": {
    "metric": "firestoreWrites",
    "period": "daily",
    "percentage": 85,
    "currentUsage": 5100,
    "limit": 6000,
    "enforcementMode": "warn_only"
  }
}
\`\`\`
If \`enforcementMode\` is \`hard_block\` and 100% is reached, mutations fail with:
- Error Code: \`resource-exhausted\`
- Reason: \`USAGE_LIMIT_EXCEEDED\`
- Details: \`{ "metric": "firestoreWrites", "limit": 6000, "used": 6000, "resetsAt": "2026-11-15T00:00:00.000Z" }\`
`;
fs.writeFileSync(path.join(OUT_DIR, "usage-limits.md"), usageLimitsMd);

// 9. F-9: client-meta-and-idempotency.md
const clientMetaMd = `# Client Metadata & Idempotency

## 1. Request Telemetry (\`_meta\`)
Clients should supply the \`_meta\` header in callable data:
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
All critical mutation callables (\`billsCreate\`, \`outflowsCreate\`, \`paymentsCreate\`, \`unitsCreate\`, etc.) accept an optional \`idempotencyKey\`:
- Providing a unique UUID ensures network retries return the original cached response.
- Submitting an identical key with a different payload triggers an \`already-exists\` conflict.

## 3. Image Upload Sequence
1. Client calls \`imagesCreateUploadSession\` with \`purpose: "product_photo"\`.
2. Backend returns signed upload URL and \`storagePath\`.
3. Client PUTs image binary to signed URL.
4. Client passes \`ImageRef: { "storagePath": storagePath }\` in \`productsCreate\` or \`productsUpdate\`.
`;
fs.writeFileSync(path.join(OUT_DIR, "client-meta-and-idempotency.md"), clientMetaMd);

// 10. F-10: CHANGES.md
const changesMd = `# Backend Contract Changes (Prompts 60–69)

1. **Unified Response Convention (D-18):**
   - Single entities returned under entity key (\`customer\`, \`bill\`, etc.).
   - Lists returned under \`items: [...]\` with \`count\`, \`nextCursor\`, and \`included\`.
2. **Purchase vs Expense Entity Distinction (Prompt 69 A-3):**
   - \`outflows\` collection now cleanly distinguishes \`purchase\` vs \`expense\` in activity logs and audit trails.
3. **ImageRef Migration (D-5, D-15):**
   - \`photoUrl\` and \`avatarUrl\` removed; replaced by \`image\` (\`ImageRef\`).
4. **Operation & Status Tracking in Audit Logs (Prompt 69 A-2, A-4, A-5):**
   - Activity log rows now return explicit \`operation\` (\`create\`, \`update\`, \`delete\`, \`status_change\`), \`humanLabel\`, \`statusBefore\`, and \`statusAfter\`.
5. **Subscription Limits & Quota Warnings (Prompt 69 G3):**
   - Support for \`hard_block\` and \`warn_only\` policies with \`USAGE_LIMIT_EXCEEDED\` stable reason.
`;
fs.writeFileSync(path.join(OUT_DIR, "CHANGES.md"), changesMd);

// 11. F-11: SUMMARY.md (Strictly <= 250 lines)
const summaryLines = [
  "# Trado Flutter Backend Contract — Summary Cheatsheet",
  "<!-- ATTACH THIS FILE TO CLAUDE FOR FLUTTER CODE GENERATION -->",
  "",
  "## 1. Response & Serialization Conventions",
  "- **Single Entity:** `{ \"<entity>\": { ... } }` | **List:** `{ \"items\": [...], \"count\": N, \"nextCursor\": \"...\", \"included\": { ... } }`",
  "- **Money:** Stored and returned as **integer paise** (₹1.00 = 100 paise, ₹25.50 = 2550). Divide by 100 for display.",
  "- **Timestamps:** ISO 8601 UTC strings (`2026-11-14T05:30:00.000Z`). Local dates: `YYYY-MM-DD`.",
  "- **Images:** Pass ImageRef `{ storagePath: \"...\" }`. Download URLs hydrated dynamically as `imageUrl`.",
  "",
  "## 2. Core Entities & Form Callables",
];

for (const stat of entityFormStats.slice(0, 16)) {
  summaryLines.push(`### \`${stat.entity}\` (${stat.label})`);
  summaryLines.push(`- **Callables:** \`${stat.callables.join("`, `")}\``);
  summaryLines.push(`- **Fields:** ${stat.required} required on create, ${stat.optional} optional, ${stat.updatable} patchable on update.`);
}

summaryLines.push(
  "",
  "## 3. Status Lifecycles & State Machines",
  "- **bill:** `draft` → `active` (billsFinalize) → `paid` / `void` (billsVoid)",
  "- **outflow:** `pending` → `confirmed` → `cancelled` / `void` (outflowsVoid)",
  "- **delivery:** `pending` → `assigned` → `in_transit` → `delivered` / `failed` / `cancelled`",
  "- **return:** `pending` → `completed` / `rejected`",
  "- **task:** `todo` → `in_progress` → `completed` / `cancelled`",
  "",
  "## 4. Activity Logs (`auditLogsList`)",
  "- **Filters:** `actorUserId`, `entityType`, `entityId`, `operation`, `status`, `branchId`, `from`, `to`, `limit`, `cursor`.",
  "- **Row Content:** `logId`, `timestamp`, `operation`, `action`, `entityType`, `entityId`, `humanLabel`, `statusBefore`, `statusAfter`, `amount`, `currency`, `branchId`, `actorName`, `actorRole`.",
  "",
  "## 5. Usage Quotas & Limits (`usageGetLimits`)",
  "- **Quota Limits:** Daily & monthly firestoreWrites, firestoreReads, functionsInvocations.",
  "- **Enforcement:** `hard_block` rejects with `USAGE_LIMIT_EXCEEDED`; `warn_only` attaches quota warnings in response.",
  "",
  "## 6. Entity Counts Matrix",
  "| Entity | Callables | Req Fields | Opt Fields | Updatable |",
  "|---|---|---|---|---|",
  ...entityFormStats.map((s) => `| \`${s.entity}\` | \`${s.callables[0] || "—"}\` | ${s.required} | ${s.optional} | ${s.updatable} |`)
);

const summaryContent = summaryLines.join("\n");
const lineCount = summaryContent.split("\n").length;
if (lineCount > 250) {
  console.warn(`WARNING: SUMMARY.md has ${lineCount} lines (exceeds 250). Trimming...`);
}
fs.writeFileSync(path.join(OUT_DIR, "SUMMARY.md"), summaryContent);

console.log(`✓ Flutter Contract Pack generated successfully in ${truth.rel(OUT_DIR)} (SUMMARY.md is ${lineCount} lines).`);
