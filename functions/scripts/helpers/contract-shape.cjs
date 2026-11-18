/**
 * Contract-Driven Response Shape Validator (Hybrid Prompt 76 — BX1 B-3, D-55)
 *
 * Driven strictly by docs/flutter-contract/callables.json (never hand-maintained shapes).
 * Fails loudly when a callable renames or omits a declared response key (BM-10).
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const CATALOG_PATH = path.resolve(__dirname, "..", "..", "..", "docs", "flutter-contract", "callables.json");

let catalogCache = null;
const exercisedCallables = new Set();

function loadCatalog() {
  if (!catalogCache) {
    if (!fs.existsSync(CATALOG_PATH)) {
      throw new Error(`Missing generated contract catalog at ${CATALOG_PATH}. Run \`node scripts/generate-flutter-contract.js\`.`);
    }
    const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    catalogCache = new Map((parsed.callables || []).map((c) => [c.name, c]));
  }
  return catalogCache;
}

/**
 * Validates a callable's runtime response against its generated contract descriptor in callables.json.
 */
function assertResponseShape(callableName, data) {
  const catalog = loadCatalog();
  const entry = catalog.get(callableName);
  assert.ok(entry, `Callable "${callableName}" is missing from docs/flutter-contract/callables.json`);
  assert.ok(data !== null && typeof data === "object" && !Array.isArray(data), `${callableName}: expected JSON object response, got ${typeof data}`);

  const resp = entry.response || {};
  if (resp.envelope === "LIST") {
    assert.ok(Array.isArray(data.items), `${callableName}: LIST response missing array "items"`);
    if (resp.requiredTopKeys && resp.requiredTopKeys.includes("count")) {
      assert.strictEqual(typeof data.count, "number", `${callableName}: LIST response missing numeric "count"`);
    }
  }

  for (const key of resp.requiredTopKeys || []) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(data, key),
      `${callableName}: response missing required contract key "${key}" (actual keys: [${Object.keys(data).join(", ")}])`
    );
  }

  exercisedCallables.add(callableName);
}

function getResponseCoverageSummary() {
  const catalog = loadCatalog();
  const all = [...catalog.keys()].sort();
  const tested = all.filter((n) => exercisedCallables.has(n));
  const untested = all.filter((n) => !exercisedCallables.has(n));
  return { total: all.length, testedCount: tested.length, untestedCount: untested.length, tested, untested };
}

module.exports = {
  assertResponseShape,
  getResponseCoverageSummary,
  loadCatalog,
};
