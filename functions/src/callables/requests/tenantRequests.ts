/**
 * Requests & Support Desk - Tenant-Facing Callables
 *
 * - requestsMeta: Metadata and limit discovery for new request modal
 * - plansCatalogList: Plan catalog with tenant current usage
 * - requestsCreate: Request submission
 * - requestsUpdate: Edit submitted/needs_info request
 * - requestsAddComment: Public comments on request timeline
 * - requestsGet: Single request retrieval
 * - requestsList: Paged tenant request list
 * - requestsActivityList: Activity timeline (redacted internal notes)
 * - requestsCounts: Badge counts
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { parseInput } from "../../validation/parseInput.js";
import { db } from "../../services/firebase.js";
import { resolveRequestContext } from "../../services/contextResolver.js";
import { AppPermissions } from "../../constants/permissions.js";
import {
  RequestCategory,
  RequestStatus,
  SlaState,
  RequestReason,
} from "../../constants/enums.js";
import {
  CreateRequestSchema,
  UpdateRequestSchema,
  AddRequestCommentSchema,
  GetRequestSchema,
  ListRequestsSchema,
  ListRequestActivitySchema,
  GetRequestCountsSchema,
  ListPlansCatalogSchema,
  GetRequestsMetaSchema,
  CATEGORY_DETAILS_SCHEMAS,
} from "../../validation/schemas.js";
import {
  RequestDoc,
  RequestActivityDoc,
  RequestAttachment,
  OrganizationDoc,
  SubscriptionPlanDoc,
} from "../../types/models.js";
import {
  assertRequestsFeatureEnabled,
  getCategoryKind,
  getCategoryAudience,
  calculateDefaultPriority,
  computeSlaDeadlines,
  generateNextRequestNumberInTxn,
  assertRequestLimitsInTxn,
  computePlanChangeBlockers,
  filterActivityForTenant,
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_SLA_HOURS,
  REQUEST_CATEGORY_GROUPS,
} from "../../services/requestsService.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../../services/idempotency.js";
import { canEditOrganizationField, ORGANIZATION_FIELD_CLASS } from "../organizations.js";
import { getCallerName, SENSITIVE_CATEGORIES } from "./helpers.js";

/**
 * 1. requestsMeta
 */
export const requestsMeta = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(GetRequestsMetaSchema, request.data);
  const settings = await assertRequestsFeatureEnabled();
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

  const availableSet = new Set(availableCategories);
  const groups = REQUEST_CATEGORY_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    order: g.order,
    categories: g.categories.filter((c) => availableSet.has(c)),
  })).filter((g) => g.categories.length > 0);

  const orgProfileChangeFields = Object.keys(ORGANIZATION_FIELD_CLASS).filter(
    (f) => !canEditOrganizationField({ isSuperAdmin: context.isSuperAdmin, can: (p) => context.can(p) }, f)
  );

  return {
    availableCategories,
    groups,
    allGroups: REQUEST_CATEGORY_GROUPS,
    orgProfileChangeFields,
    userOpenCount,
    orgOpenCount,
    limits: settings.limits,
    openPlanChangeId,
    slaHours: settings.sla || DEFAULT_SLA_HOURS,
    reopenWindowDays: settings.reopenWindowDays,
    autoCloseDays: settings.autoCloseDays,
    attachments: {
      maxCount: 5,
      maxSizeBytes: 5 * 1024 * 1024,
      acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    },
    allowDiagnostics: true,
  };
});

/**
 * 2. plansCatalogList
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

  // BS-16 / C-2 #7: org_profile_change refuses fields the requester can already edit directly.
  if (input.category === RequestCategory.ORG_PROFILE_CHANGE) {
    const targetField = (parsedDetails.data as { field: string }).field;
    const canEditDirectly = canEditOrganizationField(
      { isSuperAdmin: context.isSuperAdmin, can: (p) => context.can(p) },
      targetField
    );
    if (canEditDirectly) {
      throw new HttpsError(
        "failed-precondition",
        `[${RequestReason.REQUEST_DETAILS_INVALID}] You already have permission to edit "${targetField}" directly; please edit it yourself in organization settings.`,
        { reason: RequestReason.REQUEST_DETAILS_INVALID, field: targetField }
      );
    }
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
        requesterName: getCallerName(request, context),
        currentPlanName,
        requestedPlanName,
      };

      txn.set(reqRef, requestDoc);

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
 * 7. requestsGet
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

  const isRequester = req.requester.uid === context.callerUid;
  const isPlatformReader = context.isSuperAdmin || context.can(AppPermissions.PLATFORM_REQUESTS_READ);
  const isOrgMember = req.organizationId === context.organizationId;
  const isOrgReader = isOrgMember && (context.isOwner || context.can(AppPermissions.REQUEST_READ_ORG));

  if (!isRequester && !isPlatformReader && !isOrgReader) {
    throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
  }

  if (req.category === RequestCategory.SECURITY_CONCERN && !isRequester && !isPlatformReader) {
    throw new HttpsError("not-found", `[${RequestReason.REQUEST_NOT_FOUND}] Request not found.`);
  }

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
