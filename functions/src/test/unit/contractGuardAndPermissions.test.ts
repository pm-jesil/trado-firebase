import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AppPermissions } from "../../constants/permissions.js";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CONTRACT_DIR = path.join(ROOT, "docs", "flutter-contract");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { assertResponseShape } = require(path.resolve(__dirname, "..", "..", "..", "scripts", "helpers", "contract-shape.cjs")) as {
  assertResponseShape: (callableName: string, data: unknown) => void;
};

describe("BX1 Contract Pack, Permissions Catalog & Response Shape Validator (BS-03..BS-09)", () => {
  it("BS-07 & BS-08: permissions.json matches concrete AppPermissions length, every key has description, scoped keys have scopeNote, and banned aliases do not exist", () => {
    const permsJson = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, "permissions.json"), "utf8")) as {
      totalConcrete: number;
      permissions: Array<{ key: string; description: string; defaultRoles: string[]; scopeNote: string | null }>;
    };
    const concrete = Object.values(AppPermissions).filter((p) => !p.includes("*"));
    assert.strictEqual(permsJson.permissions.length, concrete.length);
    assert.strictEqual(permsJson.totalConcrete, concrete.length);

    for (const p of permsJson.permissions) {
      assert.ok(p.description && p.description.trim().length > 0, `Missing description for ${p.key}`);
      if (/_(own|org|branch|all)$/.test(p.key)) {
        assert.ok(p.scopeNote && p.scopeNote.trim().length > 0, `Missing scopeNote for scoped permission ${p.key}`);
      }
    }

    const auditReadOwn = permsJson.permissions.find((p) => p.key === "audit:read_own");
    assert.ok(auditReadOwn?.scopeNote?.includes("actorUid"), "audit:read_own must carry explicit own-activity scope note");

    // BS-08: No aliases exist
    const allCodes = new Set<string>(Object.values(AppPermissions));
    assert.strictEqual(allCodes.has("usage:view"), false, "usage:view alias must not exist");
    assert.strictEqual(allCodes.has("audit:read"), false, "audit:read alias must not exist");
    assert.strictEqual(allCodes.has("inventory:view_cost"), false, "inventory:view_cost alias must not exist");
  });

  it("BS-04 & MG-05 & MG-15: callables.json covers all callables, customer.priceGroup is not money_paise, and approval_request has > 0 fields", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, "callables.json"), "utf8")) as {
      totalCallables: number;
      responseDocumented: number;
      callables: Array<{ name: string; response: { topLevelKeys: string[] } }>;
    };
    assert.ok(catalog.totalCallables >= 186);
    assert.strictEqual(catalog.responseDocumented, catalog.totalCallables, "Every callable must have a documented response descriptor");

    const customerForm = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, "forms", "customer.json"), "utf8")) as {
      fields: Array<{ path: string; type: string; uiHint: string; example: unknown }>;
    };
    const priceGroup = customerForm.fields.find((f) => f.path === "priceGroup");
    assert.ok(priceGroup, "customer.priceGroup field must exist");
    assert.strictEqual(priceGroup.type, "string");
    assert.notStrictEqual(priceGroup.uiHint, "money_paise", "priceGroup must not have money_paise hint");
    assert.strictEqual(priceGroup.example, "retail");

    const approvalForm = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, "forms", "approval_request.json"), "utf8")) as {
      fields: unknown[];
      callables: { actions: Array<{ name: string }> };
    };
    assert.ok(approvalForm.fields.length > 0, "approval_request form must have > 0 fields");
    assert.ok(approvalForm.callables.actions.some((a) => a.name === "documentsDecide"), "approval_request must point to documentsDecide");
  });

  it("BS-05 & MG-01/MG-02: auth.md documents primaryOrganization.timezone and images.md documents ImageRef.path", () => {
    const authMd = fs.readFileSync(path.join(CONTRACT_DIR, "auth.md"), "utf8");
    assert.ok(authMd.includes("primaryOrganization.timezone"), "auth.md must document primaryOrganization.timezone");
    assert.ok(authMd.includes("organization_selection_required"), "auth.md must document organization_selection_required");
    assert.ok(authMd.includes("requestedOrgId"), "auth.md must state requestedOrgId is rejected");

    const imagesMd = fs.readFileSync(path.join(CONTRACT_DIR, "images.md"), "utf8");
    assert.ok(imagesMd.includes("\"path\""), "images.md must document ImageRef.path");
    assert.ok(imagesMd.includes("uploadId"), "images.md must document uploadId");
  });

  it("B-3 & BM-10: assertResponseShape accepts valid responses and rejects renamed keys", () => {
    assertResponseShape("organizationsUpdate", { success: true, message: "Organization updated successfully." });
    assertResponseShape("productsList", { items: [], count: 0, nextCursor: null });

    // BM-10 seeded defect: rename required key "message" -> "msg"
    assert.throws(
      () => assertResponseShape("organizationsUpdate", { success: true, msg: "renamed" }),
      /missing required contract key "message"/
    );
  });
});
