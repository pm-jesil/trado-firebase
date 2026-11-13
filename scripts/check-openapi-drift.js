#!/usr/bin/env node
/**
 * @guard-scope: artifacts docs/openapi.json against scripts/generate-openapi.js output
 * Trado Firebase — OpenAPI Drift Checker
 *
 * Verifies that docs/openapi.json is up to date with the current
 * api-manifest.json and compiled Zod schemas.
 *
 * Exit 0 if in sync, exit 1 if stale or missing.
 * Integrated into the test:static pipeline.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OPENAPI_PATH = path.join(ROOT, "docs", "openapi.json");
const MANIFEST_PATH = path.join(ROOT, "tests", "api", "api-manifest.json");

let exitCode = 0;

// 1. Check file exists
if (!fs.existsSync(OPENAPI_PATH)) {
  console.error("[FAIL] docs/openapi.json does not exist.");
  console.error("       Run: node scripts/generate-openapi.js");
  process.exit(1);
}

// 2. Load both files
const spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

// 3. Compare callable counts
const manifestCallables = manifest.endpoints.filter(
  (e) => e.triggerType === "callable"
);
const manifestTriggers = manifest.endpoints.filter(
  (e) => e.triggerType !== "callable"
);

const specPaths = Object.keys(spec.paths || {});
const specCallableNames = specPaths
  .filter((p) => p.startsWith("/api/callables/"))
  .map((p) => p.replace("/api/callables/", ""));

console.log(`[CHECK] Manifest callables: ${manifestCallables.length}`);
console.log(`[CHECK] OpenAPI operations:  ${specCallableNames.length}`);
console.log(`[CHECK] Manifest triggers:   ${manifestTriggers.length}`);
console.log(
  `[CHECK] OpenAPI x-triggers:  ${(spec["x-triggers"] || []).length}`
);

// 4. Every manifest callable must have an OpenAPI path
const specSet = new Set(specCallableNames);
const missing = manifestCallables
  .map((e) => e.exportName)
  .filter((n) => !specSet.has(n));

if (missing.length > 0) {
  console.error(
    `[FAIL] ${missing.length} callables in manifest but missing from OpenAPI:`
  );
  missing.forEach((n) => console.error(`       - ${n}`));
  exitCode = 1;
}

// 5. No extra callables in OpenAPI that aren't in manifest
const manifestSet = new Set(manifestCallables.map((e) => e.exportName));
const extra = specCallableNames.filter((n) => !manifestSet.has(n));

if (extra.length > 0) {
  console.error(
    `[FAIL] ${extra.length} callables in OpenAPI but not in manifest:`
  );
  extra.forEach((n) => console.error(`       - ${n}`));
  exitCode = 1;
}

// 6. Trigger count matches
if ((spec["x-triggers"] || []).length !== manifestTriggers.length) {
  console.error(
    `[FAIL] Trigger count mismatch: OpenAPI has ${
      (spec["x-triggers"] || []).length
    }, manifest has ${manifestTriggers.length}`
  );
  exitCode = 1;
}

// 7. Check x-meta consistency
const meta = spec["x-meta"] || {};
if (meta.callableCount !== manifestCallables.length) {
  console.error(
    `[FAIL] x-meta.callableCount (${meta.callableCount}) != manifest callables (${manifestCallables.length})`
  );
  exitCode = 1;
}

if (exitCode === 0) {
  console.log(
    `[PASS] docs/openapi.json is consistent with api-manifest.json (${specCallableNames.length} callables, ${manifestTriggers.length} triggers)`
  );
} else {
  console.error(
    "\n[ACTION] Regenerate: node scripts/generate-openapi.js"
  );
}

process.exit(exitCode);

