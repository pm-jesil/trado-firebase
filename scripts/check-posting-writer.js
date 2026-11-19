/**
 * Trado Firebase Backend — Static Guard: Posting Writer Constraint
 *
 * Verifies that writes to the append-only `accountTransactions` ledger collection
 * are strictly confined to the centralized posting service / ledger service.
 * Enforces R4 (immutable financial ledger) and D-F1 (single posting writer).
 */

const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_WRITERS = new Set([
  path.normalize("functions/src/services/postingService.ts"),
  path.normalize("functions/src/services/ledgerService.ts"),
]);

const SRC_DIR = path.resolve(__dirname, "..", "functions", "src");

function findSourceFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".local") {
        files = files.concat(findSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkContent(relPath, content) {
  if (ALLOWED_WRITERS.has(path.normalize(relPath))) {
    return [];
  }
  const violations = [];

  // Check 1: Direct chaining e.g. collection("accountTransactions").add(...) or .doc(...).set(...)
  const directWrite = /collection\(\s*["']accountTransactions["']\s*\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.(set|add|update|delete)\(/;
  if (directWrite.test(content)) {
    violations.push(`Direct write in ${relPath}`);
  }

  // Check 2: Variable assignment from collection("accountTransactions").doc(...) then written via txn.set/update/delete
  const docRefRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:[a-zA-Z0-9_$]+\.)*collection\(\s*["']accountTransactions["']\s*\)\.doc\(/g;
  let match;
  while ((match = docRefRegex.exec(content)) !== null) {
    const varName = match[1];
    const writeRegex = new RegExp(`\\.(set|update|delete)\\(\\s*${varName}\\s*,`);
    if (writeRegex.test(content)) {
      violations.push(`Indirect write via ${varName} in ${relPath}`);
    }
  }

  return violations;
}

if (process.argv.includes("--test")) {
  // Self-test mode (seeded defect verification per D-34)
  const fakeBad = 'const txnRef = db.collection("accountTransactions").doc(); txn.set(txnRef, {});';
  const v1 = checkContent("functions/src/callables/rogueWriter.ts", fakeBad);
  if (v1.length === 0) {
    console.error("[SELF-TEST FAILED] Guard failed to detect rogue accountTransactions writer.");
    process.exit(1);
  }
  const fakeGood = 'const query = db.collection("accountTransactions").where("organizationId", "==", orgId);';
  const v2 = checkContent("functions/src/callables/safeReader.ts", fakeGood);
  if (v2.length > 0) {
    console.error("[SELF-TEST FAILED] Guard falsely flagged read-only query.");
    process.exit(1);
  }
  console.log("[PASS] check-posting-writer --test self-test passed.");
  process.exit(0);
}

let totalViolations = 0;
const allFiles = findSourceFiles(SRC_DIR);

for (const file of allFiles) {
  const relPath = path.normalize(path.relative(path.resolve(__dirname, ".."), file));
  const content = fs.readFileSync(file, "utf8");
  const issues = checkContent(relPath, content);
  for (const issue of issues) {
    console.error(`[POSTING_WRITER_VIOLATION] ${issue}`);
    totalViolations++;
  }
}

if (totalViolations > 0) {
  console.error(`Posting writer check failed: ${totalViolations} unauthorized writer(s) found.`);
  process.exit(1);
} else {
  console.log(`[PASS] Posting writer guard: accountTransactions writes strictly confined to [${[...ALLOWED_WRITERS].join(", ")}].`);
}
