/**
 * Mutation spot-check (emulator only): proves that each security/correctness control is
 * guarded by a test that goes RED when the control is removed.
 *
 * For every entry: patch the compiled file (lib/… or the rules file), wait for the
 * functions emulator to hot-reload, run the guarding test (expect a non-zero exit),
 * restore the file, wait for reload, run the test again (expect exit 0).
 *
 * Usage (emulators running, `npm run build` done):
 *   EMULATOR_LOG=<path to emulator stdout> node scripts/mutation-spot-check.cjs [ids…]
 *   PRIOR=1 runs the pre-existing suite for controls guarded by the new "controls" section.
 *   SKIP_GREEN=1 skips the post-restore run (the full regression re-proves green).
 * The original file is always restored, including on failure or Ctrl+C.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { enforceLocalEmulatorSafety } = require("./helpers/emulator-helper.cjs");

const ROOT = path.resolve(__dirname, "..");
const node = process.execPath;
const gov = (sections) => ({ cmd: [node, "scripts/test-governance-flagship.cjs"], env: { GOV_ONLY: sections } });
const suite = (file) => ({ cmd: [node, `scripts/${file}`], env: {} });
const rulesTest = { cmd: [node, "--test", "--test-timeout=60000", "lib/test/rules/firestoreRules.test.js"], env: {} };

const MUTATIONS = [
  { id: 1, control: "core-module permission check (billsCreate et al.)", file: "lib/services/contextResolver.js",
    find: "if (!isSuperAdmin && !required.some(can)) {", replace: "if (false) {", test: gov("gate") },
  { id: 2, control: "plan-module entitlement check", file: "lib/services/contextResolver.js",
    find: "if (inPlan.length === 0) {", replace: "if (false) {", test: gov("gate") },
  { id: 3, control: "membership self-promotion block", file: "lib/callables/employees.js",
    find: "if (isSelf && privileged) {", replace: "if (false) {", test: gov("employees") },
  { id: "3b", control: "cross-organization membership edit block", file: "lib/callables/employees.js",
    find: "if (target.organizationId !== orgId) {", replace: "if (false) {", test: gov("controls"), prior: suite("test-tenancy-auth-callables.cjs") },
  { id: 4, control: "paymentsCreate cross-tenant document reference", file: "lib/callables/payments.js",
    find: "_a.organizationId) !== orgId) {", replace: "_a.organizationId) !== orgId && false) {", test: gov("controls"), prior: suite("test-parties-ledgers-callables.cjs") },
  { id: "4b", control: "paymentsCreate overpayment refusal", file: "lib/callables/payments.js",
    find: "if (input.amount > money_js_1.Money.amount(settled.balanceAmount || 0) + 0.005) {", replace: "if (false) {", test: gov("controls"), prior: suite("test-billing-procurement-callables.cjs") },
  { id: 5, control: "Super Admin tenant-mutation block", file: "lib/services/contextResolver.js",
    find: "if (tenantPerms.length > 0 && options.operation !== \"read\" && !tenantPerms.every(isReadOnlyPermission)) {", replace: "if (false) {", test: gov("gate") },
  { id: 6, control: "subscription-expired denial", file: "lib/services/contextResolver.js",
    find: "if (!isSuperAdmin && !subscription.allowed) {", replace: "if (false) {", test: gov("gate") },
  { id: 7, control: "seat limit (transactional counter)", file: "lib/callables/employees.js",
    find: "if (current >= capacity) {", replace: "if (current > capacity) {", test: gov("seats") },
  { id: 8, control: "rules: direct client read denial of business collections", file: "../firestore.rules",
    find: "      ] && isSuperAdmin();", replace: "      ] && (isSuperAdmin() || memberOfDocOrg());", test: rulesTest, noReload: true },
  { id: 9, control: "negative client usage metric rejection", file: "lib/callables/usage.js",
    find: "value < 0 || ", replace: "", test: gov("controls"), prior: suite("test-analytics-platform-callables.cjs") },
  { id: 10, control: "data-scope filter on lists", file: "lib/services/contextResolver.js",
    find: "function applyDataScope(query, scope, actorField = \"createdBy\") {\n", replace: "function applyDataScope(query, scope, actorField = \"createdBy\") {\n    return { query, keep: () => true };\n", test: gov("scope") },
  { id: 11, control: "cost-field redaction", file: "lib/services/redaction.js",
    find: "function canViewCost(ctx) {\n    return", replace: "function canViewCost(ctx) {\n    return true || ", test: gov("controls"), prior: suite("test-catalog-inventory-callables.cjs") },
  { id: 12, control: "usage hard block", file: "lib/services/contextResolver.js",
    find: "if (breach) {", replace: "if (false) {", test: gov("usage") },
  { id: 13, control: "same product on two lines (running balance)", file: "lib/services/stockEngine.js",
    find: "const prior = running.get(item.productId);", replace: "const prior = undefined;", test: gov("kitchen") },
  { id: 14, control: "branch assignment scope", file: "lib/services/contextResolver.js",
    find: "if (!membershipBranchData ||", replace: "if (false &&", test: gov("controls"), prior: suite("test-multibranch-isolation.e2e.js") },
];

const LOG = process.env.EMULATOR_LOG;
const reloadCount = () => (LOG && fs.existsSync(LOG) ? (fs.readFileSync(LOG, "utf8").match(/Loaded functions definitions/g) || []).length : 0);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitReload(before) {
  if (!LOG) return sleep(12_000);
  const deadline = Date.now() + 60_000;
  while (reloadCount() <= before && Date.now() < deadline) sleep(500);
  sleep(1_500);
}

function runTest(test) {
  const r = spawnSync(test.cmd[0], test.cmd.slice(1), { cwd: ROOT, env: { ...process.env, ...test.env }, encoding: "utf8", timeout: 1_200_000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const failLine = (out.match(/(AssertionError[^\n]*|\[FAIL\][^\n]*|Error: [^\n]*|not ok [^\n]*)/) || ["(no failure line)"])[0];
  return { code: r.status, failLine: failLine.slice(0, 160) };
}

let restoreFn = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { if (restoreFn) restoreFn(); process.exit(130); });

function main() {
  enforceLocalEmulatorSafety();
  const wanted = process.argv.slice(2);
  const rows = [];
  for (const m of MUTATIONS) {
    if (wanted.length && !wanted.includes(String(m.id))) continue;
    const file = path.resolve(ROOT, m.file);
    const original = fs.readFileSync(file, "utf8");
    const hits = original.split(m.find).length - 1;
    if (hits !== 1) {
      rows.push({ ...m, red: `ANCHOR x${hits}`, green: "-", verdict: "HARNESS ERROR" });
      continue;
    }
    restoreFn = () => fs.writeFileSync(file, original);
    let before = reloadCount();
    fs.writeFileSync(file, original.replace(m.find, m.replace));
    if (!m.noReload) waitReload(before);
    const red = runTest(process.env.PRIOR && m.prior ? m.prior : m.test);
    before = reloadCount();
    restoreFn();
    restoreFn = null;
    if (!m.noReload) waitReload(before);
    const green = process.env.SKIP_GREEN ? { code: "skipped" } : runTest(m.test);
    const verdict = red.code !== 0 && (green.code === 0 || green.code === "skipped") ? "GUARDED" : red.code === 0 ? "GAP (test stays green)" : "TEST BROKEN";
    rows.push({ ...m, red: red.code === 0 ? "green" : `RED (${red.failLine})`, green: green.code === 0 ? "GREEN" : String(green.code), verdict });
    console.log(`#${m.id} ${m.control}: mutated → ${rows[rows.length - 1].red}; restored → ${rows[rows.length - 1].green}; ${verdict}`);
  }
  console.log("\n| # | Control | Mutated (protection removed) | Restored | Verdict |\n|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.id} | ${r.control} | ${r.red.replace(/\|/g, "/")} | ${r.green} | ${r.verdict} |`);
  process.exit(rows.every((r) => r.verdict === "GUARDED") ? 0 : 1);
}

main();
