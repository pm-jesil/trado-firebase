#!/usr/bin/env node
/**
 * Self-test of the Change-Impact Test System (prompt 65, Part 4.6). Needs a baseline from
 * `verify:full`. Every edit is restored in `finally`; nothing is left behind.
 *
 *   node scripts/test-verify-selftest.cjs [--only 1,2,…] [--skip-fault-injection]
 *
 * Checks 1–7 and 10 compute plans only. 8, 9 and 11 run units (8 and 11 without touching the
 * baseline; 9 records FAIL and then PASS again). 12 writes docs/audit/blast-radius-table.md.
 * Also measures parallel determinism (3 parallel runs of the non-emulator units vs one serial run).
 */
const fs = require("node:fs");
const path = require("node:path");
const v = require("./verify-impact.js");

const ROOT = v.ROOT;
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",").map(Number) : null;
const results = [];
const abs = (f) => path.join(ROOT, f);

function withEdit(file, transform, fn) {
  const existed = fs.existsSync(abs(file));
  const original = existed ? fs.readFileSync(abs(file)) : null;
  const stat = existed ? fs.statSync(abs(file)) : null;
  try {
    const next = transform(original ? original.toString("utf8") : null);
    if (next === null) fs.rmSync(abs(file)); else { fs.mkdirSync(path.dirname(abs(file)), { recursive: true }); fs.writeFileSync(abs(file), next); }
    return fn();
  } finally {
    if (existed) { fs.writeFileSync(abs(file), original); fs.utimesSync(abs(file), stat.atime, stat.mtime); } else fs.rmSync(abs(file), { force: true });
  }
}
async function withEditAsync(file, transform, fn) {
  const existed = fs.existsSync(abs(file));
  const original = existed ? fs.readFileSync(abs(file)) : null;
  const stat = existed ? fs.statSync(abs(file)) : null;
  try {
    const next = transform(original ? original.toString("utf8") : null);
    if (next === null) fs.rmSync(abs(file)); else fs.writeFileSync(abs(file), next);
    return await fn();
  } finally {
    if (existed) { fs.writeFileSync(abs(file), original); fs.utimesSync(abs(file), stat.atime, stat.mtime); } else fs.rmSync(abs(file), { force: true });
  }
}

const planned = (p) => p.plan.filter((x) => p.full || x.run).map((x) => x.unit.id);
const closureHas = (p, file) => p.plan.filter((x) => x.closure.has(file)).map((x) => x.unit.id);
const fmt = (ids) => (ids.length > 12 ? `${ids.slice(0, 12).join(", ")} … (+${ids.length - 12})` : ids.join(", ") || "(none)");

async function check(n, title, fn) {
  if (only && !only.includes(n)) return;
  const t = Date.now();
  let ok = false;
  let detail = "";
  try { [ok, detail] = await fn(); } catch (e) { detail = `error: ${e.stack || e.message}`; }
  results.push({ n, title, ok, detail, s: ((Date.now() - t) / 1000).toFixed(1) });
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${n}. ${title} (${((Date.now() - t) / 1000).toFixed(1)}s)\n${detail.split("\n").map((l) => `      ${l}`).join("\n")}`);
}

/** A service file imported (directly, within functions/src) by exactly two callable files and nothing else. */
function leafHelper() {
  const src = v.universe().filter((f) => /^functions\/src\/.*\.ts$/.test(f));
  const importers = new Map();
  const ts = require(path.join(ROOT, "functions", "node_modules", "typescript"));
  for (const f of src) {
    const info = ts.preProcessFile(fs.readFileSync(abs(f), "utf8"), true, true);
    for (const imp of info.importedFiles) {
      if (!imp.fileName.startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), imp.fileName.replace(/\.js$/, ".ts")));
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(f);
    }
  }
  for (const [file, set] of [...importers.entries()].sort()) {
    const users = [...set];
    if (/^functions\/src\/services\//.test(file) && users.length === 2 && users.every((u) => /\/callables\//.test(u))) return { file, users };
  }
  return null;
}

async function main() {
  const base = v.loadBaseline();
  if (!base || base.schema !== 2) { console.error("No baseline. Run `node scripts/verify-impact.js full` first."); process.exit(2); }
  console.log(`Self-test against baseline ${base.runId} (${base.label})`);
  const p0 = v.computePlan();
  // Units that run anyway (e.g. last result FAIL) belong to the existing plan, not to the probe change.
  const already = new Set(planned(p0));
  const byChange = (p) => planned(p).filter((id) => !already.has(id));
  console.log(`Current tree vs baseline: ${p0.changed.length} changed file(s), ${planned(p0).length} unit(s) planned${p0.full ? " (FULL)" : ""}.`);

  await check(1, "Leaf change: helper used by exactly two callables", () => {
    const leaf = leafHelper();
    if (!leaf) return [false, "no service file imported by exactly two callables found"];
    const p = v.computePlan({ assumeChanged: [leaf.file] });
    const run = byChange(p);
    const expected = closureHas(p, leaf.file).filter((id) => !already.has(id));
    const extra = run.filter((id) => !expected.includes(id));
    const missing = expected.filter((id) => !run.includes(id));
    const units = run.filter((id) => id.startsWith("unit:"));
    const ok = !p.full && missing.length === 0 && extra.length === 0 && run.length < p.units.length;
    return [ok, `${leaf.file} ← imported by ${leaf.users.join(", ")}\nplanned ${run.length}/${p.units.length}: ${fmt(run)}\nunit tests planned: ${fmt(units)}\nunits reaching it but not planned: ${fmt(missing)}; planned without reaching it: ${fmt(extra)}`];
  });

  await check(2, "Rules change: firestore.rules", () => {
    const p = v.computePlan({ assumeChanged: ["firestore.rules"] });
    const run = planned(p);
    const pureUnit = run.filter((id) => id.startsWith("unit:") && !p.plan.find((x) => x.unit.id === id).unit.emulator);
    const ok = !p.full && run.includes("rules:firestore") && pureUnit.length === 0;
    return [ok, `planned ${run.length}/${p.units.length}: ${fmt(run)}\npure unit tests planned (must be none): ${fmt(pureUnit)}`];
  });

  await check(3, "Docs-only change: docs/testing-guide.md", () => {
    const p = v.computePlan({ assumeChanged: ["docs/testing-guide.md"] });
    const run = byChange(p);
    const bad = run.filter((id) => /^(unit|suite|rules|trigger|seed|roundtrip|data|ledger|sweep):/.test(id));
    return [!p.full && run.length > 0 && bad.length === 0, `planned ${run.length}: ${fmt(run)}\nnon-doc units planned (must be none): ${fmt(bad)}`];
  });

  await check(4, "Test-only change: functions/scripts/test-branch-lifecycle-callables.cjs", () => {
    const file = "functions/scripts/test-branch-lifecycle-callables.cjs";
    const p = v.computePlan({ assumeChanged: [file] });
    const run = byChange(p);
    const suites = run.filter((id) => /^(suite|trigger|roundtrip|seed|sweep):/.test(id));
    const unrelated = run.filter((id) => !p.plan.find((x) => x.unit.id === id).closure.has(file));
    return [!p.full && suites.length === 1 && suites[0] === "suite:branch-lifecycle" && unrelated.length === 0, `planned by this change ${run.length}: ${fmt(run)}\nsuites (must be exactly suite:branch-lifecycle): ${fmt(suites)}; planned without the file in their closure: ${fmt(unrelated)}\n(the other units read test sources: completeness, duplicates, links, API audit ledger)`];
  });

  await check(5, "Global invalidator: functions/package-lock.json", () => {
    const p = v.computePlan({ assumeChanged: ["functions/package-lock.json"] });
    return [p.full && planned(p).length === p.units.length, `full: ${p.full}; reasons: ${p.reasonsFull.join("; ")}; planned ${planned(p).length}/${p.units.length}`];
  });

  await check(6, "Unmapped file fails closed: verify/zz-unmapped-probe.txt", () => withEdit("verify/zz-unmapped-probe.txt", () => "probe\n", () => {
    const p = v.computePlan();
    return [p.full && p.unmapped.includes("verify/zz-unmapped-probe.txt"), `unmapped: ${p.unmapped.join(", ")}\nfull: ${p.full} (${p.reasonsFull.join("; ")})`];
  }));

  await check(7, "Revert: change then revert returns the plan to its pre-change state", () => {
    const file = "functions/src/services/money.ts";
    const before = planned(v.computePlan());
    const during = withEdit(file, (s) => `${s}\n// selftest probe\n`, () => planned(v.computePlan()));
    const after = planned(v.computePlan());
    const same = JSON.stringify(before) === JSON.stringify(after);
    return [same && during.length > before.length, `before ${before.length} | during ${during.length} | after revert ${after.length}${before.length === 0 ? " (empty)" : " (tree differs from baseline elsewhere; equal before/after is the check)"}`];
  });

  await check(8, "Deletion: delete a source file → affected units run and fail, none skipped", async () => {
    const file = "functions/src/services/deliveryProgress.ts";
    return withEditAsync(file, () => null, async () => {
      const p = v.computePlan();
      const expected = closureHas(p, file);
      const run = planned(p);
      const missing = expected.filter((id) => !run.includes(id));
      // units that load the file (a guard that only scans files does not fail when one disappears)
      const loads = (id) => ["fs-trace", "callable", "trigger"].includes(p.plan.find((x) => x.unit.id === id).closure.get(file));
      const sample = run.filter((id) => expected.includes(id) && loads(id) && /^unit:/.test(id)).slice(0, 3);
      // no unit test loads it: any unit that needs the build fails as soon as the build fails
      const target = sample.length ? sample : expected.filter((id) => p.plan.find((x) => x.unit.id === id).unit.needsBuild).slice(0, 2);
      const r = await v.execute("changed", { only: target, dryRecord: true, noCanary: true, quiet: true });
      const failed = [...r.outcome.entries()].filter(([, o]) => !o.ok).map(([id]) => id);
      return [missing.length === 0 && failed.length === target.length && target.length > 0, `units whose closure has the file: ${expected.length}; planned ${run.length}; skipped-but-affected: ${fmt(missing)}\nran ${fmt(target)} → failed ${fmt(failed)}`];
    });
  });

  await check(9, "FAIL is not carried forward", async () => {
    const file = "scripts/check-dead-fields.js";
    const unit = "static:dead-fields";
    const out = await withEditAsync(file, (s) => s.replace(/^(#!.*\n)?/, (m) => `${m}process.exit(1); // selftest fault\n`), async () => {
      const r1 = await v.execute("changed", { only: [unit], noCanary: true, quiet: true });
      const p = v.computePlan();
      const item = p.plan.find((x) => x.unit.id === unit);
      const r2 = await v.execute("changed", { only: [unit], noCanary: true, quiet: true });
      return { r1: r1.failures.includes(unit), reran: item.run, reason: item.reasons.join("; "), r2: r2.failures.includes(unit) };
    });
    const r3 = await v.execute("changed", { only: [unit], noCanary: true, quiet: true });
    return [out.r1 && out.reran && out.r2 && !r3.failures.includes(unit), `run 1 FAIL: ${out.r1}; next plan reruns it: ${out.reran} (${out.reason}); run 2 FAIL: ${out.r2}; after restore PASS: ${!r3.failures.includes(unit)}`];
  });

  await check(10, "Structural completeness: every repository file reaches a unit or is ignored", () => {
    const p = v.computePlan();
    const files = v.universe();
    const lonely = files.filter((f) => !p.plan.some((x) => x.closure.has(f) || x.closure.has(`${path.posix.dirname(f) === "." ? "" : path.posix.dirname(f)}/`)));
    const ignoredRules = v.config().ignored.length;
    return [lonely.length === 0, `files checked: ${files.length}; reaching no unit: ${lonely.length}${lonely.length ? ` → ${lonely.join(", ")}` : ""}\nignore rules: ${ignoredRules} (files under them are not in the checked set)`];
  });

  if (!args.includes("--skip-fault-injection")) await check(11, "Fault injection: load-time fault in 12 files, only planned units run, miss rate 0", async () => {
    const thrower = "throw new Error('selftest fault injection');\n";
    const faults = [
      ["gate", "functions/src/services/contextResolver.ts", (s) => `${thrower}${s}`],
      ["input wrapper", "functions/src/validation/parseInput.ts", (s) => `${thrower}${s}`],
      ["handler", "functions/src/callables/teams.ts", (s) => `${thrower}${s}`],
      ["shared schema", "functions/src/validation/sharedSchemas.ts", (s) => `${thrower}${s}`],
      ["trigger", "functions/src/triggers/eventTriggers.ts", (s) => `${thrower}${s}`],
      ["rules", "storage.rules", (s) => s.replace("service firebase.storage {", "service firebase.storage { this is not valid")],
      ["static-guard input", "docs/generated/naming-registry.json", () => "{ not json"],
      ["docs generator", "scripts/generate-doc-index.js", (s) => `${thrower}${s}`],
      ["seed fixture", "functions/src/constants/catalogs.ts", (s) => `${thrower}${s}`],
      ["image policy", "functions/src/config/imagePolicy.ts", (s) => `${thrower}${s}`],
      ["util", "functions/src/services/money.ts", (s) => `${thrower}${s}`],
      ["test helper", "functions/scripts/helpers/domain-builders.cjs", (s) => `${thrower}${s}`],
    ];
    const rows = [];
    // The faulty runs must not touch the recorded evidence (traces, fs-traces) the baseline relies on.
    const evidenceHash = () => ["traces", "fs-traces"].map((d) => path.join(ROOT, ".local", d)).filter(fs.existsSync)
      .flatMap((d) => fs.readdirSync(d, { recursive: true }).map((f) => path.join(d, String(f)))).filter((f) => fs.statSync(f).isFile()).sort()
      .map((f) => `${f}:${fs.readFileSync(f, "utf8").length}`).join("|");
    const evidenceBefore = evidenceHash();
    // Generator units run during the faulty runs and rewrite committed outputs (inventory, ledger); after
    // the faults are removed the tree must be back to its pre-check state.
    const changedBefore = v.computePlan().changed.join("\n");
    for (const [layer, file, inject] of faults) {
      if (!fs.existsSync(abs(file))) { rows.push(`${layer.padEnd(18)} ${file}: file missing`); continue; }
      const row = await withEditAsync(file, inject, async () => {
        const p = v.computePlan();
        const run = planned(p);
        const r = await v.execute("changed", { only: run, dryRecord: true, noCanary: true, quiet: true, cheapFirst: true, stopOnFail: true });
        const failed = [...r.outcome.entries()].filter(([, o]) => !o.ok).map(([id]) => id);
        return { layer, file, planned: run.length, full: p.full, ran: r.outcome.size, failed };
      });
      rows.push(row);
    }
    const misses = rows.filter((r) => typeof r === "object" && r.failed.length === 0);
    const table = rows.map((r) => (typeof r === "string" ? r : `${r.layer.padEnd(18)} ${r.file.padEnd(48)} planned ${String(r.planned).padStart(2)}${r.full ? " (full)" : ""} | ran ${r.ran} | detected by ${r.failed[0] || "NONE"}`)).join("\n");
    const evidenceKept = evidenceHash() === evidenceBefore;
    // The build must not keep an injected fault after the source is restored (the next build rebuilds it).
    const p = v.computePlan();
    await v.execute("changed", { only: p.plan.filter((x) => x.unit.needsBuild).slice(0, 1).map((x) => x.unit.id), dryRecord: true, noCanary: true, quiet: true });
    // Regenerate committed outputs from the restored source, then require the tree to match.
    await v.execute("changed", { only: p.plan.filter((x) => /generate|api-audit-ledger/.test(x.unit.id)).map((x) => x.unit.id), dryRecord: true, noCanary: true, quiet: true });
    const treeKept = v.computePlan().changed.join("\n") === changedBefore;
    const libDir = path.join(ROOT, "functions", "lib");
    const faultyLib = fs.readdirSync(libDir, { recursive: true }).map(String).filter((f) => f.endsWith(".js") && fs.readFileSync(path.join(libDir, f), "utf8").includes("selftest fault injection"));
    return [misses.length === 0 && rows.length === 12 && evidenceKept && faultyLib.length === 0 && treeKept, `${table}\nmiss rate: ${misses.length}/${rows.length}\nrecorded evidence (.local/traces, .local/fs-traces) unchanged by the faulty runs: ${evidenceKept ? "yes" : "NO"}\nbuild clean after the faults were removed: ${faultyLib.length ? `NO (${faultyLib.join(", ")})` : "yes"}\nrepository unchanged after the faults were removed: ${treeKept ? "yes" : "NO"}\n(detected by = the first unit to fail, cheapest first; a generated-doc ripple can fail before the unit testing the faulted code)`];
  });

  await check(12, "Blast radius table", () => {
    const rows = v.writeBlastRadius(v.enumerateUnits());
    const total = v.enumerateUnits().length;
    const warn = rows.filter(([, n]) => n / total > 0.6);
    return [rows.length > 0, `${rows.map(([f, n], i) => `${String(i + 1).padStart(2)}. ${f.padEnd(52)} ${String(n).padStart(3)} units ${((100 * n) / total).toFixed(1).padStart(5)} %${n / total > 0.6 ? "  WARNING > 60 %" : ""}`).join("\n")}\nwarnings: ${warn.length}; written docs/audit/blast-radius-table.md`];
  });

  if (args.includes("--determinism")) {
    const ids = v.enumerateUnits().filter((u) => !u.emulator && u.id !== "coverage:compute").map((u) => u.id);
    const serial = await v.execute("changed", { only: ids, dryRecord: true, noCanary: true, quiet: true, serial: true });
    const sets = [];
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const r = await v.execute("changed", { only: ids, dryRecord: true, noCanary: true, quiet: true });
      times.push(((Date.now() - t) / 1000).toFixed(1));
      sets.push(JSON.stringify([...r.outcome.entries()].map(([id, o]) => `${id}:${o.ok}`).sort()));
    }
    const ref = JSON.stringify([...serial.outcome.entries()].map(([id, o]) => `${id}:${o.ok}`).sort());
    const flakes = sets.filter((s) => s !== ref).length;
    const serialS = ([...serial.outcome.values()].reduce((s, o) => s + o.durationMs, 0) / 1000).toFixed(1);
    console.log(`\nDeterminism: ${ids.length} non-emulator units; serial (sum of unit time) ${serialS}s; parallel wall-clock ${times.join("s, ")}s; runs differing from serial: ${flakes}/3; failing in serial: ${fmt([...serial.outcome.entries()].filter(([, o]) => !o.ok).map(([id]) => id))}`);
  }

  console.log(`\nSummary: ${results.filter((r) => r.ok).length}/${results.length} checks passed — ${results.map((r) => `${r.n}:${r.ok ? "PASS" : "FAIL"}`).join(" ")}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
