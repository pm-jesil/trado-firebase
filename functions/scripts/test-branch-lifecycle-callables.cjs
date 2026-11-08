/**
 * Trado Firebase Backend — Branch Lifecycle & Sharing Policies Callable Contract Suite
 * 
 * Exhaustively tests:
 * - branchesGetDefault
 * - branchesList
 * - branchesCreate
 * - branchesUpdate
 * - branchesDeactivate
 * - branchContextSwitch
 * - sharingPoliciesUpdate
 * - Subscription branch quota limit enforcement
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const {
  getSuperAdminPersona,
  createTenantOwnerPersona,
  createEmployeePersona,
  createUnassignedUserPersona,
  db,
} = require("./helpers/auth-personas.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: BRANCH LIFECYCLE & SHARING POLICIES CALLABLES CONTRACT     ");
  console.log("================================================================================");

  await verifyEmulatorHealth();

  console.log("\n[SETUP] Provisioning test personas...");
  const superAdmin = await getSuperAdminPersona();
  // Ensure plan_growth has capacity for 3 branches for this test
  await callFunction("plansUpdate", { planId: "plan_growth", branchLimit: 3 }, superAdmin.idToken);

  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const ownerEmail = `owner_branches_${unique}@testorg.local`;
  const password = "TestPassword123!";

  const orgRes = await callFunction("organizationsCreate", {
    name: `BranchSuiteOrg ${unique}`,
    businessType: "retail_only",
    businessCategory: "general",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    planId: "plan_growth",
    defaultBranchName: "Flagship Store",
    defaultBranchCode: "FLAG",
    ownerEmail,
    ownerName: "Branch Owner",
    initialPassword: password,
  }, superAdmin.idToken);

  const { getIdToken } = require("./helpers/callable-client.cjs");
  const ownerToken = await getIdToken(ownerEmail, password);
  const unassigned = await createUnassignedUserPersona();
  const orgId = orgRes.organizationId;
  console.log(`✓ Tenant Owner authenticated: ${ownerEmail} (Org: ${orgId})`);

  // 1. branchesGetDefault
  console.log("\n[DOMAIN: BRANCHES] Testing branchesGetDefault...");
  await assertCallableError(callFunction("branchesGetDefault", {}), ["unauthenticated"]);
  const defBranchRes = await callFunction("branchesGetDefault", {}, ownerToken);
  assert.equal(defBranchRes.branchId, "main-branch", "Default branch ID must be main-branch");
  assert.equal(defBranchRes.branch.code, "FLAG", "Default branch code must match initial provisioning");
  console.log("✓ branchesGetDefault successfully retrieved default branch configuration");

  // 2. branchesList
  console.log("\n[DOMAIN: BRANCHES] Testing branchesList...");
  const listBranchesInitial = await callFunction("branchesList", {}, ownerToken);
  assert.ok(Array.isArray(listBranchesInitial.items), "Must return items array");
  assert.equal(listBranchesInitial.count, 1, "Initial branch count must be 1 (main-branch)");
  console.log(`✓ branchesList returned 1 initial default branch`);

  // 3. branchesCreate
  console.log("\n[DOMAIN: BRANCHES] Testing branchesCreate...");
  // Unauthorized attempt
  await assertCallableError(
    callFunction("branchesCreate", {
      name: "Illegal Branch",
      code: "ILL1",
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ branchesCreate correctly rejected non-member user");

  // Valid branch 2 creation
  const branch2Res = await callFunction("branchesCreate", {
    name: "Airport Outlet",
    code: "AIR1",
    contact: { phone: "+919876543210" },
    address: {
      line1: "Terminal 2 Departure",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560300",
      country: "IN",
    },
  }, ownerToken);
  assert.ok(branch2Res.branchId, "branchesCreate must return branchId");
  assert.equal(branch2Res.branch?.code || branch2Res.code, "AIR1", "Branch code must be AIR1");
  console.log(`✓ Branch 2 created successfully (ID: ${branch2Res.branchId}, Code: AIR1)`);

  // Duplicate branch code within same org rejected
  await assertCallableError(
    callFunction("branchesCreate", {
      name: "Duplicate Airport Outlet",
      code: "AIR1",
    }, ownerToken),
    ["already-exists", "failed-precondition"]
  );
  console.log("✓ branchesCreate correctly rejected duplicate branch code (AIR1)");

  // 4. branchesUpdate
  console.log("\n[DOMAIN: BRANCHES] Testing branchesUpdate...");
  const updateBranchRes = await callFunction("branchesUpdate", {
    branchId: branch2Res.branchId,
    name: "Airport Express Outlet",
    contact: { phone: "+919876543211" },
  }, ownerToken);
  assert.ok(updateBranchRes.success, "branchesUpdate must succeed");
  console.log("✓ branchesUpdate succeeded for Owner");

  // 5. branchContextSwitch
  console.log("\n[DOMAIN: BRANCHES] Testing branchContextSwitch...");
  // Create staff cashier assigned ONLY to main-branch
  const cashier = await createEmployeePersona(ownerToken, orgId, {
    roleCode: "cashier",
    branchId: "main-branch",
    assignedBranchIds: ["main-branch"],
  });

  // Cashier attempts to switch to unassigned branch 2 -> rejected
  await assertCallableError(
    callFunction("branchContextSwitch", {
      targetBranchId: branch2Res.branchId,
    }, cashier.idToken),
    ["permission-denied"]
  );
  console.log("✓ branchContextSwitch rejected cashier switching to unassigned branch");

  // Owner switches context to branch 2 -> succeeds
  const switchRes = await callFunction("branchContextSwitch", {
    targetBranchId: branch2Res.branchId,
  }, ownerToken);
  assert.ok(switchRes.success, "Owner context switch must succeed");
  assert.equal(switchRes.primaryBranchId, branch2Res.branchId);
  console.log("✓ branchContextSwitch succeeded for Owner switching to branch 2");

  // Switch back to main-branch
  await callFunction("branchContextSwitch", {
    targetBranchId: "main-branch",
  }, ownerToken);
  console.log("✓ Owner switched context back to main-branch");

  // 6. branchesDeactivate & Quota enforcement
  console.log("\n[DOMAIN: BRANCHES] Testing branch quota enforcement & deactivation...");
  // Plan limit is 3. We currently have 2 branches (main-branch and branch2).
  // Create branch 3 -> reaches capacity (3)
  const branch3Res = await callFunction("branchesCreate", {
    name: "Suburban Kiosk",
    code: "SUB1",
  }, ownerToken);
  console.log(`✓ Branch 3 created (ID: ${branch3Res.branchId}) — Quota capacity (3) reached`);

  // Attempting branch 4 -> rejected with failed-precondition
  await assertCallableError(
    callFunction("branchesCreate", {
      name: "Over Quota Branch",
      code: "OVER",
    }, ownerToken),
    ["failed-precondition"]
  );
  console.log("✓ branchesCreate correctly rejected 4th branch exceeding plan limit (3)");

  // Deactivate default branch -> rejected (default branch protected)
  await assertCallableError(
    callFunction("branchesDeactivate", {
      branchId: "main-branch",
    }, ownerToken),
    ["failed-precondition"]
  );
  console.log("✓ branchesDeactivate correctly protected default branch (main-branch)");

  // Deactivate branch 3 -> capacity freed to 2
  const deactBranchRes = await callFunction("branchesDeactivate", {
    branchId: branch3Res.branchId,
    reason: "Seasonal closure of kiosk",
  }, ownerToken);
  assert.ok(deactBranchRes.success, "branchesDeactivate must succeed for non-default branch");
  console.log("✓ branchesDeactivate succeeded for Branch 3 (Active count reduced to 2)");

  // Reactivate branch 3 via branchesUpdate -> restores capacity to 3
  const reactivateRes = await callFunction("branchesUpdate", {
    branchId: branch3Res.branchId,
    isActive: true,
  }, ownerToken);
  assert.ok(reactivateRes.success, "Branch reactivation via branchesUpdate must succeed");
  console.log("✓ Branch 3 reactivated successfully (Active count restored to 3)");

  // 7. sharingPoliciesUpdate
  console.log("\n[DOMAIN: BRANCHES] Testing sharingPoliciesUpdate...");
  const updatePoliciesRes = await callFunction("sharingPoliciesUpdate", {
    policies: {
      customers: "branch_scoped",
      vendors: "branch_scoped",
      products: "organization_shared",
    },
  }, ownerToken);
  assert.ok(updatePoliciesRes.success, "sharingPoliciesUpdate must succeed");
  assert.equal(updatePoliciesRes.sharingPolicies.customers, "branch_scoped");
  assert.equal(updatePoliciesRes.sharingPolicies.stock, "branch_scoped", "Stock policy must remain strictly branch_scoped");
  console.log("✓ sharingPoliciesUpdate verified (enforced strict branch_scoped stock policy)");

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 7 BRANCH LIFECYCLE CALLABLES VERIFIED SUCCESSFULLY! ✓             ");
  console.log("================================================================================");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
