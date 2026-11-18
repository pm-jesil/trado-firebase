#!/usr/bin/env node
/**
 * Membership & User Provisioning Emulator Integration Tests (TT-1, D-59)
 *
 * Moved out of the unit tier (`membershipProvisioning.test.ts`) so the unit tier opens
 * zero network connections and performs zero silent reachability skips.
 *
 * Usage (with Firebase Emulators running):
 *   node functions/scripts/test-membership-provisioning.cjs
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth, db, admin } = require("./helpers/emulator-helper.cjs");
const {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  provisionMembershipInternal,
} = require("../lib/services/membershipProvisioning.js");
const { EntityStatus } = require("../lib/constants/enums.js");

enforceLocalEmulatorSafety();

async function run() {
  console.log("\n=== Membership Provisioning Emulator Integration Suite ===");
  await verifyEmulatorHealth({ requireStorage: true });

  const auth = admin.auth();
  const testRunId = Date.now();
  const testOrgId = `prov_test_org_${testRunId}`;
  const testBranchId = `${testOrgId}_main-branch`;
  const otherOrgId = `prov_other_org_${testRunId}`;
  const otherBranchId = `${otherOrgId}_main-branch`;
  const createdUids = [];

  try {
    await db.collection("branches").doc(testBranchId).set({
      organizationId: testOrgId,
      name: "Main Branch",
      code: "MAIN",
      isDefault: true,
      status: EntityStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });
    await db.collection("organizations").doc(testOrgId).set({
      name: `Provisioning Test Org ${testRunId}`,
      planId: "plan_enterprise",
      status: EntityStatus.ACTIVE,
      ownerStatus: "pending",
      defaultBranchId: testBranchId,
      activeEmployeeCount: 0,
      createdAt: new Date().toISOString(),
    });

    // 1. Provision owner with temporaryPassword
    const ownerEmail = `prov_owner_${testRunId}@test.local`;
    const ownerRes = await provisionMembershipInternal({
      organizationId: testOrgId,
      roleId: OWNER_ROLE_ID,
      name: "Provisioned Owner",
      email: ownerEmail,
      credentialMode: "temporaryPassword",
      actorUid: "test_actor",
    });
    assert.ok(ownerRes.userId);
    createdUids.push(ownerRes.userId);
    assert.strictEqual(ownerRes.roleId, OWNER_ROLE_ID);
    assert.strictEqual(ownerRes.userCreated, true);
    assert.ok(ownerRes.temporaryPassword);
    assert.strictEqual(ownerRes.status, "active");
    console.log("  ✓ [organizationsProvisionUser#ok] provisions owner with temporaryPassword");

    // 2. Provision employee with invite
    const empEmail = `prov_emp_${testRunId}@test.local`;
    const empRes = await provisionMembershipInternal({
      organizationId: testOrgId,
      roleId: "role_employee",
      name: "Provisioned Employee",
      email: empEmail,
      credentialMode: "invite",
      actorUid: "test_actor",
    });
    assert.ok(empRes.userId);
    createdUids.push(empRes.userId);
    assert.ok(empRes.inviteLink && empRes.inviteLink.includes(`org=${testOrgId}`));
    console.log("  ✓ [employeesCreate#ok] provisions employee with invite link");

    // 3. Reject duplicate owner provisioning
    await assert.rejects(
      async () =>
        provisionMembershipInternal({
          organizationId: testOrgId,
          roleId: OWNER_ROLE_ID,
          name: "Second Owner",
          email: `second_owner_${testRunId}@test.local`,
          actorUid: "test_actor",
        }),
      (err) => err.code === "failed-precondition" && err.details?.reason === "ORGANIZATION_ALREADY_HAS_OWNER"
    );
    console.log("  ✓ [organizationsProvisionUser#ORGANIZATION_ALREADY_HAS_OWNER] rejects duplicate owner");

    // 4. Require confirmLinkExistingUser for existing Auth user
    await db.collection("branches").doc(otherBranchId).set({
      organizationId: otherOrgId,
      name: "Main Branch",
      code: "MAIN",
      isDefault: true,
      status: EntityStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });
    await db.collection("organizations").doc(otherOrgId).set({
      name: `Other Org ${testRunId}`,
      planId: "plan_enterprise",
      status: EntityStatus.ACTIVE,
      ownerStatus: "pending",
      defaultBranchId: otherBranchId,
      createdAt: new Date().toISOString(),
    });
    const preEmail = `existing_user_${testRunId}@test.local`;
    const preUser = await auth.createUser({ email: preEmail, password: "Password123!", displayName: "Pre Existing" });
    createdUids.push(preUser.uid);

    await assert.rejects(
      async () =>
        provisionMembershipInternal({
          organizationId: otherOrgId,
          roleId: OWNER_ROLE_ID,
          name: "Pre Existing",
          email: preEmail,
          confirmLinkExistingUser: false,
          actorUid: "test_actor",
        }),
      (err) => err.code === "already-exists" && err.details?.reason === "OWNER_EMAIL_EXISTS"
    );
    const linked = await provisionMembershipInternal({
      organizationId: otherOrgId,
      roleId: OWNER_ROLE_ID,
      name: "Pre Existing",
      email: preEmail,
      confirmLinkExistingUser: true,
      actorUid: "test_actor",
    });
    assert.strictEqual(linked.userId, preUser.uid);
    assert.strictEqual(linked.userCreated, false);
    console.log("  ✓ [organizationsProvisionUser#OWNER_EMAIL_EXISTS] enforces confirmLinkExistingUser");
    assert.strictEqual(ADMIN_ROLE_ID, "role_admin");
  } finally {
    for (const orgId of [testOrgId, otherOrgId]) {
      await db.collection("organizations").doc(orgId).delete().catch(() => {});
      for (const col of ["branches", "memberships", "membershipBranches"]) {
        const snap = await db.collection(col).where("organizationId", "==", orgId).get().catch(() => null);
        if (snap) for (const d of snap.docs) await d.ref.delete().catch(() => {});
      }
    }
    for (const uid of createdUids) {
      await auth.deleteUser(uid).catch(() => {});
      await db.collection("users").doc(uid).delete().catch(() => {});
    }
  }
  console.log("✓ Membership Provisioning Emulator Suite passed (4/4 checks).\n");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
