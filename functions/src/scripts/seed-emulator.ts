/**
 * Emulator-Only Seeding Tool
 * 
 * Strict safety guard:
 * Refuses to run unless FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are set,
 * and project ID matches the local emulator project ("trado-x").
 * Never executes against live production environments.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_MODULES,
  DEFAULT_TAX_REGIMES,
  DEFAULT_SUBSCRIPTION_PLANS,
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_JOB_ROLES,
} from "../constants/catalogs.js";
import { AppPermissions } from "../constants/permissions.js";
import { BusinessType, BusinessCategory, EntityStatus } from "../constants/enums.js";
import {
  SeedOrgSpec, seedOrganizationFromSpec, seedBusinessData, personaCredentials,
  CYCLE_WORLD_SPEC, KITCHEN_MART_SPEC, WHOLESALE_HUB_SPEC, ALL_SEED_SPECS,
} from "./seed-business-data.js";
import { uniqueKeyId } from "../services/naturalKeys.js";

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

export type SeedProfile = "minimal" | "staff-demo" | "operations-demo" | "multi-branch-test" | "api-explorer-demo" | "flagship-demo";

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
    if (p === "minimal" || p === "staff-demo" || p === "operations-demo" || p === "multi-branch-test" || p === "api-explorer-demo" || p === "flagship-demo") {
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
    const { id, ...planDoc } = plan; // the id is the document id, never a field
    await db.collection("subscriptionPlans").doc(id).set(planDoc);
  }
  // Archived and disposable plans for Super Admin lifecycle verification
  await db.collection("subscriptionPlans").doc("plan_archived_legacy").set({
    name: "Legacy Starter Plan (Archived)",
    price: 499,
    currency: "INR",
    storageLimitMb: 1024,
    monthlyDocumentVolumeLimit: 2000,
    seatLimits: { admin: 1, staff: 3 },
    moduleFlags: { billing: true, inventory: true },
    branchLimit: 1,
    isActive: false,
    isArchived: true,
    createdAt: new Date().toISOString(),
  });
  await db.collection("subscriptionPlans").doc("plan_disposable_unused").set({
    name: "Disposable Tier 0 Plan (Unused)",
    price: 99,
    currency: "INR",
    storageLimitMb: 512,
    monthlyDocumentVolumeLimit: 500,
    seatLimits: { admin: 1, staff: 1 },
    moduleFlags: { billing: true },
    branchLimit: 1,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
  });
  console.log(`✓ Seeded ${DEFAULT_SUBSCRIPTION_PLANS.length + 2} subscription plans (including archived & unused).`);

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

/** Apex Retail operations data (its structure and negative personas are provisioned below). */
function apexOperationsSpec(isMultiBranch: boolean): SeedOrgSpec {
  return {
    organizationId: "org_apex_sample",
    name: "Apex Wholesale Supplies",
    businessType: BusinessType.WHOLESALE_RETAIL,
    businessCategory: BusinessCategory.GENERAL,
    planId: isMultiBranch ? "plan_growth" : "plan_starter",
    branches: [{ branchId: "main-branch", name: "Main Branch", code: "MAIN" }],
    owner: { email: "owner@apexwholesale.local", name: "Apex Owner" },
    personas: [],
    categories: [{ id: "cat_bakery_sample", name: "Bakery & Confectionery" }],
    units: [{ id: "unit_pack_sample", name: "Pack", code: "pack" }],
    products: [{ id: "prod_bread_sample", name: "Whole Wheat Bread 400g", categoryId: "cat_bakery_sample", baseUnit: "pack", barcode: "8901234567890", sellingPrice: 45, costPrice: 32, taxRatePercent: 5, hasExpiry: true, lowStockThreshold: 15 }],
    customers: [{ id: "cust_citymart_sample", code: "CUST-000001", name: "City Mart Supermarket", phone: "9876543210", email: "contact@citymart.local", taxId: "29ABCDE1234F1Z5", addresses: [{ id: "addr_1", line1: "42 Market Street", city: "Bangalore", state: "Karnataka", postalCode: "560001", country: "IN", isDefaultBilling: true }], creditLimit: 50000 }],
    vendors: [{ id: "vend_goldengrain_sample", code: "VEND-000001", name: "Golden Grain Mills", phone: "9123456780", email: "orders@goldengrain.local", taxId: "29XYZAB5678C1Z2", addresses: [{ id: "addr_1", line1: "10 Industrial Area", city: "Hubli", state: "Karnataka", postalCode: "580028", country: "IN" }] }],
    openingStock: [
      { productId: "prod_bread_sample", branchId: "main-branch", quantity: 100 },
      ...(isMultiBranch ? [{ productId: "prod_bread_sample", branchId: "branch_warehouse", quantity: 50 }] : []),
    ],
    transactions: [
      { as: "owner", fn: "outflowsCreate", step: "pur-golden-grain", data: { kind: "purchase", vendorId: "vend_goldengrain_sample", invoiceNumber: "GG-0001", paidAmount: 3360, lines: [{ productId: "prod_bread_sample", quantity: 100, unit: "pack", unitPrice: 32, taxPercent: 5 }] } },
      { as: "cashier", fn: "billsCreate", step: "sale-city-mart", data: { salesMode: "b2b", customerId: "cust_citymart_sample", items: [{ productId: "prod_bread_sample", quantity: 2 }], paidAmount: 94.5 } },
    ],
  };
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
      settings: { taxId: "29ABCDE1234F1Z5" },
      createdAt: now,
      createdBy: ownerUid,
    });

  // Lock for MAIN branch code
  await db.collection("uniqueKeys").doc(uniqueKeyId(sampleOrgId, "branch_code", "MAIN")).set({ organizationId: sampleOrgId, kind: "branch_code", entityType: "branch", entityId: defaultBranchId, createdAt: now });

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
        settings: { taxId: "29ABCDE1234F1Z5" },
        createdAt: now,
        createdBy: ownerUid,
      });

    await db.collection("uniqueKeys").doc(uniqueKeyId(sampleOrgId, "branch_code", "WH01")).set({ organizationId: sampleOrgId, kind: "branch_code", entityType: "branch", entityId: secondaryBranchId, createdAt: now });

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

  const apexUids: Record<string, string> = { owner: ownerUid };

  // 2f. Staff Members (if profile is staff-demo, operations-demo, or multi-branch-test)
  if (profile !== "minimal") {
    const staffPersonas = [
      { key: "admin", email: "admin@apexwholesale.local", name: "Apex Admin", roleId: "role_admin" },
      { key: "cashier", email: "cashier@apexwholesale.local", name: "Apex Cashier", roleId: "role_cashier" },
      { key: "rider", email: "rider@apexwholesale.local", name: "Apex Rider", roleId: "role_rider" },
      { key: "manager", email: "manager@apexwholesale.local", name: "Apex Manager", roleId: "role_store_manager" },
    ];

    for (const s of staffPersonas) {
      const uid = await ensureAuthUser(auth, s.email, s.name);
      apexUids[s.key] = uid;
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
      createdAt: now,
      createdBy: ownerUid,
    });

    // 3. Inactive Branch in Org A with assigned employee persona
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
        createdAt: now,
        createdBy: ownerUid,
      });

    const inactiveBranchEmpEmail = "inactive_branch_emp@apexwholesale.local";
    const inactiveBranchEmpUid = await ensureAuthUser(auth, inactiveBranchEmpEmail, "Apex Inactive Branch Staff");
    await auth.setCustomUserClaims(inactiveBranchEmpUid, {
      primaryOrganizationId: sampleOrgId,
      primaryBranchId: inactiveBranchId,
    });
    await db.collection("users").doc(inactiveBranchEmpUid).set({
      name: "Apex Inactive Branch Staff",
      email: inactiveBranchEmpEmail,
      accountType: "staff",
      isActive: true,
      createdAt: now,
      createdBy: ownerUid,
    });
    const inactBranchMId = `${inactiveBranchEmpUid}_${sampleOrgId}`;
    await db.collection("memberships").doc(inactBranchMId).set({
      userId: inactiveBranchEmpUid,
      organizationId: sampleOrgId,
      roleId: "role_cashier",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: inactiveBranchId,
      createdAt: now,
      createdBy: ownerUid,
    });
    await db.collection("membershipBranches").doc(`${inactBranchMId}_${inactiveBranchId}`).set({
      membershipId: inactBranchMId,
      userId: inactiveBranchEmpUid,
      organizationId: sampleOrgId,
      branchId: inactiveBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
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
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("organizations").doc(suspendedOrgId).collection("branches").doc("main-branch").set({
      organizationId: suspendedOrgId,
      name: "Main Branch",
      code: "MAIN",
      isDefault: true,
      isActive: true,
      createdAt: now,
      createdBy: superAdminUid,
    });

    // 5. Organization with Expired Subscription
    const expiredOrgId = "org_expired_subscription";
    await db.collection("organizations").doc(expiredOrgId).set({
      name: "Expired Sub Trading Co",
      businessType: BusinessType.RETAIL_ONLY,
      businessCategory: BusinessCategory.GENERAL,
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      status: EntityStatus.ACTIVE,
      planId: "plan_growth",
      moduleToggles: { billing: true, inventory: true },
      subscriptionStatus: "expired",
      subscriptionExpiresAt: "2026-01-01T00:00:00Z",
      graceDays: 0,
      defaultBranchId: "main-branch",
      branchCount: 1,
      createdAt: now,
      createdBy: superAdminUid,
    });
    const expiredOwnerEmail = "expired_owner@apexwholesale.local";
    const expiredOwnerUid = await ensureAuthUser(auth, expiredOwnerEmail, "Expired Org Owner");
    await auth.setCustomUserClaims(expiredOwnerUid, {
      primaryOrganizationId: expiredOrgId,
      primaryBranchId: "main-branch",
    });
    await db.collection("users").doc(expiredOwnerUid).set({
      name: "Expired Org Owner",
      email: expiredOwnerEmail,
      accountType: "standard",
      isActive: true,
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("memberships").doc(`${expiredOwnerUid}_${expiredOrgId}`).set({
      userId: expiredOwnerUid,
      organizationId: expiredOrgId,
      roleId: "role_org_owner",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: "main-branch",
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("organizations").doc(expiredOrgId).collection("branches").doc("main-branch").set({
      organizationId: expiredOrgId,
      name: "Main Branch",
      code: "MAIN",
      isDefault: true,
      isActive: true,
      createdAt: now,
      createdBy: superAdminUid,
    });

    // 6. Multi-Organization User
    const multiOrgEmail = "multi_org_user@apexwholesale.local";
    const multiOrgUid = await ensureAuthUser(auth, multiOrgEmail, "Multi Org Staff");
    await auth.setCustomUserClaims(multiOrgUid, {
      primaryOrganizationId: sampleOrgId,
      primaryBranchId: defaultBranchId,
    });
    await db.collection("users").doc(multiOrgUid).set({
      name: "Multi Org Staff",
      email: multiOrgEmail,
      accountType: "standard",
      isActive: true,
      createdAt: now,
      createdBy: superAdminUid,
    });
    const mOrg1Id = `${multiOrgUid}_${sampleOrgId}`;
    await db.collection("memberships").doc(mOrg1Id).set({
      userId: multiOrgUid,
      organizationId: sampleOrgId,
      roleId: "role_admin",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: defaultBranchId,
      createdAt: now,
      createdBy: ownerUid,
    });
    await db.collection("membershipBranches").doc(`${mOrg1Id}_${defaultBranchId}`).set({
      membershipId: mOrg1Id,
      userId: multiOrgUid,
      organizationId: sampleOrgId,
      branchId: defaultBranchId,
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: ownerUid,
    });
    const mOrg2Id = `${multiOrgUid}_${WHOLESALE_HUB_SPEC.organizationId}`;
    await db.collection("memberships").doc(mOrg2Id).set({
      userId: multiOrgUid,
      organizationId: WHOLESALE_HUB_SPEC.organizationId,
      roleId: "role_cashier",
      jobRoleIds: [],
      reportingToIds: [],
      permissions: {},
      status: EntityStatus.ACTIVE,
      isPrimary: false,
      primaryBranchId: "main-branch",
      createdAt: now,
      createdBy: superAdminUid,
    });
    await db.collection("membershipBranches").doc(`${mOrg2Id}_main-branch`).set({
      membershipId: mOrg2Id,
      userId: multiOrgUid,
      organizationId: WHOLESALE_HUB_SPEC.organizationId,
      branchId: "main-branch",
      status: EntityStatus.ACTIVE,
      isDefaultForMembership: true,
      permissions: {},
      createdAt: now,
      createdBy: superAdminUid,
    });

    // Audit events are never seeded by hand: they are written by services/auditRecorder.ts for real
    // actions (D-23), e.g. by the seed suites that go through the callables.
    // Seat counter = active non-owner memberships in sampleOrgId:
    // 4 staff personas + inactive user (active membership) + inactive branch staff + multi-org staff = 7
    const sampleOrgActiveStaffCount = staffPersonas.length + 3;
    await db.collection("organizations").doc(sampleOrgId).update({ activeEmployeeCount: sampleOrgActiveStaffCount });
    console.log(`✓ Provisioned Negative Testing Entities (Inactive User, Deactivated Membership, Inactive Branch, Suspended Org).`);
  }

  // 2g. Operational records: master data + opening stock + a purchase and a sale, created through
  // the real callables (stock ledger, balances and party ledgers stay consistent)
  if (profile === "operations-demo" || profile === "multi-branch-test") {
    await seedBusinessData(db, apexOperationsSpec(isMultiBranch), apexUids);
    console.log(`✓ Provisioned Operational Entities through the callables (catalog, opening stock, purchase, sale).`);
  }

  // 2h. Organization B (multi-branch wholesale) and the flagship businesses (bicycle, kitchenware)
  const extraSpecs: SeedOrgSpec[] = profile === "api-explorer-demo" ? ALL_SEED_SPECS
    : profile === "flagship-demo" ? [CYCLE_WORLD_SPEC, KITCHEN_MART_SPEC] : [];
  const demoPassword = process.env.TRADO_EMULATOR_DEMO_PASSWORD || "TestPassword123!";
  for (const spec of extraSpecs) {
    await seedOrganizationFromSpec(db, auth, spec, demoPassword, superAdminUid);
    console.log(`✓ Provisioned ${spec.name} (${spec.organizationId}): ${spec.personas.length + 1} personas, ${(spec.products || []).length} products, ${(spec.transactions || []).length} transactions`);
  }

  // 2h-reconcile. Reconcile activeEmployeeCount across all organizations to match active non-owner memberships
  const allMembershipsSnap = await db.collection("memberships").get();
  const activeMembersByOrg = new Map<string, number>();
  for (const mDoc of allMembershipsSnap.docs) {
    const m = mDoc.data();
    if (m.status === EntityStatus.ACTIVE && m.roleId !== "role_org_owner" && m.organizationId) {
      activeMembersByOrg.set(m.organizationId, (activeMembersByOrg.get(m.organizationId) || 0) + 1);
    }
  }
  const allOrgsSnap = await db.collection("organizations").get();
  for (const orgDoc of allOrgsSnap.docs) {
    const expected = activeMembersByOrg.get(orgDoc.id) || 0;
    if (orgDoc.data().activeEmployeeCount !== expected) {
      await orgDoc.ref.update({ activeEmployeeCount: expected });
    }
  }

  // 2i. Generate and save local credentials file
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
      persona: "Inactive Branch Staff",
      label: "Apex Inactive Branch Staff",
      role: "Cashier",
      email: "inactive_branch_emp@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies",
      organizationId: sampleOrgId,
      branches: ["branch_inactive"],
      scope: "tenant",
      description: "Staff assigned exclusively to an inactive branch (negative testing)."
    },
    {
      persona: "Expired Sub Owner",
      label: "Expired Org Owner",
      role: "Organization Owner",
      email: "expired_owner@apexwholesale.local",
      password: demoPassword,
      organizationName: "Expired Sub Trading Co",
      organizationId: "org_expired_subscription",
      branches: ["main-branch"],
      scope: "tenant",
      description: "Organization with expired subscription (SUBSCRIPTION_EXPIRED verification)."
    },
    {
      persona: "Multi Org Staff",
      label: "Multi Org Staff",
      role: "Admin & Cashier",
      email: "multi_org_user@apexwholesale.local",
      password: demoPassword,
      organizationName: "Apex Retail Supplies & Apex Wholesale Hub",
      organizationId: sampleOrgId,
      branches: ["main-branch"],
      scope: "tenant",
      description: "User with active memberships in two distinct organizations."
    },
    ...extraSpecs.flatMap((spec) => personaCredentials(spec, demoPassword)),
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
  } catch (err) {
    console.warn(`[WARN] Could not write .local credentials file: ${err instanceof Error ? err.message : undefined}`);
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
    "uniqueKeys",
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
  // Every document of every seed organization (whatever created it), its idempotency records,
  // branches and the organization itself. Non-seed organizations are never touched.
  for (const orgId of SEED_ORGANIZATION_IDS) {
    let deleted = 0;
    for (const col of await db.listCollections()) {
      const field = col.id === "idempotencyRecords" ? "scope" : "organizationId";
      const snap = await col.where(field, "==", orgId).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      deleted += snap.size;
    }
    const branchesSnap = await db.collection("organizations").doc(orgId).collection("branches").get();
    for (const br of branchesSnap.docs) await br.ref.delete();
    await db.collection("organizations").doc(orgId).delete();
    console.log(`✓ Deleted ${orgId} and ${deleted} organization-scoped documents`);
  }

  // Seed users (auth + profile + devices); memberships went with their organization above
  for (const email of seedEmails()) {
    try {
      const user = await auth.getUserByEmail(email);
      const devices = await db.collection("users").doc(user.uid).collection("devices").get();
      for (const d of devices.docs) await d.ref.delete();
      await db.collection("users").doc(user.uid).delete();
      await auth.deleteUser(user.uid);
    } catch {
      // Ignored if user does not exist
    }
  }
  console.log("✓ Seed data reset completed successfully.\n");
}

/** Organizations owned by the seed (deterministic ids). */
const SEED_ORGANIZATION_IDS = ["org_apex_sample", "org_suspended_sample", ...ALL_SEED_SPECS.map((spec) => spec.organizationId)];

function seedEmails(): string[] {
  const apex = ["superadmin@trado.local", "owner@apexwholesale.local", "admin@apexwholesale.local", "cashier@apexwholesale.local",
    "rider@apexwholesale.local", "manager@apexwholesale.local", "inactive@apexwholesale.local",
    "deactivated_member@apexwholesale.local", "suspended_org_user@apexwholesale.local"];
  const specs = ALL_SEED_SPECS.flatMap((spec) => [spec.owner.email, ...spec.personas.map((pp) => pp.email)]);
  return [...apex, ...specs];
}

/**
 * Fails closed: the seed's organizations must pass the dynamic data checks (no dangling or
 * cross-tenant reference, no unregistered copy, every cache reconciles, dates consistent).
 */
function verifySeededData(): boolean {
  const checker = path.resolve(__dirname, "..", "..", "scripts", "check-data-duplication.cjs");
  let ok = true;
  for (const orgId of SEED_ORGANIZATION_IDS) {
    const r = spawnSync(process.execPath, [checker, "--org", orgId], { encoding: "utf8", env: process.env });
    const summary = (r.stdout || "").trim().split("\n").pop();
    console.log(`  data check ${orgId}: ${summary}`);
    if (r.status !== 0) {
      ok = false;
      console.error(r.stdout);
    }
  }
  return ok;
}

// Main execution entry point
async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  console.log("=== Trado Local Emulator Seed Tool ===");

  // Default to local loopback Firebase Emulator ports if not explicitly defined in shell
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "trado-x";
  }

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

  // One Admin app and Firestore instance shared with the callables the seed runs in-process
  // (loaded only after the emulator safety check above)
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "trado-x";
  const { db, auth } = await import("../services/firebase.js");

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
    if (!verifySeededData()) {
      console.error("\n[FAILED] Seeded data violates the zero-duplication / reference-integrity checks.\n");
      process.exit(1);
    }
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