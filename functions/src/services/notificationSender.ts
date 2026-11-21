/**
 * Push Notification Service & FCM Adapter
 * 
 * Provides an abstract notification sender adapter to prevent live FCM calls
 * in unit/integration tests and emulator suites.
 * Orchestrates the welcome notification outbox workflow.
 */

import { db } from "./firebase.js";
import { NotificationOutboxDoc } from "../types/models.js";

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Pluggable Notification Sender Interface
 */
export interface NotificationSender {
  sendToDevice(fcmToken: string, payload: NotificationPayload): Promise<SendResult>;
}

/**
 * Mock sender for local unit, integration, and emulator testing
 */
export class MockNotificationSender implements NotificationSender {
  public dispatchedCount = 0;
  public sentMessages: Array<{ fcmToken: string; payload: NotificationPayload }> = [];

  async sendToDevice(fcmToken: string, payload: NotificationPayload): Promise<SendResult> {
    this.dispatchedCount++;
    this.sentMessages.push({ fcmToken, payload });
    return {
      success: true,
      messageId: `mock-msg-${Date.now()}-${this.dispatchedCount}`,
    };
  }

  reset(): void {
    this.dispatchedCount = 0;
    this.sentMessages = [];
  }
}

// Active singleton sender (defaulting to MockNotificationSender for local tests)
let activeSender: NotificationSender = new MockNotificationSender();

export function getNotificationSender(): NotificationSender {
  return activeSender;
}

/**
 * Queues a pending welcome notification in the outbox for a newly provisioned user.
 */
export async function queueWelcomeNotification(userId: string, userName: string, orgName: string): Promise<string> {
  const outboxDoc: NotificationOutboxDoc = {
    userId,
    type: "welcome",
    payload: {
      title: "Welcome to Trado!",
      body: `Hello ${userName}, you have been added to ${orgName}. Sign in to access your dashboard.`,
      data: {
        type: "welcome",
        userId,
      },
    },
    status: "pending",
    retryCount: 0,
    createdAt: new Date().toISOString(),
  };

  const ref = await db.collection("notificationOutbox").add(outboxDoc);
  return ref.id;
}

/**
 * Processes pending welcome notifications when a user registers a new FCM device token.
 */
export async function dispatchPendingWelcomeNotifications(
  userId: string,
  fcmToken: string,
  sender: NotificationSender = activeSender
): Promise<number> {
  const pendingDocs = await db
    .collection("notificationOutbox")
    .where("userId", "==", userId)
    .where("status", "==", "pending")
    .get();

  let dispatchedCount = 0;

  for (const doc of pendingDocs.docs) {
    const item = doc.data() as NotificationOutboxDoc;

    const result = await sender.sendToDevice(fcmToken, item.payload);

    if (result.success) {
      await doc.ref.update({
        status: "dispatched",
        dispatchedAt: new Date().toISOString(),
      });
      dispatchedCount++;
    } else {
      await doc.ref.update({
        status: "failed",
        retryCount: (item.retryCount || 0) + 1,
      });
    }
  }

  return dispatchedCount;
}
