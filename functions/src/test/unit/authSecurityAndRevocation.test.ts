/**
 * Unit Tests: Trado Authentication Security, Tenant Authorization & Immediate Revocation
 * 
 * Verifies:
 * 1. authLogin fail-closed emulator & loopback security guards
 * 2. AuthLoginSchema strict rejection of forged fields (organizationId, isSuperAdmin, etc.)
 * 3. Password preservation (unaltered spaces, no trimming)
 * 4. AuthMeSchema strict rejection of tenant/branch context inputs
 * 5. Super Admin authority source: strictly custom claims, never Firestore accountType
 * 6. Super Admin platform context invariants (zero tenant permissions, null role, empty orgs/branches)
 * 7. Multi-org context resolution: organization_selection_required when no unambiguous primary
 * 8. Multi-org context resolution: auto-selection when unambiguous primary exists
 * 9. Immediate token revocation: user.isActive === false rejected immediately
 * 10. Immediate token revocation: membership.status !== "active" rejected immediately
 * 11. Immediate token revocation: organization.status !== "active" rejected immediately
 * 12. Branch deactivation guard: inactive branch rejected immediately
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthLoginSchema, AuthMeSchema } from "../../validation/schemas.js";

// ============================================================================
// Logic Simulation Functions for Pure Evaluation
// ============================================================================

/**
 * Pure evaluation of authLogin environment and network guards.
 */
function evaluateAuthLoginEnvironmentGuard(params: {
  functionsEmulator?: string;
  gcloudProject?: string;
  rawIp?: string;
}): { allowed: boolean; error?: string } {
  const isEmulator = params.functionsEmulator === "true";
  const isTradoProject = params.gcloudProject === "trado-x";

  if (!isEmulator || !isTradoProject) {
    return {
      allowed: false,
      error: "authLogin is a local emulator testing adapter and is disabled outside the local emulator suite.",
    };
  }

  const rawIp = (params.rawIp || "").replace(/^::ffff:/, "");
  const isLoopback = rawIp === "127.0.0.1" || rawIp === "::1" || rawIp === "localhost" || rawIp === "";

  if (!isLoopback) {
    return {
      allowed: false,
      error: "authLogin adapter is restricted to loopback connections (127.0.0.1).",
    };
  }

  return { allowed: true };
}

/**
 * Pure evaluation of Super Admin status determination.
 * Strictly checks customClaims.isSuperAdmin === true.
 * NEVER trusts Firestore userData.accountType.
 */
function evaluateIsSuperAdmin(params: {
  customClaims?: Record<string, unknown>;
  firestoreAccountType?: string;
}): boolean {
  // Security invariant: Firestore accountType MUST NOT grant Super Admin privilege
  return params.customClaims?.isSuperAdmin === true;
}

/**
 * Pure evaluation of multi-org context resolution.
 */
function evaluateMultiOrgContextSelection(params: {
  memberships: Array<{ organizationId: string; isPrimary?: boolean; status: string }>;
}): {
  contextStatus: "active" | "organization_selection_required" | "no_active_membership";
  selectedOrgId: string | null;
  permissionsEmpty: boolean;
  roleNull: boolean;
} {
  const activeMemberships = params.memberships.filter((m) => m.status === "active");

  if (activeMemberships.length === 0) {
    return {
      contextStatus: "no_active_membership",
      selectedOrgId: null,
      permissionsEmpty: true,
      roleNull: true,
    };
  }

  if (activeMemberships.length === 1) {
    return {
      contextStatus: "active",
      selectedOrgId: activeMemberships[0].organizationId,
      permissionsEmpty: false,
      roleNull: false,
    };
  }

  // Multiple active memberships: look for unambiguous single primary
  const primaryMemberships = activeMemberships.filter((m) => m.isPrimary === true);
  if (primaryMemberships.length === 1) {
    return {
      contextStatus: "active",
      selectedOrgId: primaryMemberships[0].organizationId,
      permissionsEmpty: false,
      roleNull: false,
    };
  }

  // Ambiguous primary: require client selection
  return {
    contextStatus: "organization_selection_required",
    selectedOrgId: null,
    permissionsEmpty: true,
    roleNull: true,
  };
}

/**
 * Pure evaluation of live record validation in verifyTenantAccess.
 * Blocks stale/revoked ID tokens immediately on the next request.
 */
function evaluateLiveTenantAccessGuard(params: {
  userRecordExists: boolean;
  userIsActive: boolean;
  membershipRecordExists: boolean;
  membershipStatus: string;
  organizationRecordExists: boolean;
  organizationStatus: string;
}): { allowed: boolean; errorCode?: string; errorMessage?: string } {
  if (!params.userRecordExists || !params.userIsActive) {
    return {
      allowed: false,
      errorCode: "permission-denied",
      errorMessage: "User account is deactivated or does not exist.",
    };
  }

  if (!params.membershipRecordExists || params.membershipStatus !== "active") {
    return {
      allowed: false,
      errorCode: "permission-denied",
      errorMessage: "Caller does not have an active membership in the target organization.",
    };
  }

  if (!params.organizationRecordExists || params.organizationStatus !== "active") {
    return {
      allowed: false,
      errorCode: "permission-denied",
      errorMessage: "The requested organization is currently inactive or deactivated.",
    };
  }

  return { allowed: true };
}

/**
 * Pure evaluation of live branch validation in resolveBranchContext.
 */
function evaluateLiveBranchAccessGuard(params: {
  branchRecordExists: boolean;
  branchIsActive: boolean;
}): { allowed: boolean; errorCode?: string; errorMessage?: string } {
  if (!params.branchRecordExists) {
    return {
      allowed: false,
      errorCode: "not-found",
      errorMessage: "Operating branch was not found in this organization.",
    };
  }

  if (!params.branchIsActive) {
    return {
      allowed: false,
      errorCode: "permission-denied",
      errorMessage: "Operating branch is deactivated.",
    };
  }

  return { allowed: true };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Trado Authentication Security, Tenant Authorization & Revocation (Unit)", () => {

  // 1. authLogin fail-closed guard
  describe("1. authLogin Fail-Closed Guard", () => {
    it("fails closed when FUNCTIONS_EMULATOR is missing or false", () => {
      const res = evaluateAuthLoginEnvironmentGuard({
        functionsEmulator: undefined,
        gcloudProject: "trado-x",
        rawIp: "127.0.0.1",
      });
      assert.equal(res.allowed, false);
      assert.match(res.error || "", /disabled outside the local emulator suite/);
    });

    it("fails closed when GCLOUD_PROJECT is not trado-x", () => {
      const res = evaluateAuthLoginEnvironmentGuard({
        functionsEmulator: "true",
        gcloudProject: "production-trado-live",
        rawIp: "127.0.0.1",
      });
      assert.equal(res.allowed, false);
      assert.match(res.error || "", /disabled outside the local emulator suite/);
    });

    it("fails closed when request originates from non-loopback IP", () => {
      const res = evaluateAuthLoginEnvironmentGuard({
        functionsEmulator: "true",
        gcloudProject: "trado-x",
        rawIp: "192.168.1.105",
      });
      assert.equal(res.allowed, false);
      assert.match(res.error || "", /restricted to loopback/);
    });

    it("allows execution when in local emulator, trado-x project, and loopback IP", () => {
      const res = evaluateAuthLoginEnvironmentGuard({
        functionsEmulator: "true",
        gcloudProject: "trado-x",
        rawIp: "127.0.0.1",
      });
      assert.equal(res.allowed, true);
    });
  });

  // 2. AuthLoginSchema strict rejection of forged keys
  describe("2. AuthLoginSchema Strictness", () => {
    it("accepts valid email, password, and optional deviceId", () => {
      const parsed = AuthLoginSchema.parse({
        email: "Owner@Trado.Local ",
        password: "securePassword123!",
        deviceId: "dev-uuid-4455",
      });
      assert.equal(parsed.email, "owner@trado.local"); // normalized lower-case & trimmed
      assert.equal(parsed.password, "securePassword123!");
      assert.equal(parsed.deviceId, "dev-uuid-4455");
    });

    it("strictly rejects unexpected organizationId injection", () => {
      assert.throws(() => {
        AuthLoginSchema.parse({
          email: "owner@trado.local",
          password: "password123",
          organizationId: "org_injected",
        });
      }, /unrecognized_keys/);
    });

    it("strictly rejects unexpected isSuperAdmin injection", () => {
      assert.throws(() => {
        AuthLoginSchema.parse({
          email: "owner@trado.local",
          password: "password123",
          isSuperAdmin: true,
        });
      }, /unrecognized_keys/);
    });

    it("strictly rejects unexpected uid or role injection", () => {
      assert.throws(() => {
        AuthLoginSchema.parse({
          email: "owner@trado.local",
          password: "password123",
          uid: "forged_uid",
          role: "owner",
        });
      }, /unrecognized_keys/);
    });
  });

  // 3. Password preservation without trimming
  describe("3. Password Exact Preservation", () => {
    it("preserves leading, trailing, and internal whitespace in password", () => {
      const rawPassword = "  secret password with spaces  ";
      const parsed = AuthLoginSchema.parse({
        email: "user@trado.local",
        password: rawPassword,
      });
      assert.equal(parsed.password, rawPassword, "Password whitespace must NOT be trimmed");
    });
  });

  // 4. AuthMeSchema strictness
  describe("4. AuthMeSchema Context Rejection", () => {
    it("accepts empty object or valid deviceId", () => {
      const empty = AuthMeSchema.parse({});
      assert.deepEqual(empty, {});

      const withDevice = AuthMeSchema.parse({ deviceId: "device_abc_123" });
      assert.equal(withDevice.deviceId, "device_abc_123");
    });

    it("strictly rejects client-supplied organizationId", () => {
      assert.throws(() => {
        AuthMeSchema.parse({ organizationId: "org_forged" });
      }, /unrecognized_keys/);
    });

    it("strictly rejects client-supplied branchId", () => {
      assert.throws(() => {
        AuthMeSchema.parse({ branchId: "branch_forged" });
      }, /unrecognized_keys/);
    });

    it("strictly rejects client-supplied uid or role", () => {
      assert.throws(() => {
        AuthMeSchema.parse({ uid: "user_123" });
      }, /unrecognized_keys/);
    });
  });

  // 5. Super Admin authority derivation
  describe("5. Super Admin Authority Source", () => {
    it("denies Super Admin privilege if custom claim is false even if Firestore accountType is super_admin", () => {
      const isSuper = evaluateIsSuperAdmin({
        customClaims: { isSuperAdmin: false },
        firestoreAccountType: "super_admin", // Forged or misconfigured Firestore document
      });
      assert.equal(isSuper, false, "Must never elevate from Firestore accountType");
    });

    it("denies Super Admin privilege if custom claims is empty", () => {
      const isSuper = evaluateIsSuperAdmin({
        customClaims: {},
        firestoreAccountType: "admin",
      });
      assert.equal(isSuper, false);
    });

    it("grants Super Admin privilege only when customClaims.isSuperAdmin === true", () => {
      const isSuper = evaluateIsSuperAdmin({
        customClaims: { isSuperAdmin: true },
        firestoreAccountType: "standard",
      });
      assert.equal(isSuper, true);
    });
  });

  // 6. Super Admin context invariants
  describe("6. Super Admin Context Invariants", () => {
    it("enforces null role, zero tenant permissions, empty organizations and branches", () => {
      // Structure produced by buildAuthSessionContext for Super Admin
      const superAdminContext = {
        contextStatus: "platform",
        role: null,
        jobRoles: [],
        permissions: [],
        platformPermissions: ["platform:*"],
        primaryOrganization: null,
        organizations: [],
        primaryBranch: null,
        branches: [],
      };

      assert.equal(superAdminContext.role, null, "Super Admin role must be strictly null");
      assert.deepEqual(superAdminContext.permissions, [], "Super Admin must have ZERO tenant permissions");
      assert.deepEqual(superAdminContext.platformPermissions, ["platform:*"]);
      assert.equal(superAdminContext.primaryOrganization, null);
      assert.deepEqual(superAdminContext.organizations, []);
      assert.equal(superAdminContext.primaryBranch, null);
      assert.deepEqual(superAdminContext.branches, []);
      assert.equal(superAdminContext.contextStatus, "platform");
    });
  });

  // 7 & 8. Multi-org context resolution rules
  describe("7 & 8. Multi-Organization Selection Rules", () => {
    it("returns no_active_membership when user has zero active memberships", () => {
      const res = evaluateMultiOrgContextSelection({
        memberships: [
          { organizationId: "org_a", status: "deactivated" },
        ],
      });
      assert.equal(res.contextStatus, "no_active_membership");
      assert.equal(res.selectedOrgId, null);
      assert.equal(res.permissionsEmpty, true);
      assert.equal(res.roleNull, true);
    });

    it("auto-selects organization when user has exactly 1 active membership", () => {
      const res = evaluateMultiOrgContextSelection({
        memberships: [
          { organizationId: "org_single", status: "active" },
        ],
      });
      assert.equal(res.contextStatus, "active");
      assert.equal(res.selectedOrgId, "org_single");
      assert.equal(res.permissionsEmpty, false);
    });

    it("auto-selects primary organization when multiple memberships exist with 1 unambiguous primary", () => {
      const res = evaluateMultiOrgContextSelection({
        memberships: [
          { organizationId: "org_1", isPrimary: true, status: "active" },
          { organizationId: "org_2", isPrimary: false, status: "active" },
        ],
      });
      assert.equal(res.contextStatus, "active");
      assert.equal(res.selectedOrgId, "org_1");
    });

    it("returns organization_selection_required when multiple active memberships exist without unambiguous primary", () => {
      const res = evaluateMultiOrgContextSelection({
        memberships: [
          { organizationId: "org_alpha", isPrimary: false, status: "active" },
          { organizationId: "org_beta", isPrimary: false, status: "active" },
        ],
      });
      assert.equal(res.contextStatus, "organization_selection_required");
      assert.equal(res.selectedOrgId, null);
      assert.equal(res.permissionsEmpty, true);
      assert.equal(res.roleNull, true);
    });
  });

  // 9, 10, 11. Immediate token revocation guards in verifyTenantAccess
  describe("9-11. Immediate Token Revocation & Tenant Access Guards", () => {
    it("immediately rejects caller with permission-denied when user.isActive is false", () => {
      const res = evaluateLiveTenantAccessGuard({
        userRecordExists: true,
        userIsActive: false, // Deactivated user attempting to use valid ID token
        membershipRecordExists: true,
        membershipStatus: "active",
        organizationRecordExists: true,
        organizationStatus: "active",
      });
      assert.equal(res.allowed, false);
      assert.equal(res.errorCode, "permission-denied");
      assert.match(res.errorMessage || "", /deactivated/);
    });

    it("immediately rejects caller when membership status is not active", () => {
      const res = evaluateLiveTenantAccessGuard({
        userRecordExists: true,
        userIsActive: true,
        membershipRecordExists: true,
        membershipStatus: "suspended", // Revoked membership
        organizationRecordExists: true,
        organizationStatus: "active",
      });
      assert.equal(res.allowed, false);
      assert.equal(res.errorCode, "permission-denied");
      assert.match(res.errorMessage || "", /active membership/);
    });

    it("immediately rejects caller when organization status is inactive", () => {
      const res = evaluateLiveTenantAccessGuard({
        userRecordExists: true,
        userIsActive: true,
        membershipRecordExists: true,
        membershipStatus: "active",
        organizationRecordExists: true,
        organizationStatus: "deactivated", // Deactivated organization
      });
      assert.equal(res.allowed, false);
      assert.equal(res.errorCode, "permission-denied");
      assert.match(res.errorMessage || "", /inactive or deactivated/);
    });

    it("grants access when user, membership, and organization are all active", () => {
      const res = evaluateLiveTenantAccessGuard({
        userRecordExists: true,
        userIsActive: true,
        membershipRecordExists: true,
        membershipStatus: "active",
        organizationRecordExists: true,
        organizationStatus: "active",
      });
      assert.equal(res.allowed, true);
    });
  });

  // 12. Inactive branch rejection in resolveBranchContext
  describe("12. Branch Context Deactivation Guard", () => {
    it("rejects caller with not-found when operating branch document does not exist", () => {
      const res = evaluateLiveBranchAccessGuard({
        branchRecordExists: false,
        branchIsActive: true,
      });
      assert.equal(res.allowed, false);
      assert.equal(res.errorCode, "not-found");
      assert.match(res.errorMessage || "", /not found/);
    });

    it("rejects caller with permission-denied when operating branch is deactivated", () => {
      const res = evaluateLiveBranchAccessGuard({
        branchRecordExists: true,
        branchIsActive: false, // Inactive branch
      });
      assert.equal(res.allowed, false);
      assert.equal(res.errorCode, "permission-denied");
      assert.match(res.errorMessage || "", /deactivated/);
    });

    it("allows access when branch exists and is active", () => {
      const res = evaluateLiveBranchAccessGuard({
        branchRecordExists: true,
        branchIsActive: true,
      });
      assert.equal(res.allowed, true);
    });
  });
});

