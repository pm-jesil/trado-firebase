/**
 * Immutable Financial Ledger Service (R4)
 * 
 * Atomically records financial debit/credit movements in `accountTransactions`
 * and updates running materialized balances on `financialAccounts`.
 */

import { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import {
  FinancialAccountDoc,
  AccountTransactionDoc,
  AccountTransactionType,
} from "../types/models.js";
import { Money } from "./money.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "./documentCounter.js";

export interface RecordTransactionParams {
  organizationId: string;
  financialAccountId: string;
  branchId?: string | null;
  type: AccountTransactionType;
  direction: "in" | "out";
  amount: number;
  sourceDocumentType: "bill" | "outflow" | "payment" | "account_transfer" | "reconciliation" | "manual" | "fee" | "capital" | "return";
  sourceDocumentId: string;
  partyType?: "customer" | "vendor" | null;
  partyId?: string | null;
  description?: string;
  actorUid: string;
  now?: string;
}

export interface RecordTransactionResult {
  transactionId: string;
  transactionNumber: string;
  balanceAfter: number;
}

/**
 * Pre-reads financial account and document number reservation inside an active transaction.
 * MUST be called during the read phase of the transaction.
 */
export async function prepareAccountTransactionInTxn(
  txn: Transaction,
  params: RecordTransactionParams
) {
  const accountRef = db.collection("financialAccounts").doc(params.financialAccountId);
  const accountSnap = await txn.get(accountRef);

  if (!accountSnap.exists) {
    throw new HttpsError("not-found", `Financial account "${params.financialAccountId}" not found.`);
  }

  const accountData = accountSnap.data() as FinancialAccountDoc;
  if (accountData.organizationId !== params.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant financial account reference rejected.");
  }
  if (!accountData.isActive) {
    throw new HttpsError("failed-precondition", `Financial account "${accountData.name}" is inactive.`);
  }

  if (params.branchId) {
    if (accountData.branchId && accountData.branchId !== params.branchId) {
      throw new HttpsError(
        "permission-denied",
        `Financial account "${accountData.name}" is restricted to branch "${accountData.branchId}".`
      );
    }
    if (
      accountData.assignedBranchIds &&
      accountData.assignedBranchIds.length > 0 &&
      !accountData.assignedBranchIds.includes(params.branchId)
    ) {
      throw new HttpsError(
        "permission-denied",
        `Financial account "${accountData.name}" is not assigned to branch "${params.branchId}".`
      );
    }
  }

  const reservation = await readNextDocumentNumberInTxn(txn, {
    organizationId: params.organizationId,
    type: "TXN",
  });

  return {
    accountRef,
    accountData,
    reservation,
  };
}

/**
 * Writes the immutable transaction and updates account balance in the commit phase.
 */
export function applyAccountTransactionInTxn(
  txn: Transaction,
  prep: Awaited<ReturnType<typeof prepareAccountTransactionInTxn>>,
  params: RecordTransactionParams
): RecordTransactionResult {
  const now = params.now || new Date().toISOString();
  const currency = prep.accountData.currency || "INR";
  const normalizedAmount = Money.amount(params.amount, currency);

  commitDocumentNumberInTxn(txn, prep.reservation);
  const transactionNumber = prep.reservation.formattedNumber;

  const currentBalance = prep.accountData.currentBalance || 0;
  const balanceAfter =
    params.direction === "in"
      ? Money.amount(currentBalance + normalizedAmount, currency)
      : Money.amount(currentBalance - normalizedAmount, currency);

  const txnRef = db.collection("accountTransactions").doc();
  const txnDoc: AccountTransactionDoc = {
    organizationId: params.organizationId,
    branchId: params.branchId || prep.accountData.branchId || null,
    financialAccountId: params.financialAccountId,
    transactionNumber,
    type: params.type,
    direction: params.direction,
    amount: normalizedAmount,
    balanceAfter,
    sourceDocumentType: params.sourceDocumentType,
    sourceDocumentId: params.sourceDocumentId,
    partyType: params.partyType || null,
    partyId: params.partyId || null,
    description: params.description || undefined,
    actorUid: params.actorUid,
    createdAt: now,
  };

  txn.set(txnRef, txnDoc);

  txn.update(prep.accountRef, {
    currentBalance: balanceAfter,
    updatedAt: now,
    updatedBy: params.actorUid,
  });

  return {
    transactionId: txnRef.id,
    transactionNumber,
    balanceAfter,
  };
}
