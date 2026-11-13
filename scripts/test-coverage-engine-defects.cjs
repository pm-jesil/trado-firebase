#!/usr/bin/env node
/**
 * Seeded-defect test of the Coverage Engine (prompt 65, Part 2.4).
 *
 * Each case edits a real input of the engine (catalog, source, schema, rules, evidence), runs the
 * engine into a temporary directory, asserts on its output, and restores the input in `finally`.
 * The schema case rebuilds functions/lib before and after (the engine reads compiled schemas).
 * Run it when no emulator suite is running (case 3 rebuilds lib, which the functions emulator reloads).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "cov-defects-"));
const abs = (f) => path.join(ROOT, f);
const results = [];

function engine() {
  execSync(`node scripts/coverage-engine.js --out "${OUT}"`, { cwd: ROOT, stdio: "pipe" });
  return JSON.parse(fs.readFileSync(path.join(OUT, "coverage.json"), "utf8"));
}
const build = () => execSync("npx tsc -p .", { cwd: path.join(ROOT, "functions"), stdio: "pipe" });

function withEdits(edits, fn) {
  const saved = edits.map(([f]) => [f, fs.readFileSync(abs(f))]);
  try {
    for (const [f, transform] of edits) {
      const next = transform(fs.readFileSync(abs(f), "utf8"));
      if (next === fs.readFileSync(abs(f), "utf8")) throw new Error(`edit of ${f} changed nothing`);
      fs.writeFileSync(abs(f), next);
    }
    return fn();
  } finally {
    for (const [f, content] of saved) fs.writeFileSync(abs(f), content);
  }
}

function report(n, title, ok, lines) {
  results.push(ok);
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${n}. ${title}\n${lines.map((l) => `      ${l}`).join("\n")}`);
}

const base = engine();
const inv = (r, id) => r.invariants[id];
console.log(`Baseline engine run ${base.runId}: ${Object.values(base.invariants).map((i) => `${i.id} ${i.ratio}`).join(" | ")}`);

// 1. Remove one field from the catalog → C-1 drops by exactly one and names it.
{
  const catalog = JSON.parse(fs.readFileSync(abs("docs/generated/field-catalog.json"), "utf8"));
  const entity = catalog.entities.find((e) => e.collection === "organizations");
  const victim = entity.fields.find((f) => f.path === "currency");
  const r = withEdits([["docs/generated/field-catalog.json", (s) => {
    const c = JSON.parse(s);
    const e = c.entities.find((x) => x.collection === "organizations");
    e.fields = e.fields.filter((f) => f.path !== victim.path);
    return JSON.stringify(c, null, 2);
  }]], engine);
  const delta = inv(base, "C-1").numerator - inv(r, "C-1").numerator;
  const named = inv(r, "C-1").uncovered.filter((u) => u.startsWith("organizations:currency"));
  report(1, "catalog field removed", delta === 1 && named.length === 1, [`C-1 ${inv(base, "C-1").ratio} → ${inv(r, "C-1").ratio} (delta ${delta})`, `named: ${named.join(", ") || "nothing"}`]);
}

// 2. `as any` on a write path → C-8 counts it and names file:line.
{
  const file = "functions/src/callables/teams.ts";
  const anchor = "  try {\n    const now = new Date().toISOString();";
  const r = withEdits([[file, (s) => s.replace(anchor, `  try {\n    const probeWrite = ({ name: input.name } as any);\n    void probeWrite;\n    const now = new Date().toISOString();`)]], engine);
  const before = inv(base, "C-8").anyCount;
  const after = inv(r, "C-8").anyCount;
  const named = inv(r, "C-8").uncovered.filter((u) => u.startsWith(`${file}:`) && u.includes("probeWrite"));
  report(2, "`as any` added in teamsCreate", after === before + 1 && named.length === 1, [`any count ${before} → ${after}`, `named: ${named.join(", ") || "nothing"}`]);
}

// 3. A request-schema field without a test → C-2 names it.
{
  const file = "functions/src/validation/schemas.ts";
  const r = withEdits([[file, (s) => s.replace(/export const CreateTeamSchema = z\.strictObject\(\{\n/, (m) => `${m}  probeUntestedField: z.string().max(10).optional(),\n`)]], () => { build(); return engine(); });
  build();
  const named = inv(r, "C-2").uncovered.filter((u) => u.startsWith("teamsCreate:probeUntestedField"));
  report(3, "untested field added to CreateTeamSchema", named.length === 1 && inv(r, "C-2").denominator === inv(base, "C-2").denominator + 1, [`C-2 ${inv(base, "C-2").ratio} → ${inv(r, "C-2").ratio}`, `named: ${named.join(", ") || "nothing"}`]);
}

// 4. A collection in the rules file but not in the registry → mismatch reported.
{
  const r = withEdits([["firestore.rules", (s) => s.replace("    match /users/{uid} {", "    match /ghostProbe/{id} {\n      allow read: if false;\n    }\n    match /users/{uid} {")]], engine);
  const named = r.registryFindings.filter((f) => f.includes("ghostProbe"));
  report(4, "collection ghostProbe added to firestore.rules only", named.length === 1, [`registry findings ${base.registryFindings.length} → ${r.registryFindings.length}`, `named: ${named.join(" | ") || "nothing"}`]);
}

// 5. Delete one callable test → C-6 names the callable. The evidence of a test is its trace; deleting
//    every test of a callable leaves no trace row for it after the next run, which is simulated here.
{
  const victim = "branchesGetDefault";
  const dir = abs(".local/traces");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => `.local/traces/${f}`).filter((f) => fs.readFileSync(abs(f), "utf8").includes(`"callable":"${victim}"`)) : [];
  if (!files.length) report(5, `tests of ${victim} removed`, false, ["no trace of the callable exists (suites not run)"]);
  else {
    const r = withEdits(files.map((f) => [f, (s) => s.split("\n").filter((l) => !l.includes(`"callable":"${victim}"`)).join("\n")]), engine);
    const named = inv(r, "C-6").uncovered.filter((u) => u.startsWith(`${victim}:success`));
    report(5, `tests of ${victim} removed (its trace rows dropped from ${files.length} trace file(s))`, named.length === 1, [`C-6 ${inv(base, "C-6").ratio} → ${inv(r, "C-6").ratio}`, `named: ${named.join(", ") || "nothing"}`]);
  }
}

// 6. Remove one rules test → C-9 names the rule. The evidence of a rules test is the rule-evaluation
//    record it leaves in docs/generated/rules-coverage.json; the record of one allow statement is removed.
{
  const f = "docs/generated/rules-coverage.json";
  if (!fs.existsSync(abs(f))) report(6, "rules test removed", false, ["rules coverage evidence missing (rules units not run)"]);
  else {
    const cov = JSON.parse(fs.readFileSync(abs(f), "utf8"));
    const key = Object.keys(cov.firestore).find((k) => cov.firestore[k].allowed > 0 && cov.firestore[k].denied > 0);
    const r = withEdits([[f, (s) => { const c = JSON.parse(s); delete c.firestore[key]; return JSON.stringify(c, null, 2); }]], engine);
    const named = inv(r, "C-9").uncovered.filter((u) => u.startsWith(`firestore.rules:${key.split(":")[0]} `));
    report(6, `rules evidence for firestore.rules line ${key} removed`, named.length > 0 && inv(r, "C-9").numerator < inv(base, "C-9").numerator, [`C-9 ${inv(base, "C-9").ratio} → ${inv(r, "C-9").ratio}`, `named: ${named.join(" | ") || "nothing"}`]);
  }
}

// 7. A create callable without idempotency → C-10 names it.
{
  const r = withEdits([
    ["functions/src/callables/teams.ts", (s) => `${s}\nexport const probeCreate = onCall({ region: "asia-south1" }, async () => ({ ok: true }));\n`],
    ["functions/src/index.ts", (s) => s.replace(/export \{([^}]*teamsCreate)/, "export {\n  probeCreate,$1")],
  ], engine);
  const named = inv(r, "C-10").uncovered.filter((u) => u.startsWith("probeCreate"));
  report(7, "create callable probeCreate without reserveIdempotency", named.length === 1 && inv(r, "C-10").denominator === inv(base, "C-10").denominator + 1, [`C-10 ${inv(base, "C-10").ratio} → ${inv(r, "C-10").ratio}`, `named: ${named.join(" | ") || "nothing"}`]);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\nSeeded defects detected: ${results.filter(Boolean).length}/${results.length}`);
process.exitCode = results.every(Boolean) ? 0 : 1;
