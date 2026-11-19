const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");

const REPO = path.resolve(__dirname, "..", "..", "..");
const HELPERS = path.join(REPO, "functions", "scripts", "helpers");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth, db } = require(path.join(HELPERS, "emulator-helper.cjs"));
const { callFunction, assertCallableError } = require(path.join(HELPERS, "callable-client.cjs"));
const { getSuperAdminPersona, createTenantOwnerPersona, createEmployeePersona } = require(path.join(HELPERS, "auth-personas.cjs"));
const { assertResponseShape } = require(path.join(HELPERS, "contract-shape.cjs"));

enforceLocalEmulatorSafety();

async function run() {
  console.log("\n=== BX1 + BX4 LIVE EMULATOR ACCEPTANCE SUITE ===");
  await verifyEmulatorHealth({ requireStorage: true, requirePubsub: true });
  console.log("  ✓ TT-7: Auth, Firestore, Storage, and PubSub emulators ALL reachable");

  const sa = await getSuperAdminPersona();
  const orgA = await createTenantOwnerPersona(sa.idToken, "BX4OrgA");
  const orgB = await createTenantOwnerPersona(sa.idToken, "BX4OrgB");

  // 1. BS-05 & BS-06: authMe timezone + requestedOrgId rejected + assertResponseShape
  const me = await callFunction("authMe", {}, orgA.idToken);
  assertResponseShape("authMe", me);
  assert.ok(typeof me.context?.primaryOrganization?.timezone === "string" && me.context.primaryOrganization.timezone.includes("/"), `Expected IANA timezone, got ${me.context?.primaryOrganization?.timezone}`);
  console.log(`  ✓ BS-05 [authMe#ok]: primaryOrganization.timezone = "${me.context.primaryOrganization.timezone}" & response shape valid`);

  await assertCallableError(callFunction("authMe", { requestedOrgId: orgB.organizationId }, orgA.idToken), ["UNKNOWN_FIELD", "invalid-argument"]);
  console.log("  ✓ BS-06 [authMe#UNKNOWN_FIELD]: requestedOrgId rejected (multi-org Switch ON HOLD)");

  // 2. BS-18: productsList with ids (cross-tenant isolation, missingIds, cost hidden, validation)
  const prodA = await callFunction("productsCreate", {
    name: "BX4 Product A",
    sku: `BX4-A-${Date.now()}`,
    baseUnit: "pcs",
    sellingPrice: 15000,
    costPrice: 9000,
    trackStock: false,
  }, orgA.idToken);
  const prodB = await callFunction("productsCreate", {
    name: "BX4 Product B",
    sku: `BX4-B-${Date.now()}`,
    baseUnit: "pcs",
    sellingPrice: 22000,
    costPrice: 12000,
    trackStock: false,
  }, orgB.idToken);

  const cashierA = await createEmployeePersona(orgA.idToken, orgA.organizationId, { roleId: "role_cashier", roleCode: "cashier", name: "BX4 Cashier" });

  const batchOwner = await callFunction("productsList", { ids: [prodA.productId, prodB.productId, "nonexistent_prod_xyz"] }, orgA.idToken);
  assertResponseShape("productsList", batchOwner);
  assert.strictEqual(batchOwner.items.length, 1);
  assert.strictEqual(batchOwner.items[0].productId, prodA.productId);
  assert.deepStrictEqual(batchOwner.missingIds, [prodB.productId, "nonexistent_prod_xyz"]);
  assert.strictEqual(batchOwner.nextCursor, null);
  console.log("  ✓ BS-18 [productsList#ok]: batch ids returns in-tenant items & hides cross-tenant IDs indistinguishably in missingIds");

  const batchCashier = await callFunction("productsList", { ids: [prodA.productId] }, cashierA.idToken);
  assert.strictEqual(batchCashier.items.length, 1);
  assert.strictEqual(batchCashier.items[0].costPrice, undefined, "Cashier without product:view_cost must not receive costPrice");
  console.log("  ✓ BS-18: costPrice stripped for cashier without product:view_cost");

  await assertCallableError(callFunction("productsList", { ids: [prodA.productId, prodA.productId] }, orgA.idToken), ["invalid-argument", "Duplicate"]);
  await assertCallableError(callFunction("productsList", { ids: Array.from({ length: 51 }, (_, i) => `p_${i}`) }, orgA.idToken), ["invalid-argument"]);
  console.log("  ✓ BS-18 [productsList#INVALID_ARGUMENT]: duplicates & > 50 ids rejected");

  // 3. MG-36 + Q-B4 + Q-B3: fail-closed dark launch when doc missing + 7 groups + reopenWindowDays in requestsMeta
  await db.collection("platformSettings").doc("requests").delete().catch(() => {});
  await assertCallableError(callFunction("requestsMeta", {}, orgA.idToken), ["FEATURE_DISABLED", "failed-precondition"]);
  console.log("  ✓ MG-36 [requestsMeta#FEATURE_DISABLED]: fails closed when platformSettings/requests doc is missing");

  await db.collection("platformSettings").doc("requests").set({
    requestsEnabled: true,
    reopenWindowDays: 14,
    autoCloseDays: 7,
    needsInfoReminderDays: 3,
    needsInfoAutoCancelDays: 14,
    limits: { maxOpenPerUser: 10, maxOpenPerOrg: 50, maxCreationsPerHourPerUser: 10 },
  });
  const meta = await callFunction("requestsMeta", {}, orgA.idToken);
  assertResponseShape("requestsMeta", meta);
  assert.strictEqual(meta.allGroups.length, 7);
  assert.strictEqual(meta.reopenWindowDays, 14);
  assert.strictEqual(meta.attachments.maxCount, 5);
  assert.strictEqual(meta.attachments.maxSizeBytes, 5 * 1024 * 1024);
  console.log("  ✓ Q-B3/Q-B4/Q-B5 [requestsMeta#ok]: returns 7 groups, reopenWindowDays=14, attachments=5x5MB");

  // 4. BM-20: unknown persona string throws instead of silently becoming Super Admin
  await assert.rejects(
    async () => createTenantOwnerPersona("not_a_jwt_persona_name"),
    /BM-20|silent Super Admin fallback is forbidden/
  );
  console.log("  ✓ BM-20: unknown persona string rejected loudly (no silent Super Admin fallback)");

  // 5. BM-1: hand-edit tamper detection on scratch copy of docs/flutter-contract
  const scratchContract = path.join(os.tmpdir(), "trado-scratch", "bm1-contract");
  fs.rmSync(scratchContract, { recursive: true, force: true });
  fs.mkdirSync(scratchContract, { recursive: true });
  fs.cpSync(path.join(REPO, "docs", "flutter-contract"), scratchContract, { recursive: true });
  fs.appendFileSync(path.join(scratchContract, "SUMMARY.md"), "\n<!-- hand edit -->\n");
  const manifest = JSON.parse(fs.readFileSync(path.join(scratchContract, ".checksum.json"), "utf8"));
  const tamperedHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(scratchContract, "SUMMARY.md"), "utf8").replace(/\r\n/g, "\n")).digest("hex");
  assert.notStrictEqual(tamperedHash, manifest.files["SUMMARY.md"]);
  console.log("  ✓ BM-1: hand-edited SUMMARY.md detected via .checksum.json hash mismatch");

  console.log("✓ ALL BX1 + BX4 LIVE EMULATOR ACCEPTANCE CHECKS PASSED (9/9)!\n");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
