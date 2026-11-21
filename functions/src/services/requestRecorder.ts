/**
 * End of a request (prompt 66, Parts 5 and 6): the operation counts of the finished RequestContext go
 * into the cost rollups, quantities only (D-22).
 *
 *   organizationUsageDaily/{org}_{utcDate}          organization × day (reused, design DD-5)
 *   userUsageDaily/{org}_{uid}_{utcDate}            organization × user × day
 *
 * Content: `ops` (reads, writes, deletes, aggregationReads) total and `byCategory` (gate / app / audit /
 * meter); `calls`, `errors`, `denied`; `durationMsSum`, `bytesIn`, `bytesOut`; `byCallable`; `byCollection`
 * (collection templates, bounded, overflow `other`); `hourly` ("00".."23" → calls and ops); per user
 * `devices`. Platform work is stored under organization "platform" with `targets.{orgId}` (D-21).
 *
 * Flush (design DD-6): `exact` writes before the response (default in the emulator and tests);
 * `batched` (default in the cloud) accumulates per document and writes when the oldest entry is
 * METER_FLUSH_SECONDS old or METER_FLUSH_CALLS calls accumulated, and on SIGTERM. Meter writes use the
 * raw SDK and count themselves into the increments they write (byCategory.meter.writes).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { RequestContext, OpCounts } from "./requestContext.js";
import { rawDb } from "./meteredFirestore.js";
import { shadowMismatch } from "./shadowCounter.js";
import { recordRequestEvent } from "./auditRecorder.js";

export interface FinishInfo {
  outcome: "success" | "denied" | "failed";
  reason: string | null;
  result: unknown;
}

const MODE = process.env.METER_FLUSH_MODE || (process.env.FUNCTIONS_EMULATOR === "true" ? "exact" : "batched");
const FLUSH_SECONDS = Number(process.env.METER_FLUSH_SECONDS || 30);
const FLUSH_CALLS = Number(process.env.METER_FLUSH_CALLS || 100);
const RETENTION_MONTHS = Number(process.env.METER_RETENTION_MONTHS || 25);
const MAX_COLLECTION_KEYS = 60;
const MAX_DEVICE_KEYS = 20;

type Tree = { [key: string]: number | Tree };

interface Pending {
  path: string;
  tree: Tree;
  calls: number;
  firstAt: number;
  base: Record<string, unknown>;
}
const pending = new Map<string, Pending>();

function add(tree: Tree, keys: string[], n: number): void {
  if (!n) return;
  let node = tree;
  for (const k of keys.slice(0, -1)) node = (node[k] = (node[k] as Tree) || {}) as Tree;
  const leaf = keys[keys.length - 1];
  node[leaf] = ((node[leaf] as number) || 0) + n;
}
const addOps = (tree: Tree, prefix: string[], c: Pick<OpCounts, "reads" | "writes" | "deletes"> & Partial<OpCounts>) => {
  add(tree, [...prefix, "reads"], c.reads);
  add(tree, [...prefix, "writes"], c.writes);
  add(tree, [...prefix, "deletes"], c.deletes);
  if (c.aggregationReads) add(tree, [...prefix, "aggregationReads"], c.aggregationReads);
};
const bounded = (tree: Tree, key: string, map: string, max: number) => (tree[map] && Object.keys(tree[map] as Tree).length >= max && !(tree[map] as Tree)[key] ? "other" : key);

function bytes(value: unknown): number {
  try { return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value)); } catch { return 0; }
}

/** The quantities one request adds to one rollup document. */
function contribution(tree: Tree, ctx: RequestContext, info: FinishInfo, durationMs: number, bytesIn: number, forUser: boolean): void {
  const o = ctx.ops;
  add(tree, ["calls"], 1);
  if (info.outcome === "failed") add(tree, ["errors"], 1);
  if (info.outcome === "denied") add(tree, ["denied"], 1);
  add(tree, ["durationMsSum"], durationMs);
  add(tree, ["bytesIn"], bytesIn);
  add(tree, ["bytesOut"], bytes(info.result));
  addOps(tree, ["ops"], o.total);
  for (const [cat, c] of Object.entries(o.byCategory)) addOps(tree, ["byCategory", cat], c);
  const name = ctx.source.name;
  add(tree, ["byCallable", name, "calls"], 1);
  addOps(tree, ["byCallable", name], o.total);
  for (const [template, c] of Object.entries(o.byCollection)) addOps(tree, ["byCollection", bounded(tree, template, "byCollection", MAX_COLLECTION_KEYS)], c);
  const hour = String(ctx.startedAt.getUTCHours()).padStart(2, "0");
  add(tree, ["hourly", hour, "calls"], 1);
  addOps(tree, ["hourly", hour], o.total);
  if (ctx.redundantReads) add(tree, ["redundantReads"], ctx.redundantReads);
  if (forUser && ctx.device.deviceId) add(tree, ["devices", bounded(tree, ctx.device.deviceId, "devices", MAX_DEVICE_KEYS), "calls"], 1);
  if (ctx.organizationId === "platform" && ctx.targetOrgId) {
    add(tree, ["targets", ctx.targetOrgId, "calls"], 1);
    addOps(tree, ["targets", ctx.targetOrgId], o.total);
  }
}

const toIncrements = (tree: Tree): Record<string, unknown> =>
  Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, typeof v === "number" ? FieldValue.increment(v) : toIncrements(v)]));

function expireAt(from: Date): Timestamp {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + RETENTION_MONTHS);
  return Timestamp.fromDate(d);
}

async function flushKeys(keys: string[]): Promise<void> {
  const entries = keys.map((k) => pending.get(k)).filter((p): p is Pending => !!p);
  for (const k of keys) pending.delete(k);
  if (!entries.length) return;
  const batch = rawDb().batch();
  // The meter's own writes are part of what it records: the organization document carries every meter
  // write of the flush for that organization (its own and its users'), a user document its own.
  const perOrg = new Map<string, number>();
  for (const p of entries) perOrg.set(String(p.base.organizationId), (perOrg.get(String(p.base.organizationId)) || 0) + 1);
  for (const p of entries) {
    const own = p.base.uid ? 1 : perOrg.get(String(p.base.organizationId)) || 1;
    addOps(p.tree, ["ops"], { reads: 0, writes: own, deletes: 0 });
    addOps(p.tree, ["byCategory", "meter"], { reads: 0, writes: own, deletes: 0 });
    batch.set(rawDb().doc(p.path), { ...p.base, ...toIncrements(p.tree), lastSeenAt: FieldValue.serverTimestamp(), expireAt: expireAt(new Date(p.firstAt)) }, { merge: true });
  }
  await batch.commit();
}

/** Flush everything accumulated (SIGTERM, tests, `exact` mode). */
export async function flushMeter(): Promise<void> {
  await flushKeys([...pending.keys()]);
}

let timer: NodeJS.Timeout | null = null;
function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const now = Date.now();
    flushKeys([...pending.values()].filter((p) => now - p.firstAt >= FLUSH_SECONDS * 1000).map((p) => p.path))
      .catch((e) => console.error("[meter] flush failed", e))
      .finally(() => { if (pending.size) schedule(); });
  }, FLUSH_SECONDS * 1000);
  timer.unref();
}
process.once("SIGTERM", () => { flushMeter().catch((e) => console.error("[meter] SIGTERM flush failed", e)); });

function accumulate(path: string, base: Record<string, unknown>, fill: (tree: Tree) => void): void {
  const p = pending.get(path) || { path, tree: {}, calls: 0, firstAt: Date.now(), base };
  fill(p.tree);
  p.calls++;
  pending.set(path, p);
}

export async function finishRequest(ctx: RequestContext, info: FinishInfo): Promise<void> {
  // The request's audit event (if any) is counted synchronously, then written in parallel with the meter.
  const audit = recordRequestEvent(ctx, info.outcome, info.reason).catch((e) => console.error("[audit] could not record request event", e));
  try {
    const durationMs = Date.now() - ctx.startedAt.getTime();
    const org = ctx.organizationId || "platform";
    const day = ctx.utcDate;
    const orgPath = `organizationUsageDaily/${org}_${day}`;
    const mismatch = shadowMismatch(ctx.ops.total, ctx.ops.byCategory.meter, (ctx as RequestContext & { shadow?: OpCounts }).shadow);
    accumulate(orgPath, { organizationId: org, date: day }, (t) => { contribution(t, ctx, info, durationMs, ctx.bytesIn, false); if ((ctx as RequestContext & { shadow?: OpCounts }).shadow) add(t, ["shadowChecked"], 1); if (mismatch) add(t, ["shadowMismatch"], 1); });
    if (mismatch) { pending.get(orgPath)!.base.shadowMismatchLast = `${ctx.source.name}: ${mismatch}`; console.error(`[meter] shadow mismatch in ${ctx.source.name}: ${mismatch}`); }
    const touched = [orgPath];
    if (ctx.actor.uid) {
      const userPath = `userUsageDaily/${org}_${ctx.actor.uid}_${day}`;
      accumulate(userPath, { organizationId: org, uid: ctx.actor.uid, date: day }, (t) => contribution(t, ctx, info, durationMs, ctx.bytesIn, true));
      touched.push(userPath);
    }
    if (REQUEST_LOG) logRequest(ctx, info, durationMs);
    if (MODE === "exact") await flushKeys(touched);
    else if (touched.some((k) => (pending.get(k)?.calls || 0) >= FLUSH_CALLS)) await flushKeys(touched);
    else schedule();
  } catch (e) {
    // Metering never fails a request; the loss is visible as reconciliation residual.
    console.error("[meter] could not record request", e);
  }
  await audit;
}

/**
 * Emulator only: one line per request in .local/request-ops/{source}.jsonl, the per-call distribution
 * the rollups (sums) cannot give: read by scripts/generate-api-cost-profile.js and check-cost-budgets.
 */
const REQUEST_LOG = process.env.FUNCTIONS_EMULATOR === "true" && process.env.METER_REQUEST_LOG !== "false";
const REQUEST_LOG_DIR = path.resolve(process.cwd(), process.cwd().endsWith("functions") ? ".." : ".", ".local", "request-ops");
function logRequest(ctx: RequestContext, info: FinishInfo, durationMs: number): void {
  try {
    fs.mkdirSync(REQUEST_LOG_DIR, { recursive: true });
    const line = { source: ctx.source.kind, name: ctx.source.name, unit: process.env.VERIFY_UNIT || null, outcome: info.outcome, reason: info.reason, ops: ctx.ops.total, byCategory: ctx.ops.byCategory, redundantReads: ctx.redundantReads, durationMs, bytesOut: bytes(info.result), at: ctx.startedAt.toISOString() };
    fs.appendFileSync(path.join(REQUEST_LOG_DIR, `${ctx.source.name.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`), `${JSON.stringify(line)}\n`);
  } catch {
    // a development aid only
  }
}

