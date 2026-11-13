/**
 * The one counting layer (prompt 66, Part 4; design DD-3).
 *
 * `instrument(firestore)` returns a Proxy over the Admin Firestore that every production module uses
 * (services/firebase.ts exports it as `db`). References, queries, aggregations, batches and transactions
 * handed out by it are proxies too; the SDK receives the unwrapped originals. Every operation is counted
 * into the current RequestContext by the rules below (prompt 66 §2.2; verified against the Firestore
 * pricing page is listed in docs/reference/rate-card.md):
 *
 *   document get (also of a missing document)   1 read
 *   query get                                   documents returned, minimum 1; skipped offset rows are reads
 *   getAll(refs)                                1 read per reference
 *   count() / aggregate                         ceil(count / 1000) reads, minimum 1
 *   set / create / update                       1 write each        delete   1 delete
 *   batch, transaction                          each operation; a transaction's reads are counted per
 *                                               attempt, its writes once, when it commits
 *   failed writes                               not counted (verified: false)
 *
 * Writes outside a batch or transaction run as a one-operation batch, so `commitHook` (the audit
 * recorder, services/auditRecorder.ts) can add its event to the same commit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { DocumentData, DocumentReference, Firestore, Query, Transaction, WriteBatch } from "firebase-admin/firestore";
import { currentContext, collectionTemplate, emptyCounts, OpCategory, OpCounts } from "./requestContext.js";

export interface PendingWrite {
  path: string;
  kind: "set" | "create" | "update" | "delete";
  data?: DocumentData;
  merge?: boolean;
}

/** Called once per commit with the writes it carries; `append` adds a write to the same commit. */
export type CommitHook = (writes: PendingWrite[], append: (path: string, data: DocumentData) => void, before: Map<string, DocumentData | undefined>) => void;

let commitHook: CommitHook | null = null;
export function setCommitHook(hook: CommitHook | null): void {
  commitHook = hook;
}

/** Collections whose writes are overhead, not business operations. */
const CATEGORY_OF_COLLECTION: Record<string, OpCategory> = {
  auditLogs: "audit",
  organizationUsageDaily: "meter",
  userUsageDaily: "meter",
};

/** Operations with no RequestContext: an error in the emulator (tripwire), counted here elsewhere. */
export const unattributed: OpCounts = emptyCounts();
let warnedUnattributed = false;

function count(path: string, kind: "reads" | "writes" | "deletes", n: number, aggregation = false): void {
  if (n <= 0) return;
  const ctx = currentContext();
  const add = (c: OpCounts) => {
    c[kind] += n;
    if (aggregation) c.aggregationReads += n;
  };
  if (!ctx) {
    if (process.env.FUNCTIONS_EMULATOR === "true" && process.env.METER_ALLOW_UNATTRIBUTED !== "true") {
      throw new Error(`[meter] Firestore ${kind} on ${path} outside a RequestContext (open one with runInContext / runAsSystem)`);
    }
    add(unattributed);
    if (!warnedUnattributed) { warnedUnattributed = true; console.warn(`[meter] Firestore operation outside a RequestContext (${path}); counted as unattributed`); }
    return;
  }
  const collectionPath = path.split("/").length % 2 === 0 ? path.split("/").slice(0, -1).join("/") : path;
  const template = collectionTemplate(collectionPath);
  // Writes to the audit and meter collections are overhead; reading them (a user browsing the trail) is not.
  const category = (kind !== "reads" && CATEGORY_OF_COLLECTION[collectionPath.split("/")[0]]) || ctx.category;
  add(ctx.ops.total);
  add(ctx.ops.byCategory[category]);
  add((ctx.ops.byCollection[template] = ctx.ops.byCollection[template] || emptyCounts()));
}

const MAX_READ_DATA = 500;
function noteRead(path: string, data?: DocumentData): void {
  const ctx = currentContext();
  if (!ctx) return;
  if (ctx.readPaths.has(path)) ctx.redundantReads++;
  else ctx.readPaths.add(path);
  if (ctx.readData.size < MAX_READ_DATA || ctx.readData.has(path)) ctx.readData.set(path, data);
}
function noteWrite(path: string): void {
  currentContext()?.readPaths.delete(path);
}

// ---------------------------------------------------------------------------
// Proxies
// ---------------------------------------------------------------------------

const RAW = Symbol("raw");

type Wrapped = { [RAW]?: unknown };
export function unwrap<T>(value: T): T {
  return value && typeof value === "object" && (value as Wrapped)[RAW] ? ((value as Wrapped)[RAW] as T) : value;
}
const unwrapArgs = (args: unknown[]) => args.map((a) => (Array.isArray(a) ? a.map(unwrap) : unwrap(a)));

const isRefOrQuery = (v: unknown): boolean => !!v && typeof v === "object" && ["DocumentReference", "CollectionReference", "Query", "CollectionGroup"].includes((v as object).constructor?.name);
const isDocRef = (v: unknown): v is DocumentReference => !!v && typeof v === "object" && (v as object).constructor?.name === "DocumentReference";
const queryPath = (q: Query): string => {
  const raw = q as unknown as { path?: string; _queryOptions?: { collectionId?: string; parentPath?: { relativeName?: string } } };
  if (typeof raw.path === "string") return raw.path;
  const id = raw._queryOptions?.collectionId || "unknown";
  const parent = raw._queryOptions?.parentPath?.relativeName || "";
  return parent ? `${parent}/${id}` : id;
};

function wrapRefOrQuery<T extends object>(target: T, offset = 0, shape: QueryShape = { group: false, clauses: [] }): T {
  return new Proxy(target, {
    get(t, key) {
      if (key === RAW) return t;
      const value = Reflect.get(t, key, t);
      if (typeof value !== "function") return isRefOrQuery(value) ? wrapRefOrQuery(value as object) : value;
      return (...args: unknown[]) => {
        const a = unwrapArgs(args);
        if (key === "get") {
          if (isDocRef(t)) {
            const path = (t as unknown as DocumentReference).path;
            return (value as (...x: unknown[]) => Promise<{ exists: boolean; data: () => DocumentData | undefined }>).apply(t, a).then((snap) => { count(path, "reads", 1); noteRead(path, snap.exists ? snap.data() : undefined); return snap; });
          }
          const path = queryPath(t as unknown as Query);
          recordShape(path, shape);
          return (value as (...x: unknown[]) => Promise<{ size: number; docs: Array<{ ref: DocumentReference; data: () => DocumentData }> }>).apply(t, a).then((snap) => {
            count(path, "reads", Math.max(1, snap.size) + offset);
            for (const d of snap.docs) noteRead(d.ref.path, d.data());
            return snap;
          });
        }
        if (isDocRef(t) && ["set", "create", "update", "delete"].includes(key as string)) {
          return singleWrite(t as unknown as DocumentReference, key as PendingWrite["kind"], a);
        }
        if (key === "add") {
          const ref = (t as unknown as { doc: () => DocumentReference }).doc();
          return singleWrite(ref, "create", a).then(() => wrapRefOrQuery(ref));
        }
        if (key === "count" || key === "aggregate") return wrapAggregate(value.apply(t, a) as object, queryPath(t as unknown as Query));
        const result = value.apply(t, a);
        if (key === "offset") return wrapRefOrQuery(result as object, Number(a[0]) || 0, shape);
        const next = key === "where" && a.length >= 2 ? { ...shape, clauses: [...shape.clauses, { field: String(a[0]), op: String(a[1]) }] }
          : key === "orderBy" ? { ...shape, clauses: [...shape.clauses, { field: String(a[0]), op: a[1] === "desc" ? "order:desc" : "order:asc" }] }
          : shape;
        return isRefOrQuery(result) ? wrapRefOrQuery(result as object, offset, next) : result;
      };
    },
  });
}

function wrapAggregate<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(t, key) {
      if (key === RAW) return t;
      const value = Reflect.get(t, key, t);
      if (key !== "get" || typeof value !== "function") return typeof value === "function" ? value.bind(t) : value;
      return (...args: unknown[]) => (value as (...x: unknown[]) => Promise<{ data: () => Record<string, unknown> }>).apply(t, unwrapArgs(args)).then((snap) => {
        const n = Number(snap.data().count);
        count(path, "reads", Number.isFinite(n) ? Math.max(1, Math.ceil(n / 1000)) : 1, true);
        return snap;
      });
    },
  });
}

/** The clauses of a query, for the index guard (scripts/check-firestore-indexes.js). */
interface QueryShape { group: boolean; clauses: Array<{ field: string; op: string }> }

/** Emulator only: every distinct query shape executed, in .local/query-shapes.jsonl (the emulator never enforces composite indexes). */
const SHAPE_LOG = process.env.FUNCTIONS_EMULATOR === "true" ? path.resolve(process.cwd(), process.cwd().endsWith("functions") ? ".." : ".", ".local", "query-shapes.jsonl") : null;
const seenShapes = new Set<string>();
function recordShape(collectionPath: string, shape: QueryShape): void {
  if (!SHAPE_LOG || !shape.clauses.length) return;
  const line = JSON.stringify({ collectionGroup: collectionPath.split("/").pop(), group: shape.group, clauses: shape.clauses, source: currentContext()?.source.name ?? null });
  if (seenShapes.has(line)) return;
  seenShapes.add(line);
  try { fs.mkdirSync(path.dirname(SHAPE_LOG), { recursive: true }); fs.appendFileSync(SHAPE_LOG, `${line}\n`); } catch { /* a development aid only */ }
}

let rawFirestore: Firestore;

function pendingFrom(kind: PendingWrite["kind"], args: unknown[]): PendingWrite {
  const ref = args[0] as DocumentReference;
  const data = kind === "delete" ? undefined : (args[1] as DocumentData);
  const merge = kind === "set" && !!(args[2] && typeof args[2] === "object" && ((args[2] as { merge?: boolean }).merge || (args[2] as { mergeFields?: unknown }).mergeFields));
  return { path: ref.path, kind, data, merge };
}

function countWrites(writes: PendingWrite[]): void {
  for (const w of writes) {
    count(w.path, w.kind === "delete" ? "deletes" : "writes", 1);
    noteWrite(w.path);
  }
}

/** Gives the commit hook its chance, then returns the extra writes it appended. */
function runHook(writes: PendingWrite[], before: Map<string, DocumentData | undefined>): Array<{ path: string; data: DocumentData }> {
  const extra: Array<{ path: string; data: DocumentData }> = [];
  if (commitHook && writes.length) commitHook(writes, (path, data) => extra.push({ path, data }), before);
  return extra;
}

/** A write outside a batch or transaction: one-operation batch, so an audit event can join the commit. */
async function singleWrite(ref: DocumentReference, kind: PendingWrite["kind"], args: unknown[]): Promise<unknown> {
  const write = pendingFrom(kind, [ref, ...args]);
  const extra = runHook([write], new Map());
  if (!extra.length) {
    const fn = (ref as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[kind];
    const result = await fn.apply(ref, args);
    countWrites([write]);
    return result;
  }
  const batch = rawFirestore.batch();
  (batch as unknown as Record<string, (...x: unknown[]) => unknown>)[kind](ref, ...args);
  for (const e of extra) batch.set(rawFirestore.doc(e.path), e.data);
  const results = await batch.commit();
  countWrites([write, ...extra.map((e) => ({ path: e.path, kind: "set" as const }))]);
  return results[0];
}

function wrapBatch(batch: WriteBatch): WriteBatch {
  const pending: PendingWrite[] = [];
  const proxy: WriteBatch = new Proxy(batch, {
    get(t, key) {
      if (key === RAW) return t;
      const value = Reflect.get(t, key, t);
      if (typeof value !== "function") return value;
      if (["set", "create", "update", "delete"].includes(key as string)) {
        return (...args: unknown[]) => {
          const a = unwrapArgs(args);
          pending.push(pendingFrom(key as PendingWrite["kind"], a));
          value.apply(t, a);
          return proxy;
        };
      }
      if (key === "commit") {
        return async (...args: unknown[]) => {
          const extra = runHook(pending, new Map());
          for (const e of extra) t.set(rawFirestore.doc(e.path), e.data);
          const result = await value.apply(t, args);
          countWrites([...pending, ...extra.map((e) => ({ path: e.path, kind: "set" as const }))]);
          return result;
        };
      }
      return value.bind(t);
    },
  });
  return proxy;
}

function wrapTransaction(txn: Transaction, pending: PendingWrite[], before: Map<string, DocumentData | undefined>): Transaction {
  const proxy: Transaction = new Proxy(txn, {
    get(t, key) {
      if (key === RAW) return t;
      const value = Reflect.get(t, key, t);
      if (typeof value !== "function") return value;
      if (key === "get") {
        return (...args: unknown[]) => {
          const [target, ...rest] = unwrapArgs(args);
          return (value as (...x: unknown[]) => Promise<unknown>).apply(t, [target, ...rest]).then((snap) => {
            if (isDocRef(target)) {
              const s = snap as { exists: boolean; data: () => DocumentData | undefined };
              count(target.path, "reads", 1);
              before.set(target.path, s.exists ? s.data() : undefined);
            } else if ((target as object).constructor?.name === "AggregateQuery") {
              const n = Number((snap as { data: () => Record<string, unknown> }).data().count);
              count("aggregate", "reads", Number.isFinite(n) ? Math.max(1, Math.ceil(n / 1000)) : 1, true);
            } else {
              const qs = snap as { size: number; docs: Array<{ ref: DocumentReference; data: () => DocumentData }> };
              count(queryPath(target as Query), "reads", Math.max(1, qs.size));
              for (const d of qs.docs) before.set(d.ref.path, d.data());
            }
            return snap;
          });
        };
      }
      if (key === "getAll") {
        return (...args: unknown[]) => {
          const a = unwrapArgs(args);
          const refs = a.filter(isDocRef);
          return (value as (...x: unknown[]) => Promise<Array<{ exists: boolean; ref: DocumentReference; data: () => DocumentData | undefined }>>).apply(t, a).then((snaps) => {
            for (const r of refs) count(r.path, "reads", 1);
            for (const s of snaps) before.set(s.ref.path, s.exists ? s.data() : undefined);
            return snaps;
          });
        };
      }
      if (["set", "create", "update", "delete"].includes(key as string)) {
        return (...args: unknown[]) => {
          const a = unwrapArgs(args);
          pending.push(pendingFrom(key as PendingWrite["kind"], a));
          value.apply(t, a);
          return proxy;
        };
      }
      return value.bind(t);
    },
  });
  return proxy;
}

/** Wraps the Admin Firestore. Idempotent: an already instrumented instance is returned as is. */
export function instrument(firestore: Firestore): Firestore {
  if ((firestore as unknown as Wrapped)[RAW]) return firestore;
  rawFirestore = firestore;
  return new Proxy(firestore, {
    get(t, key) {
      if (key === RAW) return t;
      const value = Reflect.get(t, key, t);
      if (typeof value !== "function") return value;
      if (key === "collection" || key === "doc" || key === "collectionGroup") return (...args: unknown[]) => wrapRefOrQuery(value.apply(t, unwrapArgs(args)) as object, 0, { group: key === "collectionGroup", clauses: [] });
      if (key === "batch") return () => wrapBatch(value.apply(t, []) as WriteBatch);
      if (key === "getAll") {
        return (...args: unknown[]) => {
          const a = unwrapArgs(args);
          const refs = a.filter(isDocRef);
          return (value as (...x: unknown[]) => Promise<Array<{ ref: DocumentReference; exists: boolean; data: () => DocumentData | undefined }>>).apply(t, a).then((snaps) => {
            for (const r of refs) count(r.path, "reads", 1);
            for (const sn of snaps) noteRead(sn.ref.path, sn.exists ? sn.data() : undefined);
            return snaps;
          });
        };
      }
      if (key === "runTransaction") {
        return <T>(fn: (txn: Transaction) => Promise<T>, options?: unknown) => {
          let pending: PendingWrite[] = [];
          let attempt = 0;
          const run = (value as (f: (txn: Transaction) => Promise<T>, o?: unknown) => Promise<T>).call(t, async (txn: Transaction) => {
            attempt++;
            pending = []; // an aborted attempt's writes were never committed; its reads were billed
            const before = new Map<string, DocumentData | undefined>();
            const result = await fn(wrapTransaction(txn, pending, before));
            for (const e of runHook(pending, before)) { txn.set(t.doc(e.path), e.data); pending.push({ path: e.path, kind: "set" }); }
            return result;
          }, options);
          return run.then((result) => {
            countWrites(pending);
            const ctx = currentContext();
            if (ctx && attempt > 1) ctx.auditNotes.transactionRetries = Number(ctx.auditNotes.transactionRetries || 0) + attempt - 1;
            return result;
          });
        };
      }
      return value.bind(t);
    },
  });
}

/** For tests: the unwrapped SDK instance (shadow counter, snapshot diffs). */
export function rawDb(): Firestore {
  return rawFirestore;
}

