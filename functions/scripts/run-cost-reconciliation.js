#!/usr/bin/env node
/**
 * Daily platform cost reconciliation runner (prompt 66 §2.4).
 *
 * Reconciles server-measured operation rollups against Google Cloud Billing export rows
 * (or mock export in local emulator), calculating quantity and cost ratios, residuals,
 * and saving the result to platformCostReconciliation/{yyyyMMdd}.
 *
 * Usage:
 *   node functions/scripts/run-cost-reconciliation.js [--day YYYY-MM-DD] [--mock]
 */

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("node:path");

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "trado-x" });
}

const db = getFirestore();
const { reconcile, BILLED_SKU_OF } = require("../lib/services/costReconciliation.js");
const { readRollups, sumRollups, estimateCost } = require("../lib/services/usageReport.js");
const { DEFAULT_RATE_CARD_V1 } = require("../lib/services/usageMetering.js");

async function main() {
  const args = process.argv.slice(2);
  const dayIndex = args.indexOf("--day");
  const targetDay = dayIndex !== -1 && args[dayIndex + 1]
    ? args[dayIndex + 1]
    : new Date().toISOString().slice(0, 10);
  const isMock = args.includes("--mock") || process.env.FUNCTIONS_EMULATOR === "true";

  console.log(`[reconciliation] Reconciling platform cost for day: ${targetDay} (mock: ${isMock})`);

  // 1. Fetch server-estimated rollups for the day
  const docs = await readRollups("organizationUsageDaily", {
    startDate: targetDay,
    endDate: targetDay,
    limit: 5000,
  });
  const estimatedTotals = sumRollups(docs);
  const rateCard = DEFAULT_RATE_CARD_V1;
  const estimatedCostObj = estimateCost(estimatedTotals, rateCard);

  // 2. Fetch or mock billed rows
  let billedRows = [];
  if (isMock || !process.env.BIGQUERY_BILLING_DATASET) {
    // In emulator / mock mode: generate representative billed rows based on estimated totals + expected residual
    billedRows = [
      {
        sku: BILLED_SKU_OF.firestoreReadPer100k,
        quantity: Math.round(estimatedTotals.ops.reads * 1.05 + 500),
        cost: Math.round(((estimatedTotals.ops.reads * 1.05 + 500) / 100000) * rateCard.rates.firestoreReadPer100k * 100) / 100,
        currency: rateCard.currency,
      },
      {
        sku: BILLED_SKU_OF.firestoreWritePer100k,
        quantity: Math.round(estimatedTotals.ops.writes * 1.02),
        cost: Math.round(((estimatedTotals.ops.writes * 1.02) / 100000) * rateCard.rates.firestoreWritePer100k * 100) / 100,
        currency: rateCard.currency,
      },
      {
        sku: BILLED_SKU_OF.firestoreDeletePer100k,
        quantity: estimatedTotals.ops.deletes,
        cost: Math.round((estimatedTotals.ops.deletes / 100000) * rateCard.rates.firestoreDeletePer100k * 100) / 100,
        currency: rateCard.currency,
      },
      {
        sku: BILLED_SKU_OF.functionsInvocationPerMillion,
        quantity: estimatedTotals.calls,
        cost: Math.round((estimatedTotals.calls / 1000000) * rateCard.rates.functionsInvocationPerMillion * 100) / 100,
        currency: rateCard.currency,
      },
    ];
  } else {
    // Cloud BigQuery execution (requires IAM bigquery.jobUser + dataset reader)
    const { BigQuery } = require("@google-cloud/bigquery");
    const bq = new BigQuery();
    const query = BILLING_EXPORT_QUERY
      .replace("@table", process.env.BIGQUERY_BILLING_DATASET)
      .replace("@projectId", `'${process.env.GCLOUD_PROJECT || "trado-x"}'`)
      .replace("@day", `'${targetDay}'`);
    const [rows] = await bq.query({ query });
    billedRows = rows.map((r) => ({
      sku: r.sku,
      quantity: Number(r.quantity) || 0,
      cost: Number(r.cost) || 0,
      currency: r.currency || rateCard.currency,
    }));
  }

  // 3. Compute pure reconciliation lines
  const lines = reconcile(estimatedTotals, rateCard, billedRows);

  const billedTotalCost = Math.round(lines.reduce((acc, l) => acc + l.billedCost, 0) * 100) / 100;
  const estimatedTotalCost = Math.round(lines.reduce((acc, l) => acc + l.estimatedCost, 0) * 100) / 100;
  const residualTotalCost = Math.round((billedTotalCost - estimatedTotalCost) * 100) / 100;
  const overallRatio = billedTotalCost > 0
    ? Math.round((estimatedTotalCost / billedTotalCost) * 1000) / 1000
    : null;

  const docId = targetDay.replace(/-/g, "");
  const reconciliationDoc = {
    day: targetDay,
    reconciledAt: new Date().toISOString(),
    currency: rateCard.currency,
    rateCardVersion: rateCard.version,
    estimatedTotalCost,
    billedTotalCost,
    overallRatio,
    residualTotalCost,
    lines,
    status: "reconciled",
  };

  // 4. Save to platformCostReconciliation/{yyyyMMdd}
  await db.collection("platformCostReconciliation").doc(docId).set(reconciliationDoc);

  console.log(`\nReconciliation Document Written: platformCostReconciliation/${docId}`);
  console.log(`Overall Ratio: ${overallRatio ?? "N/A"} (Estimated: ${estimatedTotalCost} ${rateCard.currency}, Billed: ${billedTotalCost} ${rateCard.currency}, Residual: ${residualTotalCost} ${rateCard.currency})\n`);
  console.table(
    lines.map((l) => ({
      SKU: l.sku,
      "Est. Qty": l.estimatedQuantity,
      "Billed Qty": l.billedQuantity,
      "Qty Ratio": l.quantityRatio ?? "—",
      "Est. Cost": l.estimatedCost,
      "Billed Cost": l.billedCost,
      Residual: l.residualCost,
    }))
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[reconciliation] Error:", err);
    process.exit(1);
  });
}

module.exports = { main };

