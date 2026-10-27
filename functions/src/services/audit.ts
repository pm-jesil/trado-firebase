/**
 * Lean Audit Logging Service
 * 
 * Strict architectural rule:
 * - Audit logs contain summary metadata only.
 * - Full entity documents, passwords, tokens, and raw payloads are NEVER stored.
 */

import { Firestore, Transaction, WriteBatch } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { AuditLogDoc } from "../types/models.js";

export interface LogAuditParams {
  organizationId?: string | null;
  actorUid: string;
  actorMembershipId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/**
 * Strips sensitive fields (passwords, tokens, credentials) from audit detail objects.
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined;

  const sanitized: Record<string, unknown> = {};
  const forbiddenKeys = new Set([
    "password", "initialPassword", "token", "fcmToken", "secret",
    "authorization", "refreshToken", "accessToken", "credential"
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
  const logDoc: AuditLogDoc = {
    organizationId: params.organizationId ?? "platform",
    actorUid: params.actorUid,
    actorMembershipId: params.actorMembershipId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    timestamp: new Date().toISOString(),
    requestId: params.requestId,
    details: sanitizeAuditDetails(params.details),
  };

  const ref = await targetDb.collection("auditLogs").add(logDoc);
  return ref.id;
}

/**
 * Adds an audit log entry within an existing Firestore transaction.
 */
export function addAuditLogToTransaction(txn: Transaction, params: LogAuditParams): void {
  const ref = db.collection("auditLogs").doc();
  const logDoc: AuditLogDoc = {
    organizationId: params.organizationId ?? "platform",
    actorUid: params.actorUid,
    actorMembershipId: params.actorMembershipId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    timestamp: new Date().toISOString(),
    requestId: params.requestId,
    details: sanitizeAuditDetails(params.details),
  };
  txn.set(ref, logDoc);
}

/**
 * Adds an audit log entry to a Firestore write batch.
 */
export function addAuditLogToBatch(batch: WriteBatch, params: LogAuditParams): void {
  const ref = db.collection("auditLogs").doc();
  const logDoc: AuditLogDoc = {
    organizationId: params.organizationId ?? "platform",
    actorUid: params.actorUid,
    actorMembershipId: params.actorMembershipId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    timestamp: new Date().toISOString(),
    requestId: params.requestId,
    details: sanitizeAuditDetails(params.details),
  };
  batch.set(ref, logDoc);
}
