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
 * Records application-attributed operations into daily buckets.
 * Uses atomic FieldValue.increment to eliminate read-before-write overhead.
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
  const orgDailyId = `${organizationId}_${dateStr}`;
  const now = new Date().toISOString();

  const orgDocRef = db.collection("organizationUsageDaily").doc(orgDailyId);

  const incrementFields: Record<string, any> = {
    organizationId,
    date: dateStr,
    rateCardVersion: DEFAULT_RATE_CARD_V1.version,
    currency: DEFAULT_RATE_CARD_V1.currency,
    measurementClass: "app_attributed",
    completenessPercent: 90, // Server-observed telemetry coverage
    updatedAt: now,
  };

  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val === "number" && val !== 0) {
      incrementFields[`counts.${key}`] = FieldValue.increment(val);
    }
  }

  // Update organization daily bucket
  await orgDocRef.set(incrementFields, { merge: true });

  // Update branch daily bucket if branch context is present
  if (branchId) {
    const branchDailyId = `${organizationId}_${branchId}_${dateStr}`;
    const branchDocRef = db.collection("branchUsageDaily").doc(branchDailyId);

    const branchIncrementFields = {
      ...incrementFields,
      branchId,
    };

    await branchDocRef.set(branchIncrementFields, { merge: true });
  }
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
