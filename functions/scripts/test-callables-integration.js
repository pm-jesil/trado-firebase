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
import crypto from "node:crypto";

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

  await db.collection("roles").doc("role_employee").set({
    name: "Standard Employee",
    code: "employee",
    permissions: ["org:view", "employee:view"],
    isSystem: true,
  });

  await db.collection("roles").doc("role_cashier").set({
    name: "Cashier",
    code: "cashier",
    permissions: ["bill:create", "bill:view"],
    isSystem: false,
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
      description: "Attempted custom role creation by admin",
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

  // ============================================================
  // Phase 2 Operational Core Integration Tests
  // ============================================================
  console.log("\n--- Phase 2 Operational Core Integration Tests ---");

  // 11. Part 0: employeesCreate default role assignment (role_employee)
  let employeeDefaultRoleUserId = null;
  await test("Part 0: employeesCreate defaults to role_employee when roleId is omitted", async () => {
    const res = await invokeCallable("employeesCreate", {
      organizationId: createdOrgId,
      name: "Default Role Employee",
      email: `defaultrole_${Date.now()}@apexwholesale.local`,
      // roleId intentionally omitted to test default
      idempotencyKey: `emp_def_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true);
    employeeDefaultRoleUserId = res.data.userId;
    const memDoc = await db.collection("memberships").doc(res.data.membershipId).get();
    assert.equal(memDoc.data()?.roleId, "role_employee", "Must default to role_employee");
  });

  // 12. Part 0: Idempotency lease-expiry recovery test
  await test("Part 0: idempotency lease-expiry recovers stuck PROCESSING slot rather than permanently blocking", async () => {
    const stuckKey = `stuck_lease_${Date.now()}`;
    const testScope = createdOrgId;
    const recordId = crypto
      .createHash("sha256")
      .update(`${testScope}::${createdOwnerUid}::categories.create::${stuckKey}`)
      .digest("hex");

    // Manually inject an expired PROCESSING idempotency record (lease expired 60 seconds ago)
    const expiredDeadline = new Date(Date.now() - 60000).toISOString();
    await db.collection("idempotencyRecords").doc(recordId).set({
      operationId: `categories.create_stuck`,
      requestHash: crypto
        .createHash("sha256")
        .update('{"name":"Recovered Category","organizationId":"' + testScope + '"}')
        .digest("hex"),
      status: "processing",
      createdAt: new Date(Date.now() - 90000).toISOString(),
      processingExpiresAt: expiredDeadline,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    // Send category creation with the same idempotency key
    const res = await invokeCallable("categoriesCreate", {
      organizationId: testScope,
      name: "Recovered Category",
      idempotencyKey: stuckKey,
    }, createdOwnerToken);

    assert.equal(res.ok, true, "Call must recover from expired lease and succeed");
    assert.equal(res.data.name, "Recovered Category");
  });

  // 13. Products: Create product with initial stock
  let createdProductId = null;
  await test("productsCreate creates catalog product with maintained currentStock and movement record", async () => {
    const res = await invokeCallable("productsCreate", {
      organizationId: createdOrgId,
      name: "Whole Wheat Bread 400g",
      baseUnit: "pack",
      sellingPrice: 45,
      costPrice: 32,
      taxInclusive: false,
      taxRatePercent: 5,
      hasExpiry: true,
      trackStock: true,
      initialStock: 100,
      lowStockThreshold: 15,
      idempotencyKey: `prod_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true);
    assert.ok(res.data.productId);
    createdProductId = res.data.productId;
    assert.equal(res.data.currentStock, 100);

    // Verify stock document
    const prodDoc = await db.collection("products").doc(createdProductId).get();
    assert.equal(prodDoc.data()?.currentStock, 100);
    assert.equal(prodDoc.data()?.hasExpiry, true);

    // Verify initial stock movement
    const movements = await db.collection("stockMovements")
      .where("organizationId", "==", createdOrgId)
      .where("productId", "==", createdProductId)
      .get();
    assert.equal(movements.empty, false, "Must record initial stock movement");
    assert.equal(movements.docs[0].data()?.quantity, 100);
  });

  // 14. Customers: Create customer
  let createdCustomerId = null;
  await test("customersCreate auto-generates customerCode and saves profile", async () => {
    const res = await invokeCallable("customersCreate", {
      organizationId: createdOrgId,
      name: "City Mart Supermarket",
      mobile: "9876543210",
      email: "contact@citymart.local",
      taxNumber: "29ABCDE1234F1Z5",
      billingAddress: "42 Market Street, Bangalore",
      shippingAddress: "42 Market Street, Bangalore",
      creditLimit: 50000,
      idempotencyKey: `cust_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true);
    assert.ok(res.data.customerId);
    createdCustomerId = res.data.customerId;
    assert.match(res.data.customerCode, /^CUST-\d{6}$/);
  });

  // 15. Vendors: Create vendor
  let createdVendorId = null;
  await test("vendorsCreate auto-generates vendorCode and saves profile", async () => {
    const res = await invokeCallable("vendorsCreate", {
      organizationId: createdOrgId,
      name: "Golden Grain Mills",
      mobile: "9123456780",
      email: "orders@goldengrain.local",
      taxNumber: "29XYZAB5678C1Z2",
      address: "10 Industrial Area, Hubli",
      idempotencyKey: `vend_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true);
    assert.ok(res.data.vendorId);
    createdVendorId = res.data.vendorId;
    assert.match(res.data.vendorCode, /^VEND-\d{6}$/);
  });

  // 16. Outflows (Purchase): Purchase increases currentStock
  let purchaseOutflowId = null;
  await test("outflowsCreate (kind=purchase) transactionally increments product currentStock", async () => {
    const res = await invokeCallable("outflowsCreate", {
      organizationId: createdOrgId,
      kind: "purchase",
      vendorId: createdVendorId,
      vendorName: "Golden Grain Mills",
      lines: [
        {
          productId: createdProductId,
          itemName: "Whole Wheat Bread 400g",
          quantity: 50,
          unit: "pack",
          unitPrice: 30,
          addToStock: true,
        },
      ],
      paidAmount: 1500,
      paymentMethod: "bank_transfer",
      idempotencyKey: `pur_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `outflowsCreate (purchase) failed: ${JSON.stringify(res.error || res.data)}`);
    purchaseOutflowId = res.data.outflowId;
    assert.match(res.data.outflowNumber, /^PUR-\d{4}-\d{6}$/);
    assert.equal(res.data.totalAmount, 1500);
    assert.equal(res.data.paymentStatus, "paid");

    // Verify product currentStock increased from 100 to 150!
    const prodDoc = await db.collection("products").doc(createdProductId).get();
    assert.equal(prodDoc.data()?.currentStock, 150, "Stock must increment by 50 to 150");
  });

  // 17. Outflows (Expense): Operational expense records PAY voucher
  await test("outflowsCreate (kind=expense) creates expense record and payment ledger entry", async () => {
    const res = await invokeCallable("outflowsCreate", {
      organizationId: createdOrgId,
      kind: "expense",
      payee: "City Power Corporation",
      lines: [
        {
          itemName: "Electricity Bill - Store Floor",
          quantity: 1,
          unit: "month",
          unitPrice: 3500,
          addToStock: false,
        },
      ],
      paidAmount: 3500,
      paymentMethod: "upi",
      idempotencyKey: `exp_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `outflowsCreate (expense) failed: ${JSON.stringify(res.error || res.data)}`);
    assert.match(res.data.outflowNumber, /^EXP-\d{4}-\d{6}$/);
    assert.ok(res.data.paymentId, "Must create linked payment voucher");
  });

  // 18. Bills (POS Counter Sale): Decrements currentStock
  let createdBillId = null;
  await test("billsCreate (POS) generates bill, decrements currentStock, and records payment", async () => {
    const res = await invokeCallable("billsCreate", {
      organizationId: createdOrgId,
      salesMode: "pos",
      items: [
        {
          productId: createdProductId,
          quantity: 20,
        },
      ],
      paidAmount: 900,
      paymentMethod: "cash",
      idempotencyKey: `bill_pos_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `billsCreate failed: ${JSON.stringify(res.error || res.data)}`);
    createdBillId = res.data.billId;
    assert.match(res.data.billNumber, /^POS-\d{4}-\d{6}$/);

    // Verify product currentStock decreased from 150 to 130!
    const prodDoc = await db.collection("products").doc(createdProductId).get();
    assert.equal(prodDoc.data()?.currentStock, 130, "Stock must decrement by 20 to 130");
  });

  // 19. Deliveries: References billId by ID only (anti-embedding proof)
  await test("deliveriesCreate references billId by ID only without embedding bill document", async () => {
    const res = await invokeCallable("deliveriesCreate", {
      organizationId: createdOrgId,
      billId: createdBillId, // Reference by ID only!
      customerId: createdCustomerId,
      customerName: "City Mart Supermarket",
      customerPhone: "9876543210",
      address: {
        line1: "42 Market Street",
        city: "Bangalore",
        pincode: "560001",
      },
      partner: "internal",
      deliveryFee: 50,
      idempotencyKey: `deliv_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `deliveriesCreate failed: ${JSON.stringify(res.error || res.data)}`);
    assert.ok(res.data.deliveryId);

    // Verify stored document in Firestore: must NOT have 'bill' or 'items' embedded object
    const delDoc = await db.collection("deliveries").doc(res.data.deliveryId).get();
    const data = delDoc.data();
    assert.equal(data?.billId, createdBillId, "Must store billId reference");
    assert.equal(data?.bill, undefined, "Forbidden embed 'bill' must not exist");
    assert.equal(data?.items, undefined, "Forbidden embed 'items' must not exist");
  });

  // 20. Returns: Sales return restores physical stock
  await test("returnsCreate restores restocked items to product currentStock", async () => {
    const res = await invokeCallable("returnsCreate", {
      organizationId: createdOrgId,
      returnType: "sales_return",
      referenceId: createdBillId,
      items: [
        {
          productId: createdProductId,
          quantity: 5,
          refundAmount: 225,
          reason: "Customer ordered excess packs",
          disposition: "restocked_to_inventory",
        },
      ],
      refundMethod: "cash",
      idempotencyKey: `ret_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `returnsCreate failed: ${JSON.stringify(res.error || res.data)}`);
    assert.match(res.data.returnNumber, /^RET-\d{4}-\d{6}$/);

    // Verify stock restored from 130 to 135!
    const prodDoc = await db.collection("products").doc(createdProductId).get();
    assert.equal(prodDoc.data()?.currentStock, 135, "Stock must increase by 5 from restock to 135");
  });

  // 21. Stock adjustments: manual damage write-off
  await test("stockAdjust decrements stock and writes adjustment movement record", async () => {
    const res = await invokeCallable("stockAdjust", {
      organizationId: createdOrgId,
      productId: createdProductId,
      quantity: -5,
      reason: "Expired packages written off",
      idempotencyKey: `adj_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(res.ok, true);
    assert.equal(res.data.previousStock, 135);
    assert.equal(res.data.newStock, 130);

    const prodDoc = await db.collection("products").doc(createdProductId).get();
    assert.equal(prodDoc.data()?.currentStock, 130);
  });

  // 22. Cross-tenant rejection
  await test("Cross-tenant isolation: billsCreate rejects product belonging to another tenant", async () => {
    const res = await invokeCallable("billsCreate", {
      organizationId: secondOrgId, // Caller trying to sell Apex's product in Beta Corp
      salesMode: "pos",
      items: [
        {
          productId: createdProductId, // Product belongs to createdOrgId, not secondOrgId!
          quantity: 1,
        },
      ],
      idempotencyKey: `cross_prod_${Date.now()}`,
    }, superAdminToken);

    assert.equal(res.status, 403);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  });

  // 23. Idempotency replay on billsCreate
  await test("Idempotency: duplicate billsCreate returns exact cached result without double stock deduction", async () => {
    const idempKey = `replay_bill_${Date.now()}`;
    const payload = {
      organizationId: createdOrgId,
      salesMode: "pos",
      items: [{ productId: createdProductId, quantity: 2 }],
      idempotencyKey: idempKey,
    };

    // First attempt
    const res1 = await invokeCallable("billsCreate", payload, createdOwnerToken);
    assert.equal(res1.ok, true);
    const firstBillNumber = res1.data.billNumber;

    const stockAfterFirst = (await db.collection("products").doc(createdProductId).get()).data()?.currentStock;

    // Second attempt with same key
    const res2 = await invokeCallable("billsCreate", payload, createdOwnerToken);
    assert.equal(res2.ok, true);
    assert.equal(res2.data.billNumber, firstBillNumber, "Must return cached bill number");

    // Verify stock was NOT deducted a second time!
    const stockAfterSecond = (await db.collection("products").doc(createdProductId).get()).data()?.currentStock;
    assert.equal(stockAfterSecond, stockAfterFirst, "Stock must NOT be deducted twice on idempotent replay");
  });

  // 24. Barcode uniqueness enforcement & concurrent collision test
  await test("Part 8: barcode uniqueness rejects duplicate within organization and survives concurrent race", async () => {
    const testBarcode = `BARCODE_${Date.now()}`;

    // Create first product with barcode
    const res1 = await invokeCallable("productsCreate", {
      organizationId: createdOrgId,
      name: "Barcode Unique Product A",
      baseUnit: "piece",
      sellingPrice: 100,
      costPrice: 60,
      barcode: testBarcode,
      trackStock: true,
      initialStock: 10,
      idempotencyKey: `barc_1_${Date.now()}`,
    }, createdOwnerToken);
    assert.equal(res1.ok, true);

    // Sequential duplicate creation attempt must be rejected with ALREADY_EXISTS
    const res2 = await invokeCallable("productsCreate", {
      organizationId: createdOrgId,
      name: "Barcode Duplicate Product B",
      baseUnit: "piece",
      sellingPrice: 100,
      costPrice: 60,
      barcode: testBarcode, // Same barcode!
      trackStock: true,
      idempotencyKey: `barc_2_${Date.now()}`,
    }, createdOwnerToken);
    assert.equal(res2.status, 409);
    assert.equal(res2.error?.status, "ALREADY_EXISTS");

    // Concurrent race test: Fire two simultaneous creations with the same new barcode
    const raceBarcode = `RACE_BARCODE_${Date.now()}`;
    const [raceA, raceB] = await Promise.all([
      invokeCallable("productsCreate", {
        organizationId: createdOrgId,
        name: "Concurrent Race Product 1",
        baseUnit: "piece",
        sellingPrice: 50,
        costPrice: 30,
        barcode: raceBarcode,
        trackStock: false,
        idempotencyKey: `race_barc_a_${Date.now()}`,
      }, createdOwnerToken),
      invokeCallable("productsCreate", {
        organizationId: createdOrgId,
        name: "Concurrent Race Product 2",
        baseUnit: "piece",
        sellingPrice: 50,
        costPrice: 30,
        barcode: raceBarcode,
        trackStock: false,
        idempotencyKey: `race_barc_b_${Date.now()}`,
      }, createdOwnerToken),
    ]);

    // Exactly one must succeed, the other must fail with ALREADY_EXISTS
    const createdCount = (raceA.ok ? 1 : 0) + (raceB.ok ? 1 : 0);
    assert.equal(createdCount, 1, "Exactly one concurrent product creation must win barcode lock");
    const failedRace = raceA.ok ? raceB : raceA;
    assert.equal(failedRace.error?.status, "ALREADY_EXISTS");
  });

  // 25. Quotation / Draft Bill stock isolation & finalization
  let quotationBillId = null;
  await test("Part 4: quotation does NOT decrement stock until finalized via billsFinalize", async () => {
    // 1. Note stock before quotation
    const stockBefore = (await db.collection("products").doc(createdProductId).get()).data()?.currentStock;

    // 2. Create quotation (documentType = quotation)
    const qtnRes = await invokeCallable("billsCreate", {
      organizationId: createdOrgId,
      salesMode: "b2b",
      documentType: "quotation",
      items: [
        {
          productId: createdProductId,
          quantity: 10,
        },
      ],
      idempotencyKey: `qtn_${Date.now()}`,
    }, createdOwnerToken);

    assert.equal(qtnRes.ok, true, `Quotation creation failed: ${JSON.stringify(qtnRes.error)}`);
    quotationBillId = qtnRes.data.billId;
    assert.equal(qtnRes.data.status, "draft");
    assert.match(qtnRes.data.billNumber, /^QTN-\d{4}-\d{6}$/);

    // 3. Verify product currentStock remains unchanged!
    const stockAfterQtn = (await db.collection("products").doc(createdProductId).get()).data()?.currentStock;
    assert.equal(stockAfterQtn, stockBefore, "Quotation must NOT decrement physical stock");

    // 4. Verify ZERO stock movements were created for quotationBillId
    const qtnMovements = await db.collection("stockMovements")
      .where("referenceId", "==", quotationBillId)
      .get();
    assert.equal(qtnMovements.empty, true, "Quotation must create zero stock movements");

    // 5. Finalize the quotation into an active bill
    const finRes = await invokeCallable("billsFinalize", {
      organizationId: createdOrgId,
      billId: quotationBillId,
    }, createdOwnerToken);

    assert.equal(finRes.ok, true, `billsFinalize failed: ${JSON.stringify(finRes.error)}`);
    assert.equal(finRes.data.status, "active");

    // 6. Verify product currentStock is now decremented by 10!
    const stockAfterFin = (await db.collection("products").doc(createdProductId).get()).data()?.currentStock;
    assert.equal(stockAfterFin, stockBefore - 10, "Finalized quotation must decrement stock by 10");

    // 7. Verify stock movement was created on finalization
    const finalizedMovements = await db.collection("stockMovements")
      .where("referenceId", "==", quotationBillId)
      .get();
    assert.equal(finalizedMovements.docs.length, 1, "Finalized bill must have exactly 1 stock movement");
    assert.equal(finalizedMovements.docs[0].data()?.quantity, -10);
  });

  // 26. Part 6: Stock & Party Balance Reconciliation Tooling
  await test("Part 6: reconcileStockBalances confirms 0 discrepancies across all products and stockMovements", async () => {
    const res = await invokeCallable("reconcileStockBalances", {
      organizationId: createdOrgId,
    }, createdOwnerToken);

    assert.equal(res.ok, true, `reconcileStockBalances failed: ${JSON.stringify(res.error)}`);
    assert.ok(res.data.checkedCount > 0, "Must check at least 1 product");
    assert.equal(res.data.discrepancyCount, 0, "Must have exactly 0 stock discrepancies");
  });

  await test("Part 6: reconcilePartyLedgers confirms 0 discrepancies across customer and vendor ledgers", async () => {
    const custRes = await invokeCallable("reconcilePartyLedgers", {
      organizationId: createdOrgId,
      partyType: "customer",
    }, createdOwnerToken);

    assert.equal(custRes.ok, true);
    assert.equal(custRes.data.discrepancyCount, 0, "Must have 0 customer ledger discrepancies");

    const vendRes = await invokeCallable("reconcilePartyLedgers", {
      organizationId: createdOrgId,
      partyType: "vendor",
    }, createdOwnerToken);

    assert.equal(vendRes.ok, true);
    assert.equal(vendRes.data.discrepancyCount, 0, "Must have 0 vendor ledger discrepancies");
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
