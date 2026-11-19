import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RequestAction,
  RequestAudience,
  RequestCategory,
  RequestKind,
  RequestStatus,
} from "../../constants/enums.js";
import {
  CATEGORY_DETAILS_SCHEMAS,
  UpdateRequestsSettingsSchema,
} from "../../validation/schemas.js";
import {
  validateStateTransition,
  filterActivityForTenant,
  getCategoryKind,
  getCategoryAudience,
} from "../../services/requestsService.js";
import { SENSITIVE_CATEGORIES } from "../../callables/requests/helpers.js";
import type { RequestActivityDoc } from "../../types/models.js";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Expected Appendix B transition table for exhaustive grid verification (RH-2 / BM-8).
 */
function expectedNextStatus(
  kind: RequestKind,
  status: RequestStatus,
  action: RequestAction,
  actor: "requester" | "handler" | "stranger"
): RequestStatus | null {
  if (actor === "stranger") return null;

  if (action === RequestAction.RESPOND) {
    return actor === "requester" && status === RequestStatus.NEEDS_INFO ? RequestStatus.IN_REVIEW : null;
  }
  if (action === RequestAction.CANCEL) {
    return [RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW, RequestStatus.NEEDS_INFO, RequestStatus.ON_HOLD].includes(status)
      ? RequestStatus.CANCELLED
      : null;
  }
  if (action === RequestAction.CLOSE) {
    return status === RequestStatus.RESOLVED ? RequestStatus.CLOSED : null;
  }
  if (action === RequestAction.REOPEN) {
    if (kind !== RequestKind.WORK) return null;
    return [RequestStatus.RESOLVED, RequestStatus.CLOSED].includes(status) ? RequestStatus.IN_REVIEW : null;
  }

  // Handler-only actions
  if (actor !== "handler") return null;

  switch (action) {
    case RequestAction.START_REVIEW:
      return status === RequestStatus.SUBMITTED ? RequestStatus.IN_REVIEW : null;
    case RequestAction.REQUEST_INFO:
      return [RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(status) ? RequestStatus.NEEDS_INFO : null;
    case RequestAction.HOLD:
      return [RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(status) ? RequestStatus.ON_HOLD : null;
    case RequestAction.RESUME:
      return status === RequestStatus.ON_HOLD ? RequestStatus.IN_REVIEW : null;
    case RequestAction.APPROVE:
      return kind === RequestKind.APPROVAL && [RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(status)
        ? RequestStatus.APPROVED
        : null;
    case RequestAction.REJECT:
      return kind === RequestKind.APPROVAL && [RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW, RequestStatus.APPROVED].includes(status)
        ? RequestStatus.REJECTED
        : null;
    case RequestAction.APPLY:
      return kind === RequestKind.APPROVAL && status === RequestStatus.APPROVED ? RequestStatus.APPLIED : null;
    case RequestAction.START_WORK:
      return kind === RequestKind.WORK && [RequestStatus.SUBMITTED, RequestStatus.IN_REVIEW].includes(status)
        ? RequestStatus.IN_PROGRESS
        : null;
    case RequestAction.RESOLVE:
      return kind === RequestKind.WORK && [RequestStatus.IN_REVIEW, RequestStatus.IN_PROGRESS].includes(status)
        ? RequestStatus.RESOLVED
        : null;
    case RequestAction.DECLINE:
      return kind === RequestKind.WORK && [RequestStatus.IN_REVIEW, RequestStatus.IN_PROGRESS].includes(status)
        ? RequestStatus.DECLINED
        : null;
    default:
      return null;
  }
}

describe("BX3 Requests Exhaustive Spec Verification (RH-2, RH-3, RH-4, RH-6, RH-9, RH-13)", () => {
  describe("RH-2: Exhaustive State Transition Grid (kind × status × action × actor = 1,008 cells)", () => {
    it("[requestsTransition#REQUEST_INVALID_TRANSITION] matches Appendix B across all 1,008 generated cells", () => {
      const kinds = [RequestKind.APPROVAL, RequestKind.WORK];
      const statuses = Object.values(RequestStatus);
      const actions = Object.values(RequestAction);
      const actors: Array<"requester" | "handler" | "stranger"> = ["requester", "handler", "stranger"];

      let totalCells = 0;
      let allowedCells = 0;
      let deniedCells = 0;

      for (const kind of kinds) {
        for (const status of statuses) {
          for (const action of actions) {
            for (const actor of actors) {
              totalCells++;
              const expected = expectedNextStatus(kind, status, action, actor);
              const isPlatformHandler = actor === "handler";
              const isRequester = actor === "requester";

              if (expected !== null) {
                const res = validateStateTransition(
                  status,
                  action,
                  kind,
                  isPlatformHandler,
                  false,
                  isRequester,
                  RequestAudience.PLATFORM
                );
                assert.strictEqual(
                  res.nextStatus,
                  expected,
                  `Allowed cell mismatch: (${kind}, ${status}, ${action}, ${actor}) expected ${expected}, got ${res.nextStatus}`
                );
                allowedCells++;
              } else {
                assert.throws(
                  () =>
                    validateStateTransition(
                      status,
                      action,
                      kind,
                      isPlatformHandler,
                      false,
                      isRequester,
                      RequestAudience.PLATFORM
                    ),
                  `Illegal cell MUST throw: (${kind}, ${status}, ${action}, ${actor})`
                );
                deniedCells++;
              }
            }
          }
        }
      }

      assert.strictEqual(totalCells, 2 * 12 * 14 * 3); // 1,008 cells
      assert.ok(allowedCells > 40 && deniedCells > 900);
    });
  });

  describe("RH-3: Per-Category Detail Schemas (15 categories × 3 named tests = 45 tests)", () => {
    const categoryVectors: Array<{
      category: RequestCategory;
      expectedKind: RequestKind;
      expectedAudience: RequestAudience;
      sensitive: boolean;
      minimal: Record<string, unknown>;
      full: Record<string, unknown>;
      invalid: Record<string, unknown>;
    }> = [
      {
        category: RequestCategory.PLAN_CHANGE,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: true,
        minimal: { requestedPlanId: "plan_pro", reason: "Growing branch count across regions" },
        full: { requestedPlanId: "plan_enterprise", billingPeriod: "yearly", effectiveFrom: "2026-12-01", reason: "Annual enterprise upgrade for 10 branches" },
        invalid: { requestedPlanId: "", reason: "short", extraBadField: true },
      },
      {
        category: RequestCategory.LIMIT_INCREASE,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: true,
        minimal: { metric: "firestoreWrites", period: "daily", requestedLimit: 50000, reason: "Seasonal sales peak capacity" },
        full: { metric: "firestoreReads", period: "monthly", requestedLimit: 2000000, reason: "Expanded reporting workload for Q4" },
        invalid: { metric: "invalidMetric", period: "daily", requestedLimit: -5, reason: "no" },
      },
      {
        category: RequestCategory.MODULE_REQUEST,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: true,
        minimal: { moduleKey: "delivery", action: "enable", reason: "Launching home delivery fleet" },
        full: { moduleKey: "employee_tracking", action: "disable", reason: "Temporarily pausing field tracking" },
        invalid: { moduleKey: "", action: "toggle", reason: "bad" },
      },
      {
        category: RequestCategory.BILLING_QUERY,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { subject: "invoice", description: "Need clarification on November invoice line item" },
        full: { subject: "charge", reference: "INV-2026-881", amount: 299900, description: "Duplicate gateway charge observed on statement" },
        invalid: { subject: "unknown_subject", description: "x" },
      },
      {
        category: RequestCategory.ORG_PROFILE_CHANGE,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: true,
        minimal: { field: "timezone", proposedValue: "Asia/Dubai", reason: "Head office relocated to Dubai" },
        full: { field: "financialYearStartMonth", proposedValue: 1, reason: "Aligning fiscal year to calendar year" },
        invalid: { field: "unknownField", proposedValue: 1, reason: "bad" },
      },
      {
        category: RequestCategory.OWNERSHIP_TRANSFER,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: true,
        minimal: { newOwnerEmail: "newowner@example.com", reason: "Business leadership handover" },
        full: { newOwnerUserId: "uid_new_owner_1", newOwnerEmail: "newowner@example.com", effectiveFrom: "2026-12-15", reason: "Board-approved ownership transfer" },
        invalid: { reason: "Missing both userId and email" },
      },
      {
        category: RequestCategory.BUG_REPORT,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { area: "pos", stepsToReproduce: "Open POS, add item, tap pay", expected: "Receipt prints", actual: "Spinner hangs", severity: "major" },
        full: { area: "billing", stepsToReproduce: "Finalize B2B invoice with 3 decimals", expected: "Exact fils total", actual: "Rounding mismatch", severity: "critical", frequency: "always", diagnosticsOptIn: true, diagnostics: { appVersion: "1.4.0", platform: "android" } },
        invalid: { area: "", severity: "invalid_sev" },
      },
      {
        category: RequestCategory.DATA_ISSUE,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { entityType: "bill", whatIsWrong: "Total mismatch on bill", expected: "Sum of line totals" },
        full: { entityType: "product", entityId: "prod_991", whatIsWrong: "Duplicate barcode entry", expected: "Single active SKU record" },
        invalid: { entityType: "", whatIsWrong: "", expected: "" },
      },
      {
        category: RequestCategory.FEATURE_REQUEST,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { problem: "Need barcode label batch printing", businessImpact: "Saves 2 hours daily at intake", area: "inventory" },
        full: { problem: "Need thermal label batch print", businessImpact: "Cuts warehouse intake time in half", area: "inventory", proposedSolution: "Bulk select on purchase receipt", neededBy: "2027-01-15", alternatives: "Manual CSV export" },
        invalid: { problem: "x" },
      },
      {
        category: RequestCategory.IMPROVEMENT,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { area: "reports", currentBehaviour: "Export opens plain text", suggestedBehaviour: "Include UTF-8 BOM for Excel" },
        full: { area: "pos", currentBehaviour: "Search requires exact SKU", suggestedBehaviour: "Support partial barcode suffix search" },
        invalid: { area: "" },
      },
      {
        category: RequestCategory.SUPPORT_QUESTION,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { topic: "how_to", question: "How do I configure multi-branch stock transfer approval?" },
        full: { topic: "billing", question: "How do I apply a credit note to an existing B2B invoice?" },
        invalid: { topic: "invalid_topic", question: "?" },
      },
      {
        category: RequestCategory.OTHER,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { detailsText: "General inquiry regarding enterprise onboarding SLA." },
        full: { detailsText: "Requesting scheduling of annual security compliance questionnaire review." },
        invalid: { detailsText: "" },
      },
      {
        category: RequestCategory.DATA_REQUEST,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: true,
        minimal: { type: "export", scope: "All invoices for FY 2026", reason: "External statutory audit requirement" },
        full: { type: "deletion", scope: "Inactive test customer records", reason: "GDPR retention policy cleanup", confirmationText: "DELETE" },
        invalid: { type: "invalid_type", scope: "", reason: "" },
      },
      {
        category: RequestCategory.SECURITY_CONCERN,
        expectedKind: RequestKind.WORK,
        expectedAudience: RequestAudience.PLATFORM,
        sensitive: false,
        minimal: { description: "Suspicious login alert observed from unknown device IP." },
        full: { description: "Former staff member attempted credential reuse on branch terminal.", whenNoticed: "2026-11-18T08:00:00.000Z", suspectedImpact: "No unauthorized transactions observed" },
        invalid: { description: "bad" },
      },
      {
        category: RequestCategory.ACCESS_REQUEST,
        expectedKind: RequestKind.APPROVAL,
        expectedAudience: RequestAudience.ORGANIZATION,
        sensitive: false,
        minimal: { permissionKeys: ["bill:void"], reason: "Covering shift lead duties this week" },
        full: { roleId: "role_admin", permissionKeys: ["report:export"], branchId: "main-branch", reason: "Month-end closing reconciliation access", until: "2026-12-01" },
        invalid: { reason: "No roleId or permissionKeys supplied" },
      },
    ];

    assert.strictEqual(categoryVectors.length, Object.values(RequestCategory).length, "All 15 categories must be covered");

    for (const vec of categoryVectors) {
      it(`RH-3 [${vec.category}] minimal valid payload + kind/audience/sensitivity derivation`, () => {
        const schema = CATEGORY_DETAILS_SCHEMAS[vec.category];
        const res = schema.safeParse(vec.minimal);
        assert.strictEqual(res.success, true, `Minimal payload failed for ${vec.category}: ${!res.success ? JSON.stringify(res.error.issues) : ""}`);
        assert.strictEqual(getCategoryKind(vec.category), vec.expectedKind);
        assert.strictEqual(getCategoryAudience(vec.category), vec.expectedAudience);
        assert.strictEqual(SENSITIVE_CATEGORIES.has(vec.category), vec.sensitive);
      });

      it(`RH-3 [${vec.category}] full valid payload passes strict schema`, () => {
        const schema = CATEGORY_DETAILS_SCHEMAS[vec.category];
        const res = schema.safeParse(vec.full);
        assert.strictEqual(res.success, true, `Full payload failed for ${vec.category}: ${!res.success ? JSON.stringify(res.error.issues) : ""}`);
      });

      it(`RH-3 [${vec.category}] invalid / unknown-field payload rejected`, () => {
        const schema = CATEGORY_DETAILS_SCHEMAS[vec.category];
        const res = schema.safeParse(vec.invalid);
        assert.strictEqual(res.success, false, `Invalid payload MUST fail for ${vec.category}`);
      });
    }
  });

  describe("RH-4, RH-6 (BM-9), RH-9, RH-13: Visibility, Transaction Ordering, Settings Bounds & Retention", () => {
    it("RH-4 / BM-7 [requestsActivityList#ok]: internal notes are ALWAYS stripped when hasInternalNotesPermission is false", () => {
      const sample: RequestActivityDoc[] = [
        {
          requestId: "r1",
          type: "comment",
          visibility: "public",
          author: { uid: "u1", name: "Alice", roleLabel: "Owner", isPlatform: false },
          content: "Public comment",
          createdAt: "2026-11-18T10:00:00.000Z",
        },
        {
          requestId: "r1",
          type: "comment",
          visibility: "internal",
          author: { uid: "sa1", name: "Super Admin", roleLabel: "Platform", isPlatform: true },
          content: "SECRET INTERNAL NOTE",
          createdAt: "2026-11-18T10:05:00.000Z",
        },
      ];
      const forTenant = filterActivityForTenant(sample, false);
      assert.strictEqual(forTenant.length, 1);
      assert.strictEqual(forTenant[0].visibility, "public");
      assert.strictEqual(forTenant.some((a) => a.content?.includes("SECRET")), false);

      const forPlatform = filterActivityForTenant(sample, true);
      assert.strictEqual(forPlatform.length, 2);
    });

    it("RH-6 / BM-9: no Firestore transaction in requests/ performs a txn.get() after txn.set/update/delete()", () => {
      const files = [
        path.join(ROOT, "functions/src/callables/requests/tenantRequests.ts"),
        path.join(ROOT, "functions/src/callables/requests/platformRequests.ts"),
      ];
      for (const f of files) {
        const src = fs.readFileSync(f, "utf8");
        const txnBlocks = src.split("db.runTransaction(async (txn) => {").slice(1);
        assert.ok(txnBlocks.length > 0, `Expected runTransaction in ${path.basename(f)}`);
        for (const block of txnBlocks) {
          // Stop at closing of runTransaction
          const body = block.split("\n  });")[0];
          const firstWrite = body.search(/txn\.(set|update|delete|create)\(/);
          if (firstWrite >= 0) {
            const afterWrite = body.slice(firstWrite);
            const readAfterWrite = afterWrite.search(/txn\.get\(/);
            assert.strictEqual(
              readAfterWrite,
              -1,
              `BM-9 violation: txn.get() found AFTER txn write in ${path.basename(f)}`
            );
          }
        }
      }
    });

    it("RH-9 [requestsSettingsUpdate#ok] [requestsSettingsUpdate#INVALID_ARGUMENT]: validates bounded SLA, limits, and reopenWindowDays", () => {
      const valid = UpdateRequestsSettingsSchema.parse({
        requestsEnabled: true,
        reopenWindowDays: 14,
        autoCloseDays: 7,
        sla: { urgent: { firstResponseHours: 2, resolutionHours: 12 } },
        limits: { maxOpenPerUser: 10, maxOpenPerOrg: 50, maxCreationsPerHourPerUser: 10 },
      });
      assert.strictEqual(valid.reopenWindowDays, 14);

      assert.throws(() => UpdateRequestsSettingsSchema.parse({ reopenWindowDays: 0 }));
      assert.throws(() => UpdateRequestsSettingsSchema.parse({ reopenWindowDays: 365 }));
      assert.throws(() => UpdateRequestsSettingsSchema.parse({ unknownSetting: true }));
    });

    it("RH-13: no callable in functions/src/index.ts hard-deletes a request", () => {
      const indexSrc = fs.readFileSync(path.join(ROOT, "functions/src/index.ts"), "utf8");
      assert.strictEqual(/\brequestsDelete\b|\brequestsHardDelete\b|\brequestsPurge\b/.test(indexSrc), false);
    });
  });
});
