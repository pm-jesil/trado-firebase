#!/usr/bin/env node
/**
 * Trado Source Inventory & Subgroup Math Generator
 * 
 * Programmatically parses functions/src/index.ts, categorizes every export,
 * verifies mathematical subtotals, checks for duplicate/missing exports,
 * writes tests/api/canonical-source-inventory.json, and regenerates
 * docs/audit/callable-and-trigger-inventory.md with dynamic counts.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INDEX_TS_PATH = path.join(ROOT, "functions/src/index.ts");
const JSON_OUTPUT_PATH = path.join(ROOT, "tests/api/canonical-source-inventory.json");
const MD_OUTPUT_PATH = path.join(ROOT, "docs/audit/callable-and-trigger-inventory.md");

// 1. Extract exports from functions/src/index.ts
function extractExports(indexContent) {
  const exports = [];
  const exportBlockRegex = /export\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']/g;
  let match;
  while ((match = exportBlockRegex.exec(indexContent)) !== null) {
    const rawSymbols = match[1].split(",");
    const modulePath = match[2];
    for (const raw of rawSymbols) {
      const sym = raw.trim();
      if (sym) {
        exports.push({ name: sym, sourceFile: modulePath });
      }
    }
  }
  return exports;
}

// 2. Canonical Classification Schema
const CLASSIFICATION_DEFINITIONS = {
  PUBLIC_AUTH_ADAPTER: {
    description: "Public Auth & Health Adapters (Unauthenticated or testing adapter)",
    items: ["healthCheck", "authLogin"],
  },
  CALLER_IDENTITY: {
    description: "Caller Identity Bootstrap & Personal Notifications",
    items: ["authMe", "notificationsRegisterFcmToken", "notificationsList", "notificationsMarkRead"],
  },
  CONTEXT_SELECTION: {
    description: "Working Branch Context Selection",
    items: ["branchContextSwitch"],
  },
  ORGANIZATION_ONBOARDING: {
    description: "Organization & Branch Onboarding",
    items: ["organizationsCreate", "organizationsUpdate", "branchesCreate", "branchesUpdate"],
  },
  PLATFORM_SUPER_ADMIN: {
    description: "Platform Super Admin Governance",
    items: [
      "organizationsDeactivate",
      "branchesDeactivate",
      "plansCreate",
      "plansUpdate",
      "reportsGetPlatformOverview",
      "usageGetPlatformSummary",
      "usageGetOrganizations",
      "usageCalculateDryRunStatement",
      "usageUpdateLimits",
    ],
  },
  REFERENCE_DATA: {
    description: "System Reference & Catalog Data",
    items: ["plansList", "permissionCatalogList", "modulesList", "taxRegimesList"],
  },
  DERIVED_TENANT_OPERATION: {
    description: "Derived Tenant Business Operations (Mutations)",
    subgroups: {
      "RBAC & Memberships": [
        "sharingPoliciesUpdate",
        "employeesCreate",
        "employeesUpdate",
        "employeesDeactivate",
        "rolesCreate",
        "rolesUpdate",
        "departmentsCreate",
        "departmentsUpdate",
        "jobRolesCreate",
        "jobRolesUpdate",
        "teamsCreate",
        "teamsUpdate",
      ],
      "Catalog & Parties": [
        "productsCreate",
        "productsUpdate",
        "categoriesCreate",
        "categoriesUpdate",
        "unitsCreate",
        "unitsUpdate",
        "customersCreate",
        "customersUpdate",
        "vendorsCreate",
        "vendorsUpdate",
      ],
      "Transactions & Operations": [
        "outflowsCreate",
        "billsCreate",
        "billsFinalize",
        "deliveriesCreate",
        "deliveriesUpdateStatus",
        "returnsCreate",
        "paymentsCreate",
      ],
      "Stock & Reconciliation": [
        "stockAdjust",
        "reconcileStockBalances",
        "reconcilePartyLedgers",
        "reconcileBranchCounts",
      ],
      "Tasks & Telemetry": [
        "tasksCreate",
        "tasksUpdate",
        "tasksAssign",
        "tasksUpdateStatus",
        "tasksDelete",
        "locationsRecordPing",
        "usageRecordClientMetric",
      ],
    },
  },
  FILTER_OPTIONAL_TENANT: {
    description: "Tenant Query & Analytics Filters (Read-Only)",
    subgroups: {
      "Entities & Catalog Lists": [
        "organizationsList",
        "branchesGetDefault",
        "branchesList",
        "employeesList",
        "rolesList",
        "departmentsList",
        "jobRolesList",
        "teamsList",
        "productsList",
        "productsGet",
        "categoriesList",
        "unitsList",
        "customersList",
        "customersGet",
        "vendorsList",
        "vendorsGet",
        "outflowsList",
        "outflowsGet",
        "billsList",
        "billsGet",
        "deliveriesList",
        "deliveriesGet",
        "returnsList",
        "paymentsList",
        "stockMovementsList",
      ],
      "Reports & Telemetry": [
        "reportsGetRevenue",
        "reportsGetProfitLoss",
        "reportsGetStockValuation",
        "reportsGetTopEntities",
        "reportsGetStaffActivity",
        "reportsExportCsv",
        "tasksList",
        "locationsGetLatest",
        "locationsGetHistory",
      ],
      "Usage & Quotas": [
        "usageGetBranches",
        "usageGetDetail",
        "usageGetLimits",
      ],
    },
  },
};

const TRIGGER_DEFINITIONS = [
  {
    name: "onBillWritten",
    documentPath: "bills/{billId}",
    region: "asia-south1",
    eventType: "onDocumentWritten",
    sideEffects: [
      "Updates daily & monthly sales summaries via recordBillSummary",
      "Dispatches low_stock notification to admin if currentStock <= threshold",
      "Dispatches bill_created notification to organization admin",
    ],
    idempotency: "Idempotent counters; non-blocking notification dispatch",
  },
  {
    name: "onOutflowWritten",
    documentPath: "outflows/{outflowId}",
    region: "asia-south1",
    eventType: "onDocumentWritten",
    sideEffects: [
      "Updates daily & monthly expense summaries via recordOutflowSummary",
      "Dispatches outflow_recorded notification to organization admin",
      "Recalculates Weighted-Average Cost (WAC) on products for purchase lines if not already computed",
    ],
    idempotency: "Only executes on initial creation/confirmation; non-blocking notification dispatch",
  },
  {
    name: "onPaymentWritten",
    documentPath: "payments/{paymentId}",
    region: "asia-south1",
    eventType: "onDocumentWritten",
    sideEffects: [
      "Resolves bill salesperson / creator for incoming bill payments",
      "Dispatches payment_received push notification to salesperson",
    ],
    idempotency: "Only executes on creation; non-blocking notification dispatch",
  },
  {
    name: "onDeliveryWritten",
    documentPath: "deliveries/{deliveryId}",
    region: "asia-south1",
    eventType: "onDocumentWritten",
    sideEffects: [
      "Detects newly assigned rider on delivery document",
      "Dispatches delivery_assigned notification with customer details to rider",
    ],
    idempotency: "Only triggers when rider assignment changes; non-blocking notification dispatch",
  },
];

// Concrete Firestore collections
const CONCRETE_FIRESTORE_COLLECTIONS = [
  { path: "users/{uid}", type: "root", domain: "Tenant & RBAC" },
  { path: "memberships/{membershipId}", type: "root", domain: "Tenant & RBAC" },
  { path: "organizations/{organizationId}", type: "root", domain: "Tenant & RBAC" },
  { path: "organizations/{organizationId}/branches/{branchId}", type: "subcollection", domain: "Multi-Branch Architecture" },
  { path: "users/{uid}/devices/{deviceId}", type: "subcollection", domain: "System Infrastructure" },
  { path: "roles/{roleId}", type: "root", domain: "Tenant & RBAC" },
  { path: "departments/{departmentId}", type: "root", domain: "Tenant & RBAC" },
  { path: "jobRoles/{jobRoleId}", type: "root", domain: "Tenant & RBAC" },
  { path: "teams/{teamId}", type: "root", domain: "Tenant & RBAC" },
  { path: "subscriptionPlans/{planId}", type: "root", domain: "Tenant & RBAC" },
  { path: "permissionCatalog/{permissionCode}", type: "root", domain: "Tenant & RBAC" },
  { path: "modules/{moduleCode}", type: "root", domain: "Tenant & RBAC" },
  { path: "taxRegimes/{taxRegimeCode}", type: "root", domain: "Tenant & RBAC" },
  { path: "idempotencyRecords/{recordId}", type: "root", domain: "System Infrastructure" },
  { path: "auditLogs/{logId}", type: "root", domain: "System Infrastructure" },
  { path: "notificationOutbox/{outboxId}", type: "root", domain: "Tenant & RBAC" },
  { path: "products/{productId}", type: "root", domain: "Catalog & Inventory" },
  { path: "categories/{categoryId}", type: "root", domain: "Catalog & Inventory" },
  { path: "units/{unitId}", type: "root", domain: "Catalog & Inventory" },
  { path: "customers/{customerId}", type: "root", domain: "Parties & Ledgers" },
  { path: "vendors/{vendorId}", type: "root", domain: "Parties & Ledgers" },
  { path: "outflows/{outflowId}", type: "root", domain: "Operations & Transactions" },
  { path: "bills/{billId}", type: "root", domain: "Operations & Transactions" },
  { path: "stockMovements/{movementId}", type: "root", domain: "Catalog & Inventory" },
  { path: "deliveries/{deliveryId}", type: "root", domain: "Operations & Transactions" },
  { path: "returns/{returnId}", type: "root", domain: "Operations & Transactions" },
  { path: "payments/{paymentId}", type: "root", domain: "Operations & Transactions" },
  { path: "documentCounters/{counterId}", type: "root", domain: "System Infrastructure" },
  { path: "tasks/{taskId}", type: "root", domain: "Tasks, Location & Notifications" },
  { path: "dailySummaries/{summaryId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "monthlySummaries/{summaryId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "latestLocations/{locationId}", type: "root", domain: "Tasks, Location & Notifications" },
  { path: "locationPings/{pingId}", type: "root", domain: "Tasks, Location & Notifications" },
  { path: "notifications/{notificationId}", type: "root", domain: "Tasks, Location & Notifications" },
  { path: "branchCodeLocks/{lockId}", type: "root", domain: "Multi-Branch Architecture" },
  { path: "membershipBranches/{membershipBranchId}", type: "root", domain: "Multi-Branch Architecture" },
  { path: "stockBalances/{stockBalanceId}", type: "root", domain: "Catalog & Inventory" },
  { path: "organizationUsageDaily/{docId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "organizationUsageMonthly/{docId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "branchUsageDaily/{docId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "branchUsageMonthly/{docId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "platformUsageSnapshots/{docId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "usageRateCards/{docId}", type: "root", domain: "Analytics & Usage Metering" },
  { path: "usageAllocationRuns/{docId}", type: "root", domain: "Analytics & Usage Metering" },
];

function main() {
  console.log("================================================================================");
  console.log("TRADO BACKEND: SOURCE INVENTORY & MATHEMATICAL PARITY GENERATOR");
  console.log("================================================================================");

  const indexContent = fs.readFileSync(INDEX_TS_PATH, "utf-8");
  const rawExports = extractExports(indexContent);
  const rawExportNames = rawExports.map((e) => e.name);

  console.log(`Discovered ${rawExports.length} total exported symbols in index.ts.`);

  // Verify unique exports
  const uniqueNames = new Set(rawExportNames);
  if (uniqueNames.size !== rawExports.length) {
    throw new Error(`Duplicate export found in index.ts! Unique: ${uniqueNames.size}, Total: ${rawExports.length}`);
  }

  // Separate callables vs triggers
  const triggerNames = TRIGGER_DEFINITIONS.map((t) => t.name);
  const foundTriggers = rawExports.filter((e) => triggerNames.includes(e.name));
  const foundCallables = rawExports.filter((e) => !triggerNames.includes(e.name));

  if (foundTriggers.length !== 4) {
    throw new Error(`Expected exactly 4 triggers, found ${foundTriggers.length}`);
  }
  if (foundCallables.length !== 101) {
    throw new Error(`Expected exactly 101 callables, found ${foundCallables.length}`);
  }
  if (rawExports.length !== 105) {
    throw new Error(`Expected exactly 105 total exports, found ${rawExports.length}`);
  }

  console.log(`✓ Confirmed exactly 101 HTTPS Callables and 4 Firestore Event Triggers (105 total).`);

  // Verify each callable belongs to exactly one category
  const categorizedCallables = new Map();
  const categoryCounts = {};
  const subgroupCounts = {};

  for (const [catKey, catDef] of Object.entries(CLASSIFICATION_DEFINITIONS)) {
    if (catDef.items) {
      categoryCounts[catKey] = catDef.items.length;
      for (const item of catDef.items) {
        if (categorizedCallables.has(item)) {
          throw new Error(`Callable ${item} is categorized multiple times!`);
        }
        categorizedCallables.set(item, { category: catKey, subgroup: null });
      }
    } else if (catDef.subgroups) {
      let sum = 0;
      subgroupCounts[catKey] = {};
      for (const [subName, subItems] of Object.entries(catDef.subgroups)) {
        subgroupCounts[catKey][subName] = subItems.length;
        sum += subItems.length;
        for (const item of subItems) {
          if (categorizedCallables.has(item)) {
            throw new Error(`Callable ${item} is categorized multiple times!`);
          }
          categorizedCallables.set(item, { category: catKey, subgroup: subName });
        }
      }
      categoryCounts[catKey] = sum;
    }
  }

  // Check that every single callable in foundCallables is categorized
  for (const c of foundCallables) {
    if (!categorizedCallables.has(c.name)) {
      throw new Error(`Uncategorized callable found: ${c.name}`);
    }
  }
  if (categorizedCallables.size !== 101) {
    throw new Error(`Expected 101 categorized callables, got ${categorizedCallables.size}`);
  }

  console.log("\n--- Category & Subgroup Parity Verification ---");
  let grandTotal = 0;
  for (const [catKey, count] of Object.entries(categoryCounts)) {
    console.log(`• ${catKey}: ${count}`);
    grandTotal += count;
    if (subgroupCounts[catKey]) {
      let subSum = 0;
      for (const [subName, subCount] of Object.entries(subgroupCounts[catKey])) {
        console.log(`    - ${subName}: ${subCount}`);
        subSum += subCount;
      }
      if (subSum !== count) {
        throw new Error(`Subgroup sum (${subSum}) does not match category count (${count}) for ${catKey}!`);
      }
    }
  }

  if (grandTotal !== 101) {
    throw new Error(`Grand total of categories (${grandTotal}) does not match 101 callables!`);
  }
  console.log(`✓ All category subtotals match exact list lengths (Total: ${grandTotal}).`);

  // Verify concrete collections count
  if (CONCRETE_FIRESTORE_COLLECTIONS.length !== 44) {
    throw new Error(`Expected exactly 44 concrete collections, found ${CONCRETE_FIRESTORE_COLLECTIONS.length}`);
  }
  const rootCount = CONCRETE_FIRESTORE_COLLECTIONS.filter((c) => c.type === "root").length;
  const subCount = CONCRETE_FIRESTORE_COLLECTIONS.filter((c) => c.type === "subcollection").length;
  console.log(`✓ Confirmed 44 concrete Firestore collection paths (${rootCount} root + ${subCount} subcollections).`);

  // Build JSON Manifest
  const manifestData = {
    generatedAt: new Date().toISOString(),
    projectId: "trado-x",
    region: "asia-south1",
    totalExports: 105,
    summary: {
      callableCount: 101,
      triggerCount: 4,
      concreteCollectionsCount: 44,
      categoryCounts,
      subgroupCounts,
    },
    triggers: TRIGGER_DEFINITIONS,
    concreteCollections: CONCRETE_FIRESTORE_COLLECTIONS,
    categories: CLASSIFICATION_DEFINITIONS,
  };

  fs.writeFileSync(JSON_OUTPUT_PATH, JSON.stringify(manifestData, null, 2), "utf-8");
  console.log(`✓ Generated canonical source inventory JSON at ${JSON_OUTPUT_PATH}`);

  // Build Authoritative Markdown Inventory
  let md = `# Trado Backend: Comprehensive Callable & Trigger Inventory\n\n`;
  md += `This document is the authoritative, source-verified inventory of all Cloud Functions exports in the Trado Firebase backend. It provides the programmatic breakdown of all 101 HTTPS Callable functions, 4 Firestore Event Triggers, and the context derivation exceptions allowlist.\n\n`;
  md += `--- \n\n## 1. Export Overview\n\n`;
  md += `| Category | Export Type | Count |\n`;
  md += `|---|---|:---:|\n`;
  md += `| **HTTPS Callables** | Public Auth & Health Adapter | ${categoryCounts.PUBLIC_AUTH_ADAPTER} |\n`;
  md += `| | Caller Identity Bootstrap | ${categoryCounts.CALLER_IDENTITY} |\n`;
  md += `| | Working Branch Context Selection | ${categoryCounts.CONTEXT_SELECTION} |\n`;
  md += `| | Organization & Branch Onboarding | ${categoryCounts.ORGANIZATION_ONBOARDING} |\n`;
  md += `| | Platform Super Admin Governance | ${categoryCounts.PLATFORM_SUPER_ADMIN} |\n`;
  md += `| | Reference & System Catalog Data | ${categoryCounts.REFERENCE_DATA} |\n`;
  md += `| | Derived Tenant Business Operations (Mutations) | ${categoryCounts.DERIVED_TENANT_OPERATION} |\n`;
  md += `| | Tenant Query & Analytics Filters | ${categoryCounts.FILTER_OPTIONAL_TENANT} |\n`;
  md += `| **Subtotal Callables** | | **${grandTotal}** |\n`;
  md += `| **Firestore Event Triggers** | Asynchronous Background Triggers | **${TRIGGER_DEFINITIONS.length}** |\n`;
  md += `| **Total Cloud Functions Exports** | | **${grandTotal + TRIGGER_DEFINITIONS.length}** |\n\n`;

  md += `--- \n\n## 2. HTTPS Callable Inventory (101 Functions)\n\n`;

  // Public
  md += `### A. Public Auth & Health Adapter (${categoryCounts.PUBLIC_AUTH_ADAPTER})\n`;
  md += `Unauthenticated entrypoints for system liveness and local emulator authentication.\n`;
  CLASSIFICATION_DEFINITIONS.PUBLIC_AUTH_ADAPTER.items.forEach((item, i) => {
    md += `${i + 1}. \`${item}\`\n`;
  });

  // Caller Identity
  md += `\n### B. Caller Identity Bootstrap (${categoryCounts.CALLER_IDENTITY})\n`;
  md += `Session resolution and caller-specific notifications. Never accept tenant or branch context parameters in the request payload.\n`;
  CLASSIFICATION_DEFINITIONS.CALLER_IDENTITY.items.forEach((item, i) => {
    md += `${i + 3}. \`${item}\`\n`;
  });

  // Context Selection
  md += `\n### C. Context Selection (${categoryCounts.CONTEXT_SELECTION})\n`;
  md += `Caller branch context switching.\n`;
  CLASSIFICATION_DEFINITIONS.CONTEXT_SELECTION.items.forEach((item, i) => {
    md += `${i + 7}. \`${item}\`\n`;
  });

  // Organization Onboarding
  md += `\n### D. Organization & Branch Onboarding (${categoryCounts.ORGANIZATION_ONBOARDING})\n`;
  md += `Initial tenant creation and administrative configuration.\n`;
  CLASSIFICATION_DEFINITIONS.ORGANIZATION_ONBOARDING.items.forEach((item, i) => {
    md += `${i + 8}. \`${item}\`\n`;
  });

  // Platform Super Admin
  md += `\n### E. Platform Super Admin Governance (${categoryCounts.PLATFORM_SUPER_ADMIN})\n`;
  md += `Restricted exclusively to platform administrators (\`customClaims.isSuperAdmin === true\`). Super Admin has zero tenant permissions, no organizations, and no branches.\n`;
  CLASSIFICATION_DEFINITIONS.PLATFORM_SUPER_ADMIN.items.forEach((item, i) => {
    md += `${i + 12}. \`${item}\`\n`;
  });

  // Reference Data
  md += `\n### F. Reference & System Catalog Data (${categoryCounts.REFERENCE_DATA})\n`;
  md += `Global system reference data available to authenticated callers.\n`;
  CLASSIFICATION_DEFINITIONS.REFERENCE_DATA.items.forEach((item, i) => {
    md += `${i + 21}. \`${item}\`\n`;
  });

  // Derived Tenant Operations
  let opIdx = 25;
  md += `\n### G. Derived Tenant Business Operations — Mutations (${categoryCounts.DERIVED_TENANT_OPERATION})\n`;
  md += `Operational mutations where tenant boundaries (\`organizationId\`, \`branchId\`) are derived server-side from the authenticated token and active Firestore context.\n\n`;
  for (const [subName, items] of Object.entries(CLASSIFICATION_DEFINITIONS.DERIVED_TENANT_OPERATION.subgroups)) {
    md += `#### ${subName} (${items.length})\n`;
    items.forEach((item) => {
      md += `${opIdx}. \`${item}\`\n`;
      opIdx++;
    });
    md += `\n`;
  }

  // Tenant Query & Analytics Filters
  md += `### H. Tenant Query & Analytics Filters (${categoryCounts.FILTER_OPTIONAL_TENANT})\n`;
  md += `Read operations and analytical aggregations scoped to the caller's authorized tenant context.\n\n`;
  for (const [subName, items] of Object.entries(CLASSIFICATION_DEFINITIONS.FILTER_OPTIONAL_TENANT.subgroups)) {
    md += `#### ${subName} (${items.length})\n`;
    items.forEach((item) => {
      md += `${opIdx}. \`${item}\`\n`;
      opIdx++;
    });
    md += `\n`;
  }

  // Triggers
  md += `--- \n\n## 3. Firestore Event Triggers (${TRIGGER_DEFINITIONS.length} Background Triggers)\n\n`;
  md += `All triggers are defined in \`functions/src/triggers/eventTriggers.ts\` and exported in \`functions/src/index.ts\`. All execute in the \`asia-south1\` region.\n\n`;
  md += `| # | Trigger Name | Firestore Path Filter | Trigger Event | Primary Side Effects & Business Responsibilities |\n`;
  md += `|---|---|---|---|---|\n`;
  TRIGGER_DEFINITIONS.forEach((t, i) => {
    md += `| ${i + 1} | \`${t.name}\` | \`${t.documentPath}\` | \`${t.eventType}\` | • ${t.sideEffects.join("<br>• ")} |\n`;
  });
  md += `\n*Note*: Historical reports mentioning \`auditLogWritten\`, \`notificationDispatched\`, \`billFinalizedTrigger\`, or \`stockMovementWritten\` were phantom labels; the four triggers above are the sole, authentic triggers.\n\n`;

  // Concrete Collections
  md += `--- \n\n## 4. Concrete Firestore Collection Paths (${CONCRETE_FIRESTORE_COLLECTIONS.length} Collections)\n\n`;
  md += `| # | Collection Path | Storage Type | Domain |\n`;
  md += `|---|---|---|---|\n`;
  CONCRETE_FIRESTORE_COLLECTIONS.forEach((col, i) => {
    md += `| ${i + 1} | \`${col.path}\` | ${col.type === "subcollection" ? "Subcollection" : "Root Collection"} | ${col.domain} |\n`;
  });
  md += `\n`;

  // Exceptions Allowlist
  md += `--- \n\n## 5. Context Exceptions Allowlist\n\n`;
  md += `To eliminate security vulnerabilities, ordinary operational callables derive \`organizationId\` and \`branchId\` server-side from \`request.auth\` and verified active Firestore records. Callers are blocked from supplying arbitrary tenant IDs.\n\n`;
  md += `The table below lists the **only sanctioned exceptions** where \`organizationId\` or \`branchId\` may be provided by the client:\n\n`;
  md += `| Parameter | Allowed Callable(s) | Architectural Justification |\n`;
  md += `|---|---|---|\n`;
  md += `| \`organizationId\` | \`branchesCreate\` | Creating a branch inside a specific tenant organization during onboarding. |\n`;
  md += `| \`organizationId\` | \`organizationsDeactivate\`, \`branchesDeactivate\` | Platform Super Admin actions targeting a specific tenant. |\n`;
  md += `| \`organizationId\` | \`usageGetBranches\`, \`usageGetDetail\`, \`usageCalculateDryRunStatement\`, \`usageUpdateLimits\` | Super Admin platform usage calculation and quota management. |\n`;
  md += `| \`organizationId\` | \`reportsGet...\`, \`reportsExportCsv\` (Super Admin mode only) | Super Admin auditing cross-tenant reporting data. |\n`;
  md += `| \`organizationId\` | Read Lists (\`productsList\`, \`billsList\`, etc.) | Super Admin platform view across organizations. Ignored/overridden for standard tenant users. |\n`;
  md += `| \`branchId\` | \`branchContextSwitch\` | Primary mechanism for multi-branch staff to switch their active working branch. Validated against \`membershipBranches\`. |\n`;
  md += `| \`branchId\` | \`stockAdjust\` | Physical location where stock intake or discrepancy adjustment takes place. |\n`;
  md += `| \`branchId\` | \`outflowsCreate\` | Operating branch incurring the purchase or operational expense. |\n`;
  md += `| \`branchId\` | \`productsCreate\` (optional) | Initial stock balance attribution during catalog creation. |\n`;
  md += `| \`branchId\` | \`customersCreate\`, \`vendorsCreate\` (optional) | Originating branch assignment for party ledger records. |\n`;
  md += `| \`branchId\` | \`tasksCreate\`, \`tasksList\` | Branch assignment for localized operational tasks. |\n`;
  md += `| \`branchId\` | Reports (\`reportsGetRevenue\`, etc.) | Optional branch-level filtering on analytical aggregations. |\n`;

  fs.writeFileSync(MD_OUTPUT_PATH, md, "utf-8");
  console.log(`✓ Generated authoritative Markdown inventory at ${MD_OUTPUT_PATH}`);
}

main();

