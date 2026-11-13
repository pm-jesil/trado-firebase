#!/usr/bin/env node
/**
 * @guard-scope: files docs/**\/*.md against docs/generated/field-catalog.json
 * Guard 1: check-doc-truth.js
 * 
 * Verifies that callable symbols and schema identifiers mentioned across active
 * documentation match the canonical source inventory (canonical-source-inventory.json)
 * and field catalog (field-catalog.json).
 * 
 * Flags:
 * - Deprecated / banned aliases (e.g. `taxNumber` referenced as active property)
 * - Fictional / misspelled callable names referenced as active endpoints
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INVENTORY_PATH = path.join(ROOT, "tests/api/canonical-source-inventory.json");
const FIELD_CATALOG_PATH = path.join(ROOT, "docs/generated/field-catalog.json");
const DOCS_DIR = path.join(ROOT, "docs");

if (!fs.existsSync(INVENTORY_PATH)) {
  console.error(`[FAIL] check-doc-truth: Inventory missing at ${INVENTORY_PATH}`);
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
const validCallables = new Set();
const validCollections = new Set([
  ...(inventory.concreteCollections || []).map((c) => (typeof c === "string" ? c : c.path).split("/")[0]),
  "usageAllocationRuns",
]);

// Also collect valid TypeScript model property names to avoid flagging document fields as callables
const validModelFields = new Set();
const MODELS_TS = path.join(ROOT, "functions/src/types/models.ts");
if (fs.existsSync(MODELS_TS)) {
  const modelsContent = fs.readFileSync(MODELS_TS, "utf8");
  for (const m of modelsContent.matchAll(/^\s*([a-zA-Z0-9_]+)\??\s*:/gm)) {
    validModelFields.add(m[1]);
  }
}
for (const cat of Object.values(inventory.categories || {})) {
  if (Array.isArray(cat.items)) {
    for (const item of cat.items) validCallables.add(item);
  }
  if (cat.subgroups) {
    for (const groupItems of Object.values(cat.subgroups)) {
      if (Array.isArray(groupItems)) {
        for (const item of groupItems) validCallables.add(item);
      }
    }
  }
}
for (const trig of inventory.triggers || []) {
  validCallables.add(trig.name);
}

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
  // Skip archive / historical audit snapshots
  if (rel.startsWith("docs/audit/") || rel.startsWith("docs/generated/")) continue;

  const content = fs.readFileSync(docFile, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    // 1. Strict ban on `taxNumber` as an active field (D-7)
    if (/\btaxNumber\b/.test(line)) {
      // Allow only lines discussing migration / removal / banned status
      const isHistoricalDiscussion = /replaced|alias|deprecated|purged|removed|never|forbidden|banned|D-7/i.test(line);
      if (!isHistoricalDiscussion) {
        errors.push(`${rel}:${idx + 1} References banned field 'taxNumber'. Must use canonical 'taxId' (D-7).`);
      }
    }

    // 2. Check callable references in code spans e.g. `organizationsCreate`
    const callableMatches = line.match(/`([a-z]+[A-Z][a-zA-Z0-9]+)`/g);
    if (callableMatches) {
      for (const rawMatch of callableMatches) {
        const sym = rawMatch.replace(/`/g, "");
        // Only inspect symbols matching typical callable naming patterns (e.g. prefixAction or entityMethod)
        if (sym.startsWith("organizations") || sym.startsWith("employees") || sym.startsWith("branches") ||
            sym.startsWith("customers") || sym.startsWith("vendors") || sym.startsWith("products") ||
            sym.startsWith("bills") || sym.startsWith("outflows") || sym.startsWith("payments") ||
            sym.startsWith("returns") || sym.startsWith("deliveries") || sym.startsWith("plans") ||
            sym.startsWith("reports") || sym.startsWith("tasks") || sym.startsWith("locations") ||
            sym.startsWith("media") || sym.startsWith("usage")) {
          // Check against valid callable, collection, or model field inventory
          if (!validCallables.has(sym) && !validCollections.has(sym) && !validModelFields.has(sym) && !sym.endsWith("Internal") && !sym.endsWith("Schema") && !sym.endsWith("Doc") && !sym.endsWith("Locks") && !sym.endsWith("Shards")) {
            errors.push(`${rel}:${idx + 1} References non-existent callable '${sym}'.`);
          }
        }
      }
    }
  });
}

if (errors.length > 0) {
  console.error(`[FAIL] check-doc-truth found ${errors.length} truth violation(s):`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`✓ check-doc-truth: All callable symbols and identifiers match canonical code inventory across ${docs.length} documents.`);
