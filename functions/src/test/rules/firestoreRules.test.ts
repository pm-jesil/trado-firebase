/**
 * Firestore Security Rules — table-driven matrix (Part 7.2).
 *
 * RULES_MATRIX is the single declared contract: for every collection, which persona may READ a
 * representative document. Every collection × persona is asserted for read (allowed or denied)
 * and for write (always denied: all writes go through callables). The test also fails when a
 * collection of the source inventory is missing from the matrix, so a new collection cannot ship
 * without a rules decision.
 *
 * Personas: anon, other (active member of another organization), member (active member, owns the
 * "own" documents), owner (active Owner of the same organization), sa (Super Admin claim),
 * deactivated (membership status inactive).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

type Persona = "anon" | "other" | "member" | "owner" | "sa" | "deactivated";
const PERSONAS: Persona[] = ["anon", "other", "member", "owner", "sa", "deactivated"];
const ORG = "org_alpha";
const OTHER_ORG = "org_beta";
const UID: Record<Exclude<Persona, "anon">, string> = { other: "bob", member: "alice", owner: "olga", sa: "root", deactivated: "dave" };

// Read access classes
const SELF = ["member"]; // the document's own user (alice)
const SIGNED_IN = ["other", "member", "owner", "sa", "deactivated"];
const NOBODY: string[] = [];

/** collection path template → readers. `{org}` / `{uid}` are filled in. */
const RULES_MATRIX: Record<string, { path: string; data?: Record<string, unknown>; readers: string[] }> = {
  "users": { path: "users/alice", readers: SELF },
  "users/devices": { path: "users/alice/devices/d1", readers: SELF },
  "memberships": { path: `memberships/alice_${ORG}`, readers: SELF },
  "membershipBranches": { path: `membershipBranches/alice_${ORG}_main-branch`, readers: SELF },
  "notifications": { path: "notifications/n1", readers: SELF },
  "subscriptionPlans": { path: "subscriptionPlans/p1", data: { isActive: true, isPrivate: false }, readers: SIGNED_IN },
  "subscriptionPlans(private)": { path: "subscriptionPlans/private1", data: { isActive: true, isPrivate: true }, readers: NOBODY },
  "subscriptionPlans(archived)": { path: "subscriptionPlans/archived1", data: { isActive: false, isArchived: true }, readers: NOBODY },
  "permissionCatalog": { path: "permissionCatalog/bill:create", readers: SIGNED_IN },
  "modules": { path: "modules/billing", readers: SIGNED_IN },
  "taxRegimes": { path: "taxRegimes/IN_GST", readers: SIGNED_IN },
  "categories(global)": { path: "categories/global1", data: { organizationId: null }, readers: SIGNED_IN },
  "units(global)": { path: "units/global1", data: { organizationId: null }, readers: SIGNED_IN },
  "organizations": { path: `organizations/${ORG}`, readers: NOBODY },
  "organizations/branches": { path: `organizations/${ORG}/branches/main-branch`, readers: NOBODY },
  "stockBalances": { path: "stockBalances/sb1", readers: NOBODY },
  "teams": { path: "teams/t1", readers: NOBODY },
  "roles": { path: "roles/r1", readers: NOBODY },
  "departments": { path: "departments/d1", readers: NOBODY },
  "jobRoles": { path: "jobRoles/j1", readers: NOBODY },
  "categories": { path: "categories/c1", readers: NOBODY },
  "units": { path: "units/u1", readers: NOBODY },
  "tasks": { path: "tasks/task1", readers: NOBODY },
  "latestLocations": { path: "latestLocations/l1", readers: NOBODY },
  "locationPings": { path: "locationPings/p1", readers: NOBODY },
  "requests/activity": { path: "requests/r1/activity/a1", readers: NOBODY },
  ...Object.fromEntries([
    "products", "customers", "vendors", "outflows", "bills", "stockMovements", "deliveries", "returns",
    "payments", "dailySummaries", "monthlySummaries", "organizationUsageDaily", "organizationUsageMonthly", "userUsageDaily", "branchUsageDaily",
    "branchUsageMonthly", "usageRateCards", "usageCounterShards", "platformCostReconciliation", "serials", "stockAdjustmentRequests", "recurringExpenses",
    "documentCounters", "idempotencyRecords", "auditLogs", "notificationOutbox", "uniqueKeys", "imageUploadSessions",
    "accountTransactions", "accountTransfers", "branchProductStock", "capitalTransactions", "counters", "financialAccounts",
    "journalEntries", "paymentProcessingFees", "platformSettings", "requests", "stockTransfers", "storageLocations",
  ].map((c) => [c, { path: `${c}/x1`, readers: NOBODY }])),
};

describe("Firestore rules matrix (every collection × persona × read/write)", () => {
  let env: RulesTestEnvironment;

  before(async () => {
    const rulesPath = [path.resolve(process.cwd(), "firestore.rules"), path.resolve(process.cwd(), "..", "firestore.rules")].find(fs.existsSync) as string;
    // One project id per run: the emulator's rule-coverage counters are per project, so the evidence
    // collected by scripts/collect-rules-coverage.js describes this run only.
    const projectId = `trado-x-rules-${Date.now().toString(36)}`;
    fs.mkdirSync(path.resolve(__dirname, "../../../../.local/rules-evidence"), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, "../../../../.local/rules-evidence/firestore.json"), JSON.stringify({ projectId }));
    env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(rulesPath, "utf8"), host: "127.0.0.1", port: 8080 } });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const memberships: Array<[string, string, string, string]> = [
        ["alice", ORG, "active", "role_employee"], ["olga", ORG, "active", "role_org_owner"],
        ["bob", OTHER_ORG, "active", "role_employee"], ["dave", ORG, "inactive", "role_employee"],
      ];
      for (const [uid, org, status, roleId] of memberships) {
        await setDoc(doc(db, `memberships/${uid}_${org}`), { userId: uid, organizationId: org, status, roleId });
      }
      for (const [key, row] of Object.entries(RULES_MATRIX)) {
        if (key === "memberships") continue;
        await setDoc(doc(db, row.path), { organizationId: ORG, userId: "alice", ...(row.data || {}) });
      }
    });
  });

  after(async () => {
    if (env) await env.cleanup();
  });

  const client = (p: Persona) => (p === "anon" ? env.unauthenticatedContext() : env.authenticatedContext(UID[p], p === "sa" ? { isSuperAdmin: true } : {})).firestore();

  it("covers every collection of the source inventory", () => {
    const inventoryPath = [path.resolve(process.cwd(), "tests/api/canonical-source-inventory.json"), path.resolve(process.cwd(), "..", "tests/api/canonical-source-inventory.json")].find(fs.existsSync) as string;
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
    const declared = new Set(Object.keys(RULES_MATRIX).map((k) => k.replace(/\(.*\)$/, "")));
    const missing = (inventory.concreteCollections as Array<{ path: string }>)
      .map((c) => c.path.replace(/\/\{[^}]+\}/g, "").replace(/^organizations\/branches$/, "organizations/branches").replace(/^users\/devices$/, "users/devices"))
      .filter((c) => !declared.has(c));
    assert.deepEqual(missing, [], `collections without a rules expectation: ${missing.join(", ")}`);
  });

  for (const [key, row] of Object.entries(RULES_MATRIX)) {
    it(`${key}: read allowed for [${row.readers.join(", ") || "nobody"}]; write denied for everyone`, async () => {
      for (const p of PERSONAS) {
        const ref = doc(client(p), row.path);
        if (row.readers.includes(p)) await assertSucceeds(getDoc(ref));
        else await assertFails(getDoc(ref));
        await assertFails(setDoc(ref, { organizationId: ORG, userId: "alice", hacked: true }));
      }
    });
  }

  it("denies a path no rule names (catch-all /{document=**}) for every persona", async () => {
    // Four segments: matched by no collection rule, only by the catch-all deny.
    // The emulator's rule-coverage report has no entry for a literal `if false`, so these outcomes are
    // recorded for scripts/collect-rules-coverage.js (C-9).
    const outcomes: Array<{ op: "read" | "write"; path: string; allowed: boolean }> = [];
    for (const p of PERSONAS) {
      const ref = doc(client(p), "bills/x1/unlisted/y1");
      await assertFails(getDoc(ref));
      outcomes.push({ op: "read", path: "bills/x1/unlisted/y1", allowed: false });
      await assertFails(setDoc(ref, { organizationId: ORG }));
      outcomes.push({ op: "write", path: "bills/x1/unlisted/y1", allowed: false });
    }
    const evidence = path.resolve(__dirname, "../../../../.local/rules-evidence/firestore.json");
    fs.writeFileSync(evidence, JSON.stringify({ ...JSON.parse(fs.readFileSync(evidence, "utf8")), outcomes }));
  });
});
