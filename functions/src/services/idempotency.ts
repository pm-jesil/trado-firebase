/**
 * Idempotency Orchestrator
 * 
 * Provides deterministic hashing, transactional reservation, and result replay
 * to prevent duplicate operations and race conditions across create callables.
 */

import { createHash } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { IdempotencyStatus } from "../constants/enums.js";
import { IdempotencyRecordDoc } from "../types/models.js";

export interface IdempotencyConfig {
  scope: string; // "platform" or organizationId
  actorUid: string;
  operation: string; // e.g. "organizations.create", "employees.create"
  clientKey?: string;
  /**
   * What "the same request" is compared on: the client's request data (`request.data`), not the parsed
   * input. Parsing adds server-generated values (address and bank-account ids), so two identical
   * requests would never hash alike and every retry would be an IDEMPOTENCY_CONFLICT.
   */
  payload: unknown;
  ttlHours?: number;
  leaseSeconds?: number; // In-flight lease timeout, default 30 seconds
  recoveryChecker?: () => Promise<Record<string, unknown> | null>; // Check if prior side-effects completed
}

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  isProcessing: boolean;
  cachedResult?: Record<string, unknown>;
  recordId: string;
  requestHash: string;
  recoveredFromTimeout?: boolean;
}

/**
 * Normalizes an object into a canonical deterministic string representation.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalizeJson).join(",") + "]";
  }

  const record = obj as Record<string, unknown>;
  // Omit the client idempotencyKey itself from payload hashing
  const sortedKeys = Object.keys(record)
    .filter((k) => k !== "idempotencyKey" && k !== "initialPassword")
    .sort();

  const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`);
  return "{" + entries.join(",") + "}";
}

/**
 * Computes a SHA-256 hash of the canonicalized request payload.
 */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalizeJson(payload)).digest("hex");
}

/**
 * Derives a deterministic Firestore document ID for the idempotency record.
 */
export function deriveRecordId(scope: string, actorUid: string, operation: string, clientKey: string): string {
  const rawKey = `${scope}::${actorUid}::${operation}::${clientKey.trim()}`;
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Attempts to reserve an idempotency slot in Firestore transactionally.
 */
export async function reserveIdempotency(config: IdempotencyConfig): Promise<IdempotencyCheckResult> {
  if (!config.clientKey) {
    return {
      isDuplicate: false,
      isProcessing: false,
      recordId: "",
      requestHash: hashPayload(config.payload),
    };
  }

  const recordId = deriveRecordId(config.scope, config.actorUid, config.operation, config.clientKey);
  const requestHash = hashPayload(config.payload);
  const recordRef = db.collection("idempotencyRecords").doc(recordId);

  const ttlHours = config.ttlHours ?? 24;
  const leaseSeconds = config.leaseSeconds ?? 30;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
  const processingExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

  // If recoveryChecker is provided, pre-check before transaction or inside recovery
  let recoveredSideEffectResult: Record<string, unknown> | null = null;

  return await db.runTransaction(async (txn) => {
    const doc = await txn.get(recordRef);

    if (doc.exists) {
      const existing = doc.data() as IdempotencyRecordDoc;

      // Check for document-level expiration (24h TTL)
      const isExpired = new Date(existing.expiresAt).getTime() < now.getTime();
      if (!isExpired) {
        // Conflict check: same key with different payload
        if (existing.requestHash !== requestHash) {
          // A stable reason for the client (a plain Error surfaced as INTERNAL)
          throw new HttpsError("failed-precondition", "IDEMPOTENCY_CONFLICT: Idempotency key reused with a different request payload.", { reason: "IDEMPOTENCY_CONFLICT" });
        }

        // Succeeded case: return cached result
        if (existing.status === IdempotencyStatus.SUCCEEDED && existing.result) {
          return {
            isDuplicate: true,
            isProcessing: false,
            cachedResult: existing.result,
            recordId,
            requestHash,
          };
        }

        // Processing case: check lease deadline
        if (existing.status === IdempotencyStatus.PROCESSING) {
          const leaseDeadlineMs = existing.processingExpiresAt
            ? new Date(existing.processingExpiresAt).getTime()
            : new Date(existing.createdAt).getTime() + leaseSeconds * 1000;
          const isLeaseActive = now.getTime() < leaseDeadlineMs;

          if (isLeaseActive) {
            // Still in-flight within lease window
            return {
              isDuplicate: true,
              isProcessing: true,
              recordId,
              requestHash,
            };
          }

          // Lease expired! Stalled / crashed processing record detected.
          // Check if side-effects were already completed prior to crash.
          if (config.recoveryChecker) {
            try {
              recoveredSideEffectResult = await config.recoveryChecker();
            } catch {
              recoveredSideEffectResult = null;
            }
          }

          if (recoveredSideEffectResult) {
            // Side effects actually completed! Mark as SUCCEEDED to self-heal.
            txn.update(recordRef, {
              status: IdempotencyStatus.SUCCEEDED,
              result: recoveredSideEffectResult,
              updatedAt: now.toISOString(),
            });

            return {
              isDuplicate: true,
              isProcessing: false,
              cachedResult: recoveredSideEffectResult,
              recordId,
              requestHash,
              recoveredFromTimeout: true,
            };
          }

          // Side-effects did not complete (or no recovery checker): allow re-attempt
          txn.set(recordRef, {
            operationId: `${config.operation}_${now.getTime()}`,
            scope: config.scope,
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            createdAt: now.toISOString(),
            processingExpiresAt,
            expiresAt,
            recoveredFromTimeout: true,
          });

          return {
            isDuplicate: false,
            isProcessing: false,
            recordId,
            requestHash,
            recoveredFromTimeout: true,
          };
        }
      }
    }

    // Reserve new processing slot
    txn.set(recordRef, {
      operationId: `${config.operation}_${now.getTime()}`,
      scope: config.scope,
      requestHash,
      status: IdempotencyStatus.PROCESSING,
      createdAt: now.toISOString(),
      processingExpiresAt,
      expiresAt,
    });

    return {
      isDuplicate: false,
      isProcessing: false,
      recordId,
      requestHash,
    };
  });
}

/**
 * Finalizes an idempotency record upon successful completion of the business operation.
 */
export async function finalizeIdempotencySuccess(
  recordId: string,
  safeResult: object
): Promise<void> {
  if (!recordId) return;

  const recordRef = db.collection("idempotencyRecords").doc(recordId);
  await recordRef.update({
    status: IdempotencyStatus.SUCCEEDED,
    result: safeResult,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Marks an idempotency record as failed so client retries are permitted.
 */
export async function finalizeIdempotencyFailure(
  recordId: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  if (!recordId) return;

  const recordRef = db.collection("idempotencyRecords").doc(recordId);
  await recordRef.update({
    status: IdempotencyStatus.FAILED,
    error: {
      code: errorCode,
      message: errorMessage,
    },
  });
}
