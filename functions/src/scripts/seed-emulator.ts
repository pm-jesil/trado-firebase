/**
 * Emulator-Only Seeding Tool
 * 
 * Strict safety guard:
 * Refuses to run unless FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are set,
 * and project ID matches the local emulator project ("trado-x").
 * Never executes against live production environments.
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MODULES,
  DEFAULT_TAX_REGIMES,
  DEFAULT_SUBSCRIPTION_PLANS,
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_JOB_ROLES,
} from "../constants/catalogs.js";
import { AppPermissions } from "../constants/permissions.js";
import { BusinessType, BusinessCategory, EntityStatus } from "../constants/enums.js";

export interface SafetyCheckResult {
  safe: boolean;
  error?: string;
  firestoreHost?: string;
  authHost?: string;
  projectId?: string;
}

export function verifyEmulatorSafety(
  env: {
    FIRESTORE_EMULATOR_HOST?: string;
    FIREBASE_AUTH_EMULATOR_HOST?: string;
    GCLOUD_PROJECT?: string;
  } = process.env,
  projectId: string = "trado-x"
): SafetyCheckResult {
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST;
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;

  if (!firestoreHost || !authHost) {
    return {
      safe: false,
      error: "Missing emulator host variables. FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be set.",
      firestoreHost,
      authHost,
      projectId,
    };
  }

  const currentProject = env.GCLOUD_PROJECT || projectId;
  if (currentProject !== "trado-x") {
    return {
      safe: false,
      error: `Refusing execution: Project ID "${currentProject}" is not the local emulator project "trado-x".`,
      firestoreHost,
      authHost,
      projectId: currentProject,
    };
  }

  return {
    safe: true,
    firestoreHost,
    authHost,
    projectId: currentProject,
  };
}

export type SeedProfile = "minimal" | "staff-demo" | "operations-demo" | "multi-branch-test" | "api-explorer-demo";

interface CliOptions {
  checkOnly: boolean;
  seedReference: boolean;
  seedDemo: boolean;
  resetOnly: boolean;
  profile: SeedProfile;
}

function parseCliArgs(args: string[]): CliOptions {
  let profile: SeedProfile = "api-explorer-demo";
  const profileArg = args.find((a) => a.startsWith("--profile="));
  if (profileArg) {
    const p = profileArg.split("=")[1]?.toLowerCase();
    if (p === "minimal" || p === "staff-demo" || p === "operations-demo" || p === "multi-branch-test" || p === "api-explorer-demo") {
      profile = p;
    }
  }

  const checkOnly = args.includes("--check");
  const resetOnly = args.includes("--reset-seed-data");
  const seedReference = args.includes("--seed-reference-data");
  const seedDemo = args.includes("--seed-demo-organization");
  const runAll = args.includes("--all") || (!checkOnly && !resetOnly && !seedReference && !seedDemo);

  return {
    checkOnly,
    seedReference: runAll || seedReference,
    seedDemo: runAll || seedDemo,
    resetOnly,
    profile,
  };
}

// 1. Reference Data Seeding
export async function seedReferenceData(db: Firestore): Promise<void> {
  console.log("\n--- Seeding Reference Catalogs ---");

  // 1a. Modules Catalog
  for (const mod of DEFAULT_MODULES) {
    await db.collection("modules").doc(mod.code).set(mod);
  }
  console.log(`✓ Seeded ${DEFAULT_MODULES.length} platform modules.`);

  // 1b. Tax Regimes
  for (const regime of DEFAULT_TAX_REGIMES) {
    await db.collection("taxRegimes").doc(regime.code).set(regime);
  }
  console.log(`✓ Seeded ${DEFAULT_TAX_REGIMES.length} tax regimes.`);

  // 1c. Subscription Plans
  for (const plan of DEFAULT_SUBSCRIPTION_PLANS) {
    await db.collection("subscriptionPlans").doc(plan.id).set(plan);
  }
  console.log(`✓ Seeded ${DEFAULT_SUBSCRIPTION_PLANS.length} subscription plans.`);

  // 1d. Permission Catalog
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
  console.log(`✓ Seeded ${permissionEntries.length} permission catalog entries.`);

  // 1e. Default System Roles
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
  console.log(`✓ Seeded ${DEFAULT_SYSTEM_ROLES.length} system roles.`);

  // 1f. Default Job Roles
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
  console.log(`✓ Seeded ${DEFAULT_JOB_ROLES.length} default job roles.`);
}

// Helper: Ensure or create an Auth user
async function ensureAuthUser(auth: Auth, email: string, displayName: string): Promise<string> {
  try {
    const existing = await auth.getUserByEmail(email);
    return existing.uid;
  } catch {
    const user = await auth.createUser({
      email,
      displayName,
      password: "TestPassword123!",
    });
    return user.uid;
  }
}

// 2. Demo Organization & Operating Personas
export async function seedDemoOrganization(
  db: Firestore,
  auth: Auth,
  profile: SeedProfile
): Promise<void> {
  const now = new Date().toISOString();
  const sampleOrgId = "org_apex_sample";
  const defaultBranchId = "main-branch";
  const secondaryBranchId = "branch_warehouse";
  const isMultiBranch = profile === "multi-branch-test";

  console.log(`\n--- Seeding Demo Organization (Profile: "${profile}") ---`);

  // 2a. Platform Super Admin
  const adminEmail = "superadmin@trado.local";
  const superAdminUid = await ensureAuthUser(auth, adminEmail, "Trado Platform Admin");
  await auth.setCustomUserClaims(superAdminUid, { isSuperAdmin: true });
  await db.collection("users").doc(superAdminUid).set({
    name: "Trado Platform Admin",
    email: adminEmail,
    accountType: "admin",
    isActive: true,
    createdAt: now,
  });
  console.log(`✓ Provisioned Super Admin: ${adminEmail} (UID: ${superAdminUid})`);

  // 2b. Organization Owner
  const ownerEmail = "owner@apexwholesale.local";
  const ownerUid = await ensureAuthUser(auth, ownerEmail, "Apex Owner");
  await auth.setCustomUserClaims(ownerUid, {
    primaryOrganizationId: sampleOrgId,
    primaryBranchId: defaultBranchId,
  });
  await db.collection("users").doc(ownerUid).set({
    name: "Apex Owner",
    email: ownerEmail,
    accountType: "admin",
    isActive: true,
    createdAt: now,
    createdBy: superAdminUid,
  });

  // 2c. Organization Document
  await db.collection("organizations").doc(sampleOrgId).set({
    name: "Apex Wholesale Supplies",
    businessType: BusinessType.WHOLESALE_RETAIL,
    businessCategory: BusinessCategory.GENERAL,
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    status: EntityStatus.ACTIVE,
    planId: isMultiBranch ? "plan_growth" : "plan_starter",
    moduleToggles: { billing: true, inventory: true, sales: true, staff: true, reports: true },
    defaultBranchId,
    branchCount: isMultiBranch ? 2 : 1,
    sharingPolicies: {
      customers: "all_branches",
      vendors: "all_branches",
      products: "all_branches",
    },
    createdAt: now,
    createdBy: superAdminUid,
  });

  // 2d. Default Branch: main-branch
  await db
    .collection("organizations")
    .doc(sampleOrgId)
    .collection("branches")
    .doc(defaultBranchId)
    .set({
      organizationId: sampleOrgId,
      name: "Main Branch",
      code: "MAIN",
      isDefault: true,
      isActive: true,
      status: EntityStatus.ACTIVE,
      gstin: "29ABCDE1234F1Z5",
      createdAt: now,
      createdBy: ownerUid,
    });

  // Lock for MAIN branch code
  await db.collection("branchCodeLocks").doc(`${sampleOrgId}_MAIN`).set({
    organizationId: sampleOrgId,
    branchCode: "MAIN",
    branchId: defaultBranchId,
    createdAt: now,
  });

  // 2e. Owner Membership & Branch Join
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
    primaryBranchId: defaultBranchId,
    assignedBranchIds: isMultiBranch ? [defaultBranchId, secondaryBranchId] : [defaultBranchId],
    createdAt: now,
    createdBy: superAdminUid,
  });

  await db.collection("membershipBranches").doc(`${ownerMembershipId}_${defaultBranchId}`).set({
    membershipId: ownerMembershipId,
    userId: ownerUid,
    organizationId: sampleOrgId,
    branchId: defaultBranchId,
    status: EntityStatus.ACTIVE,
    isDefaultForMembership: true,
    permissions: {},
    createdAt: now,
    createdBy: superAdminUid,
  });
  console.log(`✓ Provisioned Owner: ${ownerEmail} and main-branch lock`);

  // Secondary Branch for multi-branch profile
  if (isMultiBranch) {
    await db
      .collection("organizations")
      .doc(sampleOrgId)
      .collection("branches")
      .doc(secondaryBranchId)
      .set({
        organizationId: sampleOrgId,
        name: "Central Warehouse",
        code: "WH01",
        isDefault: false,
        isActive: true,
        status: EntityStatus.ACTIVE,
        gstin: "29ABCDE1234F1Z5",
        createdAt: now,
        createdBy: ownerUid,
      });

    await db.collection("branchCodeLocks").doc(`${sampleOrgId}_WH01`).set({
      organizationId: sampleOrgId,
      branchCode: "WH01",
      branchId: secondaryBranchId,
      createdAt: now,
    });

    await db.collection("membershipBranches").doc(`${ownerMembershipId}_${secondaryBranchId}`).set({
      membershipId: ownerMembershipId,
      userId: ownerUid,
      organizationId: sampleOrgId,
      branchId: secondaryBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: false,
      permissions: {},
      createdAt: now,
      createdBy: superAdminUid,
    });
    console.log(`✓ Provisioned Secondary Branch: ${secondaryBranchId} (WH01)`);
  }

  // 2f. Staff Members (if profile is staff-demo, operations-demo, or multi-branch-test)
  if (profile !== "minimal") {
    const staffPersonas = [
      { email: "admin@apexwholesale.local", name: "Apex Admin", roleId: "role_org_admin" },
      { email: "cashier@apexwholesale.local", name: "Apex Cashier", roleId: "role_cashier" },
      { email: "rider@apexwholesale.local", name: "Apex Rider", roleId: "role_rider" },
      { email: "manager@apexwholesale.local", name: "Apex Manager", roleId: "role_store_manager" },
    ];

    for (const s of staffPersonas) {
      const uid = await ensureAuthUser(auth, s.email, s.name);
      await auth.setCustomUserClaims(uid, {
        primaryOrganizationId: sampleOrgId,
        primaryBranchId: defaultBranchId,
      });

      await db.collection("users").doc(uid).set({
        name: s.name,
        email: s.email,
        accountType: "staff",
        isActive: true,
        createdAt: now,
        createdBy: ownerUid,
      });

      const mId = `${uid}_${sampleOrgId}`;
      await db.collection("memberships").doc(mId).set({
        userId: uid,
        organizationId: sampleOrgId,
        roleId: s.roleId,
        jobRoleIds: [],
        reportingToIds: [],
        permissions: {},
        status: EntityStatus.ACTIVE,
        isPrimary: true,
        primaryBranchId: defaultBranchId,
        assignedBranchIds: [defaultBranchId],
        createdAt: now,
        createdBy: ownerUid,
      });

      await db.collection("membershipBranches").doc(`${mId}_${defaultBranchId}`).set({
        membershipId: mId,
        userId: uid,
        organizationId: sampleOrgId,
        branchId: defaultBranchId,
        status: EntityStatus.ACTIVE,
        isDefaultForMembership: true,
        permissions: {},
        createdAt: now,
        createdBy: ownerUid,
      });
    }
    console.log(`✓ Provisioned 4 Staff Personas (Admin, Cashier, Rider, Manager) with main-branch mappings.`);

    // 2f-neg. Negative Testing Personas (Inactive User, Deactivated Membership, Inactive Branch, Suspended Org)
    // 1. Globally Deactivated User
    const inactiveUserEmail = "inactive@apexwholesale.local";
    const inactiveUid = await ensureAuthUser(auth, inactiveUserEmail, "Apex Inactive User");
    await auth.setCustomUserClaims(inactiveUid, {
      primaryOrganizationId: sampleOrgId,
      primaryBranchId: defaultBranchId,
    });
    await db.collection("users").doc(inactiveUid).set({
      name: "Apex Inactive User",
      email: inactiveUserEmail,
      accountType: "staff",
      isActive: false, // Deactivated profile
      createdAt: now,
      createdBy: ownerUid,
    });
    const inactiveMId = `${inactiveUid}_${sampleOrgId}`;
    await db.collection("memberships").doc(inactiveMId).set({
      userId: inactiveUid,
      organizationId: sampleOrgId,
      roleId: "role_cashier",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: defaultBranchId,
      assignedBranchIds: [defaultBranchId],
      createdAt: now,
      createdBy: ownerUid,
    });

    // 2. User with Deactivated Tenant Membership
    const deactivatedMemberEmail = "deactivated_member@apexwholesale.local";
    const deactivatedMemberUid = await ensureAuthUser(auth, deactivatedMemberEmail, "Apex Deactivated Member");
    await auth.setCustomUserClaims(deactivatedMemberUid, {
      primaryOrganizationId: sampleOrgId,
      primaryBranchId: defaultBranchId,
    });
    await db.collection("users").doc(deactivatedMemberUid).set({
      name: "Apex Deactivated Member",
      email: deactivatedMemberEmail,
      accountType: "staff",
      isActive: true, // Active global user
      createdAt: now,
      createdBy: ownerUid,
    });
    const deactMId = `${deactivatedMemberUid}_${sampleOrgId}`;
    await db.collection("memberships").doc(deactMId).set({
      userId: deactivatedMemberUid,
      organizationId: sampleOrgId,
      roleId: "role_cashier",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: "deactivated", // Revoked membership
      isPrimary: true,
      primaryBranchId: defaultBranchId,
      assignedBranchIds: [defaultBranchId],
      createdAt: now,
      createdBy: ownerUid,
    });

    // 3. Inactive Branch in Org A
    const inactiveBranchId = "branch_inactive";
    await db
      .collection("organizations")
      .doc(sampleOrgId)
      .collection("branches")
      .doc(inactiveBranchId)
      .set({
        organizationId: sampleOrgId,
        name: "Inactive Annex Branch",
        code: "INACT",
        isDefault: false,
        isActive: false, // Inactive branch
        status: "deactivated",
        createdAt: now,
        createdBy: ownerUid,
      });

    // 4. Suspended Organization & Associated User
    const suspendedOrgId = "org_suspended_sample";
    await db.collection("organizations").doc(suspendedOrgId).set({
      name: "Suspended Demo Corp",
      businessType: BusinessType.RETAIL_ONLY,
      businessCategory: BusinessCategory.GENERAL,
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      status: "deactivated", // Inactive organization
      planId: "plan_starter",
      moduleToggles: { billing: true, inventory: true },
      defaultBranchId: "main-branch",
      branchCount: 1,
      createdAt: now,
      createdBy: superAdminUid,
    });
    const suspendedUserEmail = "suspended_org_user@apexwholesale.local";
    const suspendedUserUid = await ensureAuthUser(auth, suspendedUserEmail, "Suspended Org User");
    await auth.setCustomUserClaims(suspendedUserUid, {
      primaryOrganizationId: suspendedOrgId,
      primaryBranchId: "main-branch",
    });
    await db.collection("users").doc(suspendedUserUid).set({
      name: "Suspended Org User",
      email: suspendedUserEmail,
      accountType: "staff",
      isActive: true,
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("memberships").doc(`${suspendedUserUid}_${suspendedOrgId}`).set({
      userId: suspendedUserUid,
      organizationId: suspendedOrgId,
      roleId: "role_cashier",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: "main-branch",
      assignedBranchIds: ["main-branch"],
      createdAt: now,
      createdBy: superAdminUid,
    });
    console.log(`✓ Provisioned Negative Testing Entities (Inactive User, Deactivated Membership, Inactive Branch, Suspended Org).`);
  }

  // 2g. Operational Records (Products, Categories, Units, StockBalances, Customers, Vendors)
  if (profile === "operations-demo" || profile === "multi-branch-test") {
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
    const sampleBarcode = "8901234567890";
    await db.collection("products").doc(sampleProdId).set({
      organizationId: sampleOrgId,
      name: "Whole Wheat Bread 400g",
      categoryId: sampleCatId,
      categoryNameSnapshot: "Bakery & Confectionery",
      baseUnit: "pack",
      barcode: sampleBarcode,
      sellingPrice: 45,
      costPrice: 32,
      taxInclusive: false,
      taxRatePercent: 5,
      hasExpiry: true,
      trackStock: true,
      initialStock: 100,
      currentStock: isMultiBranch ? 150 : 100,
      lowStockThreshold: 15,
      status: "active",
      createdAt: now,
      createdBy: ownerUid,
    });

    // Barcode Lock
    await db.collection("barcodeLocks").doc(`${sampleOrgId}_${sampleBarcode}`).set({
      organizationId: sampleOrgId,
      productId: sampleProdId,
      barcode: sampleBarcode,
      createdAt: now,
    });

    // Default Branch StockBalance
    await db
      .collection("stockBalances")
      .doc(`${sampleOrgId}_${defaultBranchId}_${sampleProdId}`)
      .set({
        organizationId: sampleOrgId,
        branchId: defaultBranchId,
        productId: sampleProdId,
        currentStock: 100,
        allocatedStock: 0,
        availableStock: 100,
        reorderPoint: 15,
        lowStockThreshold: 15,
        updatedAt: now,
      });

    // Secondary Branch StockBalance (multi-branch profile)
    if (isMultiBranch) {
      await db
        .collection("stockBalances")
        .doc(`${sampleOrgId}_${secondaryBranchId}_${sampleProdId}`)
        .set({
          organizationId: sampleOrgId,
          branchId: secondaryBranchId,
          productId: sampleProdId,
          currentStock: 50,
          allocatedStock: 0,
          availableStock: 50,
          reorderPoint: 20,
          lowStockThreshold: 20,
          updatedAt: now,
        });
    }

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
      visibilityScope: "all_branches",
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
      visibilityScope: "all_branches",
      status: "active",
      createdAt: now,
      createdBy: ownerUid,
    });

    // Sample Bill
    await db.collection("bills").doc("bill_sample_001").set({
      organizationId: sampleOrgId,
      branchId: defaultBranchId,
      billNumber: "INV-2026-0001",
      customerId: sampleCustId,
      customerNameSnapshot: "City Mart Supermarket",
      customerMobileSnapshot: "9876543210",
      status: "finalized",
      paymentStatus: "paid",
      subtotal: 90,
      taxAmount: 4.5,
      totalAmount: 94.5,
      items: [
        {
          productId: sampleProdId,
          productNameSnapshot: "Whole Wheat Bread 400g",
          unitCodeSnapshot: "pack",
          quantity: 2,
          unitPrice: 45,
          subtotal: 90,
          taxRatePercentSnapshot: 5,
          taxAmount: 4.5,
          total: 94.5,
        },
      ],
      createdAt: now,
      createdBy: ownerUid,
    });

    // Sample Outflow (Purchase)
    await db.collection("outflows").doc("outflow_sample_001").set({
      organizationId: sampleOrgId,
      branchId: defaultBranchId,
      kind: "purchase",
      documentNumber: "PO-2026-0001",
      vendorId: sampleVendId,
      vendorNameSnapshot: "Golden Grain Mills",
      status: "finalized",
      paymentStatus: "paid",
      subtotal: 3200,
      taxAmount: 160,
      totalAmount: 3360,
      items: [
        {
          productId: sampleProdId,
          productNameSnapshot: "Whole Wheat Bread 400g",
          unitCodeSnapshot: "pack",
          quantity: 100,
          unitCost: 32,
          subtotal: 3200,
          taxRatePercentSnapshot: 5,
          taxAmount: 160,
          total: 3360,
        },
      ],
      createdAt: now,
      createdBy: ownerUid,
    });

    console.log(`✓ Provisioned Operational Entities (Catalog, StockBalances, Customer, Vendor, Bill, Outflow).`);
  }

  // 2h. Organization B (Multi-Branch Wholesale Demo) — provisioned for api-explorer-demo
  if (profile === "api-explorer-demo") {
    const wholesaleOrgId = "org_wholesale_sample";
    const wholesaleMainBranchId = "main-branch";
    const wholesaleWarehouseBranchId = "branch_warehouse";

    console.log(`\n--- Seeding Organization B: Multi-Branch Wholesale (${wholesaleOrgId}) ---`);

    const wholesaleOwnerEmail = "owner@wholesale.trado.local";
    const wholesaleOwnerUid = await ensureAuthUser(auth, wholesaleOwnerEmail, "Apex Wholesale Owner");
    await auth.setCustomUserClaims(wholesaleOwnerUid, {
      primaryOrganizationId: wholesaleOrgId,
      primaryBranchId: wholesaleMainBranchId,
    });
    await db.collection("users").doc(wholesaleOwnerUid).set({
      name: "Apex Wholesale Owner",
      email: wholesaleOwnerEmail,
      accountType: "admin",
      isActive: true,
      createdAt: now,
      createdBy: superAdminUid,
    });

    await db.collection("organizations").doc(wholesaleOrgId).set({
      name: "Apex Wholesale Hub",
      businessType: BusinessType.WHOLESALE_ONLY,
      businessCategory: BusinessCategory.GENERAL,
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      status: EntityStatus.ACTIVE,
      planId: "plan_growth",
      moduleToggles: { billing: true, inventory: true, sales: true, staff: true, reports: true },
      defaultBranchId: wholesaleMainBranchId,
      branchCount: 2,
      sharingPolicies: {
        customers: "all_branches",
        vendors: "all_branches",
        products: "all_branches",
      },
      createdAt: now,
      createdBy: superAdminUid,
    });

    // Branches for Org B
    await db.collection("organizations").doc(wholesaleOrgId).collection("branches").doc(wholesaleMainBranchId).set({
      organizationId: wholesaleOrgId,
      name: "Wholesale Main HQ",
      code: "MAIN",
      isDefault: true,
      isActive: true,
      status: EntityStatus.ACTIVE,
      gstin: "29ABCDE1234F1Z5",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("branchCodeLocks").doc(`${wholesaleOrgId}_MAIN`).set({
      organizationId: wholesaleOrgId,
      branchCode: "MAIN",
      branchId: wholesaleMainBranchId,
      createdAt: now,
    });

    await db.collection("organizations").doc(wholesaleOrgId).collection("branches").doc(wholesaleWarehouseBranchId).set({
      organizationId: wholesaleOrgId,
      name: "Central Warehouse WH01",
      code: "WH01",
      isDefault: false,
      isActive: true,
      status: EntityStatus.ACTIVE,
      gstin: "29ABCDE1234F1Z5",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("branchCodeLocks").doc(`${wholesaleOrgId}_WH01`).set({
      organizationId: wholesaleOrgId,
      branchCode: "WH01",
      branchId: wholesaleWarehouseBranchId,
      createdAt: now,
    });

    // Owner Membership for Org B
    const wholesaleOwnerMembershipId = `${wholesaleOwnerUid}_${wholesaleOrgId}`;
    await db.collection("memberships").doc(wholesaleOwnerMembershipId).set({
      userId: wholesaleOwnerUid,
      organizationId: wholesaleOrgId,
      roleId: "role_org_owner",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: wholesaleMainBranchId,
      assignedBranchIds: [wholesaleMainBranchId, wholesaleWarehouseBranchId],
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("membershipBranches").doc(`${wholesaleOwnerMembershipId}_${wholesaleMainBranchId}`).set({
      membershipId: wholesaleOwnerMembershipId,
      userId: wholesaleOwnerUid,
      organizationId: wholesaleOrgId,
      branchId: wholesaleMainBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("membershipBranches").doc(`${wholesaleOwnerMembershipId}_${wholesaleWarehouseBranchId}`).set({
      membershipId: wholesaleOwnerMembershipId,
      userId: wholesaleOwnerUid,
      organizationId: wholesaleOrgId,
      branchId: wholesaleWarehouseBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: false,
      permissions: {},
      createdAt: now,
      createdBy: superAdminUid,
    });

    // Staff for Org B
    const mgrEmail = "manager@wholesale.trado.local";
    const mgrUid = await ensureAuthUser(auth, mgrEmail, "Wholesale Multi-Branch Manager");
    await auth.setCustomUserClaims(mgrUid, {
      primaryOrganizationId: wholesaleOrgId,
      primaryBranchId: wholesaleMainBranchId,
    });
    await db.collection("users").doc(mgrUid).set({
      name: "Wholesale Multi-Branch Manager",
      email: mgrEmail,
      accountType: "staff",
      isActive: true,
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    const mgrMemId = `${mgrUid}_${wholesaleOrgId}`;
    await db.collection("memberships").doc(mgrMemId).set({
      userId: mgrUid,
      organizationId: wholesaleOrgId,
      roleId: "role_store_manager",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: wholesaleMainBranchId,
      assignedBranchIds: [wholesaleMainBranchId, wholesaleWarehouseBranchId],
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("membershipBranches").doc(`${mgrMemId}_${wholesaleMainBranchId}`).set({
      membershipId: mgrMemId,
      userId: mgrUid,
      organizationId: wholesaleOrgId,
      branchId: wholesaleMainBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("membershipBranches").doc(`${mgrMemId}_${wholesaleWarehouseBranchId}`).set({
      membershipId: mgrMemId,
      userId: mgrUid,
      organizationId: wholesaleOrgId,
      branchId: wholesaleWarehouseBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: false,
      permissions: {},
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    const cashierEmail = "cashier@wholesale.trado.local";
    const cashierUid = await ensureAuthUser(auth, cashierEmail, "Wholesale Cashier");
    await auth.setCustomUserClaims(cashierUid, {
      primaryOrganizationId: wholesaleOrgId,
      primaryBranchId: wholesaleMainBranchId,
    });
    await db.collection("users").doc(cashierUid).set({
      name: "Wholesale Cashier",
      email: cashierEmail,
      accountType: "staff",
      isActive: true,
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    const cashierMemId = `${cashierUid}_${wholesaleOrgId}`;
    await db.collection("memberships").doc(cashierMemId).set({
      userId: cashierUid,
      organizationId: wholesaleOrgId,
      roleId: "role_cashier",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: wholesaleMainBranchId,
      assignedBranchIds: [wholesaleMainBranchId],
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("membershipBranches").doc(`${cashierMemId}_${wholesaleMainBranchId}`).set({
      membershipId: cashierMemId,
      userId: cashierUid,
      organizationId: wholesaleOrgId,
      branchId: wholesaleMainBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    const riderEmail = "rider@wholesale.trado.local";
    const riderUid = await ensureAuthUser(auth, riderEmail, "Wholesale Rider");
    await auth.setCustomUserClaims(riderUid, {
      primaryOrganizationId: wholesaleOrgId,
      primaryBranchId: wholesaleMainBranchId,
    });
    await db.collection("users").doc(riderUid).set({
      name: "Wholesale Rider",
      email: riderEmail,
      accountType: "staff",
      isActive: true,
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    const riderMemId = `${riderUid}_${wholesaleOrgId}`;
    await db.collection("memberships").doc(riderMemId).set({
      userId: riderUid,
      organizationId: wholesaleOrgId,
      roleId: "role_rider",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: wholesaleMainBranchId,
      assignedBranchIds: [wholesaleMainBranchId],
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("membershipBranches").doc(`${riderMemId}_${wholesaleMainBranchId}`).set({
      membershipId: riderMemId,
      userId: riderUid,
      organizationId: wholesaleOrgId,
      branchId: wholesaleMainBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    // Catalog & StockBalances for Org B
    const catGrainsId = "cat_grains_sample";
    await db.collection("categories").doc(catGrainsId).set({
      organizationId: wholesaleOrgId,
      name: "Grains & Cereals",
      description: "Bulk grains and staple commodities",
      status: "active",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    const unitSackId = "unit_sack_sample";
    await db.collection("units").doc(unitSackId).set({
      organizationId: wholesaleOrgId,
      name: "Sack 25kg",
      code: "sack",
      group: "weight",
      baseMultiplier: 25,
      status: "active",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    const prodRiceId = "prod_rice_sack";
    const barcodeRice = "8901234567899";
    await db.collection("products").doc(prodRiceId).set({
      organizationId: wholesaleOrgId,
      name: "Whole Grain Basmati Rice 25kg",
      categoryId: catGrainsId,
      categoryNameSnapshot: "Grains & Cereals",
      baseUnit: "sack",
      barcode: barcodeRice,
      sellingPrice: 1200,
      costPrice: 950,
      taxInclusive: false,
      taxRatePercent: 5,
      hasExpiry: true,
      trackStock: true,
      initialStock: 350,
      currentStock: 350,
      lowStockThreshold: 30,
      status: "active",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });
    await db.collection("barcodeLocks").doc(`${wholesaleOrgId}_${barcodeRice}`).set({
      organizationId: wholesaleOrgId,
      productId: prodRiceId,
      barcode: barcodeRice,
      createdAt: now,
    });

    await db.collection("stockBalances").doc(`${wholesaleOrgId}_${wholesaleMainBranchId}_${prodRiceId}`).set({
      organizationId: wholesaleOrgId,
      branchId: wholesaleMainBranchId,
      productId: prodRiceId,
      currentStock: 100,
      allocatedStock: 0,
      availableStock: 100,
      reorderPoint: 25,
      lowStockThreshold: 25,
      updatedAt: now,
    });
    await db.collection("stockBalances").doc(`${wholesaleOrgId}_${wholesaleWarehouseBranchId}_${prodRiceId}`).set({
      organizationId: wholesaleOrgId,
      branchId: wholesaleWarehouseBranchId,
      productId: prodRiceId,
      currentStock: 250,
      allocatedStock: 0,
      availableStock: 250,
      reorderPoint: 50,
      lowStockThreshold: 50,
      updatedAt: now,
    });

    // Parties for Org B
    const custAllId = "cust_wholesale_all";
    await db.collection("customers").doc(custAllId).set({
      organizationId: wholesaleOrgId,
      customerCode: "CUST-000001",
      name: "Apex Bulk Mart",
      mobile: "9876543201",
      email: "contact@bulkmart.local",
      taxNumber: "29ABCDE1234F1Z5",
      billingAddress: "100 Highway Junction, Bangalore",
      creditLimit: 200000,
      currentBalance: 0,
      visibilityScope: "all_branches",
      status: "active",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    const custWhOnlyId = "cust_warehouse_only";
    await db.collection("customers").doc(custWhOnlyId).set({
      organizationId: wholesaleOrgId,
      customerCode: "CUST-000002",
      name: "Metro Logistics Depot",
      mobile: "9876543202",
      email: "depot@metrologistics.local",
      taxNumber: "29ABCDE1234F1Z6",
      billingAddress: "Warehouse Zone 3, Hubli",
      creditLimit: 150000,
      currentBalance: 0,
      visibilityScope: "branch_only",
      sharedForBranchIds: [wholesaleWarehouseBranchId],
      status: "active",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    const vendBulkId = "vend_bulk_grain";
    await db.collection("vendors").doc(vendBulkId).set({
      organizationId: wholesaleOrgId,
      vendorCode: "VEND-000001",
      name: "National Grain Producers",
      mobile: "9123456701",
      email: "supply@nationalgrain.local",
      taxNumber: "29XYZAB5678C1Z3",
      address: "Agricultural Estate, Punjab",
      currentBalance: 0,
      visibilityScope: "all_branches",
      status: "active",
      createdAt: now,
      createdBy: wholesaleOwnerUid,
    });

    console.log(`✓ Provisioned Organization B: Wholesale Hub, 2 Branches, Stock Balances, Branch-scoped Customers.`);
  }

  // 2i. Generate and save local credentials file
  const demoPassword = process.env.TRADO_EMULATOR_DEMO_PASSWORD || "TestPassword123!";
  const credentials = [
    {
      persona: "Super Admin",
      label: "Platform Super Admin",
      role: "Platform Super Admin",
      email: "superadmin@trado.local",
      password: demoPassword,
      organizationName: "None (Platform)",
      organizationId: null,
      branches: [],
      scope: "platform",
      description: "Platform management, plan creation, and global diagnostics."
    },
    {
      persona: "Retail Owner",
      label: "Apex Retail Owner",
      role: "Organization Owner",
      email: "owner@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies",
      organizationId: sampleOrgId,
      branches: ["main-branch"],
      scope: "tenant",
      description: "Full tenant administration for Retail demo (single-branch)."
    },
    {
      persona: "Retail Admin",
      label: "Apex Retail Admin",
      role: "Organization Admin",
      email: "admin@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies",
      organizationId: sampleOrgId,
      branches: ["main-branch"],
      scope: "tenant",
      description: "Staff and catalog management in Retail demo."
    },
    {
      persona: "Retail Cashier",
      label: "Apex Retail Cashier",
      role: "Cashier",
      email: "cashier@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies",
      organizationId: sampleOrgId,
      branches: ["main-branch"],
      scope: "tenant",
      description: "POS billing and cash collection restricted to main branch."
    },
    {
      persona: "Retail Manager",
      label: "Apex Retail Manager",
      role: "Store Manager",
      email: "manager@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies",
      organizationId: sampleOrgId,
      branches: ["main-branch"],
      scope: "tenant",
      description: "Inventory stock adjustments and replenishment."
    },
    {
      persona: "Retail Rider",
      label: "Apex Retail Rider",
      role: "Delivery Rider",
      email: "rider@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies",
      organizationId: sampleOrgId,
      branches: ["main-branch"],
      scope: "tenant",
      description: "Dispatch and delivery updates for orders."
    },
    {
      persona: "Wholesale Owner",
      label: "Wholesale Owner",
      role: "Organization Owner",
      email: "owner@wholesale.trado.local",
      password: demoPassword,
      organizationName: "Apex Wholesale Hub",
      organizationId: "org_wholesale_sample",
      branches: ["main-branch", "branch_warehouse"],
      scope: "tenant",
      description: "Full owner access across all branches of Wholesale demo."
    },
    {
      persona: "Wholesale Manager",
      label: "Wholesale Manager",
      role: "Store Manager",
      email: "manager@wholesale.trado.local",
      password: demoPassword,
      organizationName: "Apex Wholesale Hub",
      organizationId: "org_wholesale_sample",
      branches: ["main-branch", "branch_warehouse"],
      scope: "tenant",
      description: "Multi-branch manager with access to both Main HQ and Central Warehouse."
    },
    {
      persona: "Wholesale Cashier",
      label: "Wholesale Cashier",
      role: "Cashier",
      email: "cashier@wholesale.trado.local",
      password: demoPassword,
      organizationName: "Apex Wholesale Hub",
      organizationId: "org_wholesale_sample",
      branches: ["main-branch"],
      scope: "tenant",
      description: "Cashier restricted strictly to Wholesale Main branch."
    },
    {
      persona: "Wholesale Rider",
      label: "Wholesale Rider",
      role: "Delivery Rider",
      email: "rider@wholesale.trado.local",
      password: demoPassword,
      organizationName: "Apex Wholesale Hub",
      organizationId: "org_wholesale_sample",
      branches: ["main-branch"],
      scope: "tenant",
      description: "Delivery rider for wholesale orders."
    }
  ];

  try {
    const cwd = process.cwd();
    // Resolve project root .local/
    let localDir = path.resolve(cwd, ".local");
    if (!fs.existsSync(path.join(cwd, "firebase.json")) && fs.existsSync(path.join(cwd, "..", "firebase.json"))) {
      localDir = path.resolve(cwd, "..", ".local");
    }
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const credsPath = path.join(localDir, "api-explorer-credentials.json");
    fs.writeFileSync(credsPath, JSON.stringify(credentials, null, 2), "utf8");
    console.log(`\n✓ Written demo credentials to: ${credsPath}`);
  } catch (err: any) {
    console.warn(`[WARN] Could not write .local credentials file: ${err.message}`);
  }
}

// 3. Read-Only Check Mode
export async function checkSeedState(db: Firestore, auth: Auth): Promise<boolean> {
  console.log("\n=== Checking Local Emulator Data State ===");

  const collectionsToCheck = [
    "modules",
    "taxRegimes",
    "subscriptionPlans",
    "permissionCatalog",
    "roles",
    "jobRoles",
    "organizations",
    "users",
    "memberships",
    "membershipBranches",
    "products",
    "stockBalances",
    "branchCodeLocks",
    "barcodeLocks",
    "customers",
    "vendors",
    "bills",
    "outflows",
  ];

  const results: Record<string, number> = {};
  let allHealthy = true;

  for (const col of collectionsToCheck) {
    const snap = await db.collection(col).get();
    results[col] = snap.size;
    console.log(`  - ${col.padEnd(20)}: ${snap.size} documents`);
    if (snap.size === 0 && ["modules", "taxRegimes", "subscriptionPlans", "permissionCatalog", "roles"].includes(col)) {
      allHealthy = false;
    }
  }

  // Check demo organization and branch
  const demoOrgSnap = await db.collection("organizations").doc("org_apex_sample").get();
  const demoBranchSnap = await db
    .collection("organizations")
    .doc("org_apex_sample")
    .collection("branches")
    .doc("main-branch")
    .get();

  console.log(`\nDemo Org (org_apex_sample)     : ${demoOrgSnap.exists ? "EXISTS" : "MISSING"}`);
  console.log(`Demo Branch (main-branch)      : ${demoBranchSnap.exists ? "EXISTS" : "MISSING"}`);

  if (!demoOrgSnap.exists || !demoBranchSnap.exists) {
    allHealthy = false;
  }

  // Check superadmin user
  try {
    const adminUser = await auth.getUserByEmail("superadmin@trado.local");
    console.log(`Super Admin User Auth          : EXISTS (${adminUser.uid})`);
  } catch {
    console.log(`Super Admin User Auth          : MISSING`);
    allHealthy = false;
  }

  if (allHealthy) {
    console.log("\n[PASS] Local emulator seed state is healthy and complete.\n");
    return true;
  } else {
    console.log("\n[INCOMPLETE] Some seed data or reference catalogs are missing.\n");
    return false;
  }
}

// 4. Reset Seed Data
export async function resetSeedData(db: Firestore, auth: Auth): Promise<void> {
  console.log("\n=== Resetting Seed Data ===");
  const sampleOrgId = "org_apex_sample";
  const wholesaleOrgId = "org_wholesale_sample";

  // Delete known sample documents from Org A and Org B
  const sampleDocs = [
    { col: "bills", id: "bill_sample_001" },
    { col: "outflows", id: "outflow_sample_001" },
    { col: "customers", id: "cust_citymart_sample" },
    { col: "vendors", id: "vend_goldengrain_sample" },
    { col: "products", id: "prod_bread_sample" },
    { col: "categories", id: "cat_bakery_sample" },
    { col: "units", id: "unit_pack_sample" },
    { col: "barcodeLocks", id: `${sampleOrgId}_8901234567890` },
    { col: "branchCodeLocks", id: `${sampleOrgId}_MAIN` },
    { col: "branchCodeLocks", id: `${sampleOrgId}_WH01` },
    { col: "stockBalances", id: `${sampleOrgId}_main-branch_prod_bread_sample` },
    { col: "stockBalances", id: `${sampleOrgId}_branch_warehouse_prod_bread_sample` },
    // Org B documents
    { col: "customers", id: "cust_wholesale_all" },
    { col: "customers", id: "cust_warehouse_only" },
    { col: "vendors", id: "vend_bulk_grain" },
    { col: "products", id: "prod_rice_sack" },
    { col: "categories", id: "cat_grains_sample" },
    { col: "units", id: "unit_sack_sample" },
    { col: "barcodeLocks", id: `${wholesaleOrgId}_8901234567899` },
    { col: "branchCodeLocks", id: `${wholesaleOrgId}_MAIN` },
    { col: "branchCodeLocks", id: `${wholesaleOrgId}_WH01` },
    { col: "stockBalances", id: `${wholesaleOrgId}_main-branch_prod_rice_sack` },
    { col: "stockBalances", id: `${wholesaleOrgId}_branch_warehouse_prod_rice_sack` },
  ];

  for (const d of sampleDocs) {
    await db.collection(d.col).doc(d.id).delete();
  }

  // Delete subcollection branches for Org A, Org B, and Suspended Org
  for (const orgId of [sampleOrgId, wholesaleOrgId, "org_suspended_sample"]) {
    const branchesSnap = await db.collection("organizations").doc(orgId).collection("branches").get();
    for (const b of branchesSnap.docs) {
      await b.ref.delete();
    }
    await db.collection("organizations").doc(orgId).delete();
  }

  // Delete seed users and memberships
  const seedEmails = [
    "superadmin@trado.local",
    "owner@apexwholesale.local",
    "admin@apexwholesale.local",
    "cashier@apexwholesale.local",
    "rider@apexwholesale.local",
    "manager@apexwholesale.local",
    "inactive@apexwholesale.local",
    "deactivated_member@apexwholesale.local",
    "suspended_org_user@apexwholesale.local",
    "owner@wholesale.trado.local",
    "manager@wholesale.trado.local",
    "cashier@wholesale.trado.local",
    "rider@wholesale.trado.local",
  ];

  for (const email of seedEmails) {
    try {
      const user = await auth.getUserByEmail(email);
      await db.collection("users").doc(user.uid).delete();
      const mSnap = await db.collection("memberships").where("userId", "==", user.uid).get();
      for (const m of mSnap.docs) {
        await m.ref.delete();
      }
      const mbSnap = await db.collection("membershipBranches").where("userId", "==", user.uid).get();
      for (const mb of mbSnap.docs) {
        await mb.ref.delete();
      }
      await auth.deleteUser(user.uid);
      console.log(`✓ Deleted user and memberships for ${email}`);
    } catch {
      // Ignored if user does not exist
    }
  }

  console.log("✓ Seed data reset completed successfully.\n");
}

// Main execution entry point
async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  console.log("=== Trado Local Emulator Seed Tool ===");

  const safety = verifyEmulatorSafety(process.env);
  if (!safety.safe) {
    console.error(`\n[ABORTED] Safety guard failed: ${safety.error}`);
    console.error("This script is strictly restricted to local emulator environments.");
    console.error("Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099.\n");
    process.exit(1);
  }

  console.log(`Connected to Firestore emulator: ${safety.firestoreHost}`);
  console.log(`Connected to Auth emulator:      ${safety.authHost}`);
  console.log(`Target Project ID:               ${safety.projectId}`);

  if (getApps().length === 0) {
    initializeApp({ projectId: "trado-x" });
  }

  const db = getFirestore();
  const auth = getAuth();

  if (options.resetOnly) {
    await resetSeedData(db, auth);
    return;
  }

  if (options.checkOnly) {
    const ok = await checkSeedState(db, auth);
    process.exit(ok ? 0 : 1);
  }

  if (options.seedReference) {
    await seedReferenceData(db);
  }

  if (options.seedDemo) {
    await seedDemoOrganization(db, auth, options.profile);
  }

  console.log("\n[SUCCESS] Local emulator seed execution complete!\n");
}

// Only invoke main when run directly
if (process.argv[1]?.includes("seed-emulator")) {
  main().catch((err) => {
    console.error("Seed execution failed:", err);
    process.exit(1);
  });
}