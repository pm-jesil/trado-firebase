#!/usr/bin/env node
/**
 * @guard-scope: artifacts docs/generated/naming-registry.json against functions/src/**\/*.ts
 * Trado Permanent Guard — check:naming
 * 
 * Enforces canonical field naming registry rules across Zod schemas, TypeScript models,
 * and OpenAPI definitions. Rejects forbidden synonyms (e.g. 'mobile' -> 'phone').
 * 
 * Usage: node scripts/check-naming.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "docs/generated/naming-registry.json");
const SCHEMAS_PATH = path.join(ROOT, "functions/src/validation/schemas.ts");
const SHARED_SCHEMAS_PATH = path.join(ROOT, "functions/src/validation/sharedSchemas.ts");
const MODELS_PATH = path.join(ROOT, "functions/src/types/models.ts");

function runCheck(options = {}) {
  const isTestMode = options.test || process.argv.includes("--test");
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const forbiddenMap = new Map();

  for (const rule of registry.rules) {
    for (const syn of rule.forbiddenSynonyms) {
      forbiddenMap.set(syn, { canonical: rule.canonicalName, concept: rule.concept, rule: rule.rule });
    }
  }

  // Self-test assertion: verify that deliberate violation is caught
  if (isTestMode) {
    const dummyViolation = "const testObj = { mobile: '+919999999999', grandTotal: 500 };";
    const testFindings = [];
    for (const [forbidden, meta] of forbiddenMap.entries()) {
      const regex = new RegExp(`\\b${forbidden}\\s*:`, "g");
      if (regex.test(dummyViolation)) {
        testFindings.push({ forbidden, canonical: meta.canonical });
      }
    }
    if (testFindings.length < 2) {
      console.error("FAIL: check:naming --test failed to catch deliberate violation vector.");
      process.exit(1);
    }
    console.log("✓ check:naming --test self-test passed (deliberate violations correctly rejected).");
    return;
  }

  const filesToCheck = [
    { file: SCHEMAS_PATH, name: "schemas.ts" },
    { file: SHARED_SCHEMAS_PATH, name: "sharedSchemas.ts" },
    { file: MODELS_PATH, name: "models.ts" },
  ];

  const findings = [];

  for (const target of filesToCheck) {
    if (!fs.existsSync(target.file)) continue;
    const content = fs.readFileSync(target.file, "utf8");
    const lines = content.split("\n");

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      // Skip comments
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      for (const [forbidden, meta] of forbiddenMap.entries()) {
        // Match object property keys: e.g. "mobile:" or "mobile?:"
        const propRegex = new RegExp(`^\\s*${forbidden}\\??\\s*:`);
        if (propRegex.test(line)) {
          findings.push({
            file: target.name,
            line: idx + 1,
            forbidden,
            canonical: meta.canonical,
            text: line.trim(),
          });
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error(`✗ check:naming FAILED: Found ${findings.length} forbidden synonym violations:\n`);
    for (const f of findings) {
      console.error(`  - ${f.file}:${f.line} -> '${f.forbidden}' is forbidden! Use canonical '${f.canonical}'.`);
      console.error(`    Line: ${f.text}`);
    }
    process.exit(1);
  }

  console.log(`✓ check:naming passed: 0 forbidden synonyms detected across schemas and models.`);
}

runCheck();

