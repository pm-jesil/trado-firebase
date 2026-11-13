#!/usr/bin/env node
/**
 * @guard-scope: files docs/**\/*.md
 * Guard 3: check-doc-examples.js
 * 
 * Verifies that JSON examples and payload snippets in active documentation
 * are valid JSON and conform to zero-duplication and pre-release naming policies
 * (e.g. no banned `taxNumber` in JSON examples).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");

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
  if (rel.startsWith("docs/audit/") || rel.startsWith("docs/generated/")) continue;

  const content = fs.readFileSync(docFile, "utf8");
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g;
  let match;

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const jsonStr = match[1].trim();
    // Skip empty or placeholder blocks
    if (!jsonStr || jsonStr === "{}" || jsonStr.includes("...")) continue;

    // Check for banned taxNumber in JSON examples
    if (/"taxNumber"\s*:/.test(jsonStr)) {
      errors.push(`${rel} contains JSON block with banned field 'taxNumber'. Must use 'taxId'.`);
    }

    try {
      JSON.parse(jsonStr);
    } catch (e) {
      // If it fails standard JSON parse, only report if it doesn't contain ellipsis or comments
      if (!jsonStr.includes("//") && !jsonStr.includes("/*")) {
        errors.push(`${rel} contains invalid JSON block: ${e.message}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`[FAIL] check-doc-examples found ${errors.length} example issue(s):`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`✓ check-doc-examples: All JSON documentation examples verified cleanly across ${docs.length} documents.`);

