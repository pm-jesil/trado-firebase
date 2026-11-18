import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UpdateOrganizationSchema } from "../../validation/schemas.js";
import { AppPermissions } from "../../constants/permissions.js";
import {
  ORGANIZATION_FIELD_CLASS,
  canEditOrganizationField,
  maskBankAccounts,
  OrgPolicyActor,
} from "../../callables/organizations.js";

const CONTEXT_ONLY_KEYS = new Set(["organizationId", "branchId"]);

function makeActor(isSuperAdmin: boolean, perms: string[]): OrgPolicyActor {
  const set = new Set(perms);
  return {
    isSuperAdmin,
    can: (p: string) => set.has("*") || set.has(p),
  };
}

describe("BX2 Organization Field Edit Policy — Permission-Driven Matrix (D-54, BS-10..BS-13, BM-4..BM-6)", () => {
  it("BM-4: fail-closed completeness — every editable field in UpdateOrganizationSchema is classified in ORGANIZATION_FIELD_CLASS", () => {
    const schemaKeys = Object.keys(UpdateOrganizationSchema.shape).filter((k) => !CONTEXT_ONLY_KEYS.has(k));
    const unclassified = schemaKeys.filter((k) => !ORGANIZATION_FIELD_CLASS[k]);
    assert.deepStrictEqual(unclassified, [], `Unclassified UpdateOrganizationSchema fields: ${unclassified.join(", ")}`);

    // Reverse check: no stale/phantom keys in policy that are absent from UpdateOrganizationSchema
    const schemaSet = new Set(schemaKeys);
    const extraInPolicy = Object.keys(ORGANIZATION_FIELD_CLASS).filter((k) => !schemaSet.has(k));
    assert.deepStrictEqual(extraInPolicy, [], `Extra keys in ORGANIZATION_FIELD_CLASS absent from schema: ${extraInPolicy.join(", ")}`);

    // Unclassified unknown field must always fail closed (false) even for Super Admin
    assert.strictEqual(canEditOrganizationField(makeActor(true, ["*"]), "__unclassifiedField__"), false);
  });

  it("BS-10 / BM-5 / BM-6 [organizationsUpdate#ok] [organizationsUpdate#FIELD_NOT_EDITABLE]: 8 actors × 21 classified fields matrix", () => {
    const actors: Array<{ name: string; actor: OrgPolicyActor; expectedAllowed: (field: string) => boolean }> = [
      {
        name: "SuperAdmin",
        actor: makeActor(true, []),
        expectedAllowed: () => true,
      },
      {
        name: "Owner (* wildcard permission)",
        actor: makeActor(false, [AppPermissions.ALL]),
        expectedAllowed: (f) => ORGANIZATION_FIELD_CLASS[f].fieldClass !== "S0",
      },
      {
        name: "Admin WITH org:update only",
        actor: makeActor(false, [AppPermissions.ORG_VIEW, AppPermissions.ORG_UPDATE]),
        expectedAllowed: (f) => ORGANIZATION_FIELD_CLASS[f].fieldClass === "S2",
      },
      {
        name: "Admin WITHOUT org:update",
        actor: makeActor(false, [AppPermissions.ORG_VIEW]),
        expectedAllowed: () => false,
      },
      {
        name: "Employee WITH org:update",
        actor: makeActor(false, [AppPermissions.ORG_UPDATE]),
        expectedAllowed: (f) => ORGANIZATION_FIELD_CLASS[f].fieldClass === "S2",
      },
      {
        name: "Delegate WITH org:manage_legal_profile",
        actor: makeActor(false, [AppPermissions.ORG_MANAGE_LEGAL_PROFILE]),
        expectedAllowed: (f) => f === "legalName" || f === "taxId",
      },
      {
        name: "Delegate WITH org:manage_bank_details",
        actor: makeActor(false, [AppPermissions.ORG_MANAGE_BANK_DETAILS]),
        expectedAllowed: (f) => f === "bankAccounts",
      },
      {
        name: "Cashier (org:view only)",
        actor: makeActor(false, [AppPermissions.ORG_VIEW, AppPermissions.BILL_CREATE]),
        expectedAllowed: () => false,
      },
    ];

    const fields = Object.keys(ORGANIZATION_FIELD_CLASS);
    let cellsChecked = 0;
    for (const { name, actor, expectedAllowed } of actors) {
      for (const field of fields) {
        const actual = canEditOrganizationField(actor, field);
        const expected = expectedAllowed(field);
        assert.strictEqual(
          actual,
          expected,
          `Matrix mismatch for actor="${name}" field="${field}" (class=${ORGANIZATION_FIELD_CLASS[field].fieldClass}): expected ${expected}, got ${actual}`
        );
        cellsChecked++;
      }
    }
    assert.strictEqual(cellsChecked, 8 * fields.length, "All 8 × 21 matrix cells must execute");

    // Explicit Q-B1 / Q-B2 guard assertions (BM-5): S1 fields MUST NOT be editable via plain org:update
    const plainUpdater = makeActor(false, [AppPermissions.ORG_UPDATE]);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "legalName"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "taxId"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "bankAccounts"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "showCostToTenant"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "displayName"), true);
  });

  it("BS-13 / Q-B2 / MG-37: maskBankAccounts masks accountNumber and iban to last 4 digits", () => {
    const masked = maskBankAccounts([
      { bankName: "HDFC", accountNumber: "50100012345678", iban: "BH67BMAG00001299123456" },
    ]);
    assert.strictEqual(masked[0].accountNumber, "****5678");
    assert.strictEqual(masked[0].iban, "****3456");
    assert.deepStrictEqual(maskBankAccounts(undefined), []);
  });
});
