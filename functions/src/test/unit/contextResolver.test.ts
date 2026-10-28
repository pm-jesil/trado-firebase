/**
 * Unit Tests for Request Context Resolution Rules
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Pure evaluation of Organization Context resolution rules.
 */
function evaluateOrganizationContext(params: {
  isSuperAdmin: boolean;
  clientOrgId?: string;
  tokenOrgId?: string;
  userActiveOrgIds: string[];
}): { targetOrgId: string; error?: string } {
  const { isSuperAdmin, clientOrgId, tokenOrgId, userActiveOrgIds } = params;

  if (isSuperAdmin) {
    if (clientOrgId) return { targetOrgId: clientOrgId };
    if (tokenOrgId) return { targetOrgId: tokenOrgId };
    return { targetOrgId: "platform" };
  }

  // Non-superadmin cannot provide an orgId that conflicts with token claims
  if (clientOrgId && tokenOrgId && clientOrgId !== tokenOrgId) {
    return {
      targetOrgId: "",
      error: "Client-supplied organizationId does not match caller's active organization context.",
    };
  }

  const resolved = tokenOrgId || clientOrgId;
  if (resolved) {
    if (!userActiveOrgIds.includes(resolved)) {
      return { targetOrgId: "", error: "Caller is not a member of this organization." };
    }
    return { targetOrgId: resolved };
  }

  if (userActiveOrgIds.length > 0) {
    return { targetOrgId: userActiveOrgIds[0] };
  }

  return { targetOrgId: "", error: "No active organization membership found." };
}

/**
 * Pure evaluation of Branch Context resolution rules.
 */
function evaluateBranchContext(params: {
  clientBranchId?: string;
  tokenBranchId?: string;
  defaultBranchId?: string;
}): string {
  const { clientBranchId, tokenBranchId, defaultBranchId } = params;
  if (clientBranchId) return clientBranchId;
  if (tokenBranchId) return tokenBranchId;
  return defaultBranchId || "main-branch";
}

describe("Request Context Resolver Logic", () => {
  describe("Organization Context Resolution", () => {
    it("derives targetOrgId from token claims when client does not supply it", () => {
      const res = evaluateOrganizationContext({
        isSuperAdmin: false,
        tokenOrgId: "org_123",
        userActiveOrgIds: ["org_123"],
      });
      assert.equal(res.targetOrgId, "org_123");
      assert.equal(res.error, undefined);
    });

    it("accepts matching client-supplied organizationId and token claim", () => {
      const res = evaluateOrganizationContext({
        isSuperAdmin: false,
        clientOrgId: "org_123",
        tokenOrgId: "org_123",
        userActiveOrgIds: ["org_123"],
      });
      assert.equal(res.targetOrgId, "org_123");
      assert.equal(res.error, undefined);
    });

    it("rejects conflicting client-supplied organizationId for standard users", () => {
      const res = evaluateOrganizationContext({
        isSuperAdmin: false,
        clientOrgId: "org_attacker",
        tokenOrgId: "org_123",
        userActiveOrgIds: ["org_123"],
      });
      assert.equal(res.targetOrgId, "");
      assert.match(res.error || "", /does not match/);
    });

    it("allows Super Admin to specify any target organizationId", () => {
      const res = evaluateOrganizationContext({
        isSuperAdmin: true,
        clientOrgId: "org_target",
        tokenOrgId: "org_admin_home",
        userActiveOrgIds: [],
      });
      assert.equal(res.targetOrgId, "org_target");
      assert.equal(res.error, undefined);
    });
  });

  describe("Branch Context Resolution", () => {
    it("defaults to main-branch when neither client nor token specifies a branch", () => {
      const branchId = evaluateBranchContext({
        defaultBranchId: "main-branch",
      });
      assert.equal(branchId, "main-branch");
    });

    it("uses token primaryBranchId when client omits branchId", () => {
      const branchId = evaluateBranchContext({
        tokenBranchId: "branch_north",
        defaultBranchId: "main-branch",
      });
      assert.equal(branchId, "branch_north");
    });

    it("allows explicit clientBranchId to select operating branch", () => {
      const branchId = evaluateBranchContext({
        clientBranchId: "branch_south",
        tokenBranchId: "branch_north",
        defaultBranchId: "main-branch",
      });
      assert.equal(branchId, "branch_south");
    });
  });
});

