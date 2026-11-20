/**
 * Organization Subscription Evaluation
 *
 * Subscriptions are stored per organization (never per plan):
 *   subscriptionStatus, subscriptionStartsAt, subscriptionExpiresAt, graceDays, timezone.
 * All evaluation uses server time only. Expiry is a precise instant: the end of the expiry
 * date (23:59:59.999) in the organization's IANA timezone.
 */

import { GateReason, SubscriptionStatus } from "../constants/enums.js";
import type { OrganizationDoc } from "../types/models.js";

export const DEFAULT_ORG_TIMEZONE = "UTC";
export const DEFAULT_TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionState = SubscriptionStatus | "legacy_unset";

export interface SubscriptionEvaluation {
  allowed: boolean;
  state: SubscriptionState;
  reason?: GateReason;
  expiresAt?: string | null;
  graceEndsAt?: string | null;
  daysRemaining?: number | null;
}

/** Offset (ms) of `timeZone` from UTC at instant `utcMs` (positive east of UTC). */
function timezoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Returns the ISO instant of the end (23:59:59.999) of calendar date `ymd` (YYYY-MM-DD)
 * in `timeZone`.
 */
export function endOfDayInTimezone(ymd: string, timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const nextLocalMidnightAsUtc = Date.UTC(y, m - 1, d + 1);
  const offset = timezoneOffsetMs(nextLocalMidnightAsUtc, timeZone);
  return new Date(nextLocalMidnightAsUtc - offset - 1).toISOString();
}

/** Calendar date (YYYY-MM-DD) of `utcMs` in `timeZone`. */
export function localDateInTimezone(utcMs: number, timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(utcMs));
}

/** Adds `days` calendar days to a YYYY-MM-DD date. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Builds the subscription fields for a new or renewed organization subscription.
 * `expiresOn` is a calendar date (YYYY-MM-DD) in the organization's timezone.
 */
export function buildSubscriptionFields(params: {
  status?: SubscriptionStatus;
  startsAt?: string;
  expiresOn?: string;
  durationDays?: number;
  graceDays?: number;
  timezone?: string;
  nowMs?: number;
}): Pick<OrganizationDoc, "subscriptionStatus" | "subscriptionStartsAt" | "subscriptionExpiresAt" | "graceDays" | "timezone"> {
  const nowMs = params.nowMs ?? Date.now();
  const timezone = params.timezone || DEFAULT_ORG_TIMEZONE;
  const startsAt = params.startsAt || new Date(nowMs).toISOString();
  const expiresOn = params.expiresOn ||
    addDaysYmd(localDateInTimezone(Date.parse(startsAt), timezone), params.durationDays ?? DEFAULT_TRIAL_DAYS);
  return {
    subscriptionStatus: params.status || SubscriptionStatus.TRIAL,
    subscriptionStartsAt: startsAt,
    subscriptionExpiresAt: endOfDayInTimezone(expiresOn, timezone),
    graceDays: params.graceDays ?? 0,
    timezone,
  };
}

/**
 * Evaluates whether the organization's subscription currently permits tenant operations.
 * Organizations provisioned before subscriptions existed (no fields) are treated as
 * `legacy_unset` and allowed, so existing tenants are not locked out by the migration.
 */
export function evaluateSubscription(org: Partial<OrganizationDoc>, nowMs: number = Date.now()): SubscriptionEvaluation {
  const status = org.subscriptionStatus;
  const expiresAt = org.subscriptionExpiresAt || null;

  if (!status && !expiresAt) {
    return { allowed: true, state: "legacy_unset", expiresAt: null, graceEndsAt: null, daysRemaining: null };
  }

  if (status === SubscriptionStatus.SUSPENDED) {
    return { allowed: false, state: SubscriptionStatus.SUSPENDED, reason: GateReason.SUBSCRIPTION_SUSPENDED, expiresAt };
  }
  if (status === SubscriptionStatus.CANCELLED) {
    return { allowed: false, state: SubscriptionStatus.CANCELLED, reason: GateReason.SUBSCRIPTION_CANCELLED, expiresAt };
  }
  if (org.subscriptionStartsAt && Date.parse(org.subscriptionStartsAt) > nowMs) {
    return { allowed: false, state: status || SubscriptionStatus.ACTIVE, reason: GateReason.SUBSCRIPTION_NOT_STARTED, expiresAt };
  }

  const expiryMs = expiresAt ? Date.parse(expiresAt) : Number.POSITIVE_INFINITY;
  const graceEndMs = expiryMs + (org.graceDays || 0) * DAY_MS;
  const graceEndsAt = Number.isFinite(graceEndMs) ? new Date(graceEndMs).toISOString() : null;
  const daysRemaining = Number.isFinite(expiryMs) ? Math.floor((expiryMs - nowMs) / DAY_MS) : null;

  if (status === SubscriptionStatus.EXPIRED || nowMs > graceEndMs) {
    return { allowed: false, state: SubscriptionStatus.EXPIRED, reason: GateReason.SUBSCRIPTION_EXPIRED, expiresAt, graceEndsAt, daysRemaining };
  }
  if (nowMs > expiryMs) {
    return { allowed: true, state: SubscriptionStatus.GRACE, expiresAt, graceEndsAt, daysRemaining };
  }
  return { allowed: true, state: status || SubscriptionStatus.ACTIVE, expiresAt, graceEndsAt, daysRemaining };
}
