/**
 * Account Entries & Lifecycle Callables (U-2, U-3, U-14, U-15; D-F2..D-F4)
 *
 * Provides:
 * - Detailed query and retrieval of account entries with filtering by status and needsReview
 * - Entry verification and approval with four-eyes maker-checker enforcement
 * - Single-step entry rejection and reversal
 * - Linked sub-entries (transaction charges, gateway fees, bank charges) at depth 1
 * - Organization accounting policy retrieval and configuration
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  ListAccountEntriesSchema,
  GetAccountEntrySchema,
  GetAccountEntryCountsSchema,
  VerifyAccountEntrySchema,
  ApproveAccountEntrySchema,
  RejectAccountEntrySchema,
  ReverseAccountEntrySchema,
  UpdateAccountEntryNoteSchema,
  CreateSubEntrySchema,
  GetAccountingPolicySchema,
  UpdateAccountingPolicySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  AccountTransactionDoc,
  OrganizationDoc,
  AccountingPolicy,
} from "../types/models.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import {
  prepareReversalInTxn,
  applyReversalInTxn,
  prepareEntriesInTxn,
  applyEntriesInTxn,
  updateEntryWorkflowInTxn,
} from "../services/postingService.js";
import { assertAmountMatchesCurrency, requireCurrency } from "../services/money.js";

// ============================================================================
// 1. accountEntriesList
// ============================================================================
export const accountEntriesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(ListAccountEntriesSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: [AppPermissions.LEDGER_VIEW, AppPermissions.ACCOUNT_VIEW],
  });
  const orgId = ctx.organizationId;

  let query: FirebaseFirestore.Query = db
    .collection("accountTransactions")
    .where("organizationId", "==", orgId);

  if (input.financialAccountId) {
    query = query.where("financialAccountId", "==", input.financialAccountId);
  }
  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.status) {
    query = query.where("status", "==", input.status);
  }
  if (input.needsReview !== undefined) {
    query = query.where("needsReview", "==", input.needsReview);
  }
  if (input.subEntryType) {
    query = query.where("subEntryType", "==", input.subEntryType);
  }
  if (input.feeStatus) {
    query = query.where("feeStatus", "==", input.feeStatus);
  }
  if (input.parentEntryId) {
    query = query.where("parentEntryId", "==", input.parentEntryId);
  }
  if (input.from) {
    query = query.where("createdAt", ">=", `${input.from}T00:00:00.000Z`);
  }
  if (input.to) {
    query = query.where("createdAt", "<=", `${input.to}T23:59:59.999Z`);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "accountTransactions",
    input.startAfterId,
    input.limit || 50
  );

  const entries = snapshot.docs.map((d) => ({
    id: d.id,
    transactionId: d.id,
    entryId: d.id,
    ...(d.data() as AccountTransactionDoc),
  }));

  return { items: entries, entries, count: entries.length, nextCursor, totalCount };
});

// ============================================================================
// 2. accountEntriesGet
// ============================================================================
export const accountEntriesGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(GetAccountEntrySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.LEDGER_VIEW, AppPermissions.ACCOUNT_VIEW],
  });
  const orgId = ctx.organizationId;

  const entryRef = db.collection("accountTransactions").doc(input.entryId);
  const entrySnap = await entryRef.get();
  if (!entrySnap.exists) {
    throw new HttpsError("not-found", `Account entry "${input.entryId}" not found.`);
  }
  const entry = entrySnap.data() as AccountTransactionDoc;
  if (entry.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Fetch child sub-entries
  const subEntriesSnap = await db
    .collection("accountTransactions")
    .where("organizationId", "==", orgId)
    .where("parentEntryId", "==", input.entryId)
    .get();

  const subEntries = subEntriesSnap.docs.map((d) => ({
    transactionId: d.id,
    entryId: d.id,
    ...(d.data() as AccountTransactionDoc),
  }));

  // Fetch linked reversed or reversal entries if applicable
  let reversedEntry: (Partial<AccountTransactionDoc> & { transactionId?: string }) | null = null;
  if (entry.reversedTransactionId) {
    const revSnap = await db.collection("accountTransactions").doc(entry.reversedTransactionId).get();
    if (revSnap.exists) reversedEntry = { transactionId: revSnap.id, ...(revSnap.data() as AccountTransactionDoc) };
  }

  let reversalEntry: (Partial<AccountTransactionDoc> & { transactionId?: string }) | null = null;
  if (entry.reversalTransactionId) {
    const revSnap = await db.collection("accountTransactions").doc(entry.reversalTransactionId).get();
    if (revSnap.exists) reversalEntry = { transactionId: revSnap.id, ...(revSnap.data() as AccountTransactionDoc) };
  }

  return {
    entry: { id: entrySnap.id, transactionId: entrySnap.id, entryId: entrySnap.id, ...entry },
    subEntries,
    reversedEntry,
    reversalEntry,
  };
});

// ============================================================================
// 3. accountEntriesCounts
// ============================================================================
export const accountEntriesCounts = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(GetAccountEntryCountsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: [AppPermissions.LEDGER_VIEW, AppPermissions.ACCOUNT_VIEW],
  });
  const orgId = ctx.organizationId;

  const baseRef = db.collection("accountTransactions").where("organizationId", "==", orgId);

  const [
    totalSnap,
    createdSnap,
    addedSnap,
    verifiedSnap,
    approvedSnap,
    rejectedSnap,
    reversedSnap,
    needsReviewSnap,
    pendingFeeSnap,
  ] = await Promise.all([
    baseRef.count().get(),
    baseRef.where("status", "==", "created").count().get(),
    baseRef.where("status", "==", "added").count().get(),
    baseRef.where("status", "==", "verified").count().get(),
    baseRef.where("status", "==", "approved").count().get(),
    baseRef.where("status", "==", "rejected").count().get(),
    baseRef.where("status", "==", "reversed").count().get(),
    baseRef.where("needsReview", "==", true).count().get(),
    baseRef.where("feeStatus", "==", "pending").count().get(),
  ]);

  return {
    total: totalSnap.data().count,
    byStatus: {
      created: createdSnap.data().count,
      added: addedSnap.data().count,
      verified: verifiedSnap.data().count,
      approved: approvedSnap.data().count,
      rejected: rejectedSnap.data().count,
      reversed: reversedSnap.data().count,
    },
    needsReview: needsReviewSnap.data().count,
    pendingFee: pendingFeeSnap.data().count,
  };
});

// ============================================================================
// 4. accountEntriesVerify
// ============================================================================
export const accountEntriesVerify = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(VerifyAccountEntrySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_VERIFY, AppPermissions.ACCOUNT_MANAGE],
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_entries.verify",
    clientKey: input.idempotencyKey || `verify_${input.entryId}`,
    payload: { entryId: input.entryId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const entryRef = db.collection("accountTransactions").doc(input.entryId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(entryRef);
      if (!snap.exists) throw new HttpsError("not-found", `Entry "${input.entryId}" not found.`);
      const entry = snap.data() as AccountTransactionDoc;
      if (entry.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      // Four-eyes maker-checker check (Q-F3)
      const creatorUid = entry.workflow?.createdBy || entry.actorUid;
      if (creatorUid === ctx.callerUid && !ctx.can(AppPermissions.APPROVALS_SELF_APPROVE)) {
        throw new HttpsError(
          "permission-denied",
          "Makers cannot verify their own entries.",
          { reason: "SELF_REVIEW_FORBIDDEN" }
        );
      }

      updateEntryWorkflowInTxn(txn, entryRef, entry, {
        actorUid: ctx.callerUid,
        action: "verify",
        note: input.note,
        now,
      });

      return { entryId: snap.id, status: "verified", verifiedByCount: (entry.workflow?.verifiedBy?.length || 0) + 1 };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "VERIFY_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 5. accountEntriesApprove
// ============================================================================
export const accountEntriesApprove = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(ApproveAccountEntrySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_APPROVE, AppPermissions.ACCOUNT_MANAGE],
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_entries.approve",
    clientKey: input.idempotencyKey || `approve_${input.entryId}`,
    payload: { entryId: input.entryId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const entryRef = db.collection("accountTransactions").doc(input.entryId);
    const orgRef = db.collection("organizations").doc(orgId);
    const result = await db.runTransaction(async (txn) => {
      const [snap, orgSnap] = await Promise.all([txn.get(entryRef), txn.get(orgRef)]);
      if (!snap.exists) throw new HttpsError("not-found", `Entry "${input.entryId}" not found.`);
      const entry = snap.data() as AccountTransactionDoc;
      if (entry.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      const orgData = orgSnap.data() as OrganizationDoc | undefined;
      const policy = orgData?.settings?.accountingPolicy;

      // Four-eyes maker-checker check (Q-F3)
      const creatorUid = entry.workflow?.createdBy || entry.actorUid;
      if (creatorUid === ctx.callerUid && !ctx.can(AppPermissions.APPROVALS_SELF_APPROVE)) {
        const selfPolicy = policy?.selfApprovalPolicy || "off";
        if (selfPolicy === "on") {
          // Self-approval allowed
        } else if (selfPolicy === "up_to_limit") {
          const currency = requireCurrency(entry.currency || orgData?.currency, `entry "${input.entryId}"`);
          const limit = policy?.selfApprovalLimits?.[currency];
          // Fail-closed: if currency has no limit, self-approval is blocked
          if (typeof limit !== "number" || entry.amount > limit) {
            throw new HttpsError(
              "permission-denied",
              `Self-approval blocked for currency ${currency}: ${typeof limit !== "number" ? "no limit configured" : `entry amount (${entry.amount}) exceeds limit (${limit})`}.`,
              { reason: "SELF_REVIEW_FORBIDDEN" }
            );
          }
        } else {
          throw new HttpsError(
            "permission-denied",
            "Makers cannot approve their own entries.",
            { reason: "SELF_REVIEW_FORBIDDEN" }
          );
        }
      }

      // Verifier and approver must differ by default (Q-F3)
      const verifiedBy = entry.workflow?.verifiedBy || [];
      const isVerifier = verifiedBy.some((v) => v.uid === ctx.callerUid);
      if (isVerifier && !ctx.can(AppPermissions.APPROVALS_SELF_APPROVE)) {
        throw new HttpsError(
          "permission-denied",
          "Verifier cannot also be the approver.",
          { reason: "VERIFIER_APPROVER_SAME" }
        );
      }

      updateEntryWorkflowInTxn(txn, entryRef, entry, {
        actorUid: ctx.callerUid,
        action: "approve",
        note: input.note,
        needsReview: false,
        now,
      });

      return { entryId: snap.id, status: "approved", approvedByCount: (entry.workflow?.approvedBy?.length || 0) + 1 };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "APPROVE_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 6. accountEntriesReject
// ============================================================================
export const accountEntriesReject = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(RejectAccountEntrySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_APPROVE, AppPermissions.ACCOUNT_MANAGE],
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_entries.reject",
    clientKey: input.idempotencyKey || `reject_${input.entryId}`,
    payload: { entryId: input.entryId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const entryRef = db.collection("accountTransactions").doc(input.entryId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(entryRef);
      if (!snap.exists) throw new HttpsError("not-found", `Entry "${input.entryId}" not found.`);
      const entry = snap.data() as AccountTransactionDoc;
      if (entry.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      // Four-eyes check
      const creatorUid = entry.workflow?.createdBy || entry.actorUid;
      if (creatorUid === ctx.callerUid && !ctx.can(AppPermissions.APPROVALS_SELF_APPROVE)) {
        throw new HttpsError("permission-denied", "Makers cannot reject their own entries.", { reason: "SELF_REVIEW_FORBIDDEN" });
      }

      // If the entry already had posted balance (status == "added" or "verified"), post compensating reversal
      let reversalResult = null;
      if (entry.status === "added" || entry.status === "verified" || entry.status === "approved") {
        const prep = await prepareReversalInTxn(txn, {
          organizationId: orgId,
          originalTransactionId: snap.id,
          financialAccountId: entry.financialAccountId,
          branchId: entry.branchId,
          amount: entry.amount,
          currency: entry.currency,
          sourceDocumentType: entry.sourceDocumentType,
          sourceDocumentId: entry.sourceDocumentId,
          reason: `Rejected entry: ${input.reason}`,
          actorUid: ctx.callerUid,
          now,
        });
        reversalResult = applyReversalInTxn(txn, prep);
      }

      updateEntryWorkflowInTxn(txn, entryRef, entry, {
        actorUid: ctx.callerUid,
        action: "reject",
        reason: input.reason,
        needsReview: false,
        now,
      });

      return {
        entryId: snap.id,
        status: "rejected",
        reversalTransactionId: reversalResult?.transactionId || null,
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "REJECT_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 7. accountEntriesReverse
// ============================================================================
export const accountEntriesReverse = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(ReverseAccountEntrySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_REVERSE, AppPermissions.ACCOUNT_MANAGE],
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_entries.reverse",
    clientKey: input.idempotencyKey || `reverse_${input.entryId}`,
    payload: { entryId: input.entryId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const entryRef = db.collection("accountTransactions").doc(input.entryId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(entryRef);
      if (!snap.exists) throw new HttpsError("not-found", `Entry "${input.entryId}" not found.`);
      const entry = snap.data() as AccountTransactionDoc;
      if (entry.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      if (entry.type === "reversal" || entry.reversalTransactionId) {
        throw new HttpsError("failed-precondition", "Entry is already reversed.", { reason: "ALREADY_REVERSED" });
      }

      // Reversal is always excluded from self-approval (Q-F3: reversals, write-offs excluded)
      const creatorUid = entry.workflow?.createdBy || entry.actorUid;
      if (creatorUid === ctx.callerUid) {
        throw new HttpsError("permission-denied", "Makers cannot reverse their own entries.", { reason: "SELF_REVIEW_FORBIDDEN" });
      }

      const prep = await prepareReversalInTxn(txn, {
        organizationId: orgId,
        originalTransactionId: snap.id,
        financialAccountId: entry.financialAccountId,
        branchId: entry.branchId,
        amount: entry.amount,
        currency: entry.currency,
        sourceDocumentType: entry.sourceDocumentType,
        sourceDocumentId: entry.sourceDocumentId,
        reason: input.reason,
        actorUid: ctx.callerUid,
        now,
      });

      const revResult = applyReversalInTxn(txn, prep);

      return {
        originalEntryId: snap.id,
        reversalTransactionId: revResult.transactionId,
        reversalTransactionNumber: revResult.transactionNumber,
        status: "reversed",
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "REVERSE_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 8. accountEntriesUpdateNote
// ============================================================================
export const accountEntriesUpdateNote = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(UpdateAccountEntryNoteSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.ACCOUNT_MANAGE,
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const entryRef = db.collection("accountTransactions").doc(input.entryId);
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(entryRef);
    if (!snap.exists) throw new HttpsError("not-found", `Entry "${input.entryId}" not found.`);
    const entry = snap.data() as AccountTransactionDoc;
    if (entry.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

    updateEntryWorkflowInTxn(txn, entryRef, entry, {
      actorUid: ctx.callerUid,
      action: "update_note",
      note: input.note,
      now,
    });
  });

  return { entryId: input.entryId, note: input.note, notes: input.note, description: input.note, updatedAt: now };
});

// ============================================================================
// 9. accountEntriesCreateSubEntry
// ============================================================================
export const accountEntriesCreateSubEntry = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(CreateSubEntrySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_ENTRY_CREATE, AppPermissions.ACCOUNT_MANAGE],
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_entries.create_sub_entry",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const parentRef = db.collection("accountTransactions").doc(input.parentEntryId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(parentRef);
      if (!snap.exists) throw new HttpsError("not-found", `Parent entry "${input.parentEntryId}" not found.`);
      const parent = snap.data() as AccountTransactionDoc;
      if (parent.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      const currency = requireCurrency(parent.currency, `parent transaction "${input.parentEntryId}"`);
      assertAmountMatchesCurrency(input.amount, currency);

      // Strict Depth Limit: Depth 1 only! (Q-F22)
      if (parent.parentEntryId) {
        throw new HttpsError(
          "failed-precondition",
          "Sub-entries cannot be nested beyond depth 1.",
          { reason: "MAX_DEPTH_EXCEEDED" }
        );
      }

      // Proportionality Check: Refuse if > 100% of parent amount (Q-F22)
      if (input.amount > parent.amount) {
        throw new HttpsError(
          "invalid-argument",
          `Sub-entry amount (${input.amount}) exceeds parent entry amount (${parent.amount}).`,
          { reason: "SUB_ENTRY_EXCEEDS_PARENT" }
        );
      }

      const targetAccountId = input.financialAccountId || parent.financialAccountId;
      const targetDirection = input.direction || (["transaction_charge", "gateway_fee", "bank_charge"].includes(input.subEntryType) ? "out" : parent.direction);

      const prep = await prepareEntriesInTxn(txn, {
        organizationId: orgId,
        sourceDocumentType: parent.sourceDocumentType,
        sourceDocumentId: parent.sourceDocumentId,
        origin: `sub_entry_${input.subEntryType}`,
        actorUid: ctx.callerUid,
        now,
        legs: [
          {
            financialAccountId: targetAccountId,
            branchId: parent.branchId,
            type: parent.type,
            direction: targetDirection,
            amount: input.amount,
            currency: parent.currency,
            description: input.notes || `${input.subEntryType} on ${parent.transactionNumber}`,
            parentEntryId: snap.id,
            subEntryType: input.subEntryType,
            status: "added",
            needsReview: input.amount > parent.amount * 0.1, // Warn / flag if > 10% per Q-F22
            reviewReasons: input.amount > parent.amount * 0.1 ? ["fee_variance"] : [],
          },
        ],
      });

      const postResult = applyEntriesInTxn(txn, prep);
      const created = postResult.results[0];

      return {
        subEntryId: created.transactionId,
        transactionNumber: created.transactionNumber,
        parentEntryId: snap.id,
        subEntryType: input.subEntryType,
        amount: created.amount,
        direction: created.direction,
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "SUB_ENTRY_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 10. accountingPolicyGet & accountingPolicyUpdate (Q-F2, Q-F3, Q-C2)
// ============================================================================
export const accountingPolicyGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  parseInput(GetAccountingPolicySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_VIEW, AppPermissions.ORG_MANAGE_APPROVAL_POLICY],
  });
  const orgId = ctx.organizationId;

  const orgDoc = (await db.collection("organizations").doc(orgId).get()).data() as OrganizationDoc | undefined;
  const policy: AccountingPolicy = orgDoc?.settings?.accountingPolicy || {
    selfApprovalPolicy: "off",
    roundingMode: "half_up",
    roundToNearestRupee: false,
    cashRoundingFils: true,
  };

  return { policy };
});

export const accountingPolicyUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(UpdateAccountingPolicySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.ORG_MANAGE_APPROVAL_POLICY,
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");

  const orgData = orgSnap.data() as OrganizationDoc | undefined;
  const currentPolicy: AccountingPolicy = orgData?.settings?.accountingPolicy || {
    selfApprovalPolicy: "off",
    roundingMode: "half_up",
    roundToNearestRupee: false,
    cashRoundingFils: true,
  };

  const updatedPolicy = {
    ...currentPolicy,
    ...(input.selfApprovalPolicy !== undefined ? { selfApprovalPolicy: input.selfApprovalPolicy } : {}),
    ...(input.selfApprovalLimits !== undefined ? { selfApprovalLimits: input.selfApprovalLimits } : {}),
    ...(input.cashCountVarianceThreshold !== undefined ? { cashCountVarianceThreshold: input.cashCountVarianceThreshold } : {}),
    ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
    ...(input.roundToNearestRupee !== undefined ? { roundToNearestRupee: input.roundToNearestRupee } : {}),
    ...(input.cashRoundingFils !== undefined ? { cashRoundingFils: input.cashRoundingFils } : {}),
    updatedAt: now,
    updatedBy: ctx.callerUid,
  };

  await orgRef.update({
    "settings.accountingPolicy": updatedPolicy,
    updatedAt: now,
    updatedBy: ctx.callerUid,
  });

  return { policy: updatedPolicy };
});
