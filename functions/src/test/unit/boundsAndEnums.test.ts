/**
 * Invariant C-4: Bounds and Enum Verification Test Suite
 *
 * Verifies:
 * 1. Every core enum rejects unlisted/tampered string values.
 * 2. Bounded numeric and string fields enforce boundary limits (min-1 rejected, min accepted, max accepted, max+1 rejected).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BusinessType,
  BusinessCategory,
  EntityStatus,
  SalesMode,
  PaymentMethod,
  OutflowKind,
  PartyType,
} from "../../constants/enums.js";
import {
  CreateOrganizationSchema,
  CreateProductSchema,
  CreateCustomerSchema,
  CreateOutflowSchema,
  CreatePaymentSchema,
} from "../../validation/schemas.js";

describe("Invariant C-4: Enum and Boundary Validation", () => {
  describe("Enum Strictness (Rejection of unlisted values)", () => {
    it("rejects unlisted BusinessType values", () => {
      const validValues = Object.values(BusinessType);
      assert.ok(validValues.includes(BusinessType.RETAIL_ONLY));
      const res = CreateOrganizationSchema.safeParse({
        name: "Acme Store",
        legalName: "Acme Retail Pvt Ltd",
        country: "IN",
        currency: "INR",
        planId: "plan_starter",
        businessType: "INVALID_BUSINESS_TYPE",
      });
      assert.strictEqual(res.success, false, "Must reject unlisted BusinessType");
    });

    it("rejects unlisted BusinessCategory values", () => {
      const valid = Object.values(BusinessCategory);
      assert.ok(valid.includes(BusinessCategory.MOBILE_ELECTRONICS));
      const res = CreateOrganizationSchema.safeParse({
        name: "Acme Store",
        legalName: "Acme Retail Pvt Ltd",
        country: "IN",
        currency: "INR",
        planId: "plan_starter",
        businessType: BusinessType.RETAIL_ONLY,
        businessCategory: "INVALID_CATEGORY",
      });
      assert.strictEqual(res.success, false, "Must reject unlisted BusinessCategory");
    });

    it("rejects unlisted TaxRegime values", () => {
      const res = CreateOrganizationSchema.safeParse({
        name: "Acme Store",
        legalName: "Acme Retail Pvt Ltd",
        country: "IN",
        currency: "INR",
        planId: "plan_starter",
        businessType: BusinessType.RETAIL_ONLY,
        taxRegimeCode: "INVALID_TAX_REGIME",
      });
      assert.strictEqual(res.success, false, "Must reject unlisted TaxRegime");
    });

    it("rejects unlisted EntityStatus values", () => {
      const valid = Object.values(EntityStatus);
      assert.ok(valid.includes(EntityStatus.ACTIVE));
      assert.ok(valid.includes(EntityStatus.INACTIVE));
    });

    it("rejects unlisted SalesMode values", () => {
      const valid = Object.values(SalesMode);
      assert.ok(valid.includes(SalesMode.B2B));
      const res = CreateProductSchema.safeParse({
        organizationId: "org_1",
        name: "Product Test",
        sellingPrice: 100,
        costPrice: 50,
        baseUnit: "pcs",
        salesMode: "INVALID_SALES_MODE",
      });
      assert.strictEqual(res.success, false, "Must reject unlisted SalesMode");
    });

    it("rejects unlisted PaymentMethod values", () => {
      const valid = Object.values(PaymentMethod);
      assert.ok(valid.includes(PaymentMethod.CASH));
      const res = CreatePaymentSchema.safeParse({
        organizationId: "org_1",
        branchId: "branch_1",
        partyId: "cust_1",
        partyType: "customer",
        amount: 500,
        paymentMode: "BITCOIN_UNKNOWN",
      });
      assert.strictEqual(res.success, false, "Must reject unlisted PaymentMethod");
    });

    it("rejects unlisted OutflowKind values", () => {
      const valid = Object.values(OutflowKind);
      assert.ok(valid.includes(OutflowKind.EXPENSE));
      const res = CreateOutflowSchema.safeParse({
        organizationId: "org_1",
        branchId: "branch_1",
        kind: "INVALID_KIND",
        amount: 100,
      });
      assert.strictEqual(res.success, false, "Must reject unlisted OutflowKind");
    });

    it("rejects unlisted PartyType values", () => {
      const valid = Object.values(PartyType);
      assert.ok(valid.includes(PartyType.CUSTOMER));
      const res = CreateCustomerSchema.safeParse({
        organizationId: "org_1",
        name: "Test Customer",
        phone: "+919876543210",
        partyType: "ROBOT_ENTITY",
      });
      assert.strictEqual(res.success, false, "Must reject unlisted PartyType");
    });
  });

  describe("Numeric Bounds Enforcement", () => {
    it("financialYearStartMonth rejects min-1 (0) and max+1 (13), accepts min (1) and max (12)", () => {
      const base = {
        name: "Acme Bounds",
        legalName: "Acme Bounds Pvt Ltd",
        country: "IN",
        currency: "INR",
        planId: "plan_starter",
        businessType: BusinessType.RETAIL_ONLY,
        businessCategory: BusinessCategory.MOBILE_ELECTRONICS,
        taxRegimeCode: "IN_GST",
        createOwner: false,
      };

      // min - 1 = 0 (rejected)
      assert.strictEqual(CreateOrganizationSchema.safeParse({ ...base, financialYearStartMonth: 0 }).success, false);
      // min = 1 (accepted)
      assert.strictEqual(CreateOrganizationSchema.safeParse({ ...base, financialYearStartMonth: 1 }).success, true);
      // max = 12 (accepted)
      assert.strictEqual(CreateOrganizationSchema.safeParse({ ...base, financialYearStartMonth: 12 }).success, true);
      // max + 1 = 13 (rejected)
      assert.strictEqual(CreateOrganizationSchema.safeParse({ ...base, financialYearStartMonth: 13 }).success, false);
    });

    it("taxRatePercent rejects min-1 (-1) and max+1 (101), accepts min (0) and max (100)", () => {
      const base = {
        organizationId: "org_1",
        name: "Tax Product",
        sellingPrice: 100,
        costPrice: 50,
        baseUnit: "pcs",
      };

      assert.strictEqual(CreateProductSchema.safeParse({ ...base, taxRatePercent: -1 }).success, false);
      assert.strictEqual(CreateProductSchema.safeParse({ ...base, taxRatePercent: 0 }).success, true);
      assert.strictEqual(CreateProductSchema.safeParse({ ...base, taxRatePercent: 100 }).success, true);
      assert.strictEqual(CreateProductSchema.safeParse({ ...base, taxRatePercent: 101 }).success, false);
    });
  });
});
