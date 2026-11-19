/**
 * Cash Flows, Transfers Confirmation & Cash Counts Callables (U-4, U-13; D-F13)
 *
 * Provides:
 * - Two-step transfer confirmation and dispute workflows (in-transit contra, cashier shift handover)
 * - Daily physical cash counts with denomination breakdown, variance detection, and adjustment posting
 * - Card/UPI fee recording with automatic sub-entry and linked gateway_fee expense creation
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  ConfirmAccountTransferSchema,
  DisputeAccountTransferSchema,
  CreateCashCountSchema,
  ListCashCountsSchema,
  GetCashCountSchema,
  RecordEntryFeeSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  AccountTransferDoc,
  CashCountDoc,
  FinancialAccountDoc,
  AccountTransactionDoc,
  OrganizationDoc,
} from "../types/models.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import {
  prepareEntriesInTxn,
  applyEntriesInTxn,
  updateEntryWorkflowInTxn,
} from "../services/postingService.js";

// ============================================================================
// 1. accountTransfersConfirm
// ============================================================================
export const accountTransfersConfirm = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(ConfirmAccountTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_TRANSFER,
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_transfers.confirm",
    clientKey: input.idempotencyKey || `confirm_${input.transferId}`,
    payload: { transferId: input.transferId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const transferRef = db.collection("accountTransfers").doc(input.transferId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(transferRef);
      if (!snap.exists) throw new HttpsError("not-found", `Transfer "${input.transferId}" not found.`);
      const transfer = snap.data() as AccountTransferDoc;
      if (transfer.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      if (transfer.status === "completed") {
        throw new HttpsError("failed-precondition", "Transfer is already completed.", { reason: "ALREADY_COMPLETED" });
      }
      if (transfer.status === "cancelled" || transfer.status === "rejected") {
        throw new HttpsError("failed-precondition", `Transfer in status "${transfer.status}" cannot be confirmed.`);
      }

      // Receiver must be different from creator for handover transfers
      if (transfer.transferType === "cashier_handover" && transfer.createdBy === ctx.callerUid) {
        throw new HttpsError("permission-denied", "Cashier handover must be confirmed by the receiving cashier.", { reason: "SELF_CONFIRMATION_FORBIDDEN" });
      }

      // Post in leg to destination account
      const prep = await prepareEntriesInTxn(txn, {
        organizationId: orgId,
        sourceDocumentType: "account_transfer",
        sourceDocumentId: snap.id,
        origin: "transfer_confirm",
        actorUid: ctx.callerUid,
        now,
        legs: [
          {
            financialAccountId: transfer.destinationAccountId,
            branchId: transfer.destinationBranchId,
            type: "transfer_in",
            direction: "in",
            amount: transfer.amount,
            description: `Transfer receipt (${transfer.transferNumber}) from ${transfer.sourceAccountId}`,
            status: "added",
          },
        ],
      });

      const postResult = applyEntriesInTxn(txn, prep);
      const destTxn = postResult.results[0];

      txn.update(transferRef, {
        status: "completed",
        confirmedByUid: ctx.callerUid,
        confirmedAt: now,
        destinationTransactionId: destTxn.transactionId,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });

      return {
        transferId: snap.id,
        transferNumber: transfer.transferNumber,
        status: "completed",
        confirmedByUid: ctx.callerUid,
        confirmedAt: now,
        destinationTransactionId: destTxn.transactionId,
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "CONFIRM_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 2. accountTransfersDispute
// ============================================================================
export const accountTransfersDispute = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(DisputeAccountTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_TRANSFER,
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_transfers.dispute",
    clientKey: input.idempotencyKey || `dispute_${input.transferId}`,
    payload: { transferId: input.transferId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const transferRef = db.collection("accountTransfers").doc(input.transferId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(transferRef);
      if (!snap.exists) throw new HttpsError("not-found", `Transfer "${input.transferId}" not found.`);
      const transfer = snap.data() as AccountTransferDoc;
      if (transfer.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      if (transfer.status === "completed") {
        throw new HttpsError("failed-precondition", "Completed transfer cannot be disputed via this action.", { reason: "ALREADY_COMPLETED" });
      }

      txn.update(transferRef, {
        status: "disputed",
        disputedByUid: ctx.callerUid,
        disputedAt: now,
        disputeReason: input.reason,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });

      return {
        transferId: snap.id,
        transferNumber: transfer.transferNumber,
        status: "disputed",
        disputedByUid: ctx.callerUid,
        disputedAt: now,
        disputeReason: input.reason,
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "DISPUTE_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

// ============================================================================
// 3. cashCountsCreate, cashCountsList, cashCountsGet (Q-F6)
// ============================================================================
export const cashCountsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(CreateCashCountSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_MANAGE,
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "cash_counts.create",
    clientKey: input.idempotencyKey || `count_${input.financialAccountId}_${Date.now()}`,
    payload: { financialAccountId: input.financialAccountId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const accRef = db.collection("financialAccounts").doc(input.financialAccountId);
    const orgRef = db.collection("organizations").doc(orgId);

    const result = await db.runTransaction(async (txn) => {
      const [accSnap, orgSnap] = await Promise.all([txn.get(accRef), txn.get(orgRef)]);
      if (!accSnap.exists) throw new HttpsError("not-found", `Account "${input.financialAccountId}" not found.`);
      const account = accSnap.data() as FinancialAccountDoc;
      if (account.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
      if (account.accountType !== "cash") {
        throw new HttpsError("invalid-argument", "Cash counts can only be performed on cash accounts.");
      }

      // Calculate total counted amount from denominations
      let countedPaise = 0;
      for (const [denomStr, count] of Object.entries(input.denominations)) {
        const denom = Number(denomStr);
        if (denom > 0 && count > 0) {
          // Multiply denom by 100 to get paise (e.g. 500 note = 50000 paise)
          countedPaise += denom * 100 * count;
        }
      }

      const systemBalance = account.currentBalance || 0;
      const varianceAmount = countedPaise - systemBalance;

      const reservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: orgId,
        type: "CNT",
      });
      commitDocumentNumberInTxn(txn, reservation);
      const countNumber = reservation.formattedNumber;

      const orgData = (orgSnap.exists ? orgSnap.data() : null) as OrganizationDoc | null;
      const thresholdMinor = (orgData as any)?.accountingPolicy?.cashCountVarianceThresholdMinor || 100000;
      const reviewThresholdMinor = Math.floor(thresholdMinor / 2);

      let varianceTransactionId: string | null = null;
      if (varianceAmount !== 0) {
        const direction = varianceAmount > 0 ? "in" : "out";
        const prep = await prepareEntriesInTxn(txn, {
          organizationId: orgId,
          sourceDocumentType: "cash_count",
          sourceDocumentId: countNumber,
          origin: "day_end_cash_count",
          actorUid: ctx.callerUid,
          now,
          legs: [
            {
              financialAccountId: input.financialAccountId,
              branchId: account.branchId,
              type: "adjustment",
              direction,
              amount: Math.abs(varianceAmount),
              currency: account.currency || "INR",
              description: `Cash count ${countNumber} variance adjustment (${varianceAmount > 0 ? "overage" : "shortage"})`,
              status: "added",
              needsReview: Math.abs(varianceAmount) > reviewThresholdMinor,
              reviewReasons: Math.abs(varianceAmount) > reviewThresholdMinor ? ["fee_variance"] : [],
            },
          ],
        });
        const postResult = applyEntriesInTxn(txn, prep);
        varianceTransactionId = postResult.results[0].transactionId;
      }

      const countRef = db.collection("cashCounts").doc();
      const countDoc: CashCountDoc = {
        organizationId: orgId,
        branchId: account.branchId || null,
        countNumber,
        financialAccountId: input.financialAccountId,
        countedAmount: countedPaise,
        systemBalance,
        varianceAmount,
        denominations: input.denominations,
        varianceTransactionId,
        needsApproval: Math.abs(varianceAmount) > thresholdMinor,
        notes: input.notes,
        createdAt: now,
        createdBy: ctx.callerUid,
      };

      txn.set(countRef, countDoc);

      return {
        countId: countRef.id,
        countNumber,
        countedAmount: countedPaise,
        systemBalance,
        varianceAmount,
        varianceTransactionId,
        needsApproval: countDoc.needsApproval,
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "CASH_COUNT_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});

export const cashCountsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(ListCashCountsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  const orgId = ctx.organizationId;

  let query: FirebaseFirestore.Query = db.collection("cashCounts").where("organizationId", "==", orgId);
  if (input.financialAccountId) {
    query = query.where("financialAccountId", "==", input.financialAccountId);
  }
  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(query, "cashCounts", input.startAfterId, input.limit || 50);

  const items = snapshot.docs.map((d) => ({
    countId: d.id,
    ...(d.data() as CashCountDoc),
  }));

  return { items, nextCursor, totalCount };
});

export const cashCountsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(GetCashCountSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  const orgId = ctx.organizationId;

  const countSnap = await db.collection("cashCounts").doc(input.countId).get();
  if (!countSnap.exists) throw new HttpsError("not-found", `Cash count "${input.countId}" not found.`);
  const data = countSnap.data() as CashCountDoc;
  if (data.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

  return { count: { countId: countSnap.id, ...data } };
});

// ============================================================================
// 4. accountEntriesRecordFee (Q-F18, Q-F19, U-13)
// ============================================================================
export const accountEntriesRecordFee = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(RecordEntryFeeSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.ACCOUNT_ENTRY_CREATE, AppPermissions.ACCOUNT_MANAGE],
  });
  const orgId = ctx.organizationId;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "account_entries.record_fee",
    clientKey: input.idempotencyKey || `fee_${input.entryId}`,
    payload: { entryId: input.entryId, feeAmount: input.feeAmount },
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
      const parent = snap.data() as AccountTransactionDoc;
      if (parent.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");

      if (parent.feeStatus === "recorded") {
        throw new HttpsError("failed-precondition", "Fee has already been recorded for this entry.", { reason: "FEE_ALREADY_RECORDED" });
      }

      // Create linked child sub-entry of type "gateway_fee"
      const prep = await prepareEntriesInTxn(txn, {
        organizationId: orgId,
        sourceDocumentType: parent.sourceDocumentType,
        sourceDocumentId: parent.sourceDocumentId,
        origin: "payment_fee_record",
        actorUid: ctx.callerUid,
        now,
        legs: [
          {
            financialAccountId: parent.financialAccountId,
            branchId: parent.branchId,
            type: "processing_fee",
            direction: "out",
            amount: input.feeAmount,
            currency: parent.currency,
            description: input.notes || `Gateway interchange fee on ${parent.transactionNumber}`,
            parentEntryId: snap.id,
            subEntryType: "gateway_fee",
            status: "added",
          },
        ],
      });

      const postResult = applyEntriesInTxn(txn, prep);
      const subEntry = postResult.results[0];

      // Update parent entry feeStatus
      updateEntryWorkflowInTxn(txn, entryRef, parent, {
        actorUid: ctx.callerUid,
        action: "record_fee",
        feeStatus: "recorded",
        needsReview: false,
        now,
      });

      return {
        parentEntryId: snap.id,
        subEntryId: subEntry.transactionId,
        subEntryTransactionNumber: subEntry.transactionNumber,
        feeAmount: input.feeAmount,
        feeStatus: "recorded",
      };
    });

    if (idempotency.recordId) await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (error) {
    if (idempotency.recordId) await finalizeIdempotencyFailure(idempotency.recordId, "RECORD_FEE_FAILED", (error as Error).message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", (error as Error).message);
  }
});
