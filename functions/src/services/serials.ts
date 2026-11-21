/**
 * Serial / IMEI / frame-number registry (Part 8.1).
 *
 *   serials/{organizationId}_{SERIAL}   one document per physical unit (unique per organization by id)
 *     { organizationId, serial, productId, branchId, status,
 *       receivedOutflowId, receivedLineId, holdBillId?, holdLineId?, soldBillId?, soldLineId?,
 *       returnId?, createdAt, updatedAt }
 *
 * Only references and the unit's own state: no product attribute is copied. Bill and purchase
 * lines do NOT store serial lists — the registry is the single source (a line's serials are
 * the registry entries pointing at it).
 *
 * Lifecycle
 *   receive (purchase confirmed)        → in_stock          (purchase pending approval → pending_receipt)
 *   approve / reject pending purchase   pending_receipt → in_stock / deleted
 *   reserve (sales order, pending sale) in_stock|returned → reserved (holdBillId)
 *   sell (active invoice)               in_stock|returned|reserved(same bill) → sold
 *   release (cancel / reject / void)    reserved|sold → in_stock
 *   sales return                        sold → returned (restocked, sellable) | damaged (wasted)
 *   purchase return                     in_stock|returned → vendor_returned
 *   stock adjustment                    +: create in_stock   −: in_stock|returned → damaged
 *   void purchase                       in_stock (from that purchase) → deleted
 * Stock equals the count of in_stock + returned + reserved serials per (branch, product);
 * scripts/check-data-duplication.cjs reconciles it (reconcile:serialStock).
 */

import type { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { lockSegment } from "./naturalKeys.js";

export type SerialStatus = "pending_receipt" | "in_stock" | "reserved" | "sold" | "returned" | "damaged" | "vendor_returned" | "in_transit";
const AVAILABLE: ReadonlySet<SerialStatus> = new Set(["in_stock", "returned"]);

export interface SerialLine {
  lineId: string;
  productId: string;
  serials: string[];
}

export type SerialAction =
  | { kind: "receive"; outflowId: string; pending: boolean }
  | { kind: "confirm_receipt"; outflowId: string }
  | { kind: "discard_receipt"; outflowId: string }
  | { kind: "void_receipt"; outflowId: string }
  | { kind: "reserve"; billId: string }
  | { kind: "sell"; billId: string }
  | { kind: "release"; billId: string }
  | { kind: "customer_return"; billId: string; returnId: string; restock: boolean }
  | { kind: "vendor_return"; outflowId: string; returnId: string }
  | { kind: "adjust_in"; adjustmentId: string }
  | { kind: "adjust_out"; adjustmentId: string }
  | { kind: "transfer_dispatch"; transferId: string }
  | { kind: "transfer_receive"; transferId: string; destinationBranchId: string }
  | { kind: "transfer_cancel"; transferId: string };

export function normalizeSerial(serial: string): string {
  return serial.trim().replace(/\s+/g, "").toUpperCase();
}

export function serialRef(organizationId: string, serial: string): FirebaseFirestore.DocumentReference {
  return db.collection("serials").doc(`${organizationId}_${lockSegment(normalizeSerial(serial))}`);
}

const fail = (msg: string, reason = "SERIAL_STATE") => new HttpsError("failed-precondition", `[${reason}] ${msg}`, { reason });

/** Each tracked line must carry exactly `expected` distinct serials (base units). */
export function assertSerialCount(line: SerialLine, expected: number): void {
  const unique = new Set(line.serials.map(normalizeSerial));
  if (!Number.isInteger(expected) || unique.size !== expected || line.serials.length !== expected) {
    throw new HttpsError("invalid-argument", `[SERIALS_REQUIRED] Line ${line.lineId} (product ${line.productId}) needs exactly ${expected} distinct serial number(s); got ${unique.size}.`, { reason: "SERIALS_REQUIRED" });
  }
}

/**
 * Reads and validates the serials for `action` (transaction READ phase). Returns the writer to
 * call in the WRITE phase. Serials are never reused across organizations or products.
 */
export async function prepareSerialsInTxn(
  txn: Transaction,
  p: { organizationId: string; branchId: string; lines: SerialLine[]; action: SerialAction }
): Promise<() => void> {
  const { organizationId, branchId, action } = p;
  const entries = p.lines.flatMap((l) => l.serials.map((s) => ({ line: l, serial: normalizeSerial(s), ref: serialRef(organizationId, s) })));
  if (!entries.length) return () => undefined;
  const snaps = await txn.getAll(...entries.map((e) => e.ref));
  const now = new Date().toISOString();
  const writes: Array<() => void> = [];

  entries.forEach((e, i) => {
    const snap = snaps[i];
    const doc = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    const status = doc?.status as SerialStatus | undefined;
    const label = `Serial "${e.serial}"`;
    if (doc && doc.productId !== e.line.productId) throw fail(`${label} belongs to another product.`, "SERIAL_PRODUCT_MISMATCH");

    switch (action.kind) {
      case "receive":
      case "adjust_in":
        if (doc) throw new HttpsError("already-exists", `[DUPLICATE_NATURAL_KEY] ${label} is already registered (status ${status}).`, { reason: "DUPLICATE_NATURAL_KEY" });
        writes.push(() => txn.create(e.ref, {
          organizationId, serial: e.serial, productId: e.line.productId, branchId,
          status: action.kind === "receive" && action.pending ? "pending_receipt" : "in_stock",
          ...(action.kind === "receive" ? { receivedOutflowId: action.outflowId, receivedLineId: e.line.lineId } : { adjustmentId: action.adjustmentId }),
          createdAt: now, updatedAt: now,
        }));
        return;
      case "confirm_receipt":
      case "discard_receipt":
        if (!doc || status !== "pending_receipt" || doc.receivedOutflowId !== action.outflowId) throw fail(`${label} is not pending receipt on this purchase.`);
        writes.push(() => (action.kind === "confirm_receipt" ? txn.update(e.ref, { status: "in_stock", updatedAt: now }) : txn.delete(e.ref)));
        return;
      case "reserve":
      case "sell": {
        if (!doc) throw fail(`${label} is not in stock (never received).`, "SERIAL_NOT_IN_STOCK");
        if (doc.branchId !== branchId) throw fail(`${label} is held by branch ${doc.branchId}.`, "SERIAL_NOT_IN_STOCK");
        const heldHere = status === "reserved" && doc.holdBillId === action.billId;
        if (!AVAILABLE.has(status as SerialStatus) && !heldHere) throw fail(`${label} is ${status}; it cannot be ${action.kind === "sell" ? "sold" : "reserved"} again.`, "SERIAL_NOT_IN_STOCK");
        writes.push(() => txn.update(e.ref, action.kind === "sell"
          ? { status: "sold", soldBillId: action.billId, soldLineId: e.line.lineId, holdBillId: null, holdLineId: null, updatedAt: now }
          : { status: "reserved", holdBillId: action.billId, holdLineId: e.line.lineId, updatedAt: now }));
        return;
      }
      case "release":
        if (!doc || !((status === "reserved" && doc.holdBillId === action.billId) || (status === "sold" && doc.soldBillId === action.billId))) {
          throw fail(`${label} is not held by this bill.`);
        }
        writes.push(() => txn.update(e.ref, { status: "in_stock", holdBillId: null, holdLineId: null, soldBillId: null, soldLineId: null, updatedAt: now }));
        return;
      case "customer_return":
        if (!doc || status !== "sold" || doc.soldBillId !== action.billId || doc.soldLineId !== e.line.lineId) throw fail(`${label} was not sold on this bill line.`, "SERIAL_NOT_SOLD_HERE");
        writes.push(() => txn.update(e.ref, { status: action.restock ? "returned" : "damaged", branchId, returnId: action.returnId, updatedAt: now }));
        return;
      case "void_receipt":
        if (!doc || !AVAILABLE.has(status as SerialStatus) || doc.receivedOutflowId !== action.outflowId) throw fail(`${label} from this purchase is no longer in stock (${status}); return or adjust it first.`, "SERIAL_NOT_IN_STOCK");
        writes.push(() => txn.delete(e.ref));
        return;
      case "vendor_return":
        if (!doc || !AVAILABLE.has(status as SerialStatus) || doc.receivedOutflowId !== action.outflowId) throw fail(`${label} is not in stock from this purchase.`);
        writes.push(() => txn.update(e.ref, { status: "vendor_returned", returnId: action.returnId, updatedAt: now }));
        return;
      case "adjust_out":
        if (!doc || !AVAILABLE.has(status as SerialStatus) || doc.branchId !== branchId) throw fail(`${label} is not in stock at this branch.`, "SERIAL_NOT_IN_STOCK");
        writes.push(() => txn.update(e.ref, { status: "damaged", adjustmentId: action.adjustmentId, updatedAt: now }));
        return;
      case "transfer_dispatch":
        if (!doc || !AVAILABLE.has(status as SerialStatus) || doc.branchId !== branchId) {
          throw fail(`${label} is not in stock at source branch.`, "SERIAL_NOT_IN_STOCK");
        }
        writes.push(() => txn.update(e.ref, {
          status: "in_transit",
          transferId: action.transferId,
          updatedAt: now,
        }));
        return;
      case "transfer_receive":
        if (!doc || status !== "in_transit" || doc.transferId !== action.transferId) {
          throw fail(`${label} is not in transit on transfer ${action.transferId}.`, "SERIAL_NOT_IN_TRANSIT");
        }
        writes.push(() => txn.update(e.ref, {
          status: "in_stock",
          branchId: action.destinationBranchId,
          transferId: null,
          updatedAt: now,
        }));
        return;
      case "transfer_cancel":
        if (!doc || status !== "in_transit" || doc.transferId !== action.transferId) {
          throw fail(`${label} is not in transit on transfer ${action.transferId}.`);
        }
        writes.push(() => txn.update(e.ref, {
          status: "in_stock",
          transferId: null,
          updatedAt: now,
        }));
        return;
    }
  });
  return () => writes.forEach((w) => w());
}

/** Serials currently attached to a document (registry query; replaces stored line lists). */
export async function serialsOf(organizationId: string, field: "soldBillId" | "holdBillId" | "receivedOutflowId", id: string, txn?: Transaction): Promise<Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>> {
  const q = db.collection("serials").where("organizationId", "==", organizationId).where(field, "==", id);
  const snap = txn ? await txn.get(q) : await q.get();
  return snap.docs.map((d) => ({ ref: d.ref, data: d.data() }));
}

/** Groups registry entries into SerialLines by the given line field. */
export function linesFromRegistry(entries: Array<{ data: Record<string, unknown> }>, lineField: "soldLineId" | "holdLineId" | "receivedLineId"): SerialLine[] {
  const byLine = new Map<string, SerialLine>();
  for (const e of entries) {
    const lineId = e.data[lineField] as string;
    const line = byLine.get(lineId) || { lineId, productId: e.data.productId as string, serials: [] };
    line.serials.push(e.data.serial as string);
    byLine.set(lineId, line);
  }
  return Array.from(byLine.values());
}
