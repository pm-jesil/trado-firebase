/**
 * check:raw-field-census — what is actually stored, for every collection derived from source.
 * @guard-scope: per-collection
 *
 * Reads every document of every collection in the emulator and writes the leaf paths found
 * (with value types and document counts) to docs/generated/raw-field-census.json. The Coverage
 * Engine (C-1) compares those paths with the document types; this guard itself fails only when a
 * removed field name (scripts/coverage.config.json → removedFieldNames) is still stored.
 *
 * Run it after the suites and the maximal round-trip proof, so the data is as wide as the tests make it.
 * Usage: node functions/scripts/check-raw-field-census.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { db, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const truth = require("../../scripts/lib/source-truth.js");
const { writeGuardScope } = require("../../scripts/lib/guard-scope.js");

const OUT = path.join(truth.ROOT, "docs", "generated", "raw-field-census.json");
const config = JSON.parse(fs.readFileSync(path.join(truth.ROOT, "scripts", "coverage.config.json"), "utf8"));

function valueType(value) {
  if (value === null) return "null";
  if (value && typeof value.toDate === "function") return "timestamp";
  if (value && value.constructor && value.constructor.name === "GeoPoint") return "geopoint";
  if (value && value.constructor && value.constructor.name === "DocumentReference") return "reference";
  return typeof value;
}

function collect(value, at, out) {
  if (Array.isArray(value)) {
    if (!value.length) return out.push([`${at}[]`, "empty-array"]);
    for (const item of value) collect(item, `${at}[]`, out);
  } else if (value && typeof value === "object" && valueType(value) === "object") {
    const keys = Object.keys(value);
    if (!keys.length && at) return out.push([at, "empty-map"]);
    for (const key of keys) collect(value[key], at ? `${at}.${key}` : key, out);
  } else if (at) out.push([at, valueType(value)]);
  return out;
}

async function main() {
  await verifyEmulatorHealth();
  const { collections } = truth.getCollections();
  // A removed name matches the stored top-level field of that name in the collections of its callables,
  // or the register's own path (bankAccounts[].branchName);
  // the same name nested elsewhere (billToSnapshot.billingAddress, contact.contactPerson, financialAccounts.bankDetails) is a different, typed field.
  const removedEntries = (config.removedFieldNames || []).map((r) => {
    const p = r.path || r.name;
    const targetCols = (r.callables || []).map((c) => {
      const match = c.match(/^(organizations|products|customers|vendors|users)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    return { path: p, collections: new Set(targetCols) };
  });
  const census = {};
  const stillStored = [];
  for (const col of collections) {
    const removedForCol = new Set(
      removedEntries
        .filter((r) => r.collections.size === 0 || r.collections.has(col.name) || r.collections.has(col.key))
        .map((r) => r.path)
    );
    const snap = await (col.parent ? db.collectionGroup(col.name) : db.collection(col.name)).get();
    const paths = {};
    for (const doc of snap.docs) {
      const seen = new Set();
      for (const [p, type] of collect(doc.data(), "", [])) {
        const entry = (paths[p] = paths[p] || { documents: 0, types: [] });
        if (!entry.types.includes(type)) entry.types.push(type);
        if (!seen.has(p)) { seen.add(p); entry.documents++; }
        const removedHere = [...removedForCol].some((r) => p === r || p.startsWith(`${r}.`) || p.startsWith(`${r}[]`));
        if (removedHere && stillStored.length < 50) stillStored.push(`${doc.ref.path} → ${p}`);
      }
    }
    census[col.key] = { docCount: snap.size, leafPaths: Object.keys(paths).length, paths };
    console.log(`  ${col.key.padEnd(28)} ${String(snap.size).padStart(6)} docs  ${String(Object.keys(paths).length).padStart(4)} leaf paths`);
  }
  const totals = Object.values(census).reduce((acc, c) => ({ docs: acc.docs + c.docCount, paths: acc.paths + c.leafPaths }), { docs: 0, paths: 0 });
  fs.writeFileSync(OUT, `${JSON.stringify({ runId: `census-${Date.now().toString(36)}`, generatedAt: new Date().toISOString(), project: process.env.GCLOUD_PROJECT, totals, collections: census }, null, 2)}\n`);
  console.log(`Census: ${collections.length} collections, ${totals.docs} documents, ${totals.paths} leaf paths → ${truth.rel(OUT)}`);
  const empty = Object.entries(census).filter(([, c]) => c.docCount === 0).map(([k]) => k);
  if (empty.length) console.log(`Collections with no documents (their stored shape is unobserved): ${empty.length} — ${empty.join(", ")}`);
  writeGuardScope(__filename, collections.map((c) => c.key), []);
  if (stillStored.length) {
    console.error(`[FAIL] removed field names still stored (${stillStored.length} shown):\n  ${stillStored.join("\n  ")}`);
    process.exit(1);
  }
  console.log("PASS — no removed field name is stored.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
