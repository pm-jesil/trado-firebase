#!/usr/bin/env node
/**
 * @guard-scope: files docs/**\/*.md
 * Guard 5: check-doc-banned-words.js
 * 
 * Verifies that documentation does not make unsubstantiated claims such as
 * "production ready", "production-ready", or "100% complete".
 * Enforces truthful status reporting: "emulator-verified" with open items.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");

const BANNED_PATTERNS = [
  { pattern: /\bproduction[- ]ready\b/i, name: "production ready / production-ready" },
  { pattern: /\b100%\s+complete\b/i, name: "100% complete" },
  { pattern: /\bfully\s+production\s+hardened\b/i, name: "fully production hardened" },
];

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

const filesToCheck = [
  path.join(ROOT, "README.md"),
  path.join(ROOT, "functions/README.md"),
  ...walkDir(DOCS_DIR, (f) => f.endsWith(".md")),
].filter((f) => fs.existsSync(f));

let violations = [];
const auditExempt = [];
const coveragePath = path.join(ROOT, "docs", "audit", "coverage.json");
const coverage = fs.existsSync(coveragePath) ? JSON.parse(fs.readFileSync(coveragePath, "utf8")) : null;

for (const file of filesToCheck) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");

  // D-20 (prompt 65 §2.3): in docs/audit/**, a completeness word needs a [cov:C-n] reference that is n/n in
  // the current docs/audit/coverage.json. Generated files ("do not edit") are the computation itself and
  // archived reports (a "> Status: archived" line) are historical records; both are exempt and counted.
  if (rel.startsWith("docs/audit/")) {
    if (/do not edit/i.test(content.slice(0, 600))) { auditExempt.push(`${rel} (generated)`); continue; }
    if (/^> Status: archived/m.test(content)) { auditExempt.push(`${rel} (archived)`); continue; }
    lines.forEach((line, idx) => {
      if (/^\s*\|?\s*:?-{3}/.test(line)) return;
      // A claim = a completeness word plus a verification verb ("all callables tested", "fully verified");
      // "every employee was owner" in a defect description is not a claim.
      // Judged per table cell, so a "Fixed" status column does not turn a defect description into a claim.
      const claimCell = line.split("|").find((cell) => {
        const w = cell.match(/\b(all|every|complete|completely|fully|perfect)\b|100\s?%/i);
        return w && /\b(pass(es|ed)?|verified|covered|tested|fixed|resolved|done|closed|proven|green|complete[d]?)\b/i.test(cell.replace(w[0], ""));
      });
      if (!claimCell) return;
      const words = claimCell.match(/\b(all|every|complete|completely|fully|perfect)\b|100\s?%/i);
      const refs = [...line.matchAll(/\[cov:(C-\d+)\]/g)].map((m) => m[1]);
      const bad = refs.filter((id) => !coverage || !coverage.invariants[id] || !coverage.invariants[id].passed);
      if (!refs.length || bad.length) violations.push({ file: rel, line: idx + 1, term: `unbacked "${words[0]}"${bad.length ? ` (${bad.join(", ")} not n/n)` : ""}`, snippet: line.trim().slice(0, 140) });
    });
    continue;
  }

  lines.forEach((line, idx) => {
    // Ignore lines that explicitly disclaim or warn against the banned word (e.g. "Do not say production ready")
    if (line.includes("banned") || line.includes("DO NOT SAY") || line.includes("forbidden") || line.includes("instead of")) {
      return;
    }

    for (const { pattern, name } of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: idx + 1,
          term: name,
          snippet: line.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`[FAIL] check-doc-banned-words found ${violations.length} banned phrase violation(s):`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} [${v.term}] "${v.snippet}"`);
  }
  console.error(`\nRemedy: State truth as 'emulator-verified' with known open items or cloud console prerequisites.`);
  process.exit(1);
}

console.log(`✓ check-doc-banned-words: 0 banned words found across ${filesToCheck.length} documents; docs/audit exemptions: ${auditExempt.length} (${auditExempt.join(", ")}).`);

