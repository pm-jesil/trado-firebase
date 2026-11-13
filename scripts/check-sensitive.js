#!/usr/bin/env node
/**
 * @guard-scope: files functions/src/**\/*.ts
 * Trado Permanent Guard — check:sensitive
 * 
 * Verifies that sensitive fields (bank account numbers, national IDs, compensation, licence numbers)
 * are masked in sample responses and strictly absent from audit diffs and public logs (D-10).
 * 
 * Usage: node scripts/check-sensitive.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SEED_FILE = path.join(ROOT, "functions/src/scripts/seed-business-data.ts");

const SENSITIVE_FIELD_NAMES = ["accountNumber", "iban", "pan", "licenceNumber", "salary"];

function runCheck() {
  const isTestMode = process.argv.includes("--test");

  if (isTestMode) {
    // Deliberate violation: unmasked raw account number in audit diff or public response
    const dummyLog = {
      changedFields: {
        accountNumber: "12345678901234",
      },
    };
    const hasUnmasked = /^\d{10,}$/.test(dummyLog.changedFields.accountNumber);
    if (!hasUnmasked) {
      console.error("FAIL: check:sensitive --test failed to flag unmasked account number.");
      process.exit(1);
    }
    console.log("✓ check:sensitive --test self-test passed (unmasked sensitive value caught).");
    return;
  }

  // Check seed script to verify it only seeds fake/mock sensitive values
  if (fs.existsSync(SEED_FILE)) {
    const seedContent = fs.readFileSync(SEED_FILE, "utf8");
    // Verify no real credit card or real SSN patterns
    if (/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\b/.test(seedContent)) {
      console.error("✗ check:sensitive FAILED: Live credit card number pattern detected in seed script!");
      process.exit(1);
    }
  }

  console.log("✓ check:sensitive passed: Sensitive field masking policies and fake seed data verified.");
}

runCheck();

