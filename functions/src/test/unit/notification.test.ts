/**
 * Unit Tests for Push Notification & Welcome Dispatch
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MockNotificationSender,
} from "../../services/notificationSender.js";

describe("Notification Sender Adapter", () => {
  it("MockNotificationSender safely records dispatched messages without real FCM network calls", async () => {
    const mockSender = new MockNotificationSender();

    const result = await mockSender.sendToDevice("test-device-fcm-token-12345", {
      title: "Welcome to Trado!",
      body: "Hello Alice, your account is ready.",
      data: { type: "welcome" },
    });

    assert.equal(result.success, true);
    assert.ok(result.messageId?.startsWith("mock-msg-"));
    assert.equal(mockSender.dispatchedCount, 1);
    assert.equal(mockSender.sentMessages.length, 1);
    assert.equal(mockSender.sentMessages[0].fcmToken, "test-device-fcm-token-12345");
    assert.equal(mockSender.sentMessages[0].payload.title, "Welcome to Trado!");
  });

  it("MockNotificationSender reset clears recorded message history", async () => {
    const mockSender = new MockNotificationSender();

    await mockSender.sendToDevice("token-1", { title: "Msg 1", body: "Test" });
    assert.equal(mockSender.dispatchedCount, 1);

    mockSender.reset();
    assert.equal(mockSender.dispatchedCount, 0);
    assert.equal(mockSender.sentMessages.length, 0);
  });
});
