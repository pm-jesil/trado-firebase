/**
 * Lean Audit Logging Service
 * 
 * Strict architectural rule:
 * - Audit logs contain summary metadata only.
 * - Full entity documents, passwords, tokens, and raw payloads are NEVER stored.
 * - Zero duplication: the entity is referenced by entityType + entityId; `details` carries only
 *   facts of the event (reason, decision, counts, referenced ids) and `changes` only the changed
 *   fields (from → to). Attributes of the entity (name, number, email, totals …) are dropped
 *   from `details` centrally here (ENTITY_ATTRIBUTE_KEYS), so no call site can copy them.
 */

import { Firestore, Transaction, WriteBatch } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { AuditLogDoc, AuditFieldChange } from "../types/models.js";

export interface LogAuditParams {
  organizationId?: string | null;
  branchId?: string | null;
  actorUid: string;
  actorMembershipId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string;
  details?: Record<string, unknown>;
  /** Field-level change history (old -> new) for mutable business entities. */
  changes?: AuditFieldChange[];
}

/**
 * Computes the field-level diff between two versions of an entity, limited to `fields`
 * (or every key of `after`). Unchanged fields are omitted.
 */
export function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  fields?: string[]
): AuditFieldChange[] {
  const keys = fields || Object.keys(after);
  const changes: AuditFieldChange[] = [];
  for (const field of keys) {
    if (field === "updatedAt" || field === "updatedBy") continue;
    if (!(field in after)) continue;
    const from = before ? (before[field] ?? null) : null;
    const to = after[field] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field, from: from as AuditFieldChange["from"], to: to as AuditFieldChange["to"] });
    }
  }
  return changes;
}

/** Entity attributes never copied into audit details (read them from the entity by id). */
const ENTITY_ATTRIBUTE_KEYS = new Set([
  "name", "namekey", "displayname", "email", "phone", "mobile", "number", "billnumber", "outflownumber", "returnnumber",
  "paymentnumber", "deliverynumber", "code", "customercode", "vendorcode", "branchcode", "sku", "barcode",
  "title", "totalamount", "paidamount", "balanceamount", "totalrefundamount", "amount", "ownername", "owneremail",
  "salesmode", "documenttype", "kind", "status",
]);

function withoutEntityAttributes(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) if (!ENTITY_ATTRIBUTE_KEYS.has(k.toLowerCase())) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function buildLogDoc(params: LogAuditParams): AuditLogDoc {
  const doc: AuditLogDoc = {
    organizationId: params.organizationId ?? "platform",
    branchId: params.branchId ?? null,
    actorUid: params.actorUid,
    actorMembershipId: params.actorMembershipId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    timestamp: new Date().toISOString(),
  };
  const details = sanitizeAuditDetails(withoutEntityAttributes(params.details));
  if (details) doc.details = details;
  if (params.requestId) doc.requestId = params.requestId;
  if (params.changes && params.changes.length) {
    doc.changes = params.changes.map((c) => ({
      field: c.field,
      from: sanitizeAuditDetails({ [c.field]: c.from })?.[c.field] as AuditFieldChange["from"] ?? null,
      to: sanitizeAuditDetails({ [c.field]: c.to })?.[c.field] as AuditFieldChange["to"] ?? null,
    }));
    doc.changedFields = doc.changes.map((c) => c.field);
  }
  return doc;
}

/**
 * Strips sensitive fields (passwords, tokens, credentials) from audit detail objects.
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined;

  const sanitized: Record<string, unknown> = {};
  // Compared lower-case (camelCase entries here would never match a lower-cased key)
  const forbiddenKeys = new Set([
    "password", "initialpassword", "token", "fcmtoken", "secret",
    "authorization", "refreshtoken", "accesstoken", "credential",
  ]);

  for (const [key, value] of Object.entries(details)) {
    if (forbiddenKeys.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Creates an audit log entry in Firestore.
 */
export async function createAuditLog(params: LogAuditParams, targetDb: Firestore = db): Promise<string> {
  const logDoc = buildLogDoc(params);

  const ref = await targetDb.collection("auditLogs").add(logDoc);
  return ref.id;
}

/**
 * Adds an audit log entry within an existing Firestore transaction.
 */
export function addAuditLogToTransaction(txn: Transaction, params: LogAuditParams): void {
  const ref = db.collection("auditLogs").doc();
  const logDoc = buildLogDoc(params);
  txn.set(ref, logDoc);
}

/**
 * Adds an audit log entry to a Firestore write batch.
 */
export function addAuditLogToBatch(batch: WriteBatch, params: LogAuditParams): void {
  const ref = db.collection("auditLogs").doc();
  const logDoc = buildLogDoc(params);
  batch.set(ref, logDoc);
}
