import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  CreateVendorSchema,
  UpdateVendorSchema,
  CreateProductSchema,
  CreateBranchSchema,
  UpdateBranchSchema,
} from "../../validation/schemas.js";

describe("Branch Validation & Sharing Policies (Unit)", () => {
  describe("Customer Schema Branch Visibility", () => {
    it("accepts valid visibilityScope 'all_branches' without explicit branch list", () => {
      const result = CreateCustomerSchema.safeParse({
        organizationId: "org-123",
        name: "Acme Corp",
        phone: "9876543210",
        visibilityScope: "all_branches",
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.visibilityScope, "all_branches");
      }
    });

    it("accepts 'selected_branches' with target branch array", () => {
      const result = CreateCustomerSchema.safeParse({
        organizationId: "org-123",
        name: "Regional Store",
        phone: "9876543210",
        visibilityScope: "selected_branches",
        sharedForBranchIds: ["main-branch", "branch-south"],
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.visibilityScope, "selected_branches");
        assert.deepStrictEqual(result.data.sharedForBranchIds, ["main-branch", "branch-south"]);
      }
    });

    it("accepts 'branch_only' with single originating branch", () => {
      const result = CreateCustomerSchema.safeParse({
        organizationId: "org-123",
        name: "Local Client",
        phone: "9876543210",
        visibilityScope: "branch_only",
        sharedForBranchIds: ["branch-south"],
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.visibilityScope, "branch_only");
      }
    });

    it("rejects invalid visibilityScope string", () => {
      const result = CreateCustomerSchema.safeParse({
        organizationId: "org-123",
        name: "Invalid Customer",
        phone: "9876543210",
        visibilityScope: "invalid_scope" as any,
      });
      assert.strictEqual(result.success, false);
    });

    it("allows updating customer visibilityScope and sharedForBranchIds", () => {
      const result = UpdateCustomerSchema.safeParse({
        organizationId: "org-123",
        customerId: "cust-1",
        visibilityScope: "selected_branches",
        sharedForBranchIds: ["branch-north"],
      });
      assert.strictEqual(result.success, true);
    });
  });

  describe("Vendor Schema Branch Visibility", () => {
    it("accepts valid vendor with branchId and visibilityScope", () => {
      const result = CreateVendorSchema.safeParse({
        organizationId: "org-123",
        branchId: "branch-north",
        name: "National Distributor",
        phone: "9876543210",
        visibilityScope: "all_branches",
      });
      assert.strictEqual(result.success, true);
    });

    it("allows updating vendor branch sharing configuration", () => {
      const result = UpdateVendorSchema.safeParse({
        organizationId: "org-123",
        vendorId: "vend-1",
        visibilityScope: "branch_only",
        sharedForBranchIds: ["main-branch"],
      });
      assert.strictEqual(result.success, true);
    });
  });

  describe("Product Schema Branch Attribution", () => {
    it("accepts optional branchId for initial stock intake", () => {
      const result = CreateProductSchema.safeParse({
        organizationId: "org-123",
        branchId: "branch-warehouse-1",
        name: "Steel Rods",
        baseUnit: "kg",
        costPrice: 50,
        sellingPrice: 80,
        initialStock: 100,
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.branchId, "branch-warehouse-1");
      }
    });
  });

  describe("Branch Entity Schemas", () => {
    it("validates CreateBranchSchema requirements", () => {
      const result = CreateBranchSchema.safeParse({
        organizationId: "org-123",
        name: "Downtown Outlet",
        code: "DT-01",
        address: {
          line1: "123 Market St",
          city: "Kochi",
          state: "Kerala",
          postalCode: "682001",
          country: "IN",
        },
      });
      assert.strictEqual(result.success, true);
    });

    it("validates UpdateBranchSchema updates", () => {
      const result = UpdateBranchSchema.safeParse({
        branchId: "branch-1",
        name: "Updated Branch Name",
      });
      assert.strictEqual(result.success, true);
    });

    it("rejects branch code with invalid characters (spaces, special punctuation)", () => {
      const result = CreateBranchSchema.safeParse({
        organizationId: "org-123",
        name: "Bad Code Branch",
        code: "DT 01!",
      });
      assert.strictEqual(result.success, false);
    });
  });

  describe("In-Memory Party Visibility Filtering Logic", () => {
    interface PartyItem {
      id: string;
      visibilityScope?: "all_branches" | "selected_branches" | "branch_only";
      sharedForBranchIds?: string[];
    }

    function isPartyVisibleToBranch(party: PartyItem, callerBranchId: string): boolean {
      const scope = party.visibilityScope || "all_branches";
      if (scope === "all_branches") return true;
      const shared = party.sharedForBranchIds || [];
      return shared.includes(callerBranchId);
    }

    const testParties: PartyItem[] = [
      { id: "p1", visibilityScope: "all_branches" },
      { id: "p2", visibilityScope: "selected_branches", sharedForBranchIds: ["main-branch", "branch-south"] },
      { id: "p3", visibilityScope: "branch_only", sharedForBranchIds: ["branch-south"] },
      { id: "p4" }, // default undefined should be all_branches
    ];

    it("caller at main-branch sees all_branches, default, and explicitly shared records", () => {
      const visible = testParties.filter((p) => isPartyVisibleToBranch(p, "main-branch"));
      const visibleIds = visible.map((p) => p.id);
      assert.deepStrictEqual(visibleIds, ["p1", "p2", "p4"]);
    });

    it("caller at branch-south sees all_branches, selected, and branch_only records", () => {
      const visible = testParties.filter((p) => isPartyVisibleToBranch(p, "branch-south"));
      const visibleIds = visible.map((p) => p.id);
      assert.deepStrictEqual(visibleIds, ["p1", "p2", "p3", "p4"]);
    });

    it("caller at branch-north (unshared) only sees all_branches and default records", () => {
      const visible = testParties.filter((p) => isPartyVisibleToBranch(p, "branch-north"));
      const visibleIds = visible.map((p) => p.id);
      assert.deepStrictEqual(visibleIds, ["p1", "p4"]);
    });
  });
});
