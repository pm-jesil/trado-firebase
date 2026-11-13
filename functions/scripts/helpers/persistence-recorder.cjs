/**
 * Input-persistence evidence for the Coverage Engine (C-2).
 *
 * `recordingCall(callFunction)` returns a drop-in replacement for callFunction. After every successful
 * call of a create / update callable it reads the stored document raw (Admin SDK) and records each
 * request leaf path whose sent value is stored, unchanged, at the same path. The document is located from
 * the callable's own collections (derived from its handler by scripts/lib/source-truth.js) and the ids
 * in the request and response; the candidate holding the most sent values wins.
 *
 * `writeResults()` writes docs/audit/roundtrip-results.json and the generated roundtrip-results.md.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const truth = require("../../../scripts/lib/source-truth.js");
const { db } = require("./emulator-helper.cjs");

const ROOT = truth.ROOT;
const exportsByName = new Map(truth.getExports().map((e) => [e.name, e]));
const evidence = new Map(); // callable → { calls, proven:Set, sent:Set, transformed:Set, docs:Set }

function leaves(value, at = "", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) leaves(v, at ? `${at}.${k}` : k, out);
  else if (at) out.push([at, value]);
  return out;
}
const schemaPath = (p) => p.replace(/\[\d+\]/g, "[]");
function valueAt(obj, p) {
  return p.split(/\.|(?=\[)/).reduce((o, seg) => {
    if (o == null) return undefined;
    const m = seg.match(/^\[(\d+)\]$/);
    return m ? o[Number(m[1])] : o[seg];
  }, obj);
}
const same = (a, b) => {
  if (b && typeof b === "object" && typeof b.toDate === "function") b = b.toDate().toISOString();
  return JSON.stringify(a) === JSON.stringify(b);
};

async function record(name, data, result) {
  const exp = exportsByName.get(name);
  if (!exp || !["create", "update"].includes(exp.kind) || !data || typeof data !== "object") return;
  const sent = leaves(data).filter(([p]) => !/^(organizationId|branchId|idempotencyKey)$/.test(p));
  const ids = new Set();
  for (const src of [data, result || {}]) for (const [p, v] of leaves(src)) if (typeof v === "string" && /Id$/.test(p.split(".").pop())) ids.add(v);
  let best = null;
  for (const col of exp.collections) {
    for (const id of ids) {
      const snap = await db.collection(col).doc(id).get().catch(() => null);
      if (!snap || !snap.exists) continue;
      const score = sent.filter(([p, v]) => same(v, valueAt(snap.data(), p))).length;
      if (!best || score > best.score) best = { score, doc: snap.data(), ref: `${col}/${id}` };
    }
  }
  const e = evidence.get(name) || { calls: 0, proven: new Set(), sent: new Set(), transformed: new Set(), docs: new Set() };
  e.calls++;
  for (const [p, v] of sent) {
    e.sent.add(schemaPath(p));
    if (!best) continue;
    const stored = valueAt(best.doc, p);
    if (same(v, stored)) e.proven.add(schemaPath(p));
    else if (stored !== undefined) e.transformed.add(schemaPath(p));
  }
  if (best) e.docs.add(best.ref);
  evidence.set(name, e);
}

/**
 * A response as a client reads it: a null value equals an absent key (the callable protocol sends
 * `undefined` as null; the cached replay omits it), and a temporary password is never cached at rest.
 */
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== null && v !== undefined && k !== "temporaryPassword").map(([k, v]) => [k, comparable(v)]));
}

/**
 * A create sent with an idempotency key (`idempotencyKey`; the image family calls it `clientRequestId`)
 * is replayed once with the same key and payload: the replay must return the identical result (C-10).
 */
function recordingCall(callFunction) {
  return async (name, data, token, timeoutMs) => {
    const result = await callFunction(name, data, token, timeoutMs);
    const exp = exportsByName.get(name);
    if (exp && exp.kind === "create" && data && (data.idempotencyKey || data.clientRequestId)) {
      const replay = await callFunction(name, data, token, timeoutMs);
      assert.deepEqual(comparable(replay), comparable(result), `${name}: a replay with the same idempotency key returned a different result`);
    }
    await record(name, data, result);
    return result;
  };
}

function writeResults() {
  const schemas = truth.getRequestSchemas();
  const callables = {};
  const rows = [];
  for (const exp of [...exportsByName.values()].filter((e) => e.type === "callable" && ["create", "update"].includes(e.kind))) {
    const schemaLeaves = new Set(exp.schemas.flatMap((n) => (schemas[n] ? schemas[n].leaves.map((l) => l.path) : [])));
    for (const p of ["organizationId", "branchId", "idempotencyKey"]) schemaLeaves.delete(p);
    const e = evidence.get(exp.name);
    const proven = e ? [...e.proven].filter((p) => schemaLeaves.has(p)).sort() : [];
    callables[exp.name] = { calls: e ? e.calls : 0, proven, transformed: e ? [...e.transformed].sort() : [], documents: e ? [...e.docs] : [] };
    rows.push(`| \`${exp.name}\` | ${exp.kind} | ${e ? e.calls : 0} | ${proven.length}/${schemaLeaves.size} | ${e ? e.transformed.size : 0} | ${e ? [...e.docs].slice(0, 2).join(", ") : "not exercised"} |`);
  }
  const runId = `roundtrip-${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(ROOT, "docs", "audit", "roundtrip-results.json"), `${JSON.stringify({ runId, generatedAt: new Date().toISOString(), callables }, null, 1)}\n`);
  const md = ["# Maximal round-trip proof", "", `Generated by \`functions/scripts/test-maximal-payload-roundtrip.cjs\` (run \`${runId}\`). Do not edit.`, "",
    "Per create / update callable: request leaf paths (from its schema) whose sent value was read back unchanged from the raw stored document. 'Stored transformed' counts leaves stored at the same path with a different value (normalised phone numbers, trimmed strings, defaults). The proven paths are listed in roundtrip-results.json; Coverage Engine C-2 turns them into the ratio.", "",
    "| Callable | Kind | Calls | Proven / schema leaves | Stored transformed | Raw documents read |", "|---|---|---|---|---|---|", ...rows, ""];
  fs.writeFileSync(path.join(ROOT, "docs", "audit", "roundtrip-results.md"), md.join("\n"));
  const exercised = Object.values(callables).filter((c) => c.calls).length;
  console.log(`Round-trip evidence: ${exercised}/${rows.length} create/update callables exercised, ${Object.values(callables).reduce((n, c) => n + c.proven.length, 0)} leaf paths proven → docs/audit/roundtrip-results.{json,md}`);
}

module.exports = { recordingCall, writeResults };
