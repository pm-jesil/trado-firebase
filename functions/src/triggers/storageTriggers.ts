/**
 * Per-organization Storage byte metering (Part 8.8).
 *
 * Uploads go to organization-prefixed paths (storage.rules): organizations/{organizationId}/...
 * Every finalized object adds its size to the organization's server-observed usage
 * (usageCounterShards, metric storageUploadBytes) — the same counters, windows (daily / ISO-weekly /
 * monthly) and limits as every other metric. Client uploads do not pass through the callable gate,
 * so a hard_block storage limit is enforced after the fact: an upload that breaches it is deleted
 * and its bytes refunded (the client sees the object disappear and the usage warning).
 */

import { onObjectFinalized } from "firebase-functions/v2/storage";
import { getStorage } from "firebase-admin/storage";
import { db, adminApp } from "../services/firebase.js";
import { OrganizationDoc, SubscriptionPlanDoc } from "../types/models.js";
import { DEFAULT_ORG_TIMEZONE } from "../services/subscription.js";
import { incrementServerUsage, getServerUsageSnapshot, evaluateUsageLimits, mergeUsageLimits } from "../services/usageMetering.js";

const ORG_PATH = /^organizations\/([^/]+)\//;

export async function handleStorageObjectFinalized(data: { name?: string; size?: number | string; bucket?: string }): Promise<void> {
  const name = data.name || "";
  const match = name.match(ORG_PATH);
  if (!match) return;
  const organizationId = match[1];
  const bytes = Number(data.size || 0);
  if (!bytes) return;
  const orgSnap = await db.collection("organizations").doc(organizationId).get();
  if (!orgSnap.exists) return;
  const org = orgSnap.data() as OrganizationDoc;
  const timeZone = org.timezone || DEFAULT_ORG_TIMEZONE;
  const shard = await incrementServerUsage({ organizationId, timeZone, metrics: { storageUploadBytes: bytes } });

  const plan = org.planId ? (await db.collection("subscriptionPlans").doc(org.planId).get()).data() as SubscriptionPlanDoc | undefined : undefined;
  const limits = mergeUsageLimits(plan?.usageLimits, org.usageLimitOverrides);
  const cfg = limits.storageUploadBytes;
  if (!cfg || cfg.enabled === false || cfg.enforcementMode !== "hard_block") return;
  const verdict = evaluateUsageLimits({ storageUploadBytes: cfg }, await getServerUsageSnapshot(organizationId, timeZone, true), true);
  if (!verdict.breaches.length) return;
  await getStorage(adminApp).bucket(data.bucket || "").file(name).delete({ ignoreNotFound: true });
  await incrementServerUsage({ organizationId, timeZone, metrics: { storageUploadBytes: bytes }, shard, sign: -1 });
  console.warn(`[usage] ${organizationId}: upload ${name} (${bytes} B) removed — storageUploadBytes limit reached`);
}

export const onStorageObjectFinalized = onObjectFinalized({ region: "asia-south1" }, async (event) => {
  await handleStorageObjectFinalized(event.data);
});
