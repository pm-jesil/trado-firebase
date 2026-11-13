/**
 * authMe Callable
 * 
 * Canonical session bootstrap endpoint for Flutter Web / Mobile and web clients.
 * Reads verified caller UID from Firebase Auth token, resolves canonical
 * AuthSessionContext, registers optional device identity, and returns credentials: null.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { parseInput } from "../validation/parseInput.js";
import { AuthMeResponse } from "../types/api.js";
import { AuthMeSchema } from "../validation/schemas.js";
import { buildAuthSessionContext } from "../services/sessionContext.js";

export const authMe = onCall({ region: "asia-south1" }, async (request): Promise<AuthMeResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to access session details.");
  }

  const input = parseInput(AuthMeSchema, request.data);

  const { deviceId } = input;

  const context = await buildAuthSessionContext({
    uid: request.auth.uid,
    deviceId,
  });

  return {
    /** D-18: single canonical response — `context` is the one source of truth; no mirrored top-level keys. */
    context,
    credentials: null,
  };
});
