/**
 * Reports & Analytics - Shared Helpers and Query Builders
 */

import { db } from "../../services/firebase.js";
import { StockMovementType } from "../../constants/enums.js";
import { BillDoc } from "../../types/models.js";

/** Outward stock movements that are inventory losses (not sales, not returns to vendor). */
export const WRITE_OFF_MOVEMENT_TYPES = [StockMovementType.DAMAGE_OUT, StockMovementType.ADJUSTMENT_OUT];

/**
 * Helper to convert array of flat objects to CSV format.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((header) => {
      const val = row[header] ?? "";
      const escaped = String(val).replace(/"/g, "\"\"");
      return `"${escaped}"`;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

/** Bills that count as sales in a period (one query shape for every report). */
export function billsInPeriod(orgId: string, period: { branchId?: string; from?: string; to?: string }): FirebaseFirestore.Query {
  let q: FirebaseFirestore.Query = db.collection("bills").where("organizationId", "==", orgId).where("status", "in", ["active", "partial", "paid"]);
  if (period.branchId) q = q.where("branchId", "==", period.branchId);
  if (period.from) q = q.where("createdAt", ">=", period.from);
  if (period.to) q = q.where("createdAt", "<=", `${period.to}T23:59:59.999Z`);
  return q;
}

/** Bill lines keyed "${billId}#${lineId}" for the given bills (one batched read). */
export async function sourceLinesById(billIds: string[]): Promise<Map<string, BillDoc["items"][number]>> {
  const ids = Array.from(new Set(billIds.filter(Boolean)));
  const out = new Map<string, BillDoc["items"][number]>();
  if (!ids.length) return out;
  const snaps = await db.getAll(...ids.map((id) => db.collection("bills").doc(id)));
  for (const snap of snaps) {
    if (!snap.exists) continue;
    for (const line of (snap.data() as BillDoc).items || []) out.set(`${snap.id}#${line.lineId}`, line);
  }
  return out;
}

/** Quantity (base units) and revenue per product across bills. */
export function productSalesTotals(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Map<string, { productId: string; quantity: number; revenue: number }> {
  const stats = new Map<string, { productId: string; quantity: number; revenue: number }>();
  for (const doc of docs) {
    for (const item of (doc.data() as BillDoc).items || []) {
      const row = stats.get(item.productId) || { productId: item.productId, quantity: 0, revenue: 0 };
      row.quantity += item.baseQuantity ?? item.quantity ?? 0;
      row.revenue += item.subtotal || 0;
      stats.set(item.productId, row);
    }
  }
  return stats;
}
