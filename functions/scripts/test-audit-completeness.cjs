/**
 * Audit completeness proof (prompt 66 §6.9).
 *
 * For each mutation below: snapshot every collection (collection-group reads, so subcollections too)
 * before and after the call, wait for its triggers, and assert that
 *   - every document created, updated or deleted (outside the excluded system collections,
 *     services/auditRecorder.ts AUDIT_EXCLUDED_COLLECTIONS) is a target of exactly one new audit event;
 *   - every target of a new event was in fact changed.
 * Seeded defect: a document written past the counting layer during a call must make the proof fail.
 *
 * Usage: node scripts/test-audit-completeness.cjs
 */
const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction } = require("./helpers/callable-client.cjs");
const { getSuperAdminPersona, createTenantOwnerPersona, db } = require("./helpers/auth-personas.cjs");
const truth = require("../../scripts/lib/source-truth.js");
const { AUDIT_EXCLUDED_COLLECTIONS } = require("../lib/services/auditRecorder.js");

enforceLocalEmulatorSafety();
const COLLECTIONS = [...new Set(truth.getCollections().collections.map((c) => c.key.split("/").pop()))];
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

async function snapshot() {
  const out = new Map();
  await Promise.all(COLLECTIONS.map(async (name) => {
    const snap = await db.collectionGroup(name).get();
    for (const d of snap.docs) out.set(d.ref.path, d.updateTime.toMillis());
  }));
  return out;
}
const excluded = (path) => path.split("/").some((seg, i) => i % 2 === 0 && AUDIT_EXCLUDED_COLLECTIONS[seg]);

function diff(before, after) {
  const changed = new Set();
  for (const [p, t] of after) if (before.get(p) !== t) changed.add(p);
  for (const p of before.keys()) if (!after.has(p)) changed.add(p);
  return changed;
}

async function prove(label, run, { seedBypass = false } = {}) {
  const before = await snapshot();
  await run();
  if (seedBypass) await db.collection("tasks").doc(`bypass_${Date.now()}`).set({ organizationId: "seeded-defect", title: "written past the layer" });
  await settle();
  const after = await snapshot();
  const changed = diff(before, after);
  const newEvents = [...after.keys()].filter((p) => p.startsWith("auditLogs/") && !before.has(p));
  const events = await Promise.all(newEvents.map(async (p) => (await db.doc(p).get()).data()));
  const business = [...changed].filter((p) => !excluded(p));
  const targetCount = new Map();
  for (const e of events) for (const t of e.targets || []) if (t.path) targetCount.set(t.path, (targetCount.get(t.path) || 0) + 1);
  const missing = business.filter((p) => (targetCount.get(p) || 0) === 0);
  const duplicated = business.filter((p) => (targetCount.get(p) || 0) > 1);
  const phantom = [...targetCount.keys()].filter((p) => !changed.has(p));
  const ok = missing.length === 0 && duplicated.length === 0 && phantom.length === 0;
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(34)} changed ${String(business.length).padStart(3)} | in exactly one event ${business.length - missing.length - duplicated.length} | events ${events.length}${missing.length ? ` | NOT AUDITED ${missing.join(", ")}` : ""}${duplicated.length ? ` | IN 2+ EVENTS ${duplicated.join(", ")}` : ""}${phantom.length ? ` | TARGET NOT CHANGED ${phantom.join(", ")}` : ""}`);
  return { label, ok, changed: business.length, covered: business.length - missing.length - duplicated.length, missing };
}

(async () => {
  await verifyEmulatorHealth();
  const sa = await getSuperAdminPersona();
  const owner = await createTenantOwnerPersona(sa.idToken, "AuditProof");
  const o = owner.organizationId;
  const t = owner.idToken;
  const u = Date.now() % 100000;
  const ids = {};
  const results = [];
  const step = async (label, fn) => results.push(await prove(label, fn));

  await step("customersCreate", async () => { ids.customer = (await callFunction("customersCreate", { organizationId: o, name: `Proof Customer ${u}`, phone: "+919876500001" }, t)).customerId; });
  await step("customersUpdate", () => callFunction("customersUpdate", { organizationId: o, customerId: ids.customer, name: `Proof Customer ${u} B` }, t));
  await step("vendorsCreate", async () => { ids.vendor = (await callFunction("vendorsCreate", { organizationId: o, name: `Proof Vendor ${u}`, phone: "+919876500002" }, t)).vendorId; });
  await step("productsCreate", async () => { ids.product = (await callFunction("productsCreate", { organizationId: o, name: `Proof Product ${u}`, sellingPrice: 100, costPrice: 60, initialStock: 20 }, t)).productId; });
  await step("productsUpdate", () => callFunction("productsUpdate", { organizationId: o, productId: ids.product, sellingPrice: 110 }, t));
  await step("billsCreate (with triggers)", async () => { ids.bill = (await callFunction("billsCreate", { organizationId: o, customerId: ids.customer, items: [{ productId: ids.product, quantity: 2 }], paidAmount: 0 }, t)).billId; });
  await step("paymentsCreate (with triggers)", async () => { ids.payment = (await callFunction("paymentsCreate", { organizationId: o, direction: "in", partyType: "customer", partyId: ids.customer, amount: 50, method: "cash" }, t)).paymentId; });
  await step("outflowsCreate (with triggers)", () => callFunction("outflowsCreate", { organizationId: o, kind: "expense", payee: "Tea stall", lines: [{ itemName: "Tea", quantity: 1, unit: "piece", unitPrice: 20 }] }, t));
  await step("stockAdjust", () => callFunction("stockAdjust", { organizationId: o, productId: ids.product, quantity: -1, reason: "audit proof" }, t));
  await step("tasksCreate", () => callFunction("tasksCreate", { organizationId: o, title: "Proof task", assignedToMembershipId: owner.ownerMembershipId }, t));
  await step("branchesCreate", () => callFunction("branchesCreate", { organizationId: o, name: "Proof Branch", code: `PB${u}` }, t));
  await step("organizationsUpdate (Super Admin)", () => callFunction("organizationsUpdate", { organizationId: o, name: `AuditProof Renamed ${u}` }, sa.idToken));
  await step("billsVoid (with triggers)", () => callFunction("billsVoid", { organizationId: o, documentId: ids.bill, reason: "audit proof" }, t));
  await step("paymentsVoid (with triggers)", () => callFunction("paymentsVoid", { organizationId: o, paymentId: ids.payment, reason: "audit proof" }, t));

  // Seeded defect: a write that skips the counting layer during a call must be caught.
  const seeded = await prove("seeded defect (layer bypassed)", () => callFunction("customersUpdate", { organizationId: o, customerId: ids.customer, name: `Proof Customer ${u} C` }, t), { seedBypass: true });
  assert.ok(!seeded.ok && seeded.missing.some((p) => p.startsWith("tasks/bypass_")), "the write that bypassed the layer must be reported as not audited");
  console.log("✓ seeded defect detected: the write past the layer is reported as not audited");
  const bypassSnaps = await db.collection("tasks").where("organizationId", "==", "seeded-defect").get();
  for (const doc of bypassSnaps.docs) await doc.ref.delete();

  const changed = results.reduce((n, r) => n + r.changed, 0);
  const covered = results.reduce((n, r) => n + r.covered, 0);
  console.log(`\nAudit completeness: ${covered}/${changed} changed business documents in exactly one event, over ${results.length} mutation calls (${results.filter((r) => r.ok).length}/${results.length} calls complete).`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
