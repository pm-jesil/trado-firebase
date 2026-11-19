/**
 * Schema contract sweep (prompt 65, C-3 and C-4). Generated from the request schemas; nothing is typed.
 *
 * Part A — bounds and enums (C-4), against the compiled Zod schema each callable parses with
 *   (`parseInput(<Schema>, request.data)` is the only input path of a callable; check-gate-conformance
 *   enforces that). From a generated maximal valid payload, every bounded leaf is set to max / max+1
 *   (min / min−1 where min > 0), every array to its max length / max+1, every enum to each value and to
 *   one invalid value. "Rejected" means a validation issue at exactly that path.
 *   Written to docs/audit/schema-sweep-results.json; items the generator could not place in a valid
 *   payload are listed as untestable with the reason (they stay uncovered in C-4).
 *
 * Part B — unknown keys (C-3), at runtime through the emulator: for every callable and every object
 *   node of its request schema, a payload carrying an unknown key at that node; for every removed field
 *   name in scripts/coverage.config.json, a payload carrying that name. The expected answer is
 *   `UNKNOWN_FIELD` with the path; the callable client records the rejected paths as trace evidence.
 *
 * Usage: node scripts/test-schema-contract-sweep.cjs [--schema-only]
 */
const fs = require("node:fs");
const path = require("node:path");
const truth = require("../../scripts/lib/source-truth.js");

const ROOT = truth.ROOT;
const OUT = path.join(ROOT, "docs", "audit", "schema-sweep-results.json");
const schemas = require(path.join(ROOT, "functions", "lib", "validation", "schemas.js"));

const { gen, safe, validBase, removeAt, setAt, subSchema } = require("./helpers/schema-payloads.cjs");

const samePath = (issuePath, concrete) => issuePath.length >= concrete.length && concrete.every((k, i) => String(issuePath[i]) === String(k));

// ---------------------------------------------------------------------------
// Part A
// ---------------------------------------------------------------------------

function boundCases(leaf) {
  const b = leaf.bounds || {};
  const cases = [];
  const plain = (n) => "abcdefghij".repeat(Math.ceil((n + 1) / 10)).slice(0, n);
  const str = /email/i.test(leaf.path) ? (n) => (n >= 14 ? `${"a".repeat(n - 12)}@example.com` : plain(n)) : plain;
  if (leaf.type === "string" || leaf.type.includes("string")) {
    if (b.maxLength !== undefined) cases.push(["max", str(b.maxLength), true], ["max+1", str(b.maxLength + 1), false]);
    if (b.minLength) cases.push(["min", str(b.minLength), true], ["min-1", str(b.minLength - 1), false]);
  }
  if (leaf.type === "number" || leaf.type === "int") {
    const step = b.format && /int/.test(b.format) ? 1 : 0.5;
    if (b.max !== undefined) cases.push(["max", b.maxInclusive === false ? b.max - step : b.max, true], ["max+1", b.maxInclusive === false ? b.max : b.max + step, false]);
    if (b.min !== undefined) cases.push(["min", b.minInclusive === false ? b.min + step : b.min, true], ["min-1", b.minInclusive === false ? b.min : b.min - step, false]);
  }
  return cases;
}

function partA(exportsList) {
  const items = [];
  const untestable = [];
  for (const exp of exportsList) {
    for (const name of exp.schemas) {
      const schema = schemas[name];
      const shape = truth.getRequestSchemas()[name];
      if (!schema || !shape) continue;
      const base = validBase(schema);
      const test = (id, schemaPath, value, expectAccept, isArrayLength) => {
        if (!base.ok) { untestable.push({ id, reason: `no valid generated payload (${base.issue})` }); return; }
        // A cross-field rule may depend on a sibling enum (routingType ↔ routingCode, partyType ↔ legalName):
        // try the case with each value of each sibling enum before calling it untestable.
        const parent = schemaPath.includes(".") ? schemaPath.replace(/.[^.]+$/, "") : "";
        const siblings = shape.leaves.filter((l) => l.enumValues && l.path !== schemaPath && (parent ? l.path.startsWith(`${parent}.`) : !l.path.includes(".")) && l.path.split(".").length === schemaPath.split(".").length);
        const variants = [null, ...siblings.flatMap((l) => l.enumValues.map((ev) => [l.path, ev]))];
        const before = untestable.length;
        for (const variant of variants) {
          untestable.length = before;
          const n = items.length;
          runCase(id, schemaPath, value, expectAccept, isArrayLength, variant);
          if (items.length > n) return;
        }
        // Or an optional sibling that only applies to another variant (legalName for a person): leave it out.
        const blocker = untestable.length > before && untestable[untestable.length - 1].reason.match(/trips another rule: ([^:]+):/);
        const blockerPath = blocker && blocker[1].replace(/\.\d+\./g, "[].").replace(/\.\d+$/, "[]");
        if (blockerPath && blockerPath !== schemaPath && shape.leaves.some((l) => l.path === blockerPath && !l.required)) {
          untestable.length = before;
          const n = items.length;
          runCase(id, schemaPath, value, expectAccept, isArrayLength, null, blockerPath);
          if (items.length > n) return;
        }
      };
      const runCase = (id, schemaPath, value, expectAccept, isArrayLength, variant, omitPath) => {
        const v = structuredClone(base.value);
        if (variant) setAt(v, variant[0], variant[1], schema);
        if (omitPath) removeAt(v, omitPath.split(".").flatMap((x) => (x.endsWith("[]") ? [x.slice(0, -2), 0] : [x])));
        let concrete;
        if (isArrayLength) {
          const segs = schemaPath.split(".").flatMap((s) => (s.endsWith("[]") ? [s.slice(0, -2), 0] : [s]));
          const existing = segs.reduce((o, k) => (o == null ? o : o[k]), v);
          const elem = Array.isArray(existing) && existing.length ? existing[0] : gen(subSchema(schema, [...segs, 0]));
          concrete = setAt(v, schemaPath, Array.from({ length: value }, () => structuredClone(elem)), schema);
        } else concrete = setAt(v, schemaPath, value, schema);
        const r = safe(schema, v);
        // Pass/fail is decided by issues about this constraint at this path; anything else (a format or a
        // cross-field rule the generated value trips) makes the case untestable, never a pass.
        const isEnum = /:enum/.test(id);
        const relevant = (i) => samePath(i.path, concrete) && (isEnum ? i.code === "invalid_value" : ["too_big", "too_small"].includes(i.code));
        const issues = r.success ? [] : r.error.issues;
        // A rule of the enclosing object that names this same field ("a non-catalog line needs itemName")
        // is part of the same rejection, provided the bound itself was reported at the field's path.
        const sameField = (i) => i.code === "custom" && samePath(concrete, i.path) && i.message.includes(String(concrete[concrete.length - 1])) && issues.some(relevant);
        if (issues.some((i) => !relevant(i) && !sameField(i))) { untestable.push({ id, reason: `value trips another rule: ${issues.filter((i) => !relevant(i)).slice(0, 2).map((i) => `${i.path.join(".")}: ${i.code} ${i.message}`).join("; ")}` }); return; }
        const pass = expectAccept ? r.success : issues.some(relevant);
        items.push({ id, pass, detail: pass ? undefined : r.success ? "accepted, expected rejection" : r.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      };
      for (const leaf of shape.leaves) {
        for (const [edge, value, accept] of boundCases(leaf)) test(`${exp.name}:${leaf.path}:${edge}`, leaf.path, value, accept);
        if (leaf.enumValues) {
          for (const value of leaf.enumValues) test(`${exp.name}:${leaf.path}:enum=${value}`, leaf.path, value, true);
          test(`${exp.name}:${leaf.path}:enum-invalid`, leaf.path, "__not_an_enum_value__", false);
        }
      }
      for (const arr of shape.arrays) {
        const b = arr.bounds || {};
        if (b.maxLength !== undefined) { test(`${exp.name}:${arr.path}[length]:max`, arr.path, b.maxLength, true, true); test(`${exp.name}:${arr.path}[length]:max+1`, arr.path, b.maxLength + 1, false, true); }
        if (b.minLength) { test(`${exp.name}:${arr.path}[length]:min`, arr.path, b.minLength, true, true); test(`${exp.name}:${arr.path}[length]:min-1`, arr.path, b.minLength - 1, false, true); }
      }
    }
  }
  return { items, untestable };
}

// ---------------------------------------------------------------------------
// Part B (runtime)
// ---------------------------------------------------------------------------

function probePayload(objectPath, key) {
  if (!objectPath) return { [key]: "probe" };
  const segs = objectPath.split(".");
  const root = {};
  let cur = root;
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    const isArr = s.endsWith("[]");
    const name = isArr ? s.slice(0, -2) : s;
    const inner = last ? { [key]: "probe" } : {};
    if (name === "*") { cur.k1 = inner; cur = inner; return; }
    cur[name] = isArr ? [inner] : inner;
    cur = inner;
  });
  return root;
}

async function partB(exportsList) {
  const { callFunction } = require("./helpers/callable-client.cjs");
  const { getSuperAdminPersona, createTenantOwnerPersona } = require("./helpers/auth-personas.cjs");
  const { verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
  await verifyEmulatorHealth();
  const sa = await getSuperAdminPersona();
  const owner = await createTenantOwnerPersona(sa.idToken, "SchemaSweep");
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "coverage.config.json"), "utf8"));
  const tally = { sent: 0, unknownField: 0, other: {} };
  const send = async (exp, payload) => {
    tally.sent++;
    for (const token of [owner.idToken, sa.idToken]) {
      try {
        await callFunction(exp.name, { ...payload, ...(token === owner.idToken && !("organizationId" in payload) ? {} : {}) }, token, 5000);
        tally.other.accepted = (tally.other.accepted || 0) + 1;
        return;
      } catch (e) {
        const reason = (e.details && e.details.reason) || e.code;
        if (reason === "UNKNOWN_FIELD") { tally.unknownField++; return; }
        if (token === sa.idToken) { tally.other[reason] = (tally.other[reason] || 0) + 1; return; }
      }
    }
  };
  const callables = exportsList.filter((e) => e.type === "callable");
  for (const exp of callables) {
    for (const name of exp.schemas) {
      const shape = truth.getRequestSchemas()[name];
      if (!shape) continue;
      for (const obj of shape.objects) await send(exp, probePayload(obj.path, "__unknownProbe"));
    }
    for (const removed of (config.removedFieldNames || []).filter((r) => r.callables.includes(exp.name))) {
      const parent = removed.path ? removed.path.replace(/\.[^.]+$/, "") : "";
      await send(exp, probePayload(parent === removed.path ? "" : parent, removed.name));
    }
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Part C — idempotent replay of every create callable (C-10), at runtime
// ---------------------------------------------------------------------------

/** Required fields only (the smallest valid payload the schema allows), or null when none parses. */
function minimalPayload(schema) {
  const strip = (node, value) => {
    const def = node && node.def;
    if (!def || value === undefined) return value;
    if (["optional", "default", "prefault", "nullable", "readonly", "nonoptional", "catch"].includes(def.type)) return strip(def.innerType, value);
    if (def.type === "pipe") return strip(def.in, value);
    if (def.type === "object" && value && typeof value === "object") {
      const out = {};
      for (const [k, child] of Object.entries(def.shape)) {
        const optional = child.def && ["optional", "default", "prefault"].includes(child.def.type);
        if (!optional && value[k] !== undefined) out[k] = strip(child, value[k]);
      }
      return out;
    }
    return value;
  };
  const base = validBase(schema);
  if (!base.ok) return null;
  const minimal = strip(schema, base.value);
  return safe(schema, minimal).success ? minimal : base.value;
}

async function partC(exportsList) {
  const { callFunction } = require("./helpers/callable-client.cjs");
  const { getSuperAdminPersona, createTenantOwnerPersona } = require("./helpers/auth-personas.cjs");
  const sa = await getSuperAdminPersona();
  const owner = await createTenantOwnerPersona(sa.idToken, "ReplaySweep");
  const rows = [];
  for (const exp of exportsList.filter((e) => e.kind === "create")) {
    const schema = schemas[exp.schemas[0]];
    const payload = schema ? minimalPayload(schema) : null;
    if (!payload) { rows.push(`${exp.name}: no valid generated payload`); continue; }
    if ("organizationId" in (schema.def.shape || {})) payload.organizationId = owner.organizationId;
    payload.idempotencyKey = `replay-${exp.name}-${Date.now().toString(36)}`;
    let outcome = "";
    const isSuperAdminOnly = exp.name === "plansCreate" || exp.name === "organizationsCreate";
    const tokens = isSuperAdminOnly ? [sa.idToken] : [owner.idToken];
    for (const token of tokens) {
      try {
        const first = await callFunction(exp.name, payload, token, 5000);
        const second = await callFunction(exp.name, payload, token, 5000);
        const same = JSON.stringify(first) === JSON.stringify(second);
        let conflict = "not rejected";
        try { await callFunction(exp.name, { ...payload, ...(payload.name ? { name: `${payload.name}x` } : { notes: "changed" }) }, token, 5000); } catch (e) { conflict = `rejected (${(e.details && e.details.reason) || e.code})`; }
        outcome = `replay ${same ? "returned the same result" : "returned a DIFFERENT result"}; changed payload under the same key ${conflict}`;
        break;
      } catch (e) {
        outcome = `first call failed: ${(e.details && e.details.reason) || e.code} ${String(e.message).slice(0, 100)}`;
      }
    }
    rows.push(`${exp.name}: ${outcome}`);
  }
  return rows;
}

(async () => {
  const exportsList = truth.getExports().filter((e) => e.type === "callable");
  const a = partA(exportsList);
  const failed = a.items.filter((i) => !i.pass);
  fs.writeFileSync(OUT, `${JSON.stringify({ runId: `sweep-${Date.now().toString(36)}`, generatedAt: new Date().toISOString(), items: a.items, untestable: a.untestable }, null, 1)}\n`);
  console.log(`Part A (bounds and enums, schema level): ${a.items.length} cases run, ${a.items.length - failed.length} as expected, ${failed.length} not as expected; ${a.untestable.length} untestable (generator) → ${truth.rel(OUT)}`);
  for (const f of failed.slice(0, 40)) console.log(`  NOT AS EXPECTED ${f.id}: ${f.detail}`);
  const reasons = {};
  for (const u of a.untestable) { const k = u.reason.replace(/\(.*$|:.*$/, "").trim(); reasons[k] = (reasons[k] || 0) + 1; }
  console.log(`  untestable by reason: ${JSON.stringify(reasons)}`);
  if (!process.argv.includes("--schema-only")) {
    const b = await partB(exportsList);
    console.log(`Part B (unknown keys and removed names, runtime): ${b.sent} probes, ${b.unknownField} rejected with UNKNOWN_FIELD; other outcomes ${JSON.stringify(b.other)}`);
    const c = await partC(exportsList);
    console.log(`Part C (idempotent replay of create callables, runtime):\n  ${c.join("\n  ")}`);
  }
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
