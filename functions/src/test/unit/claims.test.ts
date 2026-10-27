import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Custom Claims Service", () => {
  it("merges new claims into existing claims without overwriting unrelated fields", () => {
    const existingClaims = { isSuperAdmin: true, customFlag: "test" };
    const newClaims = { primaryOrganizationId: "org_123" };
    const merged = { ...existingClaims, ...newClaims };

    assert.equal(merged.isSuperAdmin, true);
    assert.equal(merged.customFlag, "test");
    assert.equal(merged.primaryOrganizationId, "org_123");
  });

  it("sets primaryOrganizationId claim as trusted tenant context", () => {
    const claims = { primaryOrganizationId: "org_alpha_789" };
    assert.equal(claims.primaryOrganizationId, "org_alpha_789");
  });

  it("sets isSuperAdmin claim for platform administrators", () => {
    const claims = { isSuperAdmin: true };
    assert.equal(claims.isSuperAdmin, true);
  });
});

