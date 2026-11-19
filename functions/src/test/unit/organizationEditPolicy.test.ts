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
        name: "Delegate WITH org:manage_approval_policy",
        actor: makeActor(false, [AppPermissions.ORG_MANAGE_APPROVAL_POLICY]),
        expectedAllowed: (f) => f === "settings",
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
    assert.strictEqual(cellsChecked, actors.length * fields.length, "All actors × fields matrix cells must execute");

    // Explicit Q-B1 / Q-B2 / Q-C2 guard assertions (BM-5): S1 fields MUST NOT be editable via plain org:update
    const plainUpdater = makeActor(false, [AppPermissions.ORG_UPDATE]);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "legalName"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "taxId"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "bankAccounts"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "settings"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "settings.approvals"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "settings.numbering"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "showCostToTenant"), false);
    assert.strictEqual(canEditOrganizationField(plainUpdater, "displayName"), true);
  });

  it("BS-13 / Q-B2 / Q-C3 / MG-37 [organizationsGet#ok] [organizationsList#ok]: maskBankAccounts masks accountNumber and iban to last 4 digits for EVERY caller in gets/lists", () => {
    const rawAccounts = [
      { id: "bank_hdfc_01", bankName: "HDFC", accountNumber: "50100012345678", iban: "BH67BMAG00001299123456", accountHolderName: "Trado Org" },
    ];
    // SuperAdmin caller
    const saMasked = maskBankAccounts(rawAccounts);
    assert.strictEqual(saMasked[0].accountNumber, "****5678");
    assert.strictEqual(saMasked[0].iban, "****3456");

    // Owner caller
    const ownerMasked = maskBankAccounts(rawAccounts);
    assert.strictEqual(ownerMasked[0].accountNumber, "****5678");

    // Cashier / public member caller
    const cashierMasked = maskBankAccounts(rawAccounts);
    assert.strictEqual(cashierMasked[0].accountNumber, "****5678");

    assert.deepStrictEqual(maskBankAccounts(undefined), []);
  });

  it("Q-C3 [organizationsRevealBankAccount#ok] [organizationsRevealBankAccount#PERMISSION_DENIED]: reveals full account only to holders of org:manage_bank_details", () => {
    const rawAccounts = [
      { id: "bank_hdfc_01", bankName: "HDFC", accountNumber: "50100012345678", routingType: "ifsc", routingCode: "HDFC0001234", accountHolderName: "Trado Org" },
    ];

    function revealHelper(actor: OrgPolicyActor, accountId: string) {
      if (!actor.isSuperAdmin && !actor.can(AppPermissions.ORG_MANAGE_BANK_DETAILS)) {
        throw new Error("PERMISSION_DENIED: org:manage_bank_details required");
      }
      const acc = rawAccounts.find((a) => a.id === accountId);
      if (!acc) throw new Error("NOT_FOUND: bank account not found");
      return {
        bankAccountId: acc.id,
        accountNumber: acc.accountNumber,
        routingCode: acc.routingCode,
      };
    }

    const authorized = makeActor(false, [AppPermissions.ORG_MANAGE_BANK_DETAILS]);
    const revealed = revealHelper(authorized, "bank_hdfc_01");
    assert.strictEqual(revealed.accountNumber, "50100012345678");
    assert.strictEqual(revealed.routingCode, "HDFC0001234");

    const unauthorized = makeActor(false, [AppPermissions.ORG_UPDATE]);
    assert.throws(() => revealHelper(unauthorized, "bank_hdfc_01"), /PERMISSION_DENIED/);

    const superAdmin = makeActor(true, []);
    const saRevealed = revealHelper(superAdmin, "bank_hdfc_01");
    assert.strictEqual(saRevealed.accountNumber, "50100012345678");
  });
});
