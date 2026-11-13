/**
 * Cost reconciliation on fixture billing-export rows (prompt 66 §2.4): the comparison logic is proven
 * here; running it against the real export is cloud-only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcile, BILLED_SKU_OF } from "../../services/costReconciliation.js";
import { emptyTotals } from "../../services/usageReport.js";
import { DEFAULT_RATE_CARD_V1 } from "../../services/usageMetering.js";

describe("Cost reconciliation (fixture export rows)", () => {
  const totals = { ...emptyTotals(), calls: 1000, ops: { reads: 200_000, writes: 50_000, deletes: 1_000 } };

  it("compares estimated and billed quantity and cost per SKU and reports the residual", () => {
    const billed = [
      { sku: BILLED_SKU_OF.firestoreReadPer100k, quantity: 250_000, cost: 12.5, currency: "INR" },
      { sku: BILLED_SKU_OF.firestoreWritePer100k, quantity: 50_000, cost: 7.5, currency: "INR" },
    ];
    const lines = reconcile(totals, DEFAULT_RATE_CARD_V1, billed);
    const reads = lines.find((l) => l.sku === "firestoreReadPer100k")!;
    assert.equal(reads.estimatedQuantity, 200_000);
    assert.equal(reads.billedQuantity, 250_000);
    assert.equal(reads.quantityRatio, 0.8);
    assert.equal(reads.estimatedCost, 10); // 2 × 5.0 per 100k
    assert.equal(reads.residualCost, 2.5); // billed but not seen by the backend
    assert.ok(reads.explanations.some((e) => /client-direct/.test(e)));
    const writes = lines.find((l) => l.sku === "firestoreWritePer100k")!;
    assert.equal(writes.quantityRatio, 1);
    assert.equal(writes.residualCost, 0);
  });

  it("says when a SKU has no billed row instead of inventing a ratio", () => {
    const lines = reconcile(totals, DEFAULT_RATE_CARD_V1, []);
    const deletes = lines.find((l) => l.sku === "firestoreDeletePer100k")!;
    assert.equal(deletes.billedQuantity, 0);
    assert.equal(deletes.quantityRatio, null);
    assert.match(deletes.explanations[0], /no billed row/);
  });
});
