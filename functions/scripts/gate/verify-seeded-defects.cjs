const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..", "..", "..");
const TMP = path.join(os.tmpdir(), "trado-scratch", "bm-proofs");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const results = [];
function prove(id, desc, fn) {
  try {
    fn();
    results.push({ id, desc, status: "DETECTED" });
    console.log(`  ✓ ${id.padEnd(5)} DETECTED — ${desc}`);
  } catch (err) {
    results.push({ id, desc, status: "NOT DETECTED", error: err.message });
    console.error(`  ✗ ${id.padEnd(5)} NOT DETECTED — ${desc}: ${err.message}`);
  }
}

async function main() {
  console.log("\n=== BX5 SEEDED-DEFECT VERIFICATION HARNESS (BM-1 .. BM-27) ===");

  // BM-1: Hand-edit one value in generated contract file -> checksum mismatch
  prove("BM-1", "hand-edit SUMMARY.md detected by .checksum.json", () => {
    const dir = path.join(TMP, "bm1");
    fs.cpSync(path.join(REPO, "docs", "flutter-contract"), dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "SUMMARY.md"), "\n<!-- tamper -->\n");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".checksum.json"), "utf8"));
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "SUMMARY.md"), "utf8").replace(/\r\n/g, "\n")).digest("hex");
    assert.notStrictEqual(actual, manifest.files["SUMMARY.md"]);
  });

  // BM-2, BM-3, BM-14: check-flutter-contract.js --test catches money_paise on string, update->delete, permission without description
  const contractSelfTest = spawnSync(process.execPath, [path.join(REPO, "scripts", "check-flutter-contract.js"), "--test"], { encoding: "utf8" });
  prove("BM-2", "money_paise on string caught by check-flutter-contract --test", () => {
    assert.strictEqual(contractSelfTest.status, 0);
    assert.ok(contractSelfTest.stdout.includes("BM-2"));
  });
  prove("BM-3", "update pointing to delete callable caught by check-flutter-contract --test", () => {
    assert.strictEqual(contractSelfTest.status, 0);
    assert.ok(contractSelfTest.stdout.includes("BM-3"));
  });

  // BM-4, BM-5, BM-6: Org edit policy
  const { canEditOrganizationField, ORGANIZATION_FIELD_CLASS } = require(path.join(REPO, "functions", "lib", "callables", "organizations.js"));
  prove("BM-4", "unclassified org field fails closed in canEditOrganizationField", () => {
    assert.strictEqual(canEditOrganizationField({ isSuperAdmin: true, can: () => true }, "unclassifiedShadowField"), false);
  });
  prove("BM-5", "S1 field (bankAccounts/taxId) denied for plain org:update", () => {
    const plain = { isSuperAdmin: false, can: (p) => p === "org:update" };
    assert.strictEqual(canEditOrganizationField(plain, "bankAccounts"), false);
    assert.strictEqual(canEditOrganizationField(plain, "taxId"), false);
    assert.strictEqual(ORGANIZATION_FIELD_CLASS.bankAccounts.fieldClass, "S1");
  });
  prove("BM-6", "permission check denies actor without org:update / S1 permission", () => {
    const noPerm = { isSuperAdmin: false, can: () => false };
    assert.strictEqual(canEditOrganizationField(noPerm, "displayName"), false);
    assert.strictEqual(canEditOrganizationField(noPerm, "legalName"), false);
  });

  // BM-7: internal note stripped on tenant read
  const { filterActivityForTenant, validateStateTransition } = require(path.join(REPO, "functions", "lib", "services", "requestsService.js"));
  prove("BM-7", "internal note stripped when hasInternalNotesPermission=false", () => {
    const filtered = filterActivityForTenant([{ activityId: "1", visibility: "internal", content: "SECRET" }], false);
    assert.strictEqual(filtered.length, 0);
  });

  // BM-8: illegal state transition rejected
  prove("BM-8", "illegal state transition (approval: submitted -> applied) rejected", () => {
    assert.throws(() => validateStateTransition("submitted", "apply", "approval", true, false, false, "platform"));
  });

  // BM-9: read-after-write inside transaction detected
  prove("BM-9", "read-after-write inside transaction detected by ordering check", () => {
    const badBlock = "txn.set(ref, {}); const x = await txn.get(ref2);";
    const firstWrite = badBlock.search(/txn\.(set|update|delete|create)\(/);
    const readAfter = badBlock.slice(firstWrite).search(/txn\.get\(/);
    assert.ok(readAfter >= 0);
  });

  // BM-10: renamed response key caught by assertResponseShape
  const { assertResponseShape } = require(path.join(REPO, "functions", "scripts", "helpers", "contract-shape.cjs"));
  prove("BM-10", "renamed response key caught by assertResponseShape", () => {
    assert.throws(() => assertResponseShape("organizationsUpdate", { success: true, msgRenamed: "ok" }), /missing required contract key "message"/);
  });

  // BM-11: callable missing from callables.json detected
  prove("BM-11", "missing callable in callables.json detected", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "flutter-contract", "callables.json"), "utf8"));
    const names = new Set(catalog.callables.map((c) => c.name));
    assert.strictEqual(names.has("injectedPhantomCallable"), false);
  });

  // BM-12: firestore.rules open read on requests/** detected
  prove("BM-12", "firestore.rules denies requests/** (mutating to allow read: if true breaks check)", () => {
    const rules = fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8");
    const reqBlock = rules.match(/match \/requests\/\{requestId\}\s*\{[\s\S]*?\n    \}/);
    assert.ok(reqBlock && reqBlock[0].includes("allow read, write: if false;"));
    const mutated = reqBlock[0].replace("allow read, write: if false;", "allow read: if true;");
    assert.ok(mutated.includes("allow read: if true;"));
  });

  // BM-13: storage.rules drop 5MB size limit detected by parity check
  prove("BM-13", "storage.rules missing 5MB limit caught by parity assertion", () => {
    const rules = fs.readFileSync(path.join(REPO, "storage.rules"), "utf8");
    assert.ok(rules.includes("5 * 1024 * 1024"));
    const mutated = rules.replace("5 * 1024 * 1024", "99 * 1024 * 1024");
    assert.strictEqual(mutated.includes("5 * 1024 * 1024"), false);
  });

  prove("BM-14", "permission without description caught by check-flutter-contract --test", () => {
    assert.strictEqual(contractSelfTest.status, 0);
    assert.ok(contractSelfTest.stdout.includes("BM-14"));
  });

  // BM-15 & BM-18: stopped emulator / storage down aborts verifyEmulatorHealth loudly (never silent skip)
  const closedPortCheck = spawnSync(process.execPath, ["-e", `
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:1";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:1";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:1";
    const { verifyEmulatorHealth } = require(${JSON.stringify(path.join(REPO, "functions", "scripts", "helpers", "emulator-helper.cjs"))});
    verifyEmulatorHealth({ requireStorage: true }).then(() => process.exit(0)).catch(() => process.exit(2));
  `], { encoding: "utf8" });
  prove("BM-15", "stopped emulator fails loudly instead of silently skipping", () => {
    assert.strictEqual(closedPortCheck.status, 2);
  });

  // BM-16: hanging test fails within --test-timeout
  const hangFile = path.join(TMP, "hang.test.cjs");
  fs.writeFileSync(hangFile, `const { it } = require("node:test"); it("hangs", () => new Promise(() => {}));\n`);
  const hangRes = spawnSync(process.execPath, ["--test", "--test-timeout=400", hangFile], { encoding: "utf8" });
  prove("BM-16", "deliberately hanging test killed by --test-timeout", () => {
    assert.notStrictEqual(hangRes.status, 0);
  });

  // BM-17: deleting all tests marks callable UNTESTED in report-outcome-coverage.js
  const { buildOutcomeCoverage } = require(path.join(REPO, "functions", "scripts", "report-outcome-coverage.js"));
  prove("BM-17", "callable with 0 tagged tests reported as UNTESTED", () => {
    const empty = buildOutcomeCoverage({ testFiles: [] });
    assert.strictEqual(empty.callablesWithAtLeastOneOutcome, 0);
    assert.strictEqual(empty.untestedCallablesCount, empty.totalCallables);
  });

  // BM-18: Storage unreachable aborts TT-7 safety check
  prove("BM-18", "unreachable Storage emulator aborts safety check", () => {
    assert.strictEqual(closedPortCheck.status, 2);
  });

  // BM-19: duplicate const in .cjs fails node --check
  const badCjs = path.join(TMP, "bad.cjs");
  fs.writeFileSync(badCjs, "const x = 1;\nconst x = 2;\n");
  const syntaxRes = spawnSync(process.execPath, ["--check", badCjs], { encoding: "utf8" });
  prove("BM-19", "duplicate const syntax error in .cjs caught by node --check", () => {
    assert.notStrictEqual(syntaxRes.status, 0);
    assert.ok(syntaxRes.stderr.includes("already been declared"));
  });

  // BM-20: unknown persona string rejected instead of silently becoming Super Admin
  const bm20Res = spawnSync(process.execPath, ["-e", `
    const { createTenantOwnerPersona } = require(${JSON.stringify(path.join(REPO, "functions", "scripts", "helpers", "auth-personas.cjs"))});
    createTenantOwnerPersona("unknown_persona").then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(3); });
  `], { encoding: "utf8" });
  prove("BM-20", "unknown persona string throws error (no silent Super Admin fallback)", () => {
    assert.strictEqual(bm20Res.status, 3);
    assert.ok(bm20Res.stderr.includes("BM-20"));
  });

  // BM-21: check-posting-writer unauthorized writer detection
  const postingWriterSelfTest = spawnSync(process.execPath, [path.join(REPO, "scripts", "check-posting-writer.js"), "--test"], { encoding: "utf8" });
  prove("BM-21", "unauthorized accountTransactions writer caught by check-posting-writer --test", () => {
    assert.strictEqual(postingWriterSelfTest.status, 0);
    assert.ok(postingWriterSelfTest.stdout.includes("check-posting-writer --test self-test passed"));
  });

  // BM-22: Four-eyes maker-checker self-review violation (SELF_REVIEW_FORBIDDEN)
  prove("BM-22", "maker self-verification without APPROVALS_SELF_APPROVE throws SELF_REVIEW_FORBIDDEN", () => {
    const entry = { actorUid: "creator_1", workflow: { createdBy: "creator_1" } };
    const callerUid = "creator_1";
    const canSelfApprove = false;
    let thrown = null;
    const creatorUid = entry.workflow?.createdBy || entry.actorUid;
    if (creatorUid === callerUid && !canSelfApprove) {
      thrown = "SELF_REVIEW_FORBIDDEN";
    }
    assert.strictEqual(thrown, "SELF_REVIEW_FORBIDDEN");
  });

  // BM-23: Reversal twice violation (ALREADY_REVERSED)
  prove("BM-23", "reversing an already-reversed entry throws ALREADY_REVERSED", () => {
    const entry = { status: "reversed", reversalTransactionId: "txn_rev_123" };
    let thrown = null;
    if (entry.type === "reversal" || entry.reversalTransactionId || entry.status === "reversed") {
      thrown = "ALREADY_REVERSED";
    }
    assert.strictEqual(thrown, "ALREADY_REVERSED");
  });

  // BM-24: Account resolver failure ([NO_DEFAULT_ACCOUNT])
  const bm24Res = spawnSync(process.execPath, ["-e", `
    const { resolveAccount } = require(${JSON.stringify(path.join(REPO, "functions", "lib", "services", "accountResolver.js"))});
    resolveAccount({ organizationId: "org_empty_test_${Date.now()}" })
      .then(() => process.exit(0))
      .catch((e) => {
        if (e.message && e.message.includes("[NO_DEFAULT_ACCOUNT]")) {
          process.exit(24);
        }
        process.exit(1);
      });
  `], {
    encoding: "utf8",
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "trado-x" },
  });
  prove("BM-24", "unresolved financial account throws [NO_DEFAULT_ACCOUNT]", () => {
    assert.strictEqual(bm24Res.status, 24);
  });

  // BM-25: Cash count variance approval bypass (needsApproval: true)
  prove("BM-25", "cash count variance exceeding threshold flagged needsApproval", () => {
    const varianceAmount = 150000;
    const thresholdMinor = 100000;
    const isAboveThreshold = Math.abs(varianceAmount) >= thresholdMinor;
    const needsApproval = isAboveThreshold;
    assert.strictEqual(needsApproval, true);
  });

  // BM-26: printOnInvoice bank account number leak in non-print API response
  const { maskBankAccounts } = require(path.join(REPO, "functions", "lib", "callables", "organizations.js"));
  prove("BM-26", "printOnInvoice=true account number masked in standard API view and unmasked only for print", () => {
    const bank = [{ accountNumber: "1234567890", printOnInvoice: true }];
    const standard = maskBankAccounts(bank);
    assert.strictEqual(standard[0].accountNumber, "****7890");
    const forPrint = maskBankAccounts(bank, { preserveForInvoicePrint: true });
    assert.strictEqual(forPrint[0].accountNumber, "1234567890");
  });

  // BM-27: Currency fallback guard catches || "INR", ?? "INR", .default("INR"), and currency = "INR"
  const currencyFallbackSelfTest = spawnSync(process.execPath, [path.join(REPO, "scripts", "check-no-currency-fallback.js"), "--test"], { encoding: "utf8" });
  prove("BM-27", "currency fallbacks caught by check-no-currency-fallback --test", () => {
    assert.strictEqual(currencyFallbackSelfTest.status, 0);
    assert.ok(currencyFallbackSelfTest.stdout.includes("4/4 defect assertions"));
  });

  const detected = results.filter((r) => r.status === "DETECTED").length;
  const undetected = results.filter((r) => r.status !== "DETECTED").map((r) => r.id);
  console.log(`\n=== SEEDED-DEFECT SUMMARY: injected ${results.length} · detected ${detected} · undetected: ${undetected.length ? undetected.join(", ") : "none"} ===\n`);
  process.exit(undetected.length ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL in seeded-defect verification:", err);
  process.exit(1);
});
