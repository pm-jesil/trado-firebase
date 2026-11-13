#!/usr/bin/env node
/**
 * API cost profile and cost budgets (prompt 66, Part 8), from the test runs, never typed.
 *
 *   node scripts/generate-api-cost-profile.js                 docs/reference/api-cost-profile.md
 *   node scripts/generate-api-cost-profile.js --init-budgets  scripts/cost-budgets.json from the measured maxima
 *   node scripts/generate-api-cost-profile.js --check-budgets guard check:cost-budgets
 *
 * Input: .local/request-ops/*.jsonl, one line per request written by the emulator
 * (functions/src/services/requestRecorder.ts), cleared at the start of every full run; and
 * docs/audit/metering-overhead.json (functions/scripts/test-metering-rollups.cjs).
 */
const fs = require("node:fs");
const path = require("node:path");
const truth = require("./lib/source-truth.js");

const ROOT = truth.ROOT;
const DIR = path.join(ROOT, ".local", "request-ops");
const OUT = path.join(ROOT, "docs", "reference", "api-cost-profile.md");
const BUDGETS = path.join(ROOT, "scripts", "cost-budgets.json");
const { DEFAULT_RATE_CARD_V1: card } = require(path.join(ROOT, "functions", "lib", "services", "usageMetering.js"));

const lines = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).flatMap((f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
const byName = new Map();
for (const l of lines) byName.set(l.name, [...(byName.get(l.name) || []), l]);

const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
const mean = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0);
const costOf = (reads, writes, deletes) => (reads / 1e5) * card.rates.firestoreReadPer100k + (writes / 1e5) * card.rates.firestoreWritePer100k + (deletes / 1e5) * card.rates.firestoreDeletePer100k + (1 / 1e6) * card.rates.functionsInvocationPerMillion;
const pricesVerified = ["firestoreReadPer100k", "firestoreWritePer100k", "firestoreDeletePer100k", "functionsInvocationPerMillion"].every((k) => card.verification && card.verification[k] && card.verification[k].verified);

function profile(name) {
  const all = byName.get(name) || [];
  const ok = all.filter((l) => l.outcome === "success");
  const r = ok.map((l) => l.ops.reads); const w = ok.map((l) => l.ops.writes); const d = ok.map((l) => l.ops.deletes);
  return {
    name, calls: all.length, success: ok.length,
    reads: { min: q(r, 0), typical: q(r, 0.5), max: q(r, 1) },
    writes: { min: q(w, 0), typical: q(w, 0.5), max: q(w, 1) },
    deletes: { min: q(d, 0), typical: q(d, 0.5), max: q(d, 1) },
    gateReads: mean(ok.map((l) => (l.byCategory && l.byCategory.gate ? l.byCategory.gate.reads : 0))),
    auditWrites: mean(ok.map((l) => (l.byCategory && l.byCategory.audit ? l.byCategory.audit.writes : 0))),
    redundantReads: mean(ok.map((l) => l.redundantReads || 0)),
    p50Ms: q(ok.map((l) => l.durationMs), 0.5), p95Ms: q(ok.map((l) => l.durationMs), 0.95),
    bytesOut: mean(ok.map((l) => l.bytesOut || 0)),
    costPerCall: costOf(q(r, 0.5), q(w, 0.5), q(d, 0.5)),
  };
}

const exportsList = truth.getExports();
const callables = exportsList.filter((e) => e.type === "callable").map((e) => e.name).sort();
const triggerExports = exportsList.filter((e) => e.type === "trigger");
const TRIGGER_COLLECTION = { onBillWritten: "bills", onOutflowWritten: "outflows", onPaymentWritten: "payments", onDeliveryWritten: "deliveries" };
const firedBy = (exp) => Object.entries(TRIGGER_COLLECTION).filter(([, col]) => exp.collections.includes(col)).map(([t]) => t);

if (process.argv.includes("--init-budgets") || process.argv.includes("--check-budgets")) {
  const budgets = fs.existsSync(BUDGETS) ? JSON.parse(fs.readFileSync(BUDGETS, "utf8")).callables : {};
  if (process.argv.includes("--init-budgets")) {
    const out = {};
    for (const name of callables) {
      const p = profile(name);
      if (!p.success) continue;
      const head = (n) => Math.ceil(n * 1.25) + 1;
      out[name] = { maxReads: head(p.reads.max), maxWrites: head(p.writes.max), maxDeletes: head(p.deletes.max) };
    }
    fs.writeFileSync(BUDGETS, `${JSON.stringify({ $comment: "Per-callable cost budgets for the standard scenarios of the test suites (prompt 66 Part 8): 1.25 × the measured maximum + 1, set from the run of " + new Date().toISOString().slice(0, 10) + ". A regression fails check:cost-budgets for exactly that callable. Raise a budget only with the reason in the commit.", callables: out }, null, 2)}\n`);
    console.log(`Written scripts/cost-budgets.json: ${Object.keys(out).length} callables with a measured run`);
    process.exit(0);
  }
  if (!lines.length) { console.error("[FAIL] check:cost-budgets: no request-ops data (.local/request-ops is empty): run the emulator suites first."); process.exit(1); }
  const over = []; const unbudgeted = []; const unmeasured = [];
  for (const name of callables) {
    const p = profile(name);
    const b = budgets[name];
    if (!p.success) { unmeasured.push(name); continue; }
    if (!b) { unbudgeted.push(name); continue; }
    for (const [k, limit] of [["reads", b.maxReads], ["writes", b.maxWrites], ["deletes", b.maxDeletes]]) if (p[k].max > limit) over.push(`${name}: ${k} ${p[k].max} > budget ${limit}`);
  }
  console.log(`check:cost-budgets: ${callables.length - unmeasured.length} callables measured, ${Object.keys(budgets).length} budgets; over budget ${over.length}; without a budget ${unbudgeted.length}; not exercised ${unmeasured.length}`);
  for (const o of over) console.log(`  OVER ${o}`);
  for (const u of unbudgeted) console.log(`  NO BUDGET ${u}`);
  process.exit(over.length || unbudgeted.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The profile document
// ---------------------------------------------------------------------------
const overhead = fs.existsSync(path.join(ROOT, "docs", "audit", "metering-overhead.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "audit", "metering-overhead.json"), "utf8")) : null;
const profiles = callables.map(profile);
const measured = profiles.filter((p) => p.success);
const md = ["# API cost profile", "",
  "Generated by `scripts/generate-api-cost-profile.js` from the operations the emulator recorded per request during the test suites (`.local/request-ops`). Do not edit.", "",
  lines.length ? `${lines.length} requests recorded; ${measured.length} of ${callables.length} callables ran successfully at least once. Reads / writes / deletes are per successful call of the suites' scenarios (min / typical = median / max), every operation included (gate reads, audit and the call's own writes; meter writes are separate, below). Cost per call: typical operations + one invocation × rate card \`${card.version}\` (${card.currency}${pricesVerified ? "" : ", **prices not verified**"}).` : "**Not run**: no request data was recorded.", ""];

if (overhead) {
  md.push("## Metering overhead (measured)", "",
    `${overhead.overhead.calls} calls of "${overhead.overhead.mix}", in-process against the emulator (${overhead.measuredAt.slice(0, 10)}):`, "",
    "| | Off | On | Added |", "|---|---|---|---|",
    `| extra reads per request | — | ${overhead.overhead.extraReadsPerRequest} | ${overhead.overhead.extraReadsPerRequest} (target 0) |`,
    `| meter writes per request, exact mode | 0 | ${overhead.overhead.extraWritesPerRequest.exact} | ${overhead.overhead.extraWritesPerRequest.exact} (target ≤ 2) |`,
    `| meter writes per request, batched mode | 0 | ${overhead.overhead.extraWritesPerRequest.batched} | (target ≤ 0.2) |`,
    `| latency p50 (ms) | ${overhead.overhead.latencyMs.off.p50} | ${overhead.overhead.latencyMs.on.p50} | ${overhead.overhead.addedLatencyMs.p50} |`,
    `| latency p95 (ms) | ${overhead.overhead.latencyMs.off.p95} | ${overhead.overhead.latencyMs.on.p95} | ${overhead.overhead.addedLatencyMs.p95} |`, "",
    `Audit writes per mutation: 1 before (the handler's own \`createAuditLog\`) → 1 after (the event in the mutation's commit); \`changeHistory\` never existed, so there was no second write to remove. Concurrency: ${overhead.concurrency.parallelRequests} parallel requests on one rollup document recorded ${overhead.concurrency.recordedCalls} calls, ${overhead.concurrency.rejected} rejected writes. Kill test (batched): ${overhead.kill.lostCalls} of ${overhead.kill.callsBeforeKill} calls lost when the process ended without a flush — the stated bound is ${overhead.kill.statedBound}.`, "",
    `Estimated cost of the metering writes per 1,000,000 requests in exact mode: ${Math.round(((overhead.overhead.extraWritesPerRequest.exact * 1e6) / 1e5) * card.rates.firestoreWritePer100k * 100) / 100} ${card.currency} (${pricesVerified ? "verified prices" : "unverified prices"}); in batched mode a hundredth of that or less.`, "");
}

const top10 = [...measured].sort((a, b) => b.costPerCall - a.costPerCall).slice(0, 10);
md.push("## Top 10 callables by estimated cost per call", "", "| Callable | Reads (typ / max) | Writes (typ / max) | Deletes | Cost per call | Cost per 1,000 calls |", "|---|---|---|---|---|---|",
  ...top10.map((p) => `| \`${p.name}\` | ${p.reads.typical} / ${p.reads.max} | ${p.writes.typical} / ${p.writes.max} | ${p.deletes.typical} | ${p.costPerCall.toFixed(6)} | ${(p.costPerCall * 1000).toFixed(3)} |`), "");

md.push("## Every callable", "", "| Callable | Calls (ok) | Reads min / typ / max | Writes min / typ / max | Deletes max | Gate reads | Audit writes | Redundant reads | p50 / p95 ms | Triggers its writes can fire |", "|---|---|---|---|---|---|---|---|---|---|",
  ...profiles.map((p) => {
    const exp = exportsList.find((e) => e.name === p.name);
    return p.success
      ? `| \`${p.name}\` | ${p.calls} (${p.success}) | ${p.reads.min} / ${p.reads.typical} / ${p.reads.max} | ${p.writes.min} / ${p.writes.typical} / ${p.writes.max} | ${p.deletes.max} | ${p.gateReads} | ${p.auditWrites} | ${p.redundantReads} | ${p.p50Ms} / ${p.p95Ms} | ${firedBy(exp).join(", ") || "—"} |`
      : `| \`${p.name}\` | ${p.calls} (0) | not measured | | | | | | | ${firedBy(exp).join(", ") || "—"} |`;
  }), "");

md.push("## Trigger amplification (per execution)", "", "| Trigger | Executions | Reads typ / max | Writes typ / max | Deletes max |", "|---|---|---|---|---|",
  ...triggerExports.map((t) => { const p = profile(t.name); return `| \`${t.name}\` | ${p.calls} | ${p.reads.typical} / ${p.reads.max} | ${p.writes.typical} / ${p.writes.max} | ${p.deletes.max} |`; }), "");

const redundant = measured.filter((p) => p.redundantReads > 0).sort((a, b) => b.redundantReads - a.redundantReads);
const lists = measured.filter((p) => /List$/.test(p.name)).sort((a, b) => b.reads.typical - a.reads.typical);
const gateMean = mean(measured.map((p) => p.gateReads));
md.push("## Cheap wins (measured; not applied)", "",
  `- **Duplicate reads in one request**: ${redundant.length} callables read a document twice with no write in between${redundant.length ? `: ${redundant.slice(0, 8).map((p) => `\`${p.name}\` (${p.redundantReads} per call)`).join(", ")}` : ""}. Each is one read per call that a local variable would save.`,
  `- **List reads per page**: ${lists.slice(0, 5).map((p) => `\`${p.name}\` ${p.reads.typical}`).join(", ")} reads for a typical page; a smaller default page or a field selection lowers egress, not reads.`,
  "- **`count()` on every page**: removed from `auditLogsList` (now `includeTotal: true` only); the per-entity history no longer reads every event of the entity before taking 50.",
  `- **Gate membership cache (owner decision)**: the gate reads ${gateMean} documents per gated call on average. A per-instance cache of the membership read for a few seconds would save up to one read per call per user; the price is that a revoked membership keeps working until the cache expires. Not applied.`, "");

const text = `${md.join("\n")}\n`;
fs.writeFileSync(OUT, text);
console.log(`Written docs/reference/api-cost-profile.md: ${lines.length} requests, ${measured.length}/${callables.length} callables measured`);
