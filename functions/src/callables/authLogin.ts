/**
 * authLogin Callable
 * 
 * Local emulator testing adapter for Swagger UI / curl / Postman.
 * Strictly gated to local Firebase Auth Emulator. Fails closed in production.
 * Returns canonical AuthSessionContext + transport credentials (idToken, expiresInSeconds).
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { parseInput } from "../validation/parseInput.js";
import { AuthLoginResponse } from "../types/api.js";
import { AuthLoginSchema } from "../validation/schemas.js";
import { buildAuthSessionContext } from "../services/sessionContext.js";

export const authLogin = onCall({ region: "asia-south1" }, async (request): Promise<AuthLoginResponse> => {
  // 1. Strict Fail-Closed Local Emulator Guard
  const isFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  const projectId = process.env.GCLOUD_PROJECT;
  const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const isAllowedHost = authEmulatorHost === "127.0.0.1:9099" || authEmulatorHost === "localhost:9099";

  if (!isFunctionsEmulator || projectId !== "trado-x" || !isAllowedHost) {
    throw new HttpsError(
      "failed-precondition",
      "authLogin is a developer testing adapter restricted strictly to the local Firebase Emulator Suite (trado-x)."
    );
  }

  // 2. Validate Input
  const input = parseInput(AuthLoginSchema, request.data);

  const { email, password, deviceId } = input;

  // 3. Authenticate against local Firebase Auth Emulator REST Endpoint
  const authUrl = `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`;

  let authData: {
    idToken?: string;
    refreshToken?: string;
    expiresIn?: string;
    localId?: string;
    error?: { message?: string };
  };

  try {
    const res = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    authData = (await res.json()) as {
      idToken?: string;
      refreshToken?: string;
      expiresIn?: string;
      localId?: string;
      error?: { message?: string };
    };
  } catch (err: unknown) {
    throw new HttpsError("internal", `Auth emulator service unavailable: ${(err as Error).message}`);
  }

  if (!authData.idToken || !authData.localId) {
    throw new HttpsError("unauthenticated", "Invalid email or password.");
  }

  // 4. Resolve Canonical AuthSessionContext
  const context = await buildAuthSessionContext({
    uid: authData.localId,
    deviceId,
  });

  return {
    /** D-18: single canonical response — `context` is the one source of truth; no mirrored top-level keys. */
    context,
    credentials: {
      idToken: authData.idToken,
      expiresInSeconds: parseInt(authData.expiresIn || "3600", 10),
      accessToken: authData.idToken,
      refreshToken: authData.refreshToken,
    },
    idToken: authData.idToken,
    accessToken: authData.idToken,
    refreshToken: authData.refreshToken || null,
  };
});
