/**
 * Live Location Tracking Callables
 * 
 * Provides:
 * - `locationsRecordPing`: High-frequency/background location ping reporting with rate-limiting and consent checks
 * - `locationsGetLatest`: Queries current location coordinates of employees
 * - `locationsGetHistory`: Queries historical location route pings within the retention window
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../services/firebase.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  RecordLocationPingSchema,
  GetLatestLocationsSchema,
  GetLocationHistorySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { LatestLocationDoc, LocationPingDoc, MembershipDoc } from "../types/models.js";

const MIN_PING_INTERVAL_MS = 5000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Production Expiry Helper for Location Pings
 * Computes native Firestore Timestamp for Cloud Firestore TTL exactly 7 days after server ingestion.
 */
export function computeLocationPingExpiry(serverCreatedAt: Date): Timestamp {
  return Timestamp.fromDate(new Date(serverCreatedAt.getTime() + SEVEN_DAYS_MS));
}

/**
 * 1. locationsRecordPing
 */
export const locationsRecordPing = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.LOCATION_PING,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(RecordLocationPingSchema, request.data);
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
  if (memberData.status !== "active") {
    throw new HttpsError("failed-precondition", "Employee membership is inactive or deactivated.");
  }

  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  if (!memberData.locationTrackingEnabled && !isOwnerOrAdmin) {
    throw new HttpsError(
      "failed-precondition",
      "Live location tracking is not enabled for this employee account. Admin consent configuration required."
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Sanitize recordedAt device timestamp: keep client timestamp if within +/- 5 minutes, else fallback to server now
  let clientRecordedAt = nowIso;
  if (validated.recordedAt) {
    const recordedTime = new Date(validated.recordedAt).getTime();
    const isFuture = recordedTime > now.getTime() + 5 * 60 * 1000;
    const isTooOld = recordedTime < now.getTime() - SEVEN_DAYS_MS;
    if (!isNaN(recordedTime) && !isFuture && !isTooOld) {
      clientRecordedAt = validated.recordedAt;
    }
  }

  // Ephemeral location pings expire exactly 7 days after trusted server creation for Cloud Firestore TTL
  const expiresAtTimestamp = computeLocationPingExpiry(now);
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
    recordedAt: clientRecordedAt,
    updatedAt: nowIso,
  };

  const pingDoc: LocationPingDoc = {
    organizationId: orgId,
    branchId: validated.branchId || context.branchId || "main-branch",
    membershipId: callerMembershipId,
    userId: context.callerUid,
    latitude: validated.latitude,
    longitude: validated.longitude,
    accuracy: validated.accuracy,
    speed: validated.speed,
    heading: validated.heading,
    source: validated.source || "foreground",
    recordedAt: clientRecordedAt,
    createdAt: nowIso,
    expiresAt: expiresAtTimestamp,
  };

  const pingDocId = `${orgId}_${callerMembershipId}_${now.getTime()}`;

  const batch = db.batch();
  batch.set(latestRef, latestDoc);
  batch.set(db.collection("locationPings").doc(pingDocId), pingDoc);
  await batch.commit();

  return {
    success: true,
    rateLimited: false,
    recordedAt: clientRecordedAt,
    latitude: validated.latitude,
    longitude: validated.longitude,
  };
});

/**
 * 2. locationsGetLatest
 */
export const locationsGetLatest = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.LOCATION_VIEW_OWN, AppPermissions.LOCATION_VIEW_ALL],
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetLatestLocationsSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
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
    requiredPermission: [AppPermissions.LOCATION_VIEW_OWN, AppPermissions.LOCATION_VIEW_ALL],
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(GetLocationHistorySchema, request.data);
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
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

  const pings = snap.docs.map((d) => {
    const data = d.data() as LocationPingDoc;
    // Native Timestamp (TTL field) to ISO 8601 for wire transport
    const expiresAtVal = data.expiresAt instanceof Timestamp ? data.expiresAt.toDate().toISOString() : data.expiresAt;
    return {
      ...data,
      expiresAt: expiresAtVal,
    };
  });
  pings.sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));

  return {
    organizationId: orgId,
    membershipId: validated.membershipId,
    pings,
    count: pings.length,
  };
});
