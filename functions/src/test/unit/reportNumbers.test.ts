import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

// Compiled test runs from functions/lib/test/unit/reportNumbers.test.js -> functions/scripts/report-numbers.js
const reportNumbersPath = path.resolve(__dirname, "..", "..", "..", "scripts", "report-numbers.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { collectNumbers, formatTextReport } = require(reportNumbersPath) as {
  collectNumbers: (opts?: { runUnit?: boolean; skipRules?: boolean }) => {
    meta: { utcTime: string; gitSha: string | null; gitDirty: boolean | null; nodeVersion: string; command: string };
    exports: { total: number; callables: number; triggers: number; schedules: number; callablesByDomain: Record<string, number>; callablesByGate: Record<string, number> };
    collections: { inSourceCount: number; docInterfacesCount: number; explicitRulesBlocksCount: number };
    contract: { topLevelDocsCount: number; entityFormsCount: number; requestDetailFormsCount: number; totalFormJsonFiles: number; summaryLines: number };
    permissions: { totalEntries: number; concreteCount: number; wildcards: string[] };
    reasonCodes: { gateReasonEnumCount: number; requestReasonEnumCount: number; thrownLiteralsCount: number; documentedInErrorsMdCount: number };
    stateMachines: { codeCount: number; documentedCount: number };
    allowlist: { totalExceptions: number; maxId: string | null };
    docs: { totalMarkdownFiles: number };
    testInventory: { unitTestFilesCount: number; unitRun: { status: string } };
  };
  formatTextReport: (n: unknown) => string;
};

describe("Source-Derived Numbers Reporter (BX0 A-1, D-N1)", () => {
  it("derives consistent export totals (callables + triggers + schedules === total)", () => {
    const n = collectNumbers({ runUnit: false, skipRules: true });
    assert.strictEqual(
      n.exports.callables + n.exports.triggers + n.exports.schedules,
      n.exports.total,
      "Total exports must equal callables + triggers + schedules"
    );
    assert.ok(n.exports.callables > 100, "Expected > 100 callables");
    assert.ok(n.exports.triggers >= 1, "Expected at least 1 trigger");
    assert.ok(n.exports.schedules >= 1, "Expected at least 1 schedule");

    const sumDomains = Object.values(n.exports.callablesByDomain).reduce((a, b) => a + b, 0);
    assert.strictEqual(sumDomains, n.exports.callables, "Sum of domain counts must equal callables count");

    const sumGates = Object.values(n.exports.callablesByGate).reduce((a, b) => a + b, 0);
    assert.strictEqual(sumGates, n.exports.callables, "Sum of gate counts must equal callables count");
  });

  it("derives non-empty metadata, permissions, collections, contract, allowlist, and formats text output", () => {
    const n = collectNumbers({ runUnit: false, skipRules: true });
    assert.ok(n.meta.utcTime.endsWith("Z"), "UTC ISO timestamp expected");
    assert.ok(n.meta.nodeVersion.startsWith("v"), "Node version expected");
    assert.strictEqual(n.permissions.concreteCount + n.permissions.wildcards.length, n.permissions.totalEntries);
    assert.ok(n.collections.inSourceCount > 40, "Expected > 40 collections in source");
    assert.strictEqual(n.contract.entityFormsCount + n.contract.requestDetailFormsCount, n.contract.totalFormJsonFiles);
    assert.ok(n.allowlist.totalExceptions > 0, "Expected allowlist entries");
    assert.strictEqual(n.testInventory.unitRun.status, "NOT RUN", "Must report NOT RUN when unit suite not invoked");

    const formatted = formatTextReport(n);
    assert.ok(formatted.includes("TRADO BACKEND SOURCE-DERIVED NUMBERS"), "Header missing in text report");
    assert.ok(formatted.includes(`Total exports:  ${n.exports.total}`), "Total exports missing in text report");
  });
});
