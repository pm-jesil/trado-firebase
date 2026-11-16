/**
 * Prompt 74 — Unit Tests: Requests Schemas, Strictness, and Deterministic SLA Engine (D-41, D-42)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_DETAILS_SCHEMAS,
  RequestAttachmentSchema,
} from "../../validation/schemas.js";
import {
  RequestCategory,
  RequestPriority,
  RequestSeverity,
  RequestStatus,
  SlaState,
} from "../../constants/enums.js";
import {
  computeSlaDeadlines,
  evaluateSlaState,
  applySlaResume,
  calculateDefaultPriority,
  getCategoryKind,
  getCategoryAudience,
} from "../../services/requestsService.js";
import { RequestDoc } from "../../types/models.js";

describe("Prompt 74 — Requests Schemas & SLA Engine Unit Tests", () => {
  describe("1. Static Category Detail Schemas (D-41, All 15 Categories)", () => {
    it("plan_change schema validates valid payload and rejects missing requestedPlanId", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.PLAN_CHANGE];
      assert.ok(schema, "plan_change schema must exist");

      const valid = schema.safeParse({
        requestedPlanId: "plan_pro",
        reason: "Need multi-branch support and higher limit",
        billingPeriod: "monthly",
      });
      assert.strictEqual(valid.success, true);

      const invalid = schema.safeParse({
        reason: "Need multi-branch support and higher limit",
      });
      assert.strictEqual(invalid.success, false, "Must require requestedPlanId");

      // Strictness: rejects unknown fields (D-11)
      const unknown = schema.safeParse({
        requestedPlanId: "plan_pro",
        reason: "Need multi-branch support and higher limit",
        unknownField: "foo",
      });
      assert.strictEqual(unknown.success, false, "Must reject unknown fields");
    });

    it("limit_increase schema validates metric, requestedLimit, and period", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.LIMIT_INCREASE];
      const valid = schema.safeParse({
        metric: "firestoreWrites",
        requestedLimit: 50000,
        period: "daily",
        reason: "Peak festival season operations volume increase",
      });
      assert.strictEqual(valid.success, true);

      const invalidLimit = schema.safeParse({
        metric: "firestoreWrites",
        requestedLimit: -10, // Must be positive
        period: "daily",
        reason: "Peak season",
      });
      assert.strictEqual(invalidLimit.success, false);
    });

    it("module_request schema validates moduleKey and action", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.MODULE_REQUEST];
      const valid = schema.safeParse({
        moduleKey: "deliveries",
        action: "enable",
        reason: "Starting home delivery service for retail clients",
      });
      assert.strictEqual(valid.success, true);

      const invalidAction = schema.safeParse({
        moduleKey: "deliveries",
        action: "destroy" as any,
        reason: "Starting home delivery service",
      });
      assert.strictEqual(invalidAction.success, false);
    });

    it("org_profile_change schema enforces Super-Admin-only allowed fields (A-04)", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.ORG_PROFILE_CHANGE];
      const valid = schema.safeParse({
        field: "financialYearStartMonth",
        proposedValue: 4,
        reason: "Statutory fiscal alignment with April financial year",
      });
      assert.strictEqual(valid.success, true);

      const disallowedField = schema.safeParse({
        field: "unauthorizedSecretField" as any,
        proposedValue: "value",
        reason: "Unauthorized modification attempt",
      });
      assert.strictEqual(disallowedField.success, false);
    });

    it("ownership_transfer schema requires newOwnerUserId or newOwnerEmail with reason", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.OWNERSHIP_TRANSFER];
      const valid = schema.safeParse({
        newOwnerUserId: "usr_new_owner_1",
        newOwnerEmail: "newowner@example.com",
        reason: "Business restructuring and owner transfer",
      });
      assert.strictEqual(valid.success, true);

      const neitherProvided = schema.safeParse({
        reason: "Business restructuring and owner transfer",
      });
      assert.strictEqual(neitherProvided.success, false, "Must provide user or email");
    });

    it("bug_report schema supports opt-in diagnostics without PII (A-15)", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.BUG_REPORT];
      const validWithDiag = schema.safeParse({
        area: "pos_billing",
        stepsToReproduce: "1. Click checkout\n2. Select UPI",
        expected: "QR code displays properly",
        actual: "Screen remains white",
        severity: RequestSeverity.MAJOR,
        diagnosticsOptIn: true,
        diagnostics: {
          appVersion: "1.2.0",
          platform: "android",
          route: "/pos/checkout",
        },
      });
      assert.strictEqual(validWithDiag.success, true);

      const validWithoutDiag = schema.safeParse({
        area: "pos_billing",
        stepsToReproduce: "1. Click checkout\n2. Select UPI",
        expected: "QR code displays properly",
        actual: "Screen remains white",
        severity: RequestSeverity.MINOR,
      });
      assert.strictEqual(validWithoutDiag.success, true);

      // Rejects diagnostics when diagnosticsOptIn is false (D-27, A-15)
      const unoptedDiagnostics = schema.safeParse({
        area: "pos_billing",
        stepsToReproduce: "1. Click checkout\n2. Select UPI",
        expected: "QR code displays properly",
        actual: "Screen remains white",
        severity: RequestSeverity.MINOR,
        diagnosticsOptIn: false,
        diagnostics: { appVersion: "1.2.0" },
      });
      assert.strictEqual(unoptedDiagnostics.success, false, "Diagnostics forbidden without explicit opt-in");
    });

    it("security_concern schema requires description with min length", () => {
      const schema = CATEGORY_DETAILS_SCHEMAS[RequestCategory.SECURITY_CONCERN];
      const valid = schema.safeParse({
        description: "Suspicious login attempt detected from an unrecognized external IP address",
        suspectedImpact: "Possible credential compromise on store manager account",
      });
      assert.strictEqual(valid.success, true);
    });

    it("validates remaining categories: data_request, access_request, billing_query, data_issue, feature_request, improvement, support_question, other", () => {
      const cases: [RequestCategory, Record<string, unknown>][] = [
        [RequestCategory.DATA_REQUEST, { type: "export", scope: "bills and invoices for 2025", reason: "Annual financial compliance audit" }],
        [RequestCategory.ACCESS_REQUEST, { roleId: "role_store_manager", reason: "Promoted to branch manager" }],
        [RequestCategory.BILLING_QUERY, { subject: "invoice", reference: "INV-2026-001", description: "Inquiry regarding tax line computation" }],
        [RequestCategory.DATA_ISSUE, { entityType: "products", whatIsWrong: "Duplicate barcode assigned", expected: "Unique barcodes" }],
        [RequestCategory.FEATURE_REQUEST, { problem: "Counter checkout takes too long", businessImpact: "Queue buildup during peak rush", area: "pos_billing" }],
        [RequestCategory.IMPROVEMENT, { area: "reports", currentBehaviour: "Summary shows only total", suggestedBehaviour: "Provide CSV export with item breakdown" }],
        [RequestCategory.SUPPORT_QUESTION, { topic: "how_to", question: "How to configure thermal receipt printer with ESC/POS?" }],
        [RequestCategory.OTHER, { detailsText: "General inquiry regarding franchise expansion opportunities" }],
      ];

      for (const [cat, payload] of cases) {
        const schema = CATEGORY_DETAILS_SCHEMAS[cat];
        assert.ok(schema, `Schema for ${cat} must exist`);
        const res = schema.safeParse(payload);
        assert.strictEqual(res.success, true, `Category ${cat} must accept valid payload: ${JSON.stringify(res.error?.issues)}`);
      }
    });

    it("attachment schema enforces size limit (5MB) and mime types (images + PDF) (A-11)", () => {
      const validPdf = RequestAttachmentSchema.safeParse({
        storagePath: "requests/req_1/invoice.pdf",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024 * 1024 * 2, // 2MB
      });
      assert.strictEqual(validPdf.success, true);

      const oversized = RequestAttachmentSchema.safeParse({
        storagePath: "requests/req_1/video.mp4",
        filename: "video.mp4",
        mimeType: "application/pdf",
        sizeBytes: 1024 * 1024 * 6, // 6MB (exceeds 5MB max)
      });
      assert.strictEqual(oversized.success, false, "Must reject > 5MB");

      const disallowedMime = RequestAttachmentSchema.safeParse({
        storagePath: "requests/req_1/script.sh",
        filename: "script.sh",
        mimeType: "application/x-sh" as any,
        sizeBytes: 100,
      });
      assert.strictEqual(disallowedMime.success, false, "Must reject disallowed mime type");
    });
  });

  describe("2. Deterministic SLA Clock & Deadlines (D-42)", () => {
    const fixedNow = new Date("2026-11-15T10:00:00.000Z");

    it("calculates exact SLA deadlines per priority level with default SLA", () => {
      const urgent = computeSlaDeadlines(RequestPriority.URGENT, fixedNow);
      assert.strictEqual(urgent.firstResponseDueAt, "2026-11-15T14:00:00.000Z");
      assert.strictEqual(urgent.resolutionDueAt, "2026-11-16T10:00:00.000Z");

      const high = computeSlaDeadlines(RequestPriority.HIGH, fixedNow);
      assert.strictEqual(high.firstResponseDueAt, "2026-11-15T18:00:00.000Z");
      assert.strictEqual(high.resolutionDueAt, "2026-11-18T10:00:00.000Z");

      const normal = computeSlaDeadlines(RequestPriority.NORMAL, fixedNow);
      assert.strictEqual(normal.firstResponseDueAt, "2026-11-16T10:00:00.000Z");
      assert.strictEqual(normal.resolutionDueAt, "2026-11-22T10:00:00.000Z");

      const low = computeSlaDeadlines(RequestPriority.LOW, fixedNow);
      assert.strictEqual(low.firstResponseDueAt, "2026-11-18T10:00:00.000Z");
      assert.strictEqual(low.resolutionDueAt, "2026-12-15T10:00:00.000Z");
    });

    it("calculates exact SLA deadlines with custom SLA configuration", () => {
      const customSla = {
        urgent: { firstResponseHours: 1, resolutionHours: 4 },
        high: { firstResponseHours: 4, resolutionHours: 8 },
        normal: { firstResponseHours: 8, resolutionHours: 24 },
        low: { firstResponseHours: 24, resolutionHours: 72 },
      };
      const urgent = computeSlaDeadlines(RequestPriority.URGENT, fixedNow, customSla);
      assert.strictEqual(urgent.firstResponseDueAt, "2026-11-15T11:00:00.000Z");
      assert.strictEqual(urgent.resolutionDueAt, "2026-11-15T14:00:00.000Z");
    });

    it("evaluateSlaState reports on_track, at_risk, and breached accurately", () => {
      const createdAt = "2026-11-15T10:00:00.000Z";
      const resolutionDueAt = "2026-11-15T14:00:00.000Z"; // 4 hour window
      const baseReq: Partial<RequestDoc> = {
        createdAt,
        resolutionDueAt,
        slaTotalPausedMs: 0,
        status: RequestStatus.IN_REVIEW,
      };

      // T+1h (25% elapsed) -> on_track
      const at1h = evaluateSlaState(baseReq as RequestDoc, new Date("2026-11-15T11:00:00.000Z"));
      assert.strictEqual(at1h, SlaState.ON_TRACK);

      // T+3.5h (87.5% elapsed >= 75%) -> at_risk
      const at3_5h = evaluateSlaState(baseReq as RequestDoc, new Date("2026-11-15T13:30:00.000Z"));
      assert.strictEqual(at3_5h, SlaState.AT_RISK);

      // T+4.1h (102.5% elapsed > 100%) -> breached
      const at4_1h = evaluateSlaState(baseReq as RequestDoc, new Date("2026-11-15T14:06:00.000Z"));
      assert.strictEqual(at4_1h, SlaState.BREACHED);
    });

    it("applySlaResume accumulates paused duration and resumes clock", () => {
      const pauseStarted = "2026-11-15T11:00:00.000Z";
      const resumeTime = new Date("2026-11-15T13:00:00.000Z"); // 2 hours paused = 7,200,000 ms

      const req: Partial<RequestDoc> = {
        slaPausedAt: pauseStarted,
        slaTotalPausedMs: 1000,
      };

      const resumed = applySlaResume(req as RequestDoc, resumeTime);
      assert.strictEqual(resumed.slaTotalPausedMs, 1000 + (2 * 3600 * 1000));
    });

    it("default priorities are assigned deterministically", () => {
      assert.strictEqual(calculateDefaultPriority(RequestCategory.SECURITY_CONCERN), RequestPriority.URGENT);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.OWNERSHIP_TRANSFER), RequestPriority.HIGH);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.DATA_REQUEST), RequestPriority.HIGH);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.FEATURE_REQUEST), RequestPriority.LOW);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.IMPROVEMENT), RequestPriority.LOW);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.BUG_REPORT, RequestSeverity.CRITICAL), RequestPriority.URGENT);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.BUG_REPORT, RequestSeverity.MAJOR), RequestPriority.HIGH);
      assert.strictEqual(calculateDefaultPriority(RequestCategory.BUG_REPORT, RequestSeverity.MINOR), RequestPriority.NORMAL);
    });

    it("category taxonomy correctly partitions approval vs work kinds and audiences", () => {
      assert.strictEqual(getCategoryKind(RequestCategory.PLAN_CHANGE), "approval");
      assert.strictEqual(getCategoryKind(RequestCategory.BUG_REPORT), "work");
      assert.strictEqual(getCategoryAudience(RequestCategory.ACCESS_REQUEST), "organization");
      assert.strictEqual(getCategoryAudience(RequestCategory.PLAN_CHANGE), "platform");
    });
  });
});
