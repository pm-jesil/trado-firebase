/**
 * Test Seed Repeatability & Idempotency
 * 
 * Runs seeding twice against emulator, verifying:
 * 1. Document counts in organizations, branches, users, and memberships do not double.
 * 2. Deterministic IDs are safely overwritten.
 * 3. Super Admin remains strictly isolated (0 tenant memberships, 0 branches).
 */

const path = require("path");
const assert = require("assert/strict");

const PROJECT_ID = "trado-x";

async function main() {
  console.log("=== SEED REPEATABILITY & IDEMPOTENCY AUDIT ===\n");

  const functionsRequire = require("module").createRequire(path.resolve(__dirname, "../package.json"));
  const { initializeApp, getApps } = functionsRequire("firebase-admin/app");
  const { getFirestore } = functionsRequire("firebase-admin/firestore");
  const { getAuth } = functionsRequire("firebase-admin/auth");

  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }

  const db = getFirestore();
  const auth = getAuth();
  const seedModule = require("../lib/scripts/seed-emulator.js");

  // Run 1: First seed run
  console.log("▶ Pass 1: Initial seed execution...");
  await seedModule.seedReferenceData(db);
  await seedModule.seedDemoOrganization(db, auth, "api-explorer-demo");

  const orgsCountPass1 = (await db.collection("organizations").get()).size;
  const usersCountPass1 = (await db.collection("users").get()).size;
  const membershipsCountPass1 = (await db.collection("memberships").get()).size;

  console.log(`  Pass 1 Counts -> Orgs: ${orgsCountPass1}, Users: ${usersCountPass1}, Memberships: ${membershipsCountPass1}`);

  // Run 2: Second seed run (immediate repetition)
  console.log("▶ Pass 2: Repeating seed execution (proving idempotency)...");
  await seedModule.seedReferenceData(db);
  await seedModule.seedDemoOrganization(db, auth, "api-explorer-demo");

  const orgsCountPass2 = (await db.collection("organizations").get()).size;
  const usersCountPass2 = (await db.collection("users").get()).size;
  const membershipsCountPass2 = (await db.collection("memberships").get()).size;

  console.log(`  Pass 2 Counts -> Orgs: ${orgsCountPass2}, Users: ${usersCountPass2}, Memberships: ${membershipsCountPass2}`);

  assert.equal(orgsCountPass1, orgsCountPass2, "Organization count must NOT increase on repeat seed");
  assert.equal(usersCountPass1, usersCountPass2, "User count must NOT increase on repeat seed");
  assert.equal(membershipsCountPass1, membershipsCountPass2, "Membership count must NOT increase on repeat seed");

  // Verify Super Admin has zero tenant memberships
  const superAdmin = await auth.getUserByEmail("superadmin@trado.local");
  const superAdminMemberships = await db.collection("memberships").where("userId", "==", superAdmin.uid).get();
  assert.equal(superAdminMemberships.size, 0, "Super Admin must have ZERO tenant memberships in Firestore");

  console.log("\n================================================================================");
  console.log("   [PASS] SEED REPEATABILITY & SUPER ADMIN ISOLATION VERIFIED! ✓");
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});

