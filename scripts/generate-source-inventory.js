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
    items: ["authMe", "usersUpdateMe", "notificationsRegisterFcmToken", "notificationsList", "notificationsMarkRead"],
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
      "organizationsReactivate",
      "organizationsPreviewDeactivationImpact",
      "organizationsGetSubscriptionHistory",
      "organizationsProvisionUser",
      "organizationsTransferOwnership",
      "branchesDeactivate",
      "plansCreate",
      "plansUpdate",
      "plansArchive",
      "plansDelete",
      "plansPreviewImpact",
      "platformUsersList",
      "platformUsersGet",
      "auditLogsList",
      "reportsGetPlatformOverview",
      "usageGetPlatformSummary",
      "usageGetOrganizations",
      "usageCalculateDryRunStatement",
      "usageUpdateLimits",
      "organizationsSetSubscription",
      "requestsInboxList",
      "requestsInboxCounts",
      "requestsAssign",
      "requestsSetPriority",
      "requestsAddInternalNote",
      "requestsApply",
    ],
  },
  REFERENCE_DATA: {
    description: "System Reference & Catalog Data",
    items: ["plansList", "plansGet", "permissionCatalogList", "modulesList", "taxRegimesList"],
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
        "teamsAssignMember",
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
        "billsUpdateDraft",
        "billsVoid",
        "outflowsVoid",
        "documentsDecide",
        "deliveriesCreate",
        "deliveriesUpdateStatus",
        "returnsCreate",
        "paymentsCreate",
        "paymentsVoid",
        "recurringExpensesCreate",
        "recurringExpensesUpdate",
        "financialAccountsCreate",
        "financialAccountsUpdate",
        "accountTransfersCreate",
        "capitalTransactionsCreate",
        "paymentsRecordFee",
        "paymentsVerifyFee",
        "paymentsDisputeFee",
        "paymentsReverseFee",
        "storageLocationsCreate",
        "storageLocationsUpdate",
        "stockTransfersCreate",
        "stockTransfersSubmit",
        "stockTransfersDispatch",
        "stockTransfersReceive",
        "stockTransfersCancel",
        "stockTransfersResolveDiscrepancy",
      ],
      "Stock & Reconciliation": [
        "stockAdjust",
        "reconcileStockBalances",
        "reconcilePartyLedgers",
        "reconcileBranchCounts",
        "ledgerVerify",
        "stockVerify",
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
      "Media & Assets": [
        "imagesCreateUploadSession",
        "imagesAttach",
        "imagesRemove",
      ],
      "Requests & Support Desk": [
        "requestsCreate",
        "requestsUpdate",
        "requestsAddComment",
        "requestsTransition",
      ],
    },
  },
  FILTER_OPTIONAL_TENANT: {
    description: "Tenant Query & Analytics Filters (Read-Only)",
    subgroups: {
      "Entities & Catalog Lists": [
        "organizationsList",
        "organizationsGet",
        "branchesGetDefault",
        "branchesList",
        "employeesList",
        "employeesGet",
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
        "billsPreview",
        "deliveriesList",
        "deliveriesGet",
        "returnsList",
        "paymentsList",
        "stockMovementsList",
        "productsGetPriceHistory",
        "auditGetEntityHistory",
        "recurringExpensesList",
        "plansCatalogList",
        "requestsGet",
        "requestsList",
        "requestsActivityList",
        "requestsCounts",
        "requestsMeta",
        "financialAccountsList",
        "financialAccountsGet",
        "financialAccountsGetLedger",
        "accountTransfersList",
        "accountTransfersGet",
        "capitalTransactionsList",
        "paymentsListFees",
        "paymentsGetFee",
        "storageLocationsList",
        "storageLocationsGet",
        "stockTransfersList",
        "stockTransfersGet",
        "approvalsList",
        "approvalsCounts",
      ],
      "Reports & Telemetry": [
        "reportsGetRevenue",
        "reportsGetProfitLoss",
        "reportsGetStockValuation",
        "reportsGetTopEntities",
        "reportsGetStaffActivity",
        "reportsExportCsv",
        "reportsGetPartyStatement",
        "reportsGetOutflowSummary",
        "reportsGetReceivablesAgeing",
        "reportsGetPayablesAgeing",
        "reportsGetCashBankSummary",
        "reportsGetTrialBalance",
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
  {
    name: "onStorageObjectFinalized",
    documentPath: "(storage: onObjectFinalized)",
    region: "asia-south1",
    eventType: "onObjectFinalized",
    sideEffects: [
      "Tracks uploaded storage bytes per organization via sharded counters",
      "Deletes file and refunds counter if organization hard_block storage limit is exceeded",
    ],
    idempotency: "Guarded by storage object generation and metadata; safe on retry",
  },
  {
    name: "subscriptionAndUsageSweep",
    documentPath: "(scheduled: 0 2 * * * Asia/Kolkata)",
    region: "asia-south1",
    eventType: "onSchedule",
    sideEffects: [
      "Sends 7/3/1-day subscription expiry reminders to organization Owners",
      "Flips subscriptionStatus to expired after expiry + grace (audited)",
      "Sends server-observed usage warnings (>= warning threshold) to Owners",
    ],
    idempotency: "Every notification guarded by reserveIdempotency (scheduled.notify); safe to re-run",
  },
  {
    name: "onRequestActivityWritten",
    documentPath: "requests/{requestId}/activity/{activityId}",
    region: "asia-south1",
    eventType: "onDocumentWritten",
    sideEffects: [
      "Detects public activity (comments, status changes) on requests",
      "Dispatches request_updated notification to requester or assignee",
      "Idempotent delivery marker keyed by event.id (D-45)",
    ],
    idempotency: "Guaranteed by reserveIdempotency in idempotencyRecords",
  },
  {
    name: "requestsSlaAndLifecycleSweep",
    documentPath: "(scheduled: every 15 minutes Asia/Kolkata)",
    region: "asia-south1",
    eventType: "onSchedule",
    sideEffects: [
      "Evaluates SLA status (at_risk, breached) for open requests",
      "Auto-closes requests resolved for >= 7 days",
      "Auto-cancels requests in needs_info for >= 14 days",
    ],
    idempotency: "Status guards and activity stamps; safe on rerun",
  },
];

// Concrete Firestore collections — DERIVED from the source (every db.collection("…") /
// subcollection used under functions/src), never hand-listed. Domain labels below are the only
// hand-kept part; a collection without a label fails the run.
const COLLECTION_DOMAINS = {
  "users": "Tenant & RBAC",
  "memberships": "Tenant & RBAC",
  "organizations": "Tenant & RBAC",
  "organizations/branches": "Multi-Branch Architecture",
  "users/devices": "System Infrastructure",
  "roles": "Tenant & RBAC",
  "departments": "Tenant & RBAC",
  "jobRoles": "Tenant & RBAC",
  "teams": "Tenant & RBAC",
  "subscriptionPlans": "Tenant & RBAC",
  "permissionCatalog": "Tenant & RBAC",
  "modules": "Tenant & RBAC",
  "taxRegimes": "Tenant & RBAC",
  "idempotencyRecords": "System Infrastructure",
  "auditLogs": "System Infrastructure",
  "notificationOutbox": "Tenant & RBAC",
  "products": "Catalog & Inventory",
  "categories": "Catalog & Inventory",
  "units": "Catalog & Inventory",
  "customers": "Parties & Ledgers",
  "vendors": "Parties & Ledgers",
  "outflows": "Operations & Transactions",
  "bills": "Operations & Transactions",
  "stockMovements": "Catalog & Inventory",
  "deliveries": "Operations & Transactions",
  "returns": "Operations & Transactions",
  "payments": "Operations & Transactions",
  "documentCounters": "System Infrastructure",
  "tasks": "Tasks, Location & Notifications",
  "dailySummaries": "Analytics & Usage Metering",
  "monthlySummaries": "Analytics & Usage Metering",
  "latestLocations": "Tasks, Location & Notifications",
  "locationPings": "Tasks, Location & Notifications",
  "notifications": "Tasks, Location & Notifications",
  "membershipBranches": "Multi-Branch Architecture",
  "stockBalances": "Catalog & Inventory",
  "organizationUsageDaily": "Analytics & Usage Metering",
  "organizationUsageMonthly": "Analytics & Usage Metering",
  "userUsageDaily": "Analytics & Usage Metering",
  "platformCostReconciliation": "Analytics & Usage Metering",
  "branchUsageDaily": "Analytics & Usage Metering",
  "branchUsageMonthly": "Analytics & Usage Metering",
  "usageRateCards": "Analytics & Usage Metering",
  "usageCounterShards": "Analytics & Usage Metering",
  "uniqueKeys": "System Infrastructure",
  "serials": "Catalog & Inventory",
  "stockAdjustmentRequests": "Catalog & Inventory",
  "recurringExpenses": "Operations & Transactions",
  "imageUploadSessions": "System Infrastructure",
  "requests": "Support & Requests Desk",
  "requests/activity": "Support & Requests Desk",
  "counters": "System Infrastructure",
  "platformSettings": "System Infrastructure",
  "accountTransactions": "Parties & Ledgers",
  "accountTransfers": "Operations & Transactions",
  "branchProductStock": "Catalog & Inventory",
  "capitalTransactions": "Operations & Transactions",
  "financialAccounts": "Parties & Ledgers",
  "journalEntries": "Parties & Ledgers",
  "paymentProcessingFees": "Operations & Transactions",
  "stockTransfers": "Catalog & Inventory",
  "storageLocations": "Catalog & Inventory",
};

function deriveCollections() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "test") walk(p); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const src = fs.readFileSync(p, "utf-8");
      for (const m of src.matchAll(/\.collection(?:Group)?\(\s*"([A-Za-z]+)"\s*\)/g)) names.add(m[1]);
    }
  };
  walk(path.join(ROOT, "functions/src"));
  const out = [];
  for (const name of Array.from(names).sort()) {
    const key = name === "branches" ? "organizations/branches"
      : name === "devices" ? "users/devices"
      : name === "activity" ? "requests/activity"
      : name;
    if (!COLLECTION_DOMAINS[key]) throw new Error(`Collection "${key}" used in source has no domain label in COLLECTION_DOMAINS`);
    const pathTpl = key === "organizations/branches" ? "organizations/{organizationId}/branches/{branchId}"
      : key === "users/devices" ? "users/{uid}/devices/{deviceId}"
      : key === "requests/activity" ? "requests/{requestId}/activity/{activityId}"
      : `${key}/{id}`;
    out.push({ path: pathTpl, type: key.includes("/") ? "subcollection" : "root", domain: COLLECTION_DOMAINS[key] });
  }
  return out;
}
const CONCRETE_FIRESTORE_COLLECTIONS = deriveCollections();

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

  const TRIGGER_COUNT = TRIGGER_DEFINITIONS.length;
  const CALLABLE_COUNT = foundCallables.length;
  if (foundTriggers.length !== TRIGGER_COUNT) {
    throw new Error(`Expected ${TRIGGER_COUNT} triggers (TRIGGER_DEFINITIONS), found ${foundTriggers.length}`);
  }

  console.log(`✓ Found ${CALLABLE_COUNT} HTTPS Callables and ${TRIGGER_COUNT} triggers (${rawExports.length} total).`);

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
  if (categorizedCallables.size !== CALLABLE_COUNT) {
    throw new Error(`Expected ${CALLABLE_COUNT} categorized callables, got ${categorizedCallables.size}`);
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

  if (grandTotal !== CALLABLE_COUNT) {
    throw new Error(`Grand total of categories (${grandTotal}) does not match ${CALLABLE_COUNT} callables!`);
  }
  console.log(`✓ All category subtotals match exact list lengths (Total: ${grandTotal}).`);

  // Collections are derived from source; every one must carry a domain label (checked in deriveCollections)
  const rootCount = CONCRETE_FIRESTORE_COLLECTIONS.filter((c) => c.type === "root").length;
  const subCount = CONCRETE_FIRESTORE_COLLECTIONS.filter((c) => c.type === "subcollection").length;
  console.log(`✓ Confirmed ${CONCRETE_FIRESTORE_COLLECTIONS.length} concrete Firestore collection paths (${rootCount} root + ${subCount} subcollections).`);

  // Build JSON Manifest
  // No timestamp: the output is a pure function of the source, so an unchanged source rewrites it byte for byte.
  const manifestData = {
    projectId: "trado-x",
    region: "asia-south1",
    totalExports: rawExports.length,
    summary: {
      callableCount: CALLABLE_COUNT,
      triggerCount: TRIGGER_COUNT,
      concreteCollectionsCount: CONCRETE_FIRESTORE_COLLECTIONS.length,
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
  md += `Generated by \`scripts/generate-source-inventory.js\` from \`functions/src/index.ts\`. Do not edit.\n\n`;
  md += `The gate and permission of every callable: [Gate & Permission Matrix](../generated/gate-permission-matrix.md) (generated by \`scripts/check-gate-conformance.js\`).\n\n`;
  md += `This document is the authoritative, source-verified inventory of all Cloud Functions exports in the Trado Firebase backend. It provides the programmatic breakdown of all ${CALLABLE_COUNT} HTTPS Callable functions, ${TRIGGER_COUNT} triggers (Firestore event + scheduled), and the context derivation exceptions allowlist.\n\n`;
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

  md += `--- \n\n## 2. HTTPS Callable Inventory (${CALLABLE_COUNT} Functions)\n\n`;

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

