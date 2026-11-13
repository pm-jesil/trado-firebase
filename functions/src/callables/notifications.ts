/**
 * Push Notification Callables
 * - notificationsRegisterFcmToken: Authenticated user registers their device token.
 *   Dispatches any pending welcome notification in the outbox.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  RegisterFcmTokenSchema,
  ListNotificationsSchema,
  MarkNotificationReadSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { DeviceDoc, NotificationDoc } from "../types/models.js";
import { dispatchPendingWelcomeNotifications } from "../services/notificationSender.js";

export const notificationsRegisterFcmToken = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to register device token.");
  }

  const input = parseInput(RegisterFcmTokenSchema, request.data);

  const uid = request.auth.uid;
  const deviceRef = db.collection("users").doc(uid).collection("devices").doc(input.deviceId);

  const now = new Date().toISOString();
  const deviceDocData: DeviceDoc = {
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

/**
 * notificationsList
 * Retrieves in-app notification history for the authenticated user.
 */
export const notificationsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to view notifications.");
  }

  const uid = request.auth.uid;
  const { unreadOnly = false, limit = 50 } = parseInput(ListNotificationsSchema, request.data);

  let query = db.collection("notifications").where("userId", "==", uid);
  if (unreadOnly) {
    query = query.where("isRead", "==", false);
  }

  const snap = await query.limit(limit).get();
  const notifications = snap.docs.map((d) => ({
    notificationId: d.id,
    ...(d.data() as NotificationDoc),
  }));

  // Sort descending by creation date
  notifications.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return {
    items: notifications,
    count: notifications.length,
  };
});

/**
 * notificationsMarkRead
 * Marks a notification as read.
 */
export const notificationsMarkRead = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { notificationId } = parseInput(MarkNotificationReadSchema, request.data);

  const notifRef = db.collection("notifications").doc(notificationId);
  const snap = await notifRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", `Notification "${notificationId}" not found.`);
  }

  const data = snap.data()!;
  if (data.userId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Cannot mark another user's notification as read.");
  }

  await notifRef.update({
    isRead: true,
    readAt: new Date().toISOString(),
  });

  return {
    notificationId,
    isRead: true,
  };
});

