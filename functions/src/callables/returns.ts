/**
 * Return Callables (Sales Returns & Purchase Returns)
 * 
 * Strict architectural rule:
 * - References `referenceId` by ID only (billId or outflowId)
 * - Restocked items increment/decrement stock transactionally
 * - Generates sequential return numbers: `RET-2026-000001`
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateReturnSchema,
  ListReturnsSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  ReturnDoc,
  ReturnItem,
  BillDoc,
  OutflowDoc,
  CustomerDoc,
  VendorDoc,
  ProductDoc,
} from "../types/models.js";
import {
  ReturnType,
  ReturnDisposition,
  StockMovementType,
} from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  StockChangeItem,
} from "../services/stockEngine.js";
import { Money } from "../services/money.js";
import { hydrate } from "../services/hydration.js";
import { evaluateApproval, assertCanDecide } from "../services/approvals.js";
import type { RequestContext } from "../services/contextResolver.js";
import type { DocumentDecisionInput, CreateReturnInput } from "../validation/schemas.js";
import { SerialLine, assertSerialCount, prepareSerialsInTxn } from "../services/serials.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext, resolveDataScope, applyDataScope } from "../services/contextResolver.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";
import { AppPermissions } from "../constants/permissions.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SourceLine {
  lineId: string;
  productId: string;
  quantity: number;
  unit: string;
  factor: number;
  netAmount: number;
  isReturnable?: boolean;
  line: { returnedQty?: number };
}

/** The source line a return item refers to; ambiguous product references must name the line. */
function resolveSourceLine(lines: SourceLine[], productId: string, sourceLineId?: string): SourceLine {
  const candidates = lines.filter((l) => l.productId === productId && (!sourceLineId || l.lineId === sourceLineId));
  if (candidates.length === 0) {
    throw new HttpsError("invalid-argument", `Product "${productId}"${sourceLineId ? ` on line ${sourceLineId}` : ""} is not part of the referenced document.`);
  }
  if (candidates.length > 1) {
    throw new HttpsError("invalid-argument", `[AMBIGUOUS_SOURCE_LINE] Product "${productId}" appears on lines ${candidates.map((c) => c.lineId).join(", ")}; pass sourceLineId.`, { reason: "AMBIGUOUS_SOURCE_LINE" });
  }
  return candidates[0];
}

/**
 * Validates and applies a return: source-line quantities and refund ceiling, stock, serials and the
 * party ledger, in one transaction. Used directly by returnsCreate and, for a pending return, by
 * documentsDecide (approval) — one implementation, so an approved return is exactly a direct one.
 */
export async function executeReturn(
  ctx: RequestContext,
  input: CreateReturnInput,
  returnRef: FirebaseFirestore.DocumentReference,
  approval?: { maker: { uid: string; membershipId: string | null; createdAt: string }; reason?: string | null }
) {
  const orgId = ctx.organizationId;
  const orgWide = ctx.isOwner || ctx.role?.code === "admin";
  const returnId = returnRef.id;
  const now = new Date().toISOString();
  const callerUid = ctx.callerUid;
  const finalResult = await db.runTransaction(async (txn) => {
    // === STEP 1: ALL TRANSACTIONAL READS FIRST (Firestore transactional rule) ===
    if (approval) {
      const pending = await txn.get(returnRef);
      if (!pending.exists || pending.data()?.status !== "pending_approval") {
        throw new HttpsError("failed-precondition", "Return is no longer pending approval.");
      }
    }
    const returnReservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "RET",
    });

    let parentBillDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let parentOutflowDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let billData: BillDoc | null = null;
    let outflowData: OutflowDoc | null = null;
    let customerRef: FirebaseFirestore.DocumentReference | null = null;
    let customerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    let vendorRef: FirebaseFirestore.DocumentReference | null = null;
    let vendorSnap: FirebaseFirestore.DocumentSnapshot | null = null;

    if (input.returnType === ReturnType.SALES_RETURN) {
      const billRef = db.collection("bills").doc(input.referenceId);
      parentBillDoc = await txn.get(billRef);
      if (!parentBillDoc.exists) {
        throw new HttpsError("not-found", `Referenced Bill "${input.referenceId}" not found.`);
      }
      billData = parentBillDoc.data() as BillDoc;
      if (billData.organizationId !== orgId) {
        throw new HttpsError("permission-denied", "Cross-tenant reference rejected.");
      }
      if (billData.status === "voided") {
        throw new HttpsError("failed-precondition", "Cannot return items from a voided bill.");
      }
      if (billData.status === "draft") {
        throw new HttpsError("failed-precondition", "Cannot return items from an unfinalized draft bill.");
      }
      if (billData.status !== "active") {
        throw new HttpsError("failed-precondition", `Cannot return items from a bill in status "${billData.status}".`);
      }
      const custId = billData.customerId;
      if (custId && input.refundMethod === "credit_note") {
        customerRef = db.collection("customers").doc(custId);
        customerSnap = await txn.get(customerRef);
      }
    } else {
      const outflowRef = db.collection("outflows").doc(input.referenceId);
      parentOutflowDoc = await txn.get(outflowRef);
      if (!parentOutflowDoc.exists) {
        throw new HttpsError("not-found", `Referenced Outflow "${input.referenceId}" not found.`);
      }
      outflowData = parentOutflowDoc.data() as OutflowDoc;
      if (outflowData.organizationId !== orgId) {
        throw new HttpsError("permission-denied", "Cross-tenant reference rejected.");
      }
      if (outflowData.status === "voided") {
        throw new HttpsError("failed-precondition", "Cannot return items from a voided outflow.");
      }
      if (outflowData.status !== "confirmed") {
        throw new HttpsError("failed-precondition", `Cannot return items from an outflow in status "${outflowData.status}".`);
      }
      const vendId = outflowData.vendorId;
      if (vendId && input.refundMethod === "credit_note") {
        vendorRef = db.collection("vendors").doc(vendId);
        vendorSnap = await txn.get(vendorRef);
      }
    }

    const parentBranchId = billData?.branchId || outflowData?.branchId || ctx.branchId;
    if (!orgWide && parentBranchId !== ctx.branchId) {
      throw new HttpsError("permission-denied", "[BRANCH_NOT_ASSIGNED] The referenced document belongs to another branch.", { reason: "BRANCH_NOT_ASSIGNED" });
    }

    // Returnability (sales returns): product flag and return window
    const productSnaps = await Promise.all(input.items.map((i) => txn.get(db.collection("products").doc(i.productId))));
    const productById = new Map(productSnaps.filter((ps) => ps.exists).map((ps) => [ps.id, ps.data() as ProductDoc]));

    // Line item validation against parent document and remaining quantity checks
    let totalRefundAmount = 0;
    const processedItems: ReturnItem[] = [];
    const stockChangeItems: StockChangeItem[] = [];
    const serialLines: Array<SerialLine & { restock: boolean }> = [];

    const sourceLines: SourceLine[] = billData
      ? billData.items.map((l) => ({ lineId: l.lineId, productId: l.productId, quantity: l.quantity, unit: l.unit, factor: l.conversionFactor || 1, netAmount: l.lineTotal, isReturnable: l.isReturnable, line: l }))
      : (outflowData?.lines || []).filter((l) => l.productId).map((l) => ({ lineId: l.lineId, productId: l.productId as string, quantity: l.quantity, unit: l.unit, factor: l.conversionFactor || 1, netAmount: l.lineTotal, isReturnable: true, line: l }));

    for (const item of input.items) {
      // Resolve the exact source line (a product may sit on several lines, e.g. box + piece)
      const originalLine = resolveSourceLine(sourceLines, item.productId, item.sourceLineId);
      if (billData) {
        const product = productById.get(item.productId);
        if (originalLine.isReturnable === false || product?.isReturnable === false) {
          throw new HttpsError("failed-precondition", `Product "${item.productId}" (line ${originalLine.lineId}) is non-returnable.`);
        }
        if (product?.returnWindowDays !== undefined &&
          Date.now() - Date.parse(billData.createdAt) > product.returnWindowDays * DAY_MS) {
          throw new HttpsError("failed-precondition",
            `Return window of ${product.returnWindowDays} day(s) for product "${item.productId}" has passed.`);
        }
      }
      const alreadyReturned = originalLine.line.returnedQty || 0;
      const remainingQty = Money.qty(originalLine.quantity - alreadyReturned);
      if (item.quantity > remainingQty + 1e-9) {
        throw new HttpsError(
          "invalid-argument",
          `Cannot return ${item.quantity} ${originalLine.unit} of line ${originalLine.lineId}. Only ${remainingQty} remain returnable.`
        );
      }
      // Refund ceiling: the source line's net value per unit (price/discount/tax frozen on that line)
      const docCurr = ctx.organization.currency;
      const maxRefund = Money.amount((originalLine.netAmount / originalLine.quantity) * item.quantity, docCurr);
      if (item.refundAmount > maxRefund + 0.005) {
        throw new HttpsError("invalid-argument", `Refund ${item.refundAmount} exceeds the line value ${maxRefund} for ${item.quantity} ${originalLine.unit} of line ${originalLine.lineId}.`);
      }
      originalLine.line.returnedQty = Money.qty(alreadyReturned + item.quantity);
      const baseQty = Money.qty(Math.abs(item.quantity) * originalLine.factor);
      const tracked = productById.get(item.productId);
      if (tracked?.trackSerial && tracked.trackStock !== false) {
        const sl = { lineId: originalLine.lineId, productId: item.productId, serials: item.serialNumbers || [], restock: item.disposition === ReturnDisposition.RESTOCKED_TO_INVENTORY };
        assertSerialCount(sl, baseQty);
        serialLines.push(sl);
      } else if (item.serialNumbers?.length) {
        throw new HttpsError("invalid-argument", `[SERIALS_NOT_TRACKED] Product "${item.productId}" does not track serial numbers.`, { reason: "SERIALS_NOT_TRACKED" });
      }

      totalRefundAmount += item.refundAmount;

      processedItems.push({
        sourceLineId: originalLine.lineId,
        productId: item.productId,
        quantity: item.quantity,
        baseQuantity: baseQty,
        refundAmount: item.refundAmount,
        reason: item.reason,
        disposition: item.disposition,
      });

      if (item.disposition === ReturnDisposition.RESTOCKED_TO_INVENTORY) {
        const qtyChange = input.returnType === ReturnType.SALES_RETURN ? baseQty : -baseQty;
        const movType = input.returnType === ReturnType.SALES_RETURN
          ? StockMovementType.SALE_RETURN_IN
          : StockMovementType.PURCHASE_RETURN_OUT;

        stockChangeItems.push({
          productId: item.productId,
          quantity: qtyChange,
          type: movType,
          referenceId: returnId,
          referenceModel: "return",
          referenceLineId: originalLine.lineId,
          reason: `${input.returnType === ReturnType.SALES_RETURN ? "Sales" : "Purchase"} return ${returnId}`,
        });
      }
    }

    let preparedStock = null;
    const branchId = parentBranchId;

    if (stockChangeItems.length > 0) {
      preparedStock = await prepareStockChangesInTxn(txn, {
        organizationId: orgId,
        branchId,
        actorUid: callerUid,
        items: stockChangeItems,
      });
    }
    // Serials: customer return → returned (restocked) / damaged (wasted); vendor return → vendor_returned
    const serialCommits = [];
    for (const restock of [true, false]) {
      const lines = serialLines.filter((l) => l.restock === restock);
      if (!lines.length) continue;
      serialCommits.push(await prepareSerialsInTxn(txn, {
        organizationId: orgId, branchId, lines,
        action: billData ? { kind: "customer_return", billId: input.referenceId, returnId, restock } : { kind: "vendor_return", outflowId: input.referenceId, returnId },
      }));
    }

    // Prepare financial account ledger transaction if refund involves monetary payout / receipt
    let ledgerPrep: {
      accountRef: FirebaseFirestore.DocumentReference;
      accountData: import("../types/models.js").FinancialAccountDoc;
      reservation: import("../services/documentCounter.js").DocumentNumberReservation;
    } | null = null;
    let chosenAccountId: string | null = null;
    const isMonetaryRefund = input.refundMethod !== "credit_note" && totalRefundAmount > 0;

    if (isMonetaryRefund) {
      chosenAccountId =
        input.refundFinancialAccountId ||
        (input.returnType === ReturnType.SALES_RETURN ? billData?.financialAccountId : outflowData?.financialAccountId) ||
        null;

      if (!chosenAccountId) {
        const accSnap = await txn.get(
          db.collection("financialAccounts")
            .where("organizationId", "==", orgId)
            .where("isDefault", "==", true)
            .limit(1)
        );
        if (!accSnap.empty) {
          chosenAccountId = accSnap.docs[0].id;
        } else {
          const anyCashSnap = await txn.get(
            db.collection("financialAccounts")
              .where("organizationId", "==", orgId)
              .where("accountType", "==", "cash")
              .limit(1)
          );
          if (!anyCashSnap.empty) {
            chosenAccountId = anyCashSnap.docs[0].id;
          }
        }
      }

      if (chosenAccountId) {
        const isSales = input.returnType === ReturnType.SALES_RETURN;
        ledgerPrep = await prepareAccountTransactionInTxn(txn, {
          organizationId: orgId,
          financialAccountId: chosenAccountId,
          branchId: branchId || null,
          type: "refund",
          direction: isSales ? "out" : "in",
          amount: totalRefundAmount,
          sourceDocumentType: "return",
          sourceDocumentId: returnId,
          description: `${isSales ? "Customer refund for " + (billData?.billNumber || input.referenceId) : "Vendor refund for " + (outflowData?.outflowNumber || input.referenceId)} (${returnReservation.formattedNumber})`,
          actorUid: callerUid,
          now,
        });
      }
    }

    // === STEP 2: ALL TRANSACTIONAL WRITES ===
    commitDocumentNumberInTxn(txn, returnReservation);
    const returnNumber = returnReservation.formattedNumber;

    let accountTransactionId: string | null = null;
    if (ledgerPrep && chosenAccountId) {
      const isSales = input.returnType === ReturnType.SALES_RETURN;
      const ledgerRes = applyAccountTransactionInTxn(txn, ledgerPrep, {
        organizationId: orgId,
        financialAccountId: chosenAccountId,
        branchId: branchId || null,
        type: "refund",
        direction: isSales ? "out" : "in",
        amount: totalRefundAmount,
        sourceDocumentType: "return",
        sourceDocumentId: returnId,
        description: `${isSales ? "Customer refund for " + (billData?.billNumber || input.referenceId) : "Vendor refund for " + (outflowData?.outflowNumber || input.referenceId)} (${returnNumber})`,
        actorUid: callerUid,
        now,
      });
      accountTransactionId = ledgerRes.transactionId;
    }

    const returnDoc: ReturnDoc = {
      organizationId: orgId,
      branchId,
      returnNumber,
      returnType: input.returnType,
      referenceId: input.referenceId,
      partyId: billData?.customerId || outflowData?.vendorId || null,
      items: processedItems,
      totalRefundAmount,
      refundMethod: input.refundMethod || "cash",
      financialAccountId: chosenAccountId,
      accountTransactionId,
      status: "completed",
      notes: input.notes,
      createdAt: approval?.maker.createdAt || now,
      createdBy: approval?.maker.uid || callerUid,
      createdByMembershipId: approval ? approval.maker.membershipId : ctx.membershipId,
      ...(approval ? { approvedAt: now, approvedBy: callerUid, approvalReason: approval.reason || null } : {}),
    };

    txn.set(returnRef, returnDoc);

    if (preparedStock) {
      commitStockChangesInTxn(txn, preparedStock);
    }
    serialCommits.forEach((commit) => commit());

    if (billData && parentBillDoc) {
      txn.update(parentBillDoc.ref, {
        items: billData.items,
        updatedAt: now,
      });
    } else if (outflowData && parentOutflowDoc) {
      txn.update(parentOutflowDoc.ref, {
        lines: outflowData.lines,
        updatedAt: now,
      });
    }

    if (customerRef && customerSnap && customerSnap.exists) {
      const custData = customerSnap.data() as CustomerDoc;
      const currentBal = custData.outstandingBalance || 0;
      const newBal = Math.max(0, currentBal - totalRefundAmount);
      txn.update(customerRef, {
        outstandingBalance: newBal,
        updatedAt: now,
      });
    }

    if (vendorRef && vendorSnap && vendorSnap.exists) {
      const vendData = vendorSnap.data() as VendorDoc;
      const currentPayable = vendData.outstandingPayable || 0;
      const newPayable = Math.max(0, currentPayable - totalRefundAmount);
      txn.update(vendorRef, {
        outstandingPayable: newPayable,
        updatedAt: now,
      });
    }

    return {
      returnId,
      organizationId: orgId,
      returnNumber,
      totalRefundAmount,
      financialAccountId: chosenAccountId,
      accountTransactionId,
      status: "completed",
      message: "Return processed successfully.",
    };
  });

  return finalResult;
}

/** Approver decision on a pending return (called by documentsDecide). */
export async function decideReturn(ctx: RequestContext, input: DocumentDecisionInput) {
  const ref = db.collection("returns").doc(input.documentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Return not found.");
  const doc = snap.data() as ReturnDoc;
  if (doc.organizationId !== ctx.organizationId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  assertCanDecide(ctx, "return", doc);
  if (input.decision === "reject") {
    const now = new Date().toISOString();
    await ref.update({ status: "rejected", rejectedAt: now, rejectedBy: ctx.callerUid, approvalReason: input.reason || null, updatedAt: now, updatedBy: ctx.callerUid });
    return { returnId: snap.id, status: "rejected" };
  }
  return executeReturn(ctx, {
    returnType: doc.returnType, referenceId: doc.referenceId, items: doc.requestedItems || [], refundMethod: doc.refundMethod as CreateReturnInput["refundMethod"], notes: doc.notes,
  } as CreateReturnInput, ref, { maker: { uid: doc.createdBy, membershipId: doc.createdByMembershipId || null, createdAt: doc.createdAt }, reason: input.reason || null });
}

export const returnsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateReturnSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.RETURN_CREATE });
  const orgId = ctx.organizationId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "returns.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const returnRef = db.collection("returns").doc();
    const returnId = returnRef.id;
    const now = new Date().toISOString();
    const callerUid = ctx.callerUid;

    // Maker–checker: a return the caller may not approve waits with no stock/ledger effect
    const approval = await evaluateApproval(ctx, "return", Money.amount(input.items.reduce((t, i) => t + i.refundAmount, 0), ctx.organization.currency));
    let finalResult: Record<string, unknown>;
    if (approval.required) {
      const ref = await db.collection(input.returnType === ReturnType.SALES_RETURN ? "bills" : "outflows").doc(input.referenceId).get();
      if (!ref.exists || ref.data()?.organizationId !== orgId) throw new HttpsError("not-found", `Referenced document "${input.referenceId}" not found.`);
      const pending: Partial<ReturnDoc> = {
        organizationId: orgId, branchId: ctx.branchId, returnType: input.returnType, referenceId: input.referenceId,
        requestedItems: input.items, refundMethod: input.refundMethod || "cash", notes: input.notes, status: "pending_approval",
        approvalNote: approval.note || null, createdAt: now, createdBy: callerUid, createdByMembershipId: ctx.membershipId,
      };
      await returnRef.set(pending);
      finalResult = { returnId, organizationId: orgId, status: "pending_approval", message: "Return submitted for approval (no stock or ledger effect until approved)." };
    } else {
      finalResult = await executeReturn(ctx, input, returnRef);
    }

    if (idempotency.recordId) {
      const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      await idempRef.update({
        status: "succeeded",
        result: finalResult,
        updatedAt: now,
      });
    }


    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_RETURN_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create return: ${(error as Error).message}`);
  }
});

export const returnsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListReturnsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.RETURN_VIEW });
  const scope = await resolveDataScope(ctx, "returns", AppPermissions.RETURN_VIEW, input.branchId);
  const orgId = ctx.organizationId;

  let query: FirebaseFirestore.Query = db.collection("returns")
    .where("organizationId", "==", orgId);

  if (input.returnType) {
    query = query.where("returnType", "==", input.returnType);
  }
  if (input.referenceId) {
    query = query.where("referenceId", "==", input.referenceId);
  }
  const scoped = applyDataScope(query, scope);
  const { snapshot, nextCursor } = await fetchPage(scoped.query, "returns", input.startAfterId, input.limit || 50);
  const items = snapshot.docs
    .map((doc) => ({ returnId: doc.id, ...(doc.data() as ReturnDoc) }))
    .filter((r) => scoped.keep(r as unknown as Record<string, unknown>));

  return { items, count: items.length, nextCursor, included: await hydrate(ctx, items) };
});
