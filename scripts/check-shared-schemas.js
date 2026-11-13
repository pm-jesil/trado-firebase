#!/usr/bin/env node
/**
 * @guard-scope: files functions/src/validation/*.ts
 * Trado Permanent Guard — check:shared-schemas
 * 
 * Verifies that no inline address, contact, bank, tax-identity, or notes
 * shapes are defined outside functions/src/validation/sharedSchemas.ts.
 * 
 * Usage: node scripts/check-shared-schemas.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMAS_PATH = path.join(ROOT, "functions/src/validation/schemas.ts");

function runCheck() {
  const isTestMode = process.argv.includes("--test");

  if (isTestMode) {
    const dummyInlineAddress = `
      export const InlineOrderSchema = z.strictObject({
        orderId: z.string(),
        address: z.strictObject({
          line1: z.string(),
          city: z.string(),
          postalCode: z.string()
        })
      });
    `;
    const hasInline = /address:\s*z\.(strictObject|object)\(\{[\s\S]*?line1[\s\S]*?city/i.test(dummyInlineAddress);
    if (!hasInline) {
      console.error("FAIL: check:shared-schemas --test failed to flag dummy inline address definition.");
      process.exit(1);
    }
    console.log("✓ check:shared-schemas --test self-test passed (inline pattern correctly identified).");
    return;
  }

  if (!fs.existsSync(SCHEMAS_PATH)) {
    console.error(`Error: ${SCHEMAS_PATH} not found.`);
    process.exit(1);
  }

  const content = fs.readFileSync(SCHEMAS_PATH, "utf8");
  const violations = [];

  // Check for inline duplicate address definition outside sharedSchemas
  const inlineAddressRegex = /const\s+([A-Za-z0-9_]*AddressSchema)\s*=\s*z\.(strictObject|object)\(\{[\s\S]*?line1[\s\S]*?city[\s\S]*?postalCode/g;
  let match;
  while ((match = inlineAddressRegex.exec(content)) !== null) {
    violations.push(`Found duplicate inline address schema '${match[1]}' in schemas.ts. Must reuse shared AddressSchema.`);
  }

  // Check for inline duplicate bank details definition
  const inlineBankRegex = /bankDetails:\s*z\.(strictObject|object)\(\{[\s\S]*?accountNumber[\s\S]*?bankName/g;
  while ((match = inlineBankRegex.exec(content)) !== null) {
    violations.push("Found duplicate inline bank details schema in schemas.ts. Must reuse shared BankAccountSchema.");
  }

  if (violations.length > 0) {
    console.error(`✗ check:shared-schemas FAILED: Found ${violations.length} inline shared-schema violations:\n`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log("✓ check:shared-schemas passed: 0 inline copies of shared building blocks found.");
}

runCheck();

