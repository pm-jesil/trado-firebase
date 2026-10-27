/**
 * Push Notification Callables
 * - notificationsRegisterFcmToken: Authenticated user registers their device token.
 *   Dispatches any pending welcome notification in the outbox.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { RegisterFcmTokenSchema } from "../validation/schemas.js";
import { DeviceDoc } from "../types/models.js";
import { dispatchPendingWelcomeNotifications } from "../services/notificationSender.js";

export const notificationsRegisterFcmToken = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to register device token.");
  }

  const parsed = RegisterFcmTokenSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const uid = request.auth.uid;
  const deviceRef = db.collection("users").doc(uid).collection("devices").doc(input.deviceId);

  const now = new Date().toISOString();
  const deviceDocData: DeviceDoc = {
    deviceId: input.deviceId,
    fcmToken: input.fcmToken,
    platform: input.platform,
    createdAt: now,
    updatedAt: now,
  };

  const existing = await deviceRef.get();
  if (existing.exists) {
    await deviceRef.update({
      fcmToken: input.fcmToken,
      platform: input.platform,
      updatedAt: now,
    });
  } else {
    await deviceRef.set(deviceDocData);
  }

  // Dispatch pending welcome notifications if any exist in the outbox
  const dispatchedWelcomeCount = await dispatchPendingWelcomeNotifications(uid, input.fcmToken);

  return {
    success: true,
    deviceId: input.deviceId,
    dispatchedWelcomeCount,
    message: "FCM token registered successfully.",
  };
});
