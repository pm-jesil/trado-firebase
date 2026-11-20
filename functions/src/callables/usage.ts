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

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
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
  PLATFORM_COST_CURRENCY,
} from "../services/usageMetering.js";
import {
  OrganizationDoc,
  BranchDoc,
  BranchUsageDailyDoc,
  UsageLimitsConfig,
} from "../types/models.js";
import { readRollups, sumRollups, estimateCost, top, COVERAGE } from "../services/usageReport.js";

/** The requested date range, the current month to date by default (UTC dates: rollup buckets). */
function usageRange(input: { startDate?: string; endDate?: string }): { startDate: string; endDate: string } {
  const today = new Date().toISOString().slice(0, 10);
  return { startDate: input.startDate || `${today.slice(0, 7)}-01`, endDate: input.endDate || today };
}

/** Devices seen in user-day rollups (deviceId → calls). */
function sumDevices(days: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) for (const [id, v] of Object.entries((d.devices as Record<string, { calls?: number }>) || {})) out[id] = (out[id] || 0) + (v.calls || 0);
  return out;
}

/** Computed at read time, no write: the last day above 3 × the average of the 7 days before it. */
function anomalyOf(days: Array<Record<string, unknown>>): { date: string; calls: number; sevenDayAverage: number } | null {
  const sorted = [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (sorted.length < 2) return null;
  const last = sorted[sorted.length - 1];
  const prior = sorted.slice(-8, -1);
  const avg = prior.reduce((s, d) => s + (Number(d.calls) || 0), 0) / prior.length;
  return avg > 0 && Number(last.calls) > 3 * avg ? { date: String(last.date), calls: Number(last.calls), sevenDayAverage: Math.round(avg * 10) / 10 } : null;
}

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
  const { startDate, endDate } = usageRange(input);
  const rateCard = await getActiveRateCard();

  // Measured rollups of every organization and of the platform itself (D-21), priced when read (D-22).
  const [docs, reconSnap] = await Promise.all([
    readRollups("organizationUsageDaily", { startDate, endDate, limit: 10000 }),
    db.collection("platformCostReconciliation").orderBy("day", "desc").limit(1).get(),
  ]);
  const all = sumRollups(docs);
  const tenants = sumRollups(docs.filter((d) => d.organizationId !== "platform"));
  const platform = sumRollups(docs.filter((d) => d.organizationId === "platform"));
  const cost = estimateCost(all, rateCard);
  const latestRecon = !reconSnap.empty ? (reconSnap.docs[0].data() as { day?: string; overallRatio?: number; estimatedTotalCost?: number; billedTotalCost?: number; residualTotalCost?: number; lines?: unknown[] }) : null;
  const calibration = latestRecon ? {
    lastReconciledDate: latestRecon.day ?? null,
    overallRatio: latestRecon.overallRatio ?? null,
    estimatedTotalCost: latestRecon.estimatedTotalCost ?? null,
    billedTotalCost: latestRecon.billedTotalCost ?? null,
    residualTotalCost: latestRecon.residualTotalCost ?? null,
    label: `estimate, last reconciled ${latestRecon.day}, ratio ${latestRecon.overallRatio}`,
    lines: latestRecon.lines ?? [],
  } : {
    lastReconciledDate: null,
    overallRatio: null,
    estimatedTotalCost: null,
    billedTotalCost: null,
    residualTotalCost: null,
    label: "estimate, not yet reconciled against billing export",
    lines: [],
  };

  return {
    timeframe: { startDate, endDate },
    totalApiCalls: all.calls,
    applicationAttributedTotals: {
      firestoreReads: all.ops.reads,
      firestoreWrites: all.ops.writes,
      firestoreDeletes: all.ops.deletes,
      functionsInvocations: all.calls,
      functionsErrors: all.errors,
      functionsDenied: all.denied,
    },
    byCategory: all.byCategory,
    topCallables: top(all.byCallable, 10),
    topCollections: top(all.byCollection, 10),
    redundantReads: all.redundantReads,
    estimatedTotalPlatformCost: cost.total,
    allocatedTenantCostSum: estimateCost(tenants, rateCard).total,
    // Measured, not a percentage: work of the platform (Super Admin, scheduled jobs, unauthenticated calls).
    unallocatedPlatformOverhead: estimateCost(platform, rateCard).total,
    cost,
    currency: rateCard.currency,
    activeRateCardVersion: rateCard.version,
    freeAllowance: rateCard.freeTier ?? null,
    calibration,
    coverage: COVERAGE,
    dataCompletenessNotes: [COVERAGE.note, ...COVERAGE.excluded.map((e) => `Not included: ${e}.`), cost.verified ? "Prices verified." : "Prices not verified against the official pricing page (rate card verification flags)."],
    readCost: { documentsRead: docs.length + reconSnap.size },
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
  const { startDate, endDate } = usageRange(input);
  const limit = input.limit || 50;
  const rateCard = await getActiveRateCard();

  // One range query for every organization's day rollups (not one query per organization).
  const [orgsSnap, docs] = await Promise.all([
    db.collection("organizations").limit(limit).get(),
    readRollups("organizationUsageDaily", { startDate, endDate, limit: 10000 }),
  ]);
  const byOrg = new Map<string, typeof docs>();
  for (const d of docs) byOrg.set(String(d.organizationId), [...(byOrg.get(String(d.organizationId)) || []), d]);
  const platformTargets = sumRollups(byOrg.get("platform") || []).targets || {};

  const items = orgsSnap.docs.map((orgDoc) => {
    const org = orgDoc.data() as OrganizationDoc;
    const days = byOrg.get(orgDoc.id) || [];
    const t = sumRollups(days);
    const cost = estimateCost(t, rateCard);
    return {
      organizationId: orgDoc.id,
      name: org.name || orgDoc.id,
      planId: org.planId || null,
      branchCount: org.branchCount || 1,
      calls: t.calls,
      totalOperations: t.ops.reads + t.ops.writes + t.ops.deletes,
      estimatedCost: cost.total,
      costVerified: cost.verified,
      currency: rateCard.currency,
      breakdown: { firestoreReads: t.ops.reads, firestoreWrites: t.ops.writes, firestoreDeletes: t.ops.deletes, functionsInvocations: t.calls },
      byCategory: t.byCategory,
      // Platform work done for this organization: not charged to it (D-21).
      platformWorkOnBehalf: platformTargets[orgDoc.id] || null,
      anomaly: anomalyOf(days),
    };
  });
  if (input.sortBy === "cost") items.sort((a, b) => b.estimatedCost - a.estimatedCost);
  else if (input.sortBy === "name") items.sort((a, b) => a.name.localeCompare(b.name));
  else items.sort((a, b) => b.totalOperations - a.totalOperations);

  return {
    timeframe: { startDate, endDate },
    organizations: items,
    items,
    totalCount: items.length,
    rateCardVersion: rateCard.version,
    coverage: COVERAGE,
    readCost: { documentsRead: orgsSnap.size + docs.length },
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
      // Branch documents hold what the app reported (usageRecordClientMetric), not server measurements.
      const reported = uData.clientReported;
      if (reported) {
        counts.firestoreReads += reported.firestoreReads || 0;
        counts.firestoreWrites += reported.firestoreWrites || 0;
        counts.firestoreDeletes += reported.firestoreDeletes || 0;
        counts.functionsInvocations += reported.functionsInvocations || 0;
        counts.locationPings += reported.locationPings || 0;
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
      measurementClass: "client_reported", // what the app reported; not measured by the server
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
  const input = parseInput(GetUsageDetailSchema, request.data);
  const isSuperAdmin = request.auth?.token.isSuperAdmin === true;
  // Tenants: quantities with usage:read, every user with usage:read_users, always their own (D-25);
  // the cost estimate only for the Super Admin or when showCostToTenant is on.
  const ctx = isSuperAdmin
    ? await resolveRequestContext(request, { requiredPermission: AppPermissions.PLATFORM_FINANCE_VIEW, allowPlatformSuperAdmin: true })
    : await resolveRequestContext(request);
  const organizationId = ctx.organizationId;
  const canOrg = isSuperAdmin || ctx.can(AppPermissions.USAGE_READ);
  const canUsers = isSuperAdmin || ctx.can(AppPermissions.USAGE_READ_USERS);
  const showCost = isSuperAdmin || ctx.organization.showCostToTenant === true;
  const { startDate, endDate } = usageRange(input);
  const rateCard = await getActiveRateCard();

  const [orgDays, userDays] = await Promise.all([
    canOrg ? readRollups("organizationUsageDaily", { organizationId, startDate, endDate, limit: 400 }) : Promise.resolve([]),
    readRollups("userUsageDaily", canUsers ? { organizationId, startDate, endDate, limit: 5000 } : { organizationId, uid: ctx.callerUid, startDate, endDate, limit: 400 }),
  ]);
  const scope = canOrg ? orgDays : userDays.filter((d) => d.uid === ctx.callerUid);
  const t = sumRollups(scope);
  const bucket = (d: Record<string, unknown>) => (input.granularity === "monthly" ? String(d.date).slice(0, 7) : String(d.date));
  const series = new Map<string, Array<Record<string, unknown>>>();
  for (const d of scope) series.set(bucket(d), [...(series.get(bucket(d)) || []), d]);
  const users = new Map<string, Array<Record<string, unknown>>>();
  for (const d of userDays) users.set(String(d.uid), [...(users.get(String(d.uid)) || []), d]);
  const userRows = [...users.entries()].map(([uid, days]) => {
    const u = sumRollups(days);
    const last = days.map((d) => d.lastSeenAt as { toDate?: () => Date } | undefined).filter((x) => x && x.toDate).map((x) => x!.toDate!().getTime());
    return { uid, calls: u.calls, reads: u.ops.reads, writes: u.ops.writes, deletes: u.ops.deletes, lastSeenAt: last.length ? new Date(Math.max(...last)).toISOString() : null, devices: sumDevices(days) };
  }).sort((a, b) => (b.reads + b.writes + b.deletes) - (a.reads + a.writes + a.deletes));

  return {
    organizationId,
    timeframe: { startDate, endDate },
    scope: canOrg ? "organization" : "own",
    totals: { calls: t.calls, errors: t.errors, denied: t.denied, reads: t.ops.reads, writes: t.ops.writes, deletes: t.ops.deletes, aggregationReads: t.ops.aggregationReads || 0, durationMsSum: t.durationMsSum, bytesIn: t.bytesIn, bytesOut: t.bytesOut, redundantReads: t.redundantReads },
    series: [...series.entries()].sort().map(([period, days]) => { const p = sumRollups(days); return { period, calls: p.calls, reads: p.ops.reads, writes: p.ops.writes, deletes: p.ops.deletes, errors: p.errors, denied: p.denied }; }),
    items: [...series.entries()].sort().map(([period, days]) => { const p = sumRollups(days); return { period, calls: p.calls, reads: p.ops.reads, writes: p.ops.writes, deletes: p.ops.deletes, errors: p.errors, denied: p.denied }; }),
    count: series.size,
    hourOfDayUtc: t.hourly,
    byCategory: t.byCategory,
    topCallables: top(t.byCallable, 10),
    topCollections: top(t.byCollection, 10),
    users: canUsers ? userRows : null,
    topUsers: canUsers ? userRows.slice(0, 10) : null,
    own: userRows.find((u) => u.uid === ctx.callerUid) || null,
    cost: showCost ? estimateCost(t, rateCard) : null,
    coverage: COVERAGE,
    readCost: { documentsRead: orgDays.length + userDays.length },
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
    rateCardVersion: statement.currency === PLATFORM_COST_CURRENCY ? "v1.0.0" : "v1.0.0",
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


  return {
    success: true,
    organizationId,
    message: "Organization usage limits override successfully updated.",
  };
});
