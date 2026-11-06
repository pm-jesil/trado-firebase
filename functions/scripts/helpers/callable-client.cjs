/**
 * Trado Firebase Backend — Reusable Callable HTTP Client
 * 
 * Invokes Cloud Functions HTTPS Callables through the local emulator HTTP port.
 * Handles token attachment, response parsing, and standard error extraction.
 */

const { AUTH_EMULATOR_HOST, FUNCTIONS_HOST, PROJECT_ID } = require("./emulator-helper.cjs");
const assert = require("node:assert/strict");

const FUNCTIONS_ORIGIN = `${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1`;

/**
 * Exchange email and password for a Firebase Auth Emulator ID token.
 */
async function getIdToken(email, password = "TestPassword123!") {
  const url = `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Auth signIn failed (${res.status}) ${data.error?.message || JSON.stringify(data)}`);
  }
  return data.idToken;
}

/**
 * Call an exported HTTPS Callable function with optional Auth ID token.
 */
async function callFunction(name, data = {}, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${FUNCTIONS_ORIGIN}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });

  const resJson = await response.json();
  if (!response.ok || resJson.error) {
    const message = resJson.error?.message || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.code = resJson.error?.status || (response.status === 401 ? "UNAUTHENTICATED" : (response.status === 403 ? "PERMISSION_DENIED" : "UNKNOWN"));
    err.details = resJson.error?.details;
    err.error = resJson.error;
    throw err;
  }

  return resJson.result;
}

/**
 * Assert that calling an endpoint throws an error with the expected Firebase error status / code.
 */
async function assertCallableError(promise, expectedCodeSubstrings) {
  const codes = Array.isArray(expectedCodeSubstrings) ? expectedCodeSubstrings : [expectedCodeSubstrings];
  try {
    await promise;
    assert.fail(`Expected call to fail with one of [${codes.join(", ")}], but it succeeded.`);
  } catch (err) {
    const norm = (str) => (str || "").toLowerCase().replace(/[-_]/g, "");
    const errorStr = norm(err.code) + " " + norm(err.message);
    const matched = codes.some(c => errorStr.includes(norm(c)));
    if (!matched) {
      assert.fail(`Expected error code matching [${codes.join(", ")}], but got message: "${err.message}", code: "${err.code}"`);
    }
  }
}

module.exports = {
  getIdToken,
  callFunction,
  assertCallableError,
};
