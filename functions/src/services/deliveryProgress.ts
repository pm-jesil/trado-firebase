/**
 * Delivery progress per bill line (partial deliveries, Part 8.4): computed from the deliveries at
 * read time, never stored on the bill.
 */

import type { BillDoc, DeliveryDoc } from "../types/models.js";
import { DeliveryStatus } from "../constants/enums.js";

/** Quantity per bill line not yet on a (non-returned) delivery. */
export function remainingToDeliver(bill: BillDoc, deliveries: DeliveryDoc[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of bill.items || []) out[item.lineId] = item.quantity;
  for (const d of deliveries) {
    if (d.status === DeliveryStatus.RETURNED) continue;
    for (const l of d.lines || []) if (out[l.lineId] !== undefined) out[l.lineId] = Math.round((out[l.lineId] - l.quantity) * 10000) / 10000;
  }
  return out;
}

/** Completion rule: a line is complete when delivered quantity (status delivered) reaches the ordered quantity. */
export function deliveryProgress(bill: BillDoc, deliveries: DeliveryDoc[]) {
  const lines = (bill.items || []).map((item) => {
    const delivered = deliveries.filter((d) => d.status === DeliveryStatus.DELIVERED).flatMap((d) => d.lines || []).filter((l) => l.lineId === item.lineId).reduce((t, l) => t + l.quantity, 0);
    const onTheWay = deliveries.filter((d) => ![DeliveryStatus.DELIVERED, DeliveryStatus.RETURNED].includes(d.status as DeliveryStatus)).flatMap((d) => d.lines || []).filter((l) => l.lineId === item.lineId).reduce((t, l) => t + l.quantity, 0);
    return { lineId: item.lineId, ordered: item.quantity, delivered, onTheWay, remaining: Math.max(0, item.quantity - delivered - onTheWay) };
  });
  return { complete: lines.every((l) => l.delivered >= l.ordered - 1e-9), lines };
}

