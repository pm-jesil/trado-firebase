/**
 * Backward Compatibility Wrapper
 * 
 * Forwards execution to canonical semantic callable suites:
 * test-tenancy-auth-callables.cjs
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

console.log("[COMPATIBILITY WRAPPER] Forwarding test-callables-integration.js -> test-tenancy-auth-callables.cjs\n");

const target = path.join(__dirname, "test-tenancy-auth-callables.cjs");
const res = spawnSync(process.execPath, [target], { stdio: "inherit" });
process.exit(res.status ?? 0);
