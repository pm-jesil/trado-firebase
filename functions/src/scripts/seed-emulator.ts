/**
 * Emulator-Only Seeding Tool
 * 
 * Strict safety guard:
 * Refuses to run unless FIRESTORE_EMULATOR_HOST or FIREBASE_AUTH_EMULATOR_HOST is set!
 * Never executes against live production environments.
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  DEFAULT_MODULES,
  DEFAULT_TAX_REGIMES,
  DEFAULT_SUBSCRIPTION_PLANS,
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_JOB_ROLES,
} from "../constants/catalogs.js";
import { AppPermissions } from "../constants/permissions.js";
import { BusinessType, BusinessCategory, EntityStatus } from "../constants/enums.js";

async function runSeed() {
  console.log("=== Trado Local Emulator Seed Tool ===");

  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  if (!firestoreHost && !authHost) {
    console.error("\n[ABORTED] Safety guard failed: No emulator host environment variables found!");
    console.error("This script is strictly restricted to local emulator environments.");
    console.error("Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099.\n");
    process.exit(1);
  }

  console.log(`Connected to Firestore emulator: ${firestoreHost || "N/A"}`);
  console.log(`Connected to Auth emulator: ${authHost || "N/A"}`);

  if (getApps().length === 0) {
    initializeApp({ projectId: "trado-x" });
  }

  const db = getFirestore();
  const auth = getAuth();

  // 1. Seed Platform Modules
  console.log("\n1. Seeding Modules Catalog...");
  for (const mod of DEFAULT_MODULES) {
    await db.collection("modules").doc(mod.code).set(mod);
  }
  console.log(`   Seeded ${DEFAULT_MODULES.length} modules.`);

  // 2. Seed Tax Regimes Catalog
  console.log("\n2. Seeding Tax Regimes Catalog...");
  for (const regime of DEFAULT_TAX_REGIMES) {
    await db.collection("taxRegimes").doc(regime.code).set(regime);
  }
  console.log(`   Seeded ${DEFAULT_TAX_REGIMES.length} tax regimes.`);

  // 3. Seed Subscription Plans
  console.log("\n3. Seeding Subscription Plans...");
  for (const plan of DEFAULT_SUBSCRIPTION_PLANS) {
    await db.collection("subscriptionPlans").doc(plan.id).set(plan);
  }
  console.log(`   Seeded ${DEFAULT_SUBSCRIPTION_PLANS.length} subscription plans.`);

  // 4. Seed Permission Catalog
  console.log("\n4. Seeding Permission Catalog...");
  const permissionEntries = Object.values(AppPermissions).filter((p) => p !== "*" && p !== "platform:*");
  for (const permCode of permissionEntries) {
    const parts = permCode.split(":");
    await db.collection("permissionCatalog").doc(permCode).set({
      code: permCode,
      description: `Permission for ${permCode}`,
      module: parts[0] || "general",
      isSystem: true,
    });
  }
  console.log(`   Seeded ${permissionEntries.length} permission catalog entries.`);

  // 5. Seed System Roles
  console.log("\n5. Seeding Default System Roles...");
  for (const role of DEFAULT_SYSTEM_ROLES) {
    await db.collection("roles").doc(role.id).set({
      organizationId: null,
      name: role.name,
      code: role.code,
      permissions: role.permissions,
      isSystem: true,
      description: role.description,
      createdAt: new Date().toISOString(),
    });
  }
  console.log(`   Seeded ${DEFAULT_SYSTEM_ROLES.length} system roles.`);

  // 5b. Seed Default Job Roles
  console.log("\n5b. Seeding Default Job Roles...");
  for (const jobRole of DEFAULT_JOB_ROLES) {
    await db.collection("jobRoles").doc(jobRole.id).set({
      organizationId: null,
      name: jobRole.name,
      code: jobRole.code,
      description: jobRole.description,
      isSystem: true,
      createdAt: new Date().toISOString(),
    });
  }
  console.log(`   Seeded ${DEFAULT_JOB_ROLES.length} default job roles.`);

  // 6. Seed Super Admin User
  console.log("\n6. Seeding Test Super Admin User...");
  const adminEmail = "superadmin@trado.local";
  let superAdminUid: string;
  try {
    const existing = await auth.getUserByEmail(adminEmail);
    superAdminUid = existing.uid;
    console.log(`   Existing Super Admin found with UID: ${superAdminUid}`);
  } catch {
    const user = await auth.createUser({
      email: adminEmail,
      displayName: "Trado Platform Admin",
      password: "TestPassword123!",
    });
    superAdminUid = user.uid;
    console.log(`   Created new Super Admin Auth user with UID: ${superAdminUid}`);
  }

  // Set trusted custom claim isSuperAdmin
  await auth.setCustomUserClaims(superAdminUid, { isSuperAdmin: true });
  await db.collection("users").doc(superAdminUid).set({
    name: "Trado Platform Admin",
    email: adminEmail,
    accountType: "admin",
    isActive: true,
    createdAt: new Date().toISOString(),
  });
  console.log("   Super Admin profile and isSuperAdmin custom claim verified.");

  // 7. Seed Sample Test Organization & Owner
  console.log("\n7. Seeding Sample Organization & Owner...");
  const sampleOrgId = "org_apex_sample";
  const ownerEmail = "owner@apexwholesale.local";

  let ownerUid: string;
  try {
    const existing = await auth.getUserByEmail(ownerEmail);
    ownerUid = existing.uid;
  } catch {
    const owner = await auth.createUser({
      email: ownerEmail,
      displayName: "Apex Owner",
      password: "TestPassword123!",
    });
    ownerUid = owner.uid;
  }

  await db.collection("organizations").doc(sampleOrgId).set({
    name: "Apex Wholesale Supplies",
    businessType: BusinessType.WHOLESALE_RETAIL,
    businessCategory: BusinessCategory.GENERAL,
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    status: EntityStatus.ACTIVE,
    planId: "plan_growth",
    moduleToggles: { billing: true, inventory: true, sales: true },
    createdAt: new Date().toISOString(),
    createdBy: superAdminUid,
  });

  await db.collection("users").doc(ownerUid).set({
    name: "Apex Owner",
    email: ownerEmail,
    accountType: "admin",
    isActive: true,
    createdAt: new Date().toISOString(),
    createdBy: superAdminUid,
  });

  const ownerMembershipId = `${ownerUid}_${sampleOrgId}`;
  await db.collection("memberships").doc(ownerMembershipId).set({
    userId: ownerUid,
    organizationId: sampleOrgId,
    roleId: "role_org_owner",
    jobRoleIds: [],
    reportingToIds: [],
    permissions: {},
    status: EntityStatus.ACTIVE,
    isPrimary: true,
    createdAt: new Date().toISOString(),
    createdBy: superAdminUid,
  });

  // Set trusted custom claim primaryOrganizationId on Owner Auth user
  await auth.setCustomUserClaims(ownerUid, { primaryOrganizationId: sampleOrgId });
  console.log(`   Sample organization "${sampleOrgId}", Owner membership, and primaryOrganizationId claim provisioned.`);

  // 8. Seed Sample Operational Business Records
  console.log("\n8. Seeding Sample Operational Records (Category, Unit, Product, Customer, Vendor)...");
  const now = new Date().toISOString();

  // Category
  const sampleCatId = "cat_bakery_sample";
  await db.collection("categories").doc(sampleCatId).set({
    organizationId: sampleOrgId,
    name: "Bakery & Confectionery",
    description: "Fresh bakery and bread products",
    status: "active",
    createdAt: now,
    createdBy: ownerUid,
  });

  // Unit
  const sampleUnitId = "unit_pack_sample";
  await db.collection("units").doc(sampleUnitId).set({
    organizationId: sampleOrgId,
    name: "Pack",
    code: "pack",
    group: "count",
    baseMultiplier: 1,
    status: "active",
    createdAt: now,
    createdBy: ownerUid,
  });

  // Product
  const sampleProdId = "prod_bread_sample";
  await db.collection("products").doc(sampleProdId).set({
    organizationId: sampleOrgId,
    name: "Whole Wheat Bread 400g",
    categoryId: sampleCatId,
    categoryNameSnapshot: "Bakery & Confectionery",
    baseUnit: "pack",
    sellingPrice: 45,
    costPrice: 32,
    taxInclusive: false,
    taxRatePercent: 5,
    hasExpiry: true,
    trackStock: true,
    initialStock: 100,
    currentStock: 100,
    lowStockThreshold: 15,
    status: "active",
    createdAt: now,
    createdBy: ownerUid,
  });

  // Customer
  const sampleCustId = "cust_citymart_sample";
  await db.collection("customers").doc(sampleCustId).set({
    organizationId: sampleOrgId,
    customerCode: "CUST-000001",
    name: "City Mart Supermarket",
    mobile: "9876543210",
    email: "contact@citymart.local",
    taxNumber: "29ABCDE1234F1Z5",
    billingAddress: "42 Market Street, Bangalore",
    creditLimit: 50000,
    currentBalance: 0,
    status: "active",
    createdAt: now,
    createdBy: ownerUid,
  });

  // Vendor
  const sampleVendId = "vend_goldengrain_sample";
  await db.collection("vendors").doc(sampleVendId).set({
    organizationId: sampleOrgId,
    vendorCode: "VEND-000001",
    name: "Golden Grain Mills",
    mobile: "9123456780",
    email: "orders@goldengrain.local",
    taxNumber: "29XYZAB5678C1Z2",
    address: "10 Industrial Area, Hubli",
    currentBalance: 0,
    status: "active",
    createdAt: now,
    createdBy: ownerUid,
  });
  console.log("   Sample Category, Unit, Product, Customer, and Vendor provisioned.");

  console.log("\n[SUCCESS] Local emulator seed complete!\n");
}

runSeed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
