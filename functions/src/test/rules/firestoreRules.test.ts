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
const TENANT = ["member", "owner", "sa"]; // active members of the organization + Super Admin
const OWN = ["member", "sa"]; // the document's own user + Super Admin
const SIGNED_IN = ["other", "member", "owner", "sa", "deactivated"];
const SA_ONLY = ["sa"];
const NOBODY: string[] = [];

/** collection path template → readers. `{org}` / `{uid}` are filled in. */
const RULES_MATRIX: Record<string, { path: string; data?: Record<string, unknown>; readers: string[] }> = {
  "users": { path: "users/alice", readers: OWN },
  "users/devices": { path: "users/alice/devices/d1", readers: OWN },
  "memberships": { path: `memberships/alice_${ORG}`, readers: TENANT },
  "membershipBranches": { path: `membershipBranches/alice_${ORG}_main-branch`, readers: TENANT },
  "organizations": { path: `organizations/${ORG}`, readers: TENANT },
  "organizations/branches": { path: `organizations/${ORG}/branches/main-branch`, readers: TENANT },
  "stockBalances": { path: "stockBalances/sb1", readers: TENANT },
  "teams": { path: "teams/t1", readers: TENANT },
  "roles": { path: "roles/r1", readers: TENANT },
  "departments": { path: "departments/d1", readers: TENANT },
  "jobRoles": { path: "jobRoles/j1", readers: TENANT },
  "categories": { path: "categories/c1", readers: TENANT },
  "units": { path: "units/u1", readers: TENANT },
  "categories(global)": { path: "categories/global1", data: { organizationId: null }, readers: SIGNED_IN },
  "subscriptionPlans": { path: "subscriptionPlans/p1", readers: SIGNED_IN },
  "permissionCatalog": { path: "permissionCatalog/bill:create", readers: SIGNED_IN },
  "modules": { path: "modules/billing", readers: SIGNED_IN },
  "taxRegimes": { path: "taxRegimes/IN_GST", readers: SIGNED_IN },
  "tasks": { path: "tasks/task1", data: { assignedToMembershipId: `alice_${ORG}`, createdBy: "someone" }, readers: OWN },
  "latestLocations": { path: "latestLocations/l1", readers: OWN },
  "locationPings": { path: "locationPings/p1", readers: OWN },
  "notifications": { path: "notifications/n1", readers: OWN },
  ...Object.fromEntries(["products", "customers", "vendors", "outflows", "bills", "stockMovements", "deliveries", "returns",
    "payments", "dailySummaries", "monthlySummaries", "organizationUsageDaily", "organizationUsageMonthly", "branchUsageDaily",
    "branchUsageMonthly", "usageRateCards", "usageCounterShards", "serials", "stockAdjustmentRequests", "recurringExpenses"]
    .map((c) => [c, { path: `${c}/x1`, readers: SA_ONLY }])),
  ...Object.fromEntries(["documentCounters", "idempotencyRecords", "auditLogs", "notificationOutbox", "uniqueKeys"]
    .map((c) => [c, { path: `${c}/x1`, readers: NOBODY }])),
};

describe("Firestore rules matrix (every collection × persona × read/write)", () => {
  let env: RulesTestEnvironment;

  before(async () => {
    const rulesPath = [path.resolve(process.cwd(), "..", "firestore.rules"), path.resolve(process.cwd(), "firestore.rules")].find(fs.existsSync) as string;
    env = await initializeTestEnvironment({ projectId: "trado-x-rules-matrix", firestore: { rules: fs.readFileSync(rulesPath, "utf8"), host: "127.0.0.1", port: 8080 } });
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
    const inventory = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "tests/api/canonical-source-inventory.json"), "utf8"));
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
});
