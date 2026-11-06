/**
 * Backward Compatibility Wrapper
 * 
 * Forwards execution to canonical semantic E2E suite:
 * test-retail-lifecycle.e2e.js
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

console.log("[COMPATIBILITY WRAPPER] Forwarding test-e2e-business-flow.js -> test-retail-lifecycle.e2e.js\n");

const target = path.join(__dirname, "test-retail-lifecycle.e2e.js");
const res = spawnSync(process.execPath, [target], { stdio: "inherit" });
process.exit(res.status ?? 0);
