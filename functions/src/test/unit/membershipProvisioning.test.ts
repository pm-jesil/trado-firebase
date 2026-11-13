process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "trado-x";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  provisionMembershipInternal,
} from "../../services/membershipProvisioning.js";
import { db, auth } from "../../services/firebase.js";
import { EntityStatus } from "../../constants/enums.js";

describe("Membership & User Provisioning Service Unit Tests", () => {
  const testRunId = Date.now();
  let testOrgId: string;
  let testBranchId: string;
  let otherOrgId: string;
  let otherBranchId: string;
  const createdUids: string[] = [];

  before(async () => {
    testOrgId = `prov_test_org_${testRunId}`;
    testBranchId = `${testOrgId}_main-branch`;
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
  });

  it("exports canonical owner and admin role IDs", () => {
    assert.strictEqual(OWNER_ROLE_ID, "role_org_owner");
    assert.strictEqual(ADMIN_ROLE_ID, "role_admin");
  });

  it("provisions an owner with credentialMode: temporaryPassword", async () => {
    const ownerEmail = `prov_owner_${testRunId}@test.local`;
    const result = await provisionMembershipInternal({
      organizationId: testOrgId,
      roleId: OWNER_ROLE_ID,
      name: "Provisioned Owner",
      email: ownerEmail,
      credentialMode: "temporaryPassword",
      actorUid: "test_actor",
    });

    assert.ok(result.userId);
    createdUids.push(result.userId);
    assert.strictEqual(result.organizationId, testOrgId);
    assert.strictEqual(result.roleId, OWNER_ROLE_ID);
    assert.strictEqual(result.userCreated, true);
    assert.ok(result.temporaryPassword);
    assert.strictEqual(result.inviteLink, undefined);
    assert.strictEqual(result.status, "active");

    // Verify user doc
    const userDoc = (await db.collection("users").doc(result.userId).get()).data();
    assert.strictEqual(userDoc?.email, ownerEmail);
    assert.strictEqual(userDoc?.accountType, "admin");

    // Verify membership doc
    const memDoc = (await db.collection("memberships").doc(result.membershipId).get()).data();
    assert.strictEqual(memDoc?.roleId, OWNER_ROLE_ID);
    assert.strictEqual(memDoc?.isPrimary, true);
  });

  it("provisions an employee with credentialMode: invite", async () => {
    const empEmail = `prov_emp_${testRunId}@test.local`;
    const result = await provisionMembershipInternal({
      organizationId: testOrgId,
      roleId: "role_employee",
      name: "Provisioned Employee",
      email: empEmail,
      credentialMode: "invite",
      actorUid: "test_actor",
    });

    assert.ok(result.userId);
    createdUids.push(result.userId);
    assert.strictEqual(result.roleId, "role_employee");
    assert.strictEqual(result.userCreated, true);
    assert.ok(result.inviteLink);
    assert.ok(result.inviteLink.includes(`userId=${result.userId}`));
    assert.ok(result.inviteLink.includes(`org=${testOrgId}`));
  });

  it("rejects duplicate owner provisioning on an organization that already has an owner", async () => {
    const secondOwnerEmail = `second_owner_${testRunId}@test.local`;
    await assert.rejects(
      async () =>
        provisionMembershipInternal({
          organizationId: testOrgId,
          roleId: OWNER_ROLE_ID,
          name: "Second Owner",
          email: secondOwnerEmail,
          actorUid: "test_actor",
        }),
      (err: any) => err.code === "failed-precondition" && err.details?.reason === "ORGANIZATION_ALREADY_HAS_OWNER"
    );
  });

  it("requires confirmLinkExistingUser: true when provisioning an existing Auth user as Owner", async () => {
    // Create a pre-existing user in another test org
    otherOrgId = `prov_other_org_${testRunId}`;
    otherBranchId = `${otherOrgId}_main-branch`;
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

    const preExistingEmail = `existing_user_${testRunId}@test.local`;
    const preUser = await auth.createUser({
      email: preExistingEmail,
      password: "Password123!",
      displayName: "Pre Existing",
    });
    createdUids.push(preUser.uid);

    // Attempting to provision without confirmation should fail
    await assert.rejects(
      async () =>
        provisionMembershipInternal({
          organizationId: otherOrgId,
          roleId: OWNER_ROLE_ID,
          name: "Pre Existing",
          email: preExistingEmail,
          confirmLinkExistingUser: false,
          actorUid: "test_actor",
        }),
      (err: any) => err.code === "already-exists" && err.details?.reason === "OWNER_EMAIL_EXISTS"
    );

    // With confirmation, linking succeeds
    const linkResult = await provisionMembershipInternal({
      organizationId: otherOrgId,
      roleId: OWNER_ROLE_ID,
      name: "Pre Existing",
      email: preExistingEmail,
      confirmLinkExistingUser: true,
      actorUid: "test_actor",
    });

    assert.strictEqual(linkResult.userId, preUser.uid);
    assert.strictEqual(linkResult.userCreated, false);
    assert.strictEqual(linkResult.status, "active");
  });

  after(async () => {
    // Clean up test documents to keep emulator reference integrity intact
    const orgIds = [testOrgId, otherOrgId].filter(Boolean);
    for (const orgId of orgIds) {
      await db.collection("organizations").doc(orgId).delete().catch(() => {});
      const brSnap = await db.collection("branches").where("organizationId", "==", orgId).get();
      for (const d of brSnap.docs) await d.ref.delete().catch(() => {});
      const memSnap = await db.collection("memberships").where("organizationId", "==", orgId).get();
      for (const d of memSnap.docs) await d.ref.delete().catch(() => {});
      const mbSnap = await db.collection("membershipBranches").where("organizationId", "==", orgId).get();
      for (const d of mbSnap.docs) await d.ref.delete().catch(() => {});
    }
    for (const uid of createdUids) {
      await auth.deleteUser(uid).catch(() => {});
      await db.collection("users").doc(uid).delete().catch(() => {});
    }
  });
});
