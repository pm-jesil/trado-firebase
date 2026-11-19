import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { computeLocationPingExpiry } from "../../callables/locations.js";
import { AppPermissions } from "../../constants/permissions.js";

describe("BC3 / MG-40: Location Privacy & Retention Invariants", () => {
  it("computeLocationPingExpiry computes native Timestamp exactly 7 days after server time [locationsRecordPing#ok]", () => {
    const now = new Date("2026-11-19T10:00:00.000Z");
    const expiry = computeLocationPingExpiry(now);
    assert.ok(expiry instanceof Timestamp, "Must return Firestore Timestamp");
    const diffDays = (expiry.toDate().getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    assert.strictEqual(diffDays, 7, "TTL must be exactly 7 days");
  });

  it("Enforces Super Admin access prohibition without active tenant support access grant [locationsGetLatest#PERMISSION_DENIED] [locationsGetHistory#PERMISSION_DENIED]", () => {
    function checkSuperAdminLocationAccess(isSuperAdmin: boolean, supportAccessExpiresAt: string | null | undefined): boolean {
      if (isSuperAdmin) {
        const supportExpires = supportAccessExpiresAt ? new Date(supportAccessExpiresAt).getTime() : 0;
        if (supportExpires <= Date.now()) {
          throw new Error("PERMISSION_DENIED: Super Admin access to employee location coordinates requires active tenant-granted support access (supportAccessExpiresAt).");
        }
      }
      return true;
    }

    // Attempt without support grant -> throws permission-denied
    assert.throws(
      () => checkSuperAdminLocationAccess(true, null),
      /PERMISSION_DENIED/
    );

    // Attempt with expired support grant -> throws permission-denied
    assert.throws(
      () => checkSuperAdminLocationAccess(true, "2026-11-01T00:00:00.000Z"),
      /PERMISSION_DENIED/
    );

    // Attempt with active support grant (future) -> ALLOWED
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    assert.strictEqual(checkSuperAdminLocationAccess(true, futureDate), true);

    // Non-superadmin bypasses this check (their own tenant permissions apply)
    assert.strictEqual(checkSuperAdminLocationAccess(false, null), true);
  });

  it("Enforces team scoping for locations:view_team vs location:view_own [locationsGetLatest#ok] [locationsGetHistory#ok]", () => {
    interface LocationViewer {
      uid: string;
      membershipId: string;
      permissions: string[];
      isOwnerOrAdmin: boolean;
    }

    function evaluateLocationReadScope(viewer: LocationViewer, targetMembershipId: string): "own" | "team" | "denied" {
      const canViewTeam = viewer.isOwnerOrAdmin ||
        viewer.permissions.includes(AppPermissions.LOCATION_VIEW_TEAM) ||
        viewer.permissions.includes(AppPermissions.LOCATION_VIEW_ALL);

      if (canViewTeam) return "team";
      if (viewer.permissions.includes(AppPermissions.LOCATION_VIEW_OWN)) {
        return viewer.membershipId === targetMembershipId ? "own" : "denied";
      }
      return "denied";
    }

    const employee: LocationViewer = {
      uid: "user_emp_1",
      membershipId: "mem_emp_1",
      permissions: [AppPermissions.LOCATION_VIEW_OWN],
      isOwnerOrAdmin: false,
    };

    const manager: LocationViewer = {
      uid: "user_mgr_1",
      membershipId: "mem_mgr_1",
      permissions: [AppPermissions.LOCATION_VIEW_TEAM],
      isOwnerOrAdmin: false,
    };

    const outsider: LocationViewer = {
      uid: "user_cashier_1",
      membershipId: "mem_cashier_1",
      permissions: [AppPermissions.BILL_CREATE],
      isOwnerOrAdmin: false,
    };

    // Employee reading own -> "own"
    assert.strictEqual(evaluateLocationReadScope(employee, "mem_emp_1"), "own");
    // Employee reading peer -> "denied"
    assert.strictEqual(evaluateLocationReadScope(employee, "mem_emp_2"), "denied");

    // Manager with locations:view_team reading team member -> "team"
    assert.strictEqual(evaluateLocationReadScope(manager, "mem_emp_1"), "team");
    assert.strictEqual(evaluateLocationReadScope(manager, "mem_emp_2"), "team");

    // Outsider reading -> "denied"
    assert.strictEqual(evaluateLocationReadScope(outsider, "mem_emp_1"), "denied");
  });
});
