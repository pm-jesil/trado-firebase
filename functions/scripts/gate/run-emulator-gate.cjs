const { spawnSync } = require("node:child_process");
const path = require("node:path");

const FUNCS = path.resolve(__dirname, "..", "..");
const GATE = __dirname;

const steps = [
  ["SEED", process.execPath, [path.join(FUNCS, "lib", "scripts", "seed-emulator.js")], FUNCS],
  ["SCENARIO_REAL_WORLD", process.execPath, [path.join(FUNCS, "scripts", "test-real-world-scenarios.cjs")], FUNCS],
  ["SCENARIO_SUBSCRIPTION_AUDIT", process.execPath, [path.join(FUNCS, "scripts", "test-subscription-limits-and-audit-visibility.cjs")], FUNCS],
  ["SCENARIO_REQUESTS_FULL", process.execPath, [path.join(FUNCS, "scripts", "test-requests-scenarios.cjs")], FUNCS],
  ["SCENARIO_FINANCE_BRANCH", process.execPath, [path.join(FUNCS, "scripts", "test-financial-branch-inventory-scenarios.cjs")], FUNCS],
  ["MEMBERSHIP_PROVISIONING", process.execPath, [path.join(FUNCS, "scripts", "test-membership-provisioning.cjs")], FUNCS],
  ["BX2_ORG_POLICY_ACCEPTANCE", process.execPath, [path.join(GATE, "verify-bx2-emulator.cjs")], FUNCS],
  ["BX1_BX4_ACCEPTANCE", process.execPath, [path.join(GATE, "verify-bx1-bx4-emulator.cjs")], FUNCS],
  ["RULES_FIRESTORE_STORAGE", process.execPath, ["--test", path.join(FUNCS, "lib", "test", "rules", "firestoreRules.test.js"), path.join(FUNCS, "lib", "test", "rules", "storageRules.test.js")], FUNCS],
  ["CHECK_DATA_DUP", process.execPath, [path.join(FUNCS, "scripts", "check-data-duplication.cjs")], FUNCS],
  ["CHECK_DATA_SAME_DOC", process.execPath, [path.join(FUNCS, "scripts", "check-same-doc-duplicates.cjs")], FUNCS],
  ["CHECK_DATA_RAW_CENSUS", process.execPath, [path.join(FUNCS, "scripts", "check-raw-field-census.cjs")], FUNCS],
];

let failed = 0;
for (const [label, cmd, args, cwd] of steps) {
  console.log(`\n==================== [${label}] ====================`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
  console.log(`[${label}] EXIT CODE: ${r.status}`);
  if (r.status !== 0) failed++;
}

console.log(`\n=== LIVE EMULATOR GATE COMPLETE (failed=${failed}/${steps.length}) ===`);
process.exit(failed ? 1 : 0);
