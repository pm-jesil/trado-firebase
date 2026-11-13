#!/usr/bin/env node
/**
 * Trado Coverage Engine (D-20): computed ratios for invariants C-1 … C-10.
 *
 * Every denominator is derived by scripts/lib/source-truth.js from the code (exports, request
 * schemas, document types, collections, rules files). Every numerator comes from evidence a run
 * produced. Nothing is counted from a typed list:
 *
 *   evidence file                                   written by
 *   docs/generated/field-catalog.json               scripts/generate-field-catalog.js
 *   docs/generated/raw-field-census.json            functions/scripts/check-raw-field-census.cjs
 *   .local/traces/*.jsonl                           functions/scripts/helpers/callable-client.cjs (one file per unit)
 *   docs/audit/roundtrip-results.json               functions/scripts/test-maximal-payload-roundtrip.cjs
 *   docs/audit/schema-sweep-results.json            functions/scripts/test-schema-contract-sweep.cjs
 *   docs/generated/rules-coverage.json              functions/scripts/collect-rules-coverage.cjs
 *   scripts/coverage.config.json                    hand-kept registers (each entry carries a reason)
 *
 * Missing evidence is reported as "not run" and counts as uncovered.
 *
 * Usage: node scripts/coverage-engine.js [--strict] [--out <dir>]
 *   --strict   exit 1 when any invariant is below n/n
 *   --out      write coverage.json / coverage.md somewhere else (used by the seeded-defect test)
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const truth = require("./lib/source-truth.js");

const { ROOT } = truth;
const argv = process.argv.slice(2);
const outDir = argv.includes("--out") ? path.resolve(argv[argv.indexOf("--out") + 1]) : path.join(ROOT, "docs", "audit");
const TRACE_DIR = path.join(ROOT, ".local", "traces");

const readJson = (relPath) => {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : null;
};

const CONFIG = readJson("scripts/coverage.config.json") || {};
const register = (name) => CONFIG[name] || [];
const notes = [];

/** `a.*.b[]` style pattern against a concrete path; `*` is one segment. */
function pathMatches(pattern, candidate) {
  const p = pattern.split(".");
  const c = candidate.split(".");
  return p.length === c.length && p.every((seg, i) => seg === "*" || seg === c[i] || (seg.endsWith("[]") && seg.slice(0, -2) === "*" && c[i].endsWith("[]")));
}

function invariant(id, name, items, extra = {}) {
  const covered = items.filter((i) => i.covered);
  const exempt = items.filter((i) => !i.covered && i.exempt);
  const uncovered = items.filter((i) => !i.covered && !i.exempt).map((i) => (i.why ? `${i.id} (${i.why})` : i.id));
  const numerator = covered.length + exempt.length;
  return { id, name, numerator, denominator: items.length, ratio: `${numerator}/${items.length}`, coveredByEvidence: covered.length, coveredByRegister: exempt.length, registerEntries: exempt.map((i) => `${i.id} → ${i.exempt}`), uncovered, passed: items.length > 0 && uncovered.length === 0, ...extra };
}

// ---------------------------------------------------------------------------
// Evidence loaders
// ---------------------------------------------------------------------------

function loadTraces() {
  // Only traces written by units of the impact system count; "adhoc--" files come from scripts started by hand.
  const files = fs.existsSync(TRACE_DIR) ? fs.readdirSync(TRACE_DIR).filter((f) => f.endsWith(".jsonl") && !f.startsWith("adhoc--")) : [];
  const traces = [];
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(TRACE_DIR, file), "utf8").split("\n")) {
      if (line.trim()) traces.push(JSON.parse(line));
    }
  }
  if (!files.length) notes.push("Runtime traces: not run (.local/traces is empty). C-3, C-5, C-6 and C-10 have no runtime evidence.");
  return { traces, files: files.length };
}

function traceIndex(traces) {
  const by = new Map();
  for (const t of traces) {
    if (!by.has(t.callable)) by.set(t.callable, []);
    by.get(t.callable).push(t);
  }
  return by;
}

// ---------------------------------------------------------------------------
// C-1 Catalog
// ---------------------------------------------------------------------------

function computeC1() {
  const docTypes = truth.getDocTypes();
  const { mapped, collectionsWithoutType } = truth.mapCollectionsToDocTypes();
  const census = readJson("docs/generated/raw-field-census.json");
  const catalog = readJson("docs/generated/field-catalog.json");
  if (!census) notes.push("Raw field census: not run (docs/generated/raw-field-census.json missing). C-1 uses document types only.");
  const catalogPaths = new Map();
  for (const entity of (catalog && catalog.entities) || []) catalogPaths.set(entity.collection, new Set((entity.fields || []).map((f) => f.path)));

  const opaque = (leaf) => /unknown|\bany\b|\(recursive\)|^object$|Record<|\{\s*\[/.test(leaf.type);
  const items = [];
  const perCollection = [];
  for (const { collection, docType } of mapped) {
    const typed = docType ? docTypes[docType].leaves : [];
    const typedPaths = new Set(typed.map((l) => l.path));
    const censusPaths = census && census.collections[collection] ? Object.keys(census.collections[collection].paths) : [];
    const isTyped = (p) => typedPaths.has(p) || typed.some((l) => pathMatches(l.path, p) || (opaque(l) && (p.startsWith(`${l.path}.`) || p.startsWith(`${l.path}[]`) || pathMatches(l.path, p.split(".").slice(0, l.path.split(".").length).join(".")))));
    // A null / empty value stored at a container the type describes deeper (image: null, addresses: []) is typed.
    const emptyContainer = (p) => {
      const types = census.collections[collection].paths[p].types;
      const base = p.replace(/\[\]$/, "");
      return types.every((t) => t === "null" || t === "empty-array" || t === "empty-map") && typed.some((l) => l.path.startsWith(`${base}.`) || l.path.startsWith(`${base}[]`));
    };
    const all = new Set([...typedPaths, ...censusPaths.filter((p) => !isTyped(p) && !emptyContainer(p))]);
    const inCatalog = catalogPaths.get(collection) || new Set();
    const row = { collection, docType, storedLeafPaths: all.size, typed: typedPaths.size, censusOnly: 0, inCatalog: 0, systemManaged: 0, deferred: 0, missing: 0, censusDocs: census && census.collections[collection] ? census.collections[collection].docCount : null };
    for (const p of all) {
      const id = `${collection}:${p}`;
      const censusOnly = !typedPaths.has(p);
      if (censusOnly) row.censusOnly++;
      const system = register("systemManaged").find((e) => (e.collection === "*" || e.collection === collection) && pathMatches(e.path, p));
      const deferred = register("deferred").find((e) => e.collection === collection && pathMatches(e.path, p));
      if (!censusOnly && inCatalog.has(p)) { row.inCatalog++; items.push({ id, covered: true }); }
      else if (system) { row.systemManaged++; items.push({ id, exempt: `system-managed: ${system.reason}` }); }
      else if (deferred) { row.deferred++; items.push({ id, exempt: `deferred ${deferred.id}: ${deferred.reason}` }); }
      else { row.missing++; items.push({ id, why: censusOnly ? "stored in emulator data but in no document type" : "typed but absent from field-catalog.json" }); }
    }
    perCollection.push(row);
  }
  const described = ((catalog && catalog.entities) || []).reduce((acc, e) => { for (const f of e.fields || []) { acc.total++; if (f.description) acc.described++; } return acc; }, { total: 0, described: 0 });
  return invariant("C-1", "Catalog: stored leaf paths (types ∪ census) catalogued, system-managed or deferred", items, {
    perCollection, collectionsWithoutDocumentType: collectionsWithoutType, descriptions: `${described.described}/${described.total}`, censusRun: census ? census.runId : "not run",
  });
}

// ---------------------------------------------------------------------------
// C-2 Input persistence
// ---------------------------------------------------------------------------

function schemaLeaves(exp, schemas) {
  const leaves = new Map();
  const unresolved = [];
  for (const name of exp.schemas) {
    if (!schemas[name]) { unresolved.push(name); continue; }
    for (const leaf of schemas[name].leaves) if (!leaves.has(leaf.path)) leaves.set(leaf.path, leaf);
  }
  return { leaves: [...leaves.values()], unresolved };
}

function computeC2(exports, schemas) {
  const results = readJson("docs/audit/roundtrip-results.json");
  if (!results) notes.push("Maximal round-trip proof: not run (docs/audit/roundtrip-results.json missing). C-2 has no evidence.");
  const proven = (results && results.callables) || {};
  const items = [];
  const perCallable = [];
  for (const exp of exports.filter((e) => e.type === "callable" && (e.kind === "create" || e.kind === "update"))) {
    const { leaves, unresolved } = schemaLeaves(exp, schemas);
    const row = { callable: exp.name, kind: exp.kind, inputLeafPaths: leaves.length, proven: 0, notPersisted: 0, deferred: 0, unproven: 0 };
    for (const name of unresolved) items.push({ id: `${exp.name}:<schema ${name}>`, why: "request schema is not exported from validation/schemas.ts, leaf paths unknown" });
    const provenPaths = new Set((proven[exp.name] && proven[exp.name].proven) || []);
    for (const leaf of leaves) {
      const id = `${exp.name}:${leaf.path}`;
      const notPersisted = register("nonPersistedInputPaths").find((e) => (e.callable === "*" || e.callable === exp.name) && pathMatches(e.path, leaf.path));
      const deferred = register("deferred").find((e) => e.callable === exp.name && pathMatches(e.path, leaf.path));
      if (provenPaths.has(leaf.path)) { row.proven++; items.push({ id, covered: true }); }
      else if (notPersisted) { row.notPersisted++; items.push({ id, exempt: `not persisted: ${notPersisted.reason}` }); }
      else if (deferred) { row.deferred++; items.push({ id, exempt: `deferred ${deferred.id}: ${deferred.reason}` }); }
      else { row.unproven++; items.push({ id }); }
    }
    perCallable.push(row);
  }
  return invariant("C-2", "Input persistence: request leaf paths of create/update callables proven persisted (raw read-back)", items, { perCallable, roundtripRun: results ? results.runId : "not run" });
}

// ---------------------------------------------------------------------------
// C-3 Unknown keys
// ---------------------------------------------------------------------------

function computeC3(exports, schemas, byCallable) {
  const items = [];
  for (const exp of exports.filter((e) => e.type === "callable")) {
    const rejected = new Set();
    for (const t of byCallable.get(exp.name) || []) if (t.reason === "UNKNOWN_FIELD") for (const f of t.unknownFields || []) rejected.add(f);
    for (const name of exp.schemas) {
      if (!schemas[name]) { items.push({ id: `${exp.name}:<schema ${name}>`, why: "schema not resolvable, strictness unknown" }); continue; }
      for (const object of schemas[name].objects) {
        const where = object.path || "(top level)";
        if (!object.strict) { items.push({ id: `${exp.name}:${where}`, why: "object is not strict" }); continue; }
        // Object path segments; `*` (a record value) matches any one key of the rejected path.
        const want = object.path ? object.path.replace(/\[\]/g, "").split(".") : [];
        const hit = [...rejected].some((f) => {
          const segs = f.split(".").filter((seg) => !/^\d+$/.test(seg));
          return segs.length === want.length + 1 && want.every((w, i) => w === "*" || w === segs[i]);
        });
        items.push({ id: `${exp.name}:${where}`, covered: hit, why: hit ? undefined : "no runtime test sent an unknown key here and got UNKNOWN_FIELD" });
      }
    }
    for (const removed of register("removedFieldNames").filter((r) => r.callables.includes(exp.name))) {
      const hit = [...rejected].some((f) => f.split(".").pop() === removed.name);
      items.push({ id: `${exp.name}:removed name ${removed.name}`, covered: hit, why: hit ? undefined : "removed field name never sent and rejected by name" });
    }
  }
  return invariant("C-3", "Unknown keys: every request object is strict and rejected an unknown key at runtime (plus removed names)", items);
}

// ---------------------------------------------------------------------------
// C-4 Bounds and enums
// ---------------------------------------------------------------------------

function boundItems(leafOrArray, isArray) {
  const b = leafOrArray.bounds || {};
  const out = [];
  if (b.maxLength !== undefined) out.push("max", "max+1");
  if (b.minLength !== undefined && b.minLength > 0) out.push("min", "min-1");
  if (!isArray && b.max !== undefined) out.push("max", "max+1");
  if (!isArray && b.min !== undefined) out.push("min", "min-1");
  return [...new Set(out)];
}

function computeC4(exports, schemas) {
  const sweep = readJson("docs/audit/schema-sweep-results.json");
  if (!sweep) notes.push("Schema contract sweep: not run (docs/audit/schema-sweep-results.json missing). C-4 has no evidence.");
  const passed = new Set(((sweep && sweep.items) || []).filter((i) => i.pass).map((i) => i.id));
  const items = [];
  for (const exp of exports.filter((e) => e.type === "callable")) {
    for (const name of exp.schemas) {
      if (!schemas[name]) continue;
      for (const leaf of schemas[name].leaves) {
        for (const edge of boundItems(leaf, false)) items.push({ id: `${exp.name}:${leaf.path}:${edge}` });
        if (leaf.enumValues) {
          for (const value of leaf.enumValues) items.push({ id: `${exp.name}:${leaf.path}:enum=${value}` });
          items.push({ id: `${exp.name}:${leaf.path}:enum-invalid` });
        }
      }
      for (const array of schemas[name].arrays) for (const edge of boundItems(array, true)) items.push({ id: `${exp.name}:${array.path}[length]:${edge}` });
    }
  }
  for (const item of items) item.covered = passed.has(item.id);
  return invariant("C-4", "Bounds and enums: max / max+1 / min / min−1 per bounded leaf, every enum value and one invalid value", items, { sweepRun: sweep ? sweep.runId : "not run" });
}

// ---------------------------------------------------------------------------
// C-5 Responses
// ---------------------------------------------------------------------------

function openApiLeaves(schema, root, at, out, depth = 0) {
  if (!schema || depth > 10) return;
  if (schema.$ref) return openApiLeaves(schema.$ref.split("/").slice(1).reduce((o, k) => o && o[k], root), root, at, out, depth + 1);
  for (const key of ["allOf", "oneOf", "anyOf"]) if (schema[key]) { for (const s of schema[key]) openApiLeaves(s, root, at, out, depth + 1); return; }
  if (schema.type === "array" || schema.items) return openApiLeaves(schema.items, root, `${at}[]`, out, depth + 1);
  if (schema.properties || (schema.additionalProperties && typeof schema.additionalProperties === "object")) {
    for (const [k, v] of Object.entries(schema.properties || {})) openApiLeaves(v, root, at ? `${at}.${k}` : k, out, depth + 1);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") openApiLeaves(schema.additionalProperties, root, `${at}.*`, out, depth + 1);
    return;
  }
  if (at) out.set(at, { described: !!schema.description });
}

function computeC5(exports, byCallable) {
  const openApi = readJson("docs/openapi.json") || {};
  const items = [];
  const undocumented = [];
  for (const exp of exports.filter((e) => e.type === "callable")) {
    const op = (openApi.paths || {})[`/api/callables/${exp.name}`];
    const response = op && op.post && op.post.responses && op.post.responses["200"];
    const schema = response && response.content && response.content["application/json"] && response.content["application/json"].schema;
    const documented = new Map();
    openApiLeaves(schema, openApi, "", documented);
    const observed = new Set();
    for (const t of byCallable.get(exp.name) || []) if (t.outcome === "success") for (const p of t.responsePaths || []) observed.add(p);
    const strip = (p) => p.replace(/^result\./, "");
    const observedHas = (p) => [...observed].some((o) => o === strip(p) || pathMatches(strip(p), o));
    if (!documented.size) items.push({ id: `${exp.name}:<response>`, why: "no response leaf paths in docs/openapi.json" });
    for (const [p, meta] of documented) {
      const executed = observedHas(p);
      items.push({ id: `${exp.name}:${p}`, covered: meta.described && executed, why: !meta.described ? "no description" : executed ? undefined : "never present in a response of an executed test" });
    }
    // An empty array or a null object is recorded at its container path ("context.jobRoles[]",
    // "context.device"); it is documented when the container's leaves are.
    const coversContainer = (p, o) => strip(p).startsWith(`${o.replace(/\[\]$/, "")}.`) || strip(p).startsWith(`${o.replace(/\[\]$/, "")}[]`);
    for (const o of observed) if (![...documented.keys()].some((p) => strip(p) === o || pathMatches(strip(p), o) || coversContainer(p, o))) undocumented.push(`${exp.name}:${o}`);
  }
  return invariant("C-5", "Responses: documented response leaf paths with a description and an executed example", items, { returnedButUndocumented: undocumented.length, returnedButUndocumentedSample: undocumented.slice(0, 40) });
}

// ---------------------------------------------------------------------------
// C-6 Callables and triggers
// ---------------------------------------------------------------------------

const REASONS = {
  validation: ["INVALID_ARGUMENT", "UNKNOWN_FIELD"],
  role: ["PERMISSION_DENIED"],
  plan: ["SUBSCRIPTION_NOT_STARTED", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_SUSPENDED", "SUBSCRIPTION_CANCELLED", "MODULE_NOT_IN_PLAN"],
  tenant: ["TENANT_MISMATCH", "SUPER_ADMIN_TENANT_FORBIDDEN", "NO_MEMBERSHIP"],
};

function replayObserved(traces) {
  const byKey = new Map();
  for (const t of traces) {
    if (t.outcome !== "success" || !t.idempotencyKey) continue;
    const id = `${t.unit}|${t.idempotencyKey}|${t.payloadHash}`;
    byKey.set(id, (byKey.get(id) || 0) + (t.count || 1));
  }
  return [...byKey.values()].some((n) => n >= 2);
}

function computeC6(exports, byCallable) {
  const items = [];
  let traced = 0;
  for (const exp of exports) {
    const traces = byCallable.get(exp.name) || [];
    if (traces.length) traced++;
    if (exp.type === "trigger") {
      items.push({ id: `${exp.name}:executed`, covered: traces.some((t) => t.outcome === "trigger-observed"), why: "no trigger test recorded an observed effect" });
      continue;
    }
    const reasons = new Set(traces.filter((t) => t.outcome !== "success").map((t) => t.reason));
    const has = (list) => list.some((r) => reasons.has(r));
    items.push({ id: `${exp.name}:success`, covered: traces.some((t) => t.outcome === "success") });
    items.push({ id: `${exp.name}:validation-failure`, covered: has(REASONS.validation) });
    // Gating is read per handler (source-truth: resolveRequestContext reachable from the handler).
    // A platform handler (Super Admin only, no tenant context) has no plan or tenant to deny on.
    if (exp.superAdminOnly) items.push({ id: `${exp.name}:denied-non-super-admin`, covered: has([...REASONS.role, "FIELD_NOT_EDITABLE"]) });
    else if (exp.gated) {
      if (exp.permissioned) items.push({ id: `${exp.name}:denied-role`, covered: has(REASONS.role) });
      items.push({ id: `${exp.name}:denied-plan`, covered: has(REASONS.plan) });
      items.push({ id: `${exp.name}:tenant-isolation`, covered: has(REASONS.tenant) });
    }
    if (exp.kind === "create") items.push({ id: `${exp.name}:idempotent-replay`, covered: replayObserved(traces) });
  }
  const all = [...byCallable.values()].flat();
  items.push({ id: "layer:org-toggle (MODULE_DISABLED observed on any callable)", covered: all.some((t) => t.reason === "MODULE_DISABLED") });
  for (const item of items) {
    if (item.covered) continue;
    const inapplicable = register("inapplicableTestClasses").find((e) => e.id === item.id);
    if (inapplicable) item.exempt = `inapplicable: ${inapplicable.reason}`;
  }
  return invariant("C-6", "Exports: runtime-traced success, validation failure, role / plan denial, tenant isolation, idempotent replay; triggers executed", items, {
    exportsWithAtLeastOneTrace: `${traced}/${exports.length}`,
    notMeasured: ["membership-override denial per callable (the denial reason is PERMISSION_DENIED, indistinguishable from a role denial in a trace)", "org-toggle applicability per callable (measured once at layer level only)"],
  });
}

// ---------------------------------------------------------------------------
// C-7 Guard scope
// ---------------------------------------------------------------------------

function guardFiles() {
  const dirs = [path.join(ROOT, "scripts"), path.join(ROOT, "functions", "scripts")];
  return dirs.flatMap((d) => fs.readdirSync(d).filter((f) => /^check-.*\.(c?js)$/.test(f)).map((f) => path.join(d, f))).sort();
}

function computeC7() {
  const { collections } = truth.getCollections();
  const keys = collections.map((c) => c.key);
  const items = [];
  const guards = [];
  for (const abs of guardFiles()) {
    const src = fs.readFileSync(abs, "utf8");
    const tag = src.match(/@guard-scope:\s*(per-collection|files|artifacts)\b\s*(.*)/);
    const name = truth.rel(abs);
    if (!tag) { items.push({ id: `${name}:scope-declared`, why: "no `@guard-scope:` declaration" }); guards.push({ guard: name, scope: "undeclared" }); continue; }
    items.push({ id: `${name}:scope-declared`, covered: true });
    if (tag[1] !== "per-collection") { guards.push({ guard: name, scope: tag[1], detail: tag[2].trim() }); continue; }
    const scopeFile = readJson(`docs/generated/guard-scopes/${path.basename(abs).replace(/\.c?js$/, "")}.json`);
    const scanned = new Set((scopeFile && scopeFile.scanned) || []);
    const excluded = new Map(((scopeFile && scopeFile.excluded) || []).map((e) => [e.collection, e.reason]));
    guards.push({ guard: name, scope: "per-collection", scanned: scanned.size, excluded: excluded.size, exclusions: [...excluded].map(([c, r]) => `${c}: ${r}`), scopeRun: scopeFile ? scopeFile.runId : "not run" });
    for (const key of keys) {
      const id = `${name}:${key}`;
      if (scanned.has(key)) items.push({ id, covered: true });
      else if (excluded.has(key)) items.push({ id, exempt: `excluded: ${excluded.get(key)}` });
      else items.push({ id, why: scopeFile ? "collection neither scanned nor excluded" : "guard has not written its scope file (not run)" });
    }
  }
  return invariant("C-7", "Guard scope: every guard declares its scope; per-collection guards scan every collection or list the exclusion", items, { collections: keys.length, guards });
}

// ---------------------------------------------------------------------------
// C-8 Write-path typing
// ---------------------------------------------------------------------------

function computeC8() {
  const usages = truth.getAnyUsages();
  const byFile = new Map();
  for (const u of usages) byFile.set(u.file, [...(byFile.get(u.file) || []), u]);
  const items = truth.productionSourceFiles().map((abs) => {
    const file = truth.rel(abs);
    const hits = byFile.get(file) || [];
    return { id: file, covered: hits.length === 0, why: hits.map((h) => `${h.form} at line ${h.line}`).join("; ") };
  });
  const inv = invariant("C-8", "Write-path typing: production source files with zero `any` (annotation, cast or catch variable)", items, { anyCount: usages.length, anyUsages: usages.map((u) => `${u.file}:${u.line} [${u.form}] ${u.text}`) });
  inv.uncovered = usages.map((u) => `${u.file}:${u.line} [${u.form}] ${u.text}`);
  return inv;
}

// ---------------------------------------------------------------------------
// C-9 Rules
// ---------------------------------------------------------------------------

function computeC9() {
  const rules = truth.getRules();
  const coverage = readJson("docs/generated/rules-coverage.json");
  if (!coverage) notes.push("Rules coverage: not run (docs/generated/rules-coverage.json missing). C-9 has no evidence.");
  const items = [];
  for (const service of ["firestore", "storage"]) {
    const observed = (coverage && coverage[service]) || {};
    for (const allow of rules[service].allows) {
      const id = `${allow.file}:${allow.line} allow ${allow.operation} @ ${allow.matchPath.replace("/databases/{database}/documents", "") || "/"}`;
      const seen = observed[`${allow.line}:${allow.operation}`] || observed[String(allow.line)] || {};
      if (!allow.unconditionalDeny) items.push({ id: `${id} [allowed ≥ 1]`, covered: (seen.allowed || 0) > 0 });
      items.push({ id: `${id} [denied ≥ 1]`, covered: (seen.denied || 0) > 0 });
    }
  }
  return invariant("C-9", "Rules: every allow statement of both rules files evaluated to allow ≥ 1 and deny ≥ 1 (unconditional deny: deny ≥ 1)", items, {
    matchPaths: { firestore: rules.firestore.matches.length, storage: rules.storage.matches.length }, rulesCoverageRun: coverage ? coverage.runId : "not run",
  });
}

// ---------------------------------------------------------------------------
// C-10 Idempotency
// ---------------------------------------------------------------------------

function computeC10(exports, byCallable) {
  const items = exports.filter((e) => e.kind === "create").map((exp) => {
    const exemption = register("idempotencyExemptions").find((e) => e.callable === exp.name);
    const replay = replayObserved(byCallable.get(exp.name) || []);
    const why = !exp.idempotent ? `handler at ${exp.file}:${exp.line} never calls reserveIdempotency` : replay ? undefined : "reserveIdempotency is called, but no runtime replay (same key, same payload, two successes) was traced";
    return { id: exp.name, covered: exp.idempotent && replay, exempt: exemption ? `EXEMPT(${exemption.id}): ${exemption.reason}` : undefined, why };
  });
  return invariant("C-10", "Idempotency: every create callable reserves an idempotency record and replayed safely at runtime", items);
}

// ---------------------------------------------------------------------------
// Registry consistency (2.1)
// ---------------------------------------------------------------------------

function registryFindings(exports) {
  const cols = truth.getCollections();
  const mapping = truth.mapCollectionsToDocTypes();
  const findings = [];
  for (const m of cols.rulesNotInRegistry) findings.push(`${m.file}:${m.line} matches collection "${m.key}", which no source file reads or writes (rules ↔ registry mismatch)`);
  for (const c of mapping.collectionsWithoutType) findings.push(`collection "${c}" has no document interface in types/models.ts`);
  for (const t of mapping.typesWithoutCollection) findings.push(`document interface ${t} maps to no collection`);
  for (const e of exports.filter((x) => x.type === "unknown")) findings.push(`export ${e.name} is neither an onCall callable nor a trigger factory call`);
  for (const e of exports.filter((x) => x.kind === "action")) findings.push(`callable ${e.name} matched no kind rule (tagged "action")`);
  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const exports = truth.getExports();
  const schemas = truth.getRequestSchemas();
  const { traces, files: traceFiles } = loadTraces();
  const byCallable = traceIndex(traces);
  const list = [computeC1(), computeC2(exports, schemas), computeC3(exports, schemas, byCallable), computeC4(exports, schemas), computeC5(exports, byCallable), computeC6(exports, byCallable), computeC7(), computeC8(), computeC9(), computeC10(exports, byCallable)];
  const invariants = Object.fromEntries(list.map((i) => [i.id, i]));
  const kinds = exports.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {});
  const sources = {
    exports: exports.length, callables: exports.filter((e) => e.type === "callable").length, triggers: exports.filter((e) => e.type === "trigger").length, kinds,
    requestSchemas: Object.keys(schemas).length, documentTypes: Object.keys(truth.getDocTypes()).length, collections: truth.getCollections().collections.length,
    traceFiles, traces: traces.reduce((n, t) => n + (t.count || 1), 0),
  };
  const report = { runId: `cov-${crypto.randomBytes(4).toString("hex")}`, timestamp: new Date().toISOString(), allPassed: list.every((i) => i.passed), sources, registryFindings: registryFindings(exports), notes, invariants };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "coverage.json"), `${JSON.stringify(report, null, 2)}\n`);

  const summary = ["| ID | Invariant | Ratio | By evidence | By register | Uncovered |", "|---|---|---|---|---|---|"];
  for (const inv of list) summary.push(`| ${inv.id} | ${inv.name} | ${inv.ratio} | ${inv.coveredByEvidence} | ${inv.coveredByRegister} | ${inv.uncovered.length} |`);
  const md = [
    "# Computed coverage", "",
    `Run id \`${report.runId}\` at ${report.timestamp}. Generated by \`scripts/coverage-engine.js\`; do not edit.`, "",
    `Sources of truth: ${sources.exports} exports (${sources.callables} callables, ${sources.triggers} triggers; kinds ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ")}), ${sources.requestSchemas} request schemas, ${sources.documentTypes} document types, ${sources.collections} collections, ${sources.traces} traced calls in ${sources.traceFiles} unit trace files.`, "",
    "## Summary", "", ...summary, "",
    "## Evidence not available in this run", "", ...(notes.length ? notes.map((n) => `- ${n}`) : ["- none"]), "",
    "## Registry findings", "", ...(report.registryFindings.length ? report.registryFindings.map((f) => `- ${f}`) : ["- none"]), "",
  ];
  for (const inv of list) {
    md.push(`## ${inv.id} ${inv.name}`, "", `Ratio ${inv.ratio}; ${inv.uncovered.length} uncovered; ${inv.coveredByRegister} covered by a register entry.`, "");
    if (inv.uncovered.length) md.push(`First ${Math.min(40, inv.uncovered.length)} of ${inv.uncovered.length} uncovered (full list in coverage.json):`, "", ...inv.uncovered.slice(0, 40).map((u) => `- ${u}`), "");
  }
  fs.writeFileSync(path.join(outDir, "coverage.md"), `${md.join("\n")}\n`);

  console.log(`Coverage run ${report.runId}`);
  console.log(summary.join("\n"));
  for (const n of notes) console.log(`NOTE: ${n}`);
  console.log(`Registry findings: ${report.registryFindings.length}`);
  console.log(`Written: ${truth.rel(path.join(outDir, "coverage.json"))}, ${truth.rel(path.join(outDir, "coverage.md"))}`);
  if (argv.includes("--strict") && !report.allPassed) process.exit(1);
}

main();
