/**
 * The one audit recording point (prompt 66, Part 6; D-23, D-24, D-27).
 *
 * Mutations: the counting layer calls `recordCommitEvent` for every commit (transaction, batch or single
 * write) and the event `auditLogs/{requestId}_{seq}` joins that commit, so a mutation never commits
 * without its event and an event never exists without its mutation. The event is built from the commit's
 * writes, the action registry (constants/auditRegistry.ts, generated) and the request: no handler writes
 * audit. Before-values come only from documents the request already read (6.4), never from an extra read.
 *
 * Not tied to a commit: denied and failed requests (category security / outcome failed, rate-limited per
 * actor and reason), and successful export, auth, file and sensitive-read requests: `recordRequestEvent`
 * at the end of the request.
 */
import { DocumentData, Timestamp } from "firebase-admin/firestore";
import { AUDIT_REGISTRY, AuditCategory } from "../constants/auditRegistry.js";
import { RequestContext, currentContext, collectionTemplate } from "./requestContext.js";
import { PendingWrite, rawDb } from "./meteredFirestore.js";

/**
 * Not business state, so not audit targets (the completeness proof uses the same list): the audit and
 * meter collections themselves, locks, counters and idempotency records written around a mutation,
 * delivery queues, and R3 rollups recomputed by the reconcile callables.
 */
export const AUDIT_EXCLUDED_COLLECTIONS: Record<string, string> = {
  auditLogs: "the audit trail itself",
  organizationUsageDaily: "cost rollup (meter)",
  userUsageDaily: "cost rollup (meter)",
  organizationUsageMonthly: "client-reported usage rollup",
  branchUsageDaily: "client-reported usage rollup",
  branchUsageMonthly: "client-reported usage rollup",
  usageCounterShards: "plan-limit call counters",
  idempotencyRecords: "replay cache of the request",
  uniqueKeys: "natural-key lock written with the entity",
  documentCounters: "document-number counter written with the document",
  counters: "document sequence counters written with the document",
  notificationOutbox: "delivery queue",
  notifications: "message to a user, not business state",
  dailySummaries: "R3 rollup, recomputed by reconcile",
  monthlySummaries: "R3 rollup, recomputed by reconcile",
};

/** D-27 redaction, by field name anywhere in a value. */
const DROP = new Set(["password", "initialpassword", "temporarypassword", "token", "fcmtoken", "idtoken", "refreshtoken", "accesstoken", "secret", "credential", "authorization"]);
const LAST4 = new Set(["accountnumber", "iban"]);
const MASK = new Set(["taxid", "pan", "licencenumber", "registrationnumber", "salary", "upiid"]);
const MAX_CHANGES_BYTES = 8 * 1024;
const RETENTION_MONTHS = Number(process.env.AUDIT_RETENTION_MONTHS || 24);
const SYSTEM_FIELDS = new Set(["updatedAt", "updatedBy"]);

type Json = unknown;

export function redact(value: Json, redacted: string[], at = ""): Json {
  if (Array.isArray(value)) return value.map((v, i) => redact(v, redacted, `${at}[${i}]`));
  if (!value || typeof value !== "object" || value instanceof Timestamp || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    const path = at ? `${at}.${k}` : k;
    if (DROP.has(key)) { redacted.push(path); continue; }
    if (LAST4.has(key) && typeof v === "string") { out[k] = `••••${v.slice(-4)}`; redacted.push(path); continue; }
    if (MASK.has(key) && v !== null && v !== undefined) { out[k] = "***"; redacted.push(path); continue; }
    out[k] = redact(v, redacted, path);
  }
  return out;
}

/** A field write's operation: FieldValue transforms are recorded by kind, not by value. */
function opOf(value: unknown): "set" | "unset" | "inc" | "server_time" | "array" {
  const name = (value as { constructor?: { name?: string } })?.constructor?.name || "";
  if (/Delete/.test(name)) return "unset";
  if (/Increment/.test(name)) return "inc";
  if (/ServerTimestamp/.test(name)) return "server_time";
  if (/Array(Union|Remove)/.test(name)) return "array";
  return "set";
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plain = (v: unknown): unknown => (v instanceof Timestamp ? v.toDate().toISOString() : v);

interface FieldChange { path: string; op: string; before?: unknown; after?: unknown }

function changesOf(write: PendingWrite, before: Record<string, unknown> | undefined, redacted: string[]): FieldChange[] {
  if (write.kind === "delete") return [{ path: "(document)", op: "unset" }];
  const data = write.data || {};
  const out: FieldChange[] = [];
  for (const [field, after] of Object.entries(data)) {
    if (SYSTEM_FIELDS.has(field)) continue;
    const top = field.split(".")[0];
    if (DROP.has(top.toLowerCase())) { redacted.push(field); continue; } // a secret: not even its old value
    const op = opOf(after);
    const prior = before ? field.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), before) : undefined;
    if (op === "set" && before && same(plain(prior), plain(after))) continue;
    const change: FieldChange = { path: field, op };
    // The field's own name is checked too (a top-level taxId), then any sensitive key inside its value.
    const leaf = field.split(".").pop() || field;
    const clean = (v: unknown) => (redact({ [leaf]: plain(v) }, [], "") as Record<string, unknown>)[leaf];
    if (LAST4.has(leaf.toLowerCase()) || MASK.has(leaf.toLowerCase())) redacted.push(field);
    if (op === "set") change.after = clean(after);
    if (before && op !== "server_time") change.before = clean(prior);
    if (field !== leaf || typeof after === "object") redact(plain(after), redacted, field); // list nested sensitive paths
    out.push(change);
  }
  return out;
}

/** "organizations/x/branches/y" → "branch", "stockBalances/z" → "stock_balance" (the registry's naming). */
const entityTypeOf = (path: string) => {
  const col = path.split("/").slice(-2, -1)[0] || path;
  const one = col.endsWith("ies") ? `${col.slice(0, -3)}y` : /(ss|x|ch|sh)es$/.test(col) ? col.slice(0, -2) : col.endsWith("s") && !col.endsWith("ss") ? col.slice(0, -1) : col;
  return one.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
};

function expireAt(from: Date): Timestamp {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + RETENTION_MONTHS);
  return Timestamp.fromDate(d);
}

function localDate(now: Date, timeZone: string | null): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); } catch { return now.toISOString().slice(0, 10); }
}

/** The event common to every category; `extra` adds what is specific. */
function baseEvent(ctx: RequestContext, now: Date, category: AuditCategory, action: string): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  const entry = AUDIT_REGISTRY[ctx.source.name];
  for (const f of entry?.inputFields || []) if (ctx.input && ctx.input[f] !== undefined) details[f] = ctx.input[f];
  if (ctx.auditNotes.transactionRetries) details.transactionRetries = ctx.auditNotes.transactionRetries;
  return {
    occurredAt: Timestamp.fromDate(now),
    occurredLocalDate: localDate(now, ctx.timeZone),
    // The organization the event is about: a Super Admin's change to an organization belongs to that
    // organization's trail (the cost of the work stays attributed to the platform, D-21).
    organizationId: ctx.targetOrgId || ctx.organizationId || "platform",
    targetOrgId: ctx.targetOrgId,
    actorUid: ctx.actor.uid,
    actor: { kind: ctx.actor.kind, role: ctx.actor.role ?? null, membershipId: ctx.actor.membershipId ?? null, branchId: ctx.actor.branchId ?? null },
    source: { [ctx.source.kind === "callable" ? "callable" : ctx.source.kind]: ctx.source.name, requestId: ctx.requestId, clientRequestId: ctx.meta?.clientRequestId ?? null, eventId: ctx.source.eventId ?? null },
    device: { ...ctx.device },
    action,
    category: ctx.actor.kind === "superAdminOnBehalf" && category === "mutation" ? "admin" : category,
    details: redact(details, []),
    expireAt: expireAt(now),
  };
}

/** Commit hook: one event per commit that changes business documents (same commit). */
export function recordCommitEvent(writes: PendingWrite[], append: (path: string, data: DocumentData) => void, txnBefore: Map<string, DocumentData | undefined>): void {
  const ctx = currentContext();
  if (!ctx) return;
  const business = writes.filter((w) => !AUDIT_EXCLUDED_COLLECTIONS[w.path.split("/")[0]] && !(w.path.split("/").length > 2 && AUDIT_EXCLUDED_COLLECTIONS[w.path.split("/").slice(-2, -1)[0]]));
  if (!business.length) return;
  const entry = AUDIT_REGISTRY[ctx.source.name];
  const collectionOf = (p: string) => p.split("/").slice(0, -1).join("/");
  const primary = business.find((w) => entry?.collection && collectionTemplate(collectionOf(w.path)).endsWith(entry.collection)) || business[0];
  const ordered = [primary, ...business.filter((w) => w !== primary)];
  const redacted: string[] = [];
  const before = txnBefore.get(primary.path) ?? ctx.readData.get(primary.path);
  let fields = changesOf(primary, before as Record<string, unknown> | undefined, redacted);
  let truncated = false;
  if (Buffer.byteLength(JSON.stringify(fields)) > MAX_CHANGES_BYTES) {
    fields = fields.map((f) => ({ path: f.path, op: f.op }));
    truncated = true;
  }
  const now = new Date();
  const seq = ++ctx.auditSeq;

  const pData = (primary.data || {}) as Record<string, unknown>;
  const bData = (before || {}) as Record<string, unknown>;

  // Distinguish entity types per A-3: purchase vs expense
  let entityType = entry?.collection && collectionTemplate(collectionOf(primary.path)).endsWith(entry.collection) ? entry.action.split(".")[0] : entityTypeOf(primary.path);
  let action = entry?.action || `${entityTypeOf(primary.path)}.write`;

  if (primary.path.startsWith("outflows/")) {
    const kind = pData.kind || bData.kind;
    if (kind === "purchase") {
      entityType = "purchase";
      action = action.replace(/^outflow\./, "purchase.");
    } else if (kind === "expense") {
      entityType = "expense";
      action = action.replace(/^outflow\./, "expense.");
    }
  } else if (primary.path.startsWith("bills/")) {
    entityType = "bill";
  } else if (primary.path.startsWith("stockAdjustments/") || (primary.path.startsWith("stockMovements/") && (pData.reason === "wastage" || pData.reason === "damage" || pData.movementType === "damage"))) {
    entityType = "wastage";
  }

  // Derive operation (A-4)
  let operation: "create" | "update" | "delete" | "status_change" = "update";
  if (primary.kind === "create" || (!before && !primary.merge) || action.endsWith(".create") || action.endsWith(".add")) {
    operation = "create";
  } else if (primary.kind === "delete" || action.endsWith(".delete")) {
    operation = "delete";
  } else if ((pData.status && bData.status && pData.status !== bData.status) || /finalize|void|approve|cancel|reject|complete|status/i.test(action)) {
    operation = "status_change";
  }

  // Derive statusBefore and statusAfter (A-5)
  const statusAfter = (pData.status || bData.status || null) as string | null;
  const statusBefore = (bData.status || null) as string | null;

  // Derive human label (A-7)
  const humanLabel = ((pData.requestNumber || pData.billNumber || pData.invoiceNumber || pData.number || pData.name || pData.sku || pData.code || bData.requestNumber || bData.billNumber || bData.invoiceNumber || bData.name || null) as string | null);

  // Derive amount and currency (A-2)
  const amount = ((pData.totalAmount ?? pData.amount ?? pData.totalPaise ?? bData.totalAmount ?? bData.amount ?? null) as number | null);
  const currency = ((pData.currency || bData.currency || null) as string | null);
  const branchId = ((pData.branchId || bData.branchId || ctx.actor.branchId || null) as string | null);

  const event = {
    ...baseEvent(ctx, now, entry?.category && entry.category !== "none" ? entry.category : "mutation", action),
    outcome: "success",
    reason: null,
    operation,
    entityType,
    entityId: primary.path.split("/").pop(),
    humanLabel,
    statusBefore,
    statusAfter,
    amount,
    currency,
    branchId,
    targets: ordered.map((w) => ({ type: entityTypeOf(w.path), id: w.path.split("/").pop(), path: w.path, op: w.kind })),
    changes: { fields, truncated, redacted, beforeAvailable: before !== undefined || primary.kind === "create" },
    changedFields: fields.map((f) => f.path.split(".")[0]).filter((p, i, a) => p !== "(document)" && a.indexOf(p) === i),
    ops: { reads: ctx.ops.total.reads, writes: ctx.ops.total.writes + business.length, deletes: ctx.ops.total.deletes },
  };
  append(`auditLogs/${ctx.requestId}_${seq}`, event);
}

// ---------------------------------------------------------------------------
// End-of-request and system events
// ---------------------------------------------------------------------------

/** Writes an event outside any commit (raw SDK, so it is written even after a failure) and counts it. */
function writeStandalone(ctx: RequestContext | undefined, id: string, event: Record<string, unknown>): Promise<void> {
  // Counted before the write starts, so the request's meter (written in parallel) includes it.
  if (ctx) {
    ctx.ops.total.writes++;
    ctx.ops.byCategory.audit.writes++;
    const c = (ctx.ops.byCollection.auditLogs = ctx.ops.byCollection.auditLogs || { reads: 0, writes: 0, deletes: 0, aggregationReads: 0 });
    c.writes++;
  }
  return rawDb().collection("auditLogs").doc(id).set(event).then(() => undefined);
}

/** An event with no Firestore mutation to attach to (e.g. an Auth rollback that failed). */
export async function recordSystemEvent(action: string, target: { type: string; id: string }, details: Record<string, unknown>, category: AuditCategory = "security"): Promise<void> {
  const ctx = currentContext();
  const now = new Date();
  const base = ctx ? baseEvent(ctx, now, category, action) : { occurredAt: Timestamp.fromDate(now), occurredLocalDate: localDate(now, null), organizationId: "platform", actorUid: null, actor: { kind: "system" }, action, category, expireAt: expireAt(now) };
  const id = ctx ? `${ctx.requestId}_${++ctx.auditSeq}` : `system_${now.getTime().toString(36)}`;
  await writeStandalone(ctx, id, { ...base, outcome: "failed", reason: null, entityType: target.type, entityId: target.id, targets: [{ ...target, path: null, op: null }], details: redact(details, []) });
}

const RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<string, { start: number; suppressed: number }>();

/** One event per (actor, reason) per minute; the rest are counted into the next event (6.3). */
function admit(key: string): { allowed: boolean; suppressed: number } {
  const now = Date.now();
  const w = rateWindows.get(key);
  if (!w || now - w.start >= RATE_WINDOW_MS) {
    rateWindows.set(key, { start: now, suppressed: 0 });
    return { allowed: true, suppressed: w ? w.suppressed : 0 };
  }
  w.suppressed++;
  return { allowed: false, suppressed: 0 };
}

const NOT_TIED_TO_A_COMMIT = new Set<AuditCategory>(["export", "auth", "file", "read_sensitive"]);

export async function recordRequestEvent(ctx: RequestContext, outcome: "success" | "denied" | "failed", reason: string | null): Promise<void> {
  const entry = AUDIT_REGISTRY[ctx.source.name];
  let category: AuditCategory;
  let action = entry?.action || `${ctx.source.name}.call`;
  const extra: Record<string, unknown> = {};
  if (outcome === "denied") {
    category = "security";
    action = "permission.denied";
  } else if (outcome === "failed") {
    if (!entry || entry.category === "none") return; // a failed plain read is not audited
    category = entry.category;
  } else {
    if (!entry || !NOT_TIED_TO_A_COMMIT.has(entry.category) || ctx.auditSeq > 0) return; // mutations were recorded at commit
    category = entry.category;
  }
  if (outcome !== "success") {
    const gate = admit(`${ctx.actor.uid || ctx.device.ipTruncated || "anonymous"}|${reason}`);
    if (!gate.allowed) return;
    if (gate.suppressed) extra.suppressedSincePrevious = gate.suppressed;
  }
  const now = new Date();
  const seq = ++ctx.auditSeq;
  const event = {
    ...baseEvent(ctx, now, category, action),
    outcome,
    reason,
    attemptedAction: outcome === "denied" ? entry?.action ?? null : undefined,
    entityType: entry ? entry.action.split(".")[0] : null,
    entityId: null,
    targets: [],
    ...extra,
  };
  return writeStandalone(ctx, `${ctx.requestId}_${seq}`, event);
}

