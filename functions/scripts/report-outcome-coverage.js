#!/usr/bin/env node
/**
 * Trado Outcome-Based Callable Coverage Reporter (Hybrid Prompt 76 — BX4 TT-4, D-60)
 *
 * Replaces name-mention scratch scripts (`scratch/audit-coverage.js`).
 * Reads declared callables & outcomes from `docs/flutter-contract/callables.json` and maps
 * explicit `[callableName#OUTCOME]` tags in test titles/assertions across unit & emulator tests.
 * A callable mentioned without an explicit `[callableName#OUTCOME]` tag is reported as UNTESTED.
 *
 * Usage:
 *   node functions/scripts/report-outcome-coverage.js [--json] [--priority-only]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const FUNCTIONS_DIR = path.join(ROOT, "functions");
const CATALOG_PATH = path.join(ROOT, "docs", "flutter-contract", "callables.json");

const PRIORITY_DOMAINS = [
  "bills", "outflows", "payments", "paymentFees", "financialAccounts", "ledgerVerify",
  "returns", "stock", "stockTransfers", "stockVerify", "storageLocations", "approvals",
  "requests", "organizations", "authMe", "authLogin", "plans",
];

function collectTestFiles() {
  const files = [];
  const unitDir = path.join(FUNCTIONS_DIR, "src", "test", "unit");
  if (fs.existsSync(unitDir)) {
    for (const f of fs.readdirSync(unitDir).filter((x) => x.endsWith(".test.ts")).sort()) {
      files.push(path.join(unitDir, f));
    }
  }
  const scriptsDir = path.join(FUNCTIONS_DIR, "scripts");
  if (fs.existsSync(scriptsDir)) {
    for (const f of fs.readdirSync(scriptsDir).filter((x) => /^test-.*\.(c?js)$/.test(x)).sort()) {
      files.push(path.join(scriptsDir, f));
    }
  }
  return files;
}

/**
 * Extracts explicit `[callableName#OUTCOME]` tags from test files.
 * Returns Map<callableName, Map<outcome, Array<{ file, line, snippet }>>>
 */
function scanOutcomeTags(testFiles) {
  const tagMap = new Map();
  const re = /\[([a-z][A-Za-z0-9]+)#([A-Za-z0-9_:.-]+)\]/g;

  for (const abs of testFiles) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(re)) {
        const callable = m[1];
        const outcome = m[2];
        if (!tagMap.has(callable)) tagMap.set(callable, new Map());
        const om = tagMap.get(callable);
        if (!om.has(outcome)) om.set(outcome, []);
        om.get(outcome).push({ file: rel, line: idx + 1, snippet: line.trim().slice(0, 120) });
      }
    });
  }
  return tagMap;
}

function buildOutcomeCoverage(options = {}) {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Missing ${CATALOG_PATH}. Run \`node scripts/generate-flutter-contract.js\`.`);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const testFiles = options.testFiles || collectTestFiles();
  const tagMap = scanOutcomeTags(testFiles);

  // Order priority domains first (money, stock, account, approval, request, org, auth, subscription)
  const ordered = [...(catalog.callables || [])].sort((a, b) => {
    const ai = PRIORITY_DOMAINS.indexOf(a.domain);
    const bi = PRIORITY_DOMAINS.indexOf(b.domain);
    const ap = ai >= 0 ? ai : 999;
    const bp = bi >= 0 ? bi : 999;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });

  let callablesWithOutcome = 0;
  let totalDeclaredOutcomes = 0;
  let assertedDeclaredOutcomes = 0;
  const rows = [];

  for (const c of ordered) {
    const declared = ["ok", ...(c.errors || [])];
    const foundMap = tagMap.get(c.name) || new Map();
    const cells = declared.map((outcome) => {
      const hits = foundMap.get(outcome) || [];
      totalDeclaredOutcomes++;
      if (hits.length > 0) assertedDeclaredOutcomes++;
      return {
        outcome,
        status: hits.length > 0 ? "ASSERTED" : "UNTESTED",
        hits,
      };
    });
    // Include extra asserted outcomes (e.g. denied:permission, denied:tenant, invalid, replay, concurrent)
    const extraAsserted = [...foundMap.keys()].filter((k) => !declared.includes(k));
    const hasAny = cells.some((x) => x.status === "ASSERTED") || extraAsserted.length > 0;
    if (hasAny) callablesWithOutcome++;

    rows.push({
      callable: c.name,
      domain: c.domain,
      priority: PRIORITY_DOMAINS.includes(c.domain),
      assertedCount: cells.filter((x) => x.status === "ASSERTED").length + extraAsserted.length,
      declaredCount: declared.length,
      cells,
      extraAsserted,
    });
  }

  return {
    totalCallables: ordered.length,
    callablesWithAtLeastOneOutcome: callablesWithOutcome,
    totalDeclaredOutcomes,
    assertedDeclaredOutcomes,
    untestedCallablesCount: ordered.length - callablesWithOutcome,
    testFilesScanned: testFiles.length,
    rows,
  };
}

function formatSummary(report, priorityOnly = false) {
  const lines = [
    "=== TRADO OUTCOME-BASED CALLABLE COVERAGE REPORT (D-60) ===",
    `Test files scanned:                     ${report.testFilesScanned}`,
    `Callables with >= 1 asserted outcome:   ${report.callablesWithAtLeastOneOutcome} / ${report.totalCallables}`,
    `Declared outcomes asserted:             ${report.assertedDeclaredOutcomes} / ${report.totalDeclaredOutcomes}`,
    `Callables completely UNTESTED (by tag): ${report.untestedCallablesCount} / ${report.totalCallables}`,
    "",
    "Callable (priority domains first)       | Domain             | Asserted / Declared | Status",
    "----------------------------------------+--------------------+---------------------+---------",
  ];
  const list = priorityOnly ? report.rows.filter((r) => r.priority) : report.rows;
  for (const r of list) {
    const status = r.assertedCount > 0 ? "PARTIAL/TAGGED" : "UNTESTED";
    lines.push(`${r.callable.padEnd(39)} | ${r.domain.padEnd(18)} | ${String(r.assertedCount).padStart(8)} / ${String(r.declaredCount).padEnd(8)} | ${status}`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  const asJson = process.argv.includes("--json");
  const priorityOnly = process.argv.includes("--priority-only");
  const report = buildOutcomeCoverage();
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else console.log(formatSummary(report, priorityOnly));
}

module.exports = { buildOutcomeCoverage, formatSummary, scanOutcomeTags, PRIORITY_DOMAINS };
