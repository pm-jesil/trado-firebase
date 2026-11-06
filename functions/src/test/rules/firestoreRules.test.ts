/**
 * Firestore Security Rules Unit Tests
 * 
 * Verifies:
 * - Unauthenticated access is denied.
 * - All direct client writes are denied (allow write: if false).
 * - Member can read allowed data in their own organization.
 * - Cross-tenant read access is strictly denied.
 * - Super Admin can read cross-organization data.
 * - Private profiles & device tokens are inaccessible to other users.
 * - auditLogs and idempotencyRecords are completely inaccessible to client SDKs.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

describe("Firestore Security Rules Matrix", () => {
  let testEnv: RulesTestEnvironment;
  const PROJECT_ID = "trado-x-rules-test";

  before(async () => {
    const rulesPath = path.resolve(process.cwd(), "..", "firestore.rules");
    let rulesContent = "";
    if (fs.existsSync(rulesPath)) {
      rulesContent = fs.readFileSync(rulesPath, "utf8");
    } else {
      rulesContent = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: "127.0.0.1",
        port: 8080,
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  // --- 1. Client Writes Denied Matrix ---
  it("denies unauthenticated client write to any collection", async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(unauthDb, "organizations", "org_1"), { name: "Hacked Org" })
    );
  });

  it("denies authenticated user direct write to server-owned collections", async () => {
    const userDb = testEnv.authenticatedContext("user_alice").firestore();

    // Direct write to organizations
    await assertFails(
      setDoc(doc(userDb, "organizations", "org_1"), { name: "Direct Client Org" })
    );

    // Direct write to users profile
    await assertFails(
      setDoc(doc(userDb, "users", "user_alice"), { name: "Direct Name Change" })
    );

    // Direct write to memberships
    await assertFails(
      setDoc(doc(userDb, "memberships", "user_alice_org_1"), { status: "active" })
    );

    // Direct write to roles
    await assertFails(
      setDoc(doc(userDb, "roles", "role_super"), { name: "Hacked Super Role" })
    );

    // Direct write to operational business collections
    await assertFails(
      setDoc(doc(userDb, "products", "prod_1"), { name: "Hacked Product", organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "bills", "bill_1"), { billNumber: "POS-2026-000001", organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "outflows", "outflow_1"), { outflowNumber: "PUR-2026-000001", organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "deliveries", "deliv_1"), { billId: "bill_1", organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "returns", "ret_1"), { returnNumber: "RET-2026-000001", organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "payments", "pay_1"), { amount: 500, organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "stockMovements", "mov_1"), { quantity: 10, organizationId: "org_1" })
    );
    await assertFails(
      setDoc(doc(userDb, "documentCounters", "org_1_POS_2026"), { currentSequence: 999 })
    );
  });

  // --- 2. Audit Logs & Idempotency Complete Denial ---
  it("completely denies client read and write to auditLogs, idempotencyRecords, and documentCounters", async () => {
    // Seed an audit log with admin SDK bypass
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await setDoc(doc(adminContext.firestore(), "auditLogs", "log_secret"), {
        action: "TEST_ACTION",
        actorUid: "system",
      });
      await setDoc(doc(adminContext.firestore(), "idempotencyRecords", "rec_secret"), {
        status: "succeeded",
      });
      await setDoc(doc(adminContext.firestore(), "documentCounters", "org_alpha_INV_2026"), {
        currentSequence: 42,
      });
    });

    const userDb = testEnv.authenticatedContext("user_alice").firestore();
    const superAdminDb = testEnv
      .authenticatedContext("user_super", { isSuperAdmin: true })
      .firestore();

    // User denied
    await assertFails(getDoc(doc(userDb, "auditLogs", "log_secret")));
    await assertFails(getDoc(doc(userDb, "idempotencyRecords", "rec_secret")));
    await assertFails(getDoc(doc(userDb, "documentCounters", "org_alpha_INV_2026")));

    // Even Super Admin client SDK is denied (writes/reads happen via Admin SDK only)
    await assertFails(getDoc(doc(superAdminDb, "auditLogs", "log_secret")));
    await assertFails(getDoc(doc(superAdminDb, "idempotencyRecords", "rec_secret")));
    await assertFails(getDoc(doc(superAdminDb, "documentCounters", "org_alpha_INV_2026")));
  });

  // --- 3. Profile & Device Token Access ---
  it("allows user to read their own profile, but denies reading other user profiles", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await setDoc(doc(adminContext.firestore(), "users", "user_alice"), {
        name: "Alice",
        email: "alice@test.local",
      });
      await setDoc(doc(adminContext.firestore(), "users", "user_bob"), {
        name: "Bob",
        email: "bob@test.local",
      });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();

    // Alice can read her own profile
    await assertSucceeds(getDoc(doc(aliceDb, "users", "user_alice")));

    // Alice CANNOT read Bob's profile
    await assertFails(getDoc(doc(aliceDb, "users", "user_bob")));
  });

  // --- 4. Multi-Tenant Isolation ---
  it("enforces multi-tenant isolation: member can read own org data, denied for other org", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      // Organization Alpha
      await setDoc(doc(adminContext.firestore(), "organizations", "org_alpha"), {
        name: "Alpha Corp",
        status: "active",
      });
      // Membership for Alice in Alpha
      await setDoc(doc(adminContext.firestore(), "memberships", "user_alice_org_alpha"), {
        userId: "user_alice",
        organizationId: "org_alpha",
        roleId: "role_cashier",
        status: "active",
      });

      // Organization Beta
      await setDoc(doc(adminContext.firestore(), "organizations", "org_beta"), {
        name: "Beta Corp",
        status: "active",
      });
      // Membership for Bob in Beta
      await setDoc(doc(adminContext.firestore(), "memberships", "user_bob_org_beta"), {
        userId: "user_bob",
        organizationId: "org_beta",
        roleId: "role_cashier",
        status: "active",
      });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();

    // Alice CAN read Alpha organization document
    await assertSucceeds(getDoc(doc(aliceDb, "organizations", "org_alpha")));

    // Alice CANNOT read Beta organization document (cross-tenant denied!)
    await assertFails(getDoc(doc(aliceDb, "organizations", "org_beta")));
  });

  // --- 5. Super Admin Cross-Tenant Reads ---
  it("allows Super Admin with trusted token claim to read across organizations", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await setDoc(doc(adminContext.firestore(), "organizations", "org_alpha"), {
        name: "Alpha Corp",
        status: "active",
      });
      await setDoc(doc(adminContext.firestore(), "organizations", "org_beta"), {
        name: "Beta Corp",
        status: "active",
      });
    });

    const superAdminDb = testEnv
      .authenticatedContext("user_super", { isSuperAdmin: true })
      .firestore();

    await assertSucceeds(getDoc(doc(superAdminDb, "organizations", "org_alpha")));
    await assertSucceeds(getDoc(doc(superAdminDb, "organizations", "org_beta")));
  });

  // --- 6. Platform Catalogs Read Access ---
  it("allows authenticated users to read platform catalogs (plans, modules, taxRegimes, permissionCatalog)", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await setDoc(doc(adminContext.firestore(), "subscriptionPlans", "plan_starter"), {
        name: "Starter",
      });
      await setDoc(doc(adminContext.firestore(), "modules", "billing"), {
        name: "Billing",
      });
      await setDoc(doc(adminContext.firestore(), "taxRegimes", "IN_GST"), {
        name: "India GST",
      });
      await setDoc(doc(adminContext.firestore(), "permissionCatalog", "perm_sales_create"), {
        name: "Create Sales",
        code: "sales.create",
      });
    });

    const userDb = testEnv.authenticatedContext("user_alice").firestore();

    await assertSucceeds(getDoc(doc(userDb, "subscriptionPlans", "plan_starter")));
    await assertSucceeds(getDoc(doc(userDb, "modules", "billing")));
    await assertSucceeds(getDoc(doc(userDb, "taxRegimes", "IN_GST")));
    await assertSucceeds(getDoc(doc(userDb, "permissionCatalog", "perm_sales_create")));
  });

  // --- 7. Operational Business Collections Tenant Isolation ---
  it("allows tenant member to read products, bills, outflows, payments of own org, denies cross-tenant reads", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      // Organization Alpha membership for Alice
      await setDoc(doc(adminContext.firestore(), "memberships", "user_alice_org_alpha"), {
        userId: "user_alice",
        organizationId: "org_alpha",
        roleId: "role_employee",
        status: "active",
      });

      // Products in Alpha and Beta
      await setDoc(doc(adminContext.firestore(), "products", "prod_alpha"), {
        organizationId: "org_alpha",
        name: "Alpha Bread",
      });
      await setDoc(doc(adminContext.firestore(), "products", "prod_beta"), {
        organizationId: "org_beta",
        name: "Beta Bread",
      });

      // Bills in Alpha and Beta
      await setDoc(doc(adminContext.firestore(), "bills", "bill_alpha"), {
        organizationId: "org_alpha",
        billNumber: "POS-2026-000001",
      });
      await setDoc(doc(adminContext.firestore(), "bills", "bill_beta"), {
        organizationId: "org_beta",
        billNumber: "POS-2026-000002",
      });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();

    // Alice CAN read Alpha product and bill
    await assertSucceeds(getDoc(doc(aliceDb, "products", "prod_alpha")));
    await assertSucceeds(getDoc(doc(aliceDb, "bills", "bill_alpha")));

    // Alice CANNOT read Beta product or bill (cross-tenant rejected!)
    await assertFails(getDoc(doc(aliceDb, "products", "prod_beta")));
    await assertFails(getDoc(doc(aliceDb, "bills", "bill_beta")));
  });

  // --- 8. Branch-Ready Foundation Security Rules ---
  it("protects branches, membershipBranches, and stockBalances: allows tenant reads, denies cross-tenant reads and direct writes", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      // Organization Alpha membership for Alice
      await setDoc(doc(adminContext.firestore(), "memberships", "user_alice_org_alpha"), {
        userId: "user_alice",
        organizationId: "org_alpha",
        roleId: "role_employee",
        status: "active",
      });

      // Branch under org_alpha
      await setDoc(doc(adminContext.firestore(), "organizations", "org_alpha", "branches", "main-branch"), {
        organizationId: "org_alpha",
        name: "Main Branch",
        code: "MAIN",
        isDefault: true,
        isActive: true,
      });

      // Branch under org_beta
      await setDoc(doc(adminContext.firestore(), "organizations", "org_beta", "branches", "main-branch"), {
        organizationId: "org_beta",
        name: "Main Branch",
        code: "MAIN",
        isDefault: true,
        isActive: true,
      });

      // membershipBranches for Alice
      await setDoc(doc(adminContext.firestore(), "membershipBranches", "user_alice_org_alpha_main-branch"), {
        organizationId: "org_alpha",
        branchId: "main-branch",
        membershipId: "user_alice_org_alpha",
        userId: "user_alice",
        status: "active",
      });

      // StockBalance in Alpha and Beta
      await setDoc(doc(adminContext.firestore(), "stockBalances", "org_alpha_main-branch_prod_1"), {
        organizationId: "org_alpha",
        branchId: "main-branch",
        productId: "prod_1",
        currentStock: 100,
      });
      await setDoc(doc(adminContext.firestore(), "stockBalances", "org_beta_main-branch_prod_2"), {
        organizationId: "org_beta",
        branchId: "main-branch",
        productId: "prod_2",
        currentStock: 50,
      });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();

    // Direct client writes denied
    await assertFails(
      setDoc(doc(aliceDb, "organizations", "org_alpha", "branches", "new-branch"), { name: "Direct Client Branch" })
    );
    await assertFails(
      setDoc(doc(aliceDb, "membershipBranches", "hack_join"), { status: "active" })
    );
    await assertFails(
      setDoc(doc(aliceDb, "stockBalances", "hack_balance"), { currentStock: 9999 })
    );
    await assertFails(
      setDoc(doc(aliceDb, "branchCodeLocks", "org_alpha_MAIN"), { branchCode: "MAIN" })
    );

    // Reads in own org succeed
    await assertSucceeds(getDoc(doc(aliceDb, "organizations", "org_alpha", "branches", "main-branch")));
    await assertSucceeds(getDoc(doc(aliceDb, "membershipBranches", "user_alice_org_alpha_main-branch")));
    await assertSucceeds(getDoc(doc(aliceDb, "stockBalances", "org_alpha_main-branch_prod_1")));

    // Reads in other org fail
    await assertFails(getDoc(doc(aliceDb, "organizations", "org_beta", "branches", "main-branch")));
    await assertFails(getDoc(doc(aliceDb, "stockBalances", "org_beta_main-branch_prod_2")));

    // Branch code locks completely denied to client reads
    await assertFails(getDoc(doc(aliceDb, "branchCodeLocks", "org_alpha_MAIN")));
  });

  it("Operations collections: client read isolation and direct write denial", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      // Setup Alice in org_alpha
      await setDoc(doc(adminContext.firestore(), "memberships", "user_alice_org_alpha"), {
        userId: "user_alice",
        organizationId: "org_alpha",
        status: "active",
      });

      // Tasks
      await setDoc(doc(adminContext.firestore(), "tasks", "task_alpha_1"), {
        organizationId: "org_alpha",
        title: "Alpha Task",
      });
      await setDoc(doc(adminContext.firestore(), "tasks", "task_beta_1"), {
        organizationId: "org_beta",
        title: "Beta Task",
      });

      // Daily Summaries
      await setDoc(doc(adminContext.firestore(), "dailySummaries", "org_alpha_2026-10-28"), {
        organizationId: "org_alpha",
        totalRevenue: 5000,
      });
      await setDoc(doc(adminContext.firestore(), "dailySummaries", "org_beta_2026-10-28"), {
        organizationId: "org_beta",
        totalRevenue: 10000,
      });

      // Notifications
      await setDoc(doc(adminContext.firestore(), "notifications", "notif_alice_1"), {
        userId: "user_alice",
        title: "Alice Notif",
      });
      await setDoc(doc(adminContext.firestore(), "notifications", "notif_bob_1"), {
        userId: "user_bob",
        title: "Bob Notif",
      });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();

    // 1. Direct writes denied
    await assertFails(setDoc(doc(aliceDb, "tasks", "hack_task"), { title: "Hack" }));
    await assertFails(setDoc(doc(aliceDb, "dailySummaries", "hack_summary"), { totalRevenue: 0 }));
    await assertFails(setDoc(doc(aliceDb, "notifications", "hack_notif"), { title: "Hack" }));

    // 2. Org-scoped read success for own tenant
    await assertSucceeds(getDoc(doc(aliceDb, "tasks", "task_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "dailySummaries", "org_alpha_2026-10-28")));

    // 3. Cross-tenant read denied
    await assertFails(getDoc(doc(aliceDb, "tasks", "task_beta_1")));
    await assertFails(getDoc(doc(aliceDb, "dailySummaries", "org_beta_2026-10-28")));

    // 4. User-scoped notification read: Alice can read own, denied Bob's
    await assertSucceeds(getDoc(doc(aliceDb, "notifications", "notif_alice_1")));
    await assertFails(getDoc(doc(aliceDb, "notifications", "notif_bob_1")));
  });

  it("Organization structure and master catalogs: client read isolation and direct write denial", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const db = adminContext.firestore();
      // Setup Alice in org_alpha
      await setDoc(doc(db, "memberships", "user_alice_org_alpha"), {
        userId: "user_alice",
        organizationId: "org_alpha",
        status: "active",
      });

      // Org alpha master data
      await setDoc(doc(db, "departments", "dept_alpha_1"), { organizationId: "org_alpha", name: "Alpha Sales" });
      await setDoc(doc(db, "jobRoles", "job_alpha_1"), { organizationId: "org_alpha", name: "Alpha Cashier" });
      await setDoc(doc(db, "teams", "team_alpha_1"), { organizationId: "org_alpha", name: "Alpha Counter A" });
      await setDoc(doc(db, "categories", "cat_alpha_1"), { organizationId: "org_alpha", name: "Beverages" });
      await setDoc(doc(db, "units", "unit_alpha_1"), { organizationId: "org_alpha", name: "Bottle" });
      await setDoc(doc(db, "customers", "cust_alpha_1"), { organizationId: "org_alpha", name: "Alpha Customer" });
      await setDoc(doc(db, "vendors", "vend_alpha_1"), { organizationId: "org_alpha", name: "Alpha Vendor" });

      // Org beta master data
      await setDoc(doc(db, "departments", "dept_beta_1"), { organizationId: "org_beta", name: "Beta Sales" });
      await setDoc(doc(db, "categories", "cat_beta_1"), { organizationId: "org_beta", name: "Snacks" });
      await setDoc(doc(db, "customers", "cust_beta_1"), { organizationId: "org_beta", name: "Beta Customer" });
      await setDoc(doc(db, "vendors", "vend_beta_1"), { organizationId: "org_beta", name: "Beta Vendor" });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();

    // 1. Direct writes denied
    await assertFails(setDoc(doc(aliceDb, "departments", "hack_dept"), { name: "Hack Dept" }));
    await assertFails(setDoc(doc(aliceDb, "jobRoles", "hack_job"), { name: "Hack Job" }));
    await assertFails(setDoc(doc(aliceDb, "teams", "hack_team"), { name: "Hack Team" }));
    await assertFails(setDoc(doc(aliceDb, "categories", "hack_cat"), { name: "Hack Cat" }));
    await assertFails(setDoc(doc(aliceDb, "units", "hack_unit"), { name: "Hack Unit" }));
    await assertFails(setDoc(doc(aliceDb, "customers", "hack_cust"), { name: "Hack Cust" }));
    await assertFails(setDoc(doc(aliceDb, "vendors", "hack_vend"), { name: "Hack Vend" }));

    // 2. Read own org data succeeds
    await assertSucceeds(getDoc(doc(aliceDb, "departments", "dept_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "jobRoles", "job_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "teams", "team_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "categories", "cat_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "units", "unit_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "customers", "cust_alpha_1")));
    await assertSucceeds(getDoc(doc(aliceDb, "vendors", "vend_alpha_1")));

    // 3. Cross-tenant reads denied
    await assertFails(getDoc(doc(aliceDb, "departments", "dept_beta_1")));
    await assertFails(getDoc(doc(aliceDb, "categories", "cat_beta_1")));
    await assertFails(getDoc(doc(aliceDb, "customers", "cust_beta_1")));
    await assertFails(getDoc(doc(aliceDb, "vendors", "vend_beta_1")));
  });

  it("Telemetry, Usage Metering, Devices, and Concurrency Locks security rules", async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const db = adminContext.firestore();
      // Setup Alice in org_alpha
      await setDoc(doc(db, "memberships", "user_alice_org_alpha"), {
        userId: "user_alice",
        organizationId: "org_alpha",
        status: "active",
      });

      // Devices
      await setDoc(doc(db, "users", "user_alice", "devices", "dev_alice_1"), { fcmToken: "token_alice" });
      await setDoc(doc(db, "users", "user_bob", "devices", "dev_bob_1"), { fcmToken: "token_bob" });

      // Monthly Summaries & Locations
      await setDoc(doc(db, "monthlySummaries", "org_alpha_2026-10"), { organizationId: "org_alpha", totalRevenue: 50000 });
      await setDoc(doc(db, "monthlySummaries", "org_beta_2026-10"), { organizationId: "org_beta", totalRevenue: 100000 });
      await setDoc(doc(db, "latestLocations", "loc_alpha_alice"), { organizationId: "org_alpha", userId: "user_alice", lat: 12.97 });
      await setDoc(doc(db, "locationPings", "ping_alpha_1"), { organizationId: "org_alpha", userId: "user_alice", lat: 12.97 });

      // Locks & Outbox
      await setDoc(doc(db, "barcodeLocks", "org_alpha_8901234567890"), { barcode: "8901234567890" });
      await setDoc(doc(db, "notificationOutbox", "outbox_1"), { type: "push", recipient: "token_xyz" });

      // Super Admin usage metering data
      await setDoc(doc(db, "organizationUsageDaily", "org_alpha_2026-10-28"), { organizationId: "org_alpha", apiCalls: 150 });
      await setDoc(doc(db, "branchUsageDaily", "org_alpha_branch1_2026-10-28"), { organizationId: "org_alpha", apiCalls: 50 });
      await setDoc(doc(db, "branchUsageMonthly", "org_alpha_branch1_2026-10"), { organizationId: "org_alpha", apiCalls: 50 });
      await setDoc(doc(db, "platformUsageSnapshots", "snap_2026-10-28"), { totalOrgs: 10 });
      await setDoc(doc(db, "usageRateCards", "v1"), { apiCallRate: 0.001 });
      await setDoc(doc(db, "usageAllocationRuns", "run_2026-10"), { status: "completed" });
    });

    const aliceDb = testEnv.authenticatedContext("user_alice").firestore();
    const superAdminDb = testEnv.authenticatedContext("superadmin_user", { isSuperAdmin: true }).firestore();

    // 1. Direct writes denied to all these collections
    await assertFails(setDoc(doc(aliceDb, "users", "user_alice", "devices", "dev_hack"), { token: "hack" }));
    await assertFails(setDoc(doc(aliceDb, "monthlySummaries", "hack_monthly"), { revenue: 0 }));
    await assertFails(setDoc(doc(aliceDb, "latestLocations", "hack_loc"), { lat: 0 }));
    await assertFails(setDoc(doc(aliceDb, "locationPings", "hack_ping"), { lat: 0 }));
    await assertFails(setDoc(doc(aliceDb, "barcodeLocks", "hack_lock"), { barcode: "hack" }));
    await assertFails(setDoc(doc(aliceDb, "notificationOutbox", "hack_outbox"), { type: "hack" }));
    await assertFails(setDoc(doc(aliceDb, "organizationUsageDaily", "hack_usage"), { apiCalls: 0 }));
    await assertFails(setDoc(doc(aliceDb, "branchUsageDaily", "hack_b_usage"), { apiCalls: 0 }));
    await assertFails(setDoc(doc(aliceDb, "branchUsageMonthly", "hack_bm_usage"), { apiCalls: 0 }));
    await assertFails(setDoc(doc(aliceDb, "platformUsageSnapshots", "hack_snap"), { totalOrgs: 0 }));
    await assertFails(setDoc(doc(aliceDb, "usageRateCards", "hack_rate"), { rate: 0 }));
    await assertFails(setDoc(doc(aliceDb, "usageAllocationRuns", "hack_run"), { status: "hack" }));

    // 2. User device subcollection isolation: Alice reads own device, denied reading Bob's device
    await assertSucceeds(getDoc(doc(aliceDb, "users", "user_alice", "devices", "dev_alice_1")));
    await assertFails(getDoc(doc(aliceDb, "users", "user_bob", "devices", "dev_bob_1")));

    // 3. Monthly summaries and location tracking tenant isolation
    await assertSucceeds(getDoc(doc(aliceDb, "monthlySummaries", "org_alpha_2026-10")));
    await assertFails(getDoc(doc(aliceDb, "monthlySummaries", "org_beta_2026-10")));
    await assertSucceeds(getDoc(doc(aliceDb, "latestLocations", "loc_alpha_alice")));
    await assertSucceeds(getDoc(doc(aliceDb, "locationPings", "ping_alpha_1")));

    // 4. Server-only collections completely denied to client reads
    await assertFails(getDoc(doc(aliceDb, "barcodeLocks", "org_alpha_8901234567890")));
    await assertFails(getDoc(doc(aliceDb, "notificationOutbox", "outbox_1")));

    // 5. Usage metering collections: denied to tenant member Alice, accessible to Super Admin
    await assertFails(getDoc(doc(aliceDb, "organizationUsageDaily", "org_alpha_2026-10-28")));
    await assertFails(getDoc(doc(aliceDb, "branchUsageDaily", "org_alpha_branch1_2026-10-28")));
    await assertFails(getDoc(doc(aliceDb, "branchUsageMonthly", "org_alpha_branch1_2026-10")));
    await assertFails(getDoc(doc(aliceDb, "platformUsageSnapshots", "snap_2026-10-28")));
    await assertFails(getDoc(doc(aliceDb, "usageRateCards", "v1")));
    await assertFails(getDoc(doc(aliceDb, "usageAllocationRuns", "run_2026-10")));

    await assertSucceeds(getDoc(doc(superAdminDb, "organizationUsageDaily", "org_alpha_2026-10-28")));
    await assertSucceeds(getDoc(doc(superAdminDb, "branchUsageDaily", "org_alpha_branch1_2026-10-28")));
    await assertSucceeds(getDoc(doc(superAdminDb, "branchUsageMonthly", "org_alpha_branch1_2026-10")));
    await assertSucceeds(getDoc(doc(superAdminDb, "platformUsageSnapshots", "snap_2026-10-28")));
    await assertSucceeds(getDoc(doc(superAdminDb, "usageRateCards", "v1")));
    await assertSucceeds(getDoc(doc(superAdminDb, "usageAllocationRuns", "run_2026-10")));
  });
});
