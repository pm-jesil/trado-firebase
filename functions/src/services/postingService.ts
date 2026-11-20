/**
 * Trado Financial Posting Service (R4, D-F1, D-F2)
 *
 * Single canonical entry point for recording financial debit/credit movements in `accountTransactions`
 * and maintaining synchronized running balances on `financialAccounts`.
 * Enforces two-phase commit (all reads before all writes) inside Firestore transactions.
 */

import { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import {
  FinancialAccountDoc,
  AccountTransactionDoc,
  AccountTransactionType,
  SubEntryType,
  AccountEntryStatus,
} from "../types/models.js";
import { Money, requireCurrency } from "./money.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
  type DocumentNumberReservation,
} from "./documentCounter.js";

export interface PostingLegInput {
  financialAccountId: string;
  branchId?: string | null;
  type: AccountTransactionType;
  direction: "in" | "out";
  amount: number;
  currency?: string;
  description?: string;
  partyType?: "customer" | "vendor" | null;
  partyId?: string | null;
  status?: AccountEntryStatus;
  parentEntryId?: string | null;
  subEntryType?: SubEntryType | null;
  feeStatus?: "pending" | "recorded" | "waived" | "disputed" | null;
  needsReview?: boolean;
  reviewReasons?: string[];
  reversedTransactionId?: string | null;
  notes?: string;
}

export interface PostEntriesParams {
  organizationId: string;
  sourceDocumentType:
  | "bill"
  | "outflow"
  | "payment"
  | "account_transfer"
  | "reconciliation"
  | "manual"
  | "fee"
  | "capital"
  | "return"
  | "cash_count";
  sourceDocumentId: string;
  origin?: string;
  legs: PostingLegInput[];
  actorUid: string;
  now?: string;
}

export interface PreparedLeg {
  leg: PostingLegInput;
  accountRef: FirebaseFirestore.DocumentReference;
  accountData: FinancialAccountDoc;
  reservation: DocumentNumberReservation;
}

export interface PreparedPosting {
  params: PostEntriesParams;
  preparedLegs: PreparedLeg[];
}

export interface PostedLegResult {
  transactionId: string;
  transactionNumber: string;
  financialAccountId: string;
  direction: "in" | "out";
  amount: number;
  balanceAfter: number;
}

export interface PostEntriesResult {
  results: PostedLegResult[];
}

/**
 * Phase 1: Reads and validates accounts and reserves transaction numbers.
 * MUST be executed during the transaction's read phase.
 */
export async function prepareEntriesInTxn(
  txn: Transaction,
  params: PostEntriesParams
): Promise<PreparedPosting> {
  const preparedLegs: PreparedLeg[] = [];

  for (const leg of params.legs) {
    if (leg.amount <= 0) {
      throw new HttpsError("invalid-argument", `Posting leg amount must be positive, received ${leg.amount}.`);
    }

    const accountRef = db.collection("financialAccounts").doc(leg.financialAccountId);
    const accountSnap = await txn.get(accountRef);

    if (!accountSnap.exists) {
      throw new HttpsError("not-found", `Financial account "${leg.financialAccountId}" not found.`);
    }

    const accountData = accountSnap.data() as FinancialAccountDoc;
    if (accountData.organizationId !== params.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant financial account reference rejected.");
    }
    if (!accountData.isActive) {
      throw new HttpsError("failed-precondition", `Financial account "${accountData.name}" is inactive.`);
    }

    if (leg.branchId) {
      if (accountData.branchId && accountData.branchId !== leg.branchId) {
        throw new HttpsError(
          "permission-denied",
          `Financial account "${accountData.name}" is restricted to branch "${accountData.branchId}".`
        );
      }
      if (
        accountData.assignedBranchIds &&
        accountData.assignedBranchIds.length > 0 &&
        !accountData.assignedBranchIds.includes(leg.branchId)
      ) {
        throw new HttpsError(
          "permission-denied",
          `Financial account "${accountData.name}" is not assigned to branch "${leg.branchId}".`
        );
      }
    }

    const reservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: params.organizationId,
      type: "TXN",
    });

    preparedLegs.push({
      leg,
      accountRef,
      accountData,
      reservation,
    });
  }

  return { params, preparedLegs };
}

/**
 * Phase 2: Writes immutable accountTransactions and updates financialAccounts balances.
 * MUST be executed during the transaction's write phase.
 */
export function applyEntriesInTxn(
  txn: Transaction,
  prep: PreparedPosting
): PostEntriesResult {
  const now = prep.params.now || new Date().toISOString();
  const results: PostedLegResult[] = [];

  // Track running balance in case multiple legs affect the same account in one transaction
  const runningBalances = new Map<string, number>();

  for (const item of prep.preparedLegs) {
    const { leg, accountRef, accountData, reservation } = item;
    const currency = requireCurrency(leg.currency || accountData.currency, `financial account "${accountRef.id}"`);
    const normalizedAmount = Money.amount(leg.amount, currency);

    commitDocumentNumberInTxn(txn, reservation);
    const transactionNumber = reservation.formattedNumber;

    const currentBalance = runningBalances.has(leg.financialAccountId)
      ? runningBalances.get(leg.financialAccountId)!
      : (accountData.currentBalance || 0);

    const balanceAfter =
      leg.direction === "in"
        ? Money.amount(currentBalance + normalizedAmount, currency)
        : Money.amount(currentBalance - normalizedAmount, currency);

    runningBalances.set(leg.financialAccountId, balanceAfter);

    const txnRef = db.collection("accountTransactions").doc();
    const entryStatus: AccountEntryStatus = leg.status || "added";

    const txnDoc: AccountTransactionDoc = {
      organizationId: prep.params.organizationId,
      branchId: leg.branchId || accountData.branchId || null,
      financialAccountId: leg.financialAccountId,
      transactionNumber,
      type: leg.type,
      direction: leg.direction,
      amount: normalizedAmount,
      balanceAfter,
      currency,
      status: entryStatus,
      sourceDocumentType: prep.params.sourceDocumentType,
      sourceDocumentId: prep.params.sourceDocumentId,
      partyType: leg.partyType ?? null,
      partyId: leg.partyId ?? null,
      description: leg.description || leg.notes || `${prep.params.sourceDocumentType} transaction`,
      parentEntryId: leg.parentEntryId ?? null,
      subEntryType: leg.subEntryType ?? null,
      feeStatus: leg.feeStatus ?? null,
      needsReview: leg.needsReview ?? false,
      reviewReasons: leg.reviewReasons ?? [],
      reversedTransactionId: leg.reversedTransactionId ?? null,
      workflow: {
        createdBy: prep.params.actorUid,
        createdAt: now,
        updatedByUids: [prep.params.actorUid],
        verifiedBy: [],
        approvedBy: entryStatus === "approved"
          ? [{ uid: prep.params.actorUid, approvedAt: now, note: "Auto-approved at creation" }]
          : [],
      },
      actorUid: prep.params.actorUid,
      createdAt: now,
    };

    txn.set(txnRef, txnDoc);

    txn.update(accountRef, {
      currentBalance: balanceAfter,
      updatedAt: now,
      updatedBy: prep.params.actorUid,
    });

    results.push({
      transactionId: txnRef.id,
      transactionNumber,
      financialAccountId: leg.financialAccountId,
      direction: leg.direction,
      amount: normalizedAmount,
      balanceAfter,
    });
  }

  return { results };
}

export interface PrepareReversalParams {
  organizationId: string;
  originalTransactionId?: string;
  financialAccountId: string;
  branchId?: string | null;
  amount: number;
  currency?: string;
  sourceDocumentType: AccountTransactionDoc["sourceDocumentType"];
  sourceDocumentId: string;
  reason: string;
  actorUid: string;
  now?: string;
}

export interface PreparedReversal {
  params: PrepareReversalParams;
  accountRef: FirebaseFirestore.DocumentReference;
  accountData: FinancialAccountDoc;
  reservation: DocumentNumberReservation;
  originalTxnRef?: FirebaseFirestore.DocumentReference;
}

export async function prepareReversalInTxn(
  txn: Transaction,
  params: PrepareReversalParams
): Promise<PreparedReversal> {
  const accountRef = db.collection("financialAccounts").doc(params.financialAccountId);
  const accountSnap = await txn.get(accountRef);
  if (!accountSnap.exists) {
    throw new HttpsError("not-found", `Financial account "${params.financialAccountId}" not found.`);
  }
  const accountData = accountSnap.data() as FinancialAccountDoc;

  const reservation = await readNextDocumentNumberInTxn(txn, {
    organizationId: params.organizationId,
    type: "TXN",
  });

  const originalTxnRef = params.originalTransactionId
    ? db.collection("accountTransactions").doc(params.originalTransactionId)
    : undefined;

  return { params, accountRef, accountData, reservation, originalTxnRef };
}

export function applyReversalInTxn(
  txn: Transaction,
  prep: PreparedReversal
): PostedLegResult {
  const { params, accountRef, accountData, reservation, originalTxnRef } = prep;
  const now = params.now || new Date().toISOString();
  const currency = requireCurrency(params.currency || accountData.currency, `financial account "${accountRef.id}"`);
  const normalizedAmount = Money.amount(params.amount, currency);

  commitDocumentNumberInTxn(txn, reservation);
  const transactionNumber = reservation.formattedNumber;

  const currentBalance = accountData.currentBalance || 0;
  const balanceAfter = Money.amount(currentBalance - normalizedAmount, currency);

  const txnRef = db.collection("accountTransactions").doc();
  const txnDoc: AccountTransactionDoc = {
    organizationId: params.organizationId,
    branchId: params.branchId || accountData.branchId || null,
    financialAccountId: params.financialAccountId,
    transactionNumber,
    type: "reversal",
    direction: "out",
    amount: normalizedAmount,
    balanceAfter,
    currency,
    status: "reversed",
    sourceDocumentType: params.sourceDocumentType,
    sourceDocumentId: params.sourceDocumentId,
    description: params.reason,
    reversedTransactionId: params.originalTransactionId || null,
    workflow: {
      createdBy: params.actorUid,
      createdAt: now,
      reversedBy: { uid: params.actorUid, reversedAt: now, reason: params.reason },
    },
    actorUid: params.actorUid,
    createdAt: now,
  };

  txn.set(txnRef, txnDoc);

  txn.update(accountRef, {
    currentBalance: balanceAfter,
    updatedAt: now,
    updatedBy: params.actorUid,
  });

  if (originalTxnRef) {
    txn.update(originalTxnRef, {
      reversalTransactionId: txnRef.id,
      status: "reversed",
      updatedAt: now,
    });
  }

  return {
    transactionId: txnRef.id,
    transactionNumber,
    financialAccountId: params.financialAccountId,
    direction: "out",
    amount: normalizedAmount,
    balanceAfter,
  };
}

export interface UpdateEntryWorkflowParams {
  actorUid: string;
  action: "verify" | "approve" | "reject" | "update_note" | "record_fee";
  status?: AccountEntryStatus;
  note?: string;
  reason?: string;
  feeStatus?: "pending" | "recorded" | "waived" | "disputed";
  needsReview?: boolean;
  selfApproved?: boolean;
  now?: string;
}

export function updateEntryWorkflowInTxn(
  txn: Transaction,
  entryRef: FirebaseFirestore.DocumentReference,
  entry: AccountTransactionDoc,
  params: UpdateEntryWorkflowParams
): void {
  const now = params.now || new Date().toISOString();
  const updates: Record<string, unknown> = {
    updatedAt: now,
    updatedBy: params.actorUid,
  };

  const workflow = entry.workflow || {
    createdBy: entry.actorUid || "system",
    createdAt: entry.createdAt || now,
    updatedByUids: [],
    verifiedBy: [],
    approvedBy: [],
  };

  const updatedByUids = Array.from(new Set([...(workflow.updatedByUids || []), params.actorUid]));
  updates["workflow.updatedByUids"] = updatedByUids;

  if (params.selfApproved) {
    updates["selfApproved"] = true;
    updates["workflow.selfApproved"] = true;
  }

  if (params.action === "verify") {
    const verifiedBy = [...(workflow.verifiedBy || [])];
    verifiedBy.push({
      uid: params.actorUid,
      verifiedAt: now,
      note: params.note || undefined,
    });
    updates["status"] = params.status || "verified";
    updates["workflow.verifiedBy"] = verifiedBy;
  } else if (params.action === "approve") {
    const approvedBy = [...(workflow.approvedBy || [])];
    approvedBy.push({
      uid: params.actorUid,
      approvedAt: now,
      note: params.note || undefined,
    });
    updates["status"] = params.status || "approved";
    updates["workflow.approvedBy"] = approvedBy;
    if (params.needsReview !== undefined) {
      updates["needsReview"] = params.needsReview;
    }
  } else if (params.action === "reject") {
    updates["status"] = params.status || "rejected";
    if (params.needsReview !== undefined) {
      updates["needsReview"] = params.needsReview;
    }
    updates["workflow.rejectedBy"] = {
      uid: params.actorUid,
      rejectedAt: now,
      reason: params.reason || params.note || "Rejected",
    };
  } else if (params.action === "update_note") {
    updates["notes"] = params.note || "";
  } else if (params.action === "record_fee") {
    if (params.feeStatus) {
      updates["feeStatus"] = params.feeStatus;
    }
    if (params.needsReview !== undefined) {
      updates["needsReview"] = params.needsReview;
    }
  }

  txn.update(entryRef, updates);
}

