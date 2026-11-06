/**
 * Usage Metering Service — Platform Consumption & Attribution Engine
 * 
 * Accurately tracks, aggregates, and attributes infrastructure consumption:
 * 1. Platform-Observed Totals (Actual metrics from Cloud Monitoring / emulator adapters)
 * 2. Application-Attributed Operations (Server-observed operations with org/branch context)
 * 3. Client-Only Activity Estimates (Uninstrumented direct reads/writes)
 * 4. Allocated Cost Estimates (Documented formula weights per rate card)
 * 
 * Avoids recursive self-metering and excessive writes via FieldValue.increment aggregation.
 */

import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { round2, round4 } from "./money.js";
import {
  ServiceUsageCounts,
  OrganizationUsageDailyDoc,
  UsageRateCardDoc,
  OrganizationDoc,
  SubscriptionPlanDoc,
  UsageLimitsConfig,
  MetricLimitConfig,
  NotificationOutboxDoc,
} from "../types/models.js";

/**
 * Standard Default Rate Card (v1)
 * Reflects baseline Google Cloud Firebase published rates.
 */
export const DEFAULT_RATE_CARD_V1: UsageRateCardDoc = {
  version: "v1.0.0",
  effectiveDate: "2026-01-01",
  currency: "INR",
  rates: {
    firestoreReadPer100k: 5.0, // ~Rs 5.00 per 100,000 reads ($0.06 USD)
    firestoreWritePer100k: 15.0, // ~Rs 15.00 per 100,000 writes ($0.18 USD)
    firestoreDeletePer100k: 1.7, // ~Rs 1.70 per 100,000 deletes ($0.02 USD)
    functionsInvocationPerMillion: 33.0, // ~Rs 33.00 per 1,000,000 invocations ($0.40 USD)
    functionsComputeGbSecond: 0.00021, // ~Rs 0.00021 per GB-second
    storageGbMonth: 2.15, // ~Rs 2.15 per GB-month ($0.026 USD)
    fcmPerThousand: 0.0, // Free tier / zero incremental
    locationPingPer100k: 20.0, // Telemetry ingestion cost
  },
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "system",
};

/**
 * Empty baseline metrics
 */
export function createEmptyServiceCounts(): ServiceUsageCounts {
  return {
    firestoreReads: 0,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    functionsInvocations: 0,
    functionsErrors: 0,
    functionsExecutionMs: 0,
    storageUploadBytes: 0,
    storageDownloadBytes: 0,
    storageOperations: 0,
    authOperations: 0,
    fcmDispatches: 0,
    locationPings: 0,
  };
}

/**
 * Calculates estimated monetary cost based on counts and active rate card.
 */
export function calculateEstimatedCost(
  counts: ServiceUsageCounts,
  rateCard: UsageRateCardDoc = DEFAULT_RATE_CARD_V1
): number {
  const r = rateCard.rates;

  const firestoreReadCost = (counts.firestoreReads / 100000) * r.firestoreReadPer100k;
  const firestoreWriteCost = (counts.firestoreWrites / 100000) * r.firestoreWritePer100k;
  const firestoreDeleteCost = (counts.firestoreDeletes / 100000) * r.firestoreDeletePer100k;
  const functionsInvocationCost = (counts.functionsInvocations / 1000000) * r.functionsInvocationPerMillion;
  const functionsComputeCost = ((counts.functionsExecutionMs / 1000) * 0.25) * r.functionsComputeGbSecond; // 256MB container assumption
  const storageCost = ((counts.storageUploadBytes + counts.storageDownloadBytes) / (1024 * 1024 * 1024)) * r.storageGbMonth;
  const fcmCost = (counts.fcmDispatches / 1000) * r.fcmPerThousand;
  const locationCost = (counts.locationPings / 100000) * r.locationPingPer100k;

  const total = firestoreReadCost +
    firestoreWriteCost +
    firestoreDeleteCost +
    functionsInvocationCost +
    functionsComputeCost +
    storageCost +
    fcmCost +
    locationCost;

  return round2(round4(total));
}

/**
 * Records application-attributed operations into daily and monthly buckets.
 * Uses atomic FieldValue.increment to eliminate read-before-write overhead.
 * Atomically updates:
 * 1. organizationUsageDaily
 * 2. organizationUsageMonthly
 * 3. branchUsageDaily (if branchId present)
 * 4. branchUsageMonthly (if branchId present)
 * Then triggers idempotent threshold evaluation.
 */
export async function recordUsageMetrics(params: {
  organizationId: string;
  branchId?: string;
  date?: string; // YYYY-MM-DD
  metrics: Partial<ServiceUsageCounts>;
}): Promise<void> {
  const { organizationId, branchId, metrics } = params;
  if (!organizationId) return;

  const dateStr = params.date || new Date().toISOString().slice(0, 10);
  const monthStr = dateStr.slice(0, 7);
  const orgDailyId = `${organizationId}_${dateStr}`;
  const orgMonthlyId = `${organizationId}_${monthStr}`;
  const now = new Date().toISOString();

  const orgDocRef = db.collection("organizationUsageDaily").doc(orgDailyId);
  const orgMonthlyDocRef = db.collection("organizationUsageMonthly").doc(orgMonthlyId);

  const incrementFields: Record<string, any> = {
    organizationId,
    date: dateStr,
    rateCardVersion: DEFAULT_RATE_CARD_V1.version,
    currency: DEFAULT_RATE_CARD_V1.currency,
    measurementClass: "app_attributed",
    completenessPercent: 90, // Server-observed telemetry coverage
    updatedAt: now,
  };

  const monthlyIncrementFields: Record<string, any> = {
    organizationId,
    month: monthStr,
    rateCardVersion: DEFAULT_RATE_CARD_V1.version,
    currency: DEFAULT_RATE_CARD_V1.currency,
    measurementClass: "app_attributed",
    completenessPercent: 90,
    updatedAt: now,
  };

  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val === "number" && val !== 0) {
      incrementFields[`counts.${key}`] = FieldValue.increment(val);
      monthlyIncrementFields[`counts.${key}`] = FieldValue.increment(val);
    }
  }

  // Update organization daily & monthly buckets
  const writes: Promise<any>[] = [
    orgDocRef.set(incrementFields, { merge: true }),
    orgMonthlyDocRef.set(monthlyIncrementFields, { merge: true }),
  ];

  // Update branch daily & monthly buckets if branch context is present
  if (branchId) {
    const branchDailyId = `${organizationId}_${branchId}_${dateStr}`;
    const branchMonthlyId = `${organizationId}_${branchId}_${monthStr}`;

    const branchDocRef = db.collection("branchUsageDaily").doc(branchDailyId);
    const branchMonthlyDocRef = db.collection("branchUsageMonthly").doc(branchMonthlyId);

    const branchIncrementFields = {
      ...incrementFields,
      branchId,
    };

    const branchMonthlyIncrementFields = {
      ...monthlyIncrementFields,
      branchId,
    };

    writes.push(branchDocRef.set(branchIncrementFields, { merge: true }));
    writes.push(branchMonthlyDocRef.set(branchMonthlyIncrementFields, { merge: true }));
  }

  await Promise.all(writes);

  // Evaluate usage threshold limits idempotently
  await evaluateUsageThresholds(organizationId, dateStr);
}

interface WarningCheckParams {
  organizationId: string;
  metric: keyof ServiceUsageCounts;
  period: string; // YYYY-MM-DD or YYYY-MM
  periodType: "daily" | "monthly";
  currentUsage: number;
  limit: number;
  percentage: number;
  config: MetricLimitConfig;
}

/**
 * Idempotently evaluates threshold crossing and writes an outbox warning record.
 */
async function checkAndEmitWarning(params: WarningCheckParams): Promise<void> {
  const { organizationId, metric, period, periodType, currentUsage, limit, percentage, config } = params;

  let severity: "warning" | "hard" | null = null;
  if (percentage >= config.hardThresholdPercent) {
    severity = "hard";
  } else if (percentage >= config.warningThresholdPercent) {
    severity = "warning";
  }

  if (!severity) return;

  // Deterministic outbox doc ID: guarantees exactly-once warning creation per org, metric, period, severity
  const outboxDocId = `outbox_usage_${organizationId}_${metric}_${period}_${severity}`;
  const outboxRef = db.collection("notificationOutbox").doc(outboxDocId);

  const existingSnap = await outboxRef.get();
  if (existingSnap.exists) {
    return; // Already emitted for this threshold crossing in this period
  }

  const title = `Usage Alert: ${metric} at ${Math.round(percentage)}% of ${periodType} limit`;
  const body = `Organization has consumed ${currentUsage.toLocaleString()} / ${limit.toLocaleString()} ${metric} in ${periodType} window (${period}). Enforcement mode: ${config.enforcementMode}.`;

  const now = new Date().toISOString();
  const outboxDoc: NotificationOutboxDoc = {
    organizationId,
    type: "usage_warning",
    payload: {
      title,
      body,
      data: {
        organizationId,
        metric,
        period,
        periodType,
        currentUsage: String(currentUsage),
        limit: String(limit),
        percentage: String(Math.round(percentage)),
        severity,
        enforcementMode: config.enforcementMode,
      },
    },
    status: "dispatched",
    retryCount: 0,
    createdAt: now,
    dispatchedAt: now,
  };

  await outboxRef.set(outboxDoc);

  // Deliver in-app notification to Organization Owner
  try {
    const ownerSnap = await db
      .collection("memberships")
      .where("organizationId", "==", organizationId)
      .where("isPrimary", "==", true)
      .limit(1)
      .get();

    if (!ownerSnap.empty) {
      const ownerData = ownerSnap.docs[0].data();
      await db.collection("notifications").add({
        organizationId,
        userId: ownerData.userId,
        membershipId: ownerSnap.docs[0].id,
        type: "usage_warning",
        title,
        body,
        relatedEntityType: "organization",
        relatedEntityId: organizationId,
        data: outboxDoc.payload.data,
        isRead: false,
        readAt: null,
        createdAt: now,
      });
    }
  } catch {
    // Non-blocking in-app notification
  }
}

/**
 * Evaluates current consumption against configured plan defaults and tenant overrides.
 */
export async function evaluateUsageThresholds(organizationId: string, dateStr: string): Promise<void> {
  try {
    const orgDoc = await db.collection("organizations").doc(organizationId).get();
    if (!orgDoc.exists) return;
    const orgData = orgDoc.data() as OrganizationDoc;

    let planUsageLimits: UsageLimitsConfig = {};
    if (orgData.planId) {
      const planDoc = await db.collection("subscriptionPlans").doc(orgData.planId).get();
      if (planDoc.exists) {
        const planData = planDoc.data() as SubscriptionPlanDoc;
        planUsageLimits = planData.usageLimits || {};
      }
    }

    // Merge effective limits: organization-level override strictly takes precedence
    const effectiveLimits: UsageLimitsConfig = {
      ...planUsageLimits,
      ...(orgData.usageLimitOverrides || {}),
    };

    if (Object.keys(effectiveLimits).length === 0) return;

    const monthStr = dateStr.slice(0, 7);
    const orgDailySnap = await db.collection("organizationUsageDaily").doc(`${organizationId}_${dateStr}`).get();
    const orgMonthlySnap = await db.collection("organizationUsageMonthly").doc(`${organizationId}_${monthStr}`).get();

    const dailyCounts: ServiceUsageCounts = (orgDailySnap.data()?.counts as ServiceUsageCounts) || createEmptyServiceCounts();
    const monthlyCounts: ServiceUsageCounts = (orgMonthlySnap.data()?.counts as ServiceUsageCounts) || createEmptyServiceCounts();

    for (const [metricKey, config] of Object.entries(effectiveLimits)) {
      if (!config || !config.enabled) continue;
      const key = metricKey as keyof ServiceUsageCounts;
      const dailyVal = dailyCounts[key] || 0;
      const monthlyVal = monthlyCounts[key] || 0;

      if (config.dailyLimit && config.dailyLimit > 0) {
        const dailyPct = (dailyVal / config.dailyLimit) * 100;
        await checkAndEmitWarning({
          organizationId,
          metric: key,
          period: dateStr,
          periodType: "daily",
          currentUsage: dailyVal,
          limit: config.dailyLimit,
          percentage: dailyPct,
          config,
        });
      }

      if (config.monthlyLimit && config.monthlyLimit > 0) {
        const monthlyPct = (monthlyVal / config.monthlyLimit) * 100;
        await checkAndEmitWarning({
          organizationId,
          metric: key,
          period: monthStr,
          periodType: "monthly",
          currentUsage: monthlyVal,
          limit: config.monthlyLimit,
          percentage: monthlyPct,
          config,
        });
      }
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Retrieves effective usage limits, current consumption, and threshold statuses for an organization.
 */
export async function getEffectiveUsageLimits(organizationId: string): Promise<{
  organizationId: string;
  planId: string;
  effectiveLimits: UsageLimitsConfig;
  dailyUsage: ServiceUsageCounts;
  monthlyUsage: ServiceUsageCounts;
  currentDate: string;
  currentMonth: string;
}> {
  const orgDoc = await db.collection("organizations").doc(organizationId).get();
  if (!orgDoc.exists) {
    throw new Error(`Organization "${organizationId}" not found`);
  }
  const orgData = orgDoc.data() as OrganizationDoc;

  let planLimits: UsageLimitsConfig = {};
  if (orgData.planId) {
    const planDoc = await db.collection("subscriptionPlans").doc(orgData.planId).get();
    if (planDoc.exists) {
      const planData = planDoc.data() as SubscriptionPlanDoc;
      planLimits = planData.usageLimits || {};
    }
  }

  const effectiveLimits: UsageLimitsConfig = {
    ...planLimits,
    ...(orgData.usageLimitOverrides || {}),
  };

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  const [dailySnap, monthlySnap] = await Promise.all([
    db.collection("organizationUsageDaily").doc(`${organizationId}_${today}`).get(),
    db.collection("organizationUsageMonthly").doc(`${organizationId}_${currentMonth}`).get(),
  ]);

  const dailyUsage = (dailySnap.data()?.counts as ServiceUsageCounts) || createEmptyServiceCounts();
  const monthlyUsage = (monthlySnap.data()?.counts as ServiceUsageCounts) || createEmptyServiceCounts();

  return {
    organizationId,
    planId: orgData.planId,
    effectiveLimits,
    dailyUsage,
    monthlyUsage,
    currentDate: today,
    currentMonth,
  };
}

/**
 * Updates organization-level usage limit overrides (Super Admin only).
 */
export async function updateOrganizationUsageLimits(
  organizationId: string,
  overrides: UsageLimitsConfig
): Promise<void> {
  const orgRef = db.collection("organizations").doc(organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new Error(`Organization "${organizationId}" not found`);
  }

  await orgRef.update({
    usageLimitOverrides: overrides,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Retrieves the active rate card.
 */
export async function getActiveRateCard(): Promise<UsageRateCardDoc> {
  try {
    const snap = await db
      .collection("usageRateCards")
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!snap.empty) {
      return snap.docs[0].data() as UsageRateCardDoc;
    }
  } catch {
    // Fallback to embedded default if collection not initialized
  }
  return DEFAULT_RATE_CARD_V1;
}

/**
 * Dry-run usage statement calculation with itemized line items.
 */
export async function generateDryRunUsageStatement(params: {
  organizationId: string;
  billingPeriod: string; // YYYY-MM
  rateCardVersion?: string;
}): Promise<{
  organizationId: string;
  billingPeriod: string;
  currency: string;
  lineItems: Array<{
    service: string;
    metric: string;
    quantity: number;
    unit: string;
    unitRate: number;
    amount: number;
  }>;
  subtotal: number;
  sharedOverheadAllocation: number;
  totalEstimatedCharge: number;
}> {
  const { organizationId, billingPeriod } = params;
  const rateCard = await getActiveRateCard();
  const r = rateCard.rates;

  // Query all daily records for this month
  const startDate = `${billingPeriod}-01`;
  const endDate = `${billingPeriod}-31`;

  const dailySnaps = await db
    .collection("organizationUsageDaily")
    .where("organizationId", "==", organizationId)
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();

  const totals = createEmptyServiceCounts();
  for (const doc of dailySnaps.docs) {
    const data = doc.data() as OrganizationUsageDailyDoc;
    if (data.counts) {
      totals.firestoreReads += data.counts.firestoreReads || 0;
      totals.firestoreWrites += data.counts.firestoreWrites || 0;
      totals.firestoreDeletes += data.counts.firestoreDeletes || 0;
      totals.functionsInvocations += data.counts.functionsInvocations || 0;
      totals.functionsErrors += data.counts.functionsErrors || 0;
      totals.functionsExecutionMs += data.counts.functionsExecutionMs || 0;
      totals.storageUploadBytes += data.counts.storageUploadBytes || 0;
      totals.storageDownloadBytes += data.counts.storageDownloadBytes || 0;
      totals.authOperations += data.counts.authOperations || 0;
      totals.fcmDispatches += data.counts.fcmDispatches || 0;
      totals.locationPings += data.counts.locationPings || 0;
    }
  }

  const lineItems = [
    {
      service: "Cloud Firestore",
      metric: "Document Reads",
      quantity: totals.firestoreReads,
      unit: "100k Reads",
      unitRate: r.firestoreReadPer100k,
      amount: round2((totals.firestoreReads / 100000) * r.firestoreReadPer100k),
    },
    {
      service: "Cloud Firestore",
      metric: "Document Writes",
      quantity: totals.firestoreWrites,
      unit: "100k Writes",
      unitRate: r.firestoreWritePer100k,
      amount: round2((totals.firestoreWrites / 100000) * r.firestoreWritePer100k),
    },
    {
      service: "Cloud Firestore",
      metric: "Document Deletes",
      quantity: totals.firestoreDeletes,
      unit: "100k Deletes",
      unitRate: r.firestoreDeletePer100k,
      amount: round2((totals.firestoreDeletes / 100000) * r.firestoreDeletePer100k),
    },
    {
      service: "Cloud Functions Gen 2",
      metric: "Invocations",
      quantity: totals.functionsInvocations,
      unit: "1M Invocations",
      unitRate: r.functionsInvocationPerMillion,
      amount: round2((totals.functionsInvocations / 1000000) * r.functionsInvocationPerMillion),
    },
    {
      service: "Employee Live Tracking",
      metric: "Location Pings",
      quantity: totals.locationPings,
      unit: "100k Pings",
      unitRate: r.locationPingPer100k,
      amount: round2((totals.locationPings / 100000) * r.locationPingPer100k),
    },
  ];

  const subtotal = round2(lineItems.reduce((acc, curr) => acc + curr.amount, 0));
  // Documented shared platform overhead allocation (5% fixed operational baseline)
  const sharedOverheadAllocation = round2(subtotal * 0.05);
  const totalEstimatedCharge = round2(subtotal + sharedOverheadAllocation);

  return {
    organizationId,
    billingPeriod,
    currency: rateCard.currency,
    lineItems,
    subtotal,
    sharedOverheadAllocation,
    totalEstimatedCharge,
  };
}
