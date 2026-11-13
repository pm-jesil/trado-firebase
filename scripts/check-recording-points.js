#!/usr/bin/env node
/**
 * @guard-scope: files functions/src/**\/*.ts (production source)
 *
 * One recording point for metering and one for audit (prompt 66, D-23; guards no-raw-firestore,
 * no-handler-audit, no-handler-meter). Fails on:
 *   no-raw-firestore   a Firestore instance built outside services/firebase.ts, or the raw (uncounted) SDK
 *                      handle used outside the recorders: every operation must go through the counting layer
 *   no-handler-audit   a write to auditLogs outside services/auditRecorder.ts
 *   no-handler-meter   a write to the cost rollups outside services/requestRecorder.ts, or a plan-limit
 *                      counter increment outside the gate and the storage trigger
 * Usage: node scripts/check-recording-points.js [--test]   (--test seeds one violation per rule)
 */
const fs = require("node:fs");
const path = require("node:path");
const truth = require("./lib/source-truth.js");

const RULES = [
  { name: "no-raw-firestore", re: /\bgetFirestore\s*\(|admin\.firestore\s*\(/, allowed: ["functions/src/services/firebase.ts"] },
  { name: "no-raw-firestore", re: /\brawDb\s*\(/, allowed: ["functions/src/services/meteredFirestore.ts", "functions/src/services/requestRecorder.ts", "functions/src/services/auditRecorder.ts"] },
  { name: "no-handler-audit", re: /collection\(\s*"auditLogs"\s*\)\s*\.\s*(add\s*\(|doc\([^)]*\)\s*\.\s*(set|update|create|delete)\s*\()/, allowed: ["functions/src/services/auditRecorder.ts"] },
  { name: "no-handler-meter", re: /collection\(\s*"(organizationUsageDaily|userUsageDaily)"\s*\)\s*\.\s*doc\([^)]*\)\s*\.\s*(set|update|create)\s*\(/, allowed: ["functions/src/services/usageMetering.ts"] },
  { name: "no-handler-meter", re: /\bincrementServerUsage\s*\(\s*\{/, allowed: ["functions/src/services/contextResolver.ts", "functions/src/triggers/storageTriggers.ts"] },
];

function scan(files) {
  const findings = [];
  for (const [file, text] of files) {
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const rule of RULES) if (rule.re.test(line) && !rule.allowed.includes(file)) findings.push(`${rule.name}: ${file}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  return findings;
}

if (process.argv.includes("--test")) {
  const seeded = [
    ["functions/src/callables/probe.ts", 'const raw = getFirestore(app);'],
    ["functions/src/callables/probe.ts", 'await db.collection("auditLogs").doc(id).set(event);'],
    ["functions/src/callables/probe.ts", 'await db.collection("userUsageDaily").doc(id).set(row, { merge: true });'],
    ["functions/src/callables/probe.ts", 'await incrementServerUsage({ organizationId, timeZone, metrics });'],
  ];
  const hits = scan(seeded);
  const names = new Set(hits.map((h) => h.split(":")[0]));
  if (hits.length !== seeded.length || names.size !== 3) { console.error(`FAIL: check-recording-points --test caught ${hits.length}/${seeded.length} seeded violations`); process.exit(1); }
  console.log(`✓ check-recording-points --test: ${hits.length}/${seeded.length} seeded violations caught (${[...names].join(", ")})`);
  process.exit(0);
}

const files = truth.productionSourceFiles().map((abs) => [truth.rel(abs), fs.readFileSync(abs, "utf8")]);
const findings = scan(files);
if (findings.length) {
  console.error(`✗ check-recording-points: ${findings.length} violation(s)\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ check-recording-points: ${files.length} production files; Firestore only through the counting layer, audit only in auditRecorder, meter only in requestRecorder (${path.basename(__filename)})`);
