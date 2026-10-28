/**
 * Live Location Tracking Callables
 * 
 * Provides:
 * - `locationsRecordPing`: High-frequency/background location ping reporting with rate-limiting and consent checks
 * - `locationsGetLatest`: Queries current location coordinates of employees
 * - `locationsGetHistory`: Queries historical location route pings within the retention window
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  RecordLocationPingSchema,
  GetLatestLocationsSchema,
  GetLocationHistorySchema,
} from "../validation/schemas.js";
import { LatestLocationDoc, LocationPingDoc, MembershipDoc } from "../types/models.js";

const MIN_PING_INTERVAL_MS = 5000;

/**
 * 1. locationsRecordPing
 */
export const locationsRecordPing = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });

  const parsed = RecordLocationPingSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;

  // 1. Consent verification: Employee must have locationTrackingEnabled flag set to true
  const memberRef = db.collection("memberships").doc(callerMembershipId);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "Caller membership record not found");
  }

  const memberData = memberSnap.data() as MembershipDoc;
  const isOwnerOrAdmin = memberData.isPrimary || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  if (!memberData.locationTrackingEnabled && !isOwnerOrAdmin) {
    throw new HttpsError(
      "failed-precondition",
      "Live location tracking is not enabled for this employee account. Admin consent configuration required."
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const latestDocId = `${orgId}_${callerMembershipId}`;
  const latestRef = db.collection("latestLocations").doc(latestDocId);

  // 2. Rate-limiting check against last ping
  const latestSnap = await latestRef.get();
  if (latestSnap.exists) {
    const existing = latestSnap.data() as LatestLocationDoc;
    const lastPingTime = new Date(existing.recordedAt || existing.updatedAt).getTime();
    if (now.getTime() - lastPingTime < MIN_PING_INTERVAL_MS) {
      return {
        success: true,
        rateLimited: true,
        recordedAt: existing.recordedAt,
      };
    }
  }

  const latestDoc: LatestLocationDoc = {
    organizationId: orgId,
    membershipId: callerMembershipId,
    userId: context.callerUid,
    latitude: validated.latitude,
    longitude: validated.longitude,
    accuracy: validated.accuracy,
    speed: validated.speed,
    heading: validated.heading,
    source: validated.source || "foreground",
    recordedAt: nowIso,
    updatedAt: nowIso,
  };

  const pingDoc: LocationPingDoc = {
    organizationId: orgId,
    membershipId: callerMembershipId,
    userId: context.callerUid,
    latitude: validated.latitude,
    longitude: validated.longitude,
    accuracy: validated.accuracy,
    speed: validated.speed,
    heading: validated.heading,
    source: validated.source || "foreground",
    recordedAt: nowIso,
    createdAt: nowIso,
  };

  const pingDocId = `${orgId}_${callerMembershipId}_${now.getTime()}`;

  const batch = db.batch();
  batch.set(latestRef, latestDoc);
  batch.set(db.collection("locationPings").doc(pingDocId), pingDoc);
  await batch.commit();

  return {
    success: true,
    rateLimited: false,
    recordedAt: nowIso,
    latitude: validated.latitude,
    longitude: validated.longitude,
  };
});

/**
 * 2. locationsGetLatest
 */
export const locationsGetLatest = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });

  const parsed = GetLatestLocationsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.membership?.isPrimary || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  const canViewAll = isOwnerOrAdmin || context.effectivePermissions.includes(AppPermissions.LOCATION_VIEW_ALL);

  if (!canViewAll) {
    const ownDocId = `${orgId}_${callerMembershipId}`;
    const ownSnap = await db.collection("latestLocations").doc(ownDocId).get();
    if (!ownSnap.exists) {
      return { organizationId: orgId, locations: [] };
    }
    return {
      organizationId: orgId,
      locations: [ownSnap.data() as LatestLocationDoc],
    };
  }

  const query = db.collection("latestLocations").where("organizationId", "==", orgId);
  const snap = await query.limit(50).get();
  let locations = snap.docs.map((d) => d.data() as LatestLocationDoc);

  if (validated.membershipIds && validated.membershipIds.length > 0) {
    const idSet = new Set(validated.membershipIds);
    locations = locations.filter((loc) => idSet.has(loc.membershipId));
  }

  return {
    organizationId: orgId,
    locations,
  };
});

/**
 * 3. locationsGetHistory
 */
export const locationsGetHistory = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    allowPlatformSuperAdmin: true,
  });

  const parsed = GetLocationHistorySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const validated = parsed.data;
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.membership?.isPrimary || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  const canViewAll = isOwnerOrAdmin || context.effectivePermissions.includes(AppPermissions.LOCATION_VIEW_ALL);

  if (!canViewAll && validated.membershipId !== callerMembershipId) {
    throw new HttpsError(
      "permission-denied",
      "Employees can only view their own location history. Admin permission required."
    );
  }

  let query = db
    .collection("locationPings")
    .where("organizationId", "==", orgId)
    .where("membershipId", "==", validated.membershipId);

  if (validated.from) {
    query = query.where("recordedAt", ">=", validated.from);
  }
  if (validated.to) {
    query = query.where("recordedAt", "<=", validated.to);
  }

  const limit = validated.limit || 50;
  const snap = await query.limit(limit).get();

  const pings = snap.docs.map((d) => d.data() as LocationPingDoc);
  pings.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return {
    organizationId: orgId,
    membershipId: validated.membershipId,
    pings,
    count: pings.length,
  };
});
