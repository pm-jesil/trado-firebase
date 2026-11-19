#!/usr/bin/env node
/**
 * Trado Gate & Seeded-Defect Integrity Guard (Prompt 76B BC1.3)
 *
 * Verifies that:
 * 1. All gate scripts and seeded-defect harnesses reside permanently inside the repo.
 * 2. No test, gate script, script, or package.json references scratch folders outside the repo (e.g. trado-scratch, AppData/Local/Temp).
 * 3. Required gate scripts and npm scripts exist.
 *
 * Usage:
 *   node scripts/check-gate-integrity.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED_GATE_FILES = [
  "functions/scripts/gate/run-emulator-gate.cjs",
  "functions/scripts/gate/verify-bx2-emulator.cjs",
  "functions/scripts/gate/verify-bx1-bx4-emulator.cjs",
  "functions/scripts/gate/verify-seeded-defects.cjs",
];

const SCAN_DIRS = [
  path.join(ROOT, "functions", "scripts"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "functions", "src", "test"),
];

function checkContentForExternalPaths(relPath, content) {
  const violations = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    // Flag hardcoded temp/scratch paths outside repo or hardcoded absolute machine paths
    if (/[a-zA-Z]:[/\\]+(?:Users|tmp|temp)[/\\].*?trado-scratch/i.test(line)) {
      violations.push({ file: relPath, line: idx + 1, rule: "HARDCODED_SCRATCH_PATH", text: line.trim() });
    }
    if (/(?:AppData[/\\]+Local[/\\]+Temp[/\\]+trado-scratch)/i.test(line)) {
      violations.push({ file: relPath, line: idx + 1, rule: "TEMP_SCRATCH_PATH", text: line.trim() });
    }
    if (/[a-zA-Z]:[/\\]+Users[/\\].*?[/\\]trado-firebase/i.test(line)) {
      violations.push({ file: relPath, line: idx + 1, rule: "HARDCODED_ABSOLUTE_REPO_PATH", text: line.trim() });
    }
  });
  return violations;
}

function runIntegrityAudit(root = ROOT) {
  const violations = [];
  const scanned = [];

  // 1. Verify required gate files exist
  for (const rel of REQUIRED_GATE_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      violations.push({ file: rel, line: 1, rule: "MISSING_GATE_FILE", text: `Required gate file missing: ${rel}` });
    }
  }

  // 2. Verify functions/package.json gate scripts
  const pkgPath = path.join(root, "functions", "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (!scripts["gate:emulator"]) {
      violations.push({ file: "functions/package.json", line: 1, rule: "MISSING_GATE_SCRIPT", text: "Missing scripts['gate:emulator']" });
    }
    if (!scripts["gate:seeded-defects"]) {
      violations.push({ file: "functions/package.json", line: 1, rule: "MISSING_GATE_SCRIPT", text: "Missing scripts['gate:seeded-defects']" });
    }
  }

  // 3. Scan directories
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== ".git") walk(full);
      } else if (/\.(c?js|ts|json)$/.test(ent.name)) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        scanned.push(rel);
        const content = fs.readFileSync(full, "utf8");
        const found = checkContentForExternalPaths(rel, content);
        violations.push(...found);
      }
    }
  }

  for (const d of SCAN_DIRS) walk(d);
  return { scanned, violations };
}

function runSelfTests() {
  const defects = [];

  // Seed 1: detect hardcoded scratch path
  const scratchSample = "C:" + "\\Users\\someone\\" + "AppData\\Local\\Temp\\" + "trado-scratch\\run.cjs";
  const v1 = checkContentForExternalPaths("test.js", `const f = "${scratchSample}";`);
  assert.ok(v1.length > 0 && v1.some((v) => v.rule === "HARDCODED_SCRATCH_PATH" || v.rule === "TEMP_SCRATCH_PATH"), "Should detect scratch path");
  defects.push("HARDCODED_SCRATCH_PATH");

  // Seed 2: detect hardcoded absolute repo path
  const repoSample = "C:" + "\\Users\\someone\\Project\\FireBase\\" + "trado-firebase";
  const v2 = checkContentForExternalPaths("test.js", `const r = "${repoSample}";`);
  assert.ok(v2.length > 0 && v2[0].rule === "HARDCODED_ABSOLUTE_REPO_PATH", "Should detect hardcoded absolute repo path");
  defects.push("HARDCODED_ABSOLUTE_REPO_PATH");

  // Seed 3: detect missing gate file in audit
  const audit = runIntegrityAudit(path.join(ROOT, "scripts")); // intentionally bad root
  assert.ok(audit.violations.some((v) => v.rule === "MISSING_GATE_FILE"), "Should detect missing gate files");
  defects.push("MISSING_GATE_FILE");

  console.log(`✓ check-gate-integrity --test self-tests passed (${defects.length}/3 seeded defects caught: ${defects.join(", ")}).`);
}

if (process.argv.includes("--test")) {
  runSelfTests();
  process.exit(0);
}

const res = runIntegrityAudit();
if (res.violations.length > 0) {
  console.error(`✗ FAIL: ${res.violations.length} gate integrity violation(s) found across ${res.scanned.length} scanned files:`);
  for (const v of res.violations) {
    console.error(`  - ${v.file}:${v.line} [${v.rule}]: ${v.text}`);
  }
  process.exit(1);
}

console.log(`✓ check-gate-integrity: 0 violations across ${res.scanned.length} scanned files (all gate scripts present, zero external scratch paths).`);
process.exit(0);
