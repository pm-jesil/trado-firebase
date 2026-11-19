/**
 * Requests & Support Desk - Platform Staff Callables
 *
 * - requestsTransition: State machine transition execution (D-37)
 * - requestsInboxList: Platform-wide unified request inbox
 * - requestsInboxCounts: Platform triage badge counters
 * - requestsAssign: Assign/reassign handler
 * - requestsSetPriority: Priority & severity adjustment
 * - requestsAddInternalNote: Staff-only internal note timeline entry (D-38)
 * - requestsApply: Execute approved request mutations (D-39, D-44)
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { parseInput } from "../../validation/parseInput.js";
import { db } from "../../services/firebase.js";
import { resolveRequestContext, invalidatePlanCache } from "../../services/contextResolver.js";
import { AppPermissions } from "../../constants/permissions.js";
import {
  RequestCategory,
  RequestAudience,
  RequestKind,
  RequestStatus,
  SlaState,
  RequestAction,
  RequestReason,
} from "../../constants/enums.js";
import {
  TransitionRequestSchema,
  InboxListRequestsSchema,
  InboxCountsRequestsSchema,
  AssignRequestSchema,
  SetRequestPrioritySchema,
  AddInternalNoteSchema,
  ApplyRequestSchema,
  GetRequestsSettingsSchema,
  UpdateRequestsSettingsSchema,
} from "../../validation/schemas.js";
import {
  RequestDoc,
  RequestActivityDoc,
  RequestAttachment,
  OrganizationDoc,
  SubscriptionPlanDoc,
  MetricLimitConfig,
  PlatformSettingsRequestsDoc,
} from "../../types/models.js";
import {
  assertRequestsFeatureEnabled,
  evaluateSlaState,
  applySlaResume,
  computePlanChangeBlockers,
  validateStateTransition,
  OPEN_STATUSES,
  DEFAULT_REQUESTS_SETTINGS,
  DEFAULT_SLA_HOURS,
} from "../../services/requestsService.js";
import { getCallerName } from "./helpers.js";

/**
 * 6. requestsTransition
 * The single, atomic state transition entry point for requesters and handlers (D-37).
 */
export const requestsTransition = onCall({ region: "asia-south1" }, async (request) => {
  const settings = await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });
  const input = parseInput(TransitionRequestSchema, request.data);
  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const current = snap.data() as RequestDoc;

    // Concurrency check (compare-and-set)
    if (current.status !== input.expectedStatus) {
      throw new HttpsError("aborted", `[${RequestReason.REQUEST_STALE_STATUS}] Conflict: expected "${input.expectedStatus}" but current status is "${current.status}".`);
    }

    const isRequester = current.requester.uid === context.callerUid;
    const isPlatformHandler = context.isSuperAdmin || context.can(AppPermissions.PLATFORM_REQUESTS_MANAGE);
    const isOrgManager = (context.organizationId === current.organizationId) &&
      (context.isOwner || context.can(AppPermissions.REQUEST_MANAGE_ORG));

    const now = new Date();
    const { nextStatus } = validateStateTransition(
      current.status,
      input.action as RequestAction,
      current.kind as RequestKind,
      isPlatformHandler,
      isOrgManager,
      isRequester,
      current.audience as RequestAudience,
      {
        resolvedAt: current.resolvedAt,
        closedAt: current.closedAt,
        statusChangedAt: current.statusChangedAt,
        reopenWindowDays: settings.reopenWindowDays,
        now,
      }
    );

    const nowIso = now.toISOString();
    const updates: Partial<RequestDoc> = {
      status: nextStatus,
      statusReason: input.reason || null,
      statusChangedAt: nowIso,
      lastActivityAt: nowIso,
      lastActivityBy: {
        uid: context.callerUid,
        name: getCallerName(request, context),
        isPlatform: context.isSuperAdmin,
      },
      updatedAt: nowIso,
      version: current.version + 1,
    };

    // SLA & Lifecycle side-effects
    if (input.action === RequestAction.START_REVIEW && !current.firstResponseAt) {
      updates.firstResponseAt = nowIso;
    }

    if (input.action === RequestAction.REQUEST_INFO || input.action === RequestAction.HOLD) {
      updates.slaPausedAt = nowIso;
      updates.slaState = SlaState.PAUSED;
      if (input.action === RequestAction.HOLD && input.resumeOn) {
        updates.resumeOn = input.resumeOn;
      }
    }

    if (input.action === RequestAction.RESPOND || input.action === RequestAction.RESUME) {
      const resumed = applySlaResume(current, now);
      updates.slaTotalPausedMs = resumed.slaTotalPausedMs;
      updates.slaPausedAt = null;
      updates.slaState = evaluateSlaState({ ...current, ...updates } as RequestDoc, now);
      updates.resumeOn = null;
    }

    if (input.action === RequestAction.RESOLVE) {
      updates.resolvedAt = nowIso;
    }

    if (input.action === RequestAction.CLOSE) {
      updates.closedAt = nowIso;
    }

    txn.update(reqRef, updates);

    // Timeline entry
    const activityRef = reqRef.collection("activity").doc();
    const activityDoc: RequestActivityDoc = {
      requestId: input.requestId,
      type: "status_change",
      visibility: "public",
      author: {
        uid: context.callerUid,
        name: getCallerName(request, context),
        roleLabel: context.role?.name || (context.isSuperAdmin ? "Platform Admin" : "Member"),
        isPlatform: context.isSuperAdmin,
      },
      content: input.note || input.reason || `Status changed to ${nextStatus}`,
      details: {
        previousStatus: current.status,
        nextStatus,
        action: input.action,
        resolutionType: input.resolutionType,
      },
      createdAt: nowIso,
    };
    txn.set(activityRef, activityDoc);

    const updatedRequest: RequestDoc = {
      ...current,
      ...updates,
    };

    return {
      success: true,
      requestId: input.requestId,
      previousStatus: current.status,
      status: nextStatus,
      request: { ...updatedRequest, requestId: input.requestId },
    };
  });
});

/**
 * 11. requestsInboxList
 * Cross-organization Super Admin inbox list (platform audience only).
 */
export const requestsInboxList = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_REQUESTS_READ,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin && !context.can(AppPermissions.PLATFORM_REQUESTS_READ)) {
    throw new HttpsError("permission-denied", "Super Admin platform privileges required.");
  }

  const input = parseInput(InboxListRequestsSchema, request.data);

  let query: FirebaseFirestore.Query = db.collection("requests")
    .where("audience", "==", RequestAudience.PLATFORM);

  if (input.targetOrganizationId) {
    query = query.where("organizationId", "==", input.targetOrganizationId);
  }

  query = query.orderBy(input.sortBy || "lastActivityAt", input.sortOrder || "desc").limit(input.limit || 50);

  const snap = await query.get();
  const items = snap.docs
    .map((d) => ({ requestId: d.id, ...(d.data() as RequestDoc) }))
    .filter((r) => {
      if (input.status && input.status.length && !input.status.includes(r.status)) return false;
      if (input.category && input.category.length && !input.category.includes(r.category)) return false;
      if (input.priority && input.priority.length && !(input.priority as string[]).includes(r.priority)) return false;
      if (input.slaState && r.slaState !== input.slaState) return false;
      if (input.assignee === "unassigned" && r.assignee) return false;
      if (input.assignee === "me" && r.assignee?.uid !== context.callerUid) return false;
      if (input.assignee && input.assignee !== "me" && input.assignee !== "unassigned" && r.assignee?.uid !== input.assignee) return false;
      if (input.search && !r.title.toLowerCase().includes(input.search.toLowerCase()) && !r.requestNumber.toLowerCase().includes(input.search.toLowerCase())) return false;
      return true;
    });

  return {
    items,
    count: items.length,
    totalCount: items.length,
    nextCursor: snap.docs.length >= (input.limit || 50) ? snap.docs[snap.docs.length - 1].id : null,
  };
});

/**
 * 12. requestsInboxCounts
 * Aggregations for Super Admin inbox badges.
 */
export const requestsInboxCounts = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(InboxCountsRequestsSchema, request.data);
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_REQUESTS_READ,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin && !context.can(AppPermissions.PLATFORM_REQUESTS_READ)) {
    throw new HttpsError("permission-denied", "Platform read privileges required.");
  }

  const snap = await db.collection("requests")
    .where("audience", "==", RequestAudience.PLATFORM)
    .get();

  let unassigned = 0;
  let mine = 0;
  let onHold = 0;
  let atRisk = 0;
  let breached = 0;
  const byCategory: Record<string, number> = {};

  for (const doc of snap.docs) {
    const r = doc.data() as RequestDoc;
    if (OPEN_STATUSES.has(r.status)) {
      if (!r.assignee) unassigned++;
      if (r.assignee?.uid === context.callerUid) mine++;
      if (r.status === RequestStatus.ON_HOLD) onHold++;
      if (r.slaState === SlaState.AT_RISK) atRisk++;
      if (r.slaState === SlaState.BREACHED) breached++;
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    }
  }

  return {
    unassigned,
    mine,
    onHold,
    atRisk,
    breached,
    byCategory,
  };
});

/**
 * 13. requestsAssign
 * Assigns or reassigns a request.
 */
export const requestsAssign = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_REQUESTS_MANAGE,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin && !context.can(AppPermissions.PLATFORM_REQUESTS_MANAGE)) {
    throw new HttpsError("permission-denied", "Platform manage privileges required.");
  }

  const input = parseInput(AssignRequestSchema, request.data);
  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const current = snap.data() as RequestDoc;
    const nowIso = new Date().toISOString();

    const assignee = input.assigneeUid ? {
      uid: input.assigneeUid,
      name: input.assigneeName || "Handler",
    } : null;

    const updates: Partial<RequestDoc> = {
      assignee,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
      lastActivityBy: {
        uid: context.callerUid,
        name: "Super Admin",
        isPlatform: true,
      },
    };

    if (input.startReview && current.status === RequestStatus.SUBMITTED) {
      updates.status = RequestStatus.IN_REVIEW;
      updates.statusChangedAt = nowIso;
      if (!current.firstResponseAt) updates.firstResponseAt = nowIso;
    }

    txn.update(reqRef, updates);

    const activityRef = reqRef.collection("activity").doc();
    txn.set(activityRef, {
      requestId: input.requestId,
      type: "assignment",
      visibility: "public",
      author: {
        uid: context.callerUid,
        name: "Super Admin",
        roleLabel: "Platform Admin",
        isPlatform: true,
      },
      content: assignee ? `Assigned to ${assignee.name}` : "Unassigned",
      createdAt: nowIso,
    });

    return { success: true, assignee };
  });
});

/**
 * 14. requestsSetPriority
 * Sets priority and severity on a request (Super Admin).
 */
export const requestsSetPriority = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_REQUESTS_MANAGE,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin && !context.can(AppPermissions.PLATFORM_REQUESTS_MANAGE)) {
    throw new HttpsError("permission-denied", "Platform manage privileges required.");
  }

  const input = parseInput(SetRequestPrioritySchema, request.data);
  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const current = snap.data() as RequestDoc;
    const nowIso = new Date().toISOString();

    const updates: Partial<RequestDoc> = {
      priority: input.priority,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
    };
    if (input.severity) updates.severity = input.severity;

    txn.update(reqRef, updates);

    const activityRef = reqRef.collection("activity").doc();
    txn.set(activityRef, {
      requestId: input.requestId,
      type: "priority_change",
      visibility: "public",
      author: {
        uid: context.callerUid,
        name: "Super Admin",
        roleLabel: "Platform Admin",
        isPlatform: true,
      },
      content: `Priority changed from ${current.priority} to ${input.priority}`,
      createdAt: nowIso,
    });

    return { success: true, priority: input.priority };
  });
});

/**
 * 15. requestsAddInternalNote
 * Adds an internal note visible ONLY to platform users (D-38).
 */
export const requestsAddInternalNote = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_REQUESTS_INTERNAL_NOTES,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin && !context.can(AppPermissions.PLATFORM_REQUESTS_INTERNAL_NOTES)) {
    throw new HttpsError("permission-denied", "Internal notes privilege required.");
  }

  const input = parseInput(AddInternalNoteSchema, request.data);
  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const nowIso = new Date().toISOString();

    const activityRef = reqRef.collection("activity").doc();
    const activityDoc: RequestActivityDoc = {
      requestId: input.requestId,
      type: "comment",
      visibility: "internal", // D-38: strictly internal
      author: {
        uid: context.callerUid,
        name: "Super Admin",
        roleLabel: "Platform Operator",
        isPlatform: true,
      },
      content: input.content,
      attachments: input.attachments as RequestAttachment[] | undefined,
      createdAt: nowIso,
    };

    txn.set(activityRef, activityDoc);
    txn.update(reqRef, {
      lastActivityAt: nowIso,
      updatedAt: nowIso,
    });

    return { success: true, activityId: activityRef.id };
  });
});

/**
 * 16. requestsApply
 * Executes approved mutation (plan, limit, module) in one commit (D-39, D-44).
 */
export const requestsApply = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_REQUESTS_APPLY,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin && !context.can(AppPermissions.PLATFORM_REQUESTS_APPLY)) {
    throw new HttpsError("permission-denied", "Platform apply privileges required.");
  }

  const input = parseInput(ApplyRequestSchema, request.data);
  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const current = snap.data() as RequestDoc;

    if (current.status === RequestStatus.APPLIED) {
      // Idempotent retry: safe to call again after lost response (D-39)
      return { success: true, alreadyApplied: true, applyResult: current.applyResult, request: current };
    }

    if (current.status !== RequestStatus.APPROVED) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_NOT_APPROVED}] Request must be approved before apply.`);
    }

    const orgRef = db.collection("organizations").doc(current.organizationId);
    const orgSnap = await txn.get(orgRef);
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const orgData = orgSnap.data() as OrganizationDoc;
    const nowIso = new Date().toISOString();
    let applyResult: Record<string, unknown> = {};

    if (current.category === RequestCategory.PLAN_CHANGE) {
      const details = current.details as { requestedPlanId: string };
      const planRef = db.collection("subscriptionPlans").doc(details.requestedPlanId);
      const planSnap = await txn.get(planRef);
      if (!planSnap.exists || !(planSnap.data() as SubscriptionPlanDoc).isActive) {
        throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_PLAN_UNAVAILABLE}] Target plan is inactive or unavailable.`);
      }
      const targetPlan = planSnap.data() as SubscriptionPlanDoc;

      // Re-evaluate blockers in real time
      const branchesSnap = await txn.get(orgRef.collection("branches"));
      const blockers = computePlanChangeBlockers(
        orgData,
        targetPlan,
        branchesSnap.size,
        orgData.activeEmployeeCount || 0
      );

      if (blockers.length > 0) {
        const canOverride = context.isSuperAdmin || context.can(AppPermissions.PLATFORM_REQUESTS_OVERRIDE_BLOCKERS);
        if (!canOverride || !input.overrideReason) {
          throw new HttpsError(
            "failed-precondition",
            `[${RequestReason.REQUEST_APPLY_BLOCKED}] Plan change has ${blockers.length} active blockers. Override requires platform:requests_override_blockers and an overrideReason.`,
            { blockers }
          );
        }
      }

      txn.update(orgRef, {
        planId: details.requestedPlanId,
        updatedAt: nowIso,
        updatedBy: context.callerUid,
      });

      applyResult = {
        action: "plan_change",
        previousPlanId: orgData.planId,
        newPlanId: details.requestedPlanId,
        overriddenBlockers: blockers.length > 0 ? blockers : undefined,
      };
      invalidatePlanCache(details.requestedPlanId);
    } else if (current.category === RequestCategory.LIMIT_INCREASE) {
      const details = current.details as { metric: string; period: "daily" | "monthly"; requestedLimit: number };
      const overrides = orgData.usageLimitOverrides || {};
      const existing = overrides[details.metric as keyof typeof overrides];
      const metricOverride: MetricLimitConfig = {
        warningThresholdPercent: existing?.warningThresholdPercent ?? 80,
        hardThresholdPercent: existing?.hardThresholdPercent ?? 100,
        enforcementMode: existing?.enforcementMode ?? "warn_only",
        enabled: true,
        ...(existing || {}),
      };

      if (details.period === "daily") {
        metricOverride.dailyLimit = details.requestedLimit;
      } else {
        metricOverride.monthlyLimit = details.requestedLimit;
      }

      overrides[details.metric as keyof typeof overrides] = metricOverride;
      txn.update(orgRef, {
        usageLimitOverrides: overrides,
        updatedAt: nowIso,
      });
      applyResult = { action: "limit_increase", metric: details.metric, period: details.period, limit: details.requestedLimit };
    } else if (current.category === RequestCategory.MODULE_REQUEST) {
      const details = current.details as { moduleKey: string; action: "enable" | "disable" };
      const toggles = orgData.moduleToggles || {};
      toggles[details.moduleKey] = details.action === "enable";

      txn.update(orgRef, {
        moduleToggles: toggles,
        updatedAt: nowIso,
      });
      applyResult = { action: "module_request", moduleKey: details.moduleKey, enabled: details.action === "enable" };
    } else {
      applyResult = { action: "manual", note: "Approved changes marked as applied manually by platform operator" };
    }

    // Update request to applied
    txn.update(reqRef, {
      status: RequestStatus.APPLIED,
      statusChangedAt: nowIso,
      appliedAt: nowIso,
      appliedBy: context.callerUid,
      applyResult,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
      version: current.version + 1,
    });

    // Timeline entry
    const activityRef = reqRef.collection("activity").doc();
    txn.set(activityRef, {
      requestId: input.requestId,
      type: "apply",
      visibility: "public",
      author: {
        uid: context.callerUid,
        name: "Super Admin",
        roleLabel: "Platform Admin",
        isPlatform: true,
      },
      content: `Request applied: ${JSON.stringify(applyResult)}`,
      createdAt: nowIso,
    });

    const updatedRequest: RequestDoc = {
      ...current,
      status: RequestStatus.APPLIED,
      statusChangedAt: nowIso,
      appliedAt: nowIso,
      appliedBy: context.callerUid,
      applyResult,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
      version: current.version + 1,
    };

    return { success: true, requestId: input.requestId, status: RequestStatus.APPLIED, applyResult, request: { ...updatedRequest, requestId: input.requestId } };
  });
});

/**
 * 17. requestsSettingsGet (Q-B9 / A-26, RH-9)
 * Super Admin only (`platform:requests_configure`). Returns current `platformSettings/requests`
 * merged with safe defaults (`requestsEnabled: false` on a fresh database).
 */
export const requestsSettingsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError(
      "permission-denied",
      "Super Admin privileges with platform:requests_configure are required to read requests settings."
    );
  }
  parseInput(GetRequestsSettingsSchema, request.data || {});
  const snap = await db.collection("platformSettings").doc("requests").get();
  const raw = snap.exists ? (snap.data() as Partial<PlatformSettingsRequestsDoc>) : {};
  const settings: PlatformSettingsRequestsDoc = {
    ...DEFAULT_REQUESTS_SETTINGS,
    ...raw,
    sla: { ...DEFAULT_SLA_HOURS, ...(raw.sla || {}) },
    limits: { ...DEFAULT_REQUESTS_SETTINGS.limits, ...(raw.limits || {}) },
  };
  return {
    settings,
    persisted: snap.exists,
  };
});

/**
 * 18. requestsSettingsUpdate (Q-B9 / A-26, RH-9)
 * Super Admin only (`platform:requests_configure`). Updates `platformSettings/requests` with
 * validated bounds on SLA targets, volume limits, and lifecycle windows (`reopenWindowDays`).
 * Audited automatically via meteredFirestore + auditRecorder (D-23).
 */
export const requestsSettingsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError(
      "permission-denied",
      "Super Admin privileges with platform:requests_configure are required to update requests settings."
    );
  }
  const input = parseInput(UpdateRequestsSettingsSchema, request.data);
  const settingsRef = db.collection("platformSettings").doc("requests");

  const updated = await db.runTransaction(async (txn) => {
    const snap = await txn.get(settingsRef);
    const existing = snap.exists ? (snap.data() as Partial<PlatformSettingsRequestsDoc>) : {};
    const mergedSla = {
      urgent: { ...DEFAULT_SLA_HOURS.urgent, ...(existing.sla?.urgent || {}), ...(input.sla?.urgent || {}) },
      high: { ...DEFAULT_SLA_HOURS.high, ...(existing.sla?.high || {}), ...(input.sla?.high || {}) },
      normal: { ...DEFAULT_SLA_HOURS.normal, ...(existing.sla?.normal || {}), ...(input.sla?.normal || {}) },
      low: { ...DEFAULT_SLA_HOURS.low, ...(existing.sla?.low || {}), ...(input.sla?.low || {}) },
    };
    for (const [prio, win] of Object.entries(mergedSla)) {
      if (win.firstResponseHours > win.resolutionHours) {
        throw new HttpsError(
          "invalid-argument",
          `SLA "${prio}": firstResponseHours (${win.firstResponseHours}) cannot exceed resolutionHours (${win.resolutionHours}).`
        );
      }
    }
    const next: PlatformSettingsRequestsDoc = {
      requestsEnabled: input.requestsEnabled ?? existing.requestsEnabled ?? DEFAULT_REQUESTS_SETTINGS.requestsEnabled,
      sla: mergedSla,
      limits: {
        maxOpenPerUser: input.limits?.maxOpenPerUser ?? existing.limits?.maxOpenPerUser ?? DEFAULT_REQUESTS_SETTINGS.limits.maxOpenPerUser,
        maxOpenPerOrg: input.limits?.maxOpenPerOrg ?? existing.limits?.maxOpenPerOrg ?? DEFAULT_REQUESTS_SETTINGS.limits.maxOpenPerOrg,
        maxCreationsPerHourPerUser: input.limits?.maxCreationsPerHourPerUser ?? existing.limits?.maxCreationsPerHourPerUser ?? DEFAULT_REQUESTS_SETTINGS.limits.maxCreationsPerHourPerUser,
      },
      autoCloseDays: input.autoCloseDays ?? existing.autoCloseDays ?? DEFAULT_REQUESTS_SETTINGS.autoCloseDays,
      reopenWindowDays: input.reopenWindowDays ?? existing.reopenWindowDays ?? DEFAULT_REQUESTS_SETTINGS.reopenWindowDays,
      needsInfoReminderDays: input.needsInfoReminderDays ?? existing.needsInfoReminderDays ?? DEFAULT_REQUESTS_SETTINGS.needsInfoReminderDays,
      needsInfoAutoCancelDays: input.needsInfoAutoCancelDays ?? existing.needsInfoAutoCancelDays ?? DEFAULT_REQUESTS_SETTINGS.needsInfoAutoCancelDays,
      updatedAt: new Date().toISOString(),
      updatedBy: request.auth!.uid,
    };
    txn.set(settingsRef, next, { merge: true });
    return next;
  });

  return {
    success: true,
    settings: updated,
    permissionRequired: AppPermissions.PLATFORM_REQUESTS_CONFIGURE,
  };
});
