const assert = require("node:assert/strict");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..", "..");
const HELPERS = path.join(REPO, "functions", "scripts", "helpers");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth, db } = require(path.join(HELPERS, "emulator-helper.cjs"));
const { callFunction, assertCallableError } = require(path.join(HELPERS, "callable-client.cjs"));
const { getSuperAdminPersona, createTenantOwnerPersona, createEmployeePersona } = require(path.join(HELPERS, "auth-personas.cjs"));
const { runOrgOwnerPermissionsMigration } = require(path.join(REPO, "functions", "scripts", "migrate-org-owner-permissions.cjs"));

enforceLocalEmulatorSafety();

async function run() {
  console.log("\n=== BX2 LIVE EMULATOR ACCEPTANCE SUITE (BS-11..BS-15) ===");
  await verifyEmulatorHealth({ requireStorage: true, requirePubsub: true });

  const sa = await getSuperAdminPersona();
  const owner = await createTenantOwnerPersona(sa.idToken, "BX2Org");
  const orgId = owner.organizationId;

  const adminWithUpdate = await createEmployeePersona(owner.idToken, orgId, { roleCode: "admin", name: "BX2 Admin" });
  const adminWithoutUpdate = await createEmployeePersona(owner.idToken, orgId, {
    roleCode: "admin",
    name: "BX2 NoUpdate Admin",
    permissions: { "org:update": false },
  });
  const cashier = await createEmployeePersona(owner.idToken, orgId, { roleId: "role_cashier", roleCode: "cashier", name: "BX2 Cashier" });

  // BS-11: Admin with org:update edits S2 field -> ALLOWED
  const s2Res = await callFunction("organizationsUpdate", { organizationId: orgId, displayName: "BX2 Display Updated" }, adminWithUpdate.idToken);
  assert.strictEqual(s2Res.success, true);
  console.log("  ✓ BS-11 [organizationsUpdate#ok]: Admin with org:update edited S2 displayName");

  // BS-12: Admin with org:update edits S1 (legalName, taxId, bankAccounts) or S0 (showCostToTenant) -> DENIED FIELD_NOT_EDITABLE & writes NOTHING
  const beforeOrg = (await db.collection("organizations").doc(orgId).get()).data();
  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: orgId, displayName: "ShouldNotWrite", legalName: "Hacked Legal" }, adminWithUpdate.idToken),
    ["FIELD_NOT_EDITABLE", "permission-denied"]
  );
  const afterOrg = (await db.collection("organizations").doc(orgId).get()).data();
  assert.strictEqual(afterOrg.displayName, beforeOrg.displayName, "Atomic rejection MUST write nothing on partial-forbidden update");
  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: orgId, showCostToTenant: true }, adminWithUpdate.idToken),
    ["FIELD_NOT_EDITABLE", "permission-denied"]
  );
  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: orgId, displayName: "NoPerm" }, adminWithoutUpdate.idToken),
    ["PERMISSION_DENIED", "permission-denied"]
  );
  console.log("  ✓ BS-12 [organizationsUpdate#FIELD_NOT_EDITABLE]: Admin denied on S1/S0 & atomic rejection wrote nothing");

  // BS-13: Owner edits S1 bankAccounts -> ALLOWED; organizationsGet masks accountNumber to last 4 for cashier AND owner (Q-B2 / MG-37)
  const bankUpdate = await callFunction("organizationsUpdate", {
    organizationId: orgId,
    bankAccounts: [{
      id: "ba_1",
      bankName: "HDFC Bank",
      accountHolderName: "BX2 Corp",
      accountNumber: "50100099887766",
      routingType: "ifsc", routingCode: "HDFC0001234",
      isDefault: true,
    }],
  }, owner.idToken);
  assert.strictEqual(bankUpdate.success, true);

  const cashierGet = await callFunction("organizationsGet", { organizationId: orgId }, cashier.idToken);
  assert.strictEqual(cashierGet.organization.bankAccounts[0].accountNumber, "****7766", "Cashier API response must mask accountNumber to last 4");
  const ownerGet = await callFunction("organizationsGet", { organizationId: orgId }, owner.idToken);
  assert.strictEqual(ownerGet.organization.bankAccounts[0].accountNumber, "****7766", "Owner API response must mask accountNumber to last 4");
  console.log("  ✓ BS-13 [organizationsGet#ok]: Owner updated S1 bankAccounts; API responses mask accountNumber to ****7766");

  // Q-C3: organizationsRevealBankAccount returns unmasked account to holder of org:manage_bank_details, denied to cashier
  const revealed = await callFunction("organizationsRevealBankAccount", {
    organizationId: orgId,
    bankAccountId: "ba_1",
  }, owner.idToken);
  assert.strictEqual(revealed.accountNumber, "50100099887766");
  assert.strictEqual(revealed.routingCode, "HDFC0001234");

  await assertCallableError(
    callFunction("organizationsRevealBankAccount", { organizationId: orgId, bankAccountId: "ba_1" }, cashier.idToken),
    ["permission-denied", "PERMISSION_DENIED"]
  );
  console.log("  ✓ Q-C3 [organizationsRevealBankAccount#ok]: Full account revealed to org:manage_bank_details, denied to cashier");

  // BS-14: Owner & Admin denied on organizationsCreate; only Super Admin succeeds
  await assertCallableError(
    callFunction("organizationsCreate", { name: "Illegal Org", businessType: "retail_only", businessCategory: "general", country: "IN", currency: "INR", taxRegimeCode: "IN_GST", planId: "plan_starter" }, owner.idToken),
    ["permission-denied"]
  );
  await assertCallableError(
    callFunction("organizationsCreate", { name: "Illegal Org 2", businessType: "retail_only", businessCategory: "general", country: "IN", currency: "INR", taxRegimeCode: "IN_GST", planId: "plan_starter" }, adminWithUpdate.idToken),
    ["permission-denied"]
  );
  console.log("  ✓ BS-14 [organizationsCreate#PERMISSION_DENIED]: Owner & Admin denied; Super Admin only");

  // BS-15: Owner role migration dry-run -> apply -> idempotent 2nd apply
  const legacyRoleId = `legacy_owner_${Date.now()}`;
  await db.collection("roles").doc(legacyRoleId).set({
    name: "Legacy Org Owner",
    code: "org_owner",
    organizationId: orgId,
    isSystem: true,
    permissions: ["org:view"],
  });
  const dry = await runOrgOwnerPermissionsMigration({ apply: false });
  assert.ok(dry.updated >= 1 && dry.auditEntriesWritten === 0);
  const app1 = await runOrgOwnerPermissionsMigration({ apply: true });
  assert.ok(app1.updated >= 1 && app1.auditEntriesWritten >= 1);
  const app2 = await runOrgOwnerPermissionsMigration({ apply: true });
  assert.strictEqual(app2.updated, 0);
  const fixedRole = (await db.collection("roles").doc(legacyRoleId).get()).data();
  assert.ok(
    fixedRole.permissions.includes("org:update") &&
    fixedRole.permissions.includes("org:manage_bank_details") &&
    fixedRole.permissions.includes("org:manage_legal_profile") &&
    fixedRole.permissions.includes("org:manage_approval_policy")
  );
  await db.collection("roles").doc(legacyRoleId).delete();
  console.log("  ✓ BS-15: migrate-org-owner-permissions dry-run / --apply / idempotent 2nd apply verified");

  console.log("✓ ALL BX2 LIVE EMULATOR ACCEPTANCE CHECKS PASSED (5/5)!\n");
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
