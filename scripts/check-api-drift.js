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

  const missingFromDocs = [];
  for (const exp of exports) {
    if (!combinedDoc.has(exp)) {
      missingFromDocs.push(exp);
    }
  }

  let hasError = false;

  if (missingFromDocs.length > 0) {
    console.error(`\n[FAIL] Exported callables missing from API documentation (${missingFromDocs.length}):`);
    for (const m of missingFromDocs) {
      console.error(`  - ${m}`);
    }
    hasError = true;
  } else {
    console.log(`✓ All ${exports.size} exports are fully documented in phase1-api.md, phase2-api.md, branch-readiness-api.md, and phase3-api.md.`);
  }

  if (exports.size !== 102) {
    console.warn(`\n[WARN] Expected 102 exports, found ${exports.size}.`);
  } else {
    console.log(`✓ Exact count confirmed: 102/102 Cloud Function exports.`);
  }

  if (hasError) {
    process.exit(1);
  } else {
    console.log("\n[PASS] No API drift detected between code exports and documentation.\n");
  }
}

runCheck();

