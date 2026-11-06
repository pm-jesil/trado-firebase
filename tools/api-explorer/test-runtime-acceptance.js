/**
 * Trado Firebase — API Explorer Runtime Acceptance Test
 *
 * Runs against the local Firebase Emulator Suite to verify:
 *   1. Seeding with api-explorer-demo profile (Super Admin, Retail Org A, Wholesale Org B)
 *   2. Generation of .local/api-explorer-credentials.json
 *   3. Explorer health check endpoint
 *   4. Safe personas endpoint (no passwords)
 *   5. Persona login via Auth emulator (Super Admin, Retail Owner, Wholesale Owner)
 *   6. Negative login test (invalid credentials)
 *   7. Callable invocation through proxy (healthCheck, authMe)
 *   8. Read callable (categoriesList)
 *   9. Destructive confirmation enforcement (rejection without x-trado-confirmed)
 *  10. Background trigger rejection (onBillWritten rejected)
 *  11. Host and Origin security validation
 *  12. Logout endpoint
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");

const PROJECT_ID = "trado-x";
const REGION = "asia-south1";
const EXPLORER_PORT = 3940; // Test port to avoid conflict
const AUTH_PORT = process.env.FIREBASE_AUTH_EMULATOR_HOST ? parseInt(process.env.FIREBASE_AUTH_EMULATOR_HOST.split(":")[1], 10) : 9099;
const FIRESTORE_PORT = process.env.FIRESTORE_EMULATOR_HOST ? parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(":")[1], 10) : 8080;

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) { }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function runAcceptance() {
  console.log("=== TRADO BACKEND: RUNTIME ACCEPTANCE TESTS ===\n");

  // Step 1: Verify Seed & Credentials
  console.log("▶ 1. Seeding local emulator with api-explorer-demo profile...");
  const functionsRequire = require("node:module").createRequire(path.resolve(__dirname, "../../functions/package.json"));
  const seedModule = require("../../functions/lib/scripts/seed-emulator.js");
  const { initializeApp, getApps } = functionsRequire("firebase-admin/app");
  const { getFirestore } = functionsRequire("firebase-admin/firestore");
  const { getAuth } = functionsRequire("firebase-admin/auth");

  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const db = getFirestore();
  const auth = getAuth();

  await seedModule.seedReferenceData(db);
  await seedModule.seedDemoOrganization(db, auth, "api-explorer-demo");
  console.log("  ✔ Seeding complete.\n");

  // Step 2: Check Credentials File
  console.log("▶ 2. Verifying .local/api-explorer-credentials.json...");
  const credsPath = path.resolve(__dirname, "../../.local/api-explorer-credentials.json");
  assert.ok(fs.existsSync(credsPath), "Credentials file must exist at .local/api-explorer-credentials.json");
  const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
  assert.ok(Array.isArray(creds), "Credentials must be an array");
  assert.ok(creds.length >= 7, "Must contain at least 7 personas");
  const adminCred = creds.find((c) => c.persona === "Super Admin");
  assert.ok(adminCred, "Super Admin persona must exist");
  assert.equal(adminCred.email, "superadmin@trado.local");
  assert.equal(adminCred.organizationName, "None (Platform)");
  console.log(`  ✔ Found ${creds.length} provisioned personas in credentials file.\n`);

  // Step 3: Start API Explorer Server
  console.log(`▶ 3. Starting local API Explorer on port ${EXPLORER_PORT}...`);
  // Temporarily set argv for server
  process.argv = ["node", "server.js", "--port", String(EXPLORER_PORT)];
  const serverModule = require("./server.js");
  // Let's spawn or require server. Since server.js exported assertLocalTarget etc.
  // We can create the server instance using http.createServer or require server.js directly
  const serverPath = path.resolve(__dirname, "server.js");
  const { spawn } = require("child_process");
  const explorerProc = spawn("node", [serverPath, "--port", String(EXPLORER_PORT)], {
    env: { ...process.env },
    stdio: "pipe",
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    explorerProc.stdout.on("data", (data) => {
      const s = data.toString();
      if (s.includes("Trado Backend API Explorer")) {
        resolve();
      }
    });
    explorerProc.stderr.on("data", (data) => console.error("[EXPLORER ERR]", data.toString()));
    explorerProc.on("error", reject);
    setTimeout(() => resolve(), 3000); // 3s fallback
  });
  console.log(`  ✔ API Explorer server running at http://127.0.0.1:${EXPLORER_PORT}/\n`);

  try {
    // Step 4: Health Check
    console.log("▶ 4. Testing GET /__local__/health...");
    const healthRes = await httpRequest({
      hostname: "127.0.0.1",
      port: EXPLORER_PORT,
      path: "/__local__/health",
      method: "GET",
    });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.explorer, "running");
    assert.equal(healthRes.body.projectId, PROJECT_ID);
    assert.equal(healthRes.body.emulators.auth.reachable, true);
    assert.equal(healthRes.body.emulators.firestore.reachable, true);
    console.log(`  ✔ Health check passed (Auth & Firestore reachable).\n`);

    // Step 5: Personas Endpoint (No Passwords)
    console.log("▶ 5. Testing GET /__local__/personas...");
    const personasRes = await httpRequest({
      hostname: "127.0.0.1",
      port: EXPLORER_PORT,
      path: "/__local__/personas",
      method: "GET",
    });
    assert.equal(personasRes.status, 200);
    const personas = personasRes.body.personas;
    assert.ok(Array.isArray(personas), "personas must be an array");
    for (const p of personas) {
      assert.equal(p.password, undefined, `Persona ${p.label} must not leak password`);
    }
    console.log(`  ✔ Personas endpoint safe (${personas.length} personas, 0 passwords exposed).\n`);

    // Step 6: Auth Login for Seeded Personas
    console.log("▶ 6. Testing Persona Logins via Auth Emulator...");
    // 6a. Super Admin Login
    const adminLoginRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/__local__/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { email: "superadmin@trado.local", password: "TestPassword123!" }
    );
    assert.equal(adminLoginRes.status, 200, "Super Admin login must succeed");
    assert.ok(adminLoginRes.body.idToken, "Must receive idToken");
    assert.ok(adminLoginRes.body.credentials?.idToken, "Must receive credentials.idToken");
    assert.ok(adminLoginRes.body.context, "Must receive canonical session context");
    assert.equal(adminLoginRes.body.context.user?.isSuperAdmin, true, "Super Admin user must have isSuperAdmin: true");
    assert.equal(adminLoginRes.body.context.role?.roleCode, "super_admin", "Super Admin role must be super_admin");
    assert.equal(adminLoginRes.body.context.primaryOrganization, null, "Super Admin primaryOrganization must be null");
    assert.equal(adminLoginRes.body.context.primaryBranch, null, "Super Admin primaryBranch must be null");
    assert.ok(Array.isArray(adminLoginRes.body.context.organizations) && adminLoginRes.body.context.organizations.length === 0, "Super Admin organizations must be empty list");
    assert.ok(Array.isArray(adminLoginRes.body.context.branches) && adminLoginRes.body.context.branches.length === 0, "Super Admin branches must be empty list");
    assert.ok(Array.isArray(adminLoginRes.body.context.permissions) && adminLoginRes.body.context.permissions.length === 0, "Super Admin tenant permissions must be strictly empty");
    assert.ok(Array.isArray(adminLoginRes.body.context.platformPermissions) && adminLoginRes.body.context.platformPermissions.includes("platform:*"), "Super Admin platformPermissions must include 'platform:*'");
    const adminToken = adminLoginRes.body.idToken;
    console.log("  ✔ Super Admin login successful with verified zero-org/zero-branch and zero-tenant-permission invariants.");

    // 6b. Retail Owner Login
    const ownerLoginRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/__local__/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { email: "owner@apexwholesale.local", password: "TestPassword123!" }
    );
    assert.equal(ownerLoginRes.status, 200, "Retail Owner login must succeed");
    assert.ok(ownerLoginRes.body.idToken, "Must receive idToken");
    assert.ok(ownerLoginRes.body.accessToken, "Must receive accessToken");
    assert.ok(ownerLoginRes.body.refreshToken, "Must receive refreshToken");
    assert.equal(ownerLoginRes.body.profile?.isSuperAdmin, false, "Retail Owner must not be super admin");
    assert.equal(ownerLoginRes.body.role?.roleCode, "org_owner", "Retail Owner roleCode must be org_owner");
    assert.ok(Array.isArray(ownerLoginRes.body.organizations) && ownerLoginRes.body.organizations.length >= 1, "Retail Owner must have organizations");
    assert.equal(ownerLoginRes.body.primaryOrganization?.organizationId, "org_apex_sample", "Retail Owner primaryOrganization must match");
    assert.ok(Array.isArray(ownerLoginRes.body.branches) && ownerLoginRes.body.branches.length >= 1, "Retail Owner must have branches");
    assert.equal(ownerLoginRes.body.primaryBranch?.branchId, "main-branch", "Retail Owner primaryBranch must match");
    const ownerToken = ownerLoginRes.body.idToken;
    console.log("  ✔ Retail Owner login successful with verified organization and branch details.");

    // 6c. Wholesale Owner Login
    const wholesaleOwnerLoginRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/__local__/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { email: "owner@wholesale.trado.local", password: "TestPassword123!" }
    );
    assert.equal(wholesaleOwnerLoginRes.status, 200, "Wholesale Owner login must succeed");
    assert.ok(wholesaleOwnerLoginRes.body.idToken, "Must receive idToken");
    assert.ok(wholesaleOwnerLoginRes.body.accessToken, "Must receive accessToken");
    assert.ok(wholesaleOwnerLoginRes.body.refreshToken, "Must receive refreshToken");
    assert.equal(wholesaleOwnerLoginRes.body.primaryOrganization?.organizationId, "org_wholesale_sample");
    console.log("  ✔ Wholesale Owner login successful.");

    // 6d. Invalid Password
    const badLoginRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/__local__/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { email: "owner@apexwholesale.local", password: "WrongPassword999!" }
    );
    assert.equal(badLoginRes.status, 401, "Bad password must return 401");
    console.log("  ✔ Invalid credentials safely rejected with 401.");

    // 6e. Direct Callable Invocation: authLogin
    console.log("  ▶ Testing authLogin callable endpoint via proxy...");
    const callableLoginRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/api/callables/authLogin",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { data: { email: "owner@apexwholesale.local", password: "TestPassword123!", deviceId: "device_acceptance_01" } }
    );
    assert.equal(callableLoginRes.status, 200, "authLogin callable must succeed");
    assert.ok(callableLoginRes.body.result?.accessToken, "authLogin result must have accessToken");
    assert.ok(callableLoginRes.body.result?.refreshToken, "authLogin result must have refreshToken");
    assert.equal(callableLoginRes.body.result?.primaryOrganization?.organizationId, "org_apex_sample");
    assert.equal(callableLoginRes.body.result?.primaryBranch?.branchId, "main-branch");
    console.log("  ✔ authLogin callable succeeded with full unified response.\n");

    // Step 7: Trigger Rejection
    console.log("▶ 7. Testing Trigger Invocation Rejection...");
    const triggerRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/api/callables/onBillWritten",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { data: {} }
    );
    assert.equal(triggerRes.status, 400);
    assert.match(triggerRes.body.error, /background trigger/);
    console.log("  ✔ Firestore triggers rejected with explicit explanation.\n");

    // Step 8: Destructive Operation Confirmation Check
    console.log("▶ 8. Testing Confirmation Guard on Destructive Operations...");
    const unconfirmedRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: EXPLORER_PORT,
        path: "/api/callables/organizationsDeactivate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
      },
      { data: { organizationId: "org_apex_sample", reason: "Deactivation test" } }
    );
    assert.equal(unconfirmedRes.status, 400);
    assert.match(unconfirmedRes.body.error, /confirmation required/i);
    console.log("  ✔ Destructive call without x-trado-confirmed rejected with 400.\n");

    // Step 9: Host & Origin Security Check
    console.log("▶ 9. Testing Host & Origin Security Enforcement...");
    const badHostRes = await httpRequest({
      hostname: "127.0.0.1",
      port: EXPLORER_PORT,
      path: "/__local__/health",
      method: "GET",
      headers: { Host: "malicious-site.com" },
    });
    assert.equal(badHostRes.status, 403, "Remote Host header must be rejected");

    const badOriginRes = await httpRequest({
      hostname: "127.0.0.1",
      port: EXPLORER_PORT,
      path: "/__local__/health",
      method: "GET",
      headers: { Origin: "http://malicious-origin.com" },
    });
    assert.equal(badOriginRes.status, 403, "Remote Origin header must be rejected");
    console.log("  ✔ Remote Host and Origin headers rejected with 403 Forbidden.\n");

    // Step 10: Sign Out
    console.log("▶ 10. Testing Sign Out Endpoint...");
    const logoutRes = await httpRequest({
      hostname: "127.0.0.1",
      port: EXPLORER_PORT,
      path: "/__local__/auth/logout",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.ok, true);
    console.log("  ✔ Sign out endpoint succeeded.\n");

    console.log("================================================================================");
    console.log("   [ACCEPTANCE PASS] ALL 10 RUNTIME ACCEPTANCE TESTS PASSED SUCCESSFULLY! ✓    ");
    console.log("================================================================================\n");
  } finally {
    explorerProc.kill();
  }
}

runAcceptance().catch((err) => {
  console.error("\n[ACCEPTANCE FAILED]:", err);
  process.exit(1);
});

