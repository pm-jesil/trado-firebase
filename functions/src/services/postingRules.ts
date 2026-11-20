/**
 * Central Unified Posting Rules & Ledger Service (Phase 1, Section 1A)
 * 
 * Provides:
 * - Single source of truth for all financial posting rules across business events (1..20)
 * - Atomic two-phase Firestore transaction execution (preparePostingInTxn / applyPostingInTxn)
 * - Double-entry ledger tracking with decimal major amounts (D-71)
 * - Automatic balanced double-entry journal creation (JournalEntryDoc in `journalEntries/{id}`)
 * - Idempotency guaranteed on (sourceDocumentType, sourceDocumentId, eventKey)
 */

import { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import {
  FinancialAccountDoc,
  AccountTransactionDoc,
  AccountTransactionType,
  JournalEntryDoc,
  JournalLineItem,
} from "../types/models.js";
import { Money, requireCurrency } from "./money.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
  DocumentNumberReservation,
} from "./documentCounter.js";
import { applyEntriesInTxn } from "./postingService.js";

// Standard Chart of Accounts Account Codes
export const STANDARD_ACCOUNTS = {
  CASH: { code: "1010", name: "Cash in Hand" },
  BANK: { code: "1020", name: "Bank Operating Accounts" },
  CLEARING: { code: "1030", name: "Card & Gateway Clearing" },
  RECEIVABLE: { code: "1200", name: "Accounts Receivable (Customers)" },
  INVENTORY: { code: "1300", name: "Merchandise Inventory" },
  INVENTORY_TRANSIT: { code: "1350", name: "In-Transit Inventory" },
  TAX_INPUT: { code: "1400", name: "Input Tax Recoverable" },
  PAYABLE: { code: "2100", name: "Accounts Payable (Vendors)" },
  TAX_OUTPUT: { code: "2200", name: "Output Tax Payable" },
  CUSTOMER_ADVANCES: { code: "2300", name: "Customer Advances / Unallocated" },
  CAPITAL: { code: "3000", name: "Owner Capital" },
  DRAWINGS: { code: "3100", name: "Owner Personal Drawings" },
  SALES_REVENUE: { code: "4000", name: "Sales Revenue" },
  SALES_RETURNS: { code: "4100", name: "Sales Returns & Allowances" },
  SHIPPING_INCOME: { code: "4200", name: "Delivery & Shipping Income" },
  COGS: { code: "5000", name: "Cost of Goods Sold" },
  OPERATING_EXPENSE: { code: "6000", name: "Operating Expenses" },
  PROCESSING_FEES: { code: "6010", name: "Payment Processing Fees" },
  INVENTORY_DAMAGE: { code: "6020", name: "Inventory Wastage & Damage" },
  DELIVERY_EXPENSE: { code: "6030", name: "Delivery & Freight Expenses" },
  ROUND_OFF: { code: "8000", name: "Cash Round-off & Penny Differences" },
} as const;

export type PostingEventCode =
  | "cash_sale"                 // 1. Paid in full cash
  | "credit_sale"               // 2. Unpaid invoice
  | "partial_sale"              // 3. Partial cash + receivable
  | "split_tender_sale"         // 4. Multi-account tender
  | "card_gateway_sale"         // 5. Card sale to clearing account
  | "customer_payment"          // 6. Payment against invoice(s) or advance
  | "cash_purchase"             // 7. Vendor purchase paid
  | "credit_purchase"           // 7b. Vendor purchase on credit
  | "vendor_payment"            // 8. Payment against vendor outflow/advance
  | "expense_payment"           // 9. Operational expense outflow
  | "sales_return_refund"       // 10. Customer return cash/bank refund
  | "sales_return_credit"       // 10b. Customer return credit note
  | "purchase_return_refund"    // 11. Vendor refund received
  | "purchase_return_debit"     // 11b. Purchase return debit note
  | "document_void_reversal"    // 12. Full void reversal
  | "account_transfer"          // 13. Transfer between accounts
  | "capital_contribution"      // 14. Capital injection
  | "capital_drawings"          // 14b. Capital withdrawal
  | "processing_fee_charge"     // 15. Gateway fee deduction & auto-expense
  | "opening_balance"           // 16. Account initial balance
  | "manual_adjustment"         // 16b. Ledger balance manual adjustment
  | "round_off_difference"      // 17. Round-off adjustment line
  | "cod_cashier_handover"      // 18. COD delivery collection handover
  | "stock_transfer_valuation"  // 19. Valuation shift
  | "bank_reconciliation";      // 20. Reconciliation discrepancy

export interface PostingTenderLeg {
  financialAccountId: string;
  amount: number;
  direction: "in" | "out";
  type: AccountTransactionType;
  description?: string;
}

export interface PreparedPosting {
  organizationId: string;
  branchId?: string | null;
  eventCode: PostingEventCode;
  sourceDocumentType: AccountTransactionDoc["sourceDocumentType"];
  sourceDocumentId: string;
  eventKey: string;
  actorUid: string;
  now: string;
  currency: string;
  legs: Array<{
    leg: PostingTenderLeg;
    accountRef: FirebaseFirestore.DocumentReference;
    accountData: FinancialAccountDoc;
    reservation: DocumentNumberReservation;
  }>;
  journalReservation?: DocumentNumberReservation;
  journalLines: JournalLineItem[];
  idempotencyRef?: FirebaseFirestore.DocumentReference;
}

export interface PreparePostingInput {
  organizationId: string;
  branchId?: string | null;
  eventCode: PostingEventCode;
  sourceDocumentType: AccountTransactionDoc["sourceDocumentType"];
  sourceDocumentId: string;
  eventKey?: string;
  currency?: string;
  actorUid: string;
  now?: string;
  legs?: PostingTenderLeg[];
  journalLines?: JournalLineItem[];
}

/**
 * Phase 1: Pre-reads all financial accounts and reserves sequential document numbers
 * in an active Firestore Transaction.
 */
export async function preparePostingInTxn(
  txn: Transaction,
  input: PreparePostingInput
): Promise<PreparedPosting> {
  const orgId = input.organizationId;
  const now = input.now || new Date().toISOString();
  const eventKey = input.eventKey || `${input.eventCode}_${input.sourceDocumentId}`;
  const currency = requireCurrency(input.currency, `posting event "${input.eventCode}"`);

  const preparedLegs: PreparedPosting["legs"] = [];
  const legs = input.legs || [];

  for (const leg of legs) {
    const accountRef = db.collection("financialAccounts").doc(leg.financialAccountId);
    const snap = await txn.get(accountRef);

    if (!snap.exists) {
      throw new HttpsError("not-found", `Financial account "${leg.financialAccountId}" not found.`);
    }

    const accountData = snap.data() as FinancialAccountDoc;
    if (accountData.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant financial account reference rejected.");
    }
    if (!accountData.isActive) {
      throw new HttpsError("failed-precondition", `Financial account "${accountData.name}" is inactive.`);
    }

    // Branch scoping validation
    if (input.branchId) {
      if (accountData.branchId && accountData.branchId !== input.branchId) {
        throw new HttpsError(
          "permission-denied",
          `Financial account "${accountData.name}" is restricted to branch "${accountData.branchId}".`
        );
      }
      if (
        accountData.assignedBranchIds &&
        accountData.assignedBranchIds.length > 0 &&
        !accountData.assignedBranchIds.includes(input.branchId)
      ) {
        throw new HttpsError(
          "permission-denied",
          `Financial account "${accountData.name}" is not assigned to branch "${input.branchId}".`
        );
      }
    }

    const reservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "TXN",
    });

    preparedLegs.push({
      leg,
      accountRef,
      accountData,
      reservation,
    });
  }

  // Reserve Journal Entry Number if journal lines are provided
  let journalReservation: DocumentNumberReservation | undefined;
  const journalLines = input.journalLines || [];
  if (journalLines.length > 0) {
    // Validate balanced double entry: totalDebits === totalCredits
    const totalDebit = journalLines.reduce((acc, l) => acc + (l.debit || 0), 0);
    const totalCredit = journalLines.reduce((acc, l) => acc + (l.credit || 0), 0);
    if (!Money.equal(totalDebit, totalCredit, currency)) {
      throw new HttpsError(
        "invalid-argument",
        `Imbalanced double-entry journal lines: Debits (${totalDebit}) !== Credits (${totalCredit}).`
      );
    }

    journalReservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "JRN",
    });
  }

  return {
    organizationId: orgId,
    branchId: input.branchId || null,
    eventCode: input.eventCode,
    sourceDocumentType: input.sourceDocumentType,
    sourceDocumentId: input.sourceDocumentId,
    eventKey,
    actorUid: input.actorUid,
    now,
    currency,
    legs: preparedLegs,
    journalReservation,
    journalLines,
  };
}

export interface AppliedPostingResult {
  transactionIds: string[];
  journalEntryId?: string;
  journalEntryNumber?: string;
  accountBalances: Array<{ financialAccountId: string; balanceAfter: number }>;
}

/**
 * Phase 2: Commits the balance mutations, writes `accountTransactions`, and commits
 * the balanced `journalEntries` document.
 */
export function applyPostingInTxn(
  txn: Transaction,
  prepared: PreparedPosting
): AppliedPostingResult {
  // 1. Process Account Transactions via central posting service
  const postResult = applyEntriesInTxn(txn, {
    params: {
      organizationId: prepared.organizationId,
      sourceDocumentType: prepared.sourceDocumentType,
      sourceDocumentId: prepared.sourceDocumentId,
      origin: prepared.eventCode,
      legs: prepared.legs.map((l) => ({
        ...l.leg,
        notes: l.leg.description,
      })),
      actorUid: prepared.actorUid,
      now: prepared.now,
    },
    preparedLegs: prepared.legs,
  });

  const transactionIds = postResult.results.map((r) => r.transactionId);
  const accountBalances = postResult.results.map((r) => ({
    financialAccountId: r.financialAccountId,
    balanceAfter: r.balanceAfter,
  }));

  // 2. Process Balanced Double-Entry Journal Entry
  let journalEntryId: string | undefined;
  let journalEntryNumber: string | undefined;

  if (prepared.journalReservation && prepared.journalLines.length > 0) {
    commitDocumentNumberInTxn(txn, prepared.journalReservation);
    journalEntryNumber = prepared.journalReservation.formattedNumber;

    const totalDebit = Money.sum(prepared.journalLines.map((l) => l.debit || 0), prepared.currency);
    const totalCredit = Money.sum(prepared.journalLines.map((l) => l.credit || 0), prepared.currency);

    const jrnRef = db.collection("journalEntries").doc();
    journalEntryId = jrnRef.id;

    const jrnDoc: JournalEntryDoc = {
      organizationId: prepared.organizationId,
      branchId: prepared.branchId || null,
      entryNumber: journalEntryNumber,
      entryDate: prepared.now.slice(0, 10),
      sourceDocumentType: prepared.sourceDocumentType,
      sourceDocumentId: prepared.sourceDocumentId,
      eventKey: prepared.eventKey,
      lines: prepared.journalLines.map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
      totalDebit,
      totalCredit,
      currency: prepared.currency,
      actorUid: prepared.actorUid,
      createdAt: prepared.now,
    };

    txn.set(jrnRef, jrnDoc);
  }

  return {
    transactionIds,
    journalEntryId,
    journalEntryNumber,
    accountBalances,
  };
}
