/**
 * Reports & Analytics - Operational Reports
 * 
 * - reportsGetPartyStatement: Vendor / customer statement with document history and ageing
 * - reportsGetOutflowSummary: Accrual and cash outflow aggregation (purchases + expenses)
 * - reportsGetReceivablesAgeing: Accounts receivable ageing buckets
 * - reportsGetPayablesAgeing: Accounts payable ageing buckets
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../../services/callable.js";
import { db } from "../../services/firebase.js";
import { resolveRequestContext } from "../../services/contextResolver.js";
import { DEFAULT_ORG_TIMEZONE, localDateInTimezone } from "../../services/subscription.js";
import { AppPermissions } from "../../constants/permissions.js";
import {
  PartyStatementSchema,
  OutflowSummarySchema,
  GetReceivablesAgeingReportSchema,
  GetPayablesAgeingReportSchema,
} from "../../validation/schemas.js";
import { parseInput } from "../../validation/parseInput.js";
import { round2 } from "../../services/money.js";
import {
  BillDoc,
  OutflowDoc,
  ReturnDoc,
  PaymentDoc,
} from "../../types/models.js";
import { ReturnType } from "../../constants/enums.js";

/** Fields shared by bills and purchase outflows that a party statement reads. */
interface PartyDocument {
  status: string;
  kind?: string;
  branchId?: string;
  docDate?: string;
  createdAt: string;
  outflowNumber?: string;
  billNumber?: string;
  invoiceNumber?: string;
  dueDate?: string | null;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus?: string;
}

/**
 * 8. reportsGetPartyStatement
 * Vendor or customer statement over a date range: opening balance, every document (purchase
 * or bill) with its paid status, payments, credit-note returns, running balance, day-wise
 * document totals (several purchases in one day) and ageing of open documents.
 * Voided documents and voided payments are excluded.
 */
export const reportsGetPartyStatement = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(PartyStatementSchema, request.data);
  const isVendor = input.partyType === "vendor";
  const ctx = await resolveRequestContext(request, {
    requiredPermission: isVendor
      ? [AppPermissions.VENDOR_VIEW_BALANCE, AppPermissions.PAYMENT_VIEW]
      : [AppPermissions.CUSTOMER_VIEW_BALANCE, AppPermissions.PAYMENT_VIEW],
  });
  const orgId = ctx.organizationId;

  const partySnap = await db.collection(isVendor ? "vendors" : "customers").doc(input.partyId).get();
  if (!partySnap.exists || partySnap.data()?.organizationId !== orgId) {
    throw new HttpsError("not-found", `${isVendor ? "Vendor" : "Customer"} not found in this organization.`);
  }
  const party = partySnap.data() as Record<string, unknown>;

  const [docsSnap, paymentsSnap, returnsSnap] = await Promise.all([
    isVendor
      ? db.collection("outflows").where("organizationId", "==", orgId).where("vendorId", "==", input.partyId).get()
      : db.collection("bills").where("organizationId", "==", orgId).where("customerId", "==", input.partyId).get(),
    db.collection("payments").where("organizationId", "==", orgId).where("partyId", "==", input.partyId).get(),
    db.collection("returns").where("organizationId", "==", orgId)
      .where("returnType", "==", isVendor ? ReturnType.PURCHASE_RETURN : ReturnType.SALES_RETURN).get(),
  ]);

  const tz = ctx.organization.timezone || DEFAULT_ORG_TIMEZONE;
  const dayOf = (iso: string) => localDateInTimezone(Date.parse(iso), tz);
  const fromIso = input.from ? (input.from.length === 10 ? `${input.from}T00:00:00.000Z` : input.from) : null;
  const toIso = input.to ? (input.to.length === 10 ? `${input.to}T23:59:59.999Z` : input.to) : null;
  const branchOk = (b?: string) => !input.branchId || b === input.branchId;

  interface Entry { at: string; kind: string; id: string; number: string; debit: number; credit: number; status?: string; paymentStatus?: string; method?: string }
  const entries: Entry[] = [];
  const documents: Array<Record<string, unknown>> = [];
  const docIds = new Set<string>();

  docsSnap.docs.forEach((d) => {
    const doc = d.data() as PartyDocument;
    const live = isVendor ? doc.status === "confirmed" && doc.kind === "purchase" : doc.status === "active";
    if (!live || !branchOk(doc.branchId)) return;
    docIds.add(d.id);
    const at = (isVendor ? doc.docDate : doc.createdAt) || doc.createdAt;
    entries.push({ at, kind: isVendor ? "purchase" : "bill", id: d.id, number: (isVendor ? doc.outflowNumber : doc.billNumber) || "", debit: doc.totalAmount || 0, credit: 0, paymentStatus: doc.paymentStatus });
    documents.push({
      id: d.id,
      number: isVendor ? doc.outflowNumber : doc.billNumber,
      at,
      day: dayOf(at),
      invoiceNumber: isVendor ? doc.invoiceNumber || null : null,
      dueDate: doc.dueDate || null,
      totalAmount: doc.totalAmount,
      paidAmount: doc.paidAmount,
      balanceAmount: doc.balanceAmount,
      paymentStatus: doc.paymentStatus,
    });
  });
  paymentsSnap.docs.forEach((d) => {
    const p = d.data() as PaymentDoc;
    if (p.status !== "completed" || !branchOk(p.branchId)) return;
    if (p.partyType !== (isVendor ? "vendor" : "customer")) return;
    entries.push({ at: p.createdAt, kind: "payment", id: d.id, number: p.paymentNumber, debit: 0, credit: p.amount, method: p.method });
  });
  returnsSnap.docs.forEach((d) => {
    const r = d.data() as ReturnDoc;
    if (r.status === "voided" || r.refundMethod !== "credit_note" || !branchOk(r.branchId)) return;
    if (r.partyId !== input.partyId && !docIds.has(r.referenceId)) return;
    entries.push({ at: r.createdAt, kind: "return_credit_note", id: d.id, number: r.returnNumber, debit: 0, credit: r.totalRefundAmount || 0 });
  });

  entries.sort((a, b) => a.at.localeCompare(b.at));
  let opening = 0;
  let running = 0;
  const lines: Array<Entry & { balance: number }> = [];
  for (const e of entries) {
    if (fromIso && e.at < fromIso) {
      opening = round2(opening + e.debit - e.credit);
      running = opening;
      continue;
    }
    if (toIso && e.at > toIso) continue;
    running = round2(running + e.debit - e.credit);
    lines.push({ ...e, debit: round2(e.debit), credit: round2(e.credit), balance: running });
  }

  // Day-wise document totals within range
  const byDay = new Map<string, { day: string; count: number; total: number; paid: number; balance: number }>();
  documents.forEach((doc) => {
    const at = doc.at as string;
    if ((fromIso && at < fromIso) || (toIso && at > toIso)) return;
    const k = doc.day as string;
    const row = byDay.get(k) || { day: k, count: 0, total: 0, paid: 0, balance: 0 };
    row.count++;
    row.total = round2(row.total + (doc.totalAmount as number));
    row.paid = round2(row.paid + (doc.paidAmount as number));
    row.balance = round2(row.balance + (doc.balanceAmount as number));
    byDay.set(k, row);
  });

  // Ageing of open documents by due date (or document date)
  const now = Date.now();
  const ageing = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  documents.forEach((doc) => {
    const bal = doc.balanceAmount as number;
    if (!bal || bal <= 0) return;
    const ref = Date.parse((doc.dueDate as string) || (doc.at as string));
    const days = Math.floor((now - ref) / 86_400_000);
    if (days <= 0) ageing.current = round2(ageing.current + bal);
    else if (days <= 30) ageing.d1_30 = round2(ageing.d1_30 + bal);
    else if (days <= 60) ageing.d31_60 = round2(ageing.d31_60 + bal);
    else if (days <= 90) ageing.d61_90 = round2(ageing.d61_90 + bal);
    else ageing.d90_plus = round2(ageing.d90_plus + bal);
  });

  const totals = lines.reduce((t, l) => ({ debit: round2(t.debit + l.debit), credit: round2(t.credit + l.credit) }), { debit: 0, credit: 0 });
  return {
    organizationId: orgId,
    partyType: input.partyType,
    partyId: input.partyId,
    partyName: party.name,
    from: input.from || null,
    to: input.to || null,
    openingBalance: opening,
    totalDebit: totals.debit,
    totalCredit: totals.credit,
    closingBalance: running,
    ledgerBalance: isVendor ? party.outstandingPayable ?? null : party.outstandingBalance ?? null,
    entries: lines,
    documents,
    dayWise: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    ageing,
  };
});

/**
 * 9. reportsGetOutflowSummary
 * totalOutflow = purchases + expenses (accrual: document totals; cash: payments made).
 * Purchases are inventory: in the P&L they appear only as COGS when goods are sold, so this
 * figure must never be added to the P&L (no double counting). Grouped by day / category /
 * employee (recorded by) / vendor / branch. Employee-linked expenses need expense:view_sensitive.
 */
export const reportsGetOutflowSummary = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(OutflowSummarySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.REPORT_VIEW, AppPermissions.OUTFLOW_VIEW],
  });
  const orgId = ctx.organizationId;
  const tz = ctx.organization.timezone || DEFAULT_ORG_TIMEZONE;
  const fromIso = input.from ? (input.from.length === 10 ? `${input.from}T00:00:00.000Z` : input.from) : "0000";
  const toIso = input.to ? (input.to.length === 10 ? `${input.to}T23:59:59.999Z` : input.to) : "9999";
  const branchOk = (b?: string) => !input.branchId || b === input.branchId;
  const canSensitive = ctx.can(AppPermissions.EXPENSE_VIEW_SENSITIVE);

  const [outflowsSnap, paymentsSnap] = await Promise.all([
    db.collection("outflows").where("organizationId", "==", orgId).where("status", "==", "confirmed").get(),
    db.collection("payments").where("organizationId", "==", orgId).where("direction", "==", "out").get(),
  ]);

  const groupBy = input.groupBy || "day";
  const groups = new Map<string, { key: string; purchases: number; expenses: number; total: number; count: number }>();
  let purchases = 0;
  let expenses = 0;
  let employeeLinkedExpenses = 0;
  let hiddenSensitive = 0;
  const outflowIds = new Set<string>();

  outflowsSnap.docs.forEach((d) => {
    const o = d.data() as OutflowDoc;
    const at = o.docDate || o.createdAt;
    if (at < fromIso || at > toIso || !branchOk(o.branchId)) return;
    if (o.payeeMembershipId && !canSensitive) {
      hiddenSensitive++;
      return;
    }
    outflowIds.add(d.id);
    const amt = o.totalAmount || 0;
    if (o.kind === "purchase") purchases += amt;
    else {
      expenses += amt;
      if (o.payeeMembershipId) employeeLinkedExpenses += amt;
    }
    let key: string;
    switch (groupBy) {
      case "category": key = o.expenseCategoryId || o.lines?.[0]?.categoryId || (o.kind === "purchase" ? "purchases" : "uncategorized"); break;
      case "employee": key = o.createdBy; break;
      case "vendor": key = o.vendorId || o.payee || "other"; break;
      case "branch": key = o.branchId || "main-branch"; break;
      default: key = localDateInTimezone(Date.parse(at), tz);
    }
    const g = groups.get(key) || { key, purchases: 0, expenses: 0, total: 0, count: 0 };
    if (o.kind === "purchase") g.purchases = round2(g.purchases + amt);
    else g.expenses = round2(g.expenses + amt);
    g.total = round2(g.total + amt);
    g.count++;
    groups.set(key, g);
  });

  let cashPaid = 0;
  paymentsSnap.docs.forEach((d) => {
    const p = d.data() as PaymentDoc;
    if (p.status !== "completed" || p.createdAt < fromIso || p.createdAt > toIso || !branchOk(p.branchId)) return;
    if (p.referenceModel === "outflow" && p.referenceId && !outflowIds.has(p.referenceId)) return;
    cashPaid += p.amount || 0;
  });

  return {
    organizationId: orgId,
    branchId: input.branchId || null,
    from: input.from || null,
    to: input.to || null,
    accrual: {
      purchases: round2(purchases),
      expenses: round2(expenses),
      totalOutflow: round2(purchases + expenses),
      employeeLinkedExpenses: round2(employeeLinkedExpenses),
    },
    cash: { paid: round2(cashPaid) },
    groupBy,
    groups: Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key)),
    excludedSensitiveCount: hiddenSensitive,
    note: "Total outflow is a spend/commitment view. The P&L uses COGS for purchases (when sold) and expenses directly; never add totalOutflow to the P&L.",
  };
});

/**
 * 10. reportsGetReceivablesAgeing
 */
export const reportsGetReceivablesAgeing = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetReceivablesAgeingReportSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.RECEIVABLES_VIEW,
  });

  const orgId = ctx.organizationId;
  const asOf = input.asOfDate || new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(`${asOf}T23:59:59.999Z`);

  let query: FirebaseFirestore.Query = db
    .collection("bills")
    .where("organizationId", "==", orgId)
    .where("status", "in", ["active", "partial"]);

  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.customerId) {
    query = query.where("customerId", "==", input.customerId);
  }

  const snap = await query.get();

  const totals = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90Plus: 0,
    totalOutstanding: 0,
  };

  const customerMap = new Map<string, {
    customerId: string;
    customerName: string;
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
    totalOutstanding: number;
    billCount: number;
  }>();

  for (const doc of snap.docs) {
    const bill = doc.data() as BillDoc;
    const balance = bill.balanceAmount || 0;
    if (balance <= 0) continue;

    const dueStr = bill.createdAt.slice(0, 10);
    const dueMs = Date.parse(`${dueStr}T00:00:00.000Z`);
    const daysOverdue = Math.floor((asOfMs - dueMs) / 86400000);

    const cId = bill.customerId || "walk_in";
    const cName = bill.billToSnapshot?.name || "Walk-in Customer";

    let cEntry = customerMap.get(cId);
    if (!cEntry) {
      cEntry = {
        customerId: cId,
        customerName: cName,
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90Plus: 0,
        totalOutstanding: 0,
        billCount: 0,
      };
      customerMap.set(cId, cEntry);
    }

    cEntry.billCount++;
    cEntry.totalOutstanding = round2(cEntry.totalOutstanding + balance);
    totals.totalOutstanding = round2(totals.totalOutstanding + balance);

    if (daysOverdue <= 0) {
      cEntry.current = round2(cEntry.current + balance);
      totals.current = round2(totals.current + balance);
    } else if (daysOverdue <= 30) {
      cEntry.days1to30 = round2(cEntry.days1to30 + balance);
      totals.days1to30 = round2(totals.days1to30 + balance);
    } else if (daysOverdue <= 60) {
      cEntry.days31to60 = round2(cEntry.days31to60 + balance);
      totals.days31to60 = round2(totals.days31to60 + balance);
    } else if (daysOverdue <= 90) {
      cEntry.days61to90 = round2(cEntry.days61to90 + balance);
      totals.days61to90 = round2(totals.days61to90 + balance);
    } else {
      cEntry.days90Plus = round2(cEntry.days90Plus + balance);
      totals.days90Plus = round2(totals.days90Plus + balance);
    }
  }

  return {
    asOfDate: asOf,
    organizationId: orgId,
    branchId: input.branchId || null,
    totals,
    customers: Array.from(customerMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
  };
});

/**
 * 11. reportsGetPayablesAgeing
 */
export const reportsGetPayablesAgeing = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetPayablesAgeingReportSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.PAYABLES_VIEW,
  });

  const orgId = ctx.organizationId;
  const asOf = input.asOfDate || new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(`${asOf}T23:59:59.999Z`);

  let query: FirebaseFirestore.Query = db
    .collection("outflows")
    .where("organizationId", "==", orgId)
    .where("status", "in", ["confirmed", "partial"]);

  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.vendorId) {
    query = query.where("vendorId", "==", input.vendorId);
  }

  const snap = await query.get();

  const totals = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90Plus: 0,
    totalOutstanding: 0,
  };

  const vendorMap = new Map<string, {
    vendorId: string;
    vendorName: string;
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
    totalOutstanding: number;
    outflowCount: number;
  }>();

  for (const doc of snap.docs) {
    const outflow = doc.data() as OutflowDoc;
    const balance = outflow.balanceAmount || 0;
    if (balance <= 0) continue;

    const dueStr = outflow.dueDate || outflow.docDate || outflow.createdAt.slice(0, 10);
    const dueMs = Date.parse(`${dueStr}T00:00:00.000Z`);
    const daysOverdue = Math.floor((asOfMs - dueMs) / 86400000);

    const vId = outflow.vendorId || "other";
    const vName = outflow.payee || "Vendor";

    let vEntry = vendorMap.get(vId);
    if (!vEntry) {
      vEntry = {
        vendorId: vId,
        vendorName: vName,
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90Plus: 0,
        totalOutstanding: 0,
        outflowCount: 0,
      };
      vendorMap.set(vId, vEntry);
    }

    vEntry.outflowCount++;
    vEntry.totalOutstanding = round2(vEntry.totalOutstanding + balance);
    totals.totalOutstanding = round2(totals.totalOutstanding + balance);

    if (daysOverdue <= 0) {
      vEntry.current = round2(vEntry.current + balance);
      totals.current = round2(totals.current + balance);
    } else if (daysOverdue <= 30) {
      vEntry.days1to30 = round2(vEntry.days1to30 + balance);
      totals.days1to30 = round2(totals.days1to30 + balance);
    } else if (daysOverdue <= 60) {
      vEntry.days31to60 = round2(vEntry.days31to60 + balance);
      totals.days31to60 = round2(totals.days31to60 + balance);
    } else if (daysOverdue <= 90) {
      vEntry.days61to90 = round2(vEntry.days61to90 + balance);
      totals.days61to90 = round2(totals.days61to90 + balance);
    } else {
      vEntry.days90Plus = round2(vEntry.days90Plus + balance);
      totals.days90Plus = round2(totals.days90Plus + balance);
    }
  }

  return {
    asOfDate: asOf,
    organizationId: orgId,
    branchId: input.branchId || null,
    totals,
    vendors: Array.from(vendorMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
  };
});
