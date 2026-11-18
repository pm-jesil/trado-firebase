/**
 * Notification Service — In-App Notifications & FCM Dispatch Orchestrator
 * 
 * Provides:
 * 1. Event-driven in-app notification logging in `notifications/{notificationId}`.
 * 2. Push notification delivery via `notificationSender`.
 * 3. Token lifecycle management: automatically removes stale/invalid FCM tokens.
 */

import { db } from "./firebase.js";
import { getNotificationSender, NotificationPayload } from "./notificationSender.js";
import { NotificationDoc, NotificationType } from "../types/models.js";

export interface CreateNotificationParams {
  organizationId: string;
  userId: string;
  membershipId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  data?: Record<string, string>;
}

/**
 * Creates an in-app notification record and dispatches an FCM push to all registered devices of the user.
 */
export async function createAndDispatchNotification(
  params: CreateNotificationParams
): Promise<string> {
  const notificationDoc: NotificationDoc = {
    organizationId: params.organizationId,
    userId: params.userId,
    membershipId: params.membershipId || null,
    type: params.type,
    title: params.title,
    body: params.body,
    relatedEntityType: params.relatedEntityType || null,
    relatedEntityId: params.relatedEntityId || null,
    data: params.data || {},
    isRead: false,
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  // 1. Store in-app notification document
  const docRef = await db.collection("notifications").add(notificationDoc);

  // 2. Fetch user's registered FCM devices
  const devicesSnap = await db
    .collection("users")
    .doc(params.userId)
    .collection("devices")
    .get();

  if (devicesSnap.empty) {
    return docRef.id;
  }

  const sender = getNotificationSender();
  const payload: NotificationPayload = {
    title: params.title,
    body: params.body,
    data: {
      notificationId: docRef.id,
      organizationId: params.organizationId,
      type: params.type,
      ...(params.relatedEntityType ? { relatedEntityType: params.relatedEntityType } : {}),
      ...(params.relatedEntityId ? { relatedEntityId: params.relatedEntityId } : {}),
      ...(params.data || {}),
    },
  };

  // 3. Dispatch to all devices in parallel
  const sendPromises = devicesSnap.docs.map(async (deviceDoc) => {
    const data = deviceDoc.data();
    const fcmToken = data.fcmToken || data.token;
    if (!fcmToken) return;

    try {
      const result = await sender.sendToDevice(fcmToken, payload);
      // If Firebase reports that the registration token is invalid or unregistered, clean it up
      if (!result.success && result.error) {
        if (
          result.error.includes("registration-token-not-registered") ||
          result.error.includes("invalid-registration-token") ||
          result.error.includes("NotRegistered")
        ) {
          await deviceDoc.ref.delete();
        }
      }
    } catch (err) {
      const failure = err as { message?: string; code?: string } | null;
      if (
        failure?.message?.includes("registration-token-not-registered") ||
        failure?.code === "messaging/registration-token-not-registered"
      ) {
        await deviceDoc.ref.delete();
      }
    }
  });

  await Promise.allSettled(sendPromises);
  return docRef.id;
}

