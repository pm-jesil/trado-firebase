/**
 * Change History Callables
 * - auditGetEntityHistory: immutable per-entity change history (who, when, field old -> new),
 *   read from auditLogs. Entities keep only createdAt/By and updatedAt/By; every change is an
 *   audit entry, never an ever-growing array on the entity. Display names are resolved by id
 *   at read time.
 */

import { onCall } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { EntityHistorySchema } from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { AuditLogDoc, UserDoc } from "../types/models.js";
import { AppPermissions } from "../constants/permissions.js";
import { resolveRequestContext } from "../services/contextResolver.js";

export const auditGetEntityHistory = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(EntityHistorySchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.AUDIT_VIEW });

  let query: FirebaseFirestore.Query = db.collection("auditLogs")
    .where("organizationId", "==", ctx.organizationId);

  if (input.entityType) {
    query = query.where("entityType", "==", input.entityType);
  }
  if (input.entityId) {
    query = query.where("entityId", "==", input.entityId);
  }

  const snap = await query.get();

  const logs = snap.docs
    .map((d) => ({ logId: d.id, ...(d.data() as AuditLogDoc) }))
    .map((l) => ({ ...l, timestamp: l.timestamp || (l as unknown as { createdAt?: string }).createdAt || "" }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, input.limit || 50);

  const actorIds = Array.from(new Set(logs.map((l) => l.actorUid)));
  const actorSnaps = actorIds.length ? await db.getAll(...actorIds.map((id) => db.collection("users").doc(id))) : [];
  const names = new Map(actorSnaps.filter((s) => s.exists).map((s) => [s.id, (s.data() as UserDoc).name]));

  return {
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    items: logs.map((l) => ({
      logId: l.logId,
      at: l.timestamp,
      action: l.action,
      actorUid: l.actorUid,
      actorName: names.get(l.actorUid) || null,
      branchId: l.branchId || null,
      entityType: l.entityType,
      entityId: l.entityId,
      changes: l.changes || [],
      details: l.details || {},
    })),
  };
});
