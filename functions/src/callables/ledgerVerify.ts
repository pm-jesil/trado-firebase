/**
 * Ledger Verification & Trial Balance Callables (Phase 1, Section 1D)
 * 
 * Provides:
 * - ledgerVerify: Comprehensive invariant checks across financial accounts,
 *   immutable transaction sequences, double-entry journal balance, source documents,
 *   and party balances (customers/vendors).
 * - reportsGetTrialBalance: Generates double-entry trial balance as of a given date.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  LedgerVerifySchema,
  GetTrialBalanceSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  FinancialAccountDoc,
  AccountTransactionDoc,
  JournalEntryDoc,
  CustomerDoc,
  VendorDoc,
  BillDoc,
  OutflowDoc,
} from "../types/models.js";
import { Money } from "../services/money.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { STANDARD_ACCOUNTS } from "../services/postingRules.js";

export interface Discrepancy {
  entity: "financialAccount" | "accountTransaction" | "journalEntry" | "customer" | "vendor";
  id: string;
  expected: number | string;
  actual: number | string;
  reason: string;
}

export const ledgerVerify = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(LedgerVerifySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const discrepancies: Discrepancy[] = [];
  let accountsChecked = 0;
  let transactionsChecked = 0;
  let journalEntriesChecked = 0;
  let partiesChecked = 0;

  // 1. Verify Financial Accounts & Transactions
  let accQuery: FirebaseFirestore.Query = db
    .collection("financialAccounts")
    .where("organizationId", "==", orgId);

  if (input.financialAccountId) {
    accQuery = accQuery.where(FirebaseFirestore.FieldPath.documentId(), "==", input.financialAccountId);
  }

  const accountsSnap = await accQuery.get();
  accountsChecked = accountsSnap.docs.length;

  for (const accDoc of accountsSnap.docs) {
    const account = accDoc.data() as FinancialAccountDoc;
    const accountId = accDoc.id;
    const currency = account.currency || "INR";

    let txQuery = db
      .collection("accountTransactions")
      .where("organizationId", "==", orgId)
      .where("financialAccountId", "==", accountId);

    if (input.asOfDate) {
      const nextDay = new Date(`${input.asOfDate}T23:59:59.999Z`).toISOString();
      txQuery = txQuery.where("createdAt", "<=", nextDay);
    }

    const txSnap = await txQuery.orderBy("createdAt", "asc").get();
    transactionsChecked += txSnap.docs.length;

    const firstTx = txSnap.docs[0]?.data() as AccountTransactionDoc | undefined;
    let computedBalance = firstTx?.type === "opening_balance" ? 0 : (account.openingBalance || 0);

    for (const txDoc of txSnap.docs) {
      const tx = txDoc.data() as AccountTransactionDoc;
      const txId = txDoc.id;

      // Invariant: Direction math
      const txAmount = tx.amount || 0;
      if (tx.direction === "in") {
        computedBalance = Money.amount(computedBalance + txAmount, currency);
      } else if (tx.direction === "out") {
        computedBalance = Money.amount(computedBalance - txAmount, currency);
      } else {
        discrepancies.push({
          entity: "accountTransaction",
          id: txId,
          expected: "in | out",
          actual: tx.direction,
          reason: `Invalid transaction direction "${tx.direction}"`,
        });
      }

      // Invariant: balanceAfter matches cumulative balance
      if (!Money.equal(tx.balanceAfter, computedBalance, currency)) {
        discrepancies.push({
          entity: "accountTransaction",
          id: txId,
          expected: computedBalance,
          actual: tx.balanceAfter,
          reason: `Transaction balanceAfter drift: expected ${computedBalance}, got ${tx.balanceAfter}`,
        });
      }

      // Invariant: Source document reference check
      if (tx.sourceDocumentType && tx.sourceDocumentId) {
        let collectionName: string | null = null;
        switch (tx.sourceDocumentType as string) {
          case "bill":
          case "sale":
            collectionName = "bills";
            break;
          case "payment":
            collectionName = "payments";
            break;
          case "outflow":
          case "expense":
          case "purchase":
            collectionName = "outflows";
            break;
          case "transfer":
          case "account_transfer":
            collectionName = "accountTransfers";
            break;
          case "capital":
          case "capital_transaction":
            collectionName = "capitalTransactions";
            break;
          case "fee":
            collectionName = "paymentProcessingFees";
            break;
          case "return":
            collectionName = "returns";
            break;
          default:
            break;
        }

        if (collectionName) {
          const docRef = db.collection(collectionName).doc(tx.sourceDocumentId);
          const docSnap = await docRef.get();
          if (!docSnap.exists) {
            discrepancies.push({
              entity: "accountTransaction",
              id: txId,
              expected: `Existing ${collectionName}/${tx.sourceDocumentId}`,
              actual: "Document not found",
              reason: `Source document ${tx.sourceDocumentType}:${tx.sourceDocumentId} does not exist`,
            });
          }
        }
      }
    }

    // Invariant: Account currentBalance equals computed cumulative balance
    if (!input.asOfDate) {
      if (!Money.equal(account.currentBalance, computedBalance, currency)) {
        discrepancies.push({
          entity: "financialAccount",
          id: accountId,
          expected: computedBalance,
          actual: account.currentBalance,
          reason: `Account currentBalance mismatch: recorded ${account.currentBalance}, ledger sum ${computedBalance}`,
        });
      }
    }
  }

  // 2. Verify Double-Entry Journal Entries
  let jrnQuery: FirebaseFirestore.Query = db
    .collection("journalEntries")
    .where("organizationId", "==", orgId);

  if (input.asOfDate) {
    const nextDay = new Date(`${input.asOfDate}T23:59:59.999Z`).toISOString();
    jrnQuery = jrnQuery.where("createdAt", "<=", nextDay);
  }

  const jrnSnap = await jrnQuery.get();
  journalEntriesChecked = jrnSnap.docs.length;

  for (const jrnDoc of jrnSnap.docs) {
    const jrn = jrnDoc.data() as JournalEntryDoc;
    const jrnId = jrnDoc.id;

    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of jrn.lines || []) {
      totalDebit += line.debit || 0;
      totalCredit += line.credit || 0;
    }

    if (!Money.equal(totalDebit, totalCredit, jrn.currency || "INR")) {
      discrepancies.push({
        entity: "journalEntry",
        id: jrnId,
        expected: totalDebit,
        actual: totalCredit,
        reason: `Imbalanced journal entry: Debits (${totalDebit}) !== Credits (${totalCredit})`,
      });
    }

    if (jrn.totalDebit !== undefined && !Money.equal(jrn.totalDebit, totalDebit, jrn.currency || "INR")) {
      discrepancies.push({
        entity: "journalEntry",
        id: jrnId,
        expected: totalDebit,
        actual: jrn.totalDebit,
        reason: `Journal header totalDebit (${jrn.totalDebit}) !== lines debit sum (${totalDebit})`,
      });
    }
  }

  // 3. Verify Customer Outstanding Balances
  const custSnap = await db.collection("customers").where("organizationId", "==", orgId).get();
  partiesChecked += custSnap.docs.length;

  for (const cDoc of custSnap.docs) {
    const customer = cDoc.data() as CustomerDoc;
    const custId = cDoc.id;

    // Sum open bills
    const billsSnap = await db
      .collection("bills")
      .where("organizationId", "==", orgId)
      .where("customerId", "==", custId)
      .get();

    let openBillSum = 0;
    for (const bDoc of billsSnap.docs) {
      const b = bDoc.data() as BillDoc;
      if (b.status !== "voided" && b.status !== "cancelled") {
        openBillSum += b.balanceAmount || 0;
      }
    }

    const expectedBalance = openBillSum;
    const recordedBalance = customer.outstandingBalance || 0;

    if (!Money.equal(expectedBalance, recordedBalance, ctx.organization.currency)) {
      discrepancies.push({
        entity: "customer",
        id: custId,
        expected: expectedBalance,
        actual: recordedBalance,
        reason: `Customer outstandingBalance mismatch: recorded ${recordedBalance}, open bills sum ${openBillSum}`,
      });
    }
  }

  // 4. Verify Vendor Outstanding Payables
  const vendSnap = await db.collection("vendors").where("organizationId", "==", orgId).get();
  partiesChecked += vendSnap.docs.length;

  for (const vDoc of vendSnap.docs) {
    const vendor = vDoc.data() as VendorDoc;
    const vendId = vDoc.id;

    const outflowsSnap = await db
      .collection("outflows")
      .where("organizationId", "==", orgId)
      .where("vendorId", "==", vendId)
      .get();

    let openOutflowSum = 0;
    for (const oDoc of outflowsSnap.docs) {
      const o = oDoc.data() as OutflowDoc;
      if (o.status === "confirmed") {
        openOutflowSum += o.balanceAmount || 0;
      }
    }

    const expectedPayable = openOutflowSum;
    const recordedPayable = vendor.outstandingPayable || 0;

    if (!Money.equal(expectedPayable, recordedPayable, ctx.organization.currency)) {
      discrepancies.push({
        entity: "vendor",
        id: vendId,
        expected: expectedPayable,
        actual: recordedPayable,
        reason: `Vendor outstandingPayable mismatch: recorded ${recordedPayable}, open outflows sum ${openOutflowSum}`,
      });
    }
  }

  const verified = discrepancies.length === 0;

  return {
    verified,
    accountsChecked,
    transactionsChecked,
    journalEntriesChecked,
    partiesChecked,
    discrepancyCount: discrepancies.length,
    discrepancies,
  };
});

export const reportsGetTrialBalance = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetTrialBalanceSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.REPORT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const asOfDate = input.asOfDate || new Date().toISOString().substring(0, 10);
  const currency = "INR";

  // Aggregate debits & credits from all journal entries up to asOfDate
  const nextDay = new Date(`${asOfDate}T23:59:59.999Z`).toISOString();
  const jrnSnap = await db
    .collection("journalEntries")
    .where("organizationId", "==", orgId)
    .where("createdAt", "<=", nextDay)
    .get();

  const balancesByCode = new Map<string, { code: string; name: string; debit: number; credit: number }>();

  // Pre-populate standard accounts so trial balance has structure
  for (const std of Object.values(STANDARD_ACCOUNTS)) {
    balancesByCode.set(std.code, {
      code: std.code,
      name: std.name,
      debit: 0,
      credit: 0,
    });
  }

  if (!jrnSnap.empty) {
    for (const doc of jrnSnap.docs) {
      const jrn = doc.data() as JournalEntryDoc;
      for (const line of jrn.lines || []) {
        const code = line.accountCode;
        const name = line.accountName || "General Account";
        let row = balancesByCode.get(code);
        if (!row) {
          row = { code, name, debit: 0, credit: 0 };
          balancesByCode.set(code, row);
        }
        row.debit += line.debit || 0;
        row.credit += line.credit || 0;
      }
    }
  } else {
    // Dynamic double-entry derivation from accountTransactions
    const accountsSnap = await db
      .collection("financialAccounts")
      .where("organizationId", "==", orgId)
      .get();

    const accountTypeMap = new Map<string, { code: string; name: string }>();
    for (const accDoc of accountsSnap.docs) {
      const acc = accDoc.data() as FinancialAccountDoc;
      if (acc.accountType === "cash") {
        accountTypeMap.set(accDoc.id, STANDARD_ACCOUNTS.CASH);
      } else if (acc.accountType === "bank") {
        accountTypeMap.set(accDoc.id, STANDARD_ACCOUNTS.BANK);
      } else {
        accountTypeMap.set(accDoc.id, STANDARD_ACCOUNTS.CLEARING);
      }
    }

    const txSnap = await db
      .collection("accountTransactions")
      .where("organizationId", "==", orgId)
      .get();

    const validTxDocs = txSnap.docs.filter((d) => (d.data().createdAt || "") <= nextDay);

    for (const txDoc of validTxDocs) {
      const tx = txDoc.data() as AccountTransactionDoc;
      const amt = tx.amount || 0;
      if (amt <= 0) continue;

      const mainAcc = accountTypeMap.get(tx.financialAccountId) || STANDARD_ACCOUNTS.CASH;
      let offsetAcc: { code: string; name: string } = STANDARD_ACCOUNTS.CAPITAL;

      switch (tx.type) {
        case "opening_balance":
        case "capital_contribution":
          offsetAcc = STANDARD_ACCOUNTS.CAPITAL;
          break;
        case "sale_collection":
          offsetAcc = STANDARD_ACCOUNTS.SALES_REVENUE;
          break;
        case "customer_payment":
          offsetAcc = STANDARD_ACCOUNTS.RECEIVABLE;
          break;
        case "vendor_payment":
          offsetAcc = STANDARD_ACCOUNTS.PAYABLE;
          break;
        case "expense":
          offsetAcc = STANDARD_ACCOUNTS.OPERATING_EXPENSE;
          break;
        case "processing_fee":
          offsetAcc = STANDARD_ACCOUNTS.PROCESSING_FEES;
          break;
        case "transfer_in":
        case "transfer_out":
          offsetAcc = STANDARD_ACCOUNTS.CLEARING;
          break;
        case "capital_drawings":
          offsetAcc = STANDARD_ACCOUNTS.DRAWINGS;
          break;
        case "refund":
          offsetAcc = STANDARD_ACCOUNTS.SALES_RETURNS;
          break;
        default:
          offsetAcc = STANDARD_ACCOUNTS.ROUND_OFF;
          break;
      }

      let mainRow = balancesByCode.get(mainAcc.code);
      if (!mainRow) {
        mainRow = { code: mainAcc.code, name: mainAcc.name, debit: 0, credit: 0 };
        balancesByCode.set(mainAcc.code, mainRow);
      }

      let offsetRow = balancesByCode.get(offsetAcc.code);
      if (!offsetRow) {
        offsetRow = { code: offsetAcc.code, name: offsetAcc.name, debit: 0, credit: 0 };
        balancesByCode.set(offsetAcc.code, offsetRow);
      }

      if (tx.direction === "in") {
        mainRow.debit += amt;
        offsetRow.credit += amt;
      } else {
        mainRow.credit += amt;
        offsetRow.debit += amt;
      }
    }
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const lines: Array<{ accountCode: string; accountName: string; debit: number; credit: number }> = [];

  for (const row of balancesByCode.values()) {
    const rawDebit = Money.amount(row.debit, currency);
    const rawCredit = Money.amount(row.credit, currency);
    if (rawDebit > rawCredit) {
      const netDebit = Money.amount(rawDebit - rawCredit, currency);
      totalDebit = Money.amount(totalDebit + netDebit, currency);
      lines.push({
        accountCode: row.code,
        accountName: row.name,
        debit: netDebit,
        credit: 0,
      });
    } else if (rawCredit > rawDebit) {
      const netCredit = Money.amount(rawCredit - rawDebit, currency);
      totalCredit = Money.amount(totalCredit + netCredit, currency);
      lines.push({
        accountCode: row.code,
        accountName: row.name,
        debit: 0,
        credit: netCredit,
      });
    }
  }

  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const balanced = Money.equal(totalDebit, totalCredit, currency);

  return {
    asOfDate,
    currency,
    lines,
    totalDebit,
    totalCredit,
    balanced,
  };
});
