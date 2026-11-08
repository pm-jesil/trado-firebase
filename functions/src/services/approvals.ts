/**
 * Maker–checker approvals.
 *
 * Policy lives on organizations/{id}.settings.approvals and is OFF by default. When on, a
 * document created by a user who lacks the module's approve permission is stored as
 * `pending_approval` with no stock, ledger or payment effect until approved.
 *
 * Small-org mode: if no eligible approver other than the creator exists (no other active
 * Owner/Admin), the document auto-approves with an audit note — never a deadlock.
 * Approvers cannot approve their own documents.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { AppPermissions } from "../constants/permissions.js";
import { EntityStatus } from "../constants/enums.js";
import type { RequestContext } from "./contextResolver.js";

export type ApprovalModule = "sale" | "purchase" | "expense" | "return" | "stock_adjustment";

export const APPROVE_PERMISSION: Record<ApprovalModule, string> = {
  sale: AppPermissions.BILL_APPROVE,
  purchase: AppPermissions.PURCHASE_APPROVE,
  expense: AppPermissions.EXPENSE_APPROVE,
  return: AppPermissions.RETURN_APPROVE,
  stock_adjustment: AppPermissions.STOCK_APPROVE,
};

export interface ApprovalDecision {
  required: boolean;
  note?: string;
}

/** Decides whether a new document needs approval. */
export async function evaluateApproval(
  ctx: RequestContext,
  module: ApprovalModule,
  amount: number,
  forceReason?: string
): Promise<ApprovalDecision> {
  const policy = ctx.organization.settings?.approvals;
  const policyOn = !!policy?.enabled && policy.modules?.[module] !== false;
  const aboveThreshold = !policy?.amountThreshold || amount >= policy.amountThreshold;
  const needsByPolicy = policyOn && aboveThreshold;

  if ((!needsByPolicy && !forceReason) || ctx.can(APPROVE_PERMISSION[module])) {
    return { required: false };
  }

  const approvers = await db.collection("memberships")
    .where("organizationId", "==", ctx.organizationId)
    .where("status", "==", EntityStatus.ACTIVE)
    .where("roleId", "in", ["role_org_owner", "role_admin"])
    .limit(5)
    .get();
  const others = approvers.docs.filter((d) => d.id !== ctx.membershipId);
  if (others.length === 0) {
    return {
      required: false,
      note: "Auto-approved: no eligible approver other than the creator (small-organization mode).",
    };
  }
  return { required: true, note: forceReason };
}

/** Validates that the caller may approve/reject a pending document. */
export function assertCanDecide(
  ctx: RequestContext,
  module: ApprovalModule,
  doc: { createdBy?: string; status?: string }
): void {
  if (doc.status !== "pending_approval") {
    throw new HttpsError("failed-precondition", `Document is not pending approval (status: ${doc.status || "none"}).`);
  }
  if (!ctx.can(APPROVE_PERMISSION[module])) {
    throw new HttpsError("permission-denied", `[PERMISSION_DENIED] "${APPROVE_PERMISSION[module]}" is required to approve.`, { reason: "PERMISSION_DENIED" });
  }
  if (doc.createdBy === ctx.callerUid) {
    throw new HttpsError("permission-denied", "Makers cannot approve their own documents.", { reason: "SELF_APPROVAL_FORBIDDEN" });
  }
}
