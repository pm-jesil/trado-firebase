/**
 * Scheduled Functions
 *
 * subscriptionAndUsageSweep (daily 02:00 UTC):
 *   1. Subscription expiry reminders 7 / 3 / 1 day(s) before expiry → organization Owner(s)
 *   2. Status flip to "expired" once past expiry + grace (gate already denies by time; the
 *      flip keeps stored status truthful for reports and Super Admin lists)
 *   3. Server-observed usage warnings (≥ warning threshold) → Owner(s)
 *
 * Every notification is guarded by reserveIdempotency, so re-running the sweep (retries,
 * manual runs) never duplicates a reminder. The core logic is exported as runSubscriptionAndUsageSweep
 * so it can be exercised directly against the emulator.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../services/firebase.js";
import { OrganizationDoc, MembershipDoc, SubscriptionPlanDoc } from "../types/models.js";
import { EntityStatus, SubscriptionStatus } from "../constants/enums.js";
import { evaluateSubscription, localDateInTimezone } from "../services/subscription.js";
import { requireTimezone } from "../services/money.js";
import { getServerUsageSnapshot, evaluateUsageLimits, mergeUsageLimits } from "../services/usageMetering.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { createAndDispatchNotification } from "../services/notificationService.js";
import { withScheduledContext, forTargetOrg } from "../services/systemContext.js";
import { generateDueRecurringExpenses } from "../callables/recurringExpenses.js";
import { RequestDoc, RequestActivityDoc } from "../types/models.js";
import { RequestStatus } from "../constants/enums.js";
import { evaluateSlaState } from "../services/requestsService.js";

const REMINDER_DAYS = [7, 3, 1];

export interface SweepResult {
  organizationsScanned: number;
  remindersSent: number;
  expiredFlipped: number;
  usageWarningsSent: number;
  recurringExpensesGenerated: number;
  expiredLocationsPruned: number;
}

async function notifyOwnersOnce(orgId: string, key: string, title: string, body: string): Promise<boolean> {
  const reservation = await reserveIdempotency({
    scope: orgId,
    actorUid: "system",
    operation: "scheduled.notify",
    clientKey: key,
    payload: { key },
  });
  if (reservation.isDuplicate) return false;
  const owners = await db.collection("memberships")
    .where("organizationId", "==", orgId)
    .where("roleId", "==", "role_org_owner")
    .where("status", "==", EntityStatus.ACTIVE)
    .get();
  for (const o of owners.docs) {
    const m = o.data() as MembershipDoc;
    await createAndDispatchNotification({
      organizationId: orgId,
      userId: m.userId,
      membershipId: o.id,
      type: "usage_warning",
      title,
      body,
      relatedEntityType: "organization",
      relatedEntityId: orgId,
      data: { key },
    });
  }
  if (reservation.recordId) {
    await db.collection("idempotencyRecords").doc(reservation.recordId).update({
      status: "succeeded",
      result: { notified: owners.size },
      updatedAt: new Date().toISOString(),
    });
  }
  return true;
}

export async function runSubscriptionAndUsageSweep(nowMs: number = Date.now()): Promise<SweepResult> {
  const result: SweepResult = { organizationsScanned: 0, remindersSent: 0, expiredFlipped: 0, usageWarningsSent: 0, recurringExpensesGenerated: 0, expiredLocationsPruned: 0 };
  const orgs = await db.collection("organizations").where("status", "==", EntityStatus.ACTIVE).get();

  for (const orgSnap of orgs.docs) {
    const org = orgSnap.data() as OrganizationDoc;
    const orgId = orgSnap.id;
    forTargetOrg(orgId); // platform work for this organization (D-21)
    const tz = requireTimezone(org.timezone, `organization "${orgId}"`);
    result.organizationsScanned++;

    // 1–2. Subscription lifecycle
    const sub = evaluateSubscription(org, nowMs);
    if (org.subscriptionExpiresAt) {
      const expiryDay = localDateInTimezone(Date.parse(org.subscriptionExpiresAt), tz);
      const today = localDateInTimezone(nowMs, tz);
      const daysLeft = Math.round((Date.parse(`${expiryDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      if (sub.allowed && REMINDER_DAYS.includes(daysLeft)) {
        const sent = await notifyOwnersOnce(orgId, `expiry_${expiryDay}_${daysLeft}d`,
          "Subscription expiring soon",
          `Your Trado subscription expires on ${expiryDay} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left). Contact the platform administrator to renew.`);
        if (sent) result.remindersSent++;
      }
      if (!sub.allowed && sub.state === SubscriptionStatus.EXPIRED && org.subscriptionStatus !== SubscriptionStatus.EXPIRED) {
        await orgSnap.ref.update({ subscriptionStatus: SubscriptionStatus.EXPIRED, updatedAt: new Date(nowMs).toISOString(), updatedBy: "system" });
        result.expiredFlipped++;
      }
    }

    // 3. Usage warnings (server-observed)
    if (!sub.allowed) continue;
    const planSnap = org.planId ? await db.collection("subscriptionPlans").doc(org.planId).get() : null;
    const limits = mergeUsageLimits((planSnap?.data() as SubscriptionPlanDoc | undefined)?.usageLimits, org.usageLimitOverrides);
    if (Object.keys(limits).length === 0) continue;
    const snapshot = await getServerUsageSnapshot(orgId, tz, true);
    const verdict = evaluateUsageLimits(limits, snapshot);
    for (const w of verdict.warnings) {
      const periodKey = w.period === "daily" ? snapshot.keys.day : w.period === "weekly" ? snapshot.keys.week : snapshot.keys.month;
      const level = w.percent >= 100 ? "100" : "warn";
      const sent = await notifyOwnersOnce(orgId, `usage_${w.metric}_${w.period}_${periodKey}_${level}`,
        "Usage limit warning",
        `${w.metric} has reached ${w.percent}% of the ${w.period} limit (${w.usage}/${w.limit}). Enforcement: ${w.mode}.`);
      if (sent) result.usageWarningsSent++;
    }
  }
  // Recurring expenses due today (idempotent per template and period)
  result.recurringExpensesGenerated = (await generateDueRecurringExpenses(nowMs)).generated;

  // Prune expired latestLocations (MG-40)
  try {
    const expiredLocations = await db.collection("latestLocations")
      .where("expiresAt", "<=", Timestamp.fromMillis(nowMs))
      .limit(100)
      .get();
    if (!expiredLocations.empty) {
      const batch = db.batch();
      for (const d of expiredLocations.docs) batch.delete(d.ref);
      await batch.commit();
      result.expiredLocationsPruned = expiredLocations.size;
    }
  } catch (_e) {
    // Ignore collection absence in minimal testing
  }

  return result;
}

export const subscriptionAndUsageSweep = onSchedule(
  { schedule: "0 2 * * *", timeZone: "UTC", region: "asia-south1" },
  withScheduledContext("subscriptionAndUsageSweep", async () => {
    const result = await runSubscriptionAndUsageSweep();
    console.log("[sweep] subscription & usage sweep complete", result);
  })
);

export interface RequestsSweepResult {
  requestsScanned: number;
  slaUpdated: number;
  autoClosed: number;
  autoCancelled: number;
}

/**
 * Sweeps open requests for SLA breaches/warnings and lifecycle auto-close (T-2, T-3, T-4).
 * Exported so it can be invoked deterministically in tests with a custom timestamp.
 */
export async function runRequestsSlaAndLifecycleSweep(nowMs: number = Date.now()): Promise<RequestsSweepResult> {
  const result: RequestsSweepResult = {
    requestsScanned: 0,
    slaUpdated: 0,
    autoClosed: 0,
    autoCancelled: 0,
  };

  const now = new Date(nowMs);
  const nowIso = now.toISOString();

  // 1. SLA State Evaluation & Needs-Info auto-cancel
  const openSnap = await db.collection("requests")
    .where("status", "in", [
      RequestStatus.SUBMITTED,
      RequestStatus.IN_REVIEW,
      RequestStatus.NEEDS_INFO,
      RequestStatus.IN_PROGRESS,
    ])
    .get();

  for (const doc of openSnap.docs) {
    result.requestsScanned++;
    const req = doc.data() as RequestDoc;

    // Check Needs-Info timeout: 14 days without response -> cancel (reason no_response)
    if (req.status === RequestStatus.NEEDS_INFO) {
      const changedAt = new Date(req.statusChangedAt).getTime();
      if (nowMs - changedAt > 14 * 86400000) {
        await doc.ref.update({
          status: RequestStatus.CANCELLED,
          statusReason: "no_response",
          statusChangedAt: nowIso,
          updatedAt: nowIso,
          lastActivityAt: nowIso,
        });

        const actRef = doc.ref.collection("activity").doc();
        const act: RequestActivityDoc = {
          requestId: doc.id,
          type: "status_change",
          visibility: "public",
          author: {
            uid: "system",
            name: "System",
            roleLabel: "Automated",
            isPlatform: true,
          },
          content: "Auto-cancelled: no response from requester within 14 days.",
          createdAt: nowIso,
        };
        await actRef.set(act);
        result.autoCancelled++;
        continue;
      }
    }

    // SLA State update
    const evaluatedSla = evaluateSlaState(req, now);
    if (evaluatedSla !== req.slaState) {
      await doc.ref.update({
        slaState: evaluatedSla,
        updatedAt: nowIso,
      });
      result.slaUpdated++;
    }
  }

  // 2. Auto-close resolved requests older than 7 days (T-3)
  const resolvedSnap = await db.collection("requests")
    .where("status", "==", RequestStatus.RESOLVED)
    .get();

  for (const doc of resolvedSnap.docs) {
    result.requestsScanned++;
    const req = doc.data() as RequestDoc;
    const resolvedTime = req.resolvedAt ? new Date(req.resolvedAt).getTime() : new Date(req.statusChangedAt).getTime();

    if (nowMs - resolvedTime >= 7 * 86400000) {
      await doc.ref.update({
        status: RequestStatus.CLOSED,
        statusReason: "auto_close",
        closedAt: nowIso,
        statusChangedAt: nowIso,
        updatedAt: nowIso,
        lastActivityAt: nowIso,
      });

      const actRef = doc.ref.collection("activity").doc();
      const act: RequestActivityDoc = {
        requestId: doc.id,
        type: "status_change",
        visibility: "public",
        author: {
          uid: "system",
          name: "System",
          roleLabel: "Automated",
          isPlatform: true,
        },
        content: "Auto-closed: 7 days elapsed since resolution.",
        createdAt: nowIso,
      };
      await actRef.set(act);
      result.autoClosed++;
    }
  }

  return result;
}

export const requestsSlaAndLifecycleSweep = onSchedule(
  { schedule: "every 15 minutes", region: "asia-south1" },
  withScheduledContext("requestsSlaAndLifecycleSweep", async () => {
    const res = await runRequestsSlaAndLifecycleSweep();
    console.log("[requests-sweep] requests SLA and lifecycle sweep complete", res);
  })
);

