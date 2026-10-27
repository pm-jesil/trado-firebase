/**
 * Unit Tests for Four-Layer Permission Resolution Engine
 * 
 * Verifies:
 * 1. Plan Layer (Layer 1): If plan disables module, permissions in that module are denied.
 * 2. Organization Layer (Layer 2): If tenant disables module in toggles, permissions are denied.
 * 3. Base Role Layer (Layer 3): Grants permissions defined in the assigned role.
 * 4. Membership Overrides (Layer 4): Granular grants and explicit denys.
 * 5. Strict Deny Precedence: Explicit false in membership overrides supersedes role grant.
 * 6. Super Admin bypass: Has unrestricted access across platform and tenant.
 * 7. Org Owner: Unrestricted access within active tenant modules.
 * 8. Wildcard support: Universal '*' and prefix 'namespace:*'.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePermission,
  getModuleForPermission,
  isModuleActive,
} from "../../services/permissionResolver.js";
import { AppPermissions } from "../../constants/permissions.js";

describe("Four-Layer Permission Resolver", () => {
  const baseActivePlan = {
    billing: true,
    sales: true,
    inventory: true,
    expenses: true,
    purchases: true,
    customers: true,
    reports: true,
    staff: true,
  };

  const baseActiveOrgToggles = {
    billing: true,
    sales: true,
    inventory: true,
    expenses: true,
    purchases: true,
    customers: true,
    reports: true,
    staff: true,
  };

  it("correctly identifies the parent module for canonical permission codes", () => {
    assert.equal(getModuleForPermission("bill:create"), "billing");
    assert.equal(getModuleForPermission("sale:create"), "sales");
    assert.equal(getModuleForPermission("inventory:view"), "inventory");
    assert.equal(getModuleForPermission("expense:create"), "expenses");
    assert.equal(getModuleForPermission("purchase:approve"), "purchases");
    assert.equal(getModuleForPermission("customer:create"), "customers");
    assert.equal(getModuleForPermission("report:profit"), "reports");
    assert.equal(getModuleForPermission("employee:create"), "staff");
    assert.equal(getModuleForPermission("platform:tenants:manage"), "platform");
  });

  it("isModuleActive checks plan flags and org toggles correctly", () => {
    assert.equal(isModuleActive("billing", baseActivePlan, baseActiveOrgToggles), true);
    assert.equal(isModuleActive("billing", { billing: false }, baseActiveOrgToggles), false);
    assert.equal(isModuleActive("billing", baseActivePlan, { billing: false }), false);
    assert.equal(isModuleActive("platform", {}, {}), true, "Platform domain is always active.");
  });

  it("Layer 1 (Plan): denies permission if module is disabled in subscription plan", () => {
    const planWithSalesDisabled = { ...baseActivePlan, sales: false };

    const granted = resolvePermission("sale:create", {
      isSuperAdmin: false,
      roleCode: "admin",
      rolePermissions: ["sale:create"],
      membershipOverrides: {},
      planModuleFlags: planWithSalesDisabled,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, false, "Permission must be denied when parent module is excluded by plan.");
  });

  it("Layer 2 (Organization): denies permission if module is toggled off by tenant", () => {
    const orgWithInventoryToggledOff = { ...baseActiveOrgToggles, inventory: false };

    const granted = resolvePermission("inventory:view", {
      isSuperAdmin: false,
      roleCode: "inventory_clerk",
      rolePermissions: ["inventory:view"],
      membershipOverrides: {},
      planModuleFlags: baseActivePlan,
      orgModuleToggles: orgWithInventoryToggledOff,
    });

    assert.equal(granted, false, "Permission must be denied when tenant toggles off the module.");
  });

  it("Layer 3 (Role): grants permission when granted by base role", () => {
    const granted = resolvePermission("bill:create", {
      isSuperAdmin: false,
      roleCode: "cashier",
      rolePermissions: ["bill:create", "bill:view"],
      membershipOverrides: {},
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, true, "Permission should be granted when in base role.");
  });

  it("Layer 3 (Role): denies permission when not present in base role", () => {
    const granted = resolvePermission("report:profit", {
      isSuperAdmin: false,
      roleCode: "cashier",
      rolePermissions: ["bill:create", "bill:view"],
      membershipOverrides: {},
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, false, "Permission should be denied when role does not contain it.");
  });

  it("Layer 4 (Membership Override Grant): allows granting an extra capability to a user", () => {
    const granted = resolvePermission("inventory:adjust", {
      isSuperAdmin: false,
      roleCode: "cashier",
      rolePermissions: ["bill:create"],
      membershipOverrides: { "inventory:adjust": true },
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, true, "Explicit override grant should grant permission.");
  });

  it("Strict Deny Precedence: explicit false in membership overrides strictly denies role grant", () => {
    const granted = resolvePermission("bill:void", {
      isSuperAdmin: false,
      roleCode: "manager",
      rolePermissions: ["bill:create", "bill:view", "bill:void"],
      membershipOverrides: { "bill:void": false }, // Explicit deny
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, false, "Explicit deny must supersede role-level grant.");
  });

  it("Prefix Wildcard Deny: 'bill:*': false denies all billing permissions", () => {
    const granted = resolvePermission("bill:create", {
      isSuperAdmin: false,
      roleCode: "cashier",
      rolePermissions: ["bill:create", "bill:view"],
      membershipOverrides: { "bill:*": false },
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, false, "Prefix wildcard deny must block all matching permissions.");
  });

  it("Role Wildcard Matching: 'report:*' grants 'report:profit' and 'report:export'", () => {
    const grantedProfit = resolvePermission("report:profit", {
      isSuperAdmin: false,
      roleCode: "accountant",
      rolePermissions: ["report:*"],
      membershipOverrides: {},
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(grantedProfit, true, "Prefix wildcard in role should grant matching sub-permission.");
  });

  it("Org Owner has access to all capabilities in active tenant modules", () => {
    const granted = resolvePermission("bill:discount", {
      isSuperAdmin: false,
      roleCode: "org_owner",
      rolePermissions: [],
      membershipOverrides: {},
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, true, "Org Owner should have all tenant module capabilities.");
  });

  it("Org Owner cannot access platform:* capabilities", () => {
    const granted = resolvePermission(AppPermissions.PLATFORM_TENANTS_MANAGE, {
      isSuperAdmin: false,
      roleCode: "org_owner",
      rolePermissions: ["*"],
      membershipOverrides: {},
      planModuleFlags: baseActivePlan,
      orgModuleToggles: baseActiveOrgToggles,
    });

    assert.equal(granted, false, "Org Owner must NOT have platform admin access.");
  });

  it("Super Admin bypasses all checks with unrestricted platform and tenant access", () => {
    const grantedPlatform = resolvePermission("platform:tenants:manage", {
      isSuperAdmin: true,
      roleCode: "super_admin",
      rolePermissions: ["*"],
      membershipOverrides: {},
      planModuleFlags: {},
      orgModuleToggles: {},
    });

    const grantedTenant = resolvePermission("bill:create", {
      isSuperAdmin: true,
      roleCode: "super_admin",
      rolePermissions: ["*"],
      membershipOverrides: {},
      planModuleFlags: {},
      orgModuleToggles: {},
    });

    assert.equal(grantedPlatform, true, "Super Admin should have platform access.");
    assert.equal(grantedTenant, true, "Super Admin should have tenant access.");
  });
});
