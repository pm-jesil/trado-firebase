/**
 * Backward Compatibility Wrapper
 * 
 * Forwards execution to canonical semantic suites:
 * 1. test-operations-tasks-callables.cjs
 * 2. test-analytics-platform-callables.cjs
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

console.log("[COMPATIBILITY WRAPPER] Forwarding test-phase3-integration.js -> Operations & Analytics suites\n");

const s1 = path.join(__dirname, "test-operations-tasks-callables.cjs");
const r1 = spawnSync(process.execPath, [s1], { stdio: "inherit" });
if (r1.status !== 0) process.exit(r1.status ?? 1);

const s2 = path.join(__dirname, "test-analytics-platform-callables.cjs");
const r2 = spawnSync(process.execPath, [s2], { stdio: "inherit" });
process.exit(r2.status ?? 0);
