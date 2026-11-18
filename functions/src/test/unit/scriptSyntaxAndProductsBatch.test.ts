import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ListProductsSchema } from "../../validation/schemas.js";

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS_DIR = path.join(FUNCTIONS_DIR, "scripts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildOutcomeCoverage } = require(path.join(SCRIPTS_DIR, "report-outcome-coverage.js")) as {
  buildOutcomeCoverage: (opts?: { testFiles?: string[] }) => {
    totalCallables: number;
    callablesWithAtLeastOneOutcome: number;
    totalDeclaredOutcomes: number;
    assertedDeclaredOutcomes: number;
    rows: Array<{ callable: string; domain: string; priority: boolean; assertedCount: number }>;
  };
};

describe("BX4 Script Syntax Gate (TT-9 / BM-19), Outcome Coverage (TT-4 / BM-17) & productsList Batch IDs (CP-1)", () => {
  it("TT-9 / BM-19: every functions/scripts/*.cjs file passes `node --check` syntax validation", () => {
    const cjsFiles = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".cjs")).sort();
    assert.ok(cjsFiles.length >= 20, `Expected >= 20 .cjs scripts, found ${cjsFiles.length}`);
    for (const f of cjsFiles) {
      execFileSync(process.execPath, ["--check", path.join(SCRIPTS_DIR, f)], { stdio: "pipe" });
    }
  });

  it("CP-1 [productsList#ok] accepts 1..50 unique ids in ListProductsSchema", () => {
    const parsed = ListProductsSchema.parse({ ids: ["prod_1", "prod_2", "prod_3"] });
    assert.deepStrictEqual(parsed.ids, ["prod_1", "prod_2", "prod_3"]);
  });

  it("CP-1 [productsList#INVALID_ARGUMENT] rejects empty ids, > 50 ids, and duplicate ids", () => {
    assert.throws(() => ListProductsSchema.parse({ ids: [] }));
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `prod_${i}`);
    assert.throws(() => ListProductsSchema.parse({ ids: fiftyOne }));
    assert.throws(() => ListProductsSchema.parse({ ids: ["prod_1", "prod_1"] }), /Duplicate product IDs/);
  });

  it("TT-4 / BM-17: report-outcome-coverage lists priority domains first and marks callables UNTESTED when no tagged test exists", () => {
    const live = buildOutcomeCoverage();
    assert.ok(live.totalCallables >= 186);
    assert.strictEqual(live.rows[0].priority, true, "Priority money/stock/request/auth domains must be listed first");
    assert.ok(live.callablesWithAtLeastOneOutcome >= 1, "At least productsList tagged outcomes should be detected");

    // BM-17 seeded defect: when no test files exist, every callable's assertedCount drops to 0 (UNTESTED)
    const empty = buildOutcomeCoverage({ testFiles: [] });
    assert.strictEqual(empty.callablesWithAtLeastOneOutcome, 0);
    assert.strictEqual(empty.assertedDeclaredOutcomes, 0);
  });
});
