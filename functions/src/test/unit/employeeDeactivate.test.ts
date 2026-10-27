import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the membership deactivation multi-tenant logic from employeesDeactivate.
 */
function evaluateUserStatusOnDeactivate(
  activeMembershipsInOtherOrgsCount: number
): { shouldDeactivateUser: boolean } {
  if (activeMembershipsInOtherOrgsCount === 0) {
    return { shouldDeactivateUser: true };
  }
  return { shouldDeactivateUser: false };
}

describe("Employee Multi-Org Deactivation Logic", () => {
  it("preserves global user active status when user still belongs to other active organizations", () => {
    // User belongs to Org A and Org B. Deactivating membership in Org A leaves 1 active membership in Org B.
    const remainingActiveCount = 1;
    const result = evaluateUserStatusOnDeactivate(remainingActiveCount);

    assert.equal(result.shouldDeactivateUser, false, "Global user must remain active while active in another org");
  });

  it("deactivates global user profile when user has zero remaining active memberships", () => {
    // User belongs only to Org A. Deactivating membership in Org A leaves 0 active memberships.
    const remainingActiveCount = 0;
    const result = evaluateUserStatusOnDeactivate(remainingActiveCount);

    assert.equal(result.shouldDeactivateUser, true, "Global user must be deactivated when no active memberships remain");
  });
});

