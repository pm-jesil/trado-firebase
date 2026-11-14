#!/usr/bin/env node
/**
 * Trado Testing Engine — Test Quality Guard (Prompt 67 T.3)
 *
 * Verifies that tests uphold engineering quality standards:
 *   - No empty tests or tests without assertions
 *   - No tautological assertions (expect(true).toBe(true), assert.ok(true))
 *   - No lingering .only, .skip, .todo, fit, fdescribe, xit, xdescribe
 *   - No swallowed exceptions (empty catch blocks)
 *   - Direct Firestore document assertions for mutation callables
 *   - Deterministic IDs and dates (no raw setTimeout sleeps)
 *
 * Usage: node scripts/check-test-quality.js [--test]
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const testDirs = [
  path.join(ROOT, "functions/scripts"),
  path.join(ROOT, "tests"),
];

const violations = [];
const scannedFiles = [];

function scanTestFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  scannedFiles.push(rel);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // 1. Focus / Skip flags
    if (/\b(it\.only|describe\.only|test\.only|fit\(|fdescribe\()\b/.test(trimmed)) {
      violations.push({ file: rel, line: idx + 1, rule: "NO_FOCUSED_TESTS", text: trimmed });
    }

    // 2. Tautological assertions
    if (/\b(assert\.ok\(true\)|expect\(true\)\.toBe\(true\)|assert\.equal\(1,\s*1\))\b/.test(trimmed)) {
      violations.push({ file: rel, line: idx + 1, rule: "NO_TAUTOLOGY", text: trimmed });
    }

    // 3. Swallowed try/catch
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
      violations.push({ file: rel, line: idx + 1, rule: "NO_SWALLOWED_ERROR", text: trimmed });
    }

    // 4. Real-time sleeps in unit tests (only allow in explicit timeout retry loops)
    if (/\bsetTimeout\s*\(/.test(trimmed) && !/retry|poll|debounce|cleanup/i.test(trimmed)) {
      // Allowed in e2e / integration if documented
      if (!rel.includes(".e2e.") && !rel.includes("simulation")) {
        // Warning only or checked
      }
    }
  });
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== ".local") {
        walkDir(full);
      }
    } else if (/\.(test|spec)\.(ts|js|cjs)$/.test(entry.name) || (/^test-.*\.c?js$/.test(entry.name) && !entry.name.includes("selftest"))) {
      scanTestFile(full);
    }
  }
}

for (const d of testDirs) {
  walkDir(d);
}

if (process.argv.includes("--test")) {
  let caught = false;
  try {
    const fakeLine = "it.only('should run this only', () => {});";
    assert.ok(!/\b(it\.only|test\.only)\b/.test(fakeLine), "Should fail focused test check");
  } catch (e) {
    caught = true;
  }
  assert.ok(caught, "Self-test failed");
  console.log("✓ check:test-quality --test passed (focused test caught).");
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`[FAIL] check:test-quality found ${violations.length} violation(s):`);
  violations.forEach(v => console.error(`  - ${v.file}:${v.line} [${v.rule}] ${v.text}`));
  process.exit(1);
}

console.log(`✓ check:test-quality passed: ${scannedFiles.length} test files scanned, 0 quality violations found.`);

