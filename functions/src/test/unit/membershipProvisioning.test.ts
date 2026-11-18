import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
} from "../../services/membershipProvisioning.js";

/**
 * Pure Unit Tests for Membership Provisioning constants & contracts (TT-1, D-59).
 *
 * Live Firestore/Auth provisioning integration tests were moved to the emulator tier:
 *   functions/scripts/test-membership-provisioning.cjs
 * This unit file opens ZERO network sockets and performs ZERO silent skips.
 */
describe("Membership & User Provisioning Pure Unit Tests", () => {
  it("exports canonical owner and admin role IDs", () => {
    assert.strictEqual(OWNER_ROLE_ID, "role_org_owner");
    assert.strictEqual(ADMIN_ROLE_ID, "role_admin");
  });
});
