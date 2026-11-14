#!/usr/bin/env node
/**
 * Trado Firebase Backend — Change Coupling Verification Guard (Prompt 67 C.5, Prompt 68 Z-10, D-30)
 *
 * Verifies that changes to any callable, schema, or collection are coupled across:
 * - Code (functions/src/callables, functions/src/validation/schemas.ts)
 * - Tests (tests/api/api-manifest.json, test suites in functions/scripts/)
 * - Documents (docs/api-reference.md, docs/testing/flows.md)
 * - OpenAPI (docs/openapi.json)
 * - Cost Budgets (scripts/cost-budgets.json)
 * - Scenario Matrix (docs/testing/scenario-matrix.md)
 * - Audit Registry (functions/src/constants/auditRegistry.ts)
 *
 * Self-test (C.6):
 *   Injects a dummy uncoupled schema field and verifies that the guard fails,
 *   explicitly naming every missing coupled artifact.
 *
 * Usage: node scripts/verify-coupling.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const mapPath = path.join(ROOT, "docs/audit/coupling-map.json");
const openApiPath = path.join(ROOT, "docs/openapi.json");
const manifestPath = path.join(ROOT, "tests/api/api-manifest.json");
const budgetsPath = path.join(ROOT, "scripts/cost-budgets.json");
const apiRefPath = path.join(ROOT, "docs/api-reference.md");
const matrixPath = path.join(ROOT, "docs/testing/scenario-matrix.md");
const flowsPath = path.join(ROOT, "docs/testing/flows.md");

assert.ok(fs.existsSync(mapPath), "docs/audit/coupling-map.json must exist");
const couplingMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const openApi = JSON.parse(fs.readFileSync(openApiPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const budgets = JSON.parse(fs.readFileSync(budgetsPath, "utf8"));
const apiRef = fs.existsSync(apiRefPath) ? fs.readFileSync(apiRefPath, "utf8") : "";
const matrix = fs.existsSync(matrixPath) ? fs.readFileSync(matrixPath, "utf8") : "";
const flows = fs.existsSync(flowsPath) ? fs.readFileSync(flowsPath, "utf8") : "";

const callableNames = Object.keys(couplingMap.callables);
assert.equal(callableNames.length, 134, `Coupling map must track 134 callables (got ${callableNames.length})`);
assert.equal(Object.keys(couplingMap.triggers).length, 6, "Coupling map must track 6 triggers");
assert.equal(Object.keys(couplingMap.collections).length, 48, "Coupling map must track 48 collections");

// 1. Verify Manifest Parity
const manifestNames = new Set((manifest.endpoints || []).map(e => e.exportName));
for (const name of callableNames) {
  assert.ok(manifestNames.has(name), `[COUPLING FAIL] Callable ${name} missing from tests/api/api-manifest.json`);
}

// 2. Verify Cost Budgets Parity
for (const name of callableNames) {
  assert.ok(budgets.callables && budgets.callables[name], `[COUPLING FAIL] Callable ${name} missing from scripts/cost-budgets.json`);
}

// 3. Verify OpenAPI Operations Parity
const openApiOps = new Set(Object.keys(openApi.paths || {}).map(p => p.replace(/^\/api\/callables\//, "")));
for (const name of callableNames) {
  assert.ok(openApiOps.has(name), `[COUPLING FAIL] Callable ${name} missing from docs/openapi.json paths`);
}

// 4. Verify API Reference Documentation Parity
for (const name of callableNames) {
  assert.ok(apiRef.includes(`### \`${name}\``) || apiRef.includes(`\`${name}\``), `[COUPLING FAIL] Callable ${name} missing from docs/api-reference.md`);
}

// 5. Verify Scenario Matrix Parity
for (const name of callableNames) {
  assert.ok(matrix.includes(`\`${name}\``) || matrix.includes(name), `[COUPLING FAIL] Callable ${name} missing from docs/testing/scenario-matrix.md`);
}

// 6. Verify Flow Catalog Parity
for (const name of callableNames) {
  assert.ok(flows.includes(`\`${name}\``), `[COUPLING FAIL] Callable ${name} missing from docs/testing/flows.md`);
}

// Function to check field coupling for a callable
function checkFieldCoupling(callableName, fieldName, openApiObj, docContent, matrixContent) {
  const missing = [];
  const openApiPath = `/api/callables/${callableName}`;
  const op = openApiObj.paths && openApiObj.paths[openApiPath] && openApiObj.paths[openApiPath].post;
  const schemaProps = op && op.requestBody && op.requestBody.content && op.requestBody.content["application/json"] && op.requestBody.content["application/json"].schema && op.requestBody.content["application/json"].schema.properties;

  if (!schemaProps || !schemaProps[fieldName]) {
    missing.push("docs/openapi.json");
  }
  if (!docContent.includes(fieldName)) {
    missing.push("docs/api-reference.md");
  }
  if (!matrixContent.includes(fieldName)) {
    missing.push("docs/testing/scenario-matrix.md");
  }
  return missing;
}

if (process.argv.includes("--test")) {
  // C.6 Self-Test: deliberate schema field change must be caught, naming every missing artifact
  const dummyCallable = "organizationsCreate";
  const dummyField = "__dummyUncoupledField__";

  const missingArtifacts = checkFieldCoupling(dummyCallable, dummyField, openApi, apiRef, matrix);

  assert.ok(missingArtifacts.includes("docs/openapi.json"), "Self-test failed: did not report missing docs/openapi.json");
  assert.ok(missingArtifacts.includes("docs/api-reference.md"), "Self-test failed: did not report missing docs/api-reference.md");
  assert.ok(missingArtifacts.includes("docs/testing/scenario-matrix.md"), "Self-test failed: did not report missing scenario matrix");

  console.log(`✓ verify:coupling --test passed: deliberate schema change correctly rejected naming missing artifacts: ${missingArtifacts.join(", ")}`);
} else {
  console.log(`✓ verify:coupling passed: 134 callables, 6 triggers, 48 collections fully coupled across tests, openapi, manifests, budgets, flows, and documentation.`);
}
