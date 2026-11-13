/**
 * Shadow counter (prompt 66, Part 4): an independent second count of Firestore operations, emulator only.
 *
 * It patches the Admin SDK prototypes directly (DocumentReference, Query, aggregate query, WriteBatch,
 * Transaction, Firestore.getAll / runTransaction), so it does not go through the counting layer
 * (services/meteredFirestore.ts). Only the outermost public call counts (the SDK delegates internally:
 * a document get calls getAll, a document write commits a one-operation batch). At the end of each
 * request services/requestRecorder.ts compares it with the layer's count; a difference is stored on the
 * rollup as `shadowMismatch` and fails the metering test. Meter writes are excluded on both sides.
 */
import { DocumentReference, Firestore, Query, Transaction, WriteBatch } from "firebase-admin/firestore";
import { currentContext, emptyCounts, OpCounts } from "./requestContext.js";

const METER_COLLECTIONS = new Set(["organizationUsageDaily", "userUsageDaily"]);
const isMeterPath = (path: string) => METER_COLLECTIONS.has(path.split("/")[0]);
let depth = 0;

function shadowOf(): OpCounts | null {
  const ctx = currentContext() as (ReturnType<typeof currentContext> & { shadow?: OpCounts }) | undefined;
  if (!ctx) return null;
  ctx.shadow = ctx.shadow || emptyCounts();
  return ctx.shadow;
}
function add(kind: "reads" | "writes" | "deletes", n: number, path = ""): void {
  if (isMeterPath(path)) return;
  const s = shadowOf();
  if (s) s[kind] += n;
}

type Fn = (...args: unknown[]) => unknown;
function patch(proto: object, name: string, after: (self: unknown, args: unknown[], result: unknown) => void): void {
  const original = (proto as Record<string, Fn>)[name];
  if (typeof original !== "function" || (original as { __shadow?: boolean }).__shadow) return;
  const patched = function (this: unknown, ...args: unknown[]) {
    const outer = depth === 0;
    depth++;
    let result: unknown;
    try {
      result = original.apply(this, args);
    } finally {
      depth--;
    }
    if (!outer) return result;
    if (result && typeof (result as Promise<unknown>).then === "function") return (result as Promise<unknown>).then((r) => { after(this, args, r); return r; });
    after(this, args, result);
    return result;
  };
  (patched as unknown as { __shadow: boolean }).__shadow = true;
  (proto as Record<string, Fn>)[name] = patched;
}

const batchWrites = new WeakMap<object, Array<{ kind: "writes" | "deletes"; path: string }>>();
const recordPending = (self: object, kind: "writes" | "deletes", ref: unknown) => {
  const list = batchWrites.get(self) || [];
  list.push({ kind, path: (ref as DocumentReference).path });
  batchWrites.set(self, list);
};

export function installShadowCounter(sample: Firestore): void {
  patch(DocumentReference.prototype, "get", (self) => add("reads", 1, (self as DocumentReference).path));
  for (const op of ["set", "create", "update", "delete"]) {
    patch(DocumentReference.prototype, op, (self) => add(op === "delete" ? "deletes" : "writes", 1, (self as DocumentReference).path));
  }
  // Skipped offset rows are billed reads: read from the query itself.
  patch(Query.prototype, "get", (self, _args, snap) => add("reads", Math.max(1, (snap as { size: number }).size) + (Number((self as { _queryOptions?: { offset?: number } })._queryOptions?.offset) || 0)));
  const aggregateProto = Object.getPrototypeOf(sample.collection("_shadow_probe").count());
  patch(aggregateProto, "get", (_self, _args, snap) => {
    const n = Number((snap as { data: () => { count?: number } }).data().count);
    add("reads", Number.isFinite(n) ? Math.max(1, Math.ceil(n / 1000)) : 1);
  });
  patch(Firestore.prototype, "getAll", (_self, args) => add("reads", args.filter((a) => a instanceof DocumentReference).length));
  for (const op of ["set", "create", "update", "delete"]) {
    const kind = op === "delete" ? "deletes" : "writes";
    for (const proto of [WriteBatch.prototype, Transaction.prototype]) {
      const original = (proto as unknown as Record<string, Fn>)[op];
      if ((original as { __shadowPending?: boolean }).__shadowPending) continue;
      const wrapped = function (this: object, ...args: unknown[]) { if (depth === 0) recordPending(this, kind, args[0]); return original.apply(this, args); };
      (wrapped as unknown as { __shadowPending: boolean }).__shadowPending = true;
      (proto as unknown as Record<string, Fn>)[op] = wrapped;
    }
  }
  patch(WriteBatch.prototype, "commit", (self) => { for (const w of batchWrites.get(self as object) || []) add(w.kind, 1, w.path); batchWrites.delete(self as object); });
  patch(Transaction.prototype, "get", (_self, args, snap) => {
    const target = args[0];
    if (target instanceof DocumentReference) add("reads", 1, target.path);
    else if (snap && typeof (snap as { size?: number }).size === "number") add("reads", Math.max(1, (snap as { size: number }).size));
    else { const n = Number((snap as { data: () => { count?: number } }).data().count); add("reads", Number.isFinite(n) ? Math.max(1, Math.ceil(n / 1000)) : 1); }
  });
  patch(Transaction.prototype, "getAll", (_self, args) => add("reads", args.filter((a) => a instanceof DocumentReference).length));
  // A transaction's writes count once, for the attempt that committed.
  const runTxn = Firestore.prototype.runTransaction as unknown as Fn;
  if (!(runTxn as { __shadow?: boolean }).__shadow) {
    const wrapped = function (this: Firestore, fn: unknown, options?: unknown) {
      let last: object | null = null;
      return (runTxn.call(this, (txn: object) => { if (last) batchWrites.delete(last); last = txn; return (fn as (t: object) => unknown)(txn); }, options) as Promise<unknown>).then((r) => {
        if (last) { for (const w of batchWrites.get(last) || []) add(w.kind, 1, w.path); batchWrites.delete(last); }
        return r;
      });
    };
    (wrapped as unknown as { __shadow: boolean }).__shadow = true;
    (Firestore.prototype as unknown as Record<string, Fn>).runTransaction = wrapped;
  }
}

/** Layer and shadow counts of a finished request, meter excluded; null when they agree. */
export function shadowMismatch(layer: OpCounts, meter: OpCounts, shadow: OpCounts | undefined): string | null {
  if (!shadow) return null;
  const expected = { reads: layer.reads - meter.reads, writes: layer.writes - meter.writes, deletes: layer.deletes - meter.deletes };
  const diff = (["reads", "writes", "deletes"] as const).filter((k) => expected[k] !== shadow[k]);
  return diff.length ? diff.map((k) => `${k}: layer ${expected[k]} vs shadow ${shadow[k]}`).join(", ") : null;
}
