#!/usr/bin/env node
/**
 * @guard-scope: artifacts firestore.indexes.json against the query shapes executed by the emulator suites
 *
 * Index guard (prompt 66 P-12, §6.7). The emulator never enforces composite indexes: a query whose
 * index is missing works in every test and fails only in production. The counting layer records each
 * distinct query shape the suites execute (.local/query-shapes.jsonl, emulator only); this guard derives
 * the composite index each shape needs and compares it with firestore.indexes.json.
 *
 * A shape needs a composite index when it combines an equality filter (==, in, array-contains[-any])
 * with an inequality or order on another field, or orders / ranges on two or more fields. Equality-only
 * shapes are served by Firestore's single-field indexes. Coverage is what the suites ran: a query never
 * executed in a test is not checked (stated in the output).
 *
 *   node scripts/check-firestore-indexes.js           fail on a missing index (prints the JSON to add)
 *   node scripts/check-firestore-indexes.js --fix     add the missing indexes to firestore.indexes.json
 *   node scripts/check-firestore-indexes.js --test    seeded shapes: one needs an index, one does not
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SHAPES = path.join(ROOT, ".local", "query-shapes.jsonl");
const INDEXES = path.join(ROOT, "firestore.indexes.json");
const EQUALITY = new Set(["==", "in", "array-contains", "array-contains-any"]);
const INEQUALITY = new Set(["<", "<=", ">", ">=", "!=", "not-in"]);

/** The composite index a shape needs, or null: equality fields first, then ordered fields (Firestore). */
function requiredIndex(shape) {
  const eq = []; const ordered = [];
  for (const c of shape.clauses) {
    if (EQUALITY.has(c.op)) { if (!eq.some((e) => e.field === c.field)) eq.push(c); continue; }
    const order = c.op === "order:desc" ? "DESCENDING" : "ASCENDING";
    const existing = ordered.find((o) => o.field === c.field);
    if (existing) { if (c.op.startsWith("order:")) existing.order = order; } else ordered.push({ field: c.field, order });
  }
  const eqOnly = eq.filter((e) => !ordered.some((o) => o.field === e.field));
  const needs = (eqOnly.length >= 1 && ordered.length >= 1) || ordered.length >= 2 || (eqOnly.some((e) => e.op.startsWith("array-contains")) && eqOnly.length >= 2);
  if (!needs) return null;
  const eqFields = eqOnly.map((e) => (e.op.startsWith("array-contains") ? { fieldPath: e.field, arrayConfig: "CONTAINS" } : { fieldPath: e.field, order: "ASCENDING" }));
  const orderedFields = ordered.map((o) => ({ fieldPath: o.field, order: o.order }));
  return { collectionGroup: shape.collectionGroup, queryScope: shape.group ? "COLLECTION_GROUP" : "COLLECTION", fields: [...eqFields, ...orderedFields], eqCount: eqFields.length };
}

/** A declared index serves the need: same group and scope, its first fields are the equality fields (any order), then the ordered fields in order and direction. */
function serves(have, need) {
  if (have.collectionGroup !== need.collectionGroup || (have.queryScope || "COLLECTION") !== need.queryScope) return false;
  const hf = have.fields || [];
  const key = (x) => `${x.fieldPath}|${x.arrayConfig || "value"}`;
  const head = (list) => list.slice(0, need.eqCount).map(key).sort();
  if (JSON.stringify(head(hf)) !== JSON.stringify(head(need.fields))) return false;
  return need.fields.slice(need.eqCount).every((f, i) => { const h = hf[need.eqCount + i]; return !!h && h.fieldPath === f.fieldPath && h.order === f.order; });
}

function analyse(shapes, indexes) {
  const missing = [];
  const seen = new Set();
  for (const shape of shapes) {
    const need = requiredIndex(shape);
    if (!need) continue;
    const k = JSON.stringify([need.collectionGroup, need.queryScope, need.fields]);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!indexes.some((have) => serves(have, need))) missing.push({ need, source: shape.source });
  }
  return missing;
}
const clean = ({ collectionGroup, queryScope, fields }) => ({ collectionGroup, queryScope, fields });

if (process.argv.includes("--test")) {
  const shapes = [
    { collectionGroup: "auditLogs", group: false, clauses: [{ field: "organizationId", op: "==" }, { field: "occurredAt", op: "order:desc" }], source: "probe" },
    { collectionGroup: "customers", group: false, clauses: [{ field: "organizationId", op: "==" }, { field: "status", op: "==" }], source: "probe" },
  ];
  const missing = analyse(shapes, []);
  const ok = missing.length === 1 && missing[0].need.collectionGroup === "auditLogs" && analyse(shapes, [clean(missing[0].need)]).length === 0;
  console.log(`${ok ? "✓" : "✗"} check-firestore-indexes --test: equality + order needs an index, equality-only does not, and the derived index satisfies its shape`);
  process.exit(ok ? 0 : 1);
}

if (!fs.existsSync(SHAPES)) {
  console.error("[FAIL] check-firestore-indexes: no executed query shapes (.local/query-shapes.jsonl): run the emulator suites first (not run).");
  process.exit(1);
}
const shapes = fs.readFileSync(SHAPES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const file = JSON.parse(fs.readFileSync(INDEXES, "utf8"));
const missing = analyse(shapes, file.indexes || []);
const groups = new Set(shapes.map((s) => s.collectionGroup));
if (process.argv.includes("--fix") && missing.length) {
  file.indexes = [...(file.indexes || []), ...missing.map((m) => clean(m.need))];
  fs.writeFileSync(INDEXES, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Added ${missing.length} composite index(es) to firestore.indexes.json`);
  process.exit(0);
}
console.log(`check-firestore-indexes: ${shapes.length} distinct query shapes executed on ${groups.size} collections; ${(file.indexes || []).length} composite indexes declared; missing ${missing.length}. Only shapes the suites executed are checked.`);
for (const m of missing) console.log(`  MISSING for ${m.source}: ${JSON.stringify(clean(m.need))}`);
process.exit(missing.length ? 1 : 0);
