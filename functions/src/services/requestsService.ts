/**
 * Requests & Support Desk Service (Prompt 74, D-36..D-45)
 *
 * Implements business logic, SLA arithmetic, state machine validation,
 * blocker computations, and tenant read-path sanitization.
 */

import { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import {
  RequestCategory,
  RequestAudience,
  RequestKind,
  RequestPriority,
  RequestSeverity,
  RequestStatus,
  SlaState,
  RequestAction,
  RequestReason,
} from "../constants/enums.js";
import {
  RequestDoc,
  RequestActivityDoc,
  RequestCounterDoc,
  PlatformSettingsRequestsDoc,
  OrganizationDoc,
  SubscriptionPlanDoc,
} from "../types/models.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Maps each of the 15 categories to approval or work kind.
 */
export function getCategoryKind(category: RequestCategory): RequestKind {
  switch (category) {
    case RequestCategory.PLAN_CHANGE:
    case RequestCategory.LIMIT_INCREASE:
    case RequestCategory.MODULE_REQUEST:
    case RequestCategory.ORG_PROFILE_CHANGE:
    case RequestCategory.OWNERSHIP_TRANSFER:
    case RequestCategory.DATA_REQUEST:
    case RequestCategory.ACCESS_REQUEST:
      return RequestKind.APPROVAL;
    case RequestCategory.BILLING_QUERY:
    case RequestCategory.BUG_REPORT:
    case RequestCategory.DATA_ISSUE:
    case RequestCategory.FEATURE_REQUEST:
    case RequestCategory.IMPROVEMENT:
    case RequestCategory.SUPPORT_QUESTION:
    case RequestCategory.OTHER:
    case RequestCategory.SECURITY_CONCERN:
    default:
      return RequestKind.WORK;
  }
}

/**
 * Maps category to audience.
 */
export function getCategoryAudience(category: RequestCategory): RequestAudience {
  if (category === RequestCategory.ACCESS_REQUEST) {
    return RequestAudience.ORGANIZATION;
  }
  return RequestAudience.PLATFORM;
}

/**
 * Calculates default priority when requester does not explicitly select one.
 */
export function calculateDefaultPriority(
  category: RequestCategory,
  severity?: RequestSeverity
): RequestPriority {
  if (category === RequestCategory.SECURITY_CONCERN) {
    return RequestPriority.URGENT;
  }
  if (category === RequestCategory.OWNERSHIP_TRANSFER || category === RequestCategory.DATA_REQUEST) {
    return RequestPriority.HIGH;
  }
  if (category === RequestCategory.ORG_PROFILE_CHANGE ||
      category === RequestCategory.FEATURE_REQUEST ||
      category === RequestCategory.IMPROVEMENT) {
    return RequestPriority.LOW;
  }
  if (category === RequestCategory.BUG_REPORT) {
    if (severity === RequestSeverity.CRITICAL) return RequestPriority.URGENT;
    if (severity === RequestSeverity.MAJOR) return RequestPriority.HIGH;
    return RequestPriority.NORMAL;
  }
  return RequestPriority.NORMAL;
}

/**
 * Default SLA Windows (Appendix C) in Hours
 */
export const DEFAULT_SLA_HOURS: Record<RequestPriority, { firstResponseHours: number; resolutionHours: number }> = {
  [RequestPriority.URGENT]: { firstResponseHours: 4, resolutionHours: 24 },
  [RequestPriority.HIGH]: { firstResponseHours: 8, resolutionHours: 72 },
  [RequestPriority.NORMAL]: { firstResponseHours: 24, resolutionHours: 168 }, // 7 days
  [RequestPriority.LOW]: { firstResponseHours: 72, resolutionHours: 720 }, // 30 days
};

/**
 * Computes first response and resolution deadlines from creation timestamp.
 */
export function computeSlaDeadlines(
  priority: RequestPriority,
  fromDate: Date = new Date(),
  customSla?: PlatformSettingsRequestsDoc["sla"]
): { firstResponseDueAt: string; resolutionDueAt: string } {
  const config = (customSla && customSla[priority]) || DEFAULT_SLA_HOURS[priority];
  const firstResponseMs = fromDate.getTime() + config.firstResponseHours * 3600 * 1000;
  const resolutionMs = fromDate.getTime() + config.resolutionHours * 3600 * 1000;

  return {
    firstResponseDueAt: new Date(firstResponseMs).toISOString(),
    resolutionDueAt: new Date(resolutionMs).toISOString(),
  };
}

/**
 * Evaluates current SLA state given clock and pause duration.
 */
export function evaluateSlaState(request: RequestDoc, now: Date = new Date()): SlaState {
  // If request is in a paused status, SLA state remains paused
  if (request.status === RequestStatus.NEEDS_INFO || request.status === RequestStatus.ON_HOLD) {
    return SlaState.PAUSED;
  }

  // If already resolved or closed, evaluate at resolution time if available
  const evalTime = request.resolvedAt ? new Date(request.resolvedAt).getTime() : now.getTime();
  const resDueMs = new Date(request.resolutionDueAt).getTime();
  const createdMs = new Date(request.createdAt).getTime();
  const effectiveDueMs = resDueMs + (request.slaTotalPausedMs || 0);

  if (evalTime > effectiveDueMs) {
    return SlaState.BREACHED;
  }

  const totalWindowMs = effectiveDueMs - createdMs;
  const elapsedMs = evalTime - createdMs;
  if (totalWindowMs > 0 && elapsedMs >= 0.75 * totalWindowMs) {
    return SlaState.AT_RISK;
  }

  return SlaState.ON_TRACK;
}

/**
 * Resumes SLA clock when transitioning out of needs_info or on_hold.
 */
export function applySlaResume(request: RequestDoc, now: Date = new Date()): { slaTotalPausedMs: number; slaPausedAt: null } {
  let pausedDelta = 0;
  if (request.slaPausedAt) {
    const pauseStart = new Date(request.slaPausedAt).getTime();
    pausedDelta = Math.max(0, now.getTime() - pauseStart);
  }
  return {
    slaTotalPausedMs: (request.slaTotalPausedMs || 0) + pausedDelta,
    slaPausedAt: null,
  };
}

/**
 * Terminal statuses for requests
 */
export const TERMINAL_STATUSES: ReadonlySet<RequestStatus> = new Set([
  RequestStatus.REJECTED,
  RequestStatus.APPLIED,
  RequestStatus.DECLINED,
  RequestStatus.CLOSED,
  RequestStatus.CANCELLED,
]);

export const OPEN_STATUSES: ReadonlySet<RequestStatus> = new Set([
  RequestStatus.SUBMITTED,
  RequestStatus.IN_REVIEW,
  RequestStatus.NEEDS_INFO,
  RequestStatus.ON_HOLD,
  RequestStatus.APPROVED,
  RequestStatus.IN_PROGRESS,
]);

/**
 * Assert platform requests feature is enabled (A-17, Q-RQ13).
 */
export async function assertRequestsFeatureEnabled(): Promise<PlatformSettingsRequestsDoc> {
  const snap = await db.collection("platformSettings").doc("requests").get();
  if (!snap.exists) {
    // Default seed if not yet created: feature disabled
    return {
      requestsEnabled: false,
      sla: DEFAULT_SLA_HOURS,
      limits: {
        maxOpenPerUser: 10,
        maxOpenPerOrg: 50,
        maxCreationsPerHourPerUser: 10,
      },
      autoCloseDays: 7,
      reopenWindowDays: 14,
      needsInfoReminderDays: 3,
      needsInfoAutoCancelDays: 14,
    };
  }
  const config = snap.data() as PlatformSettingsRequestsDoc;
  if (config.requestsEnabled !== true) {
    throw new HttpsError("failed-precondition", `[${RequestReason.FEATURE_DISABLED}] Requests system is currently disabled.`);
  }
  return config;
}

/**
 * Transactional request number generation: REQ-YYYY-000123.
 */
export async function generateNextRequestNumberInTxn(txn: Transaction, year: number): Promise<string> {
  const counterRef = db.collection("counters").doc("requests");
  const snap = await txn.get(counterRef);
  let nextSeq = 1;

  if (snap.exists) {
    const data = snap.data() as RequestCounterDoc;
    if (data.year === year) {
      nextSeq = (data.currentSequence || 0) + 1;
    }
  }

  txn.set(counterRef, {
    year,
    currentSequence: nextSeq,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  const padded = String(nextSeq).padStart(6, "0");
  return `REQ-${year}-${padded}`;
}

/**
 * Checks rate limits and volume caps (Q-RQ10 / A-14).
 */
export async function assertRequestLimitsInTxn(
  txn: Transaction,
  orgId: string,
  userId: string,
  category: RequestCategory,
  settings?: PlatformSettingsRequestsDoc
): Promise<void> {
  const maxPerUser = settings?.limits?.maxOpenPerUser ?? 10;
  const maxPerOrg = settings?.limits?.maxOpenPerOrg ?? 50;
  const maxPerHour = settings?.limits?.maxCreationsPerHourPerUser ?? 10;

  // 1. Check one open plan_change per org (D-43)
  if (category === RequestCategory.PLAN_CHANGE) {
    const existingPlanChanges = await txn.get(
      db.collection("requests")
        .where("organizationId", "==", orgId)
        .where("category", "==", RequestCategory.PLAN_CHANGE)
    );
    const hasOpen = existingPlanChanges.docs.some((d) => {
      const status = (d.data() as RequestDoc).status;
      return OPEN_STATUSES.has(status);
    });
    if (hasOpen) {
      throw new HttpsError("already-exists", `[${RequestReason.REQUEST_DUPLICATE_OPEN}] An open plan change request already exists for this organization.`);
    }
  }

  // 2. User open requests limit
  const userOpenSnap = await txn.get(
    db.collection("requests")
      .where("requester.uid", "==", userId)
  );
  const userOpenCount = userOpenSnap.docs.filter((d) => OPEN_STATUSES.has((d.data() as RequestDoc).status)).length;
  if (userOpenCount >= maxPerUser) {
    throw new HttpsError("resource-exhausted", `[${RequestReason.REQUEST_LIMIT_REACHED}] User has reached maximum open request limit of ${maxPerUser}.`);
  }

  // 3. Organization open requests limit
  const orgOpenSnap = await txn.get(
    db.collection("requests")
      .where("organizationId", "==", orgId)
  );
  const orgOpenCount = orgOpenSnap.docs.filter((d) => OPEN_STATUSES.has((d.data() as RequestDoc).status)).length;
  if (orgOpenCount >= maxPerOrg) {
    throw new HttpsError("resource-exhausted", `[${RequestReason.REQUEST_LIMIT_REACHED}] Organization has reached maximum open request limit of ${maxPerOrg}.`);
  }

  // 4. User hourly creations rate limit
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const recentUserSnap = await txn.get(
    db.collection("requests")
      .where("requester.uid", "==", userId)
      .where("createdAt", ">=", oneHourAgo)
  );
  if (recentUserSnap.size >= maxPerHour) {
    throw new HttpsError("resource-exhausted", `[${RequestReason.REQUEST_RATE_LIMITED}] User has exceeded the hourly request creation limit of ${maxPerHour}.`);
  }
}

export interface BlockerViolation {
  code: string;
  message: string;
  current: unknown;
  allowed: unknown;
}

/**
 * Evaluates plan downgrade blockers server-side (D-44).
 */
export function computePlanChangeBlockers(
  orgDoc: OrganizationDoc,
  targetPlan: SubscriptionPlanDoc,
  currentBranchCount: number,
  currentActiveStaffCount: number
): BlockerViolation[] {
  const blockers: BlockerViolation[] = [];

  // Branch limit check
  const maxBranches = targetPlan.branchLimit ?? 9999;
  if (currentBranchCount > maxBranches) {
    blockers.push({
      code: "BRANCH_LIMIT_EXCEEDED",
      message: `Organization has ${currentBranchCount} branches, but target plan allows only ${maxBranches}.`,
      current: currentBranchCount,
      allowed: maxBranches,
    });
  }

  // Staff seat limit check
  const maxStaff = (targetPlan.seatLimits?.admin || 0) + (targetPlan.seatLimits?.staff || 0);
  if (currentActiveStaffCount > maxStaff) {
    blockers.push({
      code: "STAFF_LIMIT_EXCEEDED",
      message: `Organization has ${currentActiveStaffCount} active staff members, but target plan allows only ${maxStaff}.`,
      current: currentActiveStaffCount,
      allowed: maxStaff,
    });
  }

  // Module toggles check
  const targetModules = targetPlan.moduleFlags || {};
  const orgModules = orgDoc.moduleToggles || {};
  for (const [moduleKey, enabled] of Object.entries(orgModules)) {
    if (enabled && targetModules[moduleKey] === false) {
      blockers.push({
        code: "MODULE_DISABLED_IN_TARGET_PLAN",
        message: `Module "${moduleKey}" is currently enabled for this organization, but is disabled in target plan.`,
        current: moduleKey,
        allowed: false,
      });
    }
  }

  return blockers;
}

/**
 * Validates state transition according to Appendix B state machine.
 */
export function validateStateTransition(
  currentStatus: RequestStatus,
  action: RequestAction,
  kind: RequestKind,
  isPlatformHandler: boolean,
  isOrgManager: boolean,
  isRequester: boolean,
  requestAudience: RequestAudience
): { nextStatus: RequestStatus } {
  // Common requester actions
  if (action === RequestAction.RESPOND) {
    if (!isRequester) {
      throw new HttpsError("permission-denied", "Only the requester can respond to information requests.");
    }
    if (currentStatus !== RequestStatus.NEEDS_INFO) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "respond" action only valid from "needs_info" status.`);
    }
    return { nextStatus: RequestStatus.IN_REVIEW };
  }

  if (action === RequestAction.CANCEL) {
    if (!isRequester && !isPlatformHandler) {
      throw new HttpsError("permission-denied", "Only requester or platform operator can cancel a request.");
    }
    if (![RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW, RequestStatus.NEEDS_INFO, RequestStatus.ON_HOLD].includes(currentStatus)) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] Cannot cancel request in "${currentStatus}" status.`);
    }
    return { nextStatus: RequestStatus.CANCELLED };
  }

  if (action === RequestAction.CLOSE) {
    if (!isRequester && !isPlatformHandler) {
      throw new HttpsError("permission-denied", "Only requester can close a resolved request.");
    }
    if (currentStatus !== RequestStatus.RESOLVED) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "close" only valid from "resolved" status.`);
    }
    return { nextStatus: RequestStatus.CLOSED };
  }

  if (action === RequestAction.REOPEN) {
    if (kind !== RequestKind.WORK) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] Approval requests cannot be reopened.`);
    }
    if (![RequestStatus.RESOLVED, RequestStatus.CLOSED].includes(currentStatus)) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "reopen" only valid from "resolved" or "closed" status.`);
    }
    return { nextStatus: RequestStatus.IN_REVIEW };
  }

  // Handler actions validation based on audience
  const isHandler = requestAudience === RequestAudience.ORGANIZATION ? isOrgManager : isPlatformHandler;
  if (!isHandler) {
    throw new HttpsError("permission-denied", `Caller lacks privileges to manage ${requestAudience} audience requests.`);
  }

  switch (action) {
    case RequestAction.START_REVIEW:
      if (currentStatus !== RequestStatus.SUBMITTED) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "start_review" only valid from "submitted".`);
      }
      return { nextStatus: RequestStatus.IN_REVIEW };

    case RequestAction.REQUEST_INFO:
      if (![RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "request_info" only valid from "submitted" or "in_review".`);
      }
      return { nextStatus: RequestStatus.NEEDS_INFO };

    case RequestAction.HOLD:
      if (![RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "hold" only valid from "submitted" or "in_review".`);
      }
      return { nextStatus: RequestStatus.ON_HOLD };

    case RequestAction.RESUME:
      if (currentStatus !== RequestStatus.ON_HOLD) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "resume" only valid from "on_hold".`);
      }
      return { nextStatus: RequestStatus.IN_REVIEW };

    case RequestAction.APPROVE:
      if (kind !== RequestKind.APPROVAL) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "approve" only valid for approval kind requests.`);
      }
      if (![RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "approve" only valid from "submitted" or "in_review".`);
      }
      return { nextStatus: RequestStatus.APPROVED };

    case RequestAction.REJECT:
      if (kind !== RequestKind.APPROVAL) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "reject" only valid for approval kind requests.`);
      }
      if (![RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW, RequestStatus.APPROVED].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "reject" only valid from "submitted", "in_review", or "approved".`);
      }
      return { nextStatus: RequestStatus.REJECTED };

    case RequestAction.APPLY:
      if (kind !== RequestKind.APPROVAL) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "apply" only valid for approval kind requests.`);
      }
      if (currentStatus !== RequestStatus.APPROVED) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_NOT_APPROVED}] Request must be approved before apply.`);
      }
      return { nextStatus: RequestStatus.APPLIED };

    case RequestAction.START_WORK:
      if (kind !== RequestKind.WORK) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "start_work" only valid for work kind requests.`);
      }
      if (![RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "start_work" only valid from "submitted" or "in_review".`);
      }
      return { nextStatus: RequestStatus.IN_PROGRESS };

    case RequestAction.RESOLVE:
      if (kind !== RequestKind.WORK) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "resolve" only valid for work kind requests.`);
      }
      if (![RequestStatus.IN_REVIEW, RequestStatus.IN_PROGRESS].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "resolve" only valid from "in_review" or "in_progress".`);
      }
      return { nextStatus: RequestStatus.RESOLVED };

    case RequestAction.DECLINE:
      if (kind !== RequestKind.WORK) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "decline" only valid for work kind requests.`);
      }
      if (![RequestStatus.IN_REVIEW, RequestStatus.IN_PROGRESS].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] "decline" only valid from "in_review" or "in_progress".`);
      }
      return { nextStatus: RequestStatus.DECLINED };

    default:
      throw new HttpsError("invalid-argument", `[${RequestReason.REQUEST_INVALID_TRANSITION}] Unknown action "${action}".`);
  }
}

/**
 * Strips internal notes on tenant read paths (D-38).
 */
export function filterActivityForTenant(
  activities: RequestActivityDoc[],
  hasInternalNotesPermission: boolean
): RequestActivityDoc[] {
  if (hasInternalNotesPermission) return activities;
  return activities.filter((a) => a.visibility !== "internal");
}
