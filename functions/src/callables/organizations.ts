/**
 * Organization Callables
 * - organizationsCreate: Super Admin only; provisions org + owner with compensating rollback.
 * - organizationsUpdate: Tenant admin/owner or Super Admin.
 * - organizationsDeactivate: Soft status change.
 * - organizationsList: Super Admin only, paginated.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db, auth } from "../services/firebase.js";
import { uniqueKeyRef } from "../services/uniqueKeys.js";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  DeactivateOrganizationSchema,
  ListOrganizationsSchema,
  SetSubscriptionSchema,
  GetOrganizationSchema,
  ReactivateOrganizationSchema,
  PreviewDeactivationImpactSchema,
  GetSubscriptionHistorySchema,
  ProvisionUserSchema,
  TransferOwnershipSchema,
} from "../validation/schemas.js";
import { getCountryDefaults } from "../constants/countryDefaults.js";
import { nameKey } from "../services/naturalKeys.js";
import { provisionMembershipInternal, OWNER_ROLE_ID, ADMIN_ROLE_ID } from "../services/membershipProvisioning.js";
import { attachUploadedImage, hydrateImageUrl } from "../services/imageEngine.js";
import { parseInput } from "../validation/parseInput.js";
import {
  CreateOrganizationResponse,
} from "../types/api.js";
import {
  OrganizationDoc,
  MembershipDoc,
  BranchDoc,
  OrganizationSharingPolicies,
  AuditLogDoc,
} from "../types/models.js";
import { EntityStatus, SubscriptionStatus, GateReason, SalesChannel, BusinessType } from "../constants/enums.js";
import {
  buildSubscriptionFields,
  evaluateSubscription,
  addDaysYmd,
  localDateInTimezone,
  endOfDayInTimezone,
  DEFAULT_ORG_TIMEZONE,
} from "../services/subscription.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { invalidatePlanCache } from "../services/contextResolver.js";
import { fetchPage } from "../services/pagination.js";

/**
 * Field-level write policy for organizationsUpdate.
 *   superAdmin: identity, entitlements and anything affecting billing (plan/subscription
 *               are changed only through organizationsSetSubscription)
 *   owner:      tax id, bank, website, contact, logo/images, address, display name, approvals
 *   admin:      none (decision D-07) — Admins operate the business but do not edit the legal profile
 *
 * D-15: `logoUrl` and `imageUrls` are removed from all write paths. The image is set via
 *        `uploadId` (processed by imageEngine) or `image: ImageRef` (typed, no url field).
 */
export const ORGANIZATION_FIELD_POLICY: Record<"superAdmin" | "owner" | "admin", ReadonlySet<string>> = {
  superAdmin: new Set([
    "name", "legalName", "displayName", "businessType", "businessCategory", "financialYearStartMonth", "moduleToggles", "salesChannels", "timezone",
    "image", "uploadId", "taxId", "website", "contactEmail", "contactPhone", "contact", "contacts",
    "addresses", "bankAccounts", "settings", "showCostToTenant",
  ]),
  owner: new Set([
    "legalName", "displayName", "image", "uploadId", "taxId", "website", "contactEmail", "contactPhone", "contact", "contacts",
    "addresses", "bankAccounts", "settings",
  ]),
  admin: new Set([
    "legalName", "displayName", "image", "uploadId", "taxId", "website", "contactEmail", "contactPhone", "contact", "contacts",
    "addresses", "settings",
  ]),
};

/** Default sales channels by business type when none are supplied at creation. */
function defaultSalesChannels(type: BusinessType): SalesChannel[] {
  switch (type) {
    case BusinessType.WHOLESALE_ONLY:
    case BusinessType.DISTRIBUTOR:
    case BusinessType.MANUFACTURER_B2B:
      return [SalesChannel.B2B, SalesChannel.ORDER_TAKING];
    case BusinessType.WHOLESALE_RETAIL:
    case BusinessType.GENERAL_TRADING:
      return [SalesChannel.POS, SalesChannel.B2B];
    default:
      return [SalesChannel.POS];
  }
}
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";
import { queueWelcomeNotification } from "../services/notificationSender.js";

export const organizationsCreate = onCall({ region: "asia-south1" }, async (request): Promise<CreateOrganizationResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  if (request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to provision organizations.");
  }

  // 1. Validate Input
  const input = parseInput(CreateOrganizationSchema, request.data);

  // 2. Idempotency Check & Reservation (with lease expiry & side-effect recovery)
  const idempotency = await reserveIdempotency({
    scope: "platform",
    actorUid: request.auth.uid,
    operation: "organizations.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
    recoveryChecker: async () => {
      if (input.ownerEmail) {
        try {
          const existingOwnerAuth = await auth.getUserByEmail(input.ownerEmail);
          const mems = await db.collection("memberships")
            .where("userId", "==", existingOwnerAuth.uid)
            .where("roleId", "==", OWNER_ROLE_ID)
            .limit(1)
            .get();
          if (!mems.empty) {
            const mem = mems.docs[0];
            const memData = mem.data() as MembershipDoc;
            return {
              organizationId: memData.organizationId,
              ownerUserId: existingOwnerAuth.uid,
              ownerMembershipId: mem.id,
              status: "active",
              ownerStatus: "active",
              message: "Organization and owner provisioned successfully.",
            };
          }
        } catch {
          // Owner not yet created
        }
      }
      return null;
    },
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation is currently being processed. Please retry shortly.");
    }
    return idempotency.cachedResult as unknown as CreateOrganizationResponse;
  }

  try {
    // 3. Verify Plan exists
    const planDoc = await db.collection("subscriptionPlans").doc(input.planId).get();
    if (!planDoc.exists) {
      throw new HttpsError("not-found", `Subscription plan "${input.planId}" does not exist.`);
    }

    // 4. Derive Country Defaults (C-4, N-01)
    const countryDef = getCountryDefaults(input.country);
    const currency = input.currency || countryDef.currencyCode;
    const taxRegimeCode = input.taxRegimeCode || countryDef.taxRegimeCode;
    const timezone = input.timezone || countryDef.timezone;
    const financialYearStartMonth = input.financialYearStartMonth || countryDef.financialYearStartMonth;

    // 5. Unique check on legalName / name (N-01)
    const legalNameToCheck = input.legalName?.trim() || input.name.trim();
    const legalKey = nameKey(legalNameToCheck);
    const existingLegalSnap = await db.collection("organizations")
      .where("legalNameKey", "==", legalKey)
      .where("country", "==", input.country)
      .limit(1)
      .get();

    if (!existingLegalSnap.empty) {
      throw new HttpsError(
        "already-exists",
        `[ORGANIZATION_DUPLICATE] An organization with this legal name already exists in ${input.country}.`,
        { reason: "ORGANIZATION_DUPLICATE", existingOrganizationId: existingLegalSnap.docs[0].id }
      );
    }

    const orgRef = db.collection("organizations").doc();
    const orgId = orgRef.id;
    const now = new Date().toISOString();
    const branchCode = (input.defaultBranchCode || "MAIN").toUpperCase().trim();
    const willCreateOwner = input.createOwner !== false;

    const defaultSharingPolicies: OrganizationSharingPolicies = {
      products: "organization_shared",
      categories: "organization_shared",
      customers: "organization_shared",
      vendors: "organization_shared",
      sales: "branch_scoped",
      purchases: "organization_shared",
      expenses: "organization_shared",
      stock: "branch_scoped",
      deliveries: "organization_shared",
    };

    let imageRef = input.image;
    if (input.uploadId) {
      imageRef = await attachUploadedImage({
        uploadId: input.uploadId,
        purpose: "org_logo",
        entityType: "organization",
        entityId: orgId,
        callerUid: request.auth.uid,
        scope: orgId,
      });
    }

    const orgDocData: Omit<OrganizationDoc, "updatedAt" | "updatedBy"> = {
      name: input.name,
      legalName: legalNameToCheck,
      legalNameKey: legalKey,
      businessType: input.businessType,
      businessCategory: input.businessCategory,
      country: input.country,
      currency,
      currencyDecimals: countryDef.currencyDecimals,
      taxRegimeCode,
      financialYearStartMonth,
      status: EntityStatus.ACTIVE,
      ownerStatus: willCreateOwner ? "active" : "pending",
      planId: input.planId,
      moduleToggles: {},
      image: imageRef || undefined,
      defaultBranchId: "main-branch",
      branchCount: 1,
      activeEmployeeCount: 0,
      salesChannels: input.salesChannels || defaultSalesChannels(input.businessType),
      sharingPolicies: defaultSharingPolicies,
      taxId: input.taxId || null,
      website: input.website || null,
      addresses: input.addresses || [],
      bankAccounts: input.bankAccounts || [],
      ...(input.contact && input.contact.name && input.contact.email && input.contact.phone ? { contact: { name: input.contact.name, email: input.contact.email, phone: input.contact.phone, altPhone: input.contact.altPhone } } : {}),
      ...(input.contacts ? { contacts: input.contacts } : {}),
      ...buildSubscriptionFields({
        status: input.subscription?.status,
        startsAt: input.subscription?.startsAt,
        expiresOn: input.subscription?.expiresOn,
        durationDays: input.subscription?.durationDays,
        graceDays: input.subscription?.graceDays,
        timezone,
      }),
      createdAt: now,
      createdBy: request.auth.uid,
    };

    const branchRef = orgRef.collection("branches").doc("main-branch");
    const defaultBranchDoc: BranchDoc = {
      organizationId: orgId,
      name: input.defaultBranchName?.trim() || "Main Branch",
      code: branchCode,
      isDefault: true,
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
      updatedAt: now,
    };

    const lockRef = uniqueKeyRef(orgId, "branch_code", branchCode);
    const lockDoc = { organizationId: orgId, kind: "branch_code", entityType: "branch", entityId: "main-branch", createdAt: now };

    const batch = db.batch();
    batch.set(orgRef, orgDocData);
    batch.set(branchRef, defaultBranchDoc);
    batch.set(lockRef, lockDoc);


    await batch.commit();

    let ownerResult: Awaited<ReturnType<typeof provisionMembershipInternal>> | null = null;
    if (willCreateOwner && input.ownerEmail && input.ownerName) {
      ownerResult = await provisionMembershipInternal({
        organizationId: orgId,
        roleId: OWNER_ROLE_ID,
        name: input.ownerName,
        email: input.ownerEmail,
        phone: input.ownerPhone,
        credentialMode: input.credentialMode,
        initialPassword: input.initialPassword,
        confirmLinkExistingUser: input.confirmLinkExistingUser,
        actorUid: request.auth.uid,
      });

      await orgRef.update({
        ownerUserId: ownerResult.userId,
        ownerStatus: "active",
        updatedAt: new Date().toISOString(),
      });

      await queueWelcomeNotification(ownerResult.userId, input.ownerName, input.name);
    }

    const response: CreateOrganizationResponse = {
      organizationId: orgId,
      ownerUserId: ownerResult?.userId || null,
      ownerMembershipId: ownerResult?.membershipId || null,
      status: willCreateOwner ? "active" : "pending",
      ownerStatus: willCreateOwner ? "active" : "pending",
      temporaryPassword: ownerResult?.temporaryPassword,
      userCreated: ownerResult?.userCreated,
      message: willCreateOwner
        ? "Organization and owner provisioned successfully."
        : "Organization created successfully in owner-pending status.",
    };

    if (idempotency.recordId) {
      // A password is never stored at rest: a replay returns the same organization without it.
      const { temporaryPassword: _password, ...safeResult } = response;
      await finalizeIdempotencySuccess(idempotency.recordId, safeResult);
    }

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "PROVISIONING_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to provision organization: ${(error as Error).message}`);
  }
});

export const organizationsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateOrganizationSchema, request.data);

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  let tier: "superAdmin" | "owner" | "admin" = "superAdmin";

  if (!isSuperAdmin) {
    const memDoc = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
    if (!memDoc.exists) {
      throw new HttpsError("permission-denied", "Not a member of this organization.");
    }
    const memData = memDoc.data() as MembershipDoc;
    if (memData.status !== "active") {
      throw new HttpsError("permission-denied", "Membership is inactive.");
    }
    if (memData.roleId === "role_org_owner") {
      tier = "owner";
    } else {
      await resolveRequestContext(request, {
        organizationId: input.organizationId,
        requiredPermission: AppPermissions.ORG_UPDATE,
      });
      tier = "admin";
    }
  }

  const orgRef = db.collection("organizations").doc(input.organizationId);
  const orgDoc = await orgRef.get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const existing = orgDoc.data() as OrganizationDoc;
  if (!isSuperAdmin) {
    const sub = evaluateSubscription(existing);
    if (!sub.allowed) {
      throw new HttpsError("failed-precondition", `[${sub.reason}] Organization subscription is ${sub.state}.`, { reason: sub.reason });
    }
  }

  // Field-level write control: every supplied field must be editable by the caller's tier
  const fields: Record<string, unknown> = { ...input };
  delete fields.organizationId;

  if (fields.uploadId) {
    const attachedImage = await attachUploadedImage({
      uploadId: fields.uploadId as string,
      purpose: "org_logo",
      entityType: "organization",
      entityId: input.organizationId,
      callerUid: request.auth.uid,
      scope: input.organizationId,
    });
    delete fields.uploadId;
    fields.image = attachedImage;
  }

  const requested = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
  const forbidden = requested.filter((f) => !ORGANIZATION_FIELD_POLICY[tier].has(f));
  if (forbidden.length > 0) {
    throw new HttpsError(
      "permission-denied",
      `[${GateReason.FIELD_NOT_EDITABLE}] Field(s) not editable by ${tier}: ${forbidden.join(", ")}.`,
      { reason: GateReason.FIELD_NOT_EDITABLE, fields: forbidden }
    );
  }
  if (requested.length === 0) {
    throw new HttpsError("invalid-argument", "No updatable fields supplied.");
  }

  if (fields.contacts !== undefined && Array.isArray(fields.contacts)) {
    const contactsList = fields.contacts as Array<{ isPrimary?: boolean; email?: string | null; phone?: string | null }>;
    const primaryContacts = contactsList.filter((c) => c.isPrimary);
    if (primaryContacts.length > 1) {
      throw new HttpsError("invalid-argument", "At most one contact can be marked as primary.");
    }
  }

  const updates: Record<string, unknown> = {
    ...Object.fromEntries(requested.map((k) => [k, (fields as Record<string, unknown>)[k]])),
    updatedAt: new Date().toISOString(),
    updatedBy: request.auth.uid,
  };

  await orgRef.update(updates);


  return { success: true, message: "Organization updated successfully." };
});

export const organizationsDeactivate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(DeactivateOrganizationSchema, request.data);

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    throw new HttpsError("permission-denied", `[${GateReason.FIELD_NOT_EDITABLE}] Organization status is managed by the platform Super Admin.`, { reason: GateReason.FIELD_NOT_EDITABLE });
  }

  const orgRef = db.collection("organizations").doc(input.organizationId);
  await orgRef.update({
    status: EntityStatus.INACTIVE,
    updatedAt: new Date().toISOString(),
  });


  return { success: true, message: "Organization deactivated successfully." };
});

export const organizationsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to list all organizations.");
  }

  const input = parseInput(ListOrganizationsSchema, request.data);

  let query: FirebaseFirestore.Query = db.collection("organizations").orderBy("name");
  let countQuery: FirebaseFirestore.Query = db.collection("organizations");

  if (input.status) {
    query = query.where("status", "==", input.status);
    countQuery = countQuery.where("status", "==", input.status);
  }
  if (input.planId) {
    query = query.where("planId", "==", input.planId);
    countQuery = countQuery.where("planId", "==", input.planId);
  }

  const [countSnap, { snapshot, nextCursor }] = await Promise.all([
    countQuery.count().get(),
    fetchPage(query, "organizations", input.startAfterId, input.limit || 20),
  ]);
  const totalCount = countSnap.data().count;

  const items = snapshot.docs.map((doc) => {
    const data = doc.data() as OrganizationDoc;
    return {
      organizationId: doc.id,
      ...data,
      subscriptionStatus: data.subscriptionStatus || "active",
      subscriptionExpiresAt: data.subscriptionExpiresAt || null,
      seatsUsed: data.activeEmployeeCount || 0,
      branchesUsed: data.branchCount || 1,
    };
  });

  return {
    items,
    organizations: items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 20),
  };
});

export const organizationsReactivate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Platform Super Admin privileges required to reactivate organization.");
  }
  const input = parseInput(ReactivateOrganizationSchema, request.data);
  const orgRef = db.collection("organizations").doc(input.organizationId);
  const snap = await orgRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Organization not found.");
  const now = new Date().toISOString();
  await orgRef.update({
    status: EntityStatus.ACTIVE,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  return { success: true, status: EntityStatus.ACTIVE, message: "Organization reactivated successfully." };
});

export const organizationsPreviewDeactivationImpact = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to preview deactivation impact.");
  }
  const input = parseInput(PreviewDeactivationImpactSchema, request.data);
  const orgRef = db.collection("organizations").doc(input.organizationId);
  const snap = await orgRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Organization not found.");
  const org = snap.data() as OrganizationDoc;

  const [membersSnap, branchesSnap, openBillsSnap] = await Promise.all([
    db.collection("memberships").where("organizationId", "==", input.organizationId).where("status", "==", EntityStatus.ACTIVE).get(),
    db.collection("organizations").doc(input.organizationId).collection("branches").get(),
    db.collection("bills").where("organizationId", "==", input.organizationId).where("status", "in", ["draft", "active", "partial"]).get(),
  ]);

  const activeBranches = branchesSnap.docs.filter((d) => {
    const bData = d.data();
    return bData.isActive !== false && bData.status !== "inactive";
  });

  let outstandingBalance = 0;
  openBillsSnap.docs.forEach((doc) => {
    const b = doc.data();
    outstandingBalance += Number(b.balanceAmount) || 0;
  });

  return {
    organizationId: input.organizationId,
    organizationName: org.name,
    currentStatus: org.status,
    activeBranchCount: activeBranches.length,
    activeBranchesCount: activeBranches.length,
    activeEmployeeCount: membersSnap.size,
    activeEmployeesCount: membersSnap.size,
    activeUsers: membersSnap.size,
    branches: activeBranches.map((d) => ({ id: d.id, ...d.data() })),
    employees: membersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    openDocumentsCount: openBillsSnap.size,
    outstandingReceivables: outstandingBalance,
    subscriptionStatus: org.subscriptionStatus || "active",
    subscriptionExpiresAt: org.subscriptionExpiresAt || null,
  };
});

export const organizationsGetSubscriptionHistory = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const input = parseInput(GetSubscriptionHistorySchema, request.data);
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  if (!isSuperAdmin) {
    const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.ORG_VIEW });
    if (ctx.organizationId !== input.organizationId) {
      throw new HttpsError("permission-denied", "Cross-organization access denied.");
    }
  }

  // Subscription changes are the organization's own events (a Super Admin's are stored under "platform"
  // with the organization as target): set_subscription, and create / update events that changed a
  // subscription field.
  const SUBSCRIPTION_FIELDS = new Set(["planId", "subscriptionStatus", "subscriptionStartsAt", "subscriptionExpiresAt", "graceDays"]);
  const logsSnap = await db.collection("auditLogs")
    .where("entityType", "==", "organization")
    .where("entityId", "==", input.organizationId)
    .where("action", "in", ["organization.set_subscription", "organization.create", "organization.update"])
    .get();

  const history = logsSnap.docs
    .map((d) => ({ logId: d.id, ...(d.data() as AuditLogDoc) }))
    .filter((l) => l.action === "organization.set_subscription" || (l.changedFields || []).some((f) => SUBSCRIPTION_FIELDS.has(f)))
    .sort((a, b) => b.occurredAt.toMillis() - a.occurredAt.toMillis())
    .slice(0, input.limit || 50)
    .map((l) => ({
      logId: l.logId,
      at: l.occurredAt.toDate().toISOString(),
      action: l.action,
      actorUid: l.actorUid,
      details: l.details || {},
      changes: (l.changes?.fields || []).filter((f) => SUBSCRIPTION_FIELDS.has(f.path.split(".")[0])).map((f) => ({ field: f.path, from: f.before ?? null, to: f.after ?? null })),
    }));

  return { organizationId: input.organizationId, items: history, history };
});

/**
 * organizationsSetSubscription (Super Admin only)
 * Sets, renews, extends, suspends, reactivates, cancels or changes the plan of an
 * organization's subscription. Downgrading below current usage preserves existing data;
 * new branches/employees are then blocked by the plan-limit checks (reported as overLimit).
 */
export const organizationsSetSubscription = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  if (request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to manage subscriptions.");
  }
  const input = parseInput(SetSubscriptionSchema, request.data);
  const orgRef = db.collection("organizations").doc(input.organizationId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (txn) => {
    const snap = await txn.get(orgRef);
    if (!snap.exists) throw new HttpsError("not-found", "Organization not found.");
    const org = snap.data() as OrganizationDoc;
    const tz = org.timezone || DEFAULT_ORG_TIMEZONE;
    const updates: Record<string, unknown> = {};

    let planDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    if (input.planId) {
      planDoc = await txn.get(db.collection("subscriptionPlans").doc(input.planId));
      if (!planDoc.exists) throw new HttpsError("not-found", `Subscription plan "${input.planId}" does not exist.`);
    }

    switch (input.action) {
      case "set":
      case "renew": {
        Object.assign(updates, buildSubscriptionFields({
          status: input.status || SubscriptionStatus.ACTIVE,
          expiresOn: input.expiresOn,
          durationDays: input.durationDays ?? 365,
          graceDays: input.graceDays ?? org.graceDays,
          timezone: tz,
        }));
        break;
      }
      case "extend": {
        const days = input.extendDays || input.durationDays || 30;
        const fromMs = Math.max(Date.now(), org.subscriptionExpiresAt ? Date.parse(org.subscriptionExpiresAt) : 0);
        updates.subscriptionExpiresAt = endOfDayInTimezone(addDaysYmd(localDateInTimezone(fromMs, tz), days), tz);
        updates.subscriptionStatus = SubscriptionStatus.ACTIVE;
        break;
      }
      case "suspend":
        updates.subscriptionStatus = SubscriptionStatus.SUSPENDED;
        break;
      case "cancel":
        updates.subscriptionStatus = SubscriptionStatus.CANCELLED;
        break;
      case "reactivate":
        updates.subscriptionStatus = SubscriptionStatus.ACTIVE;
        if (input.expiresOn) updates.subscriptionExpiresAt = endOfDayInTimezone(input.expiresOn, tz);
        break;
      case "change_plan":
        if (!input.planId) throw new HttpsError("invalid-argument", "planId is required for change_plan.");
        break;
    }
    if (input.planId) updates.planId = input.planId;
    if (input.graceDays !== undefined) updates.graceDays = input.graceDays;
    updates.updatedAt = now;
    updates.updatedBy = request.auth!.uid;
    txn.update(orgRef, updates);

    const plan = planDoc?.data();
    const overLimit: string[] = [];
    if (plan) {
      const seats = (plan.seatLimits?.admin || 0) + (plan.seatLimits?.staff || 0);
      if (typeof plan.branchLimit === "number" && (org.branchCount || 1) > plan.branchLimit) overLimit.push("branches");
      if ((org.activeEmployeeCount || 0) > seats) overLimit.push("employees");
    }
    return { before: org, updates, overLimit };
  });

  if (input.planId) invalidatePlanCache(input.planId);

  const after = { ...result.before, ...result.updates } as OrganizationDoc;
  return {
    organizationId: input.organizationId,
    planId: after.planId,
    subscriptionStatus: after.subscriptionStatus,
    subscriptionStartsAt: after.subscriptionStartsAt,
    subscriptionExpiresAt: after.subscriptionExpiresAt,
    graceDays: after.graceDays || 0,
    evaluation: evaluateSubscription(after),
    overLimit: result.overLimit,
  };
});

export const organizationsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetOrganizationSchema, request.data);
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  let targetOrgId = input.organizationId;

  if (isSuperAdmin) {
    if (!targetOrgId) {
      throw new HttpsError("invalid-argument", "organizationId is required for Super Admin lookups.");
    }
  } else {
    const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.ORG_VIEW });
    if (targetOrgId && targetOrgId !== ctx.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant organization access rejected.");
    }
    targetOrgId = ctx.organizationId;
  }

  const snap = await db.collection("organizations").doc(targetOrgId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", `Organization "${targetOrgId}" not found.`);
  }

  const data = snap.data() as OrganizationDoc;

  const orgPayload = {
    id: snap.id,
    organizationId: snap.id,
    name: data.name,
    legalName: data.legalName ?? null,
    code: data.code,
    displayName: data.displayName || data.name,
    businessType: data.businessType,
    businessCategory: data.businessCategory,
    currency: data.currency || "INR",
    currencyDecimals: data.currencyDecimals ?? 2,
    timezone: data.timezone || "Asia/Kolkata",
    country: data.country || "IN",
    financialYearStartMonth: data.financialYearStartMonth ?? 4,
    taxRegimeCode: data.taxRegimeCode || "IN_GST",
    taxId: data.taxId ?? null,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    contact: data.contact ?? null,
    contacts: data.contacts ?? [],
    website: data.website ?? null,
    /** D-15: `image` is the stored ImageRef (no url inside); `imageUrl` is the computed display URL. */
    image: data.image ? { path: data.image.path, contentType: data.image.contentType, width: data.image.width, height: data.image.height, sizeBytes: data.image.sizeBytes, updatedAt: data.image.updatedAt, thumbnailPath: data.image.thumbnailPath } : null,
    /** D-15: computed display URL — never stored. */
    imageUrl: hydrateImageUrl(data.image),
    addresses: data.addresses ?? [],
    bankAccounts: data.bankAccounts ?? [],
    settings: data.settings,
    salesChannels: data.salesChannels,
    moduleToggles: data.moduleToggles,
    status: data.status,
    ownerStatus: data.ownerStatus ?? (data.ownerUserId ? "active" : "pending"),
    ownerUserId: data.ownerUserId ?? null,
    planId: data.planId,
    subscriptionStatus: data.subscriptionStatus,
    subscriptionExpiresAt: data.subscriptionExpiresAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };

  if (isSuperAdmin) {
    // D-18: single canonical response — no mirrored top-level keys alongside the nested object
    const { logoUrl: _l, imageUrls: _i, bankDetails: _bd, ...cleanData } = data as typeof data & { logoUrl?: unknown; imageUrls?: unknown; bankDetails?: unknown };
    return {
      organization: {
        id: snap.id,
        organizationId: snap.id,
        ...cleanData,
        ownerStatus: data.ownerStatus ?? (data.ownerUserId ? "active" : "pending"),
        /** D-15: computed display URL added at read time. */
        imageUrl: hydrateImageUrl(data.image),
      },
      evaluation: evaluateSubscription(data),
    };
  }

  return {
    organization: orgPayload,
  };
});

/**
 * organizationsProvisionUser (Super Admin only — Prompt 60 N-01/N-02/N-05)
 * Allows Super Admin to provision an Owner or Admin for an organization.
 * Tenant operations remain strictly forbidden (SUPER_ADMIN_TENANT_FORBIDDEN).
 */
export const organizationsProvisionUser = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to provision organization users.");
  }

  const input = parseInput(ProvisionUserSchema, request.data);

  const orgRef = db.collection("organizations").doc(input.organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", `Organization "${input.organizationId}" not found.`);
  }
  const orgData = orgSnap.data() as OrganizationDoc;

  if (input.role === "owner" && orgData.ownerStatus === "active" && orgData.ownerUserId) {
    throw new HttpsError(
      "failed-precondition",
      "[ORGANIZATION_ALREADY_HAS_OWNER] Organization already has an active Owner. Use organizationsTransferOwnership to change owners.",
      { reason: "ORGANIZATION_ALREADY_HAS_OWNER" }
    );
  }

  const roleId = input.role === "owner" ? OWNER_ROLE_ID : ADMIN_ROLE_ID;

  const result = await provisionMembershipInternal({
    organizationId: input.organizationId,
    roleId,
    email: input.user.email,
    name: input.user.name.trim(),
    phone: input.user.phone,
    image: input.user.image,
    uploadId: input.user.uploadId,
    actorUid: request.auth.uid,
    confirmLinkExistingUser: true,
  });

  if (input.role === "owner") {
    await orgRef.update({
      ownerUserId: result.userId,
      ownerStatus: "active",
      updatedAt: new Date().toISOString(),
      updatedBy: request.auth.uid,
    });
  }


  return {
    success: true,
    userId: result.userId,
    membershipId: result.membershipId,
    role: input.role,
    roleId,
    organizationId: input.organizationId,
    temporaryPassword: result.temporaryPassword,
    inviteLink: result.inviteLink,
    userCreated: result.userCreated,
  };
});

/**
 * organizationsTransferOwnership (Super Admin or Current Owner — Prompt 60 N-03)
 * Transfers organization ownership from current owner to another active member.
 */
export const organizationsTransferOwnership = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(TransferOwnershipSchema, request.data);
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMemSnap = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
    if (
      !callerMemSnap.exists ||
      callerMemSnap.data()?.roleId !== OWNER_ROLE_ID ||
      callerMemSnap.data()?.status !== EntityStatus.ACTIVE
    ) {
      throw new HttpsError("permission-denied", "Only Super Admin or the current Organization Owner can transfer ownership.");
    }
  }

  const orgRef = db.collection("organizations").doc(input.organizationId);

  const transferResult = await db.runTransaction(async (txn) => {
    const orgSnap = await txn.get(orgRef);
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", `Organization "${input.organizationId}" not found.`);
    }
    const orgData = orgSnap.data() as OrganizationDoc;
    const currentOwnerId = orgData.ownerUserId;

    if (currentOwnerId === input.newOwnerUserId) {
      throw new HttpsError("failed-precondition", "Target user is already the owner of this organization.");
    }

    const newMemRef = db.collection("memberships").doc(`${input.newOwnerUserId}_${input.organizationId}`);
    const newMemSnap = await txn.get(newMemRef);
    if (!newMemSnap.exists || newMemSnap.data()?.status !== EntityStatus.ACTIVE) {
      throw new HttpsError(
        "failed-precondition",
        "Target user must be an active member of this organization before being promoted to owner."
      );
    }

    const now = new Date().toISOString();

    if (currentOwnerId) {
      const prevMemRef = db.collection("memberships").doc(`${currentOwnerId}_${input.organizationId}`);
      const prevMemSnap = await txn.get(prevMemRef);
      if (prevMemSnap.exists) {
        if (input.previousOwnerAction === "demote_to_admin") {
          txn.update(prevMemRef, {
            roleId: ADMIN_ROLE_ID,
            updatedAt: now,
            updatedBy: request.auth!.uid,
          });
        } else {
          txn.update(prevMemRef, {
            status: EntityStatus.INACTIVE,
            updatedAt: now,
            updatedBy: request.auth!.uid,
          });
        }
      }
    }

    txn.update(newMemRef, {
      roleId: OWNER_ROLE_ID,
      status: EntityStatus.ACTIVE,
      updatedAt: now,
      updatedBy: request.auth!.uid,
    });

    txn.update(orgRef, {
      ownerUserId: input.newOwnerUserId,
      ownerStatus: "active",
      updatedAt: now,
      updatedBy: request.auth!.uid,
    });

    return {
      previousOwnerUserId: currentOwnerId || null,
      newOwnerUserId: input.newOwnerUserId,
    };
  });


  return {
    success: true,
    organizationId: input.organizationId,
    newOwnerUserId: input.newOwnerUserId,
    previousOwnerUserId: transferResult.previousOwnerUserId,
    previousOwnerAction: input.previousOwnerAction,
    message: "Organization ownership transferred successfully.",
  };
});
