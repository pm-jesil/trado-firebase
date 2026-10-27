/**
 * Comprehensive Callable Integration Test Suite
 * 
 * Verifies against the Firebase Emulator Suite:
 * - Part 1: Custom claims (primaryOrganizationId, isSuperAdmin) verified on Auth tokens
 * - Part 4: Role-tier and org settings privilege escalation restrictions
 * - Part 5: Callable-level HTTP execution with Auth context & Zod validation
 * - Part 6: Firestore write atomicity (org + user + membership + audit + idempotency in single batch)
 * - Part 7: Concurrent idempotency collision with Promise.all
 * - Part 9: Multi-org employee deactivation (user isActive preserved when active elsewhere)
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import assert from "node:assert/strict";

const PROJECT_ID = "trado-x";
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const FUNCTIONS_HOST = "http://127.0.0.1:5001";

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();
const auth = getAuth();

/**
 * Helper to exchange email/password for an ID token via Auth Emulator REST API.
 */
async function getIdToken(email, password) {
  const url = `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Auth signIn failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

/**
 * Helper to call a 2nd Gen Firebase Callable function over HTTP.
 */
async function invokeCallable(functionName, payload, idToken = null) {
  const url = `${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1/${functionName}`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: payload }),
  });

  const responseJson = await res.json();
  return {
    status: res.status,
    ok: res.ok,
    data: responseJson.result,
    error: responseJson.error,
  };
}

async function runIntegrationSuite() {
  console.log("==========================================================");
  console.log("   TRADO FIREBASE BACKEND — PHASE 1 INTEGRATION SUITE    ");
  console.log("==========================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• Testing: ${name}... `);
    try {
      await fn();
      console.log("PASSED ✓");
      passed++;
    } catch (err) {
      console.log(`FAILED ✗\n  ${err.message}`);
      if (err.stack) console.log(`  ${err.stack.split("\n").slice(1, 3).join("\n")}`);
      failed++;
    }
  }

  // Pre-seed minimum required catalogs for test
  await db.collection("subscriptionPlans").doc("plan_growth").set({
    id: "plan_growth",
    name: "Growth",
    price: 2999,
    seatLimits: { admin: 3, staff: 20 },
    moduleFlags: { billing: true, sales: true, inventory: true, staff: true },
    isActive: true,
  });

  await db.collection("roles").doc("role_org_owner").set({
    name: "Organization Owner",
    code: "org_owner",
    permissions: ["*"],
    isSystem: true,
  });

  await db.collection("roles").doc("role_admin").set({
    name: "Administrator",
    code: "admin",
    permissions: ["org:view", "employee:create", "employee:view", "bill:create"],
    isSystem: true,
  });

  await db.collection("roles").doc("role_cashier").set({
    name: "Cashier",
    code: "cashier",
    permissions: ["bill:create", "bill:view"],
    isSystem: true,
  });

  // Setup Test Users
  const superAdminEmail = `superadmin_${Date.now()}@test.local`;
  const superAdminAuth = await auth.createUser({
    email: superAdminEmail,
    password: "Password123!",
  });
  await auth.setCustomUserClaims(superAdminAuth.uid, { isSuperAdmin: true });
  await db.collection("users").doc(superAdminAuth.uid).set({
    name: "Super Admin Tester",
    email: superAdminEmail,
    isActive: true,
    accountType: "admin",
  });
  const superAdminToken = await getIdToken(superAdminEmail, "Password123!");

  const regularUserEmail = `regular_${Date.now()}@test.local`;
  const regularUserAuth = await auth.createUser({
    email: regularUserEmail,
    password: "Password123!",
  });
  await db.collection("users").doc(regularUserAuth.uid).set({
    name: "Regular User",
    email: regularUserEmail,
    isActive: true,
    accountType: "standard",
  });
  const regularUserToken = await getIdToken(regularUserEmail, "Password123!");

  let createdOrgId = null;
  let createdOwnerUid = null;
  let createdOwnerToken = null;
  const orgOwnerEmail = `owner_${Date.now()}@apex.local`;

  // 1. Part 5: organizationsCreate unauthenticated rejection
  await test("organizationsCreate rejects unauthenticated call with 401 UNAUTHENTICATED", async () => {
    const res = await invokeCallable("organizationsCreate", {
      name: "Unauth Org",
      businessType: "retail_only",
      businessCategory: "general",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_growth",
      ownerEmail: "owner@unauth.local",
      ownerName: "Owner Name",
      idempotencyKey: `unauth_${Date.now()}`,
    }, null);

    assert.equal(res.status, 401);
    assert.equal(res.error?.status, "UNAUTHENTICATED");
  });

  // 2. Part 5: organizationsCreate non-super-admin rejection
  await test("organizationsCreate rejects non-superadmin caller with 403 PERMISSION_DENIED", async () => {
    const res = await invokeCallable("organizationsCreate", {
      name: "Forbidden Org",
      businessType: "retail_only",
      businessCategory: "general",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_growth",
      ownerEmail: "owner@forbidden.local",
      ownerName: "Owner Name",
      idempotencyKey: `forbidden_${Date.now()}`,
    }, regularUserToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  // 3. Part 1, 5, 6: Valid organizationsCreate provisioning, custom claims, and atomic batch
  const createOrgIdempKey = `create_org_${Date.now()}`;
  await test("organizationsCreate provisions org + sets primaryOrganizationId claim + commits batch atomically", async () => {
    const res = await invokeCallable("organizationsCreate", {
      name: "Apex Retailers Ltd",
      businessType: "retail_only",
      businessCategory: "general",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_growth",
      ownerEmail: orgOwnerEmail,
      ownerName: "Apex Owner",
      initialPassword: "ApexOwnerPassword123!",
      idempotencyKey: createOrgIdempKey,
    }, superAdminToken);

    assert.equal(res.ok, true, `Call failed: ${JSON.stringify(res.error)}`);
    assert.ok(res.data?.organizationId, "Expected organizationId");
    assert.ok(res.data?.ownerUserId, "Expected ownerUserId");

    createdOrgId = res.data.organizationId;
    createdOwnerUid = res.data.ownerUserId;

    // Part 1 Evidence: Check Auth user custom claims
    const ownerAuthUser = await auth.getUser(createdOwnerUid);
    assert.equal(
      ownerAuthUser.customClaims?.primaryOrganizationId,
      createdOrgId,
      "Owner Auth record must carry primaryOrganizationId custom claim"
    );

    // Part 6 Evidence: Check atomic Firestore writes
    const orgDoc = await db.collection("organizations").doc(createdOrgId).get();
    assert.equal(orgDoc.exists, true, "Organization doc must exist in Firestore");
    assert.equal(orgDoc.data()?.name, "Apex Retailers Ltd");

    const userDoc = await db.collection("users").doc(createdOwnerUid).get();
    assert.equal(userDoc.exists, true, "User doc must exist in Firestore");

    const memDoc = await db.collection("memberships").doc(`${createdOwnerUid}_${createdOrgId}`).get();
    assert.equal(memDoc.exists, true, "Membership doc must exist in Firestore");
    assert.equal(memDoc.data()?.roleId, "role_org_owner");

    const auditSnapshot = await db.collection("auditLogs").where("organizationId", "==", createdOrgId).get();
    assert.ok(auditSnapshot.docs.length >= 1, "Audit log must be created in batch");

    createdOwnerToken = await getIdToken(orgOwnerEmail, "ApexOwnerPassword123!");
  });

  // 4. Part 5: Idempotency replay returns cached result
  await test("organizationsCreate replayed with identical idempotencyKey returns cached duplicate result", async () => {
    const res = await invokeCallable("organizationsCreate", {
      name: "Apex Retailers Ltd",
      businessType: "retail_only",
      businessCategory: "general",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_growth",
      ownerEmail: orgOwnerEmail,
      ownerName: "Apex Owner",
      initialPassword: "ApexOwnerPassword123!",
      idempotencyKey: createOrgIdempKey,
    }, superAdminToken);

    assert.equal(res.ok, true);
    assert.equal(res.data?.organizationId, createdOrgId, "Must return exact cached organizationId");
    assert.equal(res.data?.ownerUserId, createdOwnerUid, "Must return exact cached ownerUserId");
  });

  // 5. Part 7: Concurrent Idempotency Test with Promise.all
  await test("Part 7: concurrent calls with identical idempotencyKey create exactly ONE organization", async () => {
    const concurrentKey = `concurrent_${Date.now()}`;
    const payload = {
      name: "Parallel Creations Org",
      businessType: "wholesale_only",
      businessCategory: "grocery_fmcg",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_growth",
      ownerEmail: `parallel_${Date.now()}@apex.local`,
      ownerName: "Parallel Owner",
      initialPassword: "ParallelPassword123!",
      idempotencyKey: concurrentKey,
    };

    // Fire both concurrently
    const [resA, resB] = await Promise.all([
      invokeCallable("organizationsCreate", payload, superAdminToken),
      invokeCallable("organizationsCreate", payload, superAdminToken),
    ]);

    // One must succeed, the other must either be the cached duplicate or rejected with ALREADY_EXISTS
    const successCount = (resA.ok ? 1 : 0) + (resB.ok ? 1 : 0);
    assert.ok(successCount >= 1, "At least one call must succeed");

    if (resA.ok && resB.ok) {
      assert.equal(resA.data.organizationId, resB.data.organizationId, "Both return identical organizationId");
    } else {
      const failedRes = resA.ok ? resB : resA;
      assert.equal(failedRes.error?.status, "ALREADY_EXISTS");
    }

    // Verify in Firestore that only ONE organization was created with this name
    const orgsQuery = await db.collection("organizations").where("name", "==", "Parallel Creations Org").get();
    assert.equal(orgsQuery.docs.length, 1, "Exactly ONE organization must exist in Firestore");
  });

  // 6. Part 4: Role-Management privilege escalation prevention
  let adminUid = null;
  let adminToken = null;
  const adminEmail = `admin_${Date.now()}@apex.local`;

  await test("employeesCreate allows Org Owner to provision an Admin", async () => {
    const res = await invokeCallable("employeesCreate", {
      organizationId: createdOrgId,
      name: "Apex Store Admin",
      email: adminEmail,
      roleId: "role_admin",
      initialPassword: "AdminPassword123!",
      idempotencyKey: `create_admin_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `Provisioning failed: ${JSON.stringify(res.error)}`);
    adminUid = res.data.userId;
    adminToken = await getIdToken(adminEmail, "AdminPassword123!");
  });

  await test("Part 4: Tenant Admin is rejected when attempting to create custom role (Owner-only)", async () => {
    const res = await invokeCallable("rolesCreate", {
      organizationId: createdOrgId,
      name: "Custom Escalated Role",
      code: "escalated_role",
      permissions: ["*"],
    }, adminToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  await test("Part 4: Tenant Admin is rejected when attempting to modify structural org settings", async () => {
    const res = await invokeCallable("organizationsUpdate", {
      organizationId: createdOrgId,
      businessType: "distributor", // structural field
    }, adminToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  await test("Part 4: Org Owner can successfully modify structural org settings", async () => {
    const res = await invokeCallable("organizationsUpdate", {
      organizationId: createdOrgId,
      name: "Apex Retailers & Distributors Ltd",
      businessType: "wholesale_retail",
    }, createdOwnerToken);

    assert.equal(res.ok, true);
    const orgDoc = await db.collection("organizations").doc(createdOrgId).get();
    assert.equal(orgDoc.data()?.businessType, "wholesale_retail");
  });

  // 7. Part 5: employeesCreate role escalation checks
  await test("employeesCreate prevents Admin from provisioning an Org Owner", async () => {
    const res = await invokeCallable("employeesCreate", {
      organizationId: createdOrgId,
      name: "Escalated Owner",
      email: `escalated_${Date.now()}@apex.local`,
      roleId: "role_org_owner",
      idempotencyKey: `esc_${Date.now()}`,
    }, adminToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  await test("employeesCreate prevents Admin from provisioning a peer Admin", async () => {
    const res = await invokeCallable("employeesCreate", {
      organizationId: createdOrgId,
      name: "Peer Admin",
      email: `peer_${Date.now()}@apex.local`,
      roleId: "role_admin",
      idempotencyKey: `peer_${Date.now()}`,
    }, adminToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  // 8. Part 5: employeesCreate cross-tenant isolation
  const secondOrgRef = db.collection("organizations").doc();
  const secondOrgId = secondOrgRef.id;
  await secondOrgRef.set({
    name: "Beta Corp",
    businessType: "retail_only",
    businessCategory: "general",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    planId: "plan_growth",
    status: "active",
    createdAt: new Date().toISOString(),
  });

  await test("employeesCreate denies cross-tenant provisioning into unauthorized organization", async () => {
    const res = await invokeCallable("employeesCreate", {
      organizationId: secondOrgId, // Target is Beta Corp, caller is Apex Owner
      name: "Intruder Employee",
      email: `intruder_${Date.now()}@beta.local`,
      roleId: "role_cashier",
      idempotencyKey: `cross_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  // 9. Part 5: authMe bootstrap test
  await test("authMe returns activeContext, role, and resolved permissions for Org Owner", async () => {
    const res = await invokeCallable("authMe", {}, createdOwnerToken);

    assert.equal(res.ok, true);
    assert.equal(res.data?.user?.email, orgOwnerEmail);
    assert.equal(res.data?.activeContext?.isOrgOwner, true);
    assert.equal(res.data?.activeContext?.roleCode, "org_owner");
    assert.ok(res.data?.activeContext?.effectivePermissions, "Expected resolved permissions");
  });

  await test("authMe returns isSuperAdmin flag for Platform Administrator", async () => {
    const res = await invokeCallable("authMe", {}, superAdminToken);

    assert.equal(res.ok, true);
    assert.equal(res.data?.isSuperAdmin, true);
  });

  // 10. Part 9: employeesDeactivate Multi-Org Check
  let multiOrgUserUid = null;
  let multiOrgUserToken = null;
  const multiOrgEmail = `multiorg_${Date.now()}@test.local`;

  await test("Part 9: employeesDeactivate preserves user isActive when active membership exists in another org", async () => {
    // 1. Provision user into Org 1
    const res1 = await invokeCallable("employeesCreate", {
      organizationId: createdOrgId,
      name: "Multi Org Worker",
      email: multiOrgEmail,
      roleId: "role_cashier",
      initialPassword: "MultiPassword123!",
      idempotencyKey: `multi1_${Date.now()}`,
    }, createdOwnerToken);
    assert.equal(res1.ok, true);
    multiOrgUserUid = res1.data.userId;
    const membership1Id = res1.data.membershipId;

    // 2. Add second membership in Org 2
    const membership2Id = `${multiOrgUserUid}_${secondOrgId}`;
    await db.collection("memberships").doc(membership2Id).set({
      userId: multiOrgUserUid,
      organizationId: secondOrgId,
      roleId: "role_cashier",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    // 3. Deactivate membership in Org 1
    const deactRes1 = await invokeCallable("employeesDeactivate", {
      organizationId: createdOrgId,
      membershipId: membership1Id,
      reason: "Shift ended at Org 1",
    }, createdOwnerToken);
    assert.equal(deactRes1.ok, true);

    // 4. Verify membership 1 is inactive
    const mem1Doc = await db.collection("memberships").doc(membership1Id).get();
    assert.equal(mem1Doc.data()?.status, "inactive");

    // 5. Verify user profile is STILL active because membership 2 in secondOrgId is active!
    const userDoc = await db.collection("users").doc(multiOrgUserUid).get();
    assert.equal(userDoc.data()?.isActive, true, "User must remain active while active in Org 2");

    // 6. Now deactivate membership 2 as Super Admin
    const deactRes2 = await invokeCallable("employeesDeactivate", {
      organizationId: secondOrgId,
      membershipId: membership2Id,
      reason: "Terminated at Org 2",
    }, superAdminToken);
    assert.equal(deactRes2.ok, true);

    // 7. Verify user profile is NOW inactive because 0 active memberships remain!
    const userDocFinal = await db.collection("users").doc(multiOrgUserUid).get();
    assert.equal(userDocFinal.data()?.isActive, false, "User must be deactivated when all memberships are inactive");
  });

  console.log("\n==========================================================");
  console.log(`   INTEGRATION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runIntegrationSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

