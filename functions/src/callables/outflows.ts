/**
 * Unified Outflows Callables (Purchases & Expenses)
 *
 * Strict architectural rules:
 * - Single collection `outflows` with `kind` = purchase | expense
 * - Purchases are inventory: they reach the P&L only as COGS when sold. Expenses reach the P&L
 *   directly. "Total outflow" (reportsGetOutflowSummary) = purchases + expenses, a cash/
 *   commitment view that must never be added to the P&L.
 * - Lines freeze unit + conversionFactor + baseQuantity (stock is held in the base unit;
 *   buying a box of 12 adds 12 pieces and WAC is per piece)
 * - Damaged-on-receipt units are billed but written off at receipt (reasonCode damaged_on_receipt)
 * - Vendor invoice numbers are unique per vendor (uniqueKeys kind vendor_invoice)
 * - Finalized outflows are never deleted: outflowsVoid posts reversal entries
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "../services/firebase.js";
import { uniqueKeyRef } from "../services/uniqueKeys.js";
import {
  CreateOutflowSchema,
  ListOutflowsSchema,
  VoidDocumentSchema,
  GetOutflowSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import type { DocumentDecisionInput } from "../validation/schemas.js";
import {
  OutflowDoc,
  OutflowLine,
  PaymentDoc,
  VendorDoc,
  ProductDoc,
  MembershipDoc,
  SplitPaymentEntry,
} from "../types/models.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";
import {
  OutflowKind,
  OutflowStatus,
  PaymentStatus,
  StockMovementType,
  PaymentDirection,
  PartyType,
  PaymentMethod,
  StockAdjustmentReason,
} from "../constants/enums.js";
import { AppPermissions } from "../constants/permissions.js";
import { Money } from "../services/money.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import { calculateTax } from "../services/taxCalculation.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  resolveUnitConversion,
  StockChangeItem,
} from "../services/stockEngine.js";
import { hydrate } from "../services/hydration.js";
import { fetchPage } from "../services/pagination.js";
import {
  resolveRequestContext,
  resolveDataScope,
  applyDataScope,
  isInDataScope,
  type RequestContext,
} from "../services/contextResolver.js";
import { evaluateApproval, assertCanDecide } from "../services/approvals.js";
import { SerialLine, assertSerialCount, prepareSerialsInTxn, serialsOf, linesFromRegistry } from "../services/serials.js";
import { canViewOutflow } from "../services/redaction.js";

function createPermission(kind: OutflowKind): string[] {
  return kind === OutflowKind.PURCHASE
    ? [AppPermissions.PURCHASE_CREATE, AppPermissions.OUTFLOW_CREATE]
    : [AppPermissions.EXPENSE_CREATE, AppPermissions.OUTFLOW_CREATE];
}

function canViewKind(ctx: RequestContext, kind: OutflowKind | string): boolean {
  if (ctx.can(AppPermissions.OUTFLOW_VIEW)) return true;
  return kind === OutflowKind.PURCHASE ? ctx.can(AppPermissions.PURCHASE_VIEW) : ctx.can(AppPermissions.EXPENSE_VIEW);
}

const OUTFLOW_READ = [AppPermissions.OUTFLOW_VIEW, AppPermissions.PURCHASE_VIEW, AppPermissions.EXPENSE_VIEW];

function invoiceLockRef(orgId: string, vendorId: string, invoiceNumber: string) {
  return uniqueKeyRef(orgId, "vendor_invoice", `${vendorId}_${invoiceNumber.trim().toLowerCase()}`);
}

function paymentStatusFor(total: number, paid: number): PaymentStatus {
  if (paid >= total) return PaymentStatus.PAID;
  if (paid > 0) return PaymentStatus.PARTIAL;
  return PaymentStatus.PENDING;
}

// ---------------------------------------------------------------------------
// Purchase/expense effects (stock, vendor ledger, payment) shared by create/approve
// ---------------------------------------------------------------------------

interface OutflowEffectsParams {
  ctx: RequestContext;
  outflowId: string;
  doc: Pick<OutflowDoc, "kind" | "vendorId" | "payee" | "totalAmount" | "lines" | "payeeType" | "payeeMembershipId">;
  branchId: string;
  balanceAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  financialAccountId?: string | null;
  splitPayments?: SplitPaymentEntry[];
  storageLocationId?: string;
}

function stockItemsForPurchase(outflowId: string, lines: OutflowLine[], storageLocationId?: string): StockChangeItem[] {
  const items: StockChangeItem[] = [];
  for (const line of lines) {
    if (!line.productId || !line.addToStock) continue;
    const factor = line.conversionFactor || 1;
    const receivedBase = Money.qty(line.quantity * factor);
    if (receivedBase <= 0) continue;
    items.push({
      productId: line.productId,
      quantity: receivedBase,
      costPrice: Money.rate(line.unitPrice / factor), // WAC is per base unit
      type: StockMovementType.PURCHASE_IN,
      referenceId: outflowId,
      referenceModel: "outflow",
      referenceLineId: line.lineId,
      storageLocationId,
      reason: `Purchase receipt ${outflowId}`,
    });
    const damagedBase = Money.qty((line.damagedQuantity || 0) * factor);
    if (damagedBase > 0) {
      items.push({
        productId: line.productId,
        quantity: -damagedBase,
        type: StockMovementType.DAMAGE_OUT,
        referenceId: outflowId,
        referenceModel: "outflow",
        referenceLineId: line.lineId,
        storageLocationId,
        reason: line.damageReason || "Damaged on receipt",
        reasonCode: StockAdjustmentReason.DAMAGED_ON_RECEIPT,
      });
    }
  }
  return items;
}

async function prepareOutflowEffects(txn: Transaction, p: OutflowEffectsParams) {
  const orgId = p.ctx.organizationId;
  const paymentReservation = p.paidAmount > 0
    ? await readNextDocumentNumberInTxn(txn, { organizationId: orgId, type: "PAY" })
    : null;
  const stockItems = p.doc.kind === OutflowKind.PURCHASE ? stockItemsForPurchase(p.outflowId, p.doc.lines, p.storageLocationId) : [];
  const preparedStock = stockItems.length
    ? await prepareStockChangesInTxn(txn, { organizationId: orgId, branchId: p.branchId, actorUid: p.ctx.callerUid, items: stockItems })
    : null;
  const vendorRef = p.doc.kind === OutflowKind.PURCHASE && p.doc.vendorId ? db.collection("vendors").doc(p.doc.vendorId) : null;
  const vendorSnap = vendorRef ? await txn.get(vendorRef) : null;
  if (vendorSnap?.exists && (vendorSnap.data() as VendorDoc).organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant vendor reference rejected.");
  }

  // Operational financial account ledger preps
  const splitPreps: Array<{
    prep: Awaited<ReturnType<typeof prepareAccountTransactionInTxn>>;
    accountId: string;
    method: PaymentMethod;
    amount: number;
  }> = [];

  const txnType = p.doc.kind === OutflowKind.PURCHASE ? "vendor_payment" : "expense";
  if (p.splitPayments && p.splitPayments.length > 0) {
    for (const split of p.splitPayments) {
      if (split.amount > 0) {
        const prep = await prepareAccountTransactionInTxn(txn, {
          organizationId: orgId,
          financialAccountId: split.financialAccountId,
          branchId: p.branchId,
          type: txnType,
          direction: "out",
          amount: split.amount,
          sourceDocumentType: "outflow",
          sourceDocumentId: p.outflowId,
          partyType: p.doc.vendorId ? "vendor" : null,
          partyId: p.doc.vendorId || null,
          description: `${p.doc.kind === OutflowKind.PURCHASE ? "Purchase" : "Expense"} ${p.outflowId} (${split.method})`,
          actorUid: p.ctx.callerUid,
        });
        splitPreps.push({ prep, accountId: split.financialAccountId, method: split.method, amount: split.amount });
      }
    }
  } else if (p.paidAmount > 0 && p.financialAccountId) {
    const singlePrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: p.financialAccountId,
      branchId: p.branchId,
      type: txnType,
      direction: "out",
      amount: p.paidAmount,
      sourceDocumentType: "outflow",
      sourceDocumentId: p.outflowId,
      partyType: p.doc.vendorId ? "vendor" : null,
      partyId: p.doc.vendorId || null,
      description: `${p.doc.kind === OutflowKind.PURCHASE ? "Purchase" : "Expense"} ${p.outflowId}`,
      actorUid: p.ctx.callerUid,
    });
    splitPreps.push({ prep: singlePrep, accountId: p.financialAccountId, method: p.paymentMethod, amount: p.paidAmount });
  }

  return (): { paymentId: string | null } => {
    const now = new Date().toISOString();
    if (preparedStock) commitStockChangesInTxn(txn, preparedStock);
    if (vendorRef && vendorSnap?.exists) {
      const vend = vendorSnap.data() as VendorDoc;
      txn.update(vendorRef, {
        totalPurchase: Money.amount((vend.totalPurchase || 0) + p.doc.totalAmount),
        outstandingPayable: Money.amount((vend.outstandingPayable || 0) + p.balanceAmount),
        updatedAt: now,
      });
    }

    // Apply financial account ledger updates
    for (const sp of splitPreps) {
      applyAccountTransactionInTxn(txn, sp.prep, {
        organizationId: orgId,
        financialAccountId: sp.accountId,
        branchId: p.branchId,
        type: txnType,
        direction: "out",
        amount: sp.amount,
        sourceDocumentType: "outflow",
        sourceDocumentId: p.outflowId,
        partyType: p.doc.vendorId ? "vendor" : null,
        partyId: p.doc.vendorId || null,
        description: `${p.doc.kind === OutflowKind.PURCHASE ? "Purchase" : "Expense"} ${p.outflowId} (${sp.method})`,
        actorUid: p.ctx.callerUid,
      });
    }

    let paymentId: string | null = null;
    if (paymentReservation) {
      commitDocumentNumberInTxn(txn, paymentReservation);
      const paymentRef = db.collection("payments").doc();
      paymentId = paymentRef.id;
      const isEmployee = p.doc.payeeType === "employee" && p.doc.payeeMembershipId;
      const paymentDoc: PaymentDoc = {
        organizationId: orgId,
        branchId: p.branchId,
        financialAccountId: p.financialAccountId || (p.splitPayments?.[0]?.financialAccountId ?? null),
        paymentNumber: paymentReservation.formattedNumber,
        direction: PaymentDirection.OUT,
        partyType: isEmployee ? PartyType.EMPLOYEE : (p.doc.vendorId ? PartyType.VENDOR : PartyType.OTHER),
        partyId: isEmployee ? p.doc.payeeMembershipId : (p.doc.vendorId || null),
        amount: p.paidAmount,
        method: p.paymentMethod,
        referenceId: p.outflowId,
        referenceModel: "outflow",
        status: "completed",
        createdAt: now,
        createdBy: p.ctx.callerUid,
      };
      txn.set(paymentRef, paymentDoc);
    }
    return { paymentId };
  };
}

// ---------------------------------------------------------------------------
// outflowsCreate
// ---------------------------------------------------------------------------

export const outflowsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateOutflowSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: createPermission(input.kind) });
  const orgId = ctx.organizationId;
  const branchId = ctx.branchId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "outflows.create",
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
    const orgData = ctx.organization;
    const outflowRef = db.collection("outflows").doc();
    const outflowId = outflowRef.id;
    const now = new Date().toISOString();
    const docDate = input.docDate || now;
    const isPurchase = input.kind === OutflowKind.PURCHASE;
    const prefix = isPurchase ? "PUR" : "EXP";
    const currency = orgData.currency || "INR";

    // A generated expense must point at a template of this organization
    if (input.recurringTemplateId) {
      const tpl = await db.collection("recurringExpenses").doc(input.recurringTemplateId).get();
      if (!tpl.exists || tpl.data()?.organizationId !== orgId) throw new HttpsError("not-found", "Recurring expense template not found.");
    }
    // Employee-linked expense: payee must be an active member of this organization
    if (input.payeeMembershipId) {
      const mem = await db.collection("memberships").doc(input.payeeMembershipId).get();
      if (!mem.exists || (mem.data() as MembershipDoc).organizationId !== orgId) {
        throw new HttpsError("invalid-argument", "payeeMembershipId is not a member of this organization.");
      }
    }

    // Products referenced by lines (batched) for unit conversion and tenant checks
    const productIds = Array.from(new Set(input.lines.map((l) => l.productId).filter((id): id is string => !!id)));
    const productSnaps = productIds.length ? await db.getAll(...productIds.map((id) => db.collection("products").doc(id))) : [];
    const products = new Map<string, ProductDoc>();
    productSnaps.forEach((snap) => {
      if (!snap.exists) throw new HttpsError("not-found", `Product "${snap.id}" not found.`);
      const prod = snap.data() as ProductDoc;
      if (prod.organizationId !== orgId) throw new HttpsError("permission-denied", `Cross-tenant product access rejected for "${snap.id}".`);
      products.set(snap.id, prod);
    });

    let subTotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    const processedLines: OutflowLine[] = [];
    const serialLines: SerialLine[] = [];

    for (const [idx, rawLine] of input.lines.entries()) {
      const lineId = `L${idx + 1}`;
      const unitPrice = Money.rate(rawLine.unitPrice);
      const quantity = Money.qty(rawLine.quantity);
      const damagedQuantity = Money.qty(rawLine.damagedQuantity || 0);
      if (damagedQuantity > quantity) {
        throw new HttpsError("invalid-argument", `Damaged quantity exceeds received quantity on line ${lineId}.`);
      }
      const gross = Money.amount(quantity * unitPrice, currency);
      const discount = Money.amount(Math.min(gross, rawLine.discountAmount || 0), currency);
      const net = Money.subtract(gross, discount, currency);
      const taxAmount = rawLine.taxPercent ? Money.percent(net, rawLine.taxPercent, currency) : 0;
      const lineTotal = Money.amount(net + taxAmount, currency);

      subTotal = Money.amount(subTotal + gross, currency);
      discountTotal = Money.amount(discountTotal + discount, currency);
      taxTotal = Money.amount(taxTotal + taxAmount, currency);

      const product = rawLine.productId ? products.get(rawLine.productId) : undefined;
      const conv = product ? resolveUnitConversion(product, rawLine.unit) : { unit: rawLine.unit, factor: 1 };
      const addToStock = rawLine.addToStock !== false && !!product?.trackStock;

      const line: OutflowLine = {
        lineId,
        productId: rawLine.productId || null,
        ...(rawLine.productId ? {} : { itemName: rawLine.itemName, categoryId: rawLine.categoryId || null }),
        quantity,
        unit: conv.unit,
        conversionFactor: conv.factor,
        baseQuantity: Money.qty((quantity - damagedQuantity) * conv.factor),
        unitPrice,
        grossAmount: gross,
        discountAmount: discount,
        taxAmount,
        lineTotal,
        addToStock: isPurchase && addToStock,
        batch: rawLine.batch || null,
        expiryDate: rawLine.expiryDate || null,
      };
      if (damagedQuantity > 0) {
        line.damagedQuantity = damagedQuantity;
        line.damageReason = rawLine.damageReason || "Damaged on receipt";
      }
      if (product?.trackSerial && line.addToStock) {
        const sl = { lineId, productId: rawLine.productId as string, serials: rawLine.serialNumbers || [] };
        assertSerialCount(sl, line.baseQuantity ?? 0); // good (non-damaged) units received
        serialLines.push(sl);
      } else if (rawLine.serialNumbers?.length) {
        throw new HttpsError("invalid-argument", `[SERIALS_NOT_TRACKED] Line ${lineId}: the product does not track serial numbers.`, { reason: "SERIALS_NOT_TRACKED" });
      }
      processedLines.push(line);
    }

    const netTaxable = Money.subtract(subTotal, discountTotal, currency);
    const preDiscountTotal = Money.amount(netTaxable + taxTotal, currency);
    const billDiscount = Money.amount(Math.min(preDiscountTotal,
      (input.billDiscountAmount || 0) + (input.billDiscountPercent ? Money.percent(preDiscountTotal, input.billDiscountPercent, currency) : 0)), currency);
    const totalAmount = Money.roundCurrency(preDiscountTotal - billDiscount, currency);
    const requestedPaid = Math.min(totalAmount, Math.max(0, input.paidAmount || 0));

    const approval = await evaluateApproval(ctx, isPurchase ? "purchase" : "expense", totalAmount);
    const pendingApproval = approval.required;
    const paidAmount = pendingApproval ? 0 : requestedPaid;
    const balanceAmount = Money.subtract(totalAmount, paidAmount, currency);
    const paymentStatus = pendingApproval ? PaymentStatus.PENDING : paymentStatusFor(totalAmount, paidAmount);
    const paymentMethod = (input.paymentMethod as PaymentMethod) || PaymentMethod.CASH;

    const taxResult = calculateTax({
      taxRegimeCode: orgData.taxRegimeCode,
      country: orgData.country,
      subTotal: subTotal - discountTotal,
    });

    const lockRef = isPurchase && input.vendorId && input.invoiceNumber
      ? invoiceLockRef(orgId, input.vendorId, input.invoiceNumber)
      : null;

    const effectiveAccountId = input.financialAccountId || ctx.branch?.settings?.defaultFinancialAccountId || undefined;

    const outflowDoc: OutflowDoc = {
      organizationId: orgId,
      branchId,
      financialAccountId: effectiveAccountId || null,
      storageLocationId: input.storageLocationId || null,
      splitPayments: input.splitPayments || undefined,
      outflowNumber: "",
      kind: input.kind,
      status: pendingApproval ? "pending_approval" : OutflowStatus.CONFIRMED,
      docDate,
      vendorId: input.vendorId || null,
      payee: input.payee || undefined,
      ...(input.recurringTemplateId ? { recurringTemplateId: input.recurringTemplateId } : {}),
      payeeType: input.payeeType || (input.payeeMembershipId ? "employee" : (input.vendorId ? "vendor" : "other")),
      payeeMembershipId: input.payeeMembershipId || null,
      expenseCategoryId: input.expenseCategoryId || null,
      invoiceNumber: input.invoiceNumber || undefined,
      dueDate: input.dueDate || null,
      lines: processedLines,
      productIds,
      subTotal,
      discountTotal: Money.amount(discountTotal + billDiscount, currency),
      billDiscountAmount: billDiscount,
      taxTotal,
      totalAmount,
      paidAmount,
      balanceAmount,
      paymentStatus,
      taxSnapshot: taxResult.taxSnapshot,
      notes: input.notes,
      attachmentPaths: input.attachmentPaths,
      createdAt: now,
      createdBy: ctx.callerUid,
      createdByMembershipId: ctx.membershipId,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    };
    if (pendingApproval) {
      outflowDoc.requestedPaidAmount = requestedPaid;
      outflowDoc.requestedPaymentMethod = paymentMethod;
    }
    if (approval.note) outflowDoc.approvalNote = approval.note;

    const finalResult = await db.runTransaction(async (txn) => {
      // === READS ===
      const outflowReservation = await readNextDocumentNumberInTxn(txn, { organizationId: orgId, type: prefix });
      if (lockRef) {
        const lock = await txn.get(lockRef);
        if (lock.exists) {
          throw new HttpsError("already-exists",
            `Vendor invoice "${input.invoiceNumber}" is already recorded (purchase ${lock.data()?.entityId}).`);
        }
      }
      const commitEffects = pendingApproval
        ? null
        : await prepareOutflowEffects(txn, {
          ctx, outflowId, doc: outflowDoc, branchId, balanceAmount, paidAmount, paymentMethod,
          financialAccountId: effectiveAccountId,
          splitPayments: input.splitPayments,
          storageLocationId: input.storageLocationId,
        });
      // Pending purchases register their serials as pending_receipt (unique now, in stock on approval)
      const commitSerials = serialLines.length
        ? await prepareSerialsInTxn(txn, { organizationId: orgId, branchId, lines: serialLines, action: { kind: "receive", outflowId, pending: pendingApproval } })
        : null;

      // === WRITES ===
      commitDocumentNumberInTxn(txn, outflowReservation);
      const outflowNumber = outflowReservation.formattedNumber;
      txn.set(outflowRef, { ...outflowDoc, outflowNumber });
      if (lockRef) {
        txn.set(lockRef, { organizationId: orgId, kind: "vendor_invoice", entityType: "outflow", entityId: outflowId, createdAt: now });
      }
      const effects = commitEffects ? commitEffects() : { paymentId: null };
      if (commitSerials) commitSerials();

      return {
        outflowId,
        organizationId: orgId,
        outflowNumber,
        kind: input.kind,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        paymentId: effects.paymentId,
        status: outflowDoc.status,
        message: pendingApproval
          ? `${isPurchase ? "Purchase" : "Expense"} submitted for approval (no stock or ledger effect until approved).`
          : `${isPurchase ? "Purchase" : "Expense"} recorded successfully.`,
      };
    });

    if (idempotency.recordId) {
      await finalizeIdempotencySuccess(idempotency.recordId, finalResult);
    }


    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_OUTFLOW_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create outflow: ${(error as Error).message}`);
  }
});

// ---------------------------------------------------------------------------
// outflowsList / outflowsGet
// ---------------------------------------------------------------------------

export const outflowsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListOutflowsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: OUTFLOW_READ });
  if (input.kind && !canViewKind(ctx, input.kind)) {
    throw new HttpsError("permission-denied", `[PERMISSION_DENIED] Viewing ${input.kind} records is not permitted.`, { reason: "PERMISSION_DENIED" });
  }
  const scope = await resolveDataScope(ctx, input.kind === OutflowKind.EXPENSE ? "expenses" : "purchases", AppPermissions.OUTFLOW_VIEW, input.branchId);

  let query: FirebaseFirestore.Query = db.collection("outflows").where("organizationId", "==", ctx.organizationId);
  if (input.kind) query = query.where("kind", "==", input.kind);
  if (input.vendorId) query = query.where("vendorId", "==", input.vendorId);
  if (input.status) query = query.where("status", "==", input.status);
  if (input.payeeMembershipId) query = query.where("payeeMembershipId", "==", input.payeeMembershipId);
  const scoped = applyDataScope(query, scope);

  const { snapshot, nextCursor } = await fetchPage(scoped.query, "outflows", input.startAfterId, input.limit || 50);
  let items = snapshot.docs
    .map((doc) => ({ outflowId: doc.id, ...(doc.data() as OutflowDoc) }))
    .filter((o) => scoped.keep(o as unknown as Record<string, unknown>))
    .filter((o) => canViewKind(ctx, o.kind) && canViewOutflow(o as unknown as Record<string, unknown>, ctx));

  if (input.startDate) items = items.filter((o) => (o.createdAt || o.docDate || "") >= input.startDate!);
  if (input.endDate) items = items.filter((o) => (o.createdAt || o.docDate || "") <= input.endDate!);
  if (input.minAmount !== undefined) items = items.filter((o) => (o.totalAmount || 0) >= input.minAmount!);
  if (input.maxAmount !== undefined) items = items.filter((o) => (o.totalAmount || 0) <= input.maxAmount!);
  if (input.search) {
    const s = input.search.toLowerCase();
    items = items.filter((o) =>
      (o.outflowNumber || "").toLowerCase().includes(s) ||
      (o.notes || "").toLowerCase().includes(s) ||
      (o.invoiceNumber || "").toLowerCase().includes(s) ||
      (o.payee || "").toLowerCase().includes(s)
    );
  }

  return { items, count: items.length, scope: scope.level, nextCursor, included: await hydrate(ctx, items) };
});

export const outflowsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { outflowId } = parseInput(GetOutflowSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: OUTFLOW_READ });

  const docSnap = await db.collection("outflows").doc(outflowId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Outflow record not found.");
  }

  const data = docSnap.data() as OutflowDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }
  const scope = await resolveDataScope(ctx, data.kind === OutflowKind.EXPENSE ? "expenses" : "purchases", AppPermissions.OUTFLOW_VIEW);
  if (!canViewKind(ctx, data.kind) || !canViewOutflow(data as unknown as Record<string, unknown>, ctx) ||
    !isInDataScope(data as unknown as Record<string, unknown>, scope)) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Outflow is outside your permissions or data scope.", { reason: "PERMISSION_DENIED" });
  }

  const outflow = { outflowId: docSnap.id, ...data };
  return { ...outflow, included: await hydrate(ctx, [outflow]) };
});

// ---------------------------------------------------------------------------
// outflowsApprove: maker–checker decision
// ---------------------------------------------------------------------------

/** Applies an approver's decision on a pending document (called by documentsDecide in approvals.ts). */
export async function decideOutflow(ctx: RequestContext, input: DocumentDecisionInput) {
  const ref = db.collection("outflows").doc(input.documentId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Outflow not found.");
    const doc = snap.data() as OutflowDoc;
    if (doc.organizationId !== ctx.organizationId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    assertCanDecide(ctx, doc.kind === OutflowKind.PURCHASE ? "purchase" : "expense", doc);
    const pendingSerials = linesFromRegistry(await serialsOf(ctx.organizationId, "receivedOutflowId", snap.id, txn), "receivedLineId");
    const commitSerials = pendingSerials.length
      ? await prepareSerialsInTxn(txn, { organizationId: ctx.organizationId, branchId: doc.branchId || "main-branch", lines: pendingSerials, action: input.decision === "reject" ? { kind: "discard_receipt", outflowId: snap.id } : { kind: "confirm_receipt", outflowId: snap.id } })
      : null;

    if (input.decision === "reject") {
      if (commitSerials) commitSerials();
      txn.update(ref, {
        status: "rejected",
        rejectedAt: now,
        rejectedBy: ctx.callerUid,
        approvalReason: input.reason || null,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      });
      return { outflowId: snap.id, status: "rejected" };
    }

    const paidAmount = doc.requestedPaidAmount || 0;
    const balanceAmount = Money.subtract(doc.totalAmount, paidAmount);
    const commitEffects = await prepareOutflowEffects(txn, {
      ctx,
      outflowId: snap.id,
      doc,
      branchId: doc.branchId || "main-branch",
      balanceAmount,
      paidAmount,
      paymentMethod: doc.requestedPaymentMethod || PaymentMethod.CASH,
      financialAccountId: doc.financialAccountId || null,
      splitPayments: doc.splitPayments,
      storageLocationId: doc.storageLocationId || undefined,
    });
    const effects = commitEffects();
    if (commitSerials) commitSerials();
    txn.update(ref, {
      status: OutflowStatus.CONFIRMED,
      paidAmount,
      balanceAmount,
      paymentStatus: paymentStatusFor(doc.totalAmount, paidAmount),
      approvedAt: now,
      approvedBy: ctx.callerUid,
      approvalReason: input.reason || null,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    });
    return { outflowId: snap.id, status: OutflowStatus.CONFIRMED, paymentId: effects.paymentId };
  });

  return result;
}

// ---------------------------------------------------------------------------
// outflowsVoid: reversal of a confirmed outflow / cancellation of a pending one
// ---------------------------------------------------------------------------

export const outflowsVoid = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(VoidDocumentSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.PURCHASE_VOID, AppPermissions.EXPENSE_VOID, AppPermissions.OUTFLOW_VOID],
  });
  const orgId = ctx.organizationId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "outflows.void",
    clientKey: input.idempotencyKey || `void_${input.documentId}`,
    payload: { documentId: input.documentId },
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const [returnsSnap, paymentsSnap] = await Promise.all([
      db.collection("returns").where("organizationId", "==", orgId).where("referenceId", "==", input.documentId).get(),
      db.collection("payments").where("organizationId", "==", orgId).where("referenceId", "==", input.documentId).get(),
    ]);
    if (returnsSnap.docs.some((d) => d.data().status !== "voided")) {
      throw new HttpsError("failed-precondition", "Purchase has returns recorded against it; void the returns first.");
    }

    const now = new Date().toISOString();
    const ref = db.collection("outflows").doc(input.documentId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Outflow not found.");
      const doc = snap.data() as OutflowDoc;
      if (doc.organizationId !== orgId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
      const voidPerm = doc.kind === OutflowKind.PURCHASE ? AppPermissions.PURCHASE_VOID : AppPermissions.EXPENSE_VOID;
      if (!ctx.can(voidPerm) && !ctx.can(AppPermissions.OUTFLOW_VOID)) {
        throw new HttpsError("permission-denied", `[PERMISSION_DENIED] "${voidPerm}" is required.`, { reason: "PERMISSION_DENIED" });
      }
      const lockRef = doc.vendorId && doc.invoiceNumber ? invoiceLockRef(orgId, doc.vendorId, doc.invoiceNumber) : null;

      const received = linesFromRegistry(await serialsOf(orgId, "receivedOutflowId", snap.id, txn), "receivedLineId");
      if (doc.status === "pending_approval" || doc.status === OutflowStatus.DRAFT) {
        const discard = received.length
          ? await prepareSerialsInTxn(txn, { organizationId: orgId, branchId: doc.branchId || "main-branch", lines: received, action: { kind: "discard_receipt", outflowId: snap.id } })
          : null;
        if (discard) discard();
        if (lockRef) txn.delete(lockRef);
        txn.update(ref, { status: "cancelled", voidReason: input.reason, voidedAt: now, voidedBy: ctx.callerUid, updatedAt: now, updatedBy: ctx.callerUid });
        return { outflowId: snap.id, status: "cancelled" };
      }
      if (doc.status !== OutflowStatus.CONFIRMED) {
        throw new HttpsError("failed-precondition", `Outflow in status "${doc.status}" cannot be voided.`);
      }

      // Reverse exactly what the receipt put into stock (good units only)
      const reversal: StockChangeItem[] = doc.kind === OutflowKind.PURCHASE
        ? doc.lines
          .filter((l) => l.productId && l.addToStock && (l.baseQuantity ?? l.quantity) > 0)
          .map((l) => ({
            productId: l.productId as string,
            quantity: -Math.abs(l.baseQuantity ?? l.quantity),
            type: StockMovementType.PURCHASE_RETURN_OUT,
            referenceId: snap.id,
            referenceModel: "outflow" as const,
            referenceLineId: l.lineId,
            reason: `Void of ${doc.outflowNumber}: ${input.reason}`,
          }))
        : [];
      const preparedStock = reversal.length
        ? await prepareStockChangesInTxn(txn, { organizationId: orgId, branchId: doc.branchId || "main-branch", actorUid: ctx.callerUid, items: reversal })
        : null;
      const vendRef = doc.kind === OutflowKind.PURCHASE && doc.vendorId ? db.collection("vendors").doc(doc.vendorId) : null;
      const vendSnap = vendRef ? await txn.get(vendRef) : null;
      // Serials received by this purchase must all still be in stock; they are removed with it
      const unreceive = received.length
        ? await prepareSerialsInTxn(txn, { organizationId: orgId, branchId: doc.branchId || "main-branch", lines: received, action: { kind: "void_receipt", outflowId: snap.id } })
        : null;

      // Prepare reversals for payments tied to financial accounts
      const paymentReversalPreps: Array<{
        prep: Awaited<ReturnType<typeof prepareAccountTransactionInTxn>>;
        pDoc: PaymentDoc;
      }> = [];
      for (const p of paymentsSnap.docs) {
        const pDoc = p.data() as PaymentDoc;
        if (pDoc.status === "completed" && pDoc.financialAccountId) {
          const prep = await prepareAccountTransactionInTxn(txn, {
            organizationId: orgId,
            financialAccountId: pDoc.financialAccountId,
            branchId: pDoc.branchId || doc.branchId,
            type: "reversal",
            direction: pDoc.direction === "in" ? "out" : "in",
            amount: pDoc.amount,
            sourceDocumentType: "outflow",
            sourceDocumentId: snap.id,
            description: `Void outflow ${doc.outflowNumber}`,
            actorUid: ctx.callerUid,
          });
          paymentReversalPreps.push({ prep, pDoc });
        }
      }

      if (preparedStock) commitStockChangesInTxn(txn, preparedStock);
      if (unreceive) unreceive();
      if (vendRef && vendSnap?.exists) {
        const vend = vendSnap.data() as VendorDoc;
        txn.update(vendRef, {
          totalPurchase: Money.amount((vend.totalPurchase || 0) - doc.totalAmount),
          outstandingPayable: Money.amount((vend.outstandingPayable || 0) - doc.balanceAmount),
          updatedAt: now,
        });
      }

      for (const pr of paymentReversalPreps) {
        applyAccountTransactionInTxn(txn, pr.prep, {
          organizationId: orgId,
          financialAccountId: pr.pDoc.financialAccountId!,
          branchId: pr.pDoc.branchId || doc.branchId,
          type: "reversal",
          direction: pr.pDoc.direction === "in" ? "out" : "in",
          amount: pr.pDoc.amount,
          sourceDocumentType: "outflow",
          sourceDocumentId: snap.id,
          description: `Void outflow ${doc.outflowNumber}`,
          actorUid: ctx.callerUid,
        });
      }

      let voidedPayments = 0;
      for (const p of paymentsSnap.docs) {
        if ((p.data() as PaymentDoc).status !== "completed") continue;
        txn.update(p.ref, { status: "voided", voidReason: `Outflow ${doc.outflowNumber} voided`, updatedAt: now, updatedBy: ctx.callerUid });
        voidedPayments++;
      }
      if (lockRef) txn.delete(lockRef);
      txn.update(ref, { status: OutflowStatus.VOIDED, voidReason: input.reason, voidedAt: now, voidedBy: ctx.callerUid, updatedAt: now, updatedBy: ctx.callerUid });
      return { outflowId: snap.id, status: OutflowStatus.VOIDED, reversedStockLines: reversal.length, voidedPayments };
    });

    if (idempotency.recordId) {
      await finalizeIdempotencySuccess(idempotency.recordId, result);
    }
    return result;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "VOID_OUTFLOW_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to void outflow: ${(error as Error).message}`);
  }
});

