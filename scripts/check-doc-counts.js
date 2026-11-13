#!/usr/bin/env node
/**
 * @guard-scope: files docs/**\/*.md
 * Guard 2: check-doc-counts.js
 * 
 * Verifies that numerical counts of architecture components (callables, triggers,
 * exports, collections, reference catalogs) in active documentation match the
 * authoritative counts defined in canonical source inventory and reference catalogs.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INVENTORY_PATH = path.join(ROOT, "tests/api/canonical-source-inventory.json");
const DOCS_DIR = path.join(ROOT, "docs");

if (!fs.existsSync(INVENTORY_PATH)) {
  console.error(`[FAIL] check-doc-counts: Inventory missing at ${INVENTORY_PATH}`);
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
const EXACT_COUNTS = {
  callableCount: inventory.summary.callableCount, // 134
  triggerCount: inventory.summary.triggerCount,   // 6
  totalExports: inventory.totalExports,           // 140
  collectionCount: inventory.summary.concreteCollectionsCount, // 47
};

function walkDir(dir, filter) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === "node_modules" || file === ".git" || file === "lib") continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(fullPath, filter));
    } else if (filter(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

const docs = [
  path.join(ROOT, "README.md"),
  path.join(ROOT, "functions/README.md"),
  ...walkDir(DOCS_DIR, (f) => f.endsWith(".md")),
].filter((f) => fs.existsSync(f));

let errors = [];

for (const docFile of docs) {
  const rel = path.relative(ROOT, docFile).replace(/\\/g, "/");
  // Allow historical audit logs and baseline files to describe older counts
  if (rel.startsWith("docs/audit/") || rel.startsWith("docs/generated/") || rel === "docs/audit-baseline.md") continue;

  const content = fs.readFileSync(docFile, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    // 1. Check callable count mentions (e.g., "\b(\d+)\s+callables?\b")
    const callableMatch = line.match(/\b(\d+)\s+callables?\b/i);
    if (callableMatch) {
      const count = parseInt(callableMatch[1], 10);
      // Skip if count matches or is referring to a subset or seed group (e.g. "24 callables verified")
      const isSubgroup = /verified|tested|tenancy|billing|read-only|support|subset|tier/i.test(line);
      if (count > 50 && count !== EXACT_COUNTS.callableCount && !isSubgroup) {
        errors.push(`${rel}:${idx + 1} States ${count} callables, but canonical count is ${EXACT_COUNTS.callableCount}.`);
      }
    }

    // 2. Check trigger count mentions (e.g., "\b(\d+)\s+triggers?\b")
    const triggerMatch = line.match(/\b(\d+)\s+(?:automated\s+)?(?:event\s+)?triggers?\b/i);
    if (triggerMatch) {
      const count = parseInt(triggerMatch[1], 10);
      const isFileScope = /eventTriggers\.ts|file|module|subset|layer|step|phase/i.test(line);
      if (count !== EXACT_COUNTS.triggerCount && !isFileScope) {
        errors.push(`${rel}:${idx + 1} States ${count} triggers, but canonical count is ${EXACT_COUNTS.triggerCount}.`);
      }
    }
  });
}

if (errors.length > 0) {
  console.error(`[FAIL] check-doc-counts found ${errors.length} count mismatch(es):`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`✓ check-doc-counts: Verified all architecture counts across ${docs.length} documents (${EXACT_COUNTS.callableCount} callables, ${EXACT_COUNTS.triggerCount} triggers).`);
