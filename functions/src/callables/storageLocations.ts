/**
 * Warehouse and Storage Locations Callables
 * 
 * Provides:
 * - Storage location and warehouse definition per branch or central facility
 * - Default location settings for inventory intake, sales counters, and stockyards
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateStorageLocationSchema,
  UpdateStorageLocationSchema,
  ListStorageLocationsSchema,
  GetStorageLocationSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { StorageLocationDoc } from "../types/models.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";

export const storageLocationsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateStorageLocationSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.WAREHOUSE_MANAGE,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "storageLocations.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  const locationRef = db.collection("storageLocations").doc();
  const locationId = locationRef.id;

  const locationDoc: StorageLocationDoc = {
    organizationId: orgId,
    branchId: input.branchId || null,
    name: input.name,
    code: input.code,
    type: input.type,
    isDefault: input.isDefault ?? false,
    isActive: true,
    ...(input.address ? { address: input.address } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: now,
    createdBy: callerUid,
    updatedAt: now,
    updatedBy: callerUid,
  };

  await locationRef.set(locationDoc);

  return {
    locationId,
    location: {
      locationId,
      ...locationDoc,
    },
    message: "Storage location created successfully.",
  };
});

export const storageLocationsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateStorageLocationSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.WAREHOUSE_MANAGE,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const locationRef = db.collection("storageLocations").doc(input.locationId);
  const snap = await locationRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Storage location not found.");
  }

  const existing = snap.data() as StorageLocationDoc;
  if (existing.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const updates: Partial<StorageLocationDoc> = {
    updatedAt: new Date().toISOString(),
    updatedBy: callerUid,
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.isDefault !== undefined) updates.isDefault = input.isDefault;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.address !== undefined) updates.address = input.address;
  if (input.notes !== undefined) updates.notes = input.notes;

  await locationRef.update(updates);

  return {
    success: true,
    message: "Storage location updated successfully.",
  };
});

export const storageLocationsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListStorageLocationsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.WAREHOUSE_VIEW,
  });

  const orgId = ctx.organizationId;
  let query: FirebaseFirestore.Query = db
    .collection("storageLocations")
    .where("organizationId", "==", orgId);

  if (input.branchId) {
    query = query.where("branchId", "in", [input.branchId, null]);
  }
  if (input.type) {
    query = query.where("type", "==", input.type);
  }
  if (input.isActive !== undefined) {
    query = query.where("isActive", "==", input.isActive);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("name");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "storageLocations",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    locationId: doc.id,
    ...(doc.data() as StorageLocationDoc),
  }));

  return {
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

export const storageLocationsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetStorageLocationSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.WAREHOUSE_VIEW,
  });

  const locationRef = db.collection("storageLocations").doc(input.locationId);
  const snap = await locationRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Storage location not found.");
  }

  const data = snap.data() as StorageLocationDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return {
    location: {
      locationId: snap.id,
      ...data,
    },
  };
});
