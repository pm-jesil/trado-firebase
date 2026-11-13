/**
 * Scheduled Functions
 *
 * subscriptionAndUsageSweep (daily 02:00 Asia/Kolkata):
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
import { db } from "../services/firebase.js";
import { OrganizationDoc, MembershipDoc, SubscriptionPlanDoc } from "../types/models.js";
import { EntityStatus, SubscriptionStatus } from "../constants/enums.js";
import { evaluateSubscription, DEFAULT_ORG_TIMEZONE, localDateInTimezone } from "../services/subscription.js";
import { getServerUsageSnapshot, evaluateUsageLimits, mergeUsageLimits } from "../services/usageMetering.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { createAndDispatchNotification } from "../services/notificationService.js";
import { withScheduledContext, forTargetOrg } from "../services/systemContext.js";
import { generateDueRecurringExpenses } from "../callables/recurringExpenses.js";

const REMINDER_DAYS = [7, 3, 1];

export interface SweepResult {
  organizationsScanned: number;
  remindersSent: number;
  expiredFlipped: number;
  usageWarningsSent: number;
  recurringExpensesGenerated: number;
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
  const result: SweepResult = { organizationsScanned: 0, remindersSent: 0, expiredFlipped: 0, usageWarningsSent: 0, recurringExpensesGenerated: 0 };
  const orgs = await db.collection("organizations").where("status", "==", EntityStatus.ACTIVE).get();

  for (const orgSnap of orgs.docs) {
    const org = orgSnap.data() as OrganizationDoc;
    const orgId = orgSnap.id;
    forTargetOrg(orgId); // platform work for this organization (D-21)
    const tz = org.timezone || DEFAULT_ORG_TIMEZONE;
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
  return result;
}

export const subscriptionAndUsageSweep = onSchedule(
  { schedule: "0 2 * * *", timeZone: "Asia/Kolkata", region: "asia-south1" },
  withScheduledContext("subscriptionAndUsageSweep", async () => {
    const result = await runSubscriptionAndUsageSweep();
    console.log("[sweep] subscription & usage sweep complete", result);
  })
);
