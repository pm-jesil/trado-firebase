/**
 * Clean Test Artifacts
 * 
 * Removes test-generated organizations, plans, and disposable users from Firestore emulator,
 * leaving only the 11 deterministic demo seed organizations and 5 canonical subscription plans.
 */

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "trado-x";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();

const CANONICAL_SEED_ORGS = new Set([
  "org_wholesale_sample",
  "org_cycle_world",
  "org_kitchen_mart",
  "org_uae_trading",
  "org_sg_tech",
  "org_oman_supplies",
  "org_bahrain_trading",
  "org_us_wholesale",
  "org_apex_sample",
  "org_suspended_sample",
  "org_expired_subscription",
]);

const CANONICAL_SEED_PLANS = new Set([
  "plan_starter",
  "plan_growth",
  "plan_enterprise",
  "plan_archived_legacy",
  "plan_disposable_unused",
]);

async function cleanNonSeedData() {
  console.log("=== Cleaning Test Artifacts from Emulator ===");

  // 1. Organizations
  const orgsSnap = await db.collection("organizations").get();
  let deletedOrgs = 0;
  for (const doc of orgsSnap.docs) {
    if (!CANONICAL_SEED_ORGS.has(doc.id)) {
      // Find and delete subcollections / related docs for this test org
      const orgId = doc.id;
      
      // Delete memberships
      const mems = await db.collection("memberships").where("organizationId", "==", orgId).get();
      for (const m of mems.docs) await m.ref.delete();

      // Delete membershipBranches
      const mbs = await db.collection("membershipBranches").where("organizationId", "==", orgId).get();
      for (const mb of mbs.docs) await mb.ref.delete();

      // Delete branches
      const branches = await db.collection("branches").where("organizationId", "==", orgId).get();
      for (const b of branches.docs) await b.ref.delete();

      // Delete products
      const prods = await db.collection("products").where("organizationId", "==", orgId).get();
      for (const p of prods.docs) await p.ref.delete();

      // Delete customers
      const custs = await db.collection("customers").where("organizationId", "==", orgId).get();
      for (const c of custs.docs) await c.ref.delete();

      // Delete vendors
      const vends = await db.collection("vendors").where("organizationId", "==", orgId).get();
      for (const v of vends.docs) await v.ref.delete();

      // Delete bills
      const bills = await db.collection("bills").where("organizationId", "==", orgId).get();
      for (const b of bills.docs) await b.ref.delete();

      // Delete outflows
      const outflows = await db.collection("outflows").where("organizationId", "==", orgId).get();
      for (const o of outflows.docs) await o.ref.delete();

      // Delete payments
      const pays = await db.collection("payments").where("organizationId", "==", orgId).get();
      for (const py of pays.docs) await py.ref.delete();

      // Delete returns
      const rets = await db.collection("returns").where("organizationId", "==", orgId).get();
      for (const r of rets.docs) await r.ref.delete();

      // Delete deliveries
      const dels = await db.collection("deliveries").where("organizationId", "==", orgId).get();
      for (const d of dels.docs) await d.ref.delete();

      // Delete tasks
      const tasks = await db.collection("tasks").where("organizationId", "==", orgId).get();
      for (const t of tasks.docs) await t.ref.delete();

      // Delete audit logs
      const audits = await db.collection("auditLogs").where("organizationId", "==", orgId).get();
      for (const a of audits.docs) await a.ref.delete();

      // Delete categories & units for this test org
      const cats = await db.collection("categories").where("organizationId", "==", orgId).get();
      for (const c of cats.docs) await c.ref.delete();

      const units = await db.collection("units").where("organizationId", "==", orgId).get();
      for (const u of units.docs) await u.ref.delete();

      // Delete jobRoles, roles, departments, teams
      const jrs = await db.collection("jobRoles").where("organizationId", "==", orgId).get();
      for (const j of jrs.docs) await j.ref.delete();

      const rls = await db.collection("roles").where("organizationId", "==", orgId).get();
      for (const r of rls.docs) await r.ref.delete();

      const depts = await db.collection("departments").where("organizationId", "==", orgId).get();
      for (const d of depts.docs) await d.ref.delete();

      const teams = await db.collection("teams").where("organizationId", "==", orgId).get();
      for (const tm of teams.docs) await tm.ref.delete();

      // Delete stock movements
      const sms = await db.collection("stockMovements").where("organizationId", "==", orgId).get();
      for (const s of sms.docs) await s.ref.delete();

      // Delete notifications
      const notifs = await db.collection("notifications").where("organizationId", "==", orgId).get();
      for (const n of notifs.docs) await n.ref.delete();

      // Delete daily summaries
      const dailies = await db.collection("dailySummaries").where("organizationId", "==", orgId).get();
      for (const d of dailies.docs) await d.ref.delete();

      // Delete usage collections
      for (const collName of ["branchUsageDaily", "branchUsageMonthly", "organizationUsageDaily", "organizationUsageMonthly"]) {
        const usages = await db.collection(collName).where("organizationId", "==", orgId).get();
        for (const u of usages.docs) await u.ref.delete();
      }

      // Delete organization doc
      await doc.ref.delete();
      deletedOrgs++;
    }
  }

  // Sweep collection groups for subcollections (branches, devices)
  try {
    const branches = await db.collectionGroup("branches").get();
    for (const b of branches.docs) {
      const parentOrgId = b.ref.parent && b.ref.parent.parent ? b.ref.parent.parent.id : null;
      const orgId = b.data().organizationId || parentOrgId;
      if (orgId && !CANONICAL_SEED_ORGS.has(orgId)) {
        await b.ref.delete();
      }
    }
  } catch (e) {}

  try {
    const devices = await db.collectionGroup("devices").get();
    for (const d of devices.docs) {
      const orgId = d.data().organizationId;
      if (orgId && !CANONICAL_SEED_ORGS.has(orgId)) {
        await d.ref.delete();
      }
    }
  } catch (e) {}

  // Sweep all collections dynamically using listCollections()
  for (const col of await db.listCollections()) {
    if (col.id === "organizations" || col.id === "subscriptionPlans" || col.id === "taxRegimes" || col.id === "platformModules" || col.id === "permissionCatalog" || col.id === "roles" || col.id === "jobRoles") {
      continue;
    }
    try {
      const snap = await col.get();
      for (const doc of snap.docs) {
        const data = doc.data();
        const orgId = data.organizationId;
        if (orgId && !CANONICAL_SEED_ORGS.has(orgId) && orgId !== "platform") {
          await doc.ref.delete();
        }
      }
    } catch (e) {}
  }

  // Sweep tenant-custom roles and jobRoles from test orgs
  for (const colName of ["roles", "jobRoles"]) {
    try {
      const snap = await db.collection(colName).get();
      for (const doc of snap.docs) {
        const orgId = doc.data().organizationId;
        if (orgId && !CANONICAL_SEED_ORGS.has(orgId)) {
          await doc.ref.delete();
        }
      }
    } catch (e) {}
  }
  console.log(`✓ Cleaned ${deletedOrgs} non-seed test organizations.`);

  // 2. Subscription plans
  const plansSnap = await db.collection("subscriptionPlans").get();
  let deletedPlans = 0;
  for (const doc of plansSnap.docs) {
    if (!CANONICAL_SEED_PLANS.has(doc.id)) {
      await doc.ref.delete();
      deletedPlans++;
    }
  }
  console.log(`✓ Cleaned ${deletedPlans} non-seed test plans.`);

  // Verify resulting counts
  const finalOrgs = (await db.collection("organizations").get()).size;
  const finalPlans = (await db.collection("subscriptionPlans").get()).size;
  console.log(`\nFinal state:`);
  console.log(`  Organizations: ${finalOrgs} (Expected: ${CANONICAL_SEED_ORGS.size})`);
  console.log(`  Subscription Plans: ${finalPlans} (Expected: ${CANONICAL_SEED_PLANS.size})`);
}

cleanNonSeedData().catch(err => {
  console.error("Clean test artifacts failed:", err);
  process.exit(1);
});
