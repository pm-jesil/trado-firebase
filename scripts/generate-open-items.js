/**
 * Open Items Register Generator (Part 3.9 / Y-13)
 *
 * Compiles an authoritative register of all architectural decisions (D-1..D-20),
 * audit findings (X-1..X-8, Y-1..Y-14), core rules (R-1..R-4), and handoffs.
 *
 * Outputs:
 * - docs/audit/open-items.json
 * - docs/audit/open-items.md
 *
 * Usage: node scripts/generate-open-items.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const OUTPUT_JSON_PATH = path.resolve(ROOT, "docs/audit/open-items.json");
const OUTPUT_MD_PATH = path.resolve(ROOT, "docs/audit/open-items.md");

const ITEMS = [
  // Decisions D-1 .. D-20
  { id: "D-01", prompt: "60", category: "Decision", title: "Canonical Phone E.164 normalization", status: "CLOSED", resolution: "normalizePhone() enforced on all party and branch writes." },
  { id: "D-02", prompt: "60", category: "Decision", title: "Email lowercasing & trimming", status: "CLOSED", resolution: "normalizeEmail() enforced on all user and party writes." },
  { id: "D-03", prompt: "60", category: "Decision", title: "Single name field for party entities", status: "CLOSED", resolution: "Enforced in models.ts and schemas.ts." },
  { id: "D-04", prompt: "60", category: "Decision", title: "Statutory tax identifier as taxId", status: "CLOSED", resolution: "taxId canonicalized across organizations, customers, vendors, bills." },
  { id: "D-05", prompt: "60", category: "Decision", title: "Store path references, compute URLs at read time", status: "CLOSED", resolution: "Reaffirmed by D-15; hydrateImageUrl() computes URLs at read time." },
  { id: "D-06", prompt: "62", category: "Decision", title: "Strict zod parsing on all callable inputs", status: "CLOSED", resolution: "parseInput(z.strictObject()) on all 134 callables." },
  { id: "D-07", prompt: "62", category: "Decision", title: "Zero backward-compatibility aliases in pre-release", status: "CLOSED", resolution: "Banned aliases (whatsApp, taxNumber, photoUrl) rejected with UNKNOWN_FIELD." },
  { id: "D-08", prompt: "62", category: "Decision", title: "Sequential document numbering via documentCounters", status: "CLOSED", resolution: "Atomic shard transaction implemented in documentCounters.ts." },
  { id: "D-09", prompt: "62", category: "Decision", title: "Double-entry party balance updates via atomic transactions", status: "CLOSED", resolution: "bills.ts and outflows.ts update customer/vendor balances transactionally." },
  { id: "D-10", prompt: "62", category: "Decision", title: "Negative inventory prevention via StockBalanceDoc", status: "CLOSED", resolution: "checkStockAvailability() asserts available >= requested." },
  { id: "D-11", prompt: "63", category: "Decision", title: "Organization multi-branch isolation & context switching", status: "CLOSED", resolution: "branchContextSwitch callable and branch validation in contextResolver.ts." },
  { id: "D-12", prompt: "63", category: "Decision", title: "Super Admin platform privilege separation", status: "CLOSED", resolution: "Super admin role === null, zero tenant permissions; platform gates separate." },
  { id: "D-13", prompt: "63", category: "Decision", title: "Natural key reservation locks in uniqueKeys collection", status: "CLOSED", resolution: "commitWithKeys() manages naturalKey reservation transactions." },
  { id: "D-14", prompt: "63", category: "Decision", title: "Usage metering shard architecture", status: "CLOSED", resolution: "Sharded counters in usageCounterShards with hourly/daily rollups." },
  { id: "D-15", prompt: "64", category: "Decision", title: "Single stored field image: ImageRef (no URL inside)", status: "CLOSED", resolution: "Removed all stored photoUrl/avatarUrl/logoUrl; single hydrateImageUrl() hydration." },
  { id: "D-16", prompt: "64", category: "Decision", title: "Zero `as any` on write or response paths", status: "CLOSED", resolution: "check-no-any-writes.js verified with 0 allowlist entries." },
  { id: "D-17", prompt: "64", category: "Decision", title: "Guards never narrowed; explicit documented exclusions", status: "CLOSED", resolution: "check-same-doc-duplicates.cjs scans all 47 collections with documented policies." },
  { id: "D-18", prompt: "64", category: "Decision", title: "One uniform response convention", status: "CLOSED", resolution: "Single entity under its name, lists as { items, count, nextCursor }." },
  { id: "D-19", prompt: "65", category: "Decision", title: "Skipped is not passed (Change-impact testing)", status: "CLOSED", resolution: "verify-impact.js tracks baseline and outputs explicit Verification Scope Block." },
  { id: "D-20", prompt: "65", category: "Decision", title: "Coverage is a computed ratio citing [cov:C-n]", status: "CLOSED", resolution: "coverage-engine.js computes ratios C-1 through C-10 from source of truth." },
  { id: "D-71", prompt: "77D", category: "Decision", title: "Decimal Money in Major Units & Single Currency Table", status: "CLOSED", resolution: "Money stored as decimal major units, single rounding entry Money.amount, single currency table CURRENCIES. Supersedes D-19 / A-41 minor-unit rule." },

  // Findings X-1 .. X-8 (Prompt 64)
  { id: "X-01", prompt: "64", category: "Audit Finding", title: "Image triple stored three times in users document", status: "CLOSED", resolution: "Eliminated photoUrl and avatarUrl; stored only image: ImageRef." },
  { id: "X-02", prompt: "64", category: "Audit Finding", title: "Maximal payload incomplete in round-trip tests", status: "CLOSED", resolution: "Expanded test-maximal-payload-roundtrip.cjs covering all create/update fields." },
  { id: "X-03", prompt: "64", category: "Audit Finding", title: "Allowlist in check-no-any-writes hid 13 any write casts", status: "CLOSED", resolution: "Eliminated all 13 any entries; allowlist is now 0 entries." },
  { id: "X-04", prompt: "64", category: "Audit Finding", title: "Duplicate fields guard scanned only 16 of 47 collections", status: "CLOSED", resolution: "Expanded check-same-doc-duplicates.cjs to all 47 collections." },
  { id: "X-05", prompt: "64", category: "Audit Finding", title: "API ledger had 5 WARN for missing idempotency", status: "CLOSED", resolution: "Added reserveIdempotency to plans, roles, jobRoles, departments, teams." },
  { id: "X-06", prompt: "64", category: "Audit Finding", title: "Rules test count discrepancy (52 -> 49)", status: "CLOSED", resolution: "Refactored into 49 comprehensive matrix tests covering all 47 collections." },
  { id: "X-07", prompt: "64", category: "Audit Finding", title: "Cloud Scheduler manual binding myth in docs", status: "CLOSED", resolution: "Corrected docs: Cloud Functions Gen 2 automatically provisions Cloud Scheduler." },
  { id: "X-08", prompt: "64", category: "Audit Finding", title: "Missing documents ledger accounting for 135 docs", status: "CLOSED", resolution: "document-ledger.md generated accounting for all 135 files." },

  // Verification Gaps Y-1 .. Y-14 (Prompt 65)
  { id: "Y-01", prompt: "65", category: "Verification", title: "Field catalog dynamic generation (all 47 collections / 44 Docs)", status: "CLOSED", resolution: "generate-field-catalog.js parses models.ts dynamically (406 fields, C-1: 406/406)." },
  { id: "Y-02", prompt: "65", category: "Verification", title: "Duplicate guard full 47 collections & 5 seeded defect test", status: "CLOSED", resolution: "test-same-doc-duplicates-defects.cjs passes all 5 tests; guard passes all 47 collections." },
  { id: "Y-03", prompt: "65", category: "Verification", title: "Eliminate all 13 as any write path entries", status: "CLOSED", resolution: "All 13 any entries eliminated; check-no-any-writes.js allowlist count = 0." },
  { id: "Y-04", prompt: "65", category: "Verification", title: "Zero stored URLs evidence & single hydration function", status: "CLOSED", resolution: "migrate-d15-image-fields.cjs ran; hydrateImageUrl() centralized in imageEngine.ts." },
  { id: "Y-05", prompt: "65", category: "Verification", title: "Maximal roundtrip proof for all create/update operations", status: "CLOSED", resolution: "test-maximal-payload-roundtrip.cjs verified 20/20 entities (C-2: 20/20)." },
  { id: "Y-06", prompt: "65", category: "Verification", title: "Consistent test and document figures", status: "CLOSED", resolution: "Discrepancy reconciled: 49 Firestore rules + 12 Storage rules = 61 rules tests." },
  { id: "Y-07", prompt: "65", category: "Verification", title: "Idempotency for 5 creates (zero WARN in API ledger)", status: "CLOSED", resolution: "All 22 create operations idempotent with reserveIdempotency (C-10: 22/22, 134 PASS)." },
  { id: "Y-08", prompt: "65", category: "Verification", title: "Removed fields diff (148 fields: 47 present, 89 deferred, 12 removed)", status: "CLOSED", resolution: "generate-catalog-diff.js verified 148 === 148." },
  { id: "Y-09", prompt: "65", category: "Verification", title: "Cloud punch-list corrected with owners and timeline", status: "CLOSED", resolution: "production-readiness.md updated with 5 items, owners, and Gen 2 scheduler explanation." },
  { id: "Y-10", prompt: "65", category: "Verification", title: "Image decision in imagePolicy.ts and naming-registry.json", status: "CLOSED", resolution: "naming-registry.json updated with Entity Image Asset rule (D-15)." },
  { id: "Y-11", prompt: "65", category: "Verification", title: "Change-Impact Test System built and self-tested", status: "CLOSED", resolution: "verify-impact.js implemented with verify:plan, verify:changed, verify:full." },
  { id: "Y-12", prompt: "65", category: "Verification", title: "Handed over items documented for Prompt 66", status: "DEFERRED", resolution: "Documented in Part 3.12: flat firestoreWrites: 1, storageUploadBytes two writers." },
  { id: "Y-13", prompt: "65", category: "Verification", title: "Open items register generated with status counts", status: "CLOSED", resolution: "generate-open-items.js generates open-items.json and open-items.md." },
  { id: "Y-14", prompt: "65", category: "Verification", title: "Document ledger per-file accounting for all 135 files", status: "CLOSED", resolution: "docs/audit/document-ledger.md generated with line counts and verdicts." },

  // Handoff Items to Prompt 66 (Part 3.12)
  { id: "HANDOFF-01", prompt: "65", category: "Handoff", title: "Gate meters 1 write or 1 read per call, not per document", status: "DEFERRED", resolution: "functions/src/services/contextResolver.ts:326-329 adds firestoreWrites|firestoreReads = 1 per gated call; functions/scripts/test-governance-flagship.cjs:332-355 asserts a weekly firestoreWrites limit blocks after N mutation calls. Count per document in prompt 66." },
  { id: "HANDOFF-02", prompt: "65", category: "Handoff", title: "Two writers of storageUploadBytes", status: "DEFERRED", resolution: "functions/src/callables/images.ts:116 (projected size at upload-session creation) and functions/src/triggers/storageTriggers.ts:32 (actual size at finalize); an abandoned session keeps its projected bytes. One writer in prompt 66." },
  { id: "HANDOFF-03", prompt: "65", category: "Handoff", title: "changeHistory vs auditLogs.changes", status: "DEFERRED", resolution: "No changeHistory collection, writer or type exists in functions/src (47 collections derived from source); auditLogs.changes is the only change record. Prompt 66 confirms and closes." },
  { id: "HANDOFF-04", prompt: "65", category: "Handoff", title: "auditLogs.timestamp is an ISO string", status: "DEFERRED", resolution: "AuditLogDoc.timestamp is a string (functions/src/types/models.ts); a Firestore TTL policy needs a Timestamp field. Add a Timestamp expireAt in prompt 66." },

  // Cloud Production Punch List (Part 3.10)
  { id: "CLOUD-01", prompt: "60", category: "Cloud Deployment", title: "Google Cloud KMS multi-region key rotation", status: "DEFERRED", resolution: "Requires active GCP billing and live KMS project keyrings. Cloud console item." },
  { id: "CLOUD-02", prompt: "60", category: "Cloud Deployment", title: "VPC Service Controls and egress NAT", status: "DEFERRED", resolution: "Requires GCP VPC network configuration in production console." },
  { id: "CLOUD-03", prompt: "60", category: "Cloud Deployment", title: "Cloud Tasks queue provisioning for SMS/Email dispatch", status: "DEFERRED", resolution: "Queues provisioned automatically on first cloud deploy via gcloud tasks." },
  { id: "CLOUD-04", prompt: "62", category: "Cloud Deployment", title: "Custom domain SSL certificate provisioning", status: "DEFERRED", resolution: "Firebase Hosting / API Gateway DNS records CNAME setup by devops." },
  { id: "CLOUD-05", prompt: "63", category: "Cloud Deployment", title: "Cloud Monitoring alerting policies & paging", status: "DEFERRED", resolution: "Alert policies bound to Opsgenie / PagerDuty webhook endpoints." },
];

/**
 * Evidence = { file, test }: the generator finds the line of `file` containing `test` and prints
 * `file:line`. An item is DONE only when every evidence entry resolves; a typed "CLOSED" without
 * resolving evidence is reported as PARTIAL (claimed, not evidenced). IDs the prompts require that
 * have no record here are NOT DONE.
 */
const EVIDENCE = {
  "D-15": [{ file: "functions/scripts/check-raw-field-census.cjs", test: "removed field names still stored" }, { file: "functions/scripts/test-schema-contract-sweep.cjs", test: "removedFieldNames" }],
  "D-16": [{ file: "functions/scripts/check-no-any-writes.js", test: "check:no-any-writes" }],
  "D-17": [{ file: "functions/scripts/check-same-doc-duplicates.cjs", test: "writeGuardScope(__filename" }, { file: "functions/scripts/test-same-doc-duplicates-defects.cjs", test: "seeded violations detected by the guard" }],
  "D-19": [{ file: "scripts/test-verify-selftest.cjs", test: "FAIL is not carried forward" }],
  "D-20": [{ file: "scripts/check-doc-banned-words.js", test: "[cov:(C-" }, { file: "scripts/test-coverage-engine-defects.cjs", test: "Seeded defects detected" }],
  "D-71": [{ file: "functions/src/test/unit/moneyRounding.test.ts", test: "Money.amount" }],
  "Y-02": [{ file: "functions/scripts/test-same-doc-duplicates-defects.cjs", test: "seeded violations detected by the guard" }],
  "Y-03": [{ file: "functions/scripts/check-no-any-writes.js", test: "check:no-any-writes" }],
  "Y-11": [{ file: "scripts/coverage-engine.js", test: "function computeC1" }],
};
const HANDED_TO_66 = new Set(["HANDOFF-01", "HANDOFF-02", "HANDOFF-03", "HANDOFF-04"]);
const REQUIRED_RANGES = [["N", 1, 11, "60"], ["C", 1, 18, "60"], ["V", 1, 14, "62"], ["W", 1, 12, "63"], ["X", 1, 13, "64"]];
const pad = (n) => String(n).padStart(2, "0");

function resolveEvidence(list) {
  return (list || []).map((e) => {
    const abs = path.join(ROOT, e.file);
    if (!fs.existsSync(abs)) return { ...e, at: null };
    const idx = fs.readFileSync(abs, "utf8").split("\n").findIndex((l) => l.includes(e.test));
    return { ...e, at: idx >= 0 ? `${e.file}:${idx + 1}` : null };
  });
}

function issueLedgerRows() {
  const text = fs.readFileSync(path.join(ROOT, "docs/audit/issue-ledger.md"), "utf8");
  return text.split("\n").filter((l) => /^\| \*\*ISSUE-\d+\*\*/.test(l)).map((l) => {
    const cells = l.split("|").map((c) => c.trim());
    return { id: cells[1].replace(/\*/g, ""), prompt: "ledger", category: cells[3], title: cells[2], status: /RESOLVED|FIXED|CLOSED/i.test(cells[8] || "") ? "CLOSED" : /DEFERRED/i.test(cells[8] || "") ? "DEFERRED" : "OPEN", resolution: `tests named in the ledger: ${cells[7] || "none"}` };
  });
}

function main() {
  const all = [...ITEMS.map((it) => ({ ...it, id: it.id.replace(/^([A-Z])-(\d)$/, "$1-0$2") })), ...issueLedgerRows()];
  for (const [prefix, from, to, prompt] of REQUIRED_RANGES) {
    for (let n = from; n <= to; n++) {
      const id = `${prefix}-${pad(n)}`;
      if (!all.some((x) => x.id === id)) all.push({ id, prompt, category: "Carried over", title: "(no record of this item in the register)", status: "MISSING", resolution: "" });
    }
  }
  const rows = all.map((it) => {
    const evidence = resolveEvidence(EVIDENCE[it.id]);
    const verified = evidence.length > 0 && evidence.every((e) => e.at);
    let status;
    let next = "";
    if (HANDED_TO_66.has(it.id)) status = "HANDED TO 66";
    else if (it.status === "DEFERRED") { status = `DEFERRED (${it.id})`; next = it.resolution || "deferred"; }
    else if (verified) status = "DONE";
    else if (it.status === "CLOSED") { status = "PARTIAL"; next = "claimed closed; attach evidence (test name + file) in EVIDENCE"; }
    else { status = "NOT DONE"; next = it.status === "MISSING" ? "find the item's definition in its prompt and register it" : it.resolution || "open"; }
    return { id: it.id, source: `P-${it.prompt}`, title: it.title, status, evidence: evidence.map((e) => (e.at ? `${e.test} — ${e.at}` : `UNRESOLVED ${e.test} in ${e.file}`)), owner: status === "HANDED TO 66" ? "prompt 66" : it.prompt === "ledger" ? "backend" : `prompt ${it.prompt}`, next };
  });
  const doneWithoutEvidence = rows.filter((r) => r.status === "DONE" && (!r.evidence.length || r.evidence.some((e) => e.startsWith("UNRESOLVED"))));
  const counts = rows.reduce((acc, r) => { const k = r.status.replace(/ \(.*\)$/, ""); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, counts, items: rows }, null, 2)}\n`);
  const md = ["# Open-items register", "", `Generated by \`scripts/generate-open-items.js\` from its ID register, \`docs/audit/issue-ledger.md\` and resolved evidence. Do not edit.`, "",
    "A status is DONE only when each evidence entry resolves to an existing `file:line`; a claim without evidence is PARTIAL.", "",
    "| Status | Count |", "|---|---|", ...Object.entries(counts).sort().map(([k, v]) => `| ${k} | ${v} |`), `| total | ${rows.length} |`, "",
    "| ID | Source | Title | Status | Evidence (test — file:line) | Owner | Next step |", "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.source} | ${String(r.title).replace(/\|/g, "/")} | ${r.status} | ${r.evidence.join("<br>").replace(/\|/g, "/") || "—"} | ${r.owner} | ${String(r.next).replace(/\|/g, "/").slice(0, 160)} |`), ""];
  fs.writeFileSync(OUTPUT_MD_PATH, md.join("\n"));
  console.log(`Open items: ${rows.length} — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (doneWithoutEvidence.length) { console.error(`[FAIL] DONE without evidence: ${doneWithoutEvidence.map((r) => r.id).join(", ")}`); process.exit(1); }
}

main();
