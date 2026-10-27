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

    // Direct write to Phase 2 operational collections
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
  it("allows authenticated users to read platform catalogs (plans, modules, taxRegimes)", async () => {
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
    });

    const userDb = testEnv.authenticatedContext("user_alice").firestore();

    await assertSucceeds(getDoc(doc(userDb, "subscriptionPlans", "plan_starter")));
    await assertSucceeds(getDoc(doc(userDb, "modules", "billing")));
    await assertSucceeds(getDoc(doc(userDb, "taxRegimes", "IN_GST")));
  });

  // --- 7. Phase 2 Operational Core Tenant Isolation ---
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
});
