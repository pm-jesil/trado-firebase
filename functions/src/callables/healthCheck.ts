/**
 * Baseline Health Check Callable
 * Used to verify Cloud Functions emulator discovery and round-trip execution.
 */

import { onCall } from "firebase-functions/v2/https";

export const healthCheck = onCall({ region: "asia-south1" }, async () => {
  return {
    status: "ok",
    service: "trado-firebase-functions",
    region: "asia-south1",
    timestamp: new Date().toISOString(),
  };
});
