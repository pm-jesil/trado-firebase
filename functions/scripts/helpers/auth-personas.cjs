/**
 * Trado Firebase Backend — Reusable Persona Factory
 * 
 * Generates and provisions deterministic test personas for local emulator tests.
 */

const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { PROJECT_ID, enforceLocalEmulatorSafety } = require("./emulator-helper.cjs");
const { getIdToken, callFunction } = require("./callable-client.cjs");

enforceLocalEmulatorSafety();

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const adminAuth = getAuth();
const db = getFirestore();

/**
 * Bootstrap or retrieve the Platform Super Admin account.
 */
async function getSuperAdminPersona() {
  const email = "superadmin@trado.local";
  const password = "TestPassword123!";
  let user;
  try {
    user = await adminAuth.getUserByEmail(email);
  } catch (err) {
    user = await adminAuth.createUser({
      email,
      password,
      displayName: "Platform Super Admin",
    });
  }

  // Ensure super admin claim is present
  await adminAuth.setCustomUserClaims(user.uid, { isSuperAdmin: true });
  await db.collection("users").doc(user.uid).set({
    name: "Platform Super Admin",
    email,
    accountType: "admin",
    isActive: true,
    createdAt: new Date().toISOString(),
  }, { merge: true });
  const idToken = await getIdToken(email, password);

  return {
    uid: user.uid,
    email,
    password,
    idToken,
    isSuperAdmin: true,
  };
}

/**
 * Provision a new organization and return the Owner persona.
 */
async function createTenantOwnerPersona(superAdminToken, orgPrefix = "TestOrg", options = {}) {
  let resolvedToken = superAdminToken;
  // Default plan includes every module so functional suites exercise their module; plan-gating
  // suites pass { planId } explicitly.
  const planId = options.planId || (typeof superAdminToken === "object" && superAdminToken && superAdminToken.planId) || "plan_growth";
  if (typeof superAdminToken === "object" && superAdminToken && !superAdminToken.idToken) {
    orgPrefix = superAdminToken.orgPrefix || superAdminToken.businessName || "TestOrg";
    resolvedToken = null;
  } else if (superAdminToken && superAdminToken.idToken) {
    resolvedToken = superAdminToken.idToken;
  } else if (typeof superAdminToken === "string" && !superAdminToken.includes(".")) {
    orgPrefix = superAdminToken;
    resolvedToken = null;
  }

  if (!resolvedToken) {
    const sa = await getSuperAdminPersona();
    resolvedToken = sa.idToken;
  }

  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const orgName = `${orgPrefix} ${unique}`;
  const ownerEmail = `owner_${unique}@testorg.local`;
  const password = "TestPassword123!";

  const res = await callFunction("organizationsCreate", {
    name: orgName,
    businessType: "retail_only",
    businessCategory: "general",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    planId,
    defaultBranchName: "Main Store",
    defaultBranchCode: "MAIN",
    ownerEmail,
    ownerName: `Owner ${unique}`,
    initialPassword: password,
  }, resolvedToken);

  const idToken = await getIdToken(ownerEmail, password);

  return {
    organizationId: res.organizationId,
    ownerUserId: res.ownerUserId,
    ownerUid: res.ownerUserId,
    ownerMembershipId: res.ownerMembershipId,
    membershipId: res.ownerMembershipId,
    email: ownerEmail,
    password,
    idToken,
    primaryBranchId: "main-branch",
    organizationName: orgName,
  };
}

/**
 * Provision a staff employee under an existing organization.
 */
async function createEmployeePersona(ownerToken, organizationId, options = {}, maybeName = null) {
  const resolvedToken = (ownerToken && typeof ownerToken === "object" && ownerToken.idToken) ? ownerToken.idToken : ownerToken;
  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const roleCode = typeof options === "string" ? options : (options.roleCode || "employee");
  
  let defaultRoleId = "role_employee";
  if (roleCode === "admin" || roleCode === "org_admin" || roleCode === "role_admin") defaultRoleId = "role_admin";
  if (roleCode === "org_owner" || roleCode === "role_org_owner") defaultRoleId = "role_org_owner";

  const roleId = (typeof options === "object" && options.roleId) ? options.roleId : defaultRoleId;
  const email = (typeof options === "object" && options.email) || `${roleCode}_${unique}@testorg.local`;
  const password = (typeof options === "object" && options.password) || "TestPassword123!";
  const name = (typeof options === "object" && options.name) || maybeName || `Staff ${roleCode} ${unique}`;
  const branchId = (typeof options === "object" && options.branchId) || "main-branch";
  const assignedBranchIds = (typeof options === "object" && options.assignedBranchIds) || [branchId];
  const permissions = (typeof options === "object" && options.permissions) || {};

  const res = await callFunction("employeesCreate", {
    organizationId,
    name,
    email,
    initialPassword: password,
    roleId,
    defaultBranchId: branchId,
    branchIds: assignedBranchIds,
    permissionOverrides: permissions,
  }, resolvedToken);

  const idToken = await getIdToken(email, password);

  return {
    userId: res.userId,
    uid: res.userId,
    membershipId: res.membershipId,
    email,
    password,
    idToken,
    organizationId,
    roleCode,
    branchId,
  };
}

/**
 * Create a standalone authenticated user with zero organization memberships.
 */
async function createUnassignedUserPersona() {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const email = `unassigned_${unique}@testorg.local`;
  const password = "TestPassword123!";

  const user = await adminAuth.createUser({
    email,
    password,
    displayName: `Unassigned User ${unique}`,
  });

  await db.collection("users").doc(user.uid).set({
    name: `Unassigned User ${unique}`,
    email,
    accountType: "standard",
    isActive: true,
    createdAt: new Date().toISOString(),
  });

  const idToken = await getIdToken(email, password);

  return {
    uid: user.uid,
    email,
    password,
    idToken,
  };
}

module.exports = {
  adminAuth,
  db,
  getSuperAdminPersona,
  createTenantOwnerPersona,
  createEmployeePersona,
  createUnassignedUserPersona,
};
