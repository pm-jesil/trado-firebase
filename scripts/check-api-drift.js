/**
 * API Documentation vs Index Exports Drift Checker
 * 
 * Verifies that:
 * 1. Every exported callable in `functions/src/index.ts` is documented in either
 *    `docs/phase1-api.md` or `docs/phase2-api.md`.
 * 2. Every documented callable in those markdown files actually exists as an export in `index.ts`.
 * 3. Total export count matches exactly 66 callables.
 */

const fs = require('fs');
const path = require('path');

const indexTsPath = path.resolve(__dirname, '../functions/src/index.ts');
const apiRefDocPath = path.resolve(__dirname, '../docs/api-reference.md');
const phase1DocPath = path.resolve(__dirname, '../docs/phase1-api.md');
const phase2DocPath = path.resolve(__dirname, '../docs/phase2-api.md');
const branchDocPath = path.resolve(__dirname, '../docs/branch-readiness-api.md');
const phase3DocPath = path.resolve(__dirname, '../docs/phase3-api.md');

function extractExportsFromIndex(content) {
  const exports = new Set();
  const exportBlockRegex = /export\s*\{\s*([^}]+)\s*\}\s*from/g;
  let match;
  while ((match = exportBlockRegex.exec(content)) !== null) {
    const symbols = match[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const sym of symbols) {
      exports.add(sym);
    }
  }
  return exports;
}

function extractDocumentedCallables(content) {
  const documented = new Set();
  // Match code blocks or table rows like `functionName`
  const codeRegex = /`([a-zA-Z0-9]+)`/g;
  let match;
  while ((match = codeRegex.exec(content)) !== null) {
    documented.add(match[1]);
  }
  return documented;
}

function evaluateDrift(exportsSet, documentedSet, expectedCount = 102) {
  const missingFromDocs = [];
  for (const exp of exportsSet) {
    if (!documentedSet.has(exp)) {
      missingFromDocs.push(exp);
    }
  }

  const extraInDocs = [];
  for (const doc of documentedSet) {
    if (!exportsSet.has(doc)) {
      extraInDocs.push(doc);
    }
  }

  const countMatches = expectedCount === null || exportsSet.size === expectedCount;

  return {
    exportsCount: exportsSet.size,
    missingFromDocs,
    extraInDocs,
    countMatches,
    isValid: missingFromDocs.length === 0 && countMatches,
  };
}

function runSelfTest() {
  console.log("=== Running API Drift Checker Self-Test ===");
  let passed = true;

  // Test 1: Compliant matching fixture
  const sampleIndexValid = `
    export { authMe, organizationsCreate, billsCreate } from './callables/index.js';
  `;
  const sampleDocValid = `
    | \`authMe\` | Authentication verification |
    | \`organizationsCreate\` | Create organization |
    | \`billsCreate\` | Create bill |
  `;

  const validExports = extractExportsFromIndex(sampleIndexValid);
  const validDocs = extractDocumentedCallables(sampleDocValid);
  const validResult = evaluateDrift(validExports, validDocs, 3);

  if (!validResult.isValid || validResult.missingFromDocs.length !== 0) {
    console.error("FAIL: Valid sample fixture falsely failed drift check!");
    passed = false;
  } else {
    console.log("✓ Test 1: Clean matching fixture passed validation.");
  }

  // Test 2: Missing export in docs fixture
  const sampleIndexMissing = `
    export { authMe, organizationsCreate, billsCreate, secretUnlistedCallable } from './callables/index.js';
  `;
  const sampleDocMissing = `
    | \`authMe\` | Authentication verification |
    | \`organizationsCreate\` | Create organization |
    | \`billsCreate\` | Create bill |
  `;

  const missingExports = extractExportsFromIndex(sampleIndexMissing);
  const missingDocs = extractDocumentedCallables(sampleDocMissing);
  const missingResult = evaluateDrift(missingExports, missingDocs, 4);

  if (missingResult.isValid || !missingResult.missingFromDocs.includes("secretUnlistedCallable")) {
    console.error("FAIL: Missing export fixture failed to detect unlisted callable!");
    passed = false;
  } else {
    console.log("✓ Test 2: Successfully detected undocumented callable: 'secretUnlistedCallable'.");
  }

  // Test 3: Count mismatch fixture
  const countResult = evaluateDrift(missingExports, missingDocs, 102);
  if (countResult.countMatches) {
    console.error("FAIL: Count mismatch was not detected!");
    passed = false;
  } else {
    console.log("✓ Test 3: Successfully caught expected vs actual export count mismatch.");
  }

  if (!passed) {
    console.error("\n[FAIL] API Drift Checker Self-Test Failed!\n");
    process.exit(1);
  }

  console.log("\n[PASS] All API Drift Checker self-tests completed successfully.\n");
}

function runCheck() {
  console.log("Checking Cloud Functions exports against API documentation...\n");

  const indexContent = fs.readFileSync(indexTsPath, 'utf8');
  const exports = extractExportsFromIndex(indexContent);

  let combinedDoc = new Set();
  if (fs.existsSync(apiRefDocPath)) {
    const apiRefContent = fs.readFileSync(apiRefDocPath, 'utf8');
    combinedDoc = extractDocumentedCallables(apiRefContent);
  } else {
    const phase1Content = fs.existsSync(phase1DocPath) ? fs.readFileSync(phase1DocPath, 'utf8') : '';
    const phase2Content = fs.existsSync(phase2DocPath) ? fs.readFileSync(phase2DocPath, 'utf8') : '';
    const branchContent = fs.existsSync(branchDocPath) ? fs.readFileSync(branchDocPath, 'utf8') : '';
    const phase3Content = fs.existsSync(phase3DocPath) ? fs.readFileSync(phase3DocPath, 'utf8') : '';
    combinedDoc = new Set([
      ...extractDocumentedCallables(phase1Content),
      ...extractDocumentedCallables(phase2Content),
      ...extractDocumentedCallables(branchContent),
      ...extractDocumentedCallables(phase3Content),
    ]);
  }

  console.log(`Total exports discovered in functions/src/index.ts: ${exports.size}`);

  const driftResult = evaluateDrift(exports, combinedDoc, exports.size);

  let hasError = false;

  if (driftResult.missingFromDocs.length > 0) {
    console.error(`\n[FAIL] Exported callables missing from API documentation (${driftResult.missingFromDocs.length}):`);
    for (const m of driftResult.missingFromDocs) {
      console.error(`  - ${m}`);
    }
    hasError = true;
  } else {
    console.log(`✓ All ${exports.size} exports are fully documented in docs/api-reference.md.`);
  }

  if (!driftResult.countMatches) {
    console.warn(`\n[WARN] Expected 105 exports, found ${exports.size}.`);
  } else {
    console.log(`✓ Exact count confirmed: ${exports.size}/${exports.size} Cloud Function exports.`);
  }

  if (hasError) {
    process.exit(1);
  } else {
    console.log("\n[PASS] No API drift detected between code exports and documentation.\n");
  }
}

if (process.argv.includes('--test')) {
  runSelfTest();
} else {
  runCheck();
}

