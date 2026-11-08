/**
 * Seed repeatability (Z-06): running the seed twice adds ZERO documents in any collection
 * (deterministic ids for structure and master data; idempotency keys for everything created
 * through the callables). The only expected growth is usage metering (usageCounterShards):
 * replayed callables are still counted as invocations. Also checks Super Admin isolation and
 * that the seed's own fail-closed data checks pass (exit code 0).
 */
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { db } = require("./helpers/auth-personas.cjs");

const METERING_ONLY = new Set(["usageCounterShards"]);

async function counts() {
  const out = {};
  for (const col of await db.listCollections()) out[col.id] = (await col.count().get()).data().count;
  out["organizations/*/branches"] = (await db.collectionGroup("branches").count().get()).data().count;
  out["users/*/devices"] = (await db.collectionGroup("devices").count().get()).data().count;
  return out;
}

function runSeed() {
  const r = spawnSync(process.execPath, [path.resolve(__dirname, "../lib/scripts/seed-emulator.js"), "--profile=api-explorer-demo"], { encoding: "utf8", env: process.env });
  assert.equal(r.status, 0, `seed failed (its fail-closed data checks included):\n${r.stdout}\n${r.stderr}`);
  return (r.stdout.match(/data check .*PASS/g) || []).length;
}

async function main() {
  enforceLocalEmulatorSafety();
  await verifyEmulatorHealth();
  console.log("=== SEED REPEATABILITY ===");
  const passes1 = runSeed();
  const first = await counts();
  const passes2 = runSeed();
  const second = await counts();
  assert.ok(passes1 >= 5 && passes2 === passes1, `seeded organizations passing data checks: ${passes1} then ${passes2}`);
  console.log(`✓ both runs exit 0; ${passes2} seeded organizations pass the data checks`);

  const grown = Object.keys(second).filter((k) => !METERING_ONLY.has(k) && second[k] !== first[k]);
  assert.deepEqual(grown.map((k) => `${k}: ${first[k]} → ${second[k]}`), [], "no collection may grow on a repeat seed");
  const total = (c) => Object.entries(c).filter(([k]) => !METERING_ONLY.has(k)).reduce((n, [, v]) => n + v, 0);
  console.log(`✓ second run added 0 documents across ${Object.keys(second).length} collections (${total(second)} documents; usage shards ${first.usageCounterShards || 0} → ${second.usageCounterShards || 0} are metering only)`);

  const { getAuth } = require("firebase-admin/auth");
  const superAdmin = await getAuth().getUserByEmail("superadmin@trado.local");
  const memberships = await db.collection("memberships").where("userId", "==", superAdmin.uid).get();
  assert.equal(memberships.size, 0, "Super Admin must have zero tenant memberships");
  console.log("✓ Super Admin has zero tenant memberships");
  console.log("[PASS] Seed repeatability verified.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[FAIL]", err);
  process.exit(1);
});
