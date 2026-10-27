/**
 * Shared Billing & Sales Engine Callables (POS & B2B)
 * 
 * Strict architectural rule:
 * - Single collection `bills` for both POS counter sales and B2B wholesale invoices
 * - References `customerId` by ID; optional justified `customerSnapshot` for invoice printing
 * - Product details stored as explicit `*Snapshot` fields on line items
 * - Decrements physical inventory `currentStock` transactionally
 * - Records payment ledger entries for tenders
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateBillSchema,
  ListBillsSchema,
  FinalizeBillSchema,
} from "../validation/schemas.js";
import {
  BillDoc,
  BillItem,
  ProductDoc,
  OrganizationDoc,
  MembershipDoc,
  PaymentDoc,
} from "../types/models.js";
import {
  SalesMode,
  PaymentStatus,
  StockMovementType,
  PaymentDirection,
  PartyType,
  PaymentMethod,
  DocumentType,
} from "../constants/enums.js";
import { Money } from "../services/money.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
  DocumentTypePrefix,
} from "../services/documentCounter.js";
import { calculateTax } from "../services/taxCalculation.js";
import {
  prepareStockChangesInTxn,
  commitStockChangesInTxn,
  StockChangeItem,
} from "../services/stockEngine.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const billsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateBillSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "bills.create",
    clientKey: input.idempotencyKey,
    payload: input as unknown as Record<string, unknown>,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const orgDoc = await db.collection("organizations").doc(input.organizationId).get();
    if (!orgDoc.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const orgData = orgDoc.data() as OrganizationDoc;

    const billRef = db.collection("bills").doc();
    const billId = billRef.id;
    const now = new Date().toISOString();
    const currency = orgData.currency || "INR";

    const docType = input.documentType || DocumentType.INVOICE;
    const isQuotationOrDraft =
      input.status === "draft" ||
      docType === DocumentType.QUOTATION ||
      docType === DocumentType.PROFORMA;

    let prefix: DocumentTypePrefix = "POS";
    if (docType === DocumentType.QUOTATION) {
      prefix = "QTN";
    } else if (docType === DocumentType.PROFORMA) {
      prefix = "PRO";
    } else if (docType === DocumentType.SALES_ORDER) {
      prefix = "SO";
    } else if (input.salesMode === SalesMode.B2B) {
      prefix = "INV";
    }

    // 1. Fetch products to capture snapshots and pricing
    const processedItems: BillItem[] = [];
    const stockChangeItems: StockChangeItem[] = [];
    let subTotal = 0;
    let taxTotal = 0;

    for (const rawItem of input.items) {
      const prodDoc = await db.collection("products").doc(rawItem.productId).get();
      if (!prodDoc.exists) {
        throw new HttpsError("not-found", `Product "${rawItem.productId}" not found.`);
      }

      const prodData = prodDoc.data() as ProductDoc;
      if (prodData.organizationId !== input.organizationId) {
        throw new HttpsError("permission-denied", `Cross-tenant product access rejected for "${rawItem.productId}".`);
      }

      const price = rawItem.unitPriceOverride !== undefined 
        ? Money.rate(rawItem.unitPriceOverride) 
        : prodData.sellingPrice;
      const lineSubtotal = Money.amount(price * rawItem.quantity, currency);
      const discount = Money.amount(Math.min(lineSubtotal, rawItem.discountValue || 0), currency);
      const taxable = Money.subtract(lineSubtotal, discount, currency);

      const taxRate = prodData.taxRatePercent || 0;
      const lineTax = taxRate > 0 ? Money.percent(taxable, taxRate, currency) : 0;
      const lineTotal = Money.amount(taxable + lineTax, currency);

      subTotal = Money.amount(subTotal + lineSubtotal, currency);
      taxTotal = Money.amount(taxTotal + lineTax, currency);

      processedItems.push({
        productId: rawItem.productId,
        nameSnapshot: prodData.name,
        priceSnapshot: price,
        costSnapshot: prodData.costPrice || 0,
        taxCodeSnapshot: prodData.taxCode || "",
        quantity: Money.qty(rawItem.quantity),
        unit: rawItem.unit || prodData.baseUnit || "piece",
        subtotal: lineSubtotal,
        discountValue: discount,
        taxAmount: lineTax,
        lineTotal,
      });

      // Stock deduction item ONLY if this bill is active (NOT a quotation or draft!)
      if (!isQuotationOrDraft && prodData.trackStock) {
        stockChangeItems.push({
          productId: rawItem.productId,
          quantity: -Math.abs(rawItem.quantity), // Negative reduction
          type: StockMovementType.SALE_OUT,
          unit: rawItem.unit || prodData.baseUnit || "piece",
          referenceId: billId,
          referenceModel: "bill",
          reason: `Sale ${billId}`,
        });
      }
    }

    const discountTotal = Money.amount(Math.min(subTotal, input.discountTotal || 0), currency);
    const taxableTotal = Money.subtract(subTotal, discountTotal, currency);
    const rawTotal = taxableTotal + taxTotal;
    const totalAmount = Money.roundCurrency(rawTotal, currency);
    const roundOff = Money.roundCurrency(totalAmount - rawTotal, currency);

    // Draft / quotation cannot have tender payment
    const paidAmount = isQuotationOrDraft ? 0 : Math.min(totalAmount, Math.max(0, input.paidAmount || 0));
    const balanceAmount = Money.subtract(totalAmount, paidAmount, currency);

    let paymentStatus = PaymentStatus.PENDING;
    if (!isQuotationOrDraft) {
      if (paidAmount >= totalAmount) {
        paymentStatus = PaymentStatus.PAID;
      } else if (paidAmount > 0) {
        paymentStatus = PaymentStatus.PARTIAL;
      }
    }

    const billStatus = isQuotationOrDraft ? "draft" : "active";

    // Tax snapshot
    const taxResult = calculateTax({
      taxRegimeCode: orgData.taxRegimeCode,
      country: orgData.country,
      subTotal: subTotal - discountTotal,
    });

    const callerUid = request.auth.uid;

    // Execute atomic transaction for bill creation, document numbering, stock deduction, and payments
    const finalResult = await db.runTransaction(async (txn) => {
      // === PHASE 1: ALL READS FIRST (Firestore requirement) ===
      const billReservation = await readNextDocumentNumberInTxn(txn, {
        organizationId: input.organizationId,
        type: prefix,
      });

      let paymentReservation = null;
      if (paidAmount > 0) {
        paymentReservation = await readNextDocumentNumberInTxn(txn, {
          organizationId: input.organizationId,
          type: "PAY",
        });
      }

      let preparedStock = null;
      if (stockChangeItems.length > 0) {
        preparedStock = await prepareStockChangesInTxn(txn, {
          organizationId: input.organizationId,
          actorUid: callerUid,
          items: stockChangeItems,
        });
      }

      // === PHASE 2: ALL WRITES AFTER ALL READS ===
      commitDocumentNumberInTxn(txn, billReservation);
      const billNumber = billReservation.formattedNumber;

      const billDoc: BillDoc = {
        organizationId: input.organizationId,
        billNumber,
        salesMode: input.salesMode || SalesMode.POS,
        documentType: docType,
        customerId: input.customerId || null,
        customerSnapshot: input.customerSnapshot || null,
        items: processedItems,
        subTotal,
        discountTotal,
        taxTotal,
        roundOff,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        status: billStatus,
        taxSnapshot: taxResult.taxSnapshot,
        notes: input.notes,
        createdAt: now,
        createdBy: callerUid,
      };

      txn.set(billRef, billDoc);

      // Decrement stock balance transactionally (ONLY if active bill, not quotation/draft!)
      if (preparedStock) {
        commitStockChangesInTxn(txn, preparedStock);
      }

      // If paid amount > 0, record payment entry
      let paymentId: string | null = null;
      if (paidAmount > 0 && paymentReservation) {
        commitDocumentNumberInTxn(txn, paymentReservation);
        const paymentRef = db.collection("payments").doc();
        paymentId = paymentRef.id;

        const paymentDoc: PaymentDoc = {
          organizationId: input.organizationId,
          paymentNumber: paymentReservation.formattedNumber,
          direction: PaymentDirection.IN,
          partyType: PartyType.CUSTOMER,
          partyId: input.customerId || null,
          partyName: input.customerSnapshot?.name || "Counter Customer",
          amount: paidAmount,
          method: (input.paymentMethod as PaymentMethod) || PaymentMethod.CASH,
          referenceId: billId,
          referenceModel: "bill",
          referenceNumber: billNumber,
          status: "completed",
          createdAt: now,
          createdBy: callerUid,
        };

        txn.set(paymentRef, paymentDoc);
      }

      return {
        billId,
        organizationId: input.organizationId,
        billNumber,
        salesMode: billDoc.salesMode,
        documentType: docType,
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus,
        paymentId,
        status: billStatus,
        message: isQuotationOrDraft
          ? "Quotation / Draft created successfully (stock unaffected)."
          : "Bill generated successfully.",
      };
    });

    if (idempotency.recordId) {
      const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      await idempRef.update({
        status: "succeeded",
        result: finalResult,
        updatedAt: now,
      });
    }

    await createAuditLog({
      organizationId: input.organizationId,
      actorUid: request.auth.uid,
      action: "BILL_CREATED",
      entityType: "bill",
      entityId: billId,
      details: {
        number: finalResult.billNumber,
        totalAmount,
        paidAmount,
        salesMode: finalResult.salesMode,
      },
    });

    return finalResult;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_BILL_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create bill: ${(error as Error).message}`);
  }
});

export const billsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListBillsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("bills")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.salesMode) {
    query = query.where("salesMode", "==", input.salesMode);
  }
  if (input.customerId) {
    query = query.where("customerId", "==", input.customerId);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    billId: doc.id,
    ...(doc.data() as BillDoc),
  }));

  return { items, count: items.length };
});

export const billsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const billId = request.data?.billId;
  const organizationId = request.data?.organizationId;
  if (!billId || !organizationId) {
    throw new HttpsError("invalid-argument", "billId and organizationId required.");
  }

  await verifyTenantAccess(request.auth, organizationId);

  const docSnap = await db.collection("bills").doc(billId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Bill not found.");
  }

  const data = docSnap.data() as BillDoc;
  if (data.organizationId !== organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return { billId: docSnap.id, ...data };
});

export const billsFinalize = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = FinalizeBillSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const billRef = db.collection("bills").doc(input.billId);
  const billSnap = await billRef.get();
  if (!billSnap.exists) {
    throw new HttpsError("not-found", "Bill not found.");
  }
  const billData = billSnap.data() as BillDoc;
  if (billData.organizationId !== input.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  if (billData.status !== "draft") {
    throw new HttpsError(
      "failed-precondition",
      `Only draft / quotation bills can be finalized. Current status: "${billData.status}".`
    );
  }

  const callerUid = request.auth.uid;
  const now = new Date().toISOString();

  // Prepare stock deduction items for the finalized bill
  const stockChangeItems: StockChangeItem[] = [];
  for (const item of billData.items) {
    stockChangeItems.push({
      productId: item.productId,
      quantity: -Math.abs(item.quantity),
      type: StockMovementType.SALE_OUT,
      unit: item.unit,
      referenceId: input.billId,
      referenceModel: "bill",
      reason: `Finalized Bill ${billData.billNumber}`,
    });
  }

  await db.runTransaction(async (txn) => {
    // 1. Transaction Read phase: Validate stock availability
    let preparedStock = null;
    if (stockChangeItems.length > 0) {
      preparedStock = await prepareStockChangesInTxn(txn, {
        organizationId: input.organizationId,
        actorUid: callerUid,
        items: stockChangeItems,
      });
    }

    // 2. Transaction Write phase: Decrement stock & update status
    if (preparedStock) {
      commitStockChangesInTxn(txn, preparedStock);
    }

    txn.update(billRef, {
      status: "active",
      documentType: DocumentType.INVOICE,
      updatedAt: now,
    });
  });

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: callerUid,
    action: "BILL_FINALIZED",
    entityType: "bill",
    entityId: input.billId,
    details: {
      billNumber: billData.billNumber,
      totalAmount: billData.totalAmount,
    },
  });

  return {
    billId: input.billId,
    status: "active",
    message: "Bill finalized successfully. Inventory stock decremented.",
  };
});
