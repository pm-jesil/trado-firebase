/**
 * Generate Callable Test Map
 * 
 * Inspects all exported Cloud Function callables and maps them against:
 * 1. Static test references (in unit tests, callable test suites, governance, and e2e suites)
 * 2. Runtime invocation traces (successes and gate denial observations)
 * 
 * Outputs: docs/generated/callable-test-map.json
 */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const FUNCTIONS_DIR = path.resolve(ROOT_DIR, "functions");
const INDEX_PATH = path.resolve(FUNCTIONS_DIR, "src/index.ts");
// Per-unit trace files written by functions/scripts/helpers/callable-client.cjs during verify runs ("adhoc--" files are not evidence).
const TRACE_DIR = path.resolve(ROOT_DIR, ".local/traces");
const OUTPUT_PATH = path.resolve(ROOT_DIR, "docs/generated/callable-test-map.json");

// 1. Extract all exported callables from index.ts
const indexContent = fs.readFileSync(INDEX_PATH, "utf8");
const exportedCallables = [];

// Match each export { ... } from "..." block
const exportBlockRegex = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g;
let blockMatch;
while ((blockMatch = exportBlockRegex.exec(indexContent)) !== null) {
  const fromPath = blockMatch[2];
  // We include callables from ./callables/
  if (fromPath.includes("callables/")) {
    const rawTokens = blockMatch[1].replace(/\/\/.*$/gm, "").split(/[\s,]+/);
    for (const token of rawTokens) {
      const clean = token.trim();
      if (/^[a-zA-Z0-9_]+$/.test(clean) && !exportedCallables.includes(clean)) {
        exportedCallables.push(clean);
      }
    }
  }
}

// 2. Discover test files
function findFiles(dir, exts) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const testFiles = [
  ...findFiles(path.resolve(FUNCTIONS_DIR, "scripts"), [".js", ".cjs"]),
  ...findFiles(path.resolve(FUNCTIONS_DIR, "src/test"), [".ts", ".js"]),
];

// Pre-read all test file contents
const testFileContents = testFiles.map(file => ({
  file: path.relative(ROOT_DIR, file).replace(/\\/g, "/"),
  content: fs.readFileSync(file, "utf8"),
}));

// 3. Read runtime traces if present
const runtimeTraces = new Map();
const traceFiles = fs.existsSync(TRACE_DIR) ? fs.readdirSync(TRACE_DIR).filter((f) => f.endsWith(".jsonl") && !f.startsWith("adhoc--")) : [];
for (const file of traceFiles) {
  const lines = fs.readFileSync(path.join(TRACE_DIR, file), "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const trace = JSON.parse(line);
      const entry = runtimeTraces.get(trace.callable) || { successes: 0, denials: 0, reasons: new Set() };
      const n = trace.count || 1;
      if (trace.outcome === "success") {
        entry.successes += n;
      } else {
        entry.denials += n;
        if (trace.reason) entry.reasons.add(trace.reason);
      }
      runtimeTraces.set(trace.callable, entry);
    } catch (e) { }
  }
}

// 4. Build map
const callableMap = {};
let coveredCount = 0;

for (const callable of exportedCallables) {
  // Find matching test files
  const matchingFiles = testFileContents
    .filter(tf => {
      // Must match whole word of callable name
      const regex = new RegExp(`\\b${callable}\\b`);
      return regex.test(tf.content);
    })
    .map(tf => tf.file);

  const runtime = runtimeTraces.get(callable) || { successes: 0, denials: 0, reasons: new Set() };
  const reasonsArray = Array.isArray(runtime.reasons) ? runtime.reasons : Array.from(runtime.reasons || []);

  const hasStaticTests = matchingFiles.length > 0;
  const hasRuntimeTrace = runtime.successes > 0 || runtime.denials > 0;
  const isCovered = hasStaticTests;

  if (isCovered) coveredCount++;

  callableMap[callable] = {
    callable,
    testFiles: matchingFiles,
    testFileCount: matchingFiles.length,
    runtime: {
      successes: runtime.successes,
      denials: runtime.denials,
      observedDenialReasons: reasonsArray,
    },
    covered: isCovered,
  };
}

const summary = {
  totalExportedCallables: exportedCallables.length,
  coveredCallables: coveredCount,
  uncoveredCallables: exportedCallables.length - coveredCount,
  coveragePercentage: Math.round((coveredCount / exportedCallables.length) * 100),
  callables: callableMap,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf8");
console.log(`✓ Generated callable test map: ${OUTPUT_PATH}`);
console.log(`  Total Callables: ${exportedCallables.length}`);
console.log(`  Covered: ${coveredCount} (${summary.coveragePercentage}%)`);
