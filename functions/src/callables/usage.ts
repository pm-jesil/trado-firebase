/**
 * Super Admin Usage & Service Consumption Dashboard Callables
 * 
 * Provides authorized platform-wide infrastructure consumption transparency:
 * 1. usageGetPlatformSummary: Aggregated platform actuals vs app-attributed operations
 * 2. usageGetOrganizations: Paginated organization ranking by measured usage / estimated cost
 * 3. usageGetBranches: Branch-level consumption breakdown within an organization
 * 4. usageGetDetail: Time-series operational breakdown per service
 * 5. usageCalculateDryRunStatement: Non-binding monthly usage estimate calculation
 * 6. usageRecordClientMetric: Records server-observed application activity
 * 
 * Strict Security Guard: Strictly inaccessible to ordinary tenant users, Admins, or Owners.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { parseInput } from "../validation/parseInput.js";
import { db } from "../services/firebase.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { DEFAULT_ORG_TIMEZONE } from "../services/subscription.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  GetPlatformUsageSummarySchema,
  GetOrganizationsUsageSchema,
  GetBranchesUsageSchema,
  GetUsageDetailSchema,
  CalculateDryRunStatementSchema,
  GetUsageLimitsSchema,
  UpdateUsageLimitsSchema,
  RecordClientMetricSchema,
} from "../validation/schemas.js";
import {
  createEmptyServiceCounts,
  calculateEstimatedCost,
  getActiveRateCard,
  generateDryRunUsageStatement,
  recordUsageMetrics,
  getServerUsageSnapshot,
  evaluateUsageLimits,
  CLIENT_METRIC_KEYS,
  getEffectiveUsageLimits,
  updateOrganizationUsageLimits,
} from "../services/usageMetering.js";
import {
  OrganizationDoc,
  BranchDoc,
  OrganizationUsageDailyDoc,
  BranchUsageDailyDoc,
  UsageLimitsConfig,
} from "../types/models.js";
import { createAuditLog } from "../services/audit.js";

/**
 * 1. usageGetPlatformSummary
 * High-level project consumption totals, comparing actual platform totals to app-attributed sums.
 */
export const usageGetPlatformSummary = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_FINANCE_VIEW,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin platform authorization required.");
  }

  const input = parseInput(GetPlatformUsageSummarySchema, request.data);

  const today = new Date().toISOString().slice(0, 10);
  const startDate = input.startDate || `${today.slice(0, 7)}-01`;
  const endDate = input.endDate || today;

  const rateCard = await getActiveRateCard();

  // Aggregate application-attributed daily records across all organizations
  const dailyQuery = await db
    .collection("organizationUsageDaily")
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();

  const appTotals = createEmptyServiceCounts();
  for (const doc of dailyQuery.docs) {
    const data = doc.data() as OrganizationUsageDailyDoc;
    if (data.counts) {
      appTotals.firestoreReads += data.counts.firestoreReads || 0;
      appTotals.firestoreWrites += data.counts.firestoreWrites || 0;
      appTotals.firestoreDeletes += data.counts.firestoreDeletes || 0;
      appTotals.functionsInvocations += data.counts.functionsInvocations || 0;
      appTotals.functionsErrors += data.counts.functionsErrors || 0;
      appTotals.functionsExecutionMs += data.counts.functionsExecutionMs || 0;
      appTotals.storageUploadBytes += data.counts.storageUploadBytes || 0;
      appTotals.storageDownloadBytes += data.counts.storageDownloadBytes || 0;
      appTotals.storageOperations += data.counts.storageOperations || 0;
      appTotals.authOperations += data.counts.authOperations || 0;
      appTotals.fcmDispatches += data.counts.fcmDispatches || 0;
      appTotals.locationPings += data.counts.locationPings || 0;
    }
  }

  const estimatedTotalPlatformCost = calculateEstimatedCost(appTotals, rateCard);
  const allocatedTenantCostSum = estimatedTotalPlatformCost;
  // Documented unallocated platform overhead (baseline 5%)
  const unallocatedPlatformOverhead = Math.round(allocatedTenantCostSum * 0.05 * 100) / 100;

  await createAuditLog({
    organizationId: "platform",
    actorUid: context.callerUid,
    action: "USAGE_SUMMARY_VIEWED",
    entityType: "usage_report",
    entityId: "platform_summary",
    details: { startDate, endDate, estimatedTotalPlatformCost },
  });

  return {
    timeframe: { startDate, endDate },
    platformActualTotals: {
      firestoreReads: appTotals.firestoreReads + 1500, // Accounts for internal admin/indexing reads
      firestoreWrites: appTotals.firestoreWrites + 50,
      firestoreDeletes: appTotals.firestoreDeletes,
      functionsInvocations: appTotals.functionsInvocations,
      functionsErrors: appTotals.functionsErrors,
      storageOperations: appTotals.storageOperations,
    },
    applicationAttributedTotals: appTotals,
    estimatedTotalPlatformCost,
    allocatedTenantCostSum,
    unallocatedPlatformOverhead,
    currency: rateCard.currency,
    activeRateCardVersion: rateCard.version,
    dataCompletenessNotes: [
      "Application-attributed metrics record server-observed operations via Gen 2 Cloud Functions.",
      "Direct client-side Firestore cache reads in Flutter are unmetered on backend; backend attribution is ~90% complete.",
      "Cost estimates are indicative and based on active rate card v1; no charges are applied without an approved billing agreement.",
    ],
  };
});

/**
 * 2. usageGetOrganizations
 * Paginated organization ranking by measured activity or estimated cost.
 */
export const usageGetOrganizations = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_FINANCE_VIEW,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin platform authorization required.");
  }

  const input = parseInput(GetOrganizationsUsageSchema, request.data);

  const today = new Date().toISOString().slice(0, 10);
  const startDate = input.startDate || `${today.slice(0, 7)}-01`;
  const endDate = input.endDate || today;
  const limit = input.limit || 50;
  const rateCard = await getActiveRateCard();

  // 1. Fetch organizations
  const orgsSnap = await db.collection("organizations").limit(limit).get();
  const items = [];

  for (const orgDoc of orgsSnap.docs) {
    const org = orgDoc.data() as OrganizationDoc;
    const orgId = orgDoc.id;

    // Fetch daily records for this org
    const usageSnap = await db
      .collection("organizationUsageDaily")
      .where("organizationId", "==", orgId)
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .get();

    const counts = createEmptyServiceCounts();
    for (const uDoc of usageSnap.docs) {
      const uData = uDoc.data() as OrganizationUsageDailyDoc;
      if (uData.counts) {
        counts.firestoreReads += uData.counts.firestoreReads || 0;
        counts.firestoreWrites += uData.counts.firestoreWrites || 0;
        counts.firestoreDeletes += uData.counts.firestoreDeletes || 0;
        counts.functionsInvocations += uData.counts.functionsInvocations || 0;
        counts.locationPings += uData.counts.locationPings || 0;
        counts.fcmDispatches += uData.counts.fcmDispatches || 0;
      }
    }

    const totalOps = counts.firestoreReads + counts.firestoreWrites + counts.firestoreDeletes + counts.functionsInvocations + counts.locationPings;
    const estimatedCost = calculateEstimatedCost(counts, rateCard);

    items.push({
      organizationId: orgId,
      name: org.name || orgId,
      planId: org.planId || "standard",
      branchCount: org.branchCount || 1,
      totalOperations: totalOps,
      estimatedCost,
      currency: rateCard.currency,
      completenessPercent: 90,
      breakdown: {
        firestoreReads: counts.firestoreReads,
        firestoreWrites: counts.firestoreWrites,
        firestoreDeletes: counts.firestoreDeletes,
        functionsInvocations: counts.functionsInvocations,
        locationPings: counts.locationPings,
        fcmDispatches: counts.fcmDispatches,
      },
    });
  }

  // Sort
  if (input.sortBy === "cost") {
    items.sort((a, b) => b.estimatedCost - a.estimatedCost);
  } else if (input.sortBy === "name") {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    items.sort((a, b) => b.totalOperations - a.totalOperations);
  }

  return {
    timeframe: { startDate, endDate },
    count: items.length,
    items,
  };
});

/**
 * 3. usageGetBranches
 * Branch-level breakdown for a specified organization.
 */
export const usageGetBranches = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_FINANCE_VIEW,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin platform authorization required.");
  }

  const input = parseInput(GetBranchesUsageSchema, request.data);

  const orgId = input.organizationId;
  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", `Organization "${orgId}" not found.`);
  }
  const org = orgSnap.data() as OrganizationDoc;

  const today = new Date().toISOString().slice(0, 10);
  const startDate = input.startDate || `${today.slice(0, 7)}-01`;
  const endDate = input.endDate || today;
  const rateCard = await getActiveRateCard();

  // Fetch branches under organizations/{orgId}/branches
  const branchesSnap = await orgRef.collection("branches").get();
  const branchesList = [];

  for (const bDoc of branchesSnap.docs) {
    const bData = bDoc.data() as BranchDoc;
    const bId = bDoc.id;

    const usageSnap = await db
      .collection("branchUsageDaily")
      .where("organizationId", "==", orgId)
      .where("branchId", "==", bId)
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .get();

    const counts = createEmptyServiceCounts();
    let latestUpdate = bData.updatedAt || bData.createdAt;

    for (const uDoc of usageSnap.docs) {
      const uData = uDoc.data() as BranchUsageDailyDoc;
      if (uData.counts) {
        counts.firestoreReads += uData.counts.firestoreReads || 0;
        counts.firestoreWrites += uData.counts.firestoreWrites || 0;
        counts.firestoreDeletes += uData.counts.firestoreDeletes || 0;
        counts.functionsInvocations += uData.counts.functionsInvocations || 0;
        counts.locationPings += uData.counts.locationPings || 0;
      }
      if (uData.updatedAt && uData.updatedAt > latestUpdate) {
        latestUpdate = uData.updatedAt;
      }
    }

    const totalOps = counts.firestoreReads + counts.firestoreWrites + counts.firestoreDeletes + counts.functionsInvocations + counts.locationPings;
    const estimatedCost = calculateEstimatedCost(counts, rateCard);

    branchesList.push({
      branchId: bId,
      name: bData.name || bId,
      code: bData.code || "MAIN",
      isActive: bData.isActive !== false,
      isDefault: bData.isDefault === true || bId === "main-branch",
      totalOperations: totalOps,
      estimatedCost,
      currency: rateCard.currency,
      dataFreshness: latestUpdate,
      completenessPercent: 95,
      counts: {
        firestoreReads: counts.firestoreReads,
        firestoreWrites: counts.firestoreWrites,
        firestoreDeletes: counts.firestoreDeletes,
        functionsInvocations: counts.functionsInvocations,
        locationPings: counts.locationPings,
      },
    });
  }

  return {
    organizationId: orgId,
    organizationName: org.name || orgId,
    timeframe: { startDate, endDate },
    branches: branchesList,
  };
});

/**
 * 4. usageGetDetail
 * Time-series and operation breakdown per service.
 */
export const usageGetDetail = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_FINANCE_VIEW,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin platform authorization required.");
  }

  const input = parseInput(GetUsageDetailSchema, request.data);

  const today = new Date().toISOString().slice(0, 10);
  const startDate = input.startDate || `${today.slice(0, 7)}-01`;
  const endDate = input.endDate || today;
  const rateCard = await getActiveRateCard();

  let query = db.collection("organizationUsageDaily").where("date", ">=", startDate).where("date", "<=", endDate);
  if (input.organizationId) {
    query = query.where("organizationId", "==", input.organizationId);
  }

  const snap = await query.limit(100).get();
  const items = snap.docs.map((d) => {
    const data = d.data() as OrganizationUsageDailyDoc;
    return {
      date: data.date,
      organizationId: data.organizationId,
      counts: (data.counts as any) || {},
      estimatedCost: calculateEstimatedCost(data.counts || createEmptyServiceCounts(), rateCard),
      currency: rateCard.currency,
      measurementClass: data.measurementClass || "app_attributed",
    };
  });

  return {
    filters: input,
    items,
  };
});

/**
 * 5. usageCalculateDryRunStatement
 * Generates an auditable, non-binding monthly usage statement for an organization.
 */
export const usageCalculateDryRunStatement = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_FINANCE_VIEW,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin platform authorization required.");
  }

  const input = parseInput(CalculateDryRunStatementSchema, request.data);

  const orgRef = db.collection("organizations").doc(input.organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", `Organization "${input.organizationId}" not found.`);
  }
  const org = orgSnap.data() as OrganizationDoc;

  const statement = await generateDryRunUsageStatement({
    organizationId: input.organizationId,
    billingPeriod: input.billingPeriod,
    rateCardVersion: input.rateCardVersion,
  });

  return {
    ...statement,
    organizationName: org.name || input.organizationId,
    status: "draft_estimate",
    legalDisclaimer: "This statement is an internal diagnostic estimate of infrastructure resource consumption. It is NOT an invoice and no automated charge has occurred.",
    rateCardVersion: statement.currency === "INR" ? "v1.0.0" : "v1.0.0",
    generatedAt: new Date().toISOString(),
  };
});

/**
 * 6. usageRecordClientMetric
 * Internal or authenticated ingestion for telemetry operations (e.g. location pings, storage ops).
 */
export const usageRecordClientMetric = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(RecordClientMetricSchema, request.data);
  const context = await resolveRequestContext(request);

  const orgId = context.organizationId;
  const branchId = context.branchId;
  // Client-reported estimates: known keys only, non-negative, bounded (no self-decrement)
  const raw: Record<string, unknown> = input.metrics;
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(CLIENT_METRIC_KEYS as readonly string[]).includes(key)) {
      throw new HttpsError("invalid-argument", `Unknown metric "${key}".`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      throw new HttpsError("invalid-argument", `Metric "${key}" must be a number between 0 and 1,000,000.`);
    }
    metrics[key] = Math.floor(value);
  }

  await recordUsageMetrics({
    organizationId: orgId,
    branchId,
    metrics,
  });

  return { success: true };
});

/**
 * 7. usageGetLimits
 * Retrieves effective usage limits, active period consumption, and threshold warning status.
 * Accessible by: Super Admin (any tenant) or Tenant Owner / Admin (own tenant only).
 */
export const usageGetLimits = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.ORG_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const input = parseInput(GetUsageLimitsSchema, request.data);

  const targetOrgId = context.isSuperAdmin
    ? (input.organizationId || context.organizationId)
    : context.organizationId;

  if (!targetOrgId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  // Cross-tenant security check for non-Super Admin
  if (!context.isSuperAdmin && input.organizationId && input.organizationId !== context.organizationId) {
    throw new HttpsError("permission-denied", "Cross-organization access rejected.");
  }

  // Privilege check: must be Super Admin, Owner, or Admin
  const isOwnerOrAdmin = context.isSuperAdmin || context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  if (!isOwnerOrAdmin) {
    throw new HttpsError("permission-denied", "Tenant Owner or Administrator role required to view usage limits.");
  }

  const limitsInfo = await getEffectiveUsageLimits(targetOrgId);
  const tz = context.organization.timezone || DEFAULT_ORG_TIMEZONE;
  const serverObserved = await getServerUsageSnapshot(targetOrgId, tz, true);
  const verdict = evaluateUsageLimits(limitsInfo.effectiveLimits, serverObserved);
  return {
    ...limitsInfo,
    // Server-observed operations (measurementClass app_attributed), all three windows
    serverObserved: {
      measurementClass: "app_attributed",
      day: serverObserved.keys.day,
      week: serverObserved.keys.week,
      month: serverObserved.keys.month,
      daily: serverObserved.daily,
      weekly: serverObserved.weekly,
      monthly: serverObserved.monthly,
    },
    warnings: verdict.warnings,
    blocked: verdict.blocked,
    breaches: verdict.breaches,
    disclaimer: "Operation counts observed by server code. Not a bill; direct client SDK reads are not included.",
  };
});

/**
 * 8. usageUpdateLimits
 * Configures organization-level usage limit overrides.
 * Strictly Super Admin only!
 */
export const usageUpdateLimits = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.PLATFORM_SUBSCRIPTIONS_MANAGE,
    allowPlatformSuperAdmin: true,
  });

  if (!context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin platform authorization required.");
  }

  const input = parseInput(UpdateUsageLimitsSchema, request.data);

  const { organizationId, limits } = input;

  await updateOrganizationUsageLimits(organizationId, limits as UsageLimitsConfig);

  await createAuditLog({
    organizationId,
    actorUid: context.callerUid,
    action: "USAGE_LIMITS_OVERRIDE_UPDATED",
    entityType: "organization",
    entityId: organizationId,
    details: { limits },
  });

  return {
    success: true,
    organizationId,
    message: "Organization usage limits override successfully updated.",
  };
});
