#!/usr/bin/env node
/**
 * Rules evidence for the Coverage Engine (C-9): how often each `allow` statement evaluated to
 * allow and to deny during the last run of the rules tests.
 *
 *   node scripts/collect-rules-coverage.js firestore|storage
 *
 * firestore: the Firestore emulator's rule-coverage report for the project id the test wrote to
 *            .local/rules-evidence/firestore.json; the expression starting on an allow line is that
 *            statement's condition (true → allowed; false, undefined or error → denied).
 * storage:   the Storage emulator has no such report; the test records every request outcome in
 *            .local/rules-evidence/storage.json. A denied request counts as a deny of every matching
 *            statement for its operation; an allowed request counts for the first matching
 *            (most specific) statement that is not an unconditional deny.
 * Output: docs/generated/rules-coverage.json, keyed `<line>:<operation>` per service.
 */
const fs = require("node:fs");
const path = require("node:path");
const truth = require("./lib/source-truth.js");

const ROOT = truth.ROOT;
const OUT = path.join(ROOT, "docs", "generated", "rules-coverage.json");
const EVIDENCE = path.join(ROOT, ".local", "rules-evidence");
const service = process.argv[2];

function patternRegex(matchPath, prefix) {
  const body = matchPath.replace(prefix, "").replace(/\{[^}=]+=\*\*\}/g, "\u0000").replace(/\{[^}]+\}/g, "\u0001");
  const escaped = body.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\u0000/g, ".*").replace(/\u0001/g, "[^/]+");
  return new RegExp(`^${escaped.replace(/^\//, "")}$`);
}

async function firestore(allows) {
  const { projectId, outcomes = [] } = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "firestore.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}:ruleCoverage`);
  const report = (await res.json()).report || [];
  const out = {};
  for (const a of allows) {
    const counts = { allowed: 0, denied: 0 };
    for (const node of report.filter((n) => n.sourcePosition && n.sourcePosition.line === a.line)) {
      for (const v of node.values || []) {
        if (v.value && v.value.boolValue === true) counts.allowed += v.count;
        else counts.denied += v.count;
      }
    }
    // A literal `if false` is not in the report: count recorded denials of paths only it matches.
    if (a.unconditionalDeny && counts.allowed + counts.denied === 0) {
      const re = patternRegex(a.matchPath, /^\/databases\/\{[^}]+\}\/documents/);
      const others = allows.filter((b) => b !== a && !b.unconditionalDeny).map((b) => patternRegex(b.matchPath, /^\/databases\/\{[^}]+\}\/documents/));
      counts.denied += outcomes.filter((o) => !o.allowed && (o.op === a.operation) && re.test(o.path) && !others.some((r) => r.test(o.path))).length;
    }
    out[`${a.line}:${a.operation}`] = counts;
  }
  return { projectId, recordedOutcomes: outcomes.length, statements: out };
}

function storage(allows) {
  const { outcomes } = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "storage.json"), "utf8"));
  const out = Object.fromEntries(allows.map((a) => [`${a.line}:${a.operation}`, { allowed: 0, denied: 0 }]));
  const covers = (stmtOp, op) => stmtOp === op || (op === "write" && ["create", "update", "delete"].includes(stmtOp)) || (op === "read" && ["get", "list"].includes(stmtOp));
  const unmatched = [];
  for (const o of outcomes) {
    const matching = allows.filter((a) => covers(a.operation, o.op) && patternRegex(a.matchPath, /^\/b\/\{[^}]+\}\/o/).test(o.path));
    if (!matching.length) { unmatched.push(o.path); continue; }
    if (o.allowed) {
      const decider = matching.find((a) => !a.unconditionalDeny);
      if (decider) out[`${decider.line}:${decider.operation}`].allowed++;
    } else for (const a of matching) out[`${a.line}:${a.operation}`].denied++;
  }
  return { requests: outcomes.length, unmatched, statements: out };
}

(async () => {
  if (!["firestore", "storage"].includes(service)) { console.error("usage: collect-rules-coverage.js firestore|storage"); process.exit(2); }
  const allows = truth.getRules()[service].allows;
  const result = service === "firestore" ? await firestore(allows) : storage(allows);
  const doc = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  doc.runId = `rules-${Date.now().toString(36)}`;
  doc.generatedAt = new Date().toISOString();
  doc[service] = result.statements;
  doc[`${service}Meta`] = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "statements"));
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  for (const a of allows) {
    const c = result.statements[`${a.line}:${a.operation}`];
    console.log(`  ${service}.rules:${String(a.line).padEnd(4)} allow ${a.operation.padEnd(7)} ${a.matchPath.replace("/databases/{database}/documents", "").padEnd(42)} allowed ${String(c.allowed).padStart(4)}  denied ${String(c.denied).padStart(4)}${a.unconditionalDeny ? "  (unconditional deny)" : ""}`);
  }
  console.log(`Written ${truth.rel(OUT)} (${service})`);
})().catch((e) => { console.error(e); process.exit(1); });
