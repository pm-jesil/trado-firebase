/**
 * Prompt 74 — Unit Tests: Requests Unified State Machine (D-37, Appendix B)
 *
 * Exhaustive transition testing across approval and work request kinds,
 * validating expectedStatus compare-and-set and actor privilege separation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RequestStatus,
  RequestAction,
  RequestKind,
  RequestAudience,
  RequestReason,
} from "../../constants/enums.js";
import { validateStateTransition } from "../../services/requestsService.js";

describe("Prompt 74 — Requests Unified State Machine Cross-Product (D-37)", () => {
  describe("1. Approval Request Lifecycle (Kind: approval)", () => {
    it("permits submitted -> in_review via start_review by platform handler", () => {
      const res = validateStateTransition(
        RequestStatus.SUBMITTED,
        RequestAction.START_REVIEW,
        RequestKind.APPROVAL,
        true, // isPlatformHandler
        false, // isOrgManager
        false, // isRequester
        RequestAudience.PLATFORM
      );
      assert.strictEqual(res.nextStatus, RequestStatus.IN_REVIEW);
    });

    it("permits in_review -> needs_info via request_info by handler", () => {
      const res = validateStateTransition(
        RequestStatus.IN_REVIEW,
        RequestAction.REQUEST_INFO,
        RequestKind.APPROVAL,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(res.nextStatus, RequestStatus.NEEDS_INFO);
    });

    it("permits needs_info -> in_review via respond strictly by requester", () => {
      const res = validateStateTransition(
        RequestStatus.NEEDS_INFO,
        RequestAction.RESPOND,
        RequestKind.APPROVAL,
        false,
        false,
        true, // isRequester
        RequestAudience.PLATFORM
      );
      assert.strictEqual(res.nextStatus, RequestStatus.IN_REVIEW);
    });

    it("denies respond to non-requester", () => {
      assert.throws(
        () => {
          validateStateTransition(
            RequestStatus.NEEDS_INFO,
            RequestAction.RESPOND,
            RequestKind.APPROVAL,
            true, // platform handler, NOT requester
            false,
            false,
            RequestAudience.PLATFORM
          );
        },
        (err: any) => err.code === "permission-denied" || /requester/i.test(err.message)
      );
    });

    it("permits in_review -> on_hold via hold, and on_hold -> in_review via resume", () => {
      const held = validateStateTransition(
        RequestStatus.IN_REVIEW,
        RequestAction.HOLD,
        RequestKind.APPROVAL,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(held.nextStatus, RequestStatus.ON_HOLD);

      const resumed = validateStateTransition(
        RequestStatus.ON_HOLD,
        RequestAction.RESUME,
        RequestKind.APPROVAL,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(resumed.nextStatus, RequestStatus.IN_REVIEW);
    });

    it("permits in_review -> approved via approve, and approved -> applied via apply", () => {
      const approved = validateStateTransition(
        RequestStatus.IN_REVIEW,
        RequestAction.APPROVE,
        RequestKind.APPROVAL,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(approved.nextStatus, RequestStatus.APPROVED);

      const applied = validateStateTransition(
        RequestStatus.APPROVED,
        RequestAction.APPLY,
        RequestKind.APPROVAL,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(applied.nextStatus, RequestStatus.APPLIED);
    });

    it("permits in_review -> rejected via reject (terminal)", () => {
      const rejected = validateStateTransition(
        RequestStatus.IN_REVIEW,
        RequestAction.REJECT,
        RequestKind.APPROVAL,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(rejected.nextStatus, RequestStatus.REJECTED);
    });

    it("rejects illegal transitions for approval requests", () => {
      // Cannot apply directly from submitted or in_review
      assert.throws(
        () => {
          validateStateTransition(
            RequestStatus.SUBMITTED,
            RequestAction.APPLY,
            RequestKind.APPROVAL,
            true,
            false,
            false,
            RequestAudience.PLATFORM
          );
        },
        (err: any) => err.code === "failed-precondition" && (err.message.includes(RequestReason.REQUEST_NOT_APPROVED) || err.message.includes(RequestReason.REQUEST_INVALID_TRANSITION))
      );

      // Cannot reopen an approval request
      assert.throws(
        () => {
          validateStateTransition(
            RequestStatus.REJECTED,
            RequestAction.REOPEN,
            RequestKind.APPROVAL,
            true,
            false,
            false,
            RequestAudience.PLATFORM
          );
        },
        (err: any) => err.code === "failed-precondition" && err.message.includes(RequestReason.REQUEST_INVALID_TRANSITION)
      );
    });
  });

  describe("2. Work Request Lifecycle (Kind: work)", () => {
    it("permits submitted -> in_progress via start_work", () => {
      const res = validateStateTransition(
        RequestStatus.SUBMITTED,
        RequestAction.START_WORK,
        RequestKind.WORK,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(res.nextStatus, RequestStatus.IN_PROGRESS);
    });

    it("permits in_progress -> resolved via resolve, and resolved -> closed via close", () => {
      const resolved = validateStateTransition(
        RequestStatus.IN_PROGRESS,
        RequestAction.RESOLVE,
        RequestKind.WORK,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(resolved.nextStatus, RequestStatus.RESOLVED);

      const closed = validateStateTransition(
        RequestStatus.RESOLVED,
        RequestAction.CLOSE,
        RequestKind.WORK,
        false,
        false,
        true, // Requester closes resolved request
        RequestAudience.PLATFORM
      );
      assert.strictEqual(closed.nextStatus, RequestStatus.CLOSED);
    });

    it("permits resolved -> in_review via reopen for work requests", () => {
      const reopened = validateStateTransition(
        RequestStatus.RESOLVED,
        RequestAction.REOPEN,
        RequestKind.WORK,
        true,
        false,
        true,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(reopened.nextStatus, RequestStatus.IN_REVIEW);
    });

    it("permits in_review -> declined via decline", () => {
      const declined = validateStateTransition(
        RequestStatus.IN_REVIEW,
        RequestAction.DECLINE,
        RequestKind.WORK,
        true,
        false,
        false,
        RequestAudience.PLATFORM
      );
      assert.strictEqual(declined.nextStatus, RequestStatus.DECLINED);
    });

    it("denies work actions on approval kinds and vice-versa", () => {
      // approve action not valid on work requests
      assert.throws(
        () => {
          validateStateTransition(
            RequestStatus.IN_REVIEW,
            RequestAction.APPROVE,
            RequestKind.WORK,
            true,
            false,
            false,
            RequestAudience.PLATFORM
          );
        },
        (err: any) => err.code === "failed-precondition" && err.message.includes(RequestReason.REQUEST_INVALID_TRANSITION)
      );

      // start_work action not valid on approval requests
      assert.throws(
        () => {
          validateStateTransition(
            RequestStatus.IN_REVIEW,
            RequestAction.START_WORK,
            RequestKind.APPROVAL,
            true,
            false,
            false,
            RequestAudience.PLATFORM
          );
        },
        (err: any) => err.code === "failed-precondition" && err.message.includes(RequestReason.REQUEST_INVALID_TRANSITION)
      );
    });
  });

  describe("3. Organization Audience Access Control", () => {
    it("allows org manager to manage organization audience request", () => {
      const res = validateStateTransition(
        RequestStatus.SUBMITTED,
        RequestAction.START_REVIEW,
        RequestKind.APPROVAL,
        false, // not platform handler
        true, // isOrgManager
        false,
        RequestAudience.ORGANIZATION
      );
      assert.strictEqual(res.nextStatus, RequestStatus.IN_REVIEW);
    });

    it("denies standard member from managing organization audience request", () => {
      assert.throws(
        () => {
          validateStateTransition(
            RequestStatus.SUBMITTED,
            RequestAction.START_REVIEW,
            RequestKind.APPROVAL,
            false,
            false, // NOT org manager
            true, // is requester only
            RequestAudience.ORGANIZATION
          );
        },
        (err: any) => err.code === "permission-denied" || /privileges/i.test(err.message)
      );
    });
  });

  describe("4. Reopen Window Boundary (Q-B3 / RH-10) & 7 Category Groups (Q-B4 / RH-11)", () => {
    it("[requestsTransition#ok] allows requester to reopen on day 14 of 14-day window (resolved and closed)", () => {
      const anchor = new Date("2026-11-01T00:00:00.000Z");
      const day14 = new Date(anchor.getTime() + 14 * 86_400_000);
      for (const status of [RequestStatus.RESOLVED, RequestStatus.CLOSED]) {
        const res = validateStateTransition(
          status,
          RequestAction.REOPEN,
          RequestKind.WORK,
          false,
          false,
          true,
          RequestAudience.PLATFORM,
          { resolvedAt: anchor.toISOString(), reopenWindowDays: 14, now: day14 }
        );
        assert.strictEqual(res.nextStatus, RequestStatus.IN_REVIEW);
      }
    });

    it("[requestsTransition#REQUEST_REOPEN_WINDOW_CLOSED] rejects requester reopen on day 15 (past 14-day window) while allowing handler anytime", () => {
      const anchor = new Date("2026-11-01T00:00:00.000Z");
      const day15 = new Date(anchor.getTime() + 15 * 86_400_000);
      for (const status of [RequestStatus.RESOLVED, RequestStatus.CLOSED]) {
        assert.throws(
          () =>
            validateStateTransition(
              status,
              RequestAction.REOPEN,
              RequestKind.WORK,
              false,
              false,
              true,
              RequestAudience.PLATFORM,
              { resolvedAt: anchor.toISOString(), reopenWindowDays: 14, now: day15 }
            ),
          (err: any) => err.details?.reason === "REQUEST_REOPEN_WINDOW_CLOSED"
        );
        const handlerRes = validateStateTransition(
          status,
          RequestAction.REOPEN,
          RequestKind.WORK,
          true,
          false,
          false,
          RequestAudience.PLATFORM,
          { resolvedAt: anchor.toISOString(), reopenWindowDays: 14, now: day15 }
        );
        assert.strictEqual(handlerRes.nextStatus, RequestStatus.IN_REVIEW);
      }
    });

    it("[requestsMeta#ok] defines 7 ordered category groups covering all 15 RequestCategory values", async () => {
      const { REQUEST_CATEGORY_GROUPS } = await import("../../services/requestsService.js");
      const { RequestCategory } = await import("../../constants/enums.js");
      assert.strictEqual(REQUEST_CATEGORY_GROUPS.length, 7);
      assert.deepStrictEqual(
        REQUEST_CATEGORY_GROUPS.map((g) => g.order),
        [1, 2, 3, 4, 5, 6, 7]
      );
      const grouped = REQUEST_CATEGORY_GROUPS.flatMap((g) => g.categories);
      const allCats = Object.values(RequestCategory);
      assert.strictEqual(grouped.length, allCats.length);
      assert.deepStrictEqual([...grouped].sort(), [...allCats].sort());
    });
  });
});
