/**
 * Maker–Checker Approvals Callables
 * 
 * Provides:
 * - documentsDecide: the central decision entry point for maker-checker approvals
 * - approvalsList: query unified pending items across bills, outflows, returns, adjustments, transfers
 * - approvalsCounts: aggregate counts of items waiting for approval
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  DocumentDecisionSchema,
  DocumentDecisionInput,
  ListApprovalsSchema,
  GetApprovalCountsSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { resolveRequestContext, RequestContext } from "../services/contextResolver.js";
import { APPROVE_PERMISSION, assertCanDecide } from "../services/approvals.js";
import { AppPermissions } from "../constants/permissions.js";
import { decideBill } from "./bills.js";
import { decideOutflow } from "./outflows.js";
import { decideReturn } from "./returns.js";
import { decideStockAdjustment } from "./stock.js";
import {
  AccountTransferDoc,
  StockTransferDoc,
  BillDoc,
  OutflowDoc,
  ReturnDoc,
  StockAdjustmentRequestDoc,
} from "../types/models.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";

const PERMISSIONS = {
  bill: [APPROVE_PERMISSION.sale],
  outflow: [APPROVE_PERMISSION.purchase, APPROVE_PERMISSION.expense, AppPermissions.OUTFLOW_APPROVE],
  return: [APPROVE_PERMISSION.return],
  stock_adjustment: [APPROVE_PERMISSION.stock_adjustment],
  account_transfer: [APPROVE_PERMISSION.account_transfer],
  stock_transfer: [APPROVE_PERMISSION.stock_transfer],
} as const;

async function decideAccountTransfer(ctx: RequestContext, input: DocumentDecisionInput) {
  const transferRef = db.collection("accountTransfers").doc(input.documentId);
  const now = new Date().toISOString();
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(transferRef);
    if (!snap.exists) throw new HttpsError("not-found", "Account transfer not found.");
    const transfer = snap.data() as AccountTransferDoc;
    if (transfer.organizationId !== ctx.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    assertCanDecide(ctx, "account_transfer", transfer);

    if (input.decision === "reject") {
      txn.update(transferRef, {
        status: "rejected",
        rejectedBy: ctx.callerUid,
        rejectedAt: now,
        rejectionReason: input.reason || null,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });
      return { success: true, decision: "rejected", message: "Account transfer rejected." };
    }

    // Approve: execute the financial movements
    const sourcePrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: ctx.organizationId,
      financialAccountId: transfer.sourceAccountId,
      type: "transfer_out",
      direction: "out",
      amount: transfer.amount,
      sourceDocumentType: "account_transfer",
      sourceDocumentId: transferRef.id,
      actorUid: ctx.callerUid,
      now,
    });

    const destPrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: ctx.organizationId,
      financialAccountId: transfer.destinationAccountId,
      type: "transfer_in",
      direction: "in",
      amount: transfer.amount,
      sourceDocumentType: "account_transfer",
      sourceDocumentId: transferRef.id,
      actorUid: ctx.callerUid,
      now,
    });

    if ((sourcePrep.accountData.currentBalance || 0) < transfer.amount) {
      throw new HttpsError("failed-precondition", `Insufficient funds in source account "${sourcePrep.accountData.name}".`);
    }

    const sourceRes = applyAccountTransactionInTxn(txn, sourcePrep, {
      organizationId: ctx.organizationId,
      financialAccountId: transfer.sourceAccountId,
      type: "transfer_out",
      direction: "out",
      amount: transfer.amount,
      sourceDocumentType: "account_transfer",
      sourceDocumentId: transferRef.id,
      description: `Transfer to ${destPrep.accountData.name} (${transfer.transferNumber})`,
      actorUid: ctx.callerUid,
      now,
    });

    const destRes = applyAccountTransactionInTxn(txn, destPrep, {
      organizationId: ctx.organizationId,
      financialAccountId: transfer.destinationAccountId,
      type: "transfer_in",
      direction: "in",
      amount: transfer.amount,
      sourceDocumentType: "account_transfer",
      sourceDocumentId: transferRef.id,
      description: `Transfer from ${sourcePrep.accountData.name} (${transfer.transferNumber})`,
      actorUid: ctx.callerUid,
      now,
    });

    txn.update(transferRef, {
      status: "completed",
      sourceTransactionId: sourceRes.transactionId,
      destinationTransactionId: destRes.transactionId,
      approvedBy: ctx.callerUid,
      approvedAt: now,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    });

    return { success: true, decision: "approved", message: "Account transfer approved and executed." };
  });
}

async function decideStockTransfer(ctx: RequestContext, input: DocumentDecisionInput) {
  const transferRef = db.collection("stockTransfers").doc(input.documentId);
  const now = new Date().toISOString();
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(transferRef);
    if (!snap.exists) throw new HttpsError("not-found", "Stock transfer not found.");
    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== ctx.organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    assertCanDecide(ctx, "stock_transfer", transfer);

    if (input.decision === "reject") {
      txn.update(transferRef, {
        status: "rejected",
        rejectedBy: ctx.callerUid,
        rejectedAt: now,
        rejectionReason: input.reason || null,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });
      return { success: true, decision: "rejected", message: "Stock transfer rejected." };
    }

    txn.update(transferRef, {
      status: "approved",
      approvedBy: ctx.callerUid,
      approvedAt: now,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    });

    return { success: true, decision: "approved", message: "Stock transfer approved. Ready for dispatch." };
  });
}

export const documentsDecide = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(DocumentDecisionSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: [...PERMISSIONS[input.documentType]] });
  switch (input.documentType) {
    case "bill": return decideBill(ctx, input);
    case "outflow": return decideOutflow(ctx, input);
    case "return": return decideReturn(ctx, input);
    case "stock_adjustment": return decideStockAdjustment(ctx, input);
    case "account_transfer": return decideAccountTransfer(ctx, input);
    case "stock_transfer": return decideStockTransfer(ctx, input);
  }
});

export const approvalsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListApprovalsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.APPROVALS_VIEW,
  });

  const orgId = ctx.organizationId;
  const items: Array<{
    documentId: string;
    documentType: string;
    documentNumber?: string;
    amount?: number;
    branchId?: string | null;
    createdAt: string;
    createdBy: string;
    title: string;
  }> = [];

  const type = input.documentType;

  // 1. Bills
  if (!type || type === "bill") {
    let q = db.collection("bills").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
    if (input.branchId) q = q.where("branchId", "==", input.branchId);
    const snap = await q.limit(input.limit || 50).get();
    for (const doc of snap.docs) {
      const d = doc.data() as BillDoc;
      items.push({
        documentId: doc.id,
        documentType: "bill",
        documentNumber: d.billNumber,
        amount: d.totalAmount,
        branchId: d.branchId,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        title: `Sale Bill ${d.billNumber || doc.id}`,
      });
    }
  }

  // 2. Outflows
  if (!type || type === "outflow") {
    let q = db.collection("outflows").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
    if (input.branchId) q = q.where("branchId", "==", input.branchId);
    const snap = await q.limit(input.limit || 50).get();
    for (const doc of snap.docs) {
      const d = doc.data() as OutflowDoc;
      items.push({
        documentId: doc.id,
        documentType: "outflow",
        documentNumber: d.outflowNumber,
        amount: d.totalAmount,
        branchId: d.branchId,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        title: `${d.kind === "purchase" ? "Purchase" : "Expense"} ${d.outflowNumber || doc.id}`,
      });
    }
  }

  // 3. Returns
  if (!type || type === "return") {
    let q = db.collection("returns").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
    if (input.branchId) q = q.where("branchId", "==", input.branchId);
    const snap = await q.limit(input.limit || 50).get();
    for (const doc of snap.docs) {
      const d = doc.data() as ReturnDoc;
      items.push({
        documentId: doc.id,
        documentType: "return",
        documentNumber: d.returnNumber,
        amount: d.totalRefundAmount,
        branchId: d.branchId,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        title: `Return ${d.returnNumber || doc.id}`,
      });
    }
  }

  // 4. Stock Adjustments
  if (!type || type === "stock_adjustment") {
    let q = db.collection("stockAdjustmentRequests").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
    if (input.branchId) q = q.where("branchId", "==", input.branchId);
    const snap = await q.limit(input.limit || 50).get();
    for (const doc of snap.docs) {
      const d = doc.data() as StockAdjustmentRequestDoc;
      items.push({
        documentId: doc.id,
        documentType: "stock_adjustment",
        branchId: d.branchId,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        title: `Stock Adjustment (${d.quantity > 0 ? "+" : ""}${d.quantity}) - ${d.reason}`,
      });
    }
  }

  // 5. Account Transfers
  if (!type || type === "account_transfer") {
    let q = db.collection("accountTransfers").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
    const snap = await q.limit(input.limit || 50).get();
    for (const doc of snap.docs) {
      const d = doc.data() as AccountTransferDoc;
      items.push({
        documentId: doc.id,
        documentType: "account_transfer",
        documentNumber: d.transferNumber,
        amount: d.amount,
        branchId: d.sourceBranchId,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        title: `Account Transfer (${d.transferNumber})`,
      });
    }
  }

  // 6. Stock Transfers
  if (!type || type === "stock_transfer") {
    let q = db.collection("stockTransfers").where("organizationId", "==", orgId).where("status", "==", "submitted");
    if (input.branchId) q = q.where("sourceBranchId", "==", input.branchId);
    const snap = await q.limit(input.limit || 50).get();
    for (const doc of snap.docs) {
      const d = doc.data() as StockTransferDoc;
      items.push({
        documentId: doc.id,
        documentType: "stock_transfer",
        documentNumber: d.transferNumber,
        branchId: d.sourceBranchId,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        title: `Stock Transfer (${d.transferNumber})`,
      });
    }
  }

  // Sort by createdAt descending
  items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  return {
    items,
    count: items.length,
    totalCount: items.length,
  };
});

export const approvalsCounts = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetApprovalCountsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.APPROVALS_VIEW,
  });

  const orgId = ctx.organizationId;
  const branchId = input.branchId;

  let billsQuery = db.collection("bills").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
  let outflowsQuery = db.collection("outflows").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
  let returnsQuery = db.collection("returns").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
  let adjustmentsQuery = db.collection("stockAdjustmentRequests").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
  let accountTransfersQuery = db.collection("accountTransfers").where("organizationId", "==", orgId).where("status", "==", "pending_approval");
  let stockTransfersQuery = db.collection("stockTransfers").where("organizationId", "==", orgId).where("status", "==", "submitted");

  if (branchId) {
    billsQuery = billsQuery.where("branchId", "==", branchId);
    outflowsQuery = outflowsQuery.where("branchId", "==", branchId);
    returnsQuery = returnsQuery.where("branchId", "==", branchId);
    adjustmentsQuery = adjustmentsQuery.where("branchId", "==", branchId);
    stockTransfersQuery = stockTransfersQuery.where("sourceBranchId", "==", branchId);
  }

  const [billsSnap, outflowsSnap, returnsSnap, adjustmentsSnap, accountTransfersSnap, stockTransfersSnap] = await Promise.all([
    billsQuery.count().get(),
    outflowsQuery.count().get(),
    returnsQuery.count().get(),
    adjustmentsQuery.count().get(),
    accountTransfersQuery.count().get(),
    stockTransfersQuery.count().get(),
  ]);

  const counts = {
    bills: billsSnap.data().count,
    outflows: outflowsSnap.data().count,
    returns: returnsSnap.data().count,
    stockAdjustments: adjustmentsSnap.data().count,
    accountTransfers: accountTransfersSnap.data().count,
    stockTransfers: stockTransfersSnap.data().count,
    total:
      billsSnap.data().count +
      outflowsSnap.data().count +
      returnsSnap.data().count +
      adjustmentsSnap.data().count +
      accountTransfersSnap.data().count +
      stockTransfersSnap.data().count,
  };

  return counts;
});
