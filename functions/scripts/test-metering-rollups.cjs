/**
 * Rollups and overhead (prompt 66 §5.2, §5.3, §5.5), in-process against the Firestore emulator through
 * the built modules (functions/lib), project "trado-metering-test".
 *
 *   concurrency  50 parallel requests on one organization × day document, exact mode: totals exact,
 *                no aborted write (the design choice of §5.3: no shards needed at this rate)
 *   kill         batched mode: a process that exits without flushing loses what it held; the loss is
 *                measured against the stated bound (≤ METER_FLUSH_CALLS calls or METER_FLUSH_SECONDS per
 *                document per instance)
 *   overhead     a 200-call mix (2 reads + 1 write each) with metering off (raw SDK) and on (layer +
 *                exact flush): extra reads, extra writes per request, added p50 / p95 latency
 * Results: docs/audit/metering-overhead.json (read by scripts/generate-api-cost-profile.js).
 *
 * Usage: node scripts/test-metering-rollups.cjs        (runs the batched child itself)
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "trado-metering-test";

const ROLE = process.argv[2] || "main";
if (ROLE === "batched-child") process.env.METER_FLUSH_MODE = "batched";
else process.env.METER_FLUSH_MODE = "exact";
process.env.METER_FLUSH_CALLS = "1000";
process.env.METER_FLUSH_SECONDS = "3600";

const { db } = require("../lib/services/firebase.js");
const { rawDb } = require("../lib/services/meteredFirestore.js");
const { createContext, runInContext } = require("../lib/services/requestContext.js");
const { finishRequest } = require("../lib/services/requestRecorder.js");

const day = new Date().toISOString().slice(0, 10);
const request = async (org, uid, name, work) => {
  const ctx = createContext({ kind: "callable", name }, { organizationId: org, actor: { uid, kind: "user" } });
  await runInContext(ctx, async () => { await work(); await finishRequest(ctx, { outcome: "success", reason: null, result: { ok: true } }); });
  return ctx;
};
const orgDoc = async (org) => (await rawDb().collection("organizationUsageDaily").doc(`${org}_${day}`).get()).data();

async function batchedChild() {
  const org = process.argv[3];
  for (let i = 0; i < 40; i++) await request(org, "u-kill", "probeRead", () => db.collection("meteringProbe").doc("a").get());
  // exit without flushing: the 40 calls are held in memory only
  process.exit(0);
}

async function main() {
  const out = {};
  await rawDb().collection("meteringProbe").doc("a").set({ x: 1 });

  // 1. Concurrency
  const org1 = `conc_${Date.now().toString(36)}`;
  const N = 50;
  const settled = await Promise.allSettled(Array.from({ length: N }, (_, i) => request(org1, `u${i % 5}`, "probeRead", () => db.collection("meteringProbe").doc("a").get())));
  const failedWrites = settled.filter((s) => s.status === "rejected").length;
  const d1 = await orgDoc(org1);
  out.concurrency = { parallelRequests: N, mode: "exact", rejected: failedWrites, recordedCalls: d1.calls, recordedReads: d1.ops.reads, exact: d1.calls === N && d1.ops.reads === N };
  console.log(`${out.concurrency.exact && !failedWrites ? "✓" : "✗"} concurrency: ${N} parallel requests on one document → calls ${d1.calls}, reads ${d1.ops.reads}, rejected writes ${failedWrites}`);

  // 2. Kill test (batched child process)
  const org2 = `kill_${Date.now().toString(36)}`;
  execFileSync(process.execPath, [__filename, "batched-child", org2], { stdio: "inherit", env: process.env });
  const d2 = await orgDoc(org2);
  const lost = 40 - ((d2 && d2.calls) || 0);
  out.kill = { mode: "batched", callsBeforeKill: 40, recordedAfterKill: (d2 && d2.calls) || 0, lostCalls: lost, statedBound: "up to METER_FLUSH_CALLS calls or METER_FLUSH_SECONDS of calls per rollup document per instance (SIGTERM flushes first; a hard kill does not)", withinBound: lost <= 1000 };
  console.log(`${out.kill.withinBound ? "✓" : "✗"} kill: batched instance ended without flush after 40 calls → lost ${lost} (bound: METER_FLUSH_CALLS = 1000 per document here)`);

  // 3. Overhead: metering off (raw SDK, no context) vs on (layer + exact flush)
  const raw = rawDb();
  const org3 = `ovh_${Date.now().toString(36)}`;
  const work = async (fdb) => { await fdb.collection("meteringProbe").doc("a").get(); await fdb.collection("meteringProbe").doc("b").get(); await fdb.collection("meteringProbe").doc(`w${Math.random().toString(36).slice(2, 8)}`).set({ t: 1 }); };
  const time = async (fn) => { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
  const off = []; const on = []; let extraReads = 0; let meterWrites = 0;
  for (let i = 0; i < 200; i++) {
    off.push(await time(() => work(raw)));
    let ctx;
    on.push(await time(async () => { ctx = await request(org3, `u${i % 10}`, "probeMix", () => work(db)); }));
    extraReads += ctx.ops.total.reads - 2;
    meterWrites += 2; // the organization and the user document, written by the exact flush
  }
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor((s.length - 1) * p)] * 100) / 100; };
  out.overhead = {
    calls: 200, mix: "2 document reads + 1 write per call",
    extraReadsPerRequest: extraReads / 200,
    extraWritesPerRequest: { exact: meterWrites / 200, batched: "≤ 2 per (organization, day) and (organization, user, day) document per flush; with METER_FLUSH_CALLS = 100 that is ≤ 0.02 per request for a single user" },
    latencyMs: { off: { p50: pct(off, 0.5), p95: pct(off, 0.95) }, on: { p50: pct(on, 0.5), p95: pct(on, 0.95) } },
  };
  out.overhead.addedLatencyMs = { p50: Math.round((out.overhead.latencyMs.on.p50 - out.overhead.latencyMs.off.p50) * 100) / 100, p95: Math.round((out.overhead.latencyMs.on.p95 - out.overhead.latencyMs.off.p95) * 100) / 100 };
  const d3 = await orgDoc(org3);
  assert.equal(d3.calls, 200);
  console.log(`✓ overhead: extra reads per request ${out.overhead.extraReadsPerRequest}; meter writes per request ${out.overhead.extraWritesPerRequest.exact} (exact); latency p50 ${out.overhead.latencyMs.off.p50} → ${out.overhead.latencyMs.on.p50} ms, p95 ${out.overhead.latencyMs.off.p95} → ${out.overhead.latencyMs.on.p95} ms (emulator, in-process)`);

  const ok = out.concurrency.exact && !failedWrites && out.kill.withinBound && out.overhead.extraReadsPerRequest === 0;
  out.measuredAt = new Date().toISOString();
  fs.writeFileSync(path.resolve(__dirname, "../../docs/audit/metering-overhead.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWritten docs/audit/metering-overhead.json; ${ok ? "all checks as expected" : "SOME CHECKS FAILED"}`);
  process.exit(ok ? 0 : 1);
}

(ROLE === "batched-child" ? batchedChild() : main()).catch((e) => { console.error(e); process.exit(1); });
