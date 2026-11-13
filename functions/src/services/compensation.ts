/**
 * Provisioning Compensation & Rollback Service
 * 
 * Manages two-phase rollback when cross-system operations fail
 * (e.g., Firebase Auth user created, but subsequent Firestore writes fail).
 */

import { auth } from "./firebase.js";
import { recordSystemEvent } from "./auditRecorder.js";

export interface RollbackResult {
  attempted: boolean;
  success: boolean;
  authUid: string;
  error?: string;
}

/**
 * Rolls back a newly created Firebase Auth user if downstream Firestore provisioning fails.
 */
export async function compensateAuthUser(uid: string, reason: string): Promise<RollbackResult> {
  if (!uid) {
    return { attempted: false, success: true, authUid: "" };
  }

  try {
    await auth.deleteUser(uid);
    return {
      attempted: true,
      success: true,
      authUid: uid,
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);

    // Record an uncompensated orphan event in audit logs for manual/automated reconciliation
    try {
      await recordSystemEvent("auth.compensation_failed", { type: "user", id: uid }, { originalReason: reason, rollbackError: errMessage, severity: "CRITICAL" });
    } catch {
      // Emergency fallback logging
      console.error(`[CRITICAL] Failed to delete orphan Auth user ${uid} and failed to write audit log:`, errMessage);
    }

    return {
      attempted: true,
      success: false,
      authUid: uid,
      error: errMessage,
    };
  }
}
