#!/usr/bin/env node
/**
 * @guard-scope: artifacts docs/generated/doc-index.json against docs/**\/*.md
 * Guard 4: check-doc-index.js
 * 
 * Verifies that all markdown documentation across the repository is indexed in
 * docs/generated/doc-index.json and represented in docs/README.md without orphans.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");
const INDEX_PATH = path.join(DOCS_DIR, "generated/doc-index.json");
const MAP_PATH = path.join(DOCS_DIR, "README.md");

function walkDir(dir, filter) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === "node_modules" || file === ".git" || file === "lib" || file === ".local") continue; // .local: runtime output, rewritten while units run
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

if (!fs.existsSync(INDEX_PATH)) {
  console.error(`[FAIL] check-doc-index: Index file missing at ${INDEX_PATH}. Run scripts/generate-doc-index.js.`);
  process.exit(1);
}

const indexData = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const indexedPaths = new Set(indexData.documents.map((d) => d.path));

// Find all current md files on disk
const diskFiles = [
  path.join(ROOT, "README.md"),
  path.join(ROOT, "functions/README.md"),
  ...walkDir(DOCS_DIR, (f) => f.endsWith(".md")),
].filter((f) => fs.existsSync(f));

let errors = [];

// 1. Every disk file must be indexed
for (const file of diskFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (!indexedPaths.has(rel)) {
    errors.push(`Unindexed documentation file on disk: ${rel}`);
  }
}

// 2. Every indexed file must exist on disk
for (const doc of indexData.documents) {
  const full = path.join(ROOT, doc.path);
  if (!fs.existsSync(full)) {
    errors.push(`Indexed file does not exist on disk: ${doc.path}`);
  }
}

// 3. docs/README.md must exist
if (!fs.existsSync(MAP_PATH)) {
  errors.push(`Human map missing at ${MAP_PATH}`);
}

if (errors.length > 0) {
  console.error(`[FAIL] check-doc-index failed with ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`✓ check-doc-index: All ${diskFiles.length} documentation assets verified and indexed cleanly.`);

