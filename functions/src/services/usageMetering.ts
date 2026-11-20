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
import { Money, round4 } from "./money.js";
import { readRollups, sumRollups, estimateCost } from "./usageReport.js";
import {
  ServiceUsageCounts,
  UsageRateCardDoc,
  OrganizationDoc,
  SubscriptionPlanDoc,
  UsageLimitsConfig,
  MetricLimitConfig,
  NotificationOutboxDoc,
} from "../types/models.js";

/**
 * Platform infrastructure cost metering currency.
 */
export const PLATFORM_COST_CURRENCY = "INR";

/**
 * Standard Default Rate Card (v1)
 * Reflects baseline Google Cloud Firebase published rates.
 */
export const DEFAULT_RATE_CARD_V1: UsageRateCardDoc = {
  // v1.1.0 (2026-11-13): same prices as v1.0.0, now with their verification state. None of the unit
  // prices could be read from the official pricing page (script-rendered per region), so every one is
  // verified: false and listed on the cloud checklist; the free allowance below was verified.
  version: "v1.1.0",
  effectiveDate: "2026-11-13",
  currency: PLATFORM_COST_CURRENCY,
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
  verification: {
    firestoreReadPer100k: { verified: false, source: "carried over from rate card v1.0.0 (INR conversion of USD 0.06); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    firestoreWritePer100k: { verified: false, source: "carried over from rate card v1.0.0 (INR conversion of USD 0.18); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    firestoreDeletePer100k: { verified: false, source: "carried over from rate card v1.0.0 (INR conversion of USD 0.02); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    functionsInvocationPerMillion: { verified: false, source: "carried over from rate card v1.0.0 (INR conversion of USD 0.40); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    functionsComputeGbSecond: { verified: false, source: "carried over from rate card v1.0.0 (no source recorded); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    storageGbMonth: { verified: false, source: "carried over from rate card v1.0.0 (INR conversion of USD 0.026); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    fcmPerThousand: { verified: false, source: "carried over from rate card v1.0.0 (no source recorded); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
    locationPingPer100k: { verified: false, source: "carried over from rate card v1.0.0 (internal estimate, not a Google SKU); https://cloud.google.com/firestore/pricing could not be read on 2026-11-13", verifiedAt: null, region: "asia-south1" },
  },
  freeTier: {
    firestoreReadsPerDay: 50_000,
    firestoreWritesPerDay: 20_000,
    firestoreDeletesPerDay: 20_000,
    firestoreStoredGiB: 1,
    egressGiBPerMonth: 10,
    source: "https://firebase.google.com/docs/firestore/pricing (free quota; applied per project, daily, reset around midnight Pacific time)",
    verifiedAt: "2026-11-13",
  },
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

  return Money.amount(round4(total), rateCard.currency);
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

  const incrementFields: Record<string, unknown> = {
    organizationId,
    date: dateStr,
    updatedAt: now,
  };

  const monthlyIncrementFields: Record<string, unknown> = {
    organizationId,
    month: monthStr,
    updatedAt: now,
  };

  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val === "number" && val !== 0) {
      // Client estimates: kept apart from what the server measured (DD-5).
      incrementFields[`clientReported.${key}`] = FieldValue.increment(val);
      monthlyIncrementFields[`clientReported.${key}`] = FieldValue.increment(val);
    }
  }

  // Update organization daily & monthly buckets
  const writes: Promise<unknown>[] = [
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
    verified: boolean;
  }>;
  subtotal: number;
  sharedOverheadAllocation: number;
  totalEstimatedCharge: number;
  rateCardVersion: string;
  verified: boolean;
}> {
  const { organizationId, billingPeriod } = params;
  const rateCard = await getActiveRateCard();
  // The measured cost rollups of the month (prompt 66), priced when read (D-22). No overhead is added:
  // platform work is measured under organization "platform" and is not charged to tenants (D-21).
  const days = await readRollups("organizationUsageDaily", { organizationId, startDate: `${billingPeriod}-01`, endDate: `${billingPeriod}-31`, limit: 40 });
  const estimate = estimateCost(sumRollups(days), rateCard);
  const lineItems = estimate.lines.map((l) => ({
    service: l.sku.startsWith("firestore") ? "Cloud Firestore" : "Cloud Functions",
    metric: l.unit,
    quantity: l.quantity,
    unit: l.unit,
    unitRate: l.unitPrice,
    amount: Money.amount(l.cost, rateCard.currency),
    verified: l.verified,
  }));
  const subtotal = Money.sum(lineItems.map((curr) => curr.amount), rateCard.currency);
  return {
    organizationId,
    billingPeriod,
    currency: rateCard.currency,
    rateCardVersion: rateCard.version,
    verified: estimate.verified,
    lineItems,
    subtotal,
    sharedOverheadAllocation: 0,
    totalEstimatedCharge: subtotal,
  };
}

// ============================================================
// Server-observed metering & enforcement (gate-level, sharded)
// ============================================================
//
// Every tenant call that passes the authentication/organization gate is metered with ONE write
// to a random shard of usageCounterShards/{orgId}_{YYYY-MM}_{shard}, holding per-day fields in
// the organization timezone:  days.{YYYY-MM-DD}.{metric}  and  branches.{branchId}.{YYYY-MM-DD}.{metric}.
// Daily, weekly (ISO week, Monday start) and monthly usage are sums of day fields across shards.
// Sharding avoids the ~1 sustained write/second/document ceiling on a single hot counter.
//
// Units are OPERATIONS observed by server code (one gated call = 1 invocation + 1 read-op or
// 1 write-op), not billable Firestore document counts. Direct client SDK reads/listeners are
// invisible to server code (see docs: read-metering strategy).

export const USAGE_SHARDS = Number(process.env.USAGE_SHARDS || 8);
const USAGE_SNAPSHOT_TTL_MS = Number(process.env.USAGE_SNAPSHOT_TTL_MS || 10_000);
const NEAR_LIMIT_PERCENT = 90; // At/above this, the snapshot is always read fresh
// ...and also when this few units remain: a per-instance cache (other instances' writes are up to
// USAGE_SNAPSHOT_TTL_MS old) must never decide the last units of a hard limit.
const NEAR_LIMIT_HEADROOM = Number(process.env.USAGE_NEAR_LIMIT_HEADROOM || 100);

const snapshotCache = new Map<string, ServerUsageSnapshot>();

export type MeteredMetric = "functionsInvocations" | "firestoreReads" | "firestoreWrites" | "locationPings" | "storageUploadBytes";

export interface UsagePeriodKeys {
  day: string; // YYYY-MM-DD (org timezone)
  week: string; // YYYY-Www
  month: string; // YYYY-MM
  weekDays: string[]; // Monday..Sunday of the current week
}

/** Period keys for `nowMs` in the organization timezone (ISO week, Monday start). */
export function usagePeriodKeys(nowMs: number, timeZone: string): UsagePeriodKeys {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  const [y, m, d] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const isoDow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  const monday = new Date(utc.getTime() - (isoDow - 1) * 86_400_000);
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  // ISO week number: the week containing the Thursday
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const weekNo = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return {
    day,
    week: `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`,
    month: day.slice(0, 7),
    weekDays,
  };
}

/**
 * One sharded increment for a gated call (nested set+merge keeps dotted day keys as maps).
 * Returns the shard written; `sign: -1` on the same `shard` refunds a denied call's units.
 */
export async function incrementServerUsage(params: {
  organizationId: string;
  branchId?: string;
  timeZone: string;
  metrics: Partial<Record<MeteredMetric, number>>;
  nowMs?: number;
  shard?: number;
  sign?: 1 | -1;
}): Promise<number> {
  const keys = usagePeriodKeys(params.nowMs ?? Date.now(), params.timeZone);
  const shard = params.shard ?? Math.floor(Math.random() * USAGE_SHARDS);
  const sign = params.sign ?? 1;
  const ref = db.collection("usageCounterShards").doc(`${params.organizationId}_${keys.month}_${shard}`);
  const dayMetrics: Record<string, unknown> = {};
  for (const [metric, value] of Object.entries(params.metrics)) {
    if (value && value > 0) dayMetrics[metric] = FieldValue.increment(sign * value);
  }
  if (Object.keys(dayMetrics).length === 0) return shard;
  const doc: Record<string, unknown> = {
    organizationId: params.organizationId,
    month: keys.month,
    shard,
    updatedAt: new Date().toISOString(),
    days: { [keys.day]: dayMetrics },
  };
  if (params.branchId) doc.branches = { [params.branchId]: { [keys.day]: dayMetrics } };
  await ref.set(doc, { merge: true });
  // Apply this instance's own increments to its cached snapshot, so enforcement is exact within
  // an instance; other instances' writes are seen within USAGE_SNAPSHOT_TTL_MS.
  const cached = snapshotCache.get(params.organizationId);
  if (cached && cached.keys.day === keys.day) {
    for (const [metric, value] of Object.entries(params.metrics)) {
      if (!value || value <= 0) continue;
      for (const bucket of [cached.daily, cached.weekly, cached.monthly]) bucket[metric] = (bucket[metric] || 0) + sign * value;
    }
  }
  return shard;
}

export interface ServerUsageSnapshot {
  daily: Record<string, number>;
  weekly: Record<string, number>;
  monthly: Record<string, number>;
  keys: UsagePeriodKeys;
  readAt: number;
}


/** Sums shards for the current day/week/month. Cached per instance with bounded staleness. */
export async function getServerUsageSnapshot(organizationId: string, timeZone: string, fresh = false): Promise<ServerUsageSnapshot> {
  const nowMs = Date.now();
  const keys = usagePeriodKeys(nowMs, timeZone);
  const cached = snapshotCache.get(organizationId);
  if (!fresh && cached && cached.keys.day === keys.day && nowMs - cached.readAt < USAGE_SNAPSHOT_TTL_MS) {
    return cached;
  }
  const months = Array.from(new Set([keys.month, ...keys.weekDays.map((d) => d.slice(0, 7))]));
  const refs = months.flatMap((m) => Array.from({ length: USAGE_SHARDS }, (_, s) =>
    db.collection("usageCounterShards").doc(`${organizationId}_${m}_${s}`)));
  const snaps = await db.getAll(...refs);
  const daily: Record<string, number> = {};
  const weekly: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  const add = (bucket: Record<string, number>, metrics: Record<string, number>) => {
    for (const [k, v] of Object.entries(metrics || {})) bucket[k] = (bucket[k] || 0) + (Number(v) || 0);
  };
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const days = (snap.data()?.days || {}) as Record<string, Record<string, number>>;
    for (const [day, metrics] of Object.entries(days)) {
      if (day === keys.day) add(daily, metrics);
      if (keys.weekDays.includes(day)) add(weekly, metrics);
      if (day.startsWith(keys.month)) add(monthly, metrics);
    }
  }
  const snapshot = { daily, weekly, monthly, keys, readAt: nowMs };
  snapshotCache.set(organizationId, snapshot);
  return snapshot;
}

export interface UsageLimitVerdict {
  blocked: boolean;
  nearLimit: boolean;
  warnings: Array<{ metric: string; period: "daily" | "weekly" | "monthly"; usage: number; limit: number; percent: number; mode: string }>;
  breaches: Array<{ metric: string; period: "daily" | "weekly" | "monthly"; usage: number; limit: number }>;
}

/**
 * Evaluates a snapshot against effective limits. Only hard_block metrics can block.
 * `includesCurrentCall`: the snapshot already counts the call being admitted, so usage equal
 * to the limit is still allowed (breach only above it). Without it (status views), usage at
 * the limit means no further call fits and is reported as a breach.
 */
export function evaluateUsageLimits(limits: UsageLimitsConfig, snapshot: Pick<ServerUsageSnapshot, "daily" | "weekly" | "monthly">, includesCurrentCall = false): UsageLimitVerdict {
  const verdict: UsageLimitVerdict = { blocked: false, nearLimit: false, warnings: [], breaches: [] };
  for (const [metric, cfg] of Object.entries(limits || {})) {
    if (!cfg || cfg.enabled === false) continue;
    const windows: Array<["daily" | "weekly" | "monthly", number | undefined, Record<string, number>]> = [
      ["daily", cfg.dailyLimit, snapshot.daily],
      ["weekly", cfg.weeklyLimit, snapshot.weekly],
      ["monthly", cfg.monthlyLimit, snapshot.monthly],
    ];
    for (const [period, limit, bucket] of windows) {
      if (!limit || limit <= 0) continue;
      const usage = bucket[metric] || 0;
      const percent = (usage / limit) * 100;
      if (percent >= NEAR_LIMIT_PERCENT || (cfg.enforcementMode === "hard_block" && limit - usage <= NEAR_LIMIT_HEADROOM)) verdict.nearLimit = true;
      if (percent >= (cfg.warningThresholdPercent ?? 80)) {
        verdict.warnings.push({ metric, period, usage, limit, percent: Math.round(percent * 10) / 10, mode: cfg.enforcementMode });
      }
      const hardLimit = (limit * (cfg.hardThresholdPercent ?? 100)) / 100;
      if (cfg.enforcementMode === "hard_block" && (includesCurrentCall ? usage > hardLimit : usage >= hardLimit)) {
        verdict.blocked = true;
        verdict.breaches.push({ metric, period, usage, limit });
      }
    }
  }
  return verdict;
}

/** Effective limits: plan baseline overridden per metric by the organization. */
export function mergeUsageLimits(plan?: UsageLimitsConfig, overrides?: UsageLimitsConfig): UsageLimitsConfig {
  return { ...(plan || {}), ...(overrides || {}) };
}

/** Allowed client-reported metrics (non-negative, bounded) for usageRecordClientMetric. */
export const CLIENT_METRIC_KEYS: ReadonlyArray<keyof ServiceUsageCounts> = [
  "firestoreReads", "firestoreWrites", "firestoreDeletes", "storageUploadBytes",
  "storageDownloadBytes", "storageOperations", "fcmDispatches", "locationPings",
];
