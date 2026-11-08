/**
 * Unit tests: subscription expiry boundaries, timezone end-of-day, ISO-week usage windows,
 * usage-limit evaluation, gate read-only classification.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  endOfDayInTimezone,
  evaluateSubscription,
  buildSubscriptionFields,
  localDateInTimezone,
} from "../../services/subscription.js";
import { usagePeriodKeys, evaluateUsageLimits } from "../../services/usageMetering.js";
import { effectiveBusinessConfig } from "../../constants/businessDefaults.js";
import { BusinessType } from "../../constants/enums.js";
import { isReadOnlyPermission } from "../../services/contextResolver.js";
import { getModuleForPermission } from "../../services/permissionResolver.js";
import { SubscriptionStatus, GateReason } from "../../constants/enums.js";

describe("Subscription expiry", () => {
  const expiresAt = endOfDayInTimezone("2026-12-31", "Asia/Kolkata");

  it("expiry is the end of the date in the organization timezone", () => {
    assert.equal(expiresAt, "2026-12-31T18:29:59.999Z");
    assert.equal(endOfDayInTimezone("2026-12-31", "UTC"), "2026-12-31T23:59:59.999Z");
    assert.equal(endOfDayInTimezone("2026-07-01", "America/New_York"), "2026-07-02T03:59:59.999Z");
  });

  it("allows one second before expiry and denies one second after (no grace)", () => {
    const org = { subscriptionStatus: SubscriptionStatus.ACTIVE, subscriptionExpiresAt: expiresAt, graceDays: 0 };
    assert.equal(evaluateSubscription(org, Date.parse(expiresAt) - 1000).allowed, true);
    const after = evaluateSubscription(org, Date.parse(expiresAt) + 1000);
    assert.equal(after.allowed, false);
    assert.equal(after.reason, GateReason.SUBSCRIPTION_EXPIRED);
  });

  it("grace days keep the tenant operating in state=grace, then expire", () => {
    const org = { subscriptionStatus: SubscriptionStatus.ACTIVE, subscriptionExpiresAt: expiresAt, graceDays: 3 };
    const inGrace = evaluateSubscription(org, Date.parse(expiresAt) + 2 * 86_400_000);
    assert.equal(inGrace.allowed, true);
    assert.equal(inGrace.state, SubscriptionStatus.GRACE);
    assert.equal(evaluateSubscription(org, Date.parse(expiresAt) + 3 * 86_400_000 + 1000).allowed, false);
  });

  it("suspended, cancelled and not-yet-started are distinct denials; legacy orgs are allowed", () => {
    assert.equal(evaluateSubscription({ subscriptionStatus: SubscriptionStatus.SUSPENDED, subscriptionExpiresAt: expiresAt }).reason, GateReason.SUBSCRIPTION_SUSPENDED);
    assert.equal(evaluateSubscription({ subscriptionStatus: SubscriptionStatus.CANCELLED, subscriptionExpiresAt: expiresAt }).reason, GateReason.SUBSCRIPTION_CANCELLED);
    assert.equal(evaluateSubscription({ subscriptionStatus: SubscriptionStatus.ACTIVE, subscriptionStartsAt: "2999-01-01T00:00:00Z", subscriptionExpiresAt: "2999-12-31T00:00:00Z" }).reason, GateReason.SUBSCRIPTION_NOT_STARTED);
    assert.equal(evaluateSubscription({}).state, "legacy_unset");
    assert.equal(evaluateSubscription({}).allowed, true);
  });

  it("default subscription is a 30-day trial ending at local end of day", () => {
    const now = Date.parse("2026-11-07T20:00:00Z"); // 2026-11-08 01:30 IST
    const f = buildSubscriptionFields({ nowMs: now });
    assert.equal(f.subscriptionStatus, SubscriptionStatus.TRIAL);
    assert.equal(localDateInTimezone(now, "Asia/Kolkata"), "2026-11-08");
    assert.equal(f.subscriptionExpiresAt, endOfDayInTimezone("2026-12-08", "Asia/Kolkata"));
  });
});

describe("Usage windows & limits", () => {
  it("ISO week starts Monday in the organization timezone", () => {
    const k = usagePeriodKeys(Date.parse("2026-11-08T20:00:00Z"), "Asia/Kolkata"); // Mon 9 Nov 01:30 IST
    assert.equal(k.day, "2026-11-09");
    assert.equal(k.weekDays[0], "2026-11-09");
    assert.equal(k.weekDays[6], "2026-11-15");
    assert.equal(k.week, "2026-W46");
    const utc = usagePeriodKeys(Date.parse("2026-11-08T20:00:00Z"), "UTC"); // still Sunday in UTC
    assert.equal(utc.weekDays[0], "2026-11-02");
  });

  it("weeks spanning a month boundary list days of both months", () => {
    const k = usagePeriodKeys(Date.parse("2026-12-01T06:00:00Z"), "UTC");
    assert.ok(k.weekDays.includes("2026-11-30") && k.weekDays.includes("2026-12-06"));
  });

  it("hard_block breaches only at/above the hard threshold; warn_only never blocks", () => {
    const snap = { daily: { firestoreWrites: 10 }, weekly: { firestoreWrites: 100 }, monthly: { firestoreWrites: 100 } };
    const v = evaluateUsageLimits({
      firestoreWrites: { weeklyLimit: 100, warningThresholdPercent: 80, hardThresholdPercent: 100, enforcementMode: "hard_block", enabled: true },
      firestoreReads: { dailyLimit: 1, warningThresholdPercent: 80, hardThresholdPercent: 100, enforcementMode: "warn_only", enabled: true },
    }, snap);
    assert.equal(v.blocked, true);
    assert.deepEqual(v.breaches.map((b) => `${b.metric}:${b.period}`), ["firestoreWrites:weekly"]);
    const under = evaluateUsageLimits({ firestoreWrites: { weeklyLimit: 101, warningThresholdPercent: 80, hardThresholdPercent: 100, enforcementMode: "hard_block", enabled: true } }, snap);
    assert.equal(under.blocked, false);
    assert.equal(under.nearLimit, true);
    assert.equal(under.warnings.length, 1);
  });

  it("admission counts the current call: usage equal to the limit is admitted, limit + 1 is refused", () => {
    const limits = { firestoreWrites: { weeklyLimit: 5, warningThresholdPercent: 80, hardThresholdPercent: 100, enforcementMode: "hard_block" as const, enabled: true } };
    const at = (n: number) => ({ daily: { firestoreWrites: n }, weekly: { firestoreWrites: n }, monthly: { firestoreWrites: n } });
    assert.equal(evaluateUsageLimits(limits, at(5), true).blocked, false, "5th call of 5 must be admitted");
    assert.equal(evaluateUsageLimits(limits, at(6), true).blocked, true, "6th call of 5 must be refused");
    assert.equal(evaluateUsageLimits(limits, at(5)).blocked, true, "status view: 5 of 5 used means blocked");
  });
});

describe("Gate classification", () => {
  it("read-only permissions are recognised for Super Admin support access", () => {
    assert.equal(isReadOnlyPermission("report:profit"), true);
    assert.equal(isReadOnlyPermission("bill:view_all"), true);
    assert.equal(isReadOnlyPermission("bill:create"), false);
    assert.equal(isReadOnlyPermission("stock:adjust"), false);
  });

  it("delivery, returns, tasks and location are separately plan-gated modules", () => {
    assert.equal(getModuleForPermission("delivery:update"), "delivery");
    assert.equal(getModuleForPermission("return:create"), "returns");
    assert.equal(getModuleForPermission("task:view"), "tasks");
    assert.equal(getModuleForPermission("location:ping"), "employee_tracking");
    assert.equal(getModuleForPermission("bill:create"), "billing");
  });
});

describe("Business-type defaults (override ?? default, never copied)", () => {
  it("service businesses default inventory off; an organization override wins; units/fields resolve the same way", () => {
    const service = effectiveBusinessConfig({ businessType: BusinessType.SERVICE });
    assert.equal(service.modules.inventory, false);
    assert.deepEqual(service.defaultUnits, ["hour", "job"]);
    const overridden = effectiveBusinessConfig({ businessType: BusinessType.SERVICE, moduleToggles: { inventory: true }, settings: { businessConfig: { defaultUnits: ["visit"], productFields: { serial: true } } } });
    assert.equal(overridden.modules.inventory, true);
    assert.deepEqual(overridden.defaultUnits, ["visit"]);
    assert.equal(overridden.productFields.serial, true);
    assert.equal(overridden.productFields.batch, false, "non-overridden field keeps the default");
    assert.equal(effectiveBusinessConfig({ businessType: BusinessType.WHOLESALE_ONLY }).productFields.alternateUnits, true);
  });
});
