/**
 * Seeded violations for check-same-doc-duplicates (prompt 65, Part 3.2). Drives the real guard:
 *   1. analyzeDocument() on each violation (the guard's own function, not a copy);
 *   2. end to end: the five documents are written to the emulator (collection `tasks`), the guard is
 *      run as a process and must exit 1 naming each document; the documents are deleted afterwards.
 * Usage: node scripts/test-same-doc-duplicates-defects.cjs
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Timestamp } = require("firebase-admin/firestore");
const { analyzeDocument } = require("./check-same-doc-duplicates.cjs");
const { db, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");

const at = "2026-01-15T00:00:00.000Z";
const VIOLATIONS = [
  ["zz-defect-image-triple", "alias-family", { name: "Probe", image: { path: "a/b.webp" }, photoUrl: "https://x/p.png", avatarUrl: "https://x/a.png" }],
  ["zz-defect-name-displayname", "alias-family", { name: "Probe Name", displayName: "Probe Name" }],
  ["zz-defect-total-beside-lines", "derived", { title: "Probe", lines: [{ amount: 120 }, { amount: 80 }], grandTotal: 200 }],
  ["zz-defect-status-and-flag", "alias-family", { title: "Probe", status: "active", isActive: true }],
  ["zz-defect-createdat-twice", "same-value", { title: "Probe", createdAt: at, createdAtTimestamp: Timestamp.fromDate(new Date(at)) }],
];

(async () => {
  for (const [id, type, data] of VIOLATIONS) {
    const findings = analyzeDocument("tasks", `tasks/${id}`, data);
    assert.ok(findings.some((f) => f.type === type), `${id}: expected a ${type} finding, got ${JSON.stringify(findings)}`);
    console.log(`  ✓ analyzeDocument ${id}: ${findings.map((f) => `${f.type} — ${f.detail}`).join(" | ")}`);
  }
  await verifyEmulatorHealth();
  try {
    for (const [id, , data] of VIOLATIONS) await db.collection("tasks").doc(id).set(data);
    const r = spawnSync(process.execPath, [path.join(__dirname, "check-same-doc-duplicates.cjs")], { encoding: "utf8", env: process.env });
    assert.equal(r.status, 1, `guard must fail on seeded violations (exit ${r.status})\n${r.stdout}`);
    for (const [id] of VIOLATIONS) assert.ok(r.stdout.includes(`tasks/${id}`), `guard output does not name tasks/${id}`);
    const tasksLine = r.stdout.split("\n").find((l) => / tasks /.test(l));
    console.log(`  ✓ guard process exit 1 and names all ${VIOLATIONS.length} seeded documents (${tasksLine.trim()})`);
  } finally {
    for (const [id] of VIOLATIONS) await db.collection("tasks").doc(id).delete();
  }
  console.log(`[PASS] ${VIOLATIONS.length}/${VIOLATIONS.length} seeded violations detected by the guard.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
