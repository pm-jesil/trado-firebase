/**
 * RequestContext (prompt 66, Part 3): who, when and from where, once per execution.
 *
 * Opened by the callable wrapper (services/callable.ts), by every trigger and by the scheduled job;
 * the gate (contextResolver) adds the organization, membership, role and branch it already resolved.
 * The counting layer (services/meteredFirestore.ts) adds every Firestore operation to `ops`.
 * Values from the token and the server clock are trusted; `meta` (the client's `_meta`) is not (D-26).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export type OpCategory = "gate" | "app" | "audit" | "meter";
export type ActorKind = "user" | "system" | "trigger" | "scheduled" | "superAdminOnBehalf";

export interface OpCounts {
  reads: number;
  writes: number;
  deletes: number;
  /** Reads billed for count() / sum() / avg() aggregations (part of `reads`). */
  aggregationReads: number;
}

export interface ClientMeta {
  deviceId?: string;
  appVersion?: string;
  platform?: "android" | "ios" | "web";
  clientRequestId?: string;
  clientTime?: string;
  locale?: string;
}

export interface RequestContext {
  requestId: string;
  source: { kind: "callable" | "trigger" | "scheduled" | "script"; name: string; eventId?: string };
  startedAt: Date;
  /** UTC date of the start (rollup bucket, reconciles with the billing export). */
  utcDate: string;
  actor: { uid: string | null; kind: ActorKind; role?: string | null; membershipId?: string | null; branchId?: string | null };
  /** The organization the operations are attributed to; "platform" for platform work (D-21). */
  organizationId: string | null;
  /** The organization platform work was done for (D-21); the tenant is not charged. */
  targetOrgId: string | null;
  timeZone: string | null;
  meta: ClientMeta | null;
  device: { deviceId: string | null; deviceRegistered: boolean | null; platform: string | null; appVersion: string | null; ipTruncated: string | null; userAgentFamily: string | null; appCheckVerified: boolean | null };
  ops: { total: OpCounts; byCategory: Record<OpCategory, OpCounts>; byCollection: Record<string, OpCounts> };
  /** Size of the request payload in bytes (JSON). */
  bytesIn: number;
  /** Documents read twice in this request with no write of them in between. */
  redundantReads: number;
  category: OpCategory;
  /** Paths read since their last write (redundant-read detector). */
  readPaths: Set<string>;
  /** Data of documents read in this request (undefined = missing), bounded: the audit's before-values (no extra read). */
  readData: Map<string, Record<string, unknown> | undefined>;
  /** The request payload after `_meta` was removed (reason fields for the audit event). */
  input: Record<string, unknown> | null;
  /** Business commits of this request (audit sequence) and reasons noted by the handler. */
  auditSeq: number;
  auditNotes: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const emptyCounts = (): OpCounts => ({ reads: 0, writes: 0, deletes: 0, aggregationReads: 0 });

/** Server-generated, sortable request id. */
export function newRequestId(now = new Date()): string {
  return `${now.getTime().toString(36)}${randomBytes(6).toString("hex")}`;
}

export function createContext(source: RequestContext["source"], init: Partial<Pick<RequestContext, "actor" | "organizationId" | "targetOrgId" | "meta" | "device" | "timeZone">> = {}): RequestContext {
  const startedAt = new Date();
  return {
    requestId: newRequestId(startedAt),
    source,
    startedAt,
    utcDate: startedAt.toISOString().slice(0, 10),
    actor: init.actor ?? { uid: null, kind: "system" },
    organizationId: init.organizationId ?? null,
    targetOrgId: init.targetOrgId ?? null,
    timeZone: init.timeZone ?? null,
    meta: init.meta ?? null,
    device: init.device ?? { deviceId: null, deviceRegistered: null, platform: null, appVersion: null, ipTruncated: null, userAgentFamily: null, appCheckVerified: null },
    ops: { total: emptyCounts(), byCategory: { gate: emptyCounts(), app: emptyCounts(), audit: emptyCounts(), meter: emptyCounts() }, byCollection: {} },
    bytesIn: 0,
    redundantReads: 0,
    category: "app",
    readPaths: new Set(),
    readData: new Map(),
    input: null,
    auditSeq: 0,
    auditNotes: {},
  };
}

export function runInContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Run `fn` with operations counted under `category` (the gate's reads, audit and meter writes). */
export async function withCategory<T>(category: OpCategory, fn: () => Promise<T>): Promise<T> {
  const ctx = currentContext();
  if (!ctx) return fn();
  const previous = ctx.category;
  ctx.category = category;
  try {
    return await fn();
  } finally {
    ctx.category = previous;
  }
}

/** A system execution (trigger or scheduled job), attributed to `organizationId` or to the platform. */
export function runAsSystem<T>(source: RequestContext["source"], organizationId: string | null, fn: () => Promise<T>): Promise<T> {
  const kind: ActorKind = source.kind === "scheduled" ? "scheduled" : source.kind === "trigger" ? "trigger" : "system";
  const ctx = createContext(source, { actor: { uid: null, kind }, organizationId: organizationId ?? "platform" });
  return runInContext(ctx, fn);
}

/** "organizations/abc/branches/main" → "organizations/{id}/branches/{id}" (bounded cardinality). */
export function collectionTemplate(docOrCollectionPath: string): string {
  return docOrCollectionPath.split("/").map((seg, i) => (i % 2 === 1 ? "{id}" : seg)).join("/");
}

/** IPv4 → /24, IPv6 → /48 (D-27). */
export function truncateIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return `${v4.split(".").slice(0, 3).join(".")}.0/24`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  return null;
}

/** Browser or client family only, never the full header. */
export function userAgentFamily(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const families: Array<[RegExp, string]> = [[/Dart\//, "dart"], [/okhttp/i, "okhttp"], [/CFNetwork|Darwin/, "ios-native"], [/Edg\//, "edge"], [/Chrome\//, "chrome"], [/Firefox\//, "firefox"], [/Safari\//, "safari"], [/node/i, "node"]];
  const hit = families.find(([re]) => re.test(ua));
  return hit ? hit[1] : "other";
}
