/**
 * Known-operations table (prompt 66, Part 4): every Firestore API call the code uses, with the count
 * the billing rules give (services/meteredFirestore.ts), asserted against the counting layer AND the
 * independent shadow counter (services/shadowCounter.ts). Runs against the Firestore emulator through
 * the built modules (functions/lib), in its own project id.
 *
 * Usage: node scripts/test-metering-layer.cjs
 */
const assert = require("node:assert/strict");
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "trado-metering-test";

const { db } = require("../lib/services/firebase.js");
const { rawDb } = require("../lib/services/meteredFirestore.js");
const { installShadowCounter } = require("../lib/services/shadowCounter.js");
const { createContext, runInContext } = require("../lib/services/requestContext.js");

installShadowCounter(rawDb());
const C = "meteringProbe";
const results = [];

async function measure(label, expected, fn) {
  const ctx = createContext({ kind: "script", name: label });
  await runInContext(ctx, fn);
  const layer = { reads: ctx.ops.total.reads, writes: ctx.ops.total.writes, deletes: ctx.ops.total.deletes };
  const shadow = ctx.shadow ? { reads: ctx.shadow.reads, writes: ctx.shadow.writes, deletes: ctx.shadow.deletes } : null;
  // Each mutating commit carries its audit event in the same commit (services/auditRecorder.ts): `audit` events are
  // part of the expected writes, and the audit category must hold exactly those.
  const auditEvents = expected.audit || 0;
  const want = { reads: expected.reads || 0, writes: (expected.writes || 0) + auditEvents, deletes: expected.deletes || 0 };
  const ok = JSON.stringify(layer) === JSON.stringify(want) && JSON.stringify(shadow) === JSON.stringify(want) && ctx.ops.byCategory.audit.writes === auditEvents;
  results.push({ label, want, layer, shadow, ok, ctx });
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(52)} expected ${JSON.stringify(want)} layer ${JSON.stringify(layer)} shadow ${JSON.stringify(shadow)}`);
  return ctx;
}

async function clear() {
  const raw = rawDb();
  for (const col of [C, `${C}Count`]) {
    const snap = await raw.collection(col).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = raw.batch();
      for (const d of snap.docs.slice(i, i + 400)) b.delete(d.ref);
      await b.commit();
    }
  }
}

async function seedCount(n) {
  const raw = rawDb();
  for (let i = 0; i < n; i += 400) {
    const b = raw.batch();
    for (let j = i; j < Math.min(n, i + 400); j++) b.set(raw.collection(`${C}Count`).doc(`d${String(j).padStart(5, "0")}`), { i: j });
    await b.commit();
  }
}

(async () => {
  await clear();
  await rawDb().collection(C).doc("a").set({ x: 1 });
  await rawDb().collection(C).doc("b").set({ x: 2 });
  await rawDb().collection(C).doc("c").set({ x: 3 });

  await measure("document get (exists)", { reads: 1 }, () => db.collection(C).doc("a").get());
  await measure("document get (missing) = 1 read", { reads: 1 }, () => db.collection(C).doc("missing").get());
  await measure("query with 3 results", { reads: 3 }, () => db.collection(C).get());
  await measure("empty query = 1 read", { reads: 1 }, () => db.collection(C).where("x", ">", 99).get());
  await measure("query with offset 2 (skipped rows billed)", { reads: 3 }, () => db.collection(C).orderBy("x").offset(2).get());
  await measure("getAll of 3 refs, 1 missing = 3 reads", { reads: 3 }, () => db.getAll(db.collection(C).doc("a"), db.collection(C).doc("b"), db.collection(C).doc("zz")));
  await measure("set", { writes: 1, audit: 1 }, () => db.collection(C).doc("d").set({ x: 4 }));
  await measure("create", { writes: 1, audit: 1 }, () => db.collection(C).doc("e").create({ x: 5 }));
  await measure("update", { writes: 1, audit: 1 }, () => db.collection(C).doc("e").update({ x: 6 }));
  await measure("delete", { deletes: 1, audit: 1 }, () => db.collection(C).doc("e").delete());
  await measure("collection add", { writes: 1, audit: 1 }, () => db.collection(C).add({ x: 7 }));
  await measure("batch of 10 sets (one commit, one audit event)", { writes: 10, audit: 1 }, async () => {
    const b = db.batch();
    for (let i = 0; i < 10; i++) b.set(db.collection(C).doc(`batch${i}`), { i });
    await b.commit();
  });
  await measure("transaction get + update", { reads: 1, writes: 1, audit: 1 }, () => db.runTransaction(async (t) => {
    const s = await t.get(db.collection(C).doc("a"));
    t.update(db.collection(C).doc("a"), { x: (s.data().x || 0) + 1 });
  }));

  // count(): ceil(n / 1000) reads, minimum 1
  for (const [n, reads] of [[0, 1], [999, 1], [1000, 1], [1001, 2]]) {
    await clear();
    await seedCount(n);
    await measure(`count() of ${n} = ${reads} read(s)`, { reads }, () => db.collection(`${C}Count`).count().get());
  }

  // Transaction contention: two transactions read and write the same document; the loser retries,
  // and its reads are billed again (counted per attempt), its writes once.
  await rawDb().collection(C).doc("hot").set({ n: 0 });
  const contention = createContext({ kind: "script", name: "transaction contention" });
  await runInContext(contention, () => Promise.all([0, 1].map(() => db.runTransaction(async (t) => {
    const s = await t.get(db.collection(C).doc("hot"));
    await new Promise((r) => setTimeout(r, 150));
    t.update(db.collection(C).doc("hot"), { n: (s.data().n || 0) + 1 });
  }))));
  const final = (await rawDb().collection(C).doc("hot").get()).data().n;
  const retries = Number(contention.auditNotes.transactionRetries || 0);
  const retried = retries > 0;
  const want = { reads: 2 + retries, writes: 2 + 2 }; // two business writes + one audit event per committed transaction
  const got = { reads: contention.ops.total.reads, writes: contention.ops.total.writes };
  const shadow = { reads: contention.shadow.reads, writes: contention.shadow.writes };
  const ok = final === 2 && JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(shadow) === JSON.stringify(want);
  results.push({ label: "transaction contention", ok });
  console.log(`${ok ? "✓" : "✗"} transaction contention: retried ${retried} (${retries} retr${retries === 1 ? "y" : "ies"}, each re-reads), final value ${final}; expected ${JSON.stringify(want)} layer ${JSON.stringify(got)} shadow ${JSON.stringify(shadow)}`);
  if (!retried) console.log("  note: the emulator serialised the two transactions, so no retry happened (per-attempt counting not exercised)");

  // A redundant read: the same document read twice with no write in between.
  const twice = await measure("same document read twice", { reads: 2 }, async () => { await db.collection(C).doc("a").get(); await db.collection(C).doc("a").get(); });
  assert.equal(twice.redundantReads, 1, "the second read of an unchanged document is a redundant read");
  console.log("✓ redundantReads = 1 for the second read of an unchanged document");

  await clear();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nKnown-operations table: ${results.length - failed.length}/${results.length} as expected (layer and shadow).`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
