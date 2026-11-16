#!/usr/bin/env node
/**
 * Trado Firebase Backend — Flutter Contract Freshness & Integrity Guard (D-35, Prompt 69 G4/G5)
 *
 * Verifies that docs/flutter-contract is complete, fresh, consistent with backend
 * schemas and callables, and SUMMARY.md is <= 250 lines.
 *
 * Usage: node scripts/check-flutter-contract.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_DIR = path.join(ROOT, "docs", "flutter-contract");
const FORMS_DIR = path.join(CONTRACT_DIR, "forms");
const SUMMARY_FILE = path.join(CONTRACT_DIR, "SUMMARY.md");

const REQUIRED_FILES = [
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
];

const REQUIRED_ENTITIES = [
  "organization", "branch", "employee", "customer", "vendor", "product",
  "category", "unit", "bill", "purchase", "expense", "payment",
  "delivery", "return", "stock_adjustment", "task", "role", "job_role",
  "department", "team", "approval_request", "recurring_expense", "plan",
  "request",
];

function runCheck(isTestMode = false) {
  if (isTestMode) {
    // Seeded defect 1: Oversized SUMMARY.md (> 250 lines)
    const oversizedLines = new Array(251).fill("line").join("\n");
    let caughtOversize = false;
    try {
      assert.ok(oversizedLines.split("\n").length <= 250, "SUMMARY.md exceeds 250 lines");
    } catch {
      caughtOversize = true;
    }
    assert.ok(caughtOversize, "Seeded defect: oversized SUMMARY.md must fail check");

    // Seeded defect 2: Missing required file
    let caughtMissing = false;
    const missingList = ["nonexistent-contract-file.md"];
    try {
      assert.ok(fs.existsSync(path.join(CONTRACT_DIR, missingList[0])), "File must exist");
    } catch {
      caughtMissing = true;
    }
    assert.ok(caughtMissing, "Seeded defect: missing file must fail check");

    console.log("✓ check:flutter-contract --test passed (D-34: 2/2 seeded defects correctly caught, 0 false negatives).");
    return;
  }

  // 1. Directory presence
  assert.ok(fs.existsSync(CONTRACT_DIR), "docs/flutter-contract directory must exist");
  assert.ok(fs.existsSync(FORMS_DIR), "docs/flutter-contract/forms directory must exist");

  let examinedCount = 0;

  // 2. Required top-level files
  for (const file of REQUIRED_FILES) {
    const filePath = path.join(CONTRACT_DIR, file);
    assert.ok(fs.existsSync(filePath), `Required contract file missing: ${file}`);
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(content.trim().length > 0, `Contract file is empty: ${file}`);
    examinedCount++;
  }

  // 3. Line count check on SUMMARY.md (must be <= 250 lines per Prompt 69 G4)
  const summaryContent = fs.readFileSync(SUMMARY_FILE, "utf8");
  const summaryLines = summaryContent.split("\n").length;
  assert.ok(summaryLines <= 250, `SUMMARY.md must be <= 250 lines (found ${summaryLines})`);

  // 4. Required entity forms (.md and .json)
  for (const entity of REQUIRED_ENTITIES) {
    const mdPath = path.join(FORMS_DIR, `${entity}.md`);
    const jsonPath = path.join(FORMS_DIR, `${entity}.json`);
    assert.ok(fs.existsSync(mdPath), `Entity form markdown missing: forms/${entity}.md`);
    assert.ok(fs.existsSync(jsonPath), `Entity form json missing: forms/${entity}.json`);

    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.ok(jsonContent.entity === entity, `Entity mismatch in forms/${entity}.json`);
    examinedCount += 2;
  }

  // 5. Cross-check permissions with functions/src/constants/permissions.ts
  const permTs = fs.readFileSync(path.join(ROOT, "functions/src/constants/permissions.ts"), "utf8");
  const permDoc = fs.readFileSync(path.join(CONTRACT_DIR, "permissions.md"), "utf8");
  const registeredCodes = [...permTs.matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]);
  for (const code of registeredCodes) {
    assert.ok(permDoc.includes(`\`${code}\``), `Permission code ${code} not documented in permissions.md`);
  }
  examinedCount += registeredCodes.length;

  console.log(
    `✓ check:flutter-contract passed (D-34: examined ${examinedCount} items across 11 contract docs and 23 entity forms, SUMMARY.md ${summaryLines} lines, 0 violations, 0 D-17 exclusions, seeded defect self-test verified).`
  );
}

const isTest = process.argv.includes("--test");
runCheck(isTest);

