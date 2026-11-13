/**
 * Cost reconciliation (prompt 66 §2.4): estimated quantities and cost per SKU per day (the sum of every
 * rollup, platform included) against what Google billed. The comparison is pure and tested on fixture
 * export rows (test/unit/costReconciliation.test.ts); running it needs the Cloud Billing export to
 * BigQuery, which is cloud-only (production checklist items 1, 16, 17). Nothing here runs on a schedule.
 */
import { UsageTotals, estimateCost } from "./usageReport.js";
import { UsageRateCardDoc } from "../types/models.js";

/** One row of the billing export after BILLING_EXPORT_QUERY (sku, usage quantity in the SKU's unit, cost). */
export interface BilledRow { sku: string; quantity: number; cost: number; currency: string }

/** platformCostReconciliation/{yyyyMMdd}: one document per day, written by the cloud-only script. */
export interface CostReconciliationLine {
  sku: string;
  estimatedQuantity: number;
  billedQuantity: number;
  quantityRatio: number | null; // estimated / billed
  estimatedCost: number;
  billedCost: number;
  costRatio: number | null;
  residualCost: number; // billed − estimated: what the backend does not see
  explanations: string[];
}

export interface PlatformCostReconciliationDoc {
  day: string; // YYYY-MM-DD
  reconciledAt: string; // ISO
  currency: string;
  rateCardVersion: string;
  estimatedTotalCost: number;
  billedTotalCost: number;
  overallRatio: number | null;
  residualTotalCost: number;
  lines: CostReconciliationLine[];
  status: "reconciled" | "pending";
}

/** Billing-export SKU descriptions for the SKUs the rate card prices (verify the names in the export). */
export const BILLED_SKU_OF: Record<string, string> = {
  firestoreReadPer100k: "Cloud Firestore Read Ops",
  firestoreWritePer100k: "Cloud Firestore Entity Writes",
  firestoreDeletePer100k: "Cloud Firestore Entity Deletes",
  functionsInvocationPerMillion: "Cloud Run Functions Invocations",
  functionsComputeGbSecond: "Cloud Run Functions Memory Time",
};

/** Template for the export (table and date are parameters; run by scripts with BigQuery credentials). */
export const BILLING_EXPORT_QUERY = `
SELECT sku.description AS sku, SUM(usage.amount_in_pricing_units) AS quantity, SUM(cost) AS cost, ANY_VALUE(currency) AS currency
FROM \`@table\`
WHERE project.id = @projectId AND DATE(usage_start_time) = @day
  AND service.description IN ("Cloud Firestore", "Cloud Run functions", "Cloud Functions", "Cloud Storage")
GROUP BY sku
ORDER BY cost DESC`;

const WHY: Record<string, string[]> = {
  firestoreReadPer100k: ["client-direct reads allowed by the rules (profile, devices, memberships, notifications, plans, catalogs)", "Firebase console and export / backup reads", "the free allowance is applied by Google before billing"],
  firestoreWritePer100k: ["TTL deletes and console edits", "the free allowance"],
  firestoreDeletePer100k: ["TTL deletes", "the free allowance"],
  functionsInvocationPerMillion: ["scheduler and Pub/Sub invocations", "cold starts and retries"],
  functionsComputeGbSecond: ["the estimate is an upper bound (concurrency shares an instance)", "CPU billed separately from memory"],
};

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Per SKU: estimated vs billed quantity and cost, the residual, and the usual explanations of a gap. */
export function reconcile(estimatedTotals: UsageTotals, card: UsageRateCardDoc, billed: BilledRow[]): CostReconciliationLine[] {
  const estimate = estimateCost(estimatedTotals, card);
  return estimate.lines.map((l) => {
    const rows = billed.filter((r) => r.sku === BILLED_SKU_OF[l.sku]);
    const billedQuantity = rows.reduce((s, r) => s + r.quantity, 0);
    const billedCost = Math.round(rows.reduce((s, r) => s + r.cost, 0) * 10000) / 10000;
    return {
      sku: l.sku,
      estimatedQuantity: l.quantity,
      billedQuantity,
      quantityRatio: ratio(l.quantity, billedQuantity),
      estimatedCost: l.cost,
      billedCost,
      costRatio: ratio(l.cost, billedCost),
      residualCost: Math.round((billedCost - l.cost) * 10000) / 10000,
      explanations: rows.length ? WHY[l.sku] || [] : ["no billed row for this SKU on that day (verify the SKU description)"],
    };
  });
}
