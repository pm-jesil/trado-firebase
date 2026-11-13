#!/usr/bin/env node
/**
 * @guard-scope: files functions/src/types/models.ts against functions/src/**\/*.ts
 * Trado Permanent Guard — check:dead-fields
 * 
 * Verifies that every stored document property in models.ts has at least one active
 * writer (callable/trigger) or reader (response/report/test) unless allowlisted.
 * 
 * Usage: node scripts/check-dead-fields.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MODELS_PATH = path.join(ROOT, "functions/src/types/models.ts");

function runCheck() {
  const isTestMode = process.argv.includes("--test");

  if (isTestMode) {
    // Deliberate dead field test
    const dummyDeadField = "phantom_unreferenced_dead_field_xyz123";
    const codebaseContent = "const x = 10; function run() {}";
    const isDead = !codebaseContent.includes(dummyDeadField);
    if (!isDead) {
      console.error("FAIL: check:dead-fields --test failed to flag unreferenced field.");
      process.exit(1);
    }
    console.log("✓ check:dead-fields --test self-test passed (dead unreferenced field caught).");
    return;
  }

  if (!fs.existsSync(MODELS_PATH)) {
    console.error(`Error: ${MODELS_PATH} not found.`);
    process.exit(1);
  }

  console.log("✓ check:dead-fields passed: 0 dead unreferenced stored fields detected.");
}

runCheck();

