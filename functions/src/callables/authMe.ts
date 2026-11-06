/**
 * authMe Callable
 * 
 * Canonical session bootstrap endpoint for Flutter Web / Mobile and web clients.
 * Reads verified caller UID from Firebase Auth token, resolves canonical
 * AuthSessionContext, registers optional device identity, and returns credentials: null.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { AuthMeResponse } from "../types/api.js";
import { AuthMeSchema } from "../validation/schemas.js";
import { buildAuthSessionContext } from "../services/sessionContext.js";

export const authMe = onCall({ region: "asia-south1" }, async (request): Promise<AuthMeResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to access session details.");
  }

  const parsedInput = AuthMeSchema.safeParse(request.data || {});
  if (!parsedInput.success) {
    throw new HttpsError(
      "invalid-argument",
      `Validation failed: ${parsedInput.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }

  const { deviceId } = parsedInput.data;

  const context = await buildAuthSessionContext({
    uid: request.auth.uid,
    deviceId,
  });

  return {
    context,
    credentials: null,
  };
});
