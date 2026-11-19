#!/usr/bin/env node
/**
 * Trado Backend Source-Derived Numbers Reporter (Hybrid Prompt 76 — BX0 A-1, D-N1)
 *
 * Derives every structural count directly from source code, schemas, security rules,
 * allowlist, and generated contract files — never from hand-written docs.
 *
 * Usage:
 *   node functions/scripts/report-numbers.js [--json] [--run-unit]
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FUNCTIONS_DIR = path.join(ROOT, "functions");
const truth = require(path.join(ROOT, "scripts", "lib", "source-truth.js"));

function safeExec(cmd, cwd = ROOT) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function classifyDomain(file) {
  // e.g. functions/src/callables/requests/tenantRequests.ts -> requests
  // e.g. functions/src/callables/bills/billsMutations.ts -> bills
  // e.g. functions/src/callables/organizations.ts -> organizations
  const m = file.match(/functions\/src\/callables\/([^/]+?)(?:\/|\.ts$)/);
  if (m) return m[1];
  const t = file.match(/functions\/src\/triggers\/([^/]+?)\.ts$/);
  if (t) return `triggers:${t[1]}`;
  return "other";
}

function classifyGate(exp) {
  if (exp.type !== "callable") return exp.factory === "onSchedule" ? "schedule" : "trigger";
  if (exp.superAdminOnly) return "platform";
  // Check platform-scoped request callables or platform users that use requirePlatformPermission / assertSuperAdmin
  const abs = path.join(ROOT, exp.file);
  const src = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  // Extract handler snippet around exp.line
  const lines = src.split(/\r?\n/);
  const start = Math.max(0, (exp.line || 1) - 1);
  const snippet = lines.slice(start, Math.min(lines.length, start + 80)).join("\n");
  if (/requirePlatformActor|isSuperAdmin\s*!==\s*true|!isSuperAdmin|platform:requests_/.test(snippet) && !exp.gated) {
    return "platform";
  }
  if (exp.gated) return "tenant";
  // Auth/public/catalog callables that don't use resolveRequestContext or superAdminOnly
  if (/^(healthCheck|authLogin|authMe|usersUpdateMe|notificationsRegisterFcmToken|notificationsList|notificationsMarkRead|permissionCatalogList|modulesList|taxRegimesList|plansCatalogList|plansList|plansGet|requestsMeta)$/.test(exp.name)) {
    return "public_or_auth";
  }
  if (/^(organizationsUpdate|organizationsGet|organizationsDeactivate|organizationsReactivate|organizationsPreviewDeactivationImpact|organizationsGetSubscriptionHistory|organizationsTransferOwnership|imagesCreateUploadSession|imagesAttach|imagesRemove|rolesCreate|rolesUpdate|rolesList|departmentsCreate|departmentsUpdate|departmentsList|jobRolesCreate|jobRolesUpdate|jobRolesList|categoriesCreate|categoriesUpdate|categoriesList|unitsCreate|unitsUpdate|unitsList)$/.test(exp.name)) {
    return "mixed_tenant_or_platform";
  }
  return "other";
}

function parsePermissions() {
  const file = path.join(FUNCTIONS_DIR, "src", "constants", "permissions.ts");
  const text = fs.readFileSync(file, "utf8");
  const entries = [...text.matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)"/gm)].map((m) => ({
    constName: m[1],
    code: m[2],
  }));
  const wildcards = entries.filter((e) => e.code.includes("*"));
  const concrete = entries.filter((e) => !e.code.includes("*"));

  const permDocPath = path.join(ROOT, "docs", "flutter-contract", "permissions.md");
  const permDoc = fs.existsSync(permDocPath) ? fs.readFileSync(permDocPath, "utf8") : "";
  const documentedCodes = new Set([...permDoc.matchAll(/`([a-z_]+:[a-z_:]+|\*|platform:\*)`/g)].map((m) => m[1]));

  return {
    totalEntries: entries.length,
    wildcards: wildcards.map((w) => w.code),
    concreteCount: concrete.length,
    concreteCodes: concrete.map((c) => c.code),
    documentedInContractCount: concrete.filter((c) => documentedCodes.has(c.code)).length,
    missingFromContract: concrete.filter((c) => !documentedCodes.has(c.code)).map((c) => c.code),
  };
}

function parseReasonCodes() {
  const enumsText = fs.readFileSync(path.join(FUNCTIONS_DIR, "src", "constants", "enums.ts"), "utf8");
  const extractEnum = (enumName) => {
    const m = enumsText.match(new RegExp(`export enum ${enumName}\\s*\\{([\\s\\S]*?)\\}`));
    if (!m) return [];
    return [...m[1].matchAll(/=\s*"([A-Z0-9_]+)"/g)].map((x) => x[1]);
  };
  const gateReasons = extractEnum("GateReason");
  const requestReasons = extractEnum("RequestReason");

  // Scan all production source files for thrown reason codes:
  // 1) reason: "CODE"  2) GateReason.X / RequestReason.X  3) "[CODE]" inside HttpsError
  const thrown = new Set();
  const thrownByCode = {};
  for (const abs of truth.productionSourceFiles()) {
    const src = fs.readFileSync(abs, "utf8");
    const relFile = truth.rel(abs);
    for (const m of src.matchAll(/\breason\s*:\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) {
      thrown.add(m[1]);
      (thrownByCode[m[1]] = thrownByCode[m[1]] || new Set()).add(relFile);
    }
    for (const m of src.matchAll(/\b(?:GateReason|RequestReason)\.([A-Z][A-Z0-9_]+)\b/g)) {
      thrown.add(m[1]);
      (thrownByCode[m[1]] = thrownByCode[m[1]] || new Set()).add(relFile);
    }
    for (const m of src.matchAll(/new HttpsError\([^)]*`?["']\[([A-Z][A-Z0-9_]{2,})\]/g)) {
      thrown.add(m[1]);
      (thrownByCode[m[1]] = thrownByCode[m[1]] || new Set()).add(relFile);
    }
  }

  const errorsMdPath = path.join(ROOT, "docs", "flutter-contract", "errors.md");
  const errorsMd = fs.existsSync(errorsMdPath) ? fs.readFileSync(errorsMdPath, "utf8") : "";
  const documentedErrors = [...errorsMd.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]);

  return {
    gateReasonEnumCount: gateReasons.length,
    requestReasonEnumCount: requestReasons.length,
    thrownLiteralsCount: thrown.size,
    thrownCodes: [...thrown].sort(),
    documentedInErrorsMdCount: documentedErrors.length,
    undocumentedThrownCount: [...thrown].filter((c) => !documentedErrors.includes(c)).length,
    undocumentedThrown: [...thrown].filter((c) => !documentedErrors.includes(c)).sort(),
  };
}

function parseStateMachines() {
  // Known state machines defined in code (transition maps or status enums)
  const codeMachines = [
    { name: "bill", source: "functions/src/constants/enums.ts (BillStatus) & callables/bills/" },
    { name: "outflow", source: "functions/src/constants/enums.ts (OutflowStatus) & callables/outflows.ts" },
    { name: "delivery", source: "functions/src/constants/enums.ts (DeliveryStatus) & callables/deliveries.ts" },
    { name: "return", source: "functions/src/callables/returns.ts & callables/approvals.ts" },
    { name: "task", source: "functions/src/callables/tasks.ts" },
    { name: "membership", source: "functions/src/constants/enums.ts (EntityStatus) & callables/employees.ts" },
    { name: "organization", source: "functions/src/constants/enums.ts (EntityStatus) & callables/organizations.ts" },
    { name: "subscription", source: "functions/src/constants/enums.ts (SubscriptionStatus) & services/subscriptionGate.ts" },
    { name: "request-approval", source: "functions/src/services/requestsService.ts (APPROVAL_TRANSITIONS)" },
    { name: "request-work", source: "functions/src/services/requestsService.ts (WORK_TRANSITIONS)" },
    { name: "stock-transfer", source: "functions/src/callables/stockTransfers.ts (StockTransferStatus)" },
    { name: "payment-processing-fee", source: "functions/src/callables/paymentFees.ts (recorded/verified/disputed/reversed)" },
    { name: "approval-decision", source: "functions/src/callables/approvals.ts (pending/approved/rejected)" },
  ];

  const smPath = path.join(ROOT, "docs", "flutter-contract", "state-machines.md");
  const smText = fs.existsSync(smPath) ? fs.readFileSync(smPath, "utf8") : "";
  const docRows = [...smText.matchAll(/^\|\s*\*\*([a-z0-9_-]+)\*\*\s*\|/gm)].map((m) => m[1]);

  return {
    codeCount: codeMachines.length,
    codeMachines,
    documentedCount: docRows.length,
    documentedNames: docRows,
  };
}

function parseContract() {
  const contractDir = path.join(ROOT, "docs", "flutter-contract");
  const formsDir = path.join(contractDir, "forms");
  const topDocs = fs.existsSync(contractDir)
    ? fs.readdirSync(contractDir).filter((f) => f.endsWith(".md")).sort()
    : [];
  const formJsons = fs.existsSync(formsDir)
    ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json")).sort()
    : [];
  const entityFormFiles = formJsons.filter((f) => !f.startsWith("request-details-"));
  const requestDetailFormFiles = formJsons.filter((f) => f.startsWith("request-details-"));

  let totalEntityFields = 0;
  const zeroFieldForms = [];
  const entityForms = [];
  for (const f of entityFormFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(formsDir, f), "utf8"));
    const count = Array.isArray(parsed.fields) ? parsed.fields.length : 0;
    totalEntityFields += count;
    if (count === 0) zeroFieldForms.push(parsed.entity || f);
    entityForms.push({
      entity: parsed.entity || f.replace(/\.json$/, ""),
      file: f,
      fieldsCount: count,
      callables: parsed.callables || {},
    });
  }

  const summaryPath = path.join(contractDir, "SUMMARY.md");
  const summaryLines = fs.existsSync(summaryPath)
    ? fs.readFileSync(summaryPath, "utf8").split(/\r?\n/).length
    : 0;

  return {
    topLevelDocsCount: topDocs.length,
    topLevelDocs: topDocs,
    entityFormsCount: entityFormFiles.length,
    requestDetailFormsCount: requestDetailFormFiles.length,
    totalFormJsonFiles: formJsons.length,
    totalEntityFields,
    zeroFieldForms,
    summaryLines,
    entityForms,
  };
}

function parseAllowlist() {
  const allowPath = path.join(FUNCTIONS_DIR, "scripts", "duplication-allowlist.json");
  const data = JSON.parse(fs.readFileSync(allowPath, "utf8"));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const byKind = {};
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  }
  const nums = entries.map((e) => Number(String(e.id || "").replace(/^DUP-/, ""))).filter((n) => !Number.isNaN(n));
  return {
    totalExceptions: entries.length,
    byKind,
    maxId: nums.length ? `DUP-${String(Math.max(...nums)).padStart(3, "0")}` : null,
  };
}

function countMarkdownDocs() {
  const docsDir = path.join(ROOT, "docs");
  return truth.walkFiles(docsDir, (f) => f.endsWith(".md")).length;
}

function parseUnitTestFiles() {
  const unitDir = path.join(FUNCTIONS_DIR, "src", "test", "unit");
  const rulesDir = path.join(FUNCTIONS_DIR, "src", "test", "rules");
  const scriptsDir = path.join(FUNCTIONS_DIR, "scripts");
  const unitFiles = fs.existsSync(unitDir) ? fs.readdirSync(unitDir).filter((f) => f.endsWith(".test.ts")).sort() : [];
  const rulesFiles = fs.existsSync(rulesDir) ? fs.readdirSync(rulesDir).filter((f) => f.endsWith(".test.ts")).sort() : [];
  const testScripts = fs.existsSync(scriptsDir)
    ? fs.readdirSync(scriptsDir).filter((f) => /^test-.*\.(c?js)$/.test(f)).sort()
    : [];
  return { unitFiles, rulesFiles, testScripts };
}

function runUnitSuite() {
  const cmd = "node --test lib/test/unit/**/*.test.js";
  try {
    const out = execSync(cmd, { cwd: FUNCTIONS_DIR, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
    const parseNum = (label) => {
      const m = out.match(new RegExp(`ℹ ${label} (\\d+)`));
      return m ? Number(m[1]) : null;
    };
    return {
      status: "EXECUTED",
      command: `npm --prefix functions run test:unit (${cmd})`,
      tests: parseNum("tests"),
      suites: parseNum("suites"),
      pass: parseNum("pass"),
      fail: parseNum("fail"),
      cancelled: parseNum("cancelled"),
      skipped: parseNum("skipped"),
      todo: parseNum("todo"),
    };
  } catch (err) {
    return {
      status: "FAILED",
      command: cmd,
      error: err.message,
    };
  }
}

function collectNumbers(options = {}) {
  const exportsList = truth.getExports();
  const callables = exportsList.filter((e) => e.type === "callable");
  const triggers = exportsList.filter((e) => e.type === "trigger" && e.factory !== "onSchedule");
  const schedules = exportsList.filter((e) => e.type === "trigger" && e.factory === "onSchedule");

  const byDomain = {};
  const byGate = {};
  for (const c of callables) {
    const d = classifyDomain(c.file);
    const g = classifyGate(c);
    byDomain[d] = (byDomain[d] || 0) + 1;
    byGate[g] = (byGate[g] || 0) + 1;
  }

  const colInfo = truth.getCollections({ skipRules: options.skipRules });
  const docTypes = truth.getDocTypes();
  const pkg = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, "package.json"), "utf8"));

  const gitSha = safeExec("git rev-parse HEAD");
  const gitPorcelain = safeExec("git status --porcelain");
  const gitDirty = gitPorcelain !== null ? gitPorcelain.length > 0 : null;

  return {
    meta: {
      utcTime: new Date().toISOString(),
      gitSha,
      gitDirty,
      nodeVersion: process.version,
      expectedNodeEngine: pkg.engines?.node || "unspecified",
      command: "node functions/scripts/report-numbers.js" + (options.runUnit ? " --run-unit" : ""),
    },
    exports: {
      total: exportsList.length,
      callables: callables.length,
      triggers: triggers.length,
      schedules: schedules.length,
      triggerNames: triggers.map((t) => t.name),
      scheduleNames: schedules.map((s) => s.name),
      callablesByDomain: byDomain,
      callablesByGate: byGate,
    },
    collections: {
      inSourceCount: colInfo.collections.length,
      docInterfacesCount: Object.keys(docTypes).length,
      explicitRulesBlocksCount: colInfo.explicitRules.length,
      defaultDenyInRulesCount: colInfo.defaultDeny.length,
    },
    contract: parseContract(),
    permissions: parsePermissions(),
    reasonCodes: parseReasonCodes(),
    stateMachines: parseStateMachines(),
    allowlist: parseAllowlist(),
    docs: {
      totalMarkdownFiles: countMarkdownDocs(),
    },
    testInventory: {
      unitTestFilesCount: parseUnitTestFiles().unitFiles.length,
      rulesTestFilesCount: parseUnitTestFiles().rulesFiles.length,
      emulatorTestScriptsCount: parseUnitTestFiles().testScripts.length,
      unitRun: options.runUnit ? runUnitSuite() : { status: "NOT RUN" },
      emulatorRun: { status: "NOT RUN" },
    },
  };
}

function formatTextReport(n) {
  const lines = [
    "=== TRADO BACKEND SOURCE-DERIVED NUMBERS (D-N1) ===",
    `UTC Time:       ${n.meta.utcTime}`,
    `Git SHA:        ${n.meta.gitSha} (dirty: ${n.meta.gitDirty})`,
    `Node Runtime:   ${n.meta.nodeVersion} (package.json engines.node: ${n.meta.expectedNodeEngine})`,
    `Command:        ${n.meta.command}`,
    "",
    "--- Exports (functions/src/index.ts) ---",
    `Total exports:  ${n.exports.total} (= ${n.exports.callables} callables + ${n.exports.triggers} triggers + ${n.exports.schedules} schedules)`,
    `Triggers (${n.exports.triggers}):   ${n.exports.triggerNames.join(", ")}`,
    `Schedules (${n.exports.schedules}):  ${n.exports.scheduleNames.join(", ")}`,
    `Callables by gate: ${Object.entries(n.exports.callablesByGate).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `Callables by domain (${Object.keys(n.exports.callablesByDomain).length} domains):`,
    ...Object.entries(n.exports.callablesByDomain).sort((a, b) => a[0].localeCompare(b[0])).map(([d, c]) => `  - ${d}: ${c}`),
    "",
    "--- Collections & Models ---",
    `Collections referenced in source: ${n.collections.inSourceCount}`,
    `Document interfaces (*Doc) in models.ts: ${n.collections.docInterfacesCount}`,
    `Explicit collection match blocks in firestore.rules: ${n.collections.explicitRulesBlocksCount}`,
    `Source collections covered by default-deny rule: ${n.collections.defaultDenyInRulesCount}`,
    "",
    "--- Flutter Contract Pack (docs/flutter-contract/) ---",
    `Top-level contract docs: ${n.contract.topLevelDocsCount}`,
    `Entity form JSONs:       ${n.contract.entityFormsCount} (total fields: ${n.contract.totalEntityFields})`,
    `Request-detail JSONs:    ${n.contract.requestDetailFormsCount}`,
    `Total form JSON files:   ${n.contract.totalFormJsonFiles}`,
    `Zero-field entity forms: ${n.contract.zeroFieldForms.length} (${n.contract.zeroFieldForms.join(", ") || "none"})`,
    `SUMMARY.md lines:        ${n.contract.summaryLines}`,
    "",
    "--- Permissions (functions/src/constants/permissions.ts) ---",
    `AppPermissions entries:  ${n.permissions.totalEntries} (${n.permissions.concreteCount} concrete + ${n.permissions.wildcards.length} wildcards: ${n.permissions.wildcards.join(", ")})`,
    `Documented in contract:  ${n.permissions.documentedInContractCount}/${n.permissions.concreteCount}`,
    "",
    "--- Reason / Error Codes ---",
    `GateReason enum:         ${n.reasonCodes.gateReasonEnumCount}`,
    `RequestReason enum:      ${n.reasonCodes.requestReasonEnumCount}`,
    `Unique thrown codes:     ${n.reasonCodes.thrownLiteralsCount}`,
    `Documented in errors.md: ${n.reasonCodes.documentedInErrorsMdCount}`,
    `Undocumented thrown:     ${n.reasonCodes.undocumentedThrownCount}`,
    "",
    "--- State Machines ---",
    `State machines in code:  ${n.stateMachines.codeCount}`,
    `Documented in contract:  ${n.stateMachines.documentedCount}`,
    "",
    "--- Duplication Allowlist (functions/scripts/duplication-allowlist.json) ---",
    `Total exceptions:        ${n.allowlist.totalExceptions} (max id: ${n.allowlist.maxId})`,
    `By kind:                 ${Object.entries(n.allowlist.byKind).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "--- Documentation & Tests ---",
    `Markdown files in docs/: ${n.docs.totalMarkdownFiles}`,
    `Unit test files:         ${n.testInventory.unitTestFilesCount}`,
    `Rules test files:        ${n.testInventory.rulesTestFilesCount}`,
    `Emulator test scripts:   ${n.testInventory.emulatorTestScriptsCount}`,
    `Unit run:                ${n.testInventory.unitRun.status === "EXECUTED" ? `${n.testInventory.unitRun.pass}/${n.testInventory.unitRun.tests} pass (${n.testInventory.unitRun.suites} suites, ${n.testInventory.unitRun.skipped} skipped)` : n.testInventory.unitRun.status}`,
    `Emulator run:            ${n.testInventory.emulatorRun.status}`,
  ];
  return lines.join("\n");
}

if (require.main === module) {
  const asJson = process.argv.includes("--json");
  const runUnit = process.argv.includes("--run-unit");
  const result = collectNumbers({ runUnit });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTextReport(result));
  }
}

module.exports = { collectNumbers, formatTextReport };
