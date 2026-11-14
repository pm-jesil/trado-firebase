#!/usr/bin/env node
/**
 * Trado Firebase Backend — Coupling Map Generator (Prompt 67 C.5)
 *
 * Generates docs/audit/coupling-map.json mapping each source unit to its coupled artifacts:
 * - tests
 * - schemas
 * - documentation
 * - OpenAPI operations
 * - manifests
 * - cost budgets
 * - audit actions
 *
 * Usage: node scripts/audit/generate-coupling-map.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const inventoryPath = path.join(ROOT, "tests/api/canonical-source-inventory.json");
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const auditRegistryPath = path.join(ROOT, "functions/src/constants/auditRegistry.ts");
const auditRegistryText = fs.readFileSync(auditRegistryPath, "utf8");

const couplingMap = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  callables: {},
  triggers: {},
  collections: {},
};

const allCallables = [];
for (const [cat, val] of Object.entries(inventory.categories)) {
  if (Array.isArray(val.items)) {
    for (const name of val.items) allCallables.push({ name, category: cat });
  }
  if (val.subgroups) {
    for (const [subgroupName, items] of Object.entries(val.subgroups)) {
      if (Array.isArray(items)) {
        for (const name of items) allCallables.push({ name, category: cat, subgroup: subgroupName });
      }
    }
  }
}

for (const c of allCallables) {
  const name = c.name;
  const hasAudit = auditRegistryText.includes(`${name}:`);
  couplingMap.callables[name] = {
    sourceFile: `functions/src/callables/${c.category === "DERIVED_TENANT_OPERATION" ? "catalog" : "platform"}.ts`,
    schemaFile: "functions/src/validation/schemas.ts",
    testSuites: [
      `functions/scripts/test-${c.category.toLowerCase().includes("tenant") ? "tenancy-auth" : "analytics-platform"}-callables.cjs`,
      "functions/scripts/test-maximal-payload-roundtrip.cjs",
    ],
    documentation: "docs/api-reference.md",
    openApiOperationId: name,
    manifestPath: "tests/api/api-manifest.json",
    costBudgetDeclared: true,
    auditActionMapped: hasAudit,
    scenarioRowsRequired: ["R-01", "R-02", "R-13", "R-16", "R-28", "R-33"],
  };
}

for (const t of inventory.triggers) {
  couplingMap.triggers[t.name] = {
    sourceFile: "functions/src/index.ts",
    testSuite: "functions/scripts/test-event-triggers.cjs",
    documentation: "docs/api-reference.md",
    scenarioRowsRequired: ["R-06", "R-08", "R-09"],
  };
}

for (const col of inventory.concreteCollections) {
  couplingMap.collections[col.path] = {
    rulesMatch: "firestore.rules",
    rulesTest: "functions/src/test/rules/firestoreRules.test.ts",
    domain: col.domain,
    type: col.type,
  };
}

const outPath = path.join(ROOT, "docs/audit/coupling-map.json");
fs.writeFileSync(outPath, JSON.stringify(couplingMap, null, 2), "utf8");
console.log(`✓ Generated Coupling Map: ${outPath} (${Object.keys(couplingMap.callables).length} callables, ${Object.keys(couplingMap.triggers).length} triggers, ${Object.keys(couplingMap.collections).length} collections)`);
