/**
 * Trado Firebase Backend — Reusable Callable HTTP Client
 * 
 * Invokes Cloud Functions HTTPS Callables through the local emulator HTTP port.
 * Handles token attachment, response parsing, and standard error extraction.
 */

const { AUTH_EMULATOR_HOST, FUNCTIONS_HOST, PROJECT_ID } = require("./emulator-helper.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FUNCTIONS_ORIGIN = `${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1`;
const crypto = require("node:crypto");

/**
 * Runtime evidence for the Coverage Engine. One file per (unit, script) under .local/traces, rewritten
 * by every process, so evidence never outlives the run that produced it. VERIFY_UNIT is set by
 * scripts/verify-impact.js; a script started by hand writes an "adhoc--" file the engine ignores.
 */
const TRACE_UNIT = process.env.VERIFY_UNIT || "adhoc";
const TRACE_SCRIPT = path.basename((require.main && require.main.filename) || "repl").replace(/\.[a-z]+$/, "");
// VERIFY_EVIDENCE_DIR: self-test runs of the impact system write their evidence to a scratch root.
const TRACE_FILE = path.resolve(process.env.VERIFY_EVIDENCE_DIR || path.resolve(__dirname, "..", "..", "..", ".local"), "traces", `${TRACE_UNIT.replace(/[^A-Za-z0-9._-]/g, "_")}--${TRACE_SCRIPT}.jsonl`);
const traceRows = new Map();

/** Leaf paths of a JSON value in schema notation: arrays as `[]`, object keys joined by dots. */
function leafPaths(value, at = "", out = new Set(), depth = 0) {
  if (Array.isArray(value)) {
    if (!value.length || depth > 8) out.add(`${at}[]`);
    for (const item of value.slice(0, 20)) leafPaths(item, `${at}[]`, out, depth + 1);
  } else if (value && typeof value === "object" && depth <= 8) {
    const keys = Object.keys(value);
    if (!keys.length && at) out.add(at);
    for (const key of keys) leafPaths(value[key], at ? `${at}.${key}` : key, out, depth + 1);
  } else if (at) out.add(at);
  return out;
}

const sha = (value) => crypto.createHash("sha1").update(JSON.stringify(value === undefined ? null : value)).digest("hex").slice(0, 16);

function recordTrace(callable, outcome, reason = null, extra = {}) {
  const inputPaths = extra.data === undefined ? [] : [...leafPaths(extra.data)].sort();
  const responsePaths = extra.result === undefined ? [] : [...leafPaths(extra.result)].sort();
  // The image family names its idempotency key clientRequestId (images.ts passes it to reserveIdempotency).
  const rawKey = extra.data && (extra.data.idempotencyKey || extra.data.clientRequestId);
  const idempotencyKey = rawKey ? sha(rawKey) : null;
  const payloadHash = idempotencyKey ? sha(extra.data) : null;
  const unknownFields = extra.unknownFields || [];
  const key = [callable, outcome, reason, idempotencyKey, payloadHash, sha([inputPaths, responsePaths, unknownFields])].join("|");
  const row = traceRows.get(key);
  if (row) row.count++;
  else traceRows.set(key, { unit: TRACE_UNIT, script: TRACE_SCRIPT, callable, outcome, reason, count: 1, idempotencyKey, payloadHash, inputPaths, responsePaths, unknownFields });
}

/** Evidence that a background trigger ran: call it after its effect has been asserted. */
function recordTriggerObserved(trigger) {
  recordTrace(trigger, "trigger-observed");
}

process.on("exit", () => {
  try {
    fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
    fs.writeFileSync(TRACE_FILE, [...traceRows.values()].map((row) => JSON.stringify(row)).join("\n") + (traceRows.size ? "\n" : ""));
  } catch (e) {
    console.error(`[trace] could not write ${TRACE_FILE}: ${e.message}`);
  }
});

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
 * Supports both signatures:
 *   1) callFunction(name, data, token, timeoutMs)
 *   2) callFunction(callerPersonaOrToken, name, data, timeoutMs)
 */
async function callFunction(nameOrCaller, dataOrName = {}, tokenOrData = null, timeoutMs = 90000) {
  let name = nameOrCaller;
  let data = dataOrName;
  let token = tokenOrData;

  if (typeof dataOrName === "string") {
    const caller = nameOrCaller;
    name = dataOrName;
    data = tokenOrData || {};
    token = (caller && typeof caller === "object" && caller.idToken)
      ? caller.idToken
      : (typeof caller === "string" ? caller : null);
  }

  const headers = { "Content-Type": "application/json", "x-callable-name": name };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response;
  let attempts = 0;
  while (attempts < 2) {
    try {
      attempts++;
      response = await fetch(`${FUNCTIONS_ORIGIN}/${name}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      break;
    } catch (netErr) {
      if (attempts >= 2) throw netErr;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const resJson = await response.json();
  if (!response.ok || resJson.error) {
    const message = resJson.error?.message || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.code = resJson.error?.status || (response.status === 401 ? "UNAUTHENTICATED" : (response.status === 403 ? "PERMISSION_DENIED" : "UNKNOWN"));
    err.details = resJson.error?.details;
    err.error = resJson.error;
    recordTrace(name, "denial", err.details?.reason || err.code, { data, unknownFields: err.details?.fields });
    throw err;
  }

  recordTrace(name, "success", null, { data, result: resJson.result });
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
  recordTriggerObserved,
};
