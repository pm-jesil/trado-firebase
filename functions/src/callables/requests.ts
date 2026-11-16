/**
 * Requests & Support Desk Callables (Prompt 74, D-36..D-45)
 *
 * Exposes requester callables, platform inbox callables, state machine transition,
 * and automated apply engine.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { parseInput } from "../validation/parseInput.js";
import { db } from "../services/firebase.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  RequestCategory,
  RequestAudience,
  RequestKind,
  RequestStatus,
  SlaState,
  RequestAction,
  RequestReason,
} from "../constants/enums.js";
import {
  CreateRequestSchema,
  UpdateRequestSchema,
  AddRequestCommentSchema,
  TransitionRequestSchema,
  GetRequestSchema,
  ListRequestsSchema,
  ListRequestActivitySchema,
  GetRequestCountsSchema,
  InboxListRequestsSchema,
  InboxCountsRequestsSchema,
  AssignRequestSchema,
  SetRequestPrioritySchema,
  AddInternalNoteSchema,
  ApplyRequestSchema,
  ListPlansCatalogSchema,
  GetRequestsMetaSchema,
  CATEGORY_DETAILS_SCHEMAS,
} from "../validation/schemas.js";
import {
  RequestDoc,
  RequestActivityDoc,
  RequestAttachment,
  OrganizationDoc,
  SubscriptionPlanDoc,
  MetricLimitConfig,
} from "../types/models.js";

function getCallerName(request: { auth?: { token?: Record<string, unknown> } }, context: { callerUid: string }): string {
  return (request.auth?.token?.name as string) || (request.auth?.token?.email as string) || context.callerUid || "Requester";
}
import {
  assertRequestsFeatureEnabled,
  getCategoryKind,
  getCategoryAudience,
  calculateDefaultPriority,
  computeSlaDeadlines,
  evaluateSlaState,
  applySlaResume,
  generateNextRequestNumberInTxn,
  assertRequestLimitsInTxn,
  computePlanChangeBlockers,
  validateStateTransition,
  filterActivityForTenant,
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_SLA_HOURS,
} from "../services/requestsService.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";
import { invalidatePlanCache } from "../services/contextResolver.js";

const SENSITIVE_CATEGORIES = new Set([
  RequestCategory.PLAN_CHANGE,
  RequestCategory.LIMIT_INCREASE,
  RequestCategory.MODULE_REQUEST,
  RequestCategory.ORG_PROFILE_CHANGE,
  RequestCategory.OWNERSHIP_TRANSFER,
  RequestCategory.DATA_REQUEST,
]);

/**
 * 1. requestsMeta
 * Returns metadata and limits to build the "new request" screen.
 */
export const requestsMeta = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(GetRequestsMetaSchema, request.data);
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request);

  const orgId = context.organizationId;
  const userId = context.callerUid;
  const canSensitive = context.can(AppPermissions.REQUEST_CREATE_SENSITIVE) || context.isOwner || context.isSuperAdmin;

  const [userOpenSnap, orgOpenSnap, planChangeSnap] = await Promise.all([
    db.collection("requests").where("requester.uid", "==", userId).get(),
    db.collection("requests").where("organizationId", "==", orgId).get(),
    db.collection("requests")
      .where("organizationId", "==", orgId)
      .where("category", "==", RequestCategory.PLAN_CHANGE)
      .get(),
  ]);

  const userOpenCount = userOpenSnap.docs.filter((d) => OPEN_STATUSES.has((d.data() as RequestDoc).status)).length;
  const orgOpenCount = orgOpenSnap.docs.filter((d) => OPEN_STATUSES.has((d.data() as RequestDoc).status)).length;

  let openPlanChangeId: string | null = null;
  for (const doc of planChangeSnap.docs) {
    if (OPEN_STATUSES.has((doc.data() as RequestDoc).status)) {
      openPlanChangeId = doc.id;
      break;
    }
  }

  const availableCategories = Object.values(RequestCategory).filter((cat) => {
    if (SENSITIVE_CATEGORIES.has(cat)) return canSensitive;
    return true;
  });

  return {
    availableCategories,
    userOpenCount,
    orgOpenCount,
    limits: {
      maxOpenPerUser: 10,
      maxOpenPerOrg: 50,
      maxCreationsPerHourPerUser: 10,
    },
    openPlanChangeId,
    slaHours: DEFAULT_SLA_HOURS,
    allowDiagnostics: true,
  };
});

/**
 * 2. plansCatalogList
 * Tenant-safe public plan catalog with caller's own current usage.
 */
export const plansCatalogList = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request);
  const input = parseInput(ListPlansCatalogSchema, request.data);

  const plansSnap = await db.collection("subscriptionPlans").get();
  const plans = plansSnap.docs
    .map((d) => ({ planId: d.id, ...d.data() } as SubscriptionPlanDoc & { planId: string }))
    .filter((p) => {
      if (p.isArchived) return false;
      if (!input.includeInactive && !p.isActive) return false;
      if (context.isSuperAdmin) return true;
      return p.isPublic !== false;
    })
    .map((p) => ({
      planId: p.planId,
      name: p.name,
      storageLimitMb: p.storageLimitMb,
      monthlyDocumentVolumeLimit: p.monthlyDocumentVolumeLimit,
      seatLimits: p.seatLimits,
      branchLimit: p.branchLimit,
      moduleFlags: p.moduleFlags,
      price: p.showPriceToTenants ? p.price : null,
      currency: p.showPriceToTenants ? p.currency : null,
      isActive: p.isActive,
    }));

  const branchesSnap = await db.collection("organizations").doc(context.organizationId).collection("branches").get();
  const branchesCount = branchesSnap.size;
  const activeStaffCount = context.organization.activeEmployeeCount || 0;

  return {
    items: plans,
    count: plans.length,
    currentSubscription: {
      planId: context.organization.planId || null,
      planName: context.plan.name,
      subscriptionStatus: context.organization.subscriptionStatus || "active",
      subscriptionExpiresAt: context.organization.subscriptionExpiresAt || null,
      branchesCount,
      activeStaffCount,
    },
  };
});

/**
 * 3. requestsCreate
 * Submits a new request with strict category detail validation.
 */
export const requestsCreate = onCall({ region: "asia-south1" }, async (request) => {
  const settings = await assertRequestsFeatureEnabled();
  const input = parseInput(CreateRequestSchema, request.data);

  const isSensitive = SENSITIVE_CATEGORIES.has(input.category);
  const requiredPermission = isSensitive ? AppPermissions.REQUEST_CREATE_SENSITIVE : AppPermissions.REQUEST_CREATE;

  const context = await resolveRequestContext(request, {
    requiredPermission: isSensitive ? undefined : requiredPermission,
  });

  if (isSensitive && !context.can(AppPermissions.REQUEST_CREATE_SENSITIVE) && !context.isOwner && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", `[${RequestReason.REQUEST_CATEGORY_FORBIDDEN}] Category "${input.category}" requires owner or sensitive request privileges.`);
  }

  // 1. Validate Category Details strictly
  const detailsParser = CATEGORY_DETAILS_SCHEMAS[input.category];
  const parsedDetails = detailsParser.safeParse(input.details);
  if (!parsedDetails.success) {
    throw new HttpsError(
      "invalid-argument",
      `[${RequestReason.REQUEST_DETAILS_INVALID}] Details failed validation: ${parsedDetails.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      { issues: parsedDetails.error.issues }
    );
  }

  // 2. Validate Attachments
  for (const att of input.attachments || []) {
    if (!att.storagePath.startsWith(`tmp/${context.organizationId}/${context.callerUid}/`) &&
        !att.storagePath.startsWith(`tmp/platform/${context.callerUid}/`)) {
      throw new HttpsError("permission-denied", `[${RequestReason.REQUEST_ATTACHMENT_INVALID}] Attachment path "${att.storagePath}" is outside caller upload scope.`);
    }
  }

  // 3. Idempotency reservation
  const idempotencyKey = input.idempotencyKey || input.clientRequestId;
  let idempotencyRecordId: string | null = null;
  if (idempotencyKey) {
    const res = await reserveIdempotency({
      scope: context.organizationId,
      actorUid: context.callerUid,
      operation: "requests.create",
      clientKey: idempotencyKey,
      payload: request.data,
    });
    if (res.isDuplicate) {
      if (res.isProcessing) throw new HttpsError("already-exists", "Request creation in progress. Please retry shortly.");
      return res.cachedResult;
    }
    idempotencyRecordId = res.recordId;
  }

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const kind = getCategoryKind(input.category);
    const audience = input.audience || getCategoryAudience(input.category);
    const priority = input.priority || calculateDefaultPriority(input.category, input.severity);
    const deadlines = computeSlaDeadlines(priority, now, settings.sla);

    const result = await db.runTransaction(async (txn) => {
      // 1. Abuse & Limit checks (reads) in transaction
      await assertRequestLimitsInTxn(txn, context.organizationId, context.callerUid, input.category, settings);

      let currentPlanName: string | null = null;
      let requestedPlanName: string | null = null;

      if (input.category === RequestCategory.PLAN_CHANGE) {
        currentPlanName = context.plan.name;
        const targetPlanId = (parsedDetails.data as { requestedPlanId: string }).requestedPlanId;
        const targetSnap = await txn.get(db.collection("subscriptionPlans").doc(targetPlanId));
        if (targetSnap.exists) {
          requestedPlanName = (targetSnap.data() as SubscriptionPlanDoc).name;
        }
      }

      // 2. Request number generator (reads counter then writes counter)
      const year = now.getFullYear();
      const requestNumber = await generateNextRequestNumberInTxn(txn, year);
      const reqRef = db.collection("requests").doc();

      const requestDoc: RequestDoc = {
        requestId: reqRef.id,
        requestNumber,
        audience,
        category: input.category,
        kind,
        title: input.title,
        description: input.description,
        details: parsedDetails.data as Record<string, unknown>,
        priority,
        severity: input.severity,
        status: RequestStatus.SUBMITTED,
        statusReason: null,
        statusChangedAt: nowIso,
        requester: {
          uid: context.callerUid,
          name: getCallerName(request, context),
          roleLabel: context.role?.name || "Member",
        },
        organizationId: context.organizationId,
        branchId: input.branchId || context.branchId || null,
        relatedEntity: input.relatedEntity || null,
        assignee: null,
        attachments: (input.attachments || []) as RequestAttachment[],
        labels: input.labels || [],
        idempotencyKey: idempotencyKey || null,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastActivityAt: nowIso,
        lastActivityBy: {
          uid: context.callerUid,
          name: getCallerName(request, context),
          isPlatform: false,
        },
        firstResponseDueAt: deadlines.firstResponseDueAt,
        resolutionDueAt: deadlines.resolutionDueAt,
        firstResponseAt: null,
        slaState: SlaState.ON_TRACK,
        slaPausedAt: null,
        slaTotalPausedMs: 0,
        organizationName: context.organization.name,
        requesterName: getCallerName(request, context),
        currentPlanName,
        requestedPlanName,
      };

      txn.set(reqRef, requestDoc);

      // Create initial timeline entry (D-40)
      const activityRef = reqRef.collection("activity").doc();
      const activityDoc: RequestActivityDoc = {
        activityId: activityRef.id,
        requestId: reqRef.id,
        type: "status_change",
        visibility: "public",
        author: {
          uid: context.callerUid,
          name: getCallerName(request, context),
          roleLabel: context.role?.name || "Member",
          isPlatform: false,
        },
        content: "Request submitted",
        createdAt: nowIso,
      };
      txn.set(activityRef, activityDoc);

      return { request: requestDoc };
    });

    if (idempotencyRecordId) {
      await finalizeIdempotencySuccess(idempotencyRecordId, result);
    }
    return result;
  } catch (err) {
    if (idempotencyRecordId) {
      await finalizeIdempotencyFailure(idempotencyRecordId, "CREATE_REQUEST_FAILED", (err as Error).message);
    }
    throw err;
  }
});

/**
 * 4. requestsUpdate
 * Edits request while submitted or in needs_info.
 */
export const requestsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request);
  const input = parseInput(UpdateRequestSchema, request.data);

  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const current = snap.data() as RequestDoc;

    if (current.organizationId !== context.organizationId && !context.isSuperAdmin) {
      throw new HttpsError("permission-denied", "Cross-organization modification rejected.");
    }

    if (current.requester.uid !== context.callerUid && !context.isSuperAdmin) {
      throw new HttpsError("permission-denied", "Only requester can edit request details.");
    }

    if (![RequestStatus.SUBMITTED, RequestStatus.NEEDS_INFO].includes(current.status)) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] Cannot edit request while in status "${current.status}".`);
    }

    if (current.version !== input.expectedVersion) {
      throw new HttpsError("aborted", `[${RequestReason.REQUEST_STALE_STATUS}] Concurrent update conflict. Expected version ${input.expectedVersion}, found ${current.version}.`);
    }

    const updates: Partial<RequestDoc> = {
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      version: current.version + 1,
    };

    if (input.title) updates.title = input.title;
    if (input.description) updates.description = input.description;
    if (input.attachments) updates.attachments = input.attachments as RequestAttachment[];
    if (input.details) {
      const detailsParser = CATEGORY_DETAILS_SCHEMAS[current.category];
      const parsed = detailsParser.safeParse(input.details);
      if (!parsed.success) {
        throw new HttpsError("invalid-argument", `[${RequestReason.REQUEST_DETAILS_INVALID}] Details failed validation.`);
      }
      updates.details = parsed.data as Record<string, unknown>;
    }

    txn.update(reqRef, updates);

    const activityRef = reqRef.collection("activity").doc();
    txn.set(activityRef, {
      activityId: activityRef.id,
      requestId: current.requestId,
      type: "comment",
      visibility: "public",
      author: {
        uid: context.callerUid,
        name: getCallerName(request, context),
        roleLabel: context.role?.name || "Member",
        isPlatform: false,
      },
      content: "Request updated by author",
      createdAt: new Date().toISOString(),
    });

    return { success: true, version: updates.version };
  });
});

/**
 * 5. requestsAddComment
 * Appends a public comment to the request timeline.
 */
export const requestsAddComment = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request);
  const input = parseInput(AddRequestCommentSchema, request.data);

  const reqRef = db.collection("requests").doc(input.requestId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
    }
    const current = snap.data() as RequestDoc;

    if (current.organizationId !== context.organizationId && !context.isSuperAdmin) {
      throw new HttpsError("permission-denied", "Access rejected.");
    }

    if (TERMINAL_STATUSES.has(current.status)) {
      throw new HttpsError("failed-precondition", `[${RequestReason.REQUEST_INVALID_TRANSITION}] Cannot comment on closed/terminal request.`);
    }

    const nowIso = new Date().toISOString();
    const activityRef = reqRef.collection("activity").doc();
    const activityDoc: RequestActivityDoc = {
      activityId: activityRef.id,
      requestId: current.requestId,
      type: "comment",
      visibility: "public",
      author: {
        uid: context.callerUid,
        name: getCallerName(request, context),
        roleLabel: context.role?.name || (context.isSuperAdmin ? "Platform Admin" : "Member"),
        isPlatform: context.isSuperAdmin,
      },
      content: input.content,
      attachments: input.attachments as RequestAttachment[] | undefined,
      createdAt: nowIso,
    };

    txn.set(activityRef, activityDoc);
    txn.update(reqRef, {
      lastActivityAt: nowIso,
      lastActivityBy: {
        uid: context.callerUid,
        name: getCallerName(request, context),
        isPlatform: context.isSuperAdmin,
      },
      updatedAt: nowIso,
    });

    return { success: true, activityId: activityRef.id };
  });
});

/**
 * 6. requestsTransition
 * The single, atomic state transition entry point for requesters and handlers (D-37).
 */
export const requestsTransition = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
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

    const { nextStatus } = validateStateTransition(
      current.status,
      input.action as RequestAction,
      current.kind as RequestKind,
      isPlatformHandler,
      isOrgManager,
      isRequester,
      current.audience as RequestAudience
    );

    const now = new Date();
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
      activityId: activityRef.id,
      requestId: current.requestId,
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
      requestId: current.requestId,
      previousStatus: current.status,
      status: nextStatus,
      request: updatedRequest,
    };
  });
});

/**
 * 7. requestsGet
 * Retrieves single request with tenant isolation (D-38).
 */
export const requestsGet = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });
  const input = parseInput(GetRequestSchema, request.data);

  const reqDoc = await db.collection("requests").doc(input.requestId).get();
  if (!reqDoc.exists) {
    throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
  }

  const req = reqDoc.data() as RequestDoc;

  // Visibility Check (B-3)
  const isRequester = req.requester.uid === context.callerUid;
  const isPlatformReader = context.isSuperAdmin || context.can(AppPermissions.PLATFORM_REQUESTS_READ);
  const isOrgMember = req.organizationId === context.organizationId;
  const isOrgReader = isOrgMember && (context.isOwner || context.can(AppPermissions.REQUEST_READ_ORG));

  if (!isRequester && !isPlatformReader && !isOrgReader) {
    throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
  }

  // Confidential requests (security_concern) visible only to requester and platform handlers
  if (req.category === RequestCategory.SECURITY_CONCERN && !isRequester && !isPlatformReader) {
    throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
  }

  // Include blockers evaluation for plan_change
  let blockers: unknown[] = [];
  if (req.category === RequestCategory.PLAN_CHANGE && (isPlatformReader || context.isOwner)) {
    const targetPlanId = (req.details as { requestedPlanId?: string })?.requestedPlanId;
    if (targetPlanId) {
      const [orgSnap, targetPlanSnap, branchesSnap] = await Promise.all([
        db.collection("organizations").doc(req.organizationId).get(),
        db.collection("subscriptionPlans").doc(targetPlanId).get(),
        db.collection("organizations").doc(req.organizationId).collection("branches").get(),
      ]);
      if (orgSnap.exists && targetPlanSnap.exists) {
        blockers = computePlanChangeBlockers(
          orgSnap.data() as OrganizationDoc,
          targetPlanSnap.data() as SubscriptionPlanDoc,
          branchesSnap.size,
          orgSnap.data()?.activeEmployeeCount || 0
        );
      }
    }
  }

  return {
    request: req,
    included: {
      blockers,
    },
  };
});

/**
 * 8. requestsList
 * Paged list for tenant users (mine or organization-wide).
 */
export const requestsList = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request);
  const input = parseInput(ListRequestsSchema, request.data);

  const isOrgWide = input.scope === "organization";
  if (isOrgWide && !context.isOwner && !context.can(AppPermissions.REQUEST_READ_ORG)) {
    throw new HttpsError("permission-denied", "Organization-wide read requires requests:read_org permission.");
  }

  let query: FirebaseFirestore.Query = db.collection("requests")
    .where("organizationId", "==", context.organizationId);

  if (!isOrgWide) {
    query = query.where("requester.uid", "==", context.callerUid);
  }

  if (input.audience) query = query.where("audience", "==", input.audience);

  query = query.orderBy("createdAt", "desc").limit(input.limit || 50);

  const snap = await query.get();
  const items = snap.docs
    .map((d) => d.data() as RequestDoc)
    .filter((r) => {
      // Exclude security_concern from org-wide lists for non-requesters
      if (isOrgWide && r.category === RequestCategory.SECURITY_CONCERN && r.requester.uid !== context.callerUid) {
        return false;
      }
      if (input.status && input.status.length && !input.status.includes(r.status)) return false;
      if (input.category && input.category.length && !input.category.includes(r.category)) return false;
      if (input.priority && input.priority.length && !(input.priority as string[]).includes(r.priority)) return false;
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
 * 9. requestsActivityList
 * Returns chronological activity timeline, stripping internal notes for tenants (D-38).
 */
export const requestsActivityList = onCall({ region: "asia-south1" }, async (request) => {
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });
  const input = parseInput(ListRequestActivitySchema, request.data);

  const reqDoc = await db.collection("requests").doc(input.requestId).get();
  if (!reqDoc.exists) {
    throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
  }
  const req = reqDoc.data() as RequestDoc;

  const isPlatform = context.isSuperAdmin || context.can(AppPermissions.PLATFORM_REQUESTS_READ);
  if (req.organizationId !== context.organizationId && !isPlatform) {
    throw new HttpsError("permission-denied", "Access denied.");
  }

  const snap = await db.collection("requests").doc(input.requestId)
    .collection("activity")
    .orderBy("createdAt", "asc")
    .limit(input.limit || 50)
    .get();

  const activities = snap.docs.map((d) => d.data() as RequestActivityDoc);
  const hasInternalNotesAccess = context.isSuperAdmin || context.can(AppPermissions.PLATFORM_REQUESTS_INTERNAL_NOTES);
  const items = filterActivityForTenant(activities, hasInternalNotesAccess);

  return {
    items,
    count: items.length,
    totalCount: items.length,
  };
});

/**
 * 10. requestsCounts
 * Lightweight counts for tenant badges.
 */
export const requestsCounts = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(GetRequestCountsSchema, request.data);
  await assertRequestsFeatureEnabled();
  const context = await resolveRequestContext(request);

  const snap = await db.collection("requests")
    .where("organizationId", "==", context.organizationId)
    .where("requester.uid", "==", context.callerUid)
    .get();

  let actionRequired = 0;
  let open = 0;
  let closed = 0;

  for (const doc of snap.docs) {
    const s = (doc.data() as RequestDoc).status;
    if (s === RequestStatus.NEEDS_INFO) actionRequired++;
    if (OPEN_STATUSES.has(s)) open++;
    if (TERMINAL_STATUSES.has(s)) closed++;
  }

  return {
    actionRequired,
    open,
    closed,
  };
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
    .map((d) => d.data() as RequestDoc)
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
      activityId: activityRef.id,
      requestId: current.requestId,
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
      activityId: activityRef.id,
      requestId: current.requestId,
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
    const current = snap.data() as RequestDoc;
    const nowIso = new Date().toISOString();

    const activityRef = reqRef.collection("activity").doc();
    const activityDoc: RequestActivityDoc = {
      activityId: activityRef.id,
      requestId: current.requestId,
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
      activityId: activityRef.id,
      requestId: current.requestId,
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

    return { success: true, requestId: current.requestId, status: RequestStatus.APPLIED, applyResult, request: updatedRequest };
  });
});
