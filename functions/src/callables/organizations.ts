/**
 * Organization Callables
 * - organizationsCreate: Super Admin only; provisions org + owner with compensating rollback.
 * - organizationsUpdate: Tenant admin/owner or Super Admin.
 * - organizationsDeactivate: Soft status change.
 * - organizationsList: Super Admin only, paginated.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth } from "../services/firebase.js";
import { uniqueKeyRef } from "../services/uniqueKeys.js";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  DeactivateOrganizationSchema,
  ListOrganizationsSchema,
  SetSubscriptionSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  CreateOrganizationResponse,
} from "../types/api.js";
import {
  OrganizationDoc,
  UserDoc,
  MembershipDoc,
  BranchDoc,
  MembershipBranchDoc,
  OrganizationSharingPolicies,
} from "../types/models.js";
import { EntityStatus, IdempotencyStatus, SubscriptionStatus, GateReason, SalesChannel, BusinessType } from "../constants/enums.js";
import {
  buildSubscriptionFields,
  evaluateSubscription,
  addDaysYmd,
  localDateInTimezone,
  endOfDayInTimezone,
  DEFAULT_ORG_TIMEZONE,
} from "../services/subscription.js";
import { diffChanges, createAuditLog, addAuditLogToBatch } from "../services/audit.js";
import { invalidatePlanCache } from "../services/contextResolver.js";
import { fetchPage } from "../services/pagination.js";

/**
 * Field-level write policy for organizationsUpdate.
 *   superAdmin: identity, entitlements and anything affecting billing (plan/subscription
 *               are changed only through organizationsSetSubscription)
 *   owner:      tax id, bank, website, contact, logo/images, address, display name, approvals
 *   admin:      none (decision D-07) — Admins operate the business but do not edit the legal profile
 */
export const ORGANIZATION_FIELD_POLICY: Record<"superAdmin" | "owner" | "admin", ReadonlySet<string>> = {
  superAdmin: new Set([
    "name", "businessType", "businessCategory", "moduleToggles", "salesChannels", "timezone",
    "displayName", "logoUrl", "imageUrls", "taxNumber", "website", "contactEmail", "contactPhone", "contacts",
    "address", "bankDetails", "settings",
  ]),
  owner: new Set([
    "displayName", "logoUrl", "imageUrls", "taxNumber", "website", "contactEmail", "contactPhone", "contacts",
    "address", "bankDetails", "settings",
  ]),
  admin: new Set(),
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
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { compensateAuthUser } from "../services/compensation.js";
import { setPrimaryOrganizationClaim, setPrimaryBranchClaim } from "../services/claims.js";
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
    payload: input as unknown as Record<string, unknown>,
    recoveryChecker: async () => {
      try {
        const existingOwnerAuth = await auth.getUserByEmail(input.ownerEmail);
        const mems = await db.collection("memberships")
          .where("userId", "==", existingOwnerAuth.uid)
          .where("roleId", "==", "role_org_owner")
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
            message: "Organization and owner provisioned successfully.",
          };
        }
      } catch {
        // Owner not yet created
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

  let createdAuthUid: string | null = null;

  try {
    // 3. Verify Plan exists
    const planDoc = await db.collection("subscriptionPlans").doc(input.planId).get();
    if (!planDoc.exists) {
      throw new HttpsError("not-found", `Subscription plan "${input.planId}" does not exist.`);
    }

    // 4. Create Firebase Auth user for Organization Owner
    const password = input.initialPassword || Math.random().toString(36).slice(-10) + "Aa1!";
    const authUser = await auth.createUser({
      email: input.ownerEmail,
      displayName: input.ownerName,
      phoneNumber: input.ownerPhone || undefined,
      password,
    });
    createdAuthUid = authUser.uid;

    // 5. Coordinated Firestore Creation
    const orgRef = db.collection("organizations").doc();
    const orgId = orgRef.id;

    // Set custom claims primaryOrganizationId and primaryBranchId on newly created Owner
    await setPrimaryOrganizationClaim(createdAuthUid, orgId);
    await setPrimaryBranchClaim(createdAuthUid, "main-branch");

    const userRef = db.collection("users").doc(createdAuthUid);
    const membershipId = `${createdAuthUid}_${orgId}`;
    const membershipRef = db.collection("memberships").doc(membershipId);

    const now = new Date().toISOString();
    const branchCode = (input.defaultBranchCode || "MAIN").toUpperCase().trim();

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

    const orgDocData: OrganizationDoc = {
      name: input.name,
      businessType: input.businessType,
      businessCategory: input.businessCategory,
      country: input.country,
      currency: input.currency,
      taxRegimeCode: input.taxRegimeCode,
      status: EntityStatus.ACTIVE,
      planId: input.planId,
      moduleToggles: {},
      defaultBranchId: "main-branch",
      branchCount: 1,
      activeEmployeeCount: 0,
      salesChannels: input.salesChannels || defaultSalesChannels(input.businessType),
      sharingPolicies: defaultSharingPolicies,
      ...(input.contacts ? { contacts: input.contacts } : {}),
      ...buildSubscriptionFields({
        status: input.subscription?.status,
        startsAt: input.subscription?.startsAt,
        expiresOn: input.subscription?.expiresOn,
        durationDays: input.subscription?.durationDays,
        graceDays: input.subscription?.graceDays,
        timezone: input.timezone,
      }),
      createdAt: now,
      createdBy: request.auth.uid,
    };

    const userDocData: UserDoc = {
      name: input.ownerName,
      email: input.ownerEmail,
      phone: input.ownerPhone || null,
      accountType: "admin",
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    const membershipDocData: MembershipDoc = {
      userId: createdAuthUid,
      organizationId: orgId,
      roleId: "role_org_owner",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: "main-branch",
      createdAt: now,
      createdBy: request.auth.uid,
    };

    // Branch-readiness: Provision default branch 'main-branch' under organizations/{orgId}/branches
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

    // Code lock for default branch
    const lockRef = uniqueKeyRef(orgId, "branch_code", branchCode);
    const lockDoc = { organizationId: orgId, kind: "branch_code", entityType: "branch", entityId: "main-branch", createdAt: now };

    // Join record mapping Owner membership to main-branch
    const membershipBranchRef = db.collection("membershipBranches").doc(`${membershipId}_main-branch`);
    const membershipBranchDoc: MembershipBranchDoc = {
      organizationId: orgId,
      branchId: "main-branch",
      membershipId,
      userId: createdAuthUid,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: request.auth.uid,
      updatedAt: now,
    };

    const response: CreateOrganizationResponse = {
      organizationId: orgId,
      ownerUserId: createdAuthUid,
      ownerMembershipId: membershipId,
      status: "active",
      message: "Organization and owner provisioned successfully.",
    };

    // Coordinated atomic batch: Org + User + Membership + Branch + CodeLock + MembershipBranch + Audit + Idempotency
    const batch = db.batch();
    batch.set(orgRef, orgDocData);
    batch.set(userRef, userDocData);
    batch.set(membershipRef, membershipDocData);
    batch.set(branchRef, defaultBranchDoc);
    batch.set(lockRef, lockDoc);
    batch.set(membershipBranchRef, membershipBranchDoc);

    addAuditLogToBatch(batch, {
      organizationId: orgId,
      actorUid: request.auth.uid,
      action: "ORGANIZATION_CREATED",
      entityType: "organization",
      entityId: orgId,
      details: {
        name: input.name,
        planId: input.planId,
        ownerEmail: input.ownerEmail,
      },
    });

    if (idempotency.recordId) {
      const idempotencyRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      batch.update(idempotencyRef, {
        status: IdempotencyStatus.SUCCEEDED,
        result: response as unknown as Record<string, unknown>,
        updatedAt: now,
      });
    }

    await batch.commit();

    // 6. Queue Welcome Notification
    await queueWelcomeNotification(createdAuthUid, input.ownerName, input.name);

    return response;
  } catch (error) {
    // 9. Compensating Rollback of Auth User on Firestore Failure
    if (createdAuthUid) {
      const rollback = await compensateAuthUser(createdAuthUid, (error as Error).message);
      if (!rollback.success) {
        console.error(`[CRITICAL] Rollback incomplete for auth user ${createdAuthUid}:`, rollback.error);
      }
    }

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
    } else if (memData.roleId === "role_admin") {
      tier = "admin";
    } else {
      throw new HttpsError("permission-denied", "Insufficient permissions to update organization.");
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

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "ORGANIZATION_UPDATED",
    entityType: "organization",
    entityId: input.organizationId,
    details: { tier, fields: requested },
    changes: diffChanges(existing as unknown as Record<string, unknown>, updates, requested),
  });

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

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "ORGANIZATION_DEACTIVATED",
    entityType: "organization",
    entityId: input.organizationId,
    details: { reason: input.reason },
  });

  return { success: true, message: "Organization deactivated successfully." };
});

export const organizationsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to list all organizations.");
  }

  const input = parseInput(ListOrganizationsSchema, request.data);

  let query: FirebaseFirestore.Query = db.collection("organizations").orderBy("name");

  if (input.status) {
    query = query.where("status", "==", input.status);
  }

  const { snapshot, nextCursor } = await fetchPage(query, "organizations", input.startAfterId, input.limit || 20);
  const items = snapshot.docs.map((doc) => ({
    organizationId: doc.id,
    ...(doc.data() as OrganizationDoc),
  }));

  return {
    items,
    count: items.length,
    nextCursor,
    hasMore: items.length === (input.limit || 20),
  };
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
  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: `SUBSCRIPTION_${input.action.toUpperCase()}`,
    entityType: "organization",
    entityId: input.organizationId,
    details: { reason: input.reason || null, overLimit: result.overLimit },
    changes: diffChanges(result.before as unknown as Record<string, unknown>, result.updates),
  });

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
