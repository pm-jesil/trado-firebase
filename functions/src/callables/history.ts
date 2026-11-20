/**
 * The audit read API (prompt 66 §6.7): one query core, two callables.
 * - auditLogsList: the trail of an organization (tenant, `audit:view`; own activity only with
 *   `audit:read_own`) or of the platform (Super Admin), filtered by actor, entity, action, category,
 *   outcome, device, request and date, newest first, cursor-paginated.
 * - auditGetEntityHistory: the same query with an entity filter (who, when, field old → new).
 * Events are written by services/auditRecorder.ts; display names are resolved here, at read time (R1).
 * No total is counted unless asked (`includeTotal`): a count() on every page is a read per page.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { EntityHistorySchema, ListAuditLogsSchema } from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { AuditLogDoc, UserDoc, OrganizationDoc } from "../types/models.js";
import { AppPermissions } from "../constants/permissions.js";
import { resolveRequestContext } from "../services/contextResolver.js";

interface AuditQuery {
  organizationId: string | null;
  branchId?: string;
  actorUid?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  operation?: string;
  status?: string;
  category?: string;
  outcome?: string;
  deviceId?: string;
  requestId?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
  includeTotal?: boolean;
  isSuperAdmin?: boolean;
}

async function queryAudit(q: AuditQuery) {
  let query: FirebaseFirestore.Query = db.collection("auditLogs");
  if (q.organizationId) query = query.where("organizationId", "==", q.organizationId);
  const equal: Array<[string, string | undefined]> = [
    ["actorUid", q.actorUid], ["entityType", q.entityType], ["entityId", q.entityId], ["action", q.action],
    ["category", q.category], ["outcome", q.outcome], ["device.deviceId", q.deviceId], ["source.requestId", q.requestId],
    ["branchId", q.branchId], ["operation", q.operation], ["statusAfter", q.status],
  ];
  for (const [field, value] of equal) if (value) query = query.where(field, "==", value);
  if (q.from) query = query.where("occurredAt", ">=", Timestamp.fromDate(new Date(`${q.from.slice(0, 10)}T00:00:00.000Z`)));
  if (q.to) query = query.where("occurredAt", "<=", Timestamp.fromDate(new Date(`${q.to.slice(0, 10)}T23:59:59.999Z`)));
  const totalQuery = query;
  query = query.orderBy("occurredAt", "desc");
  if (q.cursor) {
    const cursorDoc = await db.collection("auditLogs").doc(q.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const [snap, total] = await Promise.all([
    query.limit(q.limit + 1).get(),
    q.includeTotal ? totalQuery.count().get().then((c) => c.data().count) : Promise.resolve(null),
  ]);
  const docs = snap.docs.slice(0, q.limit);
  const nextCursor = snap.docs.length > q.limit ? docs[docs.length - 1].id : null;

  const actorIds = Array.from(new Set(docs.map((d) => (d.data() as AuditLogDoc).actorUid).filter((id): id is string => Boolean(id))));
  const orgIds = Array.from(new Set(docs.map((d) => (d.data() as AuditLogDoc).organizationId).filter((id): id is string => Boolean(id) && id !== "platform")));
  const [actorSnaps, orgSnaps] = await Promise.all([
    actorIds.length ? db.getAll(...actorIds.map((id) => db.collection("users").doc(id))) : Promise.resolve([]),
    orgIds.length ? db.getAll(...orgIds.map((id) => db.collection("organizations").doc(id))) : Promise.resolve([]),
  ]);
  const actors: Record<string, { id: string; name: string; email: string }> = {};
  for (const s of actorSnaps) if (s.exists) { const u = s.data() as UserDoc; actors[s.id] = { id: s.id, name: u.name, email: u.email }; }
  const organizations: Record<string, { id: string; name: string }> = {};
  for (const s of orgSnaps) if (s.exists) organizations[s.id] = { id: s.id, name: (s.data() as OrganizationDoc).name };

  const items = docs.map((d) => {
    const e = d.data() as AuditLogDoc;
    return {
      logId: d.id,
      timestamp: e.occurredAt.toDate().toISOString(),
      occurredLocalDate: e.occurredLocalDate,
      action: e.action,
      operation: e.operation || (e.action?.endsWith(".create") ? "create" : e.action?.endsWith(".delete") ? "delete" : /finalize|void|approve|cancel|reject|complete/i.test(e.action) ? "status_change" : "update"),
      humanLabel: e.humanLabel ?? null,
      statusBefore: e.statusBefore ?? null,
      statusAfter: e.statusAfter ?? null,
      amount: e.amount ?? null,
      currency: e.currency ?? null,
      category: e.category,
      outcome: e.outcome,
      reason: e.reason ?? null,
      actorUid: e.actorUid,
      actorName: (e.actorUid && actors[e.actorUid]?.name) || null,
      actorRole: e.actor?.role ?? null,
      actorKind: e.actor?.kind ?? null,
      organizationId: e.organizationId ?? null,
      branchId: e.branchId ?? e.actor?.branchId ?? null,
      entityType: e.entityType,
      entityId: e.entityId,
      targets: e.targets || [],
      // The field history the clients read: field, old → new (before is null when it was not read).
      changes: (e.changes?.fields || []).map((f) => ({ field: f.path, op: f.op, from: f.before ?? null, to: f.after ?? null })),
      changesTruncated: e.changes?.truncated ?? false,
      details: e.details || {},
      device: q.isSuperAdmin ? (e.device ? { ...e.device } : null) : (e.device ? {
        deviceId: e.device.deviceId ?? null,
        platform: e.device.platform ?? null,
        appVersion: e.device.appVersion ?? null,
        userAgentFamily: e.device.userAgentFamily ?? null,
        appCheckVerified: e.device.appCheckVerified ?? null,
      } : null),
      deviceId: e.device?.deviceId ?? null,
      requestId: e.source?.requestId ?? null,
    };
  });
  return { items, nextCursor, totalCount: total, actors, organizations };
}

export const auditLogsList = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(ListAuditLogsSchema, request.data);
  let scope: { organizationId: string | null; ownOnly: boolean; uid: string; branchId?: string };
  const isSuperAdmin = request.auth?.token.isSuperAdmin === true;
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (isSuperAdmin) {
    scope = { organizationId: input.organizationId || null, ownOnly: false, uid: request.auth.uid, branchId: input.branchId };
  } else {
    const ctx = await resolveRequestContext(request, {
      requiredPermission: [AppPermissions.AUDIT_VIEW, AppPermissions.AUDIT_READ_OWN],
    });
    scope = {
      organizationId: ctx.organizationId,
      ownOnly: !ctx.can(AppPermissions.AUDIT_VIEW),
      uid: ctx.callerUid,
      branchId: (!ctx.isOwner && ctx.role?.code !== "admin" && ctx.branchId) ? ctx.branchId : input.branchId,
    };
  }
  const result = await queryAudit({
    organizationId: scope.organizationId,
    branchId: scope.branchId,
    actorUid: scope.ownOnly ? scope.uid : input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    operation: input.operation,
    status: input.status,
    category: input.category,
    outcome: input.outcome && input.outcome !== "all" ? input.outcome : undefined,
    deviceId: input.deviceId,
    requestId: input.requestId,
    from: input.from,
    to: input.to,
    limit: input.limit || 50,
    cursor: input.cursor,
    includeTotal: input.includeTotal,
    isSuperAdmin,
  });
  return {
    items: result.items,
    count: result.items.length,
    totalCount: result.totalCount,
    nextCursor: result.nextCursor,
    hasMore: result.nextCursor !== null,
    ownActivityOnly: scope.ownOnly,
    included: { actors: result.actors, organizations: result.organizations },
  };
});

export const auditGetEntityHistory = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(EntityHistorySchema, request.data);
  let scope: { organizationId: string | null; ownOnly: boolean; uid: string };
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (request.auth.token.isSuperAdmin === true) {
    scope = { organizationId: input.organizationId || null, ownOnly: false, uid: request.auth.uid };
  } else {
    const ctx = await resolveRequestContext(request, {
      requiredPermission: [AppPermissions.AUDIT_VIEW, AppPermissions.AUDIT_READ_OWN],
    });
    scope = { organizationId: ctx.organizationId, ownOnly: !ctx.can(AppPermissions.AUDIT_VIEW), uid: ctx.callerUid };
  }
  const result = await queryAudit({
    organizationId: scope.organizationId,
    actorUid: scope.ownOnly ? scope.uid : undefined,
    entityType: input.entityType,
    entityId: input.entityId,
    limit: input.limit || 50,
  });
  return {
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    items: result.items.map((i) => ({
      logId: i.logId,
      at: i.timestamp,
      action: i.action,
      operation: i.operation,
      humanLabel: i.humanLabel,
      statusBefore: i.statusBefore,
      statusAfter: i.statusAfter,
      amount: i.amount,
      currency: i.currency,
      actorUid: i.actorUid,
      actorName: i.actorName,
      branchId: i.branchId,
      entityType: i.entityType,
      entityId: i.entityId,
      changes: i.changes,
      details: i.details,
    })),
    nextCursor: result.nextCursor,
  };
});
