/**
 * User Profile Callables (N-09.1 / Prompt 60)
 * - usersUpdateMe: Authenticated user updates their personal profile (name, phone, avatar/photo).
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db, auth } from "../services/firebase.js";
import { parseInput } from "../validation/parseInput.js";
import { UpdateMeSchema } from "../validation/schemas.js";
import { normalizeOptionalPhone } from "../services/contactNormalization.js";
import { attachUploadedImage } from "../services/imageEngine.js";
import { UserDoc } from "../types/models.js";

export const usersUpdateMe = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateMeSchema, request.data);
  const uid = request.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const existing = userSnap.data() as UserDoc;
  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  const authUpdates: { displayName?: string; phoneNumber?: string } = {};

  if (input.name) {
    const fullName = input.name.trim();
    updates.name = fullName;
    authUpdates.displayName = fullName;
  }

  if (input.phone !== undefined) {
    const normalized = normalizeOptionalPhone(input.phone);
    updates.phone = normalized;
    if (normalized) {
      try {
        authUpdates.phoneNumber = normalized;
      } catch {
        // Phone number format might conflict or not be configured in auth
      }
    }
  }

  if (input.uploadId) {
    const attachedImage = await attachUploadedImage({
      uploadId: input.uploadId,
      purpose: "user_photo",
      entityType: "user",
      entityId: uid,
      callerUid: uid,
      scope: existing.primaryOrganizationId || "platform",
    });
    /** D-15: store only the typed ImageRef; no URL inside it; no photoUrl/avatarUrl. */
    updates.image = attachedImage;
  } else if (input.image) {
    /** D-15: accept ImageRef input (no url field); store as-is. */
    const { ...imageWithoutUrl } = input.image as { url?: string; path: string; contentType: string; width: number; height: number; sizeBytes: number; updatedAt: string };
    // Strip url if accidentally sent by client — D-15 enforcement
    delete (imageWithoutUrl as Record<string, unknown>).url;
    updates.image = imageWithoutUrl;
  }

  await userRef.update(updates);

  // Sync with Firebase Auth
  if (Object.keys(authUpdates).length > 0) {
    try {
      await auth.updateUser(uid, authUpdates);
    } catch {
      // Non-blocking if auth fails on phone formatting
    }
  }


  const updatedDoc = (await userRef.get()).data() as UserDoc;

  return {
    success: true,
    message: "Profile updated successfully.",
    user: {
      id: uid,
      ...updatedDoc,
    },
  };
});
