/**
 * Usage and cost reading (prompt 66, Part 7): one place that reads the cost rollups and prices them.
 *
 * Rollups hold quantities only (D-22, services/requestRecorder.ts). Cost is derived here, when read,
 * from the rate card in force (services/usageMetering.ts), and every answer carries the rate-card
 * version, whether each price is verified, and what the numbers include and exclude (matrix 2.1).
 * Reading costs reads too: one per day document in the range (organization) plus one per user-day.
 */
import { db } from "./firebase.js";
import { UsageRateCardDoc } from "../types/models.js";

export interface OpTotals { reads: number; writes: number; deletes: number; aggregationReads?: number }
export interface UsageTotals {
  calls: number;
  errors: number;
  denied: number;
  durationMsSum: number;
  bytesIn: number;
  bytesOut: number;
  redundantReads: number;
  ops: OpTotals;
  byCategory: Record<string, OpTotals>;
  byCallable: Record<string, OpTotals & { calls: number }>;
  byCollection: Record<string, OpTotals>;
  hourly: Record<string, OpTotals & { calls: number }>;
  targets?: Record<string, OpTotals & { calls: number }>;
}

type Tree = Record<string, unknown>;
const NUMERIC_TREES = ["ops", "byCategory", "byCallable", "byCollection", "hourly", "targets", "devices"];

function addTree(into: Tree, from: Tree): void {
  for (const [k, v] of Object.entries(from || {})) {
    if (typeof v === "number") into[k] = ((into[k] as number) || 0) + v;
    else if (v && typeof v === "object" && !Array.isArray(v) && !(v as { toDate?: unknown }).toDate) addTree((into[k] = (into[k] as Tree) || {}), v as Tree);
  }
}

export function emptyTotals(): UsageTotals {
  return { calls: 0, errors: 0, denied: 0, durationMsSum: 0, bytesIn: 0, bytesOut: 0, redundantReads: 0, ops: { reads: 0, writes: 0, deletes: 0 }, byCategory: {}, byCallable: {}, byCollection: {}, hourly: {} };
}

/** Sums rollup documents (organization × day or organization × user × day). */
export function sumRollups(docs: Tree[]): UsageTotals {
  const total = emptyTotals() as unknown as Tree;
  for (const d of docs) {
    for (const k of ["calls", "errors", "denied", "durationMsSum", "bytesIn", "bytesOut", "redundantReads"]) total[k] = ((total[k] as number) || 0) + (Number(d[k]) || 0);
    for (const k of NUMERIC_TREES) if (d[k]) addTree((total[k] = (total[k] as Tree) || {}), d[k] as Tree);
  }
  return total as unknown as UsageTotals;
}

export async function readRollups(collection: "organizationUsageDaily" | "userUsageDaily", filter: { organizationId?: string; uid?: string; startDate: string; endDate: string; limit?: number }): Promise<Tree[]> {
  let q: FirebaseFirestore.Query = db.collection(collection);
  if (filter.organizationId) q = q.where("organizationId", "==", filter.organizationId);
  if (filter.uid) q = q.where("uid", "==", filter.uid);
  q = q.where("date", ">=", filter.startDate).where("date", "<=", filter.endDate);
  const snap = await q.limit(filter.limit ?? 1000).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** What the numbers are made of (prompt 66 §2.1), returned with every answer. */
export const COVERAGE = {
  metered: [
    "Firestore reads, writes and deletes made by this backend (counted at the data-access layer)",
    "gate reads, audit writes and meter writes (byCategory gate / audit / meter: the overhead)",
    "trigger and scheduled-job operations (attributed to the organization of the document; scheduled work to the platform)",
  ],
  estimated: [
    "Cloud Functions compute: durationMs × configured memory, an upper bound (concurrency shares an instance)",
    "egress: response bytes (only billable egress is charged)",
  ],
  excluded: [
    "client-direct reads allowed by the rules (own profile, devices, memberships, notifications, plans, catalogs) and Storage downloads",
    "Firestore and Cloud Storage stored bytes (no stored-bytes measurement yet)",
    "Auth, SMS, Hosting, Cloud Scheduler, Pub/Sub, Cloud Logging and platform admin work outside callables",
    "the project free allowance (project level, shown separately, not allocated to organizations)",
  ],
  note: "Firebase bills the project, not organizations: these are estimates from operations counted by this backend × the rate card, to be reconciled against the Cloud Billing export (cloud-only).",
};

const MEMORY_GIB = Number(process.env.FUNCTIONS_MEMORY_GIB || 0.25); // v2 callable default 256 MiB

/** Cost per SKU from quantities and the rate card (D-22); `verified` only when every price used is. */
export function estimateCost(t: UsageTotals, card: UsageRateCardDoc) {
  const r = card.rates;
  const v = card.verification || {};
  const line = (sku: keyof UsageRateCardDoc["rates"], quantity: number, perUnits: number, unit: string) => ({
    sku, unit, quantity, unitPrice: r[sku], cost: Math.round((quantity / perUnits) * r[sku] * 10000) / 10000,
    verified: v[sku]?.verified === true, source: v[sku]?.source ?? null, verifiedAt: v[sku]?.verifiedAt ?? null,
  });
  const lines = [
    line("firestoreReadPer100k", t.ops.reads, 100_000, "document reads"),
    line("firestoreWritePer100k", t.ops.writes, 100_000, "document writes"),
    line("firestoreDeletePer100k", t.ops.deletes, 100_000, "document deletes"),
    line("functionsInvocationPerMillion", t.calls, 1_000_000, "invocations"),
    line("functionsComputeGbSecond", (t.durationMsSum / 1000) * MEMORY_GIB, 1, "GiB-seconds (upper bound)"),
  ];
  const total = Math.round(lines.reduce((s, l) => s + l.cost, 0) * 100) / 100;
  return { currency: card.currency, rateCardVersion: card.version, verified: lines.every((l) => l.verified), total, lines, label: "estimate" };
}

/** Top `n` entries of a {name → counts} map by reads + writes + deletes. */
export function top<T extends OpTotals>(map: Record<string, T> | undefined, n: number): Array<{ name: string } & T> {
  return Object.entries(map || {}).map(([name, c]) => ({ name, ...c })).sort((a, b) => (b.reads + b.writes + b.deletes) - (a.reads + a.writes + a.deletes)).slice(0, n);
}
