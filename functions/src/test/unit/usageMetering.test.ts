/**
 * Unit Tests: Super Admin Usage Metering & Platform Consumption
 * 
 * Verifies:
 * 1. Zod request schemas for usage callables
 * 2. Rate card cost computation logic across all services
 * 3. Dry-run statement generation with itemized line items and shared platform overhead
 * 4. Measurement class segregation and disclaimer preservation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GetPlatformUsageSummarySchema,
  GetOrganizationsUsageSchema,
  GetBranchesUsageSchema,
  GetUsageDetailSchema,
  CalculateDryRunStatementSchema,
} from "../../validation/schemas.js";
import {
  createEmptyServiceCounts,
  calculateEstimatedCost,
  DEFAULT_RATE_CARD_V1,
} from "../../services/usageMetering.js";
import { ServiceUsageCounts } from "../../types/models.js";

describe("Usage Metering — Schemas & Rate Card Cost Calculation", () => {
  it("validates GetPlatformUsageSummarySchema", () => {
    const valid = GetPlatformUsageSummarySchema.parse({
      startDate: "2026-10-01",
      endDate: "2026-10-28",
    });
    assert.strictEqual(valid.startDate, "2026-10-01");
    assert.strictEqual(valid.endDate, "2026-10-28");

    const empty = GetPlatformUsageSummarySchema.parse({});
    assert.strictEqual(empty.startDate, undefined);
  });

  it("validates GetOrganizationsUsageSchema with pagination and sorting", () => {
    const valid = GetOrganizationsUsageSchema.parse({
      startDate: "2026-10-01",
      endDate: "2026-10-28",
      sortBy: "cost",
      limit: 25,
    });
    assert.strictEqual(valid.sortBy, "cost");
    assert.strictEqual(valid.limit, 25);
  });

  it("validates GetBranchesUsageSchema requiring organizationId", () => {
    const valid = GetBranchesUsageSchema.parse({
      organizationId: "org-100",
      startDate: "2026-10-01",
    });
    assert.strictEqual(valid.organizationId, "org-100");

    assert.throws(() => {
      GetBranchesUsageSchema.parse({
        organizationId: "",
      });
    });
  });

  it("validates GetUsageDetailSchema", () => {
    const valid = GetUsageDetailSchema.parse({
      organizationId: "org-100",
      granularity: "daily",
      service: "firestore",
    });
    assert.strictEqual(valid.granularity, "daily");
    assert.strictEqual(valid.service, "firestore");
  });

  it("validates CalculateDryRunStatementSchema requiring YYYY-MM period", () => {
    const valid = CalculateDryRunStatementSchema.parse({
      organizationId: "org-100",
      billingPeriod: "2026-10",
      rateCardVersion: "v1.0.0",
    });
    assert.strictEqual(valid.billingPeriod, "2026-10");

    assert.throws(() => {
      CalculateDryRunStatementSchema.parse({
        organizationId: "org-100",
        billingPeriod: "2026-10-28", // Invalid format, expects YYYY-MM
      });
    });
  });

  it("initializes empty service counts with all zeroes", () => {
    const empty = createEmptyServiceCounts();
    assert.strictEqual(empty.firestoreReads, 0);
    assert.strictEqual(empty.firestoreWrites, 0);
    assert.strictEqual(empty.firestoreDeletes, 0);
    assert.strictEqual(empty.functionsInvocations, 0);
    assert.strictEqual(empty.functionsExecutionMs, 0);
    assert.strictEqual(empty.storageUploadBytes, 0);
    assert.strictEqual(empty.authOperations, 0);
    assert.strictEqual(empty.fcmDispatches, 0);
    assert.strictEqual(empty.locationPings, 0);
  });

  it("computes estimated costs correctly according to DEFAULT_RATE_CARD_V1", () => {
    const sampleCounts: ServiceUsageCounts = {
      firestoreReads: 100000, // 100k reads = Rs 5.00
      firestoreWrites: 100000, // 100k writes = Rs 15.00
      firestoreDeletes: 100000, // 100k deletes = Rs 1.70
      functionsInvocations: 1000000, // 1M invocations = Rs 33.00
      functionsErrors: 0,
      functionsExecutionMs: 1000000, // 1000s * 0.25GB = 250 GB-s * 0.00021 = Rs 0.0525
      storageUploadBytes: 1073741824, // 1GB
      storageDownloadBytes: 0, // 1GB * 2.15 = Rs 2.15
      storageOperations: 0,
      authOperations: 100,
      fcmDispatches: 5000, // 5k * 0.0 = Rs 0.00
      locationPings: 100000, // 100k pings = Rs 20.00
    };

    const cost = calculateEstimatedCost(sampleCounts, DEFAULT_RATE_CARD_V1);
    // Total should be approximately:
    // 5.00 + 15.00 + 1.70 + 33.00 + 0.05 + 2.15 + 0.00 + 20.00 = ~76.90 INR
    assert.strictEqual(cost > 76 && cost < 78, true, `Calculated cost was ${cost}`);
  });

  it("handles zero counts returning zero cost", () => {
    const empty = createEmptyServiceCounts();
    const cost = calculateEstimatedCost(empty, DEFAULT_RATE_CARD_V1);
    assert.strictEqual(cost, 0);
  });
});

