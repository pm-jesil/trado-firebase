#!/usr/bin/env node
/**
 * Trado Change-Impact Test System (prompt 65, Part 4).
 *
 *   node scripts/verify-impact.js plan [--paranoid]      what would run and why; runs nothing
 *   node scripts/verify-impact.js changed                run the plan + canaries, update the baseline
 *   node scripts/verify-impact.js full [--provisional]   run every unit, reset the baseline
 *   node scripts/verify-impact.js explain <unit>         closure of a unit, with where each file came from
 *   node scripts/verify-impact.js status                 baseline age, environment, stale / untraced / unmapped
 *
 * Units are enumerated from functions/package.json scripts, the guard scripts and the test folders.
 * A unit's input closure = static imports (TypeScript pre-processor) ∪ files its processes read or
 * loaded (scripts/lib/fs-trace-hook.js, lib/** mapped back to src/**) ∪ the source closure of every
 * callable it invoked (.local/traces) and of every trigger ∪ declared emulator inputs ∪ global
 * invalidators. A unit without traces from its last run is UNTRACED and depends on every file.
 * Change detection hashes content (line endings normalised); git is never consulted.
 */

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const FUNCTIONS = path.join(ROOT, "functions");
const LOCAL = path.join(ROOT, ".local");
const BASELINE_FILE = path.join(LOCAL, "verification-baseline.json");
const RUNS_DIR = path.join(LOCAL, "verification-runs");
const HASH_CACHE_FILE = path.join(LOCAL, "hash-cache.json");
const CONFIG_FILE = path.join(ROOT, "verify", "impact.config.json");
const HOOK = path.join(__dirname, "lib", "fs-trace-hook.js").replace(/\\/g, "/");
const ts = require(path.join(FUNCTIONS, "node_modules", "typescript"));

const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, "/");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const readJson = (abs, fallback) => { try { return JSON.parse(fs.readFileSync(abs, "utf8")); } catch (e) { return fallback; } };
let configCache = null;
const config = () => {
  if (!configCache) {
    configCache = readJson(CONFIG_FILE, null);
    if (!configCache) throw new Error(`missing or invalid ${rel(CONFIG_FILE)}`);
  }
  return configCache;
};

// ---------------------------------------------------------------------------
// Files, ignore rules and content hashes
// ---------------------------------------------------------------------------

function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

let ignoreCache = null;
function ignoreRules() {
  if (!ignoreCache) ignoreCache = config().ignored.map((e) => ({ ...e, re: globToRegex(e.glob) }));
  return ignoreCache;
}
const isIgnored = (file) => ignoreRules().some((r) => r.re.test(file));
/** A directory whose every descendant is ignored (e.g. node_modules) is not walked. */
const dirIgnored = (dir) => ignoreRules().some((r) => r.glob.endsWith("/**") && r.re.test(`${dir}/x`) && r.re.test(`${dir}/x/y`));

/** Every repository file that is not ignored: the set whose changes must reach some unit. */
function universe() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel(abs);
      if (e.isDirectory()) { if (!dirIgnored(r)) walk(abs); } else if (!isIgnored(r)) out.push(r);
    }
  };
  walk(ROOT);
  return out.sort();
}

let hashCache = null;
let paranoid = false;
function hashFile(file) {
  if (file.endsWith("/")) return hashListing(file);
  const abs = path.join(ROOT, file);
  let st;
  try { st = fs.statSync(abs); } catch (e) { return "MISSING"; }
  if (st.isDirectory()) return hashListing(`${file}/`);
  if (!hashCache) hashCache = readJson(HASH_CACHE_FILE, {});
  const key = `${st.size}:${st.mtimeMs}`;
  if (!paranoid && hashCache[file] && hashCache[file][0] === key) return hashCache[file][1];
  const h = sha(fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n"));
  hashCache[file] = [key, h];
  return h;
}
/** A directory a unit listed: its hash is the sorted list of (non-ignored) entry names. */
function hashListing(dirToken) {
  const dir = dirToken.replace(/\/$/, "");
  try {
    return sha(fs.readdirSync(path.join(ROOT, dir)).filter((n) => !isIgnored(dir ? `${dir}/${n}` : n)).sort().join("\n"));
  } catch (e) { return "MISSING"; }
}
const saveHashCache = () => { if (hashCache) { fs.mkdirSync(LOCAL, { recursive: true }); fs.writeFileSync(HASH_CACHE_FILE, JSON.stringify(hashCache)); } };

// ---------------------------------------------------------------------------
// Static import closure
// ---------------------------------------------------------------------------

/** functions/lib/x.js → functions/src/x.ts (when that source exists). */
function toSource(file) {
  const m = file.match(/^functions\/lib\/(.*)\.js$/);
  if (m) { const src = `functions/src/${m[1]}.ts`; return fs.existsSync(path.join(ROOT, src)) ? src : null; }
  if (/^functions\/lib\//.test(file)) return null;
  return file;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  const libRel = rel(base);
  if (/^functions\/lib\//.test(libRel)) return toSource(libRel.endsWith(".js") ? libRel : `${libRel}.js`);
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, "index.ts"), path.join(base, "index.js")];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return toSource(rel(c));
  return null;
}

const importCache = new Map();
function directImports(file) {
  if (importCache.has(file)) return importCache.get(file);
  let out = [];
  if (/\.(c?js|ts|mjs)$/.test(file) && fs.existsSync(path.join(ROOT, file))) {
    const info = ts.preProcessFile(fs.readFileSync(path.join(ROOT, file), "utf8"), true, true);
    out = info.importedFiles.map((f) => resolveSpecifier(file, f.fileName)).filter(Boolean);
  }
  importCache.set(file, out);
  return out;
}

/** Breadth-first closure; `parents` lets `explain` print the nearest dependency path. */
function staticClosure(entries) {
  const parents = new Map(entries.map((e) => [e, null]));
  const queue = [...entries];
  while (queue.length) {
    const cur = queue.shift();
    for (const dep of directImports(cur)) if (!parents.has(dep)) { parents.set(dep, cur); queue.push(dep); }
  }
  return parents;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const EMULATOR_PORTS = { firestore: 8080, auth: 9099, functions: 5001, storage: 9199 };
function usesEmulator(file) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return false;
  return /emulator-helper|callable-client|FIRESTORE_EMULATOR_HOST|initializeTestEnvironment|getFirestore\(/.test(fs.readFileSync(abs, "utf8"));
}

function nodeCommands(script) {
  return (script || "").split("&&").map((s) => s.trim().match(/^node\s+(\S+)(?:\s+(--\S+))?$/)).filter(Boolean)
    .map((m) => ({ file: rel(path.resolve(FUNCTIONS, m[1])), flag: m[2] || "" }));
}

function enumerateUnits() {
  const pkg = readJson(path.join(FUNCTIONS, "package.json"), {}).scripts || {};
  const units = new Map();
  const add = (u) => { if (!units.has(u.id)) units.set(u.id, { cwd: ROOT, declared: [], phase: 1, emulator: false, needsBuild: false, ...u }); };
  const base = (file) => path.basename(file).replace(/\.(c?js|ts)$/, "");

  // Guards that read what the emulator suites recorded run after them (they would read nothing before).
  add({ id: "data:firestore-indexes", command: "node scripts/check-firestore-indexes.js", entries: ["scripts/check-firestore-indexes.js"], phase: 3.5, declared: ["firestore.indexes.json"] });
  // Static guards and generators run by test:static, plus every check-* script anywhere.
  const staticCmds = nodeCommands(pkg["test:static"]);
  const guardFiles = [
    ...fs.readdirSync(path.join(ROOT, "scripts")).map((f) => `scripts/${f}`),
    ...fs.readdirSync(path.join(FUNCTIONS, "scripts")).map((f) => `functions/scripts/${f}`),
  ].filter((f) => /\/check-[^/]+\.c?js$/.test(f));
  for (const f of guardFiles) if (!staticCmds.some((c) => c.file === f && !c.flag) && f !== "scripts/check-firestore-indexes.js") staticCmds.push({ file: f, flag: "" });
  for (const { file, flag } of staticCmds) {
    const n = base(file);
    const emulator = usesEmulator(file);
    const prefix = /^check-(doc-|markdown)/.test(n) ? "docs" : emulator ? "data" : "static";
    add({
      id: `${prefix}:${n.replace(/^check-/, "")}${flag ? `:${flag.replace(/^--/, "")}` : ""}`,
      command: `node ${file}${flag ? ` ${flag}` : ""}`, cwd: file.startsWith("functions/") ? FUNCTIONS : ROOT,
      entries: [file], emulator, phase: emulator ? 3 : 1, declared: emulator ? ["firestore.rules"] : [],
    });
  }
  for (const u of units.values()) if (u.cwd === FUNCTIONS) u.command = u.command.replace(/node functions\//, "node ");
  // Unit-test files.
  for (const f of fs.readdirSync(path.join(FUNCTIONS, "src", "test", "unit")).filter((x) => x.endsWith(".test.ts"))) {
    const src = `functions/src/test/unit/${f}`;
    add({ id: `unit:${f.replace(/\.test\.ts$/, "")}`, command: `node --test lib/test/unit/${f.replace(/\.ts$/, ".js")}`, cwd: FUNCTIONS, entries: [src], needsBuild: true, emulator: usesEmulator(src), phase: usesEmulator(src) ? 2 : 1 });
  }
  // Rules tests.
  for (const f of fs.readdirSync(path.join(FUNCTIONS, "src", "test", "rules")).filter((x) => x.endsWith(".test.ts"))) {
    const svc = /storage/i.test(f) ? "storage" : "firestore";
    add({ id: `rules:${svc}`, command: `node --test lib/test/rules/${f.replace(/\.ts$/, ".js")} && node ../scripts/collect-rules-coverage.js ${svc}`, cwd: FUNCTIONS, entries: [`functions/src/test/rules/${f}`], needsBuild: true, emulator: true, phase: 2, declared: [`${svc}.rules`, "firebase.json"] });
  }
  // Emulator suites, derived from the package scripts that run them.
  const groups = [["test:seed", "seed", 1.5], ["test:callables", "suite", 2.5], ["test:triggers", "trigger", 2.5], ["test:e2e", "suite", 2.5], ["test:simulation", "suite", 2.5], ["test:roundtrip", "roundtrip", 2.5], ["test:schema-sweep", "sweep", 2.5], ["api:audit:generate", "ledger", 3.5], ["test:guard-defects", "guardtest", 3.2], ["test:coverage-defects", "engine", 5], ["test:metering", "metering", 2.5]];
  for (const [script, kind, phase] of groups) {
    for (const { file } of nodeCommands(pkg[script])) {
      add({ id: `${kind}:${base(file).replace(/^(test|run|generate)-|-callables$|\.e2e$/g, "")}`, command: `node ${file}`, entries: [file], needsBuild: true, emulator: true, phase, declared: ["firestore.rules", "storage.rules", "firestore.indexes.json", "firebase.json"] });
    }
  }
  add({ id: "cost:profile", command: "node ../scripts/generate-api-cost-profile.js && node ../scripts/generate-api-cost-profile.js --check-budgets", cwd: FUNCTIONS, entries: ["scripts/generate-api-cost-profile.js", "scripts/cost-budgets.json"], needsBuild: true, phase: 3.6 });
  add({ id: "coverage:compute", command: "node scripts/generate-field-catalog.js && node scripts/coverage-engine.js", entries: ["scripts/generate-field-catalog.js", "scripts/coverage-engine.js"], needsBuild: true, phase: 4 });
  return [...units.values()].map((u) => ({ ...u, defHash: sha(JSON.stringify([u.id, u.command, rel(u.cwd) || ".", u.phase, u.emulator, u.declared])) }));
}

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

const traceDirName = (id) => id.replace(/[^A-Za-z0-9._-]/g, "_");

function fsTraced(unitId) {
  const dir = path.join(LOCAL, "fs-traces", traceDirName(unitId));
  if (!fs.existsSync(dir)) return null;
  const files = new Set();
  for (const f of fs.readdirSync(dir)) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line || line.startsWith("functions/lib/") && line.endsWith(".map")) continue;
      let isDir = false;
      try { isDir = fs.statSync(path.join(ROOT, line)).isDirectory(); } catch (e) { /* deleted since */ }
      if (isDir) { if (!dirIgnored(line) && !/^functions\/lib/.test(line)) files.add(`${line}/`); continue; }
      const src = toSource(line);
      if (src && !isIgnored(src)) files.add(src);
    }
  }
  return files;
}

function callablesTraced(unitId) {
  const dir = path.join(LOCAL, "traces");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${traceDirName(unitId)}--`));
  if (!files.length) return null;
  const names = new Set();
  for (const f of files) for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) if (line) names.add(JSON.parse(line).callable);
  return names;
}

let exportFiles = null;
function exportFileMap() {
  if (exportFiles) return exportFiles;
  exportFiles = new Map();
  const idx = fs.readFileSync(path.join(FUNCTIONS, "src", "index.ts"), "utf8");
  for (const m of idx.matchAll(/export\s*\{([^}]+)\}\s*from\s*["']\.\/([^"']+)["']/g)) {
    for (const n of m[1].split(",").map((s) => s.trim()).filter(Boolean)) exportFiles.set(n, `functions/src/${m[2].replace(/\.js$/, ".ts")}`);
  }
  return exportFiles;
}

/**
 * The closure of a unit as { file → origin }. Origins: static, fs-trace, callable, trigger,
 * declared, global, untraced. Emulator units that call callables depend on the source closure of
 * each callable they invoked and of every trigger (a write can fire one).
 */
function closureOf(unit, universeFiles) {
  const origin = new Map();
  const put = (f, o) => { if (f && !origin.has(f) && !isIgnored(f.replace(/\/$/, ""))) origin.set(f, o); };
  for (const [f] of staticClosure(unit.entries)) put(f, "static");
  for (const f of unit.declared) put(f, "declared");
  for (const f of config().globalInvalidators) put(f, "global");
  const traced = fsTraced(unit.id);
  const calls = unit.emulator ? callablesTraced(unit.id) : null;
  const callsCallables = unit.emulator && /callable-client/.test(unit.entries.map((e) => fs.existsSync(path.join(ROOT, e)) ? fs.readFileSync(path.join(ROOT, e), "utf8") : "").join(""));
  const untraced = !traced || (callsCallables && !calls);
  if (traced) for (const f of traced) put(f, "fs-trace");
  if (calls) {
    const map = exportFileMap();
    const callableFiles = [...map.entries()].filter(([n]) => calls.has(n)).map(([, f]) => f);
    const triggerFiles = [...map.values()].filter((f) => /\/triggers\//.test(f));
    for (const [f] of staticClosure(["functions/src/index.ts", ...new Set(callableFiles)])) put(f, "callable");
    for (const [f] of staticClosure([...new Set(triggerFiles)])) put(f, "trigger");
  }
  if (untraced) for (const f of universeFiles) put(f, "untraced");
  return { origin, untraced };
}

// ---------------------------------------------------------------------------
// Baseline and plan
// ---------------------------------------------------------------------------

/**
 * The installed firebase-tools package next to the `firebase` executable on PATH (no process: spawning
 * `firebase --version` timed out on a loaded machine and recorded "unknown", which forces every later
 * plan FULL). Spawning is the fallback.
 */
function firebaseToolsVersion() {
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const pkg = path.join(dir, "node_modules", "firebase-tools", "package.json");
    if (fs.existsSync(pkg) && ["firebase", "firebase.cmd"].some((exe) => fs.existsSync(path.join(dir, exe)))) {
      try { return JSON.parse(fs.readFileSync(pkg, "utf8")).version; } catch (e) { /* fall through */ }
    }
  }
  try { return execSync("firebase --version", { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { return "unknown"; }
}
function emulatorBinaries() {
  try { return fs.readdirSync(path.join(os.homedir(), ".cache", "firebase", "emulators")).filter((f) => /\.(jar|zip)$/.test(f)).sort(); } catch (e) { return []; }
}
let envCache = null;
function environment() {
  if (!envCache) envCache = { node: process.version, platform: process.platform, firebaseTools: firebaseToolsVersion(), emulators: emulatorBinaries(), globals: sha(config().globalInvalidators.map((f) => `${f}:${hashFile(f)}`).join("\n")) };
  return envCache;
}
const loadBaseline = () => readJson(BASELINE_FILE, null);

/** opts.assumeChanged: treat exactly these files as changed (selftest) without editing them. */
function computePlan(opts = {}) {
  const baseline = loadBaseline();
  const units = enumerateUnits();
  const files = universe();
  const env = environment();
  const closures = new Map(units.map((u) => [u.id, closureOf(u, files)]));
  const reasonsFull = [];
  const before = (baseline && baseline.schema === 2 && baseline.files) || {};
  const changed = new Set(opts.assumeChanged || []);
  if (!opts.assumeChanged) {
    for (const f of files) if (before[f] !== hashFile(f)) changed.add(f);
    for (const f of Object.keys(before)) if (!files.includes(f) && !isIgnored(f)) changed.add(f);
  }
  if (!baseline || baseline.schema !== 2) reasonsFull.push("no baseline from this impact system");
  else {
    for (const k of ["node", "platform", "firebaseTools"]) if (baseline.environment[k] !== env[k]) reasonsFull.push(`environment ${k} changed: ${baseline.environment[k]} → ${env[k]}`);
    if (env.firebaseTools === "unknown") reasonsFull.push("environment firebase-tools version unknown");
    if (JSON.stringify(baseline.environment.emulators) !== JSON.stringify(env.emulators)) reasonsFull.push("environment emulator binaries changed");
    const globalsChanged = config().globalInvalidators.filter((f) => (opts.assumeChanged ? changed.has(f) : hashFile(f) !== (baseline.globalHashes || {})[f]));
    if (globalsChanged.length) reasonsFull.push(`global invalidator changed: ${globalsChanged.join(", ")}`);
  }
  const listed = (f) => `${path.posix.dirname(f) === "." ? "" : path.posix.dirname(f)}/`;
  // A directory listing covers a NEW file only, and only if the unit also read files of that kind in that
  // directory (markdown-links lists every directory but reads only .md files). An existing file that no
  // closure contains is unmapped: the plan fails closed.
  const ext = (f) => path.posix.extname(f);
  const isNew = (f) => !(f in before);
  const mapped = (f) => [...closures.values()].some(({ origin }) => origin.has(f)
    || (isNew(f) && origin.has(listed(f)) && [...origin.keys()].some((g) => g !== f && listed(g) === listed(f) && ext(g) === ext(f))));
  // A listing changes only when a file is added or deleted (real runs hash the names, not the contents).
  const addedOrDeleted = (c) => isNew(c) || !files.includes(c);
  const unmapped = [...changed].filter((f) => !isIgnored(f) && !mapped(f));
  if (unmapped.length) reasonsFull.push(`unmapped file(s): ${unmapped.join(", ")}`);
  const full = reasonsFull.length > 0;

  const plan = [];
  for (const u of units) {
    const { origin, untraced } = closures.get(u.id);
    const rec = baseline && baseline.schema === 2 && baseline.units[u.id];
    const reasons = [];
    if (full) reasons.push("full run");
    else if (!rec) reasons.push("NOT RUN: new unit");
    else if (rec.result !== "PASS") reasons.push(`last result ${rec.result} (never carried forward)`);
    else if (rec.defHash !== u.defHash) reasons.push("unit definition changed");
    else {
      for (const f of origin.keys()) {
        const hit = opts.assumeChanged ? changed.has(f) || (f.endsWith("/") && [...changed].some((c) => listed(c) === f && addedOrDeleted(c))) : rec.fileHashes[f] !== hashFile(f);
        if (hit) reasons.push(`${f} (${origin.get(f)})`);
        if (reasons.length >= 5) break;
      }
      for (const f of Object.keys(rec.fileHashes)) if (!origin.has(f) && changed.has(f)) reasons.push(`${f} (was in closure)`);
    }
    plan.push({ unit: u, run: reasons.length > 0, reasons, untraced, closure: origin, baselineRunId: rec && rec.runId, durationMs: rec ? rec.durationMs : null, lastRunAt: rec ? rec.startedAt : null });
  }
  return { baseline, units, files, env, full, reasonsFull, changed: [...changed].sort(), unmapped, plan };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" }, () => { s.end(); resolve(true); });
  s.on("error", () => resolve(false));
  s.setTimeout(1500, () => { s.destroy(); resolve(false); });
});

/**
 * `evidenceRoot` is .local for recorded runs. Self-test runs (dryRecord) pass a scratch root, so a run
 * with an injected fault never replaces the real traces the baseline closures and the Coverage Engine use.
 */
function runOne(unit, runDir, evidenceRoot = LOCAL) {
  return new Promise((resolve) => {
    fs.rmSync(path.join(evidenceRoot, "fs-traces", traceDirName(unit.id)), { recursive: true, force: true });
    const traceDir = path.join(evidenceRoot, "traces");
    if (fs.existsSync(traceDir)) for (const f of fs.readdirSync(traceDir)) if (f.startsWith(`${traceDirName(unit.id)}--`)) fs.rmSync(path.join(traceDir, f));
    const started = Date.now();
    const log = fs.createWriteStream(path.join(runDir, `${traceDirName(unit.id)}.log`));
    const env = { ...process.env, VERIFY_UNIT: unit.id, VERIFY_EVIDENCE_DIR: evidenceRoot, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${HOOK}`.trim() };
    const child = spawn(unit.command, { cwd: unit.cwd, env, shell: true });
    let tail = "";
    const onData = (d) => { log.write(d); tail = (tail + d.toString()).slice(-2000); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    child.on("close", (code) => { clearTimeout(timer); log.end(); resolve({ ok: code === 0, durationMs: Date.now() - started, tail }); });
  });
}

/** A full run starts from empty Firestore and Auth emulators, so its numbers describe one fresh universe. */
async function resetEmulatorData() {
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, ".firebaserc"), "utf8")).projects.default;
  for (const url of [`http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`, `http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`]) {
    const res = await fetch(url, { method: "DELETE" });
    console.log(`  reset ${url.split("/emulator")[0]} (${project}) → HTTP ${res.status}`);
  }
  // The emulator's per-request operation log (services/requestRecorder.ts) describes this run only.
  fs.rmSync(path.join(LOCAL, "request-ops"), { recursive: true, force: true });
  fs.rmSync(path.join(LOCAL, "query-shapes.jsonl"), { force: true });
}

async function pool(items, workers, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, queue.length)) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

function listLib() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs); else if (/\.js(\.map)?$/.test(e.name)) out.push(rel(abs));
    }
  };
  walk(path.join(FUNCTIONS, "lib"));
  return out;
}

function buildIfNeeded(results) {
  const srcFiles = universe().filter((f) => f.startsWith("functions/src/"));
  const buildHash = sha(srcFiles.map((f) => `${f}:${hashFile(f)}`).join("\n") + hashFile("functions/tsconfig.json"));
  // Compared with the source lib was last built from, not with the baseline: a self-test fault run builds
  // from injected source and then restores it, so the restored source matches the baseline while lib
  // still holds the fault.
  const builtFrom = path.join(LOCAL, "lib-source-hash");
  const lastBuilt = fs.existsSync(builtFrom) ? fs.readFileSync(builtFrom, "utf8").trim() : null;
  if (lastBuilt === buildHash && fs.existsSync(path.join(FUNCTIONS, "lib", "index.js"))) { results.build = "skipped (lib was built from this source)"; return { ok: true, buildHash }; }
  const t = Date.now();
  // tsc never deletes output: remove lib files whose source is gone, or tests keep loading a deleted module.
  for (const f of universe().length ? listLib() : []) {
    const src = f.replace(/^functions\/lib\//, "functions/src/").replace(/\.js(\.map)?$/, ".ts");
    if (!fs.existsSync(path.join(ROOT, src))) fs.rmSync(path.join(ROOT, f), { force: true });
  }
  try {
    fs.rmSync(builtFrom, { force: true }); // a failed or interrupted build leaves no claim behind
    execSync(`npx tsc -p . --incremental --tsBuildInfoFile ${path.join(LOCAL, "tsbuildinfo").replace(/\\/g, "/")}`, { cwd: FUNCTIONS, stdio: "pipe" });
    fs.writeFileSync(builtFrom, buildHash);
    results.build = `built in ${((Date.now() - t) / 1000).toFixed(1)}s`;
    return { ok: true, buildHash, built: true };
  } catch (e) {
    results.build = `FAILED: ${(e.stdout || "").toString().slice(0, 800)}`;
    return { ok: false, buildHash };
  }
}

/** mode "changed" | "full"; flags.only restricts the run to those unit ids (selftest fault injection). */
async function execute(mode, flags = {}) {
  const runId = `${mode === "full" ? "base" : "run"}-${crypto.randomBytes(4).toString("hex")}`;
  const startedAt = new Date().toISOString();
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const p = computePlan();
  const startHashes = Object.fromEntries(p.files.map((f) => [f, hashFile(f)]));
  const full = mode === "full" || p.full;
  let toRun = p.plan.filter((x) => full || x.run);
  if (flags.only) toRun = p.plan.filter((x) => flags.only.includes(x.unit.id));
  const skipped = p.plan.filter((x) => !toRun.includes(x));
  const cfg = config();
  const canaries = full || flags.only || flags.noCanary ? [] : [...skipped].sort((a, b) => String(a.lastRunAt).localeCompare(String(b.lastRunAt)) || Math.random() - 0.5).slice(0, cfg.canaryCount);
  const results = { build: null };
  const runList = [...toRun, ...canaries];
  const build = runList.some((x) => x.unit.needsBuild) ? buildIfNeeded(results) : { ok: true, buildHash: p.baseline && p.baseline.buildHash };
  if (build.built && runList.some((x) => x.unit.emulator)) await new Promise((r) => setTimeout(r, 5000)); // functions emulator reloads lib
  const emulatorsUp = (await Promise.all(Object.values(EMULATOR_PORTS).map(portOpen))).every(Boolean);

  const outcome = new Map();
  const phases = [...new Set(runList.map((x) => x.unit.phase))].sort((a, b) => a - b);
  const workers = cfg.workers === "auto" ? Math.max(1, os.cpus().length - 1) : Number(cfg.workers) || 1;
  const exec = async (item) => {
    const u = item.unit;
    let r;
    if (u.needsBuild && !build.ok) r = { ok: false, durationMs: 0, tail: `build failed: ${results.build}` };
    else if (u.emulator && !emulatorsUp) r = { ok: false, durationMs: 0, tail: "emulators not reachable on 127.0.0.1 (8080, 9099, 5001, 9199)" };
    else r = await runOne(u, runDir, flags.dryRecord ? path.join(LOCAL, "selftest-evidence") : LOCAL);
    outcome.set(u.id, r);
    if (!flags.quiet) console.log(`  ${(r.ok ? "PASS" : "FAIL").padEnd(5)} ${u.id.padEnd(46)} ${(r.durationMs / 1000).toFixed(1).padStart(7)}s${canaries.includes(item) ? "  (canary)" : ""}`);
    if (flags.stopOnFail && !r.ok) flags.stopped = true;
  };
  for (const phase of phases) {
    if (flags.stopped) break;
    if (full && emulatorsUp && phase === 1.5) await resetEmulatorData();
    const inPhase = runList.filter((x) => x.unit.phase === phase).sort((a, b) => (flags.cheapFirst ? 1 : -1) * ((a.durationMs || 6e5) - (b.durationMs || 6e5)));
    const guard = async (item) => { if (!flags.stopped) await exec(item); };
    await pool(inPhase.filter((x) => !x.unit.emulator), flags.serial ? 1 : workers, guard);
    await pool(inPhase.filter((x) => x.unit.emulator), 1, guard);
  }
  const ran = runList.filter((x) => outcome.has(x.unit.id));
  if (flags.dryRecord) return { runId, outcome, ran };

  // Record: closures are recomputed after the run so new traces are included.
  const files = universe();
  const baseline = full || !p.baseline || p.baseline.schema !== 2 ? { schema: 2, units: {} } : p.baseline;
  const globalHashes = Object.fromEntries(cfg.globalInvalidators.map((f) => [f, hashFile(f)]));
  for (const item of ran) {
    const u = item.unit;
    const r = outcome.get(u.id);
    const { origin, untraced } = closureOf(u, files);
    const fileHashes = {};
    // Content as of the start of this run: an edit made while the run was going reruns the unit next time.
    const at = (f) => (f in startHashes ? startHashes[f] : hashFile(f));
    for (const f of origin.keys()) if (origin.get(f) !== "untraced") fileHashes[f] = at(f);
    if (untraced) for (const f of files) fileHashes[f] = at(f);
    baseline.units[u.id] = { unit: u.id, defHash: u.defHash, inputHash: sha(u.defHash + Object.entries(fileHashes).sort().map(([f, h]) => `${f}:${h}`).join("\n")), closureFiles: Object.keys(fileHashes).sort(), fileHashes, untraced, result: r.ok ? "PASS" : "FAIL", durationMs: r.durationMs, runId, startedAt };
  }
  for (const id of Object.keys(baseline.units)) if (!p.units.some((u) => u.id === id)) delete baseline.units[id];
  const failures = ran.filter((x) => !outcome.get(x.unit.id).ok);
  const canaryMiss = canaries.filter((x) => outcome.has(x.unit.id) && !outcome.get(x.unit.id).ok);
  const untracedNow = p.units.filter((u) => baseline.units[u.id] && baseline.units[u.id].untraced).map((u) => u.id);
  Object.assign(baseline, {
    runId: full ? runId : baseline.runId, startedAt: full ? startedAt : baseline.startedAt, lastRunId: runId,
    environment: environment(), globalHashes, buildHash: build.buildHash,
    files: startHashes,
    // Trusted = the last full run was trusted and every unit's current record is PASS (a repaired failure restores it).
    trusted: full ? failures.length === 0 && !flags.provisional && untracedNow.length === 0 : baseline.label === "trusted" && Object.values(baseline.units).every((u) => u.result === "PASS") && untracedNow.length === 0,
    label: full ? (flags.provisional ? "provisional" : failures.length || untracedNow.length ? "untrusted" : "trusted") : baseline.label,
  });
  fs.mkdirSync(LOCAL, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 1));
  saveHashCache();

  const envMatch = !p.baseline ? "no baseline" : p.reasonsFull.some((r) => r.startsWith("environment")) ? "no" : "yes";
  const block = [
    `baseline run id / date / environment match: ${p.baseline && p.baseline.runId ? `${p.baseline.runId} / ${p.baseline.startedAt}` : "none"} / ${envMatch}`,
    `changed files (${p.changed.length}): ${p.changed.slice(0, 30).join(", ") || "none"}${p.changed.length > 30 ? ` … +${p.changed.length - 30} more` : ""}`,
    `units: total ${p.units.length} | run ${toRun.length + canaries.length} | skipped ${skipped.length - canaries.length} (unchanged since ${p.baseline ? p.baseline.runId : "-"}) | untraced ${untracedNow.length} (must be 0) | unmapped files ${p.unmapped.length} (must be 0)`,
    `canary: ${canaries.length} units re-run, result ${canaries.length ? (canaryMiss.length ? `FAIL — impact map miss: ${canaryMiss.map((c) => c.unit.id).join(", ")}; files changed: ${p.changed.join(", ") || "none"}` : "PASS") : "n/a (full run)"}`,
    `FAIL: ${failures.length ? failures.map((x) => x.unit.id).join(", ") : "none"}`,
  ];
  if (full) block.unshift(`run ${runId}: full${flags.provisional ? " (provisional)" : ""}; new baseline, trusted: ${baseline.trusted}${p.reasonsFull.length ? `; full because: ${p.reasonsFull.join("; ")}` : ""}`);
  if (untracedNow.length) block.push(`untraced units: ${untracedNow.join(", ")}`);
  console.log(`\nbuild: ${results.build || "not needed"}\n\nVerification scope block\n${"-".repeat(60)}\n${block.join("\n")}\n${"-".repeat(60)}`);
  for (const f of failures) console.log(`\n[${f.unit.id}] last output:\n${outcome.get(f.unit.id).tail}`);
  fs.writeFileSync(path.join(RUNS_DIR, `${runId}.json`), JSON.stringify({
    runId, mode, startedAt, finishedAt: new Date().toISOString(), build: results.build, scopeBlock: block,
    units: ran.map((x) => ({ unit: x.unit.id, result: outcome.get(x.unit.id).ok ? "PASS" : "FAIL", durationMs: outcome.get(x.unit.id).durationMs, canary: canaries.includes(x), reasons: x.reasons })),
    skipped: skipped.filter((x) => !canaries.includes(x)).map((x) => `${x.unit.id}: SKIPPED (unchanged since ${x.baselineRunId})`),
  }, null, 1));
  if (full) writeBlastRadius(p.units);
  return { runId, failures: failures.map((x) => x.unit.id), canaryMiss: canaryMiss.map((x) => x.unit.id), block };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function writeBlastRadius(units) {
  const b = loadBaseline();
  const reach = new Map();
  for (const u of units) {
    const rec = b && b.units[u.id];
    if (!rec || rec.untraced) continue;
    for (const f of rec.closureFiles) if (!f.endsWith("/")) reach.set(f, (reach.get(f) || 0) + 1);
  }
  const rows = [...reach.entries()].filter(([f]) => !config().globalInvalidators.includes(f)).sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).slice(0, 15);
  const md = ["# Change-impact blast radius", "", `Generated by \`scripts/verify-impact.js\` from baseline \`${b.runId}\` (${b.startedAt}). Do not edit.`, "",
    `${units.length} units. The ${config().globalInvalidators.length} global invalidators (verify/impact.config.json) reach every unit and are not listed.`, "",
    "| # | File | Units reached | Share | Warning |", "|---|---|---|---|---|",
    ...rows.map(([f, n], i) => `| ${i + 1} | \`${f}\` | ${n} | ${((100 * n) / units.length).toFixed(1)} % | ${n / units.length > 0.6 ? "more than 60 % of units" : ""} |`), ""];
  fs.writeFileSync(path.join(ROOT, "docs", "audit", "blast-radius-table.md"), md.join("\n"));
  return rows;
}

function printPlan() {
  const t = Date.now();
  const p = computePlan();
  const run = p.plan.filter((x) => p.full || x.run);
  console.log(`Plan computed in ${((Date.now() - t) / 1000).toFixed(1)}s against baseline ${p.baseline && p.baseline.schema === 2 ? `${p.baseline.runId} (${p.baseline.label}, ${p.baseline.startedAt})` : "none"}`);
  console.log(`Changed files (${p.changed.length}): ${p.changed.slice(0, 40).join(", ") || "none"}${p.changed.length > 40 ? " …" : ""}`);
  if (p.unmapped.length) console.log(`FAIL: unmapped file(s) (${p.unmapped.length}): ${p.unmapped.join(", ")} → plan is FULL`);
  if (p.full) console.log(`FULL run required: ${p.reasonsFull.join("; ")}`);
  const est = run.reduce((s, x) => s + (x.durationMs || 0), 0);
  console.log(`Units: total ${p.units.length} | to run ${run.length} | skipped ${p.units.length - run.length} | untraced ${p.plan.filter((x) => x.untraced).length} | ignore rules ${config().ignored.length} | estimated ${(est / 1000).toFixed(0)}s from baseline durations`);
  for (const x of run) console.log(`  RUN  ${x.unit.id.padEnd(44)} ${x.reasons.slice(0, 3).join("; ")}`);
  saveHashCache();
  return p.unmapped.length ? 1 : 0;
}

function explain(id) {
  const p = computePlan();
  const item = p.plan.find((x) => x.unit.id === id) || p.plan.find((x) => x.unit.id.includes(id));
  if (!item) { console.error(`unit not found: ${id}`); return 1; }
  const parents = staticClosure(item.unit.entries);
  console.log(`${item.unit.id}\n  command: ${item.unit.command} (cwd ${rel(item.unit.cwd) || "."})\n  status: ${item.run || p.full ? `RUN — ${item.reasons.join("; ")}` : `SKIPPED (unchanged since ${item.baselineRunId})`}${item.untraced ? "\n  UNTRACED: depends on every file until a run records its traces" : ""}`);
  const shown = [...item.closure.entries()].filter(([, o]) => o !== "untraced").sort();
  console.log(`  closure: ${shown.length} files${item.untraced ? ` (+ every other file, untraced)` : ""}`);
  for (const [f, o] of shown) {
    const chain = [];
    for (let cur = f; cur && parents.has(cur); cur = parents.get(cur)) chain.unshift(cur);
    console.log(`    ${f}  [${o}]${chain.length > 1 ? `  via ${chain.join(" → ")}` : ""}${p.changed.includes(f) ? "  CHANGED" : ""}`);
  }
  return 0;
}

function status() {
  const p = computePlan();
  const b = p.baseline;
  if (!b || b.schema !== 2) { console.log("No baseline from this impact system. Run `npm run verify:full`."); return 1; }
  console.log(`baseline ${b.runId} (${b.label}, trusted: ${b.trusted}) from ${b.startedAt}, ${((Date.now() - Date.parse(b.startedAt)) / 3.6e6).toFixed(1)} h old; last run ${b.lastRunId}`);
  console.log(`environment match: ${p.reasonsFull.some((r) => r.startsWith("environment")) ? `no (${p.reasonsFull.join("; ")})` : "yes"}; node ${p.env.node}, firebase-tools ${p.env.firebaseTools}`);
  console.log(`units ${p.units.length}; stale (would run) ${p.plan.filter((x) => p.full || x.run).length}; untraced ${p.plan.filter((x) => x.untraced).length}; unmapped changed files ${p.unmapped.length}; ignore rules ${config().ignored.length}`);
  return 0;
}

module.exports = { ROOT, computePlan, enumerateUnits, universe, isIgnored, hashFile, staticClosure, closureOf, execute, writeBlastRadius, loadBaseline, BASELINE_FILE, config };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  paranoid = args.includes("--paranoid");
  (async () => {
    if (cmd === "plan") process.exitCode = printPlan();
    else if (cmd === "explain") process.exitCode = explain(args.find((a) => !a.startsWith("--")));
    else if (cmd === "status") process.exitCode = status();
    else if (cmd === "changed" || cmd === "full") process.exitCode = (await execute(cmd, { provisional: args.includes("--provisional") })).failures.length ? 1 : 0;
    else { console.error("usage: verify-impact.js plan|changed|full [--provisional]|explain <unit>|status"); process.exitCode = 2; }
  })();
}
