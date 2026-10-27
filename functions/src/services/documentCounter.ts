/**
 * Sequential Document Number Generator
 * 
 * Provides transactional, gap-free (within committed transactions) document sequences
 * partitioned per tenant, document type, and financial/calendar year.
 * 
 * ID Pattern: `${organizationId}_${type}_${year}`
 * Example Result: `INV-2026-000001`, `PUR-2026-000001`
 */

import { Transaction } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { DocumentCounterDoc } from "../types/models.js";

export type DocumentTypePrefix =
  | "INV" // B2B Invoices
  | "POS" // Retail POS Receipts
  | "PUR" // Purchases
  | "EXP" // Expenses
  | "PAY" // Payment Vouchers
  | "RET" // Returns
  | "DEL" // Delivery Orders
  | "ADJ" // Stock Adjustments
  | "QTN" // Quotations
  | "PRO" // Proforma Invoices
  | "SO"; // Sales Orders

export interface NextNumberParams {
  organizationId: string;
  type: DocumentTypePrefix;
  year?: number;
  padding?: number; // Default 6 digits e.g. 000001
}

export interface DocumentNumberReservation {
  counterRef: FirebaseFirestore.DocumentReference;
  formattedNumber: string;
  nextSequence: number;
  exists: boolean;
  counterDoc?: DocumentCounterDoc;
}

/**
 * Reads the document counter within an active transaction and prepares the next sequence.
 * MUST be executed during the transaction read phase (before any writes).
 */
export async function readNextDocumentNumberInTxn(
  txn: Transaction,
  params: NextNumberParams
): Promise<DocumentNumberReservation> {
  const year = params.year ?? new Date().getFullYear();
  const padding = params.padding ?? 6;
  const counterId = `${params.organizationId}_${params.type}_${year}`;
  const counterRef = db.collection("documentCounters").doc(counterId);

  const doc = await txn.get(counterRef);
  let nextSequence = 1;
  const exists = doc.exists;

  if (exists) {
    const data = doc.data() as DocumentCounterDoc;
    nextSequence = (data.currentSequence || 0) + 1;
  }

  const paddedSeq = String(nextSequence).padStart(padding, "0");
  const formattedNumber = `${params.type}-${year}-${paddedSeq}`;

  return {
    counterRef,
    formattedNumber,
    nextSequence,
    exists,
    counterDoc: exists
      ? undefined
      : {
        organizationId: params.organizationId,
        type: params.type,
        year,
        currentSequence: nextSequence,
        updatedAt: new Date().toISOString(),
      },
  };
}

/**
 * Commits the reserved document counter update to Firestore.
 * MUST be executed during the transaction write phase (after all reads).
 */
export function commitDocumentNumberInTxn(
  txn: Transaction,
  reservation: DocumentNumberReservation
): void {
  const now = new Date().toISOString();
  if (reservation.exists) {
    txn.update(reservation.counterRef, {
      currentSequence: reservation.nextSequence,
      updatedAt: now,
    });
  } else if (reservation.counterDoc) {
    txn.set(reservation.counterRef, {
      ...reservation.counterDoc,
      updatedAt: now,
    });
  }
}

/**
 * Increments the document counter within an active Firestore transaction and formats the sequence string.
 * Note: Only use when no subsequent txn.get calls will be performed in the same transaction.
 */
export async function getNextDocumentNumberInTxn(
  txn: Transaction,
  params: NextNumberParams
): Promise<string> {
  const reservation = await readNextDocumentNumberInTxn(txn, params);
  commitDocumentNumberInTxn(txn, reservation);
  return reservation.formattedNumber;
}

/**
 * Standalone wrapper for allocating document number when no external transaction is in progress.
 */
export async function allocateNextDocumentNumber(params: NextNumberParams): Promise<string> {
  return await db.runTransaction(async (txn) => {
    return await getNextDocumentNumberInTxn(txn, params);
  });
}
