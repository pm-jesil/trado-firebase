/**
 * Unified Image Pipeline Callables
 * - imagesCreateUploadSession: Authorized session creation with raw upload policy and gate checks
 * - imagesAttach: Validates, strips metadata, resizes, re-encodes to WebP and attaches to entity
 * - imagesRemove: Removes image from entity document and deletes storage asset
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import crypto from "crypto";
import { db, getStorageBucket } from "../services/firebase.js";
import { parseInput } from "../validation/parseInput.js";
import {
  CreateImageUploadSessionSchema,
  AttachImageSchema,
  RemoveImageSchema,
} from "../validation/schemas.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { getImagePolicy, ALLOWED_IMAGE_MIME_TYPES, ImagePurpose } from "../config/imagePolicy.js";
import { attachUploadedImage } from "../services/imageEngine.js";
import { ImageRef, ImageUploadSessionDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";

function getRequiredPermissionForPurpose(purpose: ImagePurpose, entityType: string, isSelfUser: boolean): string | null {
  switch (purpose) {
    case "org_logo":
      return AppPermissions.ORG_UPDATE;
    case "user_photo":
      return isSelfUser ? null : AppPermissions.EMPLOYEE_UPDATE;
    case "party_photo":
      return entityType === "vendor" ? AppPermissions.VENDOR_UPDATE : AppPermissions.CUSTOMER_UPDATE;
    case "product_image":
      return AppPermissions.PRODUCT_UPDATE;
    default:
      return null;
  }
}

export const imagesCreateUploadSession = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateImageUploadSessionSchema, request.data);
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  const isSelfUser = input.entityType === "user" && input.entityId === request.auth.uid;

  let scope = "platform";
  if (isSelfUser) {
    scope = "users";
  } else if (!isSuperAdmin || input.purpose !== "org_logo" || input.organizationId) {
    const requiredPerm = getRequiredPermissionForPurpose(input.purpose, input.entityType, isSelfUser);
    const ctx = await resolveRequestContext(request, {
      requiredPermission: requiredPerm || undefined,
    });
    scope = ctx.organizationId;
  }

  const policy = getImagePolicy(input.purpose);

  if (input.sizeBytes > policy.rawUploadMaxBytes) {
    throw new HttpsError(
      "invalid-argument",
      `[IMAGE_TOO_LARGE] Uploaded file size (${input.sizeBytes} B) exceeds maximum allowed for ${input.purpose} (${policy.rawUploadMaxBytes} B).`,
      { reason: "IMAGE_TOO_LARGE" }
    );
  }

  const idempotency = await reserveIdempotency({
    scope,
    actorUid: request.auth.uid,
    operation: "images.createUploadSession",
    clientKey: input.clientRequestId,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const uploadId = `up_${crypto.randomBytes(16).toString("hex")}`;
    const uploadPath = `tmp/${scope}/${request.auth.uid}/${uploadId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour TTL

    const session: ImageUploadSessionDoc = {
      uploadId,
      scope,
      callerUid: request.auth.uid,
      purpose: input.purpose,
      entityType: input.entityType,
      entityId: input.entityId || null,
      contentType: input.contentType,
      maxBytes: policy.rawUploadMaxBytes,
      uploadPath,
      isUsed: false,
      createdAt: now.toISOString(),
      expiresAt,
    };
    await db.collection("imageUploadSessions").doc(uploadId).set(session);

    // storageUploadBytes has one writer: the finalize trigger (triggers/storageTriggers.ts) counts the
    // bytes actually stored; a session that is never used stores nothing (prompt 66 P-3, DD-9).

    const result = {
      uploadId,
      uploadPath,
      maxBytes: policy.rawUploadMaxBytes,
      acceptedContentTypes: ALLOWED_IMAGE_MIME_TYPES,
      expiresAt,
    };

    if (idempotency.recordId) {
      await finalizeIdempotencySuccess(idempotency.recordId, result);
    }

    return result;
  } catch (err: unknown) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_FAILED", (err as Error).message);
    }
    throw err;
  }
});

export const imagesAttach = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(AttachImageSchema, request.data);
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  const isSelfUser = input.entityType === "user" && input.entityId === request.auth.uid;

  // 1. Resolve session to determine purpose
  const sessionDoc = await db.collection("imageUploadSessions").doc(input.uploadId).get();
  if (!sessionDoc.exists) {
    throw new HttpsError("not-found", "[UPLOAD_SESSION_EXPIRED] Upload session not found or expired.", { reason: "UPLOAD_SESSION_EXPIRED" });
  }
  const session = sessionDoc.data()!;
  const purpose: ImagePurpose = session.purpose;

  let scope = session.scope || "platform";
  if (isSelfUser) {
    scope = "users";
  } else if (!isSuperAdmin || purpose !== "org_logo") {
    const requiredPerm = getRequiredPermissionForPurpose(purpose, input.entityType, isSelfUser);
    const ctx = await resolveRequestContext(request, {
      requiredPermission: requiredPerm || undefined,
    });
    scope = ctx.organizationId;
  }

  // 2. Process and attach image
  const imageRef = await attachUploadedImage({
    uploadId: input.uploadId,
    purpose,
    entityType: input.entityType,
    entityId: input.entityId,
    callerUid: request.auth.uid,
    scope,
  });

  // 3. Update target entity document in Firestore
  let targetDocRef: FirebaseFirestore.DocumentReference;

  switch (input.entityType) {
    case "organization":
      targetDocRef = db.collection("organizations").doc(input.entityId);
      break;
    case "user":
      targetDocRef = db.collection("users").doc(input.entityId);
      break;
    case "customer":
      targetDocRef = db.collection("customers").doc(input.entityId);
      break;
    case "vendor":
      targetDocRef = db.collection("vendors").doc(input.entityId);
      break;
    case "product":
      targetDocRef = db.collection("products").doc(input.entityId);
      break;
    default:
      throw new HttpsError("invalid-argument", `Unknown entityType: ${input.entityType}`);
  }

  const snap = await targetDocRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", `Target ${input.entityType} with id "${input.entityId}" not found.`);
  }

  const existingData = snap.data()!;
  const previousImage: ImageRef | undefined = existingData.image;

  const now = new Date().toISOString();
  await targetDocRef.update({
    image: imageRef,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });

  // Delete replaced storage asset if present and path differs
  if (previousImage && previousImage.path && previousImage.path !== imageRef.path) {
    const bucket = getStorageBucket();
    await bucket.file(previousImage.path).delete({ ignoreNotFound: true });
  }


  return {
    success: true,
    image: imageRef,
  };
});

export const imagesRemove = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(RemoveImageSchema, request.data);
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  const isSelfUser = input.entityType === "user" && input.entityId === request.auth.uid;

  if (!isSelfUser && !isSuperAdmin) {
    const requiredPerm = input.entityType === "user"
      ? (isSelfUser ? null : AppPermissions.EMPLOYEE_UPDATE)
      : input.entityType === "organization"
        ? AppPermissions.ORG_UPDATE
        : input.entityType === "vendor"
          ? AppPermissions.VENDOR_UPDATE
          : input.entityType === "customer"
            ? AppPermissions.CUSTOMER_UPDATE
            : AppPermissions.PRODUCT_UPDATE;

    await resolveRequestContext(request, {
      requiredPermission: requiredPerm || undefined,
    });
  }

  let targetDocRef: FirebaseFirestore.DocumentReference;
  switch (input.entityType) {
    case "organization":
      targetDocRef = db.collection("organizations").doc(input.entityId);
      break;
    case "user":
      targetDocRef = db.collection("users").doc(input.entityId);
      break;
    case "customer":
      targetDocRef = db.collection("customers").doc(input.entityId);
      break;
    case "vendor":
      targetDocRef = db.collection("vendors").doc(input.entityId);
      break;
    case "product":
      targetDocRef = db.collection("products").doc(input.entityId);
      break;
    default:
      throw new HttpsError("invalid-argument", `Unknown entityType: ${input.entityType}`);
  }

  const snap = await targetDocRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", `Target ${input.entityType} with id "${input.entityId}" not found.`);
  }

  const data = snap.data()!;
  const currentImage: ImageRef | undefined = data.image;

  if (currentImage && currentImage.path) {
    const bucket = getStorageBucket();
    await bucket.file(currentImage.path).delete({ ignoreNotFound: true });
  }

  const now = new Date().toISOString();
  await targetDocRef.update({
    image: null,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });


  return {
    success: true,
  };
});
