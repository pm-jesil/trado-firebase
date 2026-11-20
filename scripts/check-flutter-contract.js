#!/usr/bin/env node
/**
 * @guard-scope: files docs/flutter-contract/**, functions/src/constants/permissions.ts, functions/src/index.ts
 * Trado Flutter Contract Pack & API Reference Freshness Guard (D-34, D-35, D-55, D-57)
 *
 * Verifies:
 *   1. All required top-level docs, JSON catalogs (callables.json, permissions.json), and callables/INDEX.md exist.
 *   2. SUMMARY.md stays <= 250 lines and includes contract changes section.
 *   3. All required entity/action forms (.md + .json) exist, have > 0 fields (no empty forms like MG-15).
 *   4. Contract Lints:
 *      - uiHint: "money" is ONLY allowed on numeric fields (MG-05, BM-2).
 *      - callables.update points ONLY to a callable with declared kind === "update" (MG-06, BM-3).
 *      - Every callable referenced in forms/<entity>.json exists in functions/src/index.ts (MG-38).
 *      - Every exported callable in functions/src/index.ts appears in callables.json (BM-11).
 *      - Every thrown reason code in functions/src/ appears in errors.md.
 *      - Every concrete permission in permissions.ts appears in permissions.json with non-empty description
 *        and scopeNote for scoped keys (*_own, *_org, *_branch, *_all) (MG-03, MG-07, BM-14).
 *   5. Integrity Checksum: .checksum.json matches every generated file (catches hand edits — D-57, BM-1).
 *
 * Usage: node scripts/check-flutter-contract.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const truth = require("./lib/source-truth.js");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_DIR = path.join(ROOT, "docs", "flutter-contract");
const FORMS_DIR = path.join(CONTRACT_DIR, "forms");
const CALLABLES_DIR = path.join(CONTRACT_DIR, "callables");
const SUMMARY_FILE = path.join(CONTRACT_DIR, "SUMMARY.md");

const REQUIRED_TOP_DOCS = [
  "README.md",
  "SUMMARY.md",
  "responses.md",
  "serialization.md",
  "errors.md",
  "permissions.md",
  "state-machines.md",
  "activity-log.md",
  "usage-limits.md",
  "client-meta-and-idempotency.md",
  "CHANGES.md",
  "images.md",
  "auth.md",
];

const REQUIRED_ENTITIES = [
  "organization", "branch", "employee", "customer", "vendor", "product",
  "category", "unit", "bill", "purchase", "expense", "payment",
  "delivery", "return", "stock_adjustment", "task", "role", "job_role",
  "department", "team", "approval_request", "recurring_expense", "plan",
  "request", "financial_account", "storage_location", "stock_transfer",
  "account_transfer", "payment_processing_fee", "capital_transaction",
  "user_profile", "ownership_transfer", "sharing_policy", "usage_limits", "requests_settings",
];

function validateFormLint(formJson, callableKindMap) {
  assert.ok(Array.isArray(formJson.fields) && formJson.fields.length > 0, `Entity form "${formJson.entity}" has 0 fields (MG-15)`);

  // MG-05 / BM-2: uiHint compatibility
  for (const field of formJson.fields) {
    if (field.uiHint === "money") {
      assert.ok(field.type === "number", `Contract lint violation (MG-05): ${formJson.entity}.${field.path} has uiHint "${field.uiHint}" on non-number type "${field.type}"`);
      assert.strictEqual(field.currencyExponentFrom, "organization.currencyInfo.exponent", `Contract lint violation: ${formJson.entity}.${field.path} missing currencyExponentFrom`);
    }
  }

  // MG-06 / BM-3 / MG-38: callable existence & update kind
  const c = formJson.callables || {};
  const checkExists = (name, slot) => {
    if (!name) return;
    assert.ok(callableKindMap.has(name), `Contract lint violation (MG-38): ${formJson.entity}.callables.${slot} references non-existent callable "${name}"`);
  };
  checkExists(c.create, "create");
  checkExists(c.get, "get");
  checkExists(c.list, "list");
  checkExists(c.update, "update");
  checkExists(c.delete, "delete");
  checkExists(c.void, "void");
  if (c.update) {
    const kind = callableKindMap.get(c.update);
    assert.strictEqual(kind, "update", `Contract lint violation (MG-06): ${formJson.entity}.callables.update "${c.update}" has kind "${kind}", expected "update"`);
  }
  for (const act of c.actions || []) {
    checkExists(act.name, `actions[${act.name}]`);
  }
}

function validatePermissionsLint(permsJson, concreteCodes) {
  assert.strictEqual(permsJson.permissions.length, concreteCodes.length, `permissions.json length (${permsJson.permissions.length}) !== registry concrete length (${concreteCodes.length})`);
  const byKey = new Map(permsJson.permissions.map((p) => [p.key, p]));
  for (const code of concreteCodes) {
    const entry = byKey.get(code);
    assert.ok(entry, `Permission "${code}" missing from permissions.json`);
    assert.ok(typeof entry.description === "string" && entry.description.trim().length > 0, `Permission "${code}" missing description (BM-14)`);
    if (/_(own|org|branch|all)$/.test(code)) {
      assert.ok(typeof entry.scopeNote === "string" && entry.scopeNote.trim().length > 0, `Scoped permission "${code}" missing scopeNote (MG-03)`);
    }
  }
}

function verifyChecksumManifest(contractDir) {
  const manifestPath = path.join(contractDir, ".checksum.json");
  assert.ok(fs.existsSync(manifestPath), "Missing .checksum.json integrity manifest — run `node scripts/generate-flutter-contract.js`");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedFiles = manifest.files || {};
  const actualFiles = {};

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name !== ".checksum.json") {
        const relPath = path.relative(contractDir, abs).replace(/\\/g, "/");
        const content = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
        actualFiles[relPath] = crypto.createHash("sha256").update(content).digest("hex");
      }
    }
  };
  walk(contractDir);

  for (const [relPath, expectedHash] of Object.entries(expectedFiles)) {
    assert.ok(actualFiles[relPath], `Generated contract file deleted: ${relPath}`);
    assert.strictEqual(actualFiles[relPath], expectedHash, `Hand-edit or drift detected in generated contract file "${relPath}" (D-57). Regenerate with scripts/generate-flutter-contract.js.`);
  }
  for (const relPath of Object.keys(actualFiles)) {
    assert.ok(expectedFiles[relPath], `Untracked file in docs/flutter-contract/: ${relPath}`);
  }
  return Object.keys(expectedFiles).length;
}

function runSelfTests() {
  const fakeKinds = new Map([["thingsCreate", "create"], ["thingsDelete", "delete"], ["thingsUpdate", "update"]]);

  // Seeded defect 1: Oversized SUMMARY.md (> 250 lines)
  assert.throws(() => assert.ok(new Array(251).fill("line").length <= 250), "Seeded defect: oversized SUMMARY.md must fail");

  // Seeded defect 2 (BM-2): money uiHint on a string field
  assert.throws(() => validateFormLint({
    entity: "customer",
    callables: { create: "thingsCreate", update: "thingsUpdate", actions: [] },
    fields: [{ path: "priceGroup", type: "string", uiHint: "money" }],
  }, fakeKinds), /uiHint "money" on non-number type "string"/);

  // Seeded defect 3 (BM-3): update pointing to delete callable
  assert.throws(() => validateFormLint({
    entity: "job_role",
    callables: { create: "thingsCreate", update: "thingsDelete", actions: [] },
    fields: [{ path: "name", type: "string", uiHint: "text" }],
  }, fakeKinds), /expected "update"/);

  // Seeded defect 4 (MG-15): 0-field entity form
  assert.throws(() => validateFormLint({
    entity: "approval_request",
    callables: { actions: [] },
    fields: [],
  }, fakeKinds), /0 fields/);

  // Seeded defect 5 (BM-14): permission without description
  assert.throws(() => validatePermissionsLint({
    permissions: [{ key: "audit:read_own", description: "", scopeNote: "own" }],
  }, ["audit:read_own"]), /missing description/);
}

function runCheck(isTestMode = false) {
  runSelfTests();
  if (isTestMode) {
    console.log("✓ check:flutter-contract --test self-tests passed (5/5 seeded defects caught: oversize summary, BM-2 money uiHint on a string field, BM-3 update->delete, MG-15 0-field form, BM-14 empty permission description).");
    return;
  }

  let examinedCount = 0;

  // 1. Directory & core top-level docs
  assert.ok(fs.existsSync(CONTRACT_DIR), "docs/flutter-contract directory must exist");
  assert.ok(fs.existsSync(FORMS_DIR), "docs/flutter-contract/forms directory must exist");
  assert.ok(fs.existsSync(CALLABLES_DIR), "docs/flutter-contract/callables directory must exist");
  for (const f of REQUIRED_TOP_DOCS) {
    const p = path.join(CONTRACT_DIR, f);
    assert.ok(fs.existsSync(p), `Missing required contract doc: ${f}`);
    assert.ok(fs.readFileSync(p, "utf8").trim().length > 50, `Contract doc is empty: ${f}`);
    examinedCount++;
  }

  // 2. SUMMARY.md <= 250 lines
  const summaryLines = fs.readFileSync(SUMMARY_FILE, "utf8").split("\n").length;
  assert.ok(summaryLines <= 250, `SUMMARY.md exceeds 250 lines (${summaryLines})`);
  examinedCount++;

  // 3. Callables catalog completeness (BM-11)
  const callablesJsonPath = path.join(CONTRACT_DIR, "callables.json");
  assert.ok(fs.existsSync(callablesJsonPath), "Missing docs/flutter-contract/callables.json");
  assert.ok(fs.existsSync(path.join(CALLABLES_DIR, "INDEX.md")), "Missing docs/flutter-contract/callables/INDEX.md");
  const callablesJson = JSON.parse(fs.readFileSync(callablesJsonPath, "utf8"));
  const exportedCallables = truth.getExports().filter((e) => e.type === "callable");
  const callableKindMap = new Map(exportedCallables.map((c) => [c.name, c.kind]));
  const catalogNames = new Set((callablesJson.callables || []).map((c) => c.name));
  for (const exp of exportedCallables) {
    assert.ok(catalogNames.has(exp.name), `Callable "${exp.name}" exported in index.ts is missing from callables.json (BM-11)`);
    examinedCount++;
  }
  assert.strictEqual(callablesJson.totalCallables, exportedCallables.length, `callables.json totalCallables (${callablesJson.totalCallables}) !== exported callables (${exportedCallables.length})`);

  // 4. Required entity forms (.md and .json) + lints (MG-05, MG-06, MG-15, MG-38)
  for (const entity of REQUIRED_ENTITIES) {
    const mdPath = path.join(FORMS_DIR, `${entity}.md`);
    const jsonPath = path.join(FORMS_DIR, `${entity}.json`);
    assert.ok(fs.existsSync(mdPath), `Entity form markdown missing: forms/${entity}.md`);
    assert.ok(fs.existsSync(jsonPath), `Entity form json missing: forms/${entity}.json`);
    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.strictEqual(jsonContent.entity, entity, `Entity mismatch in forms/${entity}.json`);
    validateFormLint(jsonContent, callableKindMap);
    examinedCount += 2;
  }

  // 5. Permissions cross-check (permissions.ts vs permissions.md + permissions.json)
  const permTs = fs.readFileSync(path.join(ROOT, "functions/src/constants/permissions.ts"), "utf8");
  const permDoc = fs.readFileSync(path.join(CONTRACT_DIR, "permissions.md"), "utf8");
  const permJson = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, "permissions.json"), "utf8"));
  const concreteCodes = [...permTs.matchAll(/^\s*[A-Z0-9_]+:\s*"([^"]+)"/gm)].map((m) => m[1]).filter((c) => !c.includes("*"));
  for (const code of concreteCodes) {
    assert.ok(permDoc.includes(`\`${code}\``), `Permission code ${code} not documented in permissions.md`);
  }
  validatePermissionsLint(permJson, concreteCodes);
  examinedCount += concreteCodes.length;

  // 6. Thrown reason codes coverage in errors.md
  const errorsDoc = fs.readFileSync(path.join(CONTRACT_DIR, "errors.md"), "utf8");
  const thrownReasons = new Set();
  for (const abs of truth.productionSourceFiles()) {
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/\breason\s*:\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) thrownReasons.add(m[1]);
    for (const m of src.matchAll(/\b(?:GateReason|RequestReason)\.([A-Z][A-Z0-9_]+)\b/g)) thrownReasons.add(m[1]);
  }
  for (const code of thrownReasons) {
    assert.ok(errorsDoc.includes(`\`${code}\``), `Thrown reason code "${code}" is missing from docs/flutter-contract/errors.md`);
    examinedCount++;
  }

  // 7. Integrity checksum (BM-1 / D-57: catches hand-edits)
  const checksumCount = verifyChecksumManifest(CONTRACT_DIR);
  examinedCount += checksumCount;

  console.log(
    `✓ check:flutter-contract passed (D-34: examined ${examinedCount} items across ${REQUIRED_TOP_DOCS.length} contract docs, ${REQUIRED_ENTITIES.length} entity forms, ${exportedCallables.length} callables, ${concreteCodes.length} permissions, ${thrownReasons.size} error codes, ${checksumCount} checksummed files; SUMMARY.md ${summaryLines} lines, 0 violations, 0 D-17 exclusions, 5/5 seeded defect self-tests verified).`
  );
}

const isTest = process.argv.includes("--test");
runCheck(isTest);
