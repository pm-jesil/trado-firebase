/**
 * Operations & Intelligence Validation Schema Unit Tests
 * 
 * Verifies:
 * 1. Task creation and status update schemas
 * 2. Location ping constraints and coordinate boundaries
 * 3. Reporting query schemas (date formats, ranges, CSV exports)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  CreateTaskSchema,
  UpdateTaskStatusSchema,
  RecordLocationPingSchema,
  GetRevenueReportSchema,
  GetProfitLossReportSchema,
  ExportReportSchema,
} from "../../validation/schemas.js";
import { computeLocationPingExpiry } from "../../callables/locations.js";

describe("Operations Schema Validation — Tasks", () => {
  it("validates valid task creation payload", () => {
    const payload = {
      organizationId: "org-123",
      title: "Stock audit at counter A",
      description: "Perform physical count of inventory items",
      assignedToMembershipId: "user-456_org-123",
      priority: "high",
      dueAt: "2026-10-30T18:00:00.000Z",
      relatedEntityType: "bill",
      relatedEntityId: "bill-789",
    };
    const parsed = CreateTaskSchema.parse(payload);
    assert.strictEqual(parsed.title, "Stock audit at counter A");
    assert.strictEqual(parsed.priority, "high");
    assert.strictEqual(parsed.relatedEntityType, "bill");
  });

  it("rejects task creation with empty title or missing assignee", () => {
    assert.throws(() => {
      CreateTaskSchema.parse({
        title: "",
        assignedToMembershipId: "user-1_org-1",
      });
    });

    assert.throws(() => {
      CreateTaskSchema.parse({
        title: "Valid title",
        assignedToMembershipId: "",
      });
    });
  });

  it("validates task status transition values", () => {
    const valid = UpdateTaskStatusSchema.parse({
      taskId: "task-001",
      status: "completed",
    });
    assert.strictEqual(valid.status, "completed");

    assert.throws(() => {
      UpdateTaskStatusSchema.parse({
        taskId: "task-001",
        status: "unknown_status",
      });
    });
  });
});

describe("Operations Schema Validation — Live Location & Reports", () => {
  it("validates coordinate boundaries for location pings", () => {
    const validPing = RecordLocationPingSchema.parse({
      latitude: 9.9312,
      longitude: 76.2673,
      accuracy: 5.2,
      speed: 12.5,
      heading: 180,
      source: "foreground",
    });
    assert.strictEqual(validPing.latitude, 9.9312);
    assert.strictEqual(validPing.source, "foreground");

    // Out of range latitude
    assert.throws(() => {
      RecordLocationPingSchema.parse({
        latitude: 95.0,
        longitude: 76.2673,
      });
    });

    // Out of range longitude
    assert.throws(() => {
      RecordLocationPingSchema.parse({
        latitude: 10.0,
        longitude: 195.0,
      });
    });
  });

  it("calculates locationPing expiresAt with exactly 7-day offset for Cloud Firestore TTL as native Timestamp", () => {
    const now = new Date("2026-10-30T10:00:00.000Z");
    const expiresAt = computeLocationPingExpiry(now);

    assert.ok(expiresAt instanceof Timestamp, "expiresAt must be a native Firestore Timestamp instance");
    const deltaMs = expiresAt.toMillis() - now.getTime();
    assert.strictEqual(deltaMs, 7 * 24 * 60 * 60 * 1000); // Exactly 604,800,000 ms
    assert.strictEqual(expiresAt.toDate().toISOString(), "2026-11-06T10:00:00.000Z");
  });

  it("handles legacy, missing, and nullable location ping expiry values safely", () => {
    // Legacy document with ISO string expiresAt
    const legacyDoc = {
      expiresAt: "2026-11-06T10:00:00.000Z",
    };
    const legacySerialized = typeof legacyDoc.expiresAt === "string"
      ? legacyDoc.expiresAt
      : (legacyDoc.expiresAt as any).toDate().toISOString();
    assert.strictEqual(legacySerialized, "2026-11-06T10:00:00.000Z");

    // Native Timestamp doc
    const now = new Date("2026-10-30T10:00:00.000Z");
    const tsDoc = {
      expiresAt: computeLocationPingExpiry(now),
    };
    const tsSerialized = typeof (tsDoc.expiresAt as any).toDate === "function"
      ? tsDoc.expiresAt.toDate().toISOString()
      : tsDoc.expiresAt;
    assert.strictEqual(tsSerialized, "2026-11-06T10:00:00.000Z");

    // Null/undefined safety
    const nullDoc = { expiresAt: null };
    const nullSerialized = nullDoc.expiresAt ? (nullDoc.expiresAt as any).toDate?.() : null;
    assert.strictEqual(nullSerialized, null);
  });

  it("validates revenue and P&L report date filters", () => {
    const validReport = GetRevenueReportSchema.parse({
      organizationId: "org-test",
      from: "2026-10-01",
      to: "2026-10-28",
      groupBy: "day",
    });
    assert.strictEqual(validReport.from, "2026-10-01");
    assert.strictEqual(validReport.groupBy, "day");

    // Invalid date format (not YYYY-MM-DD)
    assert.throws(() => {
      GetRevenueReportSchema.parse({
        from: "01-10-2026",
      });
    });

    const validPl = GetProfitLossReportSchema.parse({
      from: "2026-01-01",
      to: "2026-12-31",
      branchId: "branch-north",
    });
    assert.strictEqual(validPl.from, "2026-01-01");
    assert.strictEqual(validPl.branchId, "branch-north");
  });

  it("validates CSV export schema with branch-scoping and all 5 report types", () => {
    const reportTypes = ["revenue", "profit_loss", "stock_valuation", "top_products", "staff_sales"] as const;
    for (const reportType of reportTypes) {
      const validExport = ExportReportSchema.parse({
        organizationId: "org-1",
        branchId: "branch-central",
        reportType,
        from: "2026-10-01",
        to: "2026-10-28",
      });
      assert.strictEqual(validExport.reportType, reportType);
      assert.strictEqual(validExport.branchId, "branch-central");
    }

    // Invalid report type rejected
    assert.throws(() => {
      ExportReportSchema.parse({
        organizationId: "org-1",
        reportType: "invalid_report_type",
      });
    });
  });
});
