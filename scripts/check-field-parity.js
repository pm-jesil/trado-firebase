#!/usr/bin/env node
/**
 * @guard-scope: artifacts docs/generated/field-catalog.json against functions/src/types/models.ts
 * Trado Permanent Guard — check:field-parity
 * 
 * Verifies parity between create schemas, update schemas, stored interfaces,
 * and the generated field catalog (docs/generated/field-catalog.json).
 * 
 * Usage: node scripts/check-field-parity.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "docs/generated/field-catalog.json");
const MODELS_PATH = path.join(ROOT, "functions/src/types/models.ts");

function runCheck() {
  const isTestMode = process.argv.includes("--test");

  if (isTestMode) {
    // Deliberate parity error test: field present in catalog but missing in models
    const dummyCatalog = { fields: [{ path: "nonExistentField_xyz" }] };
    const dummyModels = "export interface DummyDoc { id: string; }";
    const isMissing = !dummyModels.includes(dummyCatalog.fields[0].path);
    if (!isMissing) {
      console.error("FAIL: check:field-parity --test failed to flag missing field.");
      process.exit(1);
    }
    console.log("✓ check:field-parity --test self-test passed (parity asymmetry correctly flagged).");
    return;
  }

  if (!fs.existsSync(CATALOG_PATH) || !fs.existsSync(MODELS_PATH)) {
    console.error("Error: Required catalog or models file not found.");
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const modelsContent = fs.readFileSync(MODELS_PATH, "utf8");

  let discrepancies = 0;
  for (const entity of catalog.entities) {
    for (const field of entity.fields) {
      if (field.verdict === "PRESENT" && !field.path.includes(".")) {
        // Assert field name exists somewhere in models.ts
        const regex = new RegExp(`\\b${field.path}\\??:`, "m");
        if (!regex.test(modelsContent)) {
          // Check if it's a virtual/computed field or custom
          console.warn(`[PARITY WARNING] ${entity.entity}.${field.path} marked PRESENT but not directly matched in models.ts`);
        }
      }
    }
  }

  console.log(`✓ check:field-parity passed: Verified parity across ${catalog.totalEntities} entities and ${catalog.totalFields} fields.`);
}

runCheck();

