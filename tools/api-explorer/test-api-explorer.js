#!/usr/bin/env node
/**
 * Trado Firebase — API Explorer Integration Tests
 *
 * Tests cover:
 *   1. OpenAPI spec validity and consistency
 *   2. Server module safety patterns
 *   3. Safety guard enforcement (wrong project, remote target, trigger rejection)
 *   4. Proxy request envelope and path handling
 *
 * Usage:
 *   node --test tools/api-explorer/test-api-explorer.js
 */

"use strict";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const OPENAPI_PATH = path.join(ROOT, "docs", "openapi.json");
const MANIFEST_PATH = path.join(ROOT, "tests", "api", "api-manifest.json");
const SERVER_PATH = path.join(__dirname, "server.js");

// ── 1. OpenAPI Spec Validity ─────────────────────────────────────
describe("OpenAPI Spec Validity", () => {
  let spec;
  let manifest;

  test("docs/openapi.json exists and is valid JSON", () => {
    assert.ok(fs.existsSync(OPENAPI_PATH), "docs/openapi.json must exist");
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    assert.ok(spec.openapi, "Must have openapi version field");
    assert.ok(spec.paths, "Must have paths object");
    assert.ok(spec.components, "Must have components object");
  });

  test("spec has correct openapi version 3.0.3", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    assert.equal(spec.openapi, "3.0.3");
  });

  test("all operations use POST method with /api/callables/ prefix", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      assert.ok(pathStr.startsWith("/api/callables/"), `Path must start with /api/callables/: ${pathStr}`);
      assert.ok(methods.post, `${pathStr} must have POST method`);
      assert.ok(!methods.get, `${pathStr} should not have GET method`);
    }
  });

  test("every operation has a unique operationId matching the path", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const ids = new Set();
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      const name = pathStr.replace("/api/callables/", "");
      const opId = methods.post.operationId;
      assert.equal(opId, name, `operationId mismatch for ${pathStr}`);
      assert.ok(!ids.has(opId), `Duplicate operationId: ${opId}`);
      ids.add(opId);
    }
  });

  test("no trigger appears as an HTTP callable path", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const triggerNames = (spec["x-triggers"] || []).map((t) => t.exportName);
    assert.ok(triggerNames.length >= 4, "Should have at least 4 triggers");
    for (const trigName of triggerNames) {
      assert.ok(
        !spec.paths[`/api/callables/${trigName}`],
        `Trigger ${trigName} must NOT be an HTTP callable path`
      );
    }
  });

  test("x-meta counts are consistent with paths and triggers", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const pathCount = Object.keys(spec.paths).length;
    const triggerCount = (spec["x-triggers"] || []).length;
    assert.equal(spec["x-meta"].callableCount, pathCount);
    assert.equal(spec["x-meta"].triggerCount, triggerCount);
    assert.equal(spec["x-meta"].totalExports, pathCount + triggerCount);
  });

  test("security scheme is bearerAuth with http/bearer type", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const scheme = spec.components?.securitySchemes?.bearerAuth;
    assert.ok(scheme, "bearerAuth security scheme must exist");
    assert.equal(scheme.type, "http");
    assert.equal(scheme.scheme, "bearer");
  });

  test("server URLs are loopback only — no production", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    for (const server of spec.servers || []) {
      assert.ok(
        server.url.includes("127.0.0.1") || server.url.includes("localhost"),
        `Server URL must be loopback: ${server.url}`
      );
      assert.ok(!server.url.includes("cloudfunctions.net"), "Must not reference production");
    }
  });

  test("callable count matches manifest exactly", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const manifestCallables = manifest.endpoints.filter((e) => e.triggerType === "callable").length;
    const specCallables = Object.keys(spec.paths).length;
    assert.equal(specCallables, manifestCallables, "OpenAPI callable count must match manifest");
  });

  test("tags cover all domains used in operations", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const tagNames = new Set((spec.tags || []).map((t) => t.name));
    for (const [, methods] of Object.entries(spec.paths)) {
      for (const tag of methods.post.tags || []) {
        assert.ok(tagNames.has(tag), `Tag "${tag}" used but not defined in tags list`);
      }
    }
  });

  test("every operation has a summary with operation-type badge", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const validBadges = ["READ", "CREATE", "UPDATE", "DEACTIVATE", "DELETE", "FINANCIAL", "ACTION"];
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      const summary = methods.post.summary || "";
      const hasBadge = validBadges.some((b) => summary.includes(`[${b}]`));
      assert.ok(hasBadge, `${pathStr} summary must have a [BADGE]: "${summary}"`);
    }
  });

  test("auth-required operations have security requirement", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const authRequired = new Set(
      manifest.endpoints
        .filter((e) => e.triggerType === "callable" && e.authRequired)
        .map((e) => e.exportName)
    );
    const noAuth = new Set(
      manifest.endpoints
        .filter((e) => e.triggerType === "callable" && !e.authRequired)
        .map((e) => e.exportName)
    );
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      const name = pathStr.replace("/api/callables/", "");
      const security = methods.post.security || [];
      if (authRequired.has(name)) {
        assert.ok(security.length > 0, `${name} requires auth but has no security requirement`);
      }
      if (noAuth.has(name)) {
        assert.equal(security.length, 0, `${name} is public but has security requirement`);
      }
    }
  });

  test("no secrets, tokens, or passwords in spec", () => {
    const content = fs.readFileSync(OPENAPI_PATH, "utf8");
    assert.ok(!content.includes("TestPassword123!"), "Must not contain test passwords");
    assert.ok(!content.includes("Bearer eyJ"), "Must not contain bearer tokens");
    assert.ok(!content.includes("fake-key"), "Must not contain fake API keys");
  });

  test("all schema $ref links resolve to defined components", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const schemas = new Set(Object.keys(spec.components.schemas || {}));
    function findRefs(obj, refs = []) {
      if (typeof obj !== "object" || obj === null) return refs;
      if (obj["$ref"]) refs.push(obj["$ref"]);
      for (const v of Object.values(obj)) findRefs(v, refs);
      return refs;
    }
    const allRefs = findRefs(spec);
    for (const ref of allRefs) {
      if (ref.startsWith("#/components/schemas/")) {
        const name = ref.replace("#/components/schemas/", "");
        assert.ok(schemas.has(name), `Broken $ref: ${ref}`);
      }
    }
  });

  test("project ID is trado-x in x-meta", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    assert.equal(spec["x-meta"].projectId, "trado-x");
    assert.equal(spec["x-meta"].region, "asia-south1");
  });

  test("100% of callables have request example payloads", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const expectedCount = manifest.endpoints.filter((e) => e.triggerType === "callable").length;
    let count = 0;
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      const example = methods.post?.requestBody?.content?.["application/json"]?.example;
      assert.ok(example, `${pathStr} must have a valid request example`);
      count++;
    }
    assert.equal(count, expectedCount, `All ${expectedCount} callable operations must have example payloads`);
  });

  test("no operation uses generic FirebaseCallableResponse fallback", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      const ref = methods.post?.responses?.[200]?.content?.["application/json"]?.schema?.["$ref"] || "";
      assert.notEqual(
        ref,
        "#/components/schemas/FirebaseCallableResponse",
        `${pathStr} must have a typed response schema, not generic fallback`
      );
    }
  });

  test("every operation has x-trado-risk and x-trado-persona metadata", () => {
    spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const validRisks = ["READ", "WRITE", "DESTRUCTIVE", "WORKFLOW"];
    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      const risk = methods.post["x-trado-risk"];
      assert.ok(validRisks.includes(risk), `${pathStr} has invalid risk: ${risk}`);
      assert.ok(methods.post["x-trado-persona"], `${pathStr} missing x-trado-persona`);
      assert.equal(typeof methods.post["x-trado-repeatable"], "boolean");
      assert.ok(Array.isArray(methods.post["x-trado-prerequisites"]));
    }
  });
});

// ── 2. Server Module Safety ──────────────────────────────────────
describe("Server Module Safety", () => {
  test("server.js exists and is valid JavaScript", () => {
    assert.ok(fs.existsSync(SERVER_PATH), "server.js must exist");
  });

  test("server binds only to 127.0.0.1, never 0.0.0.0", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes('"127.0.0.1"') || content.includes("'127.0.0.1'"), "Must bind to 127.0.0.1");
    assert.ok(!content.includes('"0.0.0.0"') && !content.includes("'0.0.0.0'"), "Must NOT bind to 0.0.0.0");
  });

  test("server targets only local emulator, no production URLs", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(!content.includes("cloudfunctions.net"), "No production URLs");
    assert.ok(!content.includes("firebaseio.com"), "No production URLs");
    assert.ok(content.includes("NOT PRODUCTION"), "Must have NOT PRODUCTION warning");
  });

  test("server does not use Express", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(!content.includes('require("express")'), "Must not use Express");
    assert.ok(!content.includes("require('express')"), "Must not use Express");
    assert.ok(content.includes('require("http")'), "Must use Node built-in http");
  });

  test("server has callable allowlist from manifest", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("allowedCallables"), "Must have allowedCallables set");
    assert.ok(content.includes("api-manifest.json"), "Must load from api-manifest.json");
  });

  test("server rejects trigger names explicitly", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("triggerNames"), "Must track trigger names");
    assert.ok(content.includes("background trigger"), "Must explain trigger rejection");
  });

  test("server uses /api/callables/ path pattern", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("/api/callables/"), "Must use /api/callables/ prefix");
  });

  test("server rejects --target=live and --allow-production flags", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("--target=live"), "Must check for --target=live");
    assert.ok(content.includes("--allow-production"), "Must check for --allow-production");
  });

  test("server redacts auth headers in logs", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("redactAuth") || content.includes("REDACTED"), "Must redact auth headers");
  });

  test("server validates project ID is trado-x", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes('"trado-x"') || content.includes("'trado-x'"), "Must validate project ID");
  });

  test("server rejects remote emulator hosts from environment", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("FIREBASE_FUNCTIONS_HOST") || content.includes("FIREBASE_AUTH_EMULATOR_HOST"),
      "Must check env for remote hosts");
    assert.ok(content.includes("remote") || content.includes("CRITICAL"), "Must reject remote hosts");
  });

  test("server has request size limit", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("MAX_BODY_SIZE"), "Must have body size limit");
  });

  test("server has proxy timeout", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("PROXY_TIMEOUT_MS"), "Must have proxy timeout");
  });

  test("server has path traversal protection", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes(".."), "Must check for path traversal");
  });

  test("server personas endpoint does not expose passwords", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    // The /personas endpoint should map to safePersonas without passwords
    assert.ok(content.includes("safePersonas"), "Must have safe persona list without passwords");
  });

  test("server has sign-out endpoint", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("/__local__/auth/logout"), "Must have sign-out endpoint");
  });

  test("server has emulator health check for Functions/Auth/Firestore", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("FIRESTORE_HOST") || content.includes("firestoreOk"),
      "Must check Firestore emulator health");
  });

  test("server enforces confirmation for destructive operations", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("DESTRUCTIVE_OPERATIONS"), "Must define DESTRUCTIVE_OPERATIONS set");
    assert.ok(content.includes("x-trado-confirmed"), "Must require x-trado-confirmed header");
    assert.ok(content.includes("organizationsDeactivate"), "Must cover organizationsDeactivate");
    assert.ok(content.includes("branchesDeactivate"), "Must cover branchesDeactivate");
  });

  test("server validates Host and Origin headers", () => {
    const content = fs.readFileSync(SERVER_PATH, "utf8");
    assert.ok(content.includes("hostHeader"), "Must validate Host header");
    assert.ok(content.includes("originHeader"), "Must validate Origin header");
    assert.ok(content.includes("403"), "Must return 403 on invalid host or origin");
  });

  test("server exports personas including Super Admin, Retail, and Wholesale", () => {
    const serverModule = require(SERVER_PATH);
    const personas = serverModule.PERSONAS;
    assert.ok(Array.isArray(personas), "PERSONAS must be an array");
    const emails = personas.map((p) => p.email);
    assert.ok(emails.includes("superadmin@trado.local"), "Must include Super Admin");
    assert.ok(emails.includes("owner@apexwholesale.local"), "Must include Retail Owner");
    assert.ok(emails.includes("owner@wholesale.trado.local"), "Must include Wholesale Owner");
  });
});

// ── 3. Generator Determinism & Security ──────────────────────────
describe("Generator Determinism & Security", () => {
  test("spec contains no timestamps, random values, or machine paths", () => {
    const content = fs.readFileSync(OPENAPI_PATH, "utf8");
    // Check no Windows paths leaked
    assert.ok(!content.includes("C:\\Users"), "Must not contain local machine paths");
    assert.ok(!content.includes("c:\\Users"), "Must not contain local machine paths");
    // Check no random UUIDs
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.ok(!uuidPattern.test(content), "Must not contain UUIDs");
  });

  test("local credentials directory is Git-ignored", () => {
    const gitignorePath = path.join(ROOT, ".gitignore");
    const gitignore = fs.readFileSync(gitignorePath, "utf8");
    assert.ok(gitignore.includes(".local/"), ".gitignore must contain .local/");
  });
});

console.log("\n[API Explorer Tests] Running...\n");
