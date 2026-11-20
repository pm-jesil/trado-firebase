/**
 * Trado Firebase Backend — Static Guard: No Currency Fallback Constraint
 *
 * Enforces Prompt 77D S6/S7:
 * Every money and document operation must resolve the authentic currency of the
 * document or organization. Silent fallbacks like `|| "INR"`, `?? "INR"`,
 * `.default("INR")`, or `currency = "INR"` default parameters are strictly forbidden.
 *
 * A missing currency is an ERROR (HttpsError failed-precondition, reason CURRENCY_MISSING),
 * never a default.
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "functions", "src");

const ALLOWED_EXCEPTIONS = new Set([
  path.normalize("functions/src/constants/currencies.ts"),
  path.normalize("functions/src/constants/countryDefaults.ts"),
  path.normalize("functions/src/constants/catalogs.ts"),
  path.normalize("functions/src/scripts/seed-emulator.ts"),
  path.normalize("functions/src/services/usageMetering.ts"),
]);

function findSourceFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".local" && entry.name !== "test") {
        files = files.concat(findSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const FORBIDDEN_PATTERNS = [
  { name: 'fallback || "INR"', regex: /\|\|\s*["']INR["']/ },
  { name: 'fallback ?? "INR"', regex: /\?\?\s*["']INR["']/ },
  { name: 'zod .default("INR")', regex: /\.default\(\s*["']INR["']\s*\)/ },
  { name: 'default param currency = "INR"', regex: /currency\s*:\s*string\s*=\s*["']INR["']/ },
];

function checkContent(relPath, content) {
  const normalizedRel = path.normalize(relPath);
  if (ALLOWED_EXCEPTIONS.has(normalizedRel)) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const violations = [];

  lines.forEach((line, index) => {
    // Strip comments
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//, "");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(code)) {
        violations.push(`${relPath}:${index + 1} - Found ${pattern.name}: "${line.trim()}"`);
      }
    }
  });

  return violations;
}

if (process.argv.includes("--test")) {
  // Self-test mode (seeded defect verification per D-34)
  const fakeBad = 'const currency = input.currency || "INR";';
  const v1 = checkContent("functions/src/callables/rogueCallable.ts", fakeBad);
  if (v1.length === 0) {
    console.error("[SELF-TEST FAILED] Guard failed to detect || 'INR' fallback.");
    process.exit(1);
  }

  const fakeBad2 = 'export const schema = z.string().default("INR");';
  const v2 = checkContent("functions/src/validation/rogueSchema.ts", fakeBad2);
  if (v2.length === 0) {
    console.error("[SELF-TEST FAILED] Guard failed to detect .default('INR') fallback.");
    process.exit(1);
  }

  const fakeBad3 = 'function calc(amount: number, currency: string = "INR") {}';
  const v3 = checkContent("functions/src/services/rogueService.ts", fakeBad3);
  if (v3.length === 0) {
    console.error("[SELF-TEST FAILED] Guard failed to detect default parameter currency = 'INR'.");
    process.exit(1);
  }

  const fakeGood = 'const currency = requireCurrency(doc.currency, "doc");';
  const v4 = checkContent("functions/src/callables/cleanCallable.ts", fakeGood);
  if (v4.length > 0) {
    console.error("[SELF-TEST FAILED] Guard falsely flagged clean requireCurrency call.");
    process.exit(1);
  }

  console.log("[PASS] check-no-currency-fallback --test self-test passed (4/4 defect assertions).");
  process.exit(0);
}

let totalViolations = 0;
const allFiles = findSourceFiles(SRC_DIR);

for (const file of allFiles) {
  const relPath = path.normalize(path.relative(path.resolve(__dirname, ".."), file));
  const content = fs.readFileSync(file, "utf8");
  const issues = checkContent(relPath, content);
  for (const issue of issues) {
    console.error(`[CURRENCY_FALLBACK_VIOLATION] ${issue}`);
    totalViolations++;
  }
}

if (totalViolations > 0) {
  console.error(`No-currency-fallback check failed: ${totalViolations} fallback(s) found.`);
  process.exit(1);
} else {
  console.log(`[PASS] No currency fallback guard: 0 fallbacks found across ${allFiles.length} non-test source files.`);
}
