/**
 * Inventory and Financial Ledger Reconciliation Service
 * 
 * Verifies mathematical integrity across:
 * 1. Product currentStock vs immutable stockMovements ledger
 * 2. Customer outstandingBalance / totalSpend vs bills and payments
 * 3. Vendor outstandingPayable / totalPurchase vs outflows and payments
 */

import { db } from "./firebase.js";
import { ProductDoc, StockMovementDoc, CustomerDoc, VendorDoc, BillDoc, OutflowDoc, PaymentDoc, ReturnDoc, OrganizationDoc } from "../types/models.js";
import { Money } from "./money.js";
import { PaymentDirection, PartyType } from "../constants/enums.js";

export interface StockReconciliationItem {
  productId: string;
  name: string;
  currentStock: number;
  movementSum: number;
  difference: number;
  isDiscrepancy: boolean;
}

export interface StockReconciliationReport {
  organizationId: string;
  checkedCount: number;
  discrepancyCount: number;
  items: StockReconciliationItem[];
  timestamp: string;
}

export interface PartyReconciliationItem {
  partyId: string;
  partyType: "customer" | "vendor";
  name: string;
  recordedBalance: number;
  calculatedBalance: number;
  balanceDifference: number;
  recordedVolume: number;
  calculatedVolume: number;
  volumeDifference: number;
  isDiscrepancy: boolean;
}

export interface PartyReconciliationReport {
  organizationId: string;
  partyType: "customer" | "vendor";
  checkedCount: number;
  discrepancyCount: number;
  items: PartyReconciliationItem[];
  timestamp: string;
}

/**
 * Reconciles product currentStock balances against the historical stockMovements ledger.
 */
export async function reconcileStock(
  organizationId: string,
  productId?: string,
  repair: boolean = false,
  branchId?: string
): Promise<StockReconciliationReport> {
  const now = new Date().toISOString();
  let productDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

  if (productId) {
    const snap = await db.collection("products").doc(productId).get();
    if (snap.exists && (snap.data() as ProductDoc).organizationId === organizationId) {
      productDocs = [snap as unknown as FirebaseFirestore.QueryDocumentSnapshot];
    }
  } else {
    const snap = await db.collection("products")
      .where("organizationId", "==", organizationId)
      .get();
    productDocs = snap.docs;
  }

  const items: StockReconciliationItem[] = [];
  let discrepancyCount = 0;

  for (const doc of productDocs) {
    const pData = doc.data() as ProductDoc;
    const prodId = doc.id;

    // Aggregate movements for this product (optionally scoped to branch)
    let movQuery: FirebaseFirestore.Query = db.collection("stockMovements")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", prodId);

    if (branchId) {
      movQuery = movQuery.where("branchId", "==", branchId);
    }

    const movSnap = await movQuery.get();

    let sum = 0;
    for (const mDoc of movSnap.docs) {
      const m = mDoc.data() as StockMovementDoc;
      sum += (m.quantity || 0);
    }

    let currentStock = pData.currentStock || 0;
    if (branchId) {
      const balanceSnap = await db.collection("stockBalances").doc(`${organizationId}_${branchId}_${prodId}`).get();
      if (balanceSnap.exists) {
        currentStock = (balanceSnap.data() as any).currentStock || 0;
      }
    }

    const roundedSum = Money.qty(sum, 4);
    const difference = Money.qty(currentStock - roundedSum, 4);
    const isDiscrepancy = Math.abs(difference) > 0.0001;

    if (isDiscrepancy) {
      discrepancyCount++;
      if (repair) {
        await doc.ref.update({
          currentStock: roundedSum,
          updatedAt: now,
        });
        if (branchId) {
          const balanceRef = db.collection("stockBalances").doc(`${organizationId}_${branchId}_${prodId}`);
          await balanceRef.set({
            organizationId,
            branchId,
            productId: prodId,
            currentStock: roundedSum,
            updatedAt: now,
            updatedBy: "reconciliation_repair",
          }, { merge: true });
        }
      }
    }

    items.push({
      productId: prodId,
      name: pData.name,
      currentStock,
      movementSum: roundedSum,
      difference,
      isDiscrepancy,
    });
  }

  return {
    organizationId,
    checkedCount: items.length,
    discrepancyCount,
    items,
    timestamp: now,
  };
}

/**
 * Reconciles customer / vendor ledger accounts against invoices, outflows, and payments.
 */
export async function reconcilePartyBalances(
  organizationId: string,
  partyType: "customer" | "vendor",
  partyId?: string
): Promise<PartyReconciliationReport> {
  const now = new Date().toISOString();
  const collectionName = partyType === "customer" ? "customers" : "vendors";
  let partyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

  if (partyId) {
    const snap = await db.collection(collectionName).doc(partyId).get();
    if (snap.exists && (snap.data() as (CustomerDoc | VendorDoc)).organizationId === organizationId) {
      partyDocs = [snap as unknown as FirebaseFirestore.QueryDocumentSnapshot];
    }
  } else {
    const snap = await db.collection(collectionName)
      .where("organizationId", "==", organizationId)
      .get();
    partyDocs = snap.docs;
  }

  const items: PartyReconciliationItem[] = [];
  let discrepancyCount = 0;

  for (const doc of partyDocs) {
    const pId = doc.id;

    if (partyType === "customer") {
      const cust = doc.data() as CustomerDoc;
      // 1. Fetch active bills for this customer
      const billsSnap = await db.collection("bills")
        .where("organizationId", "==", organizationId)
        .where("customerId", "==", pId)
        .where("status", "==", "active")
        .get();

      let totalBilled = 0;
      let totalBillPaid = 0;
      for (const b of billsSnap.docs) {
        const bData = b.data() as BillDoc;
        totalBilled += (bData.totalAmount || 0);
        totalBillPaid += (bData.paidAmount || 0);
      }

      // 2. Fetch payments from this customer
      const paySnap = await db.collection("payments")
        .where("organizationId", "==", organizationId)
        .where("partyType", "==", PartyType.CUSTOMER)
        .where("partyId", "==", pId)
        .where("status", "==", "completed")
        .get();

      let totalPaymentsIn = 0;
      for (const p of paySnap.docs) {
        const pData = p.data() as PaymentDoc;
        if (pData.direction === PaymentDirection.IN) {
          totalPaymentsIn += (pData.amount || 0);
        }
      }

      // 3. Fetch credit note returns for this customer
      const returnsSnap = await db.collection("returns")
        .where("organizationId", "==", organizationId)
        .where("partyId", "==", pId)
        .where("returnType", "==", "sales_return")
        .where("status", "==", "completed")
        .get();

      let totalCreditNotes = 0;
      for (const r of returnsSnap.docs) {
        const rData = r.data() as ReturnDoc;
        if (rData.refundMethod === "credit_note") {
          totalCreditNotes += (rData.totalRefundAmount || 0);
        }
      }

      const calculatedBalance = Money.amount(Math.max(0, totalBilled - totalBillPaid - totalCreditNotes));
      const recordedBalance = Money.amount(cust.outstandingBalance || 0);
      const balanceDifference = Money.amount(recordedBalance - calculatedBalance);
      const recordedVolume = Money.amount(cust.totalSpend || 0);
      const calculatedVolume = Money.amount(totalBilled);
      const volumeDifference = Money.amount(recordedVolume - calculatedVolume);
      const paymentLedgerDifference = Money.amount(totalPaymentsIn - totalBillPaid);

      const isDiscrepancy = Math.abs(balanceDifference) > 0.01 || Math.abs(paymentLedgerDifference) > 0.01;
      if (isDiscrepancy) discrepancyCount++;

      items.push({
        partyId: pId,
        partyType: "customer",
        name: cust.name,
        recordedBalance,
        calculatedBalance,
        balanceDifference,
        recordedVolume,
        calculatedVolume,
        volumeDifference,
        isDiscrepancy,
      });
    } else {
      const vend = doc.data() as VendorDoc;
      // 1. Fetch confirmed purchases for this vendor
      const outflowsSnap = await db.collection("outflows")
        .where("organizationId", "==", organizationId)
        .where("vendorId", "==", pId)
        .where("kind", "==", "purchase")
        .where("status", "==", "confirmed")
        .get();

      let totalPurchased = 0;
      let totalOutflowPaid = 0;
      for (const o of outflowsSnap.docs) {
        const oData = o.data() as OutflowDoc;
        totalPurchased += (oData.totalAmount || 0);
        totalOutflowPaid += (oData.paidAmount || 0);
      }

      // 2. Fetch payments to this vendor
      const paySnap = await db.collection("payments")
        .where("organizationId", "==", organizationId)
        .where("partyType", "==", PartyType.VENDOR)
        .where("partyId", "==", pId)
        .where("status", "==", "completed")
        .get();

      let totalPaymentsOut = 0;
      for (const p of paySnap.docs) {
        const pData = p.data() as PaymentDoc;
        if (pData.direction === PaymentDirection.OUT) {
          totalPaymentsOut += (pData.amount || 0);
        }
      }

      // 3. Fetch debit note / credit reduction returns for this vendor
      const returnsSnap = await db.collection("returns")
        .where("organizationId", "==", organizationId)
        .where("partyId", "==", pId)
        .where("returnType", "==", "purchase_return")
        .where("status", "==", "completed")
        .get();

      let totalDebitNotes = 0;
      for (const r of returnsSnap.docs) {
        const rData = r.data() as ReturnDoc;
        totalDebitNotes += (rData.totalRefundAmount || 0);
      }

      const calculatedBalance = Money.amount(Math.max(0, totalPurchased - totalOutflowPaid - totalDebitNotes));
      const recordedBalance = Money.amount(vend.outstandingPayable || 0);
      const balanceDifference = Money.amount(recordedBalance - calculatedBalance);
      const recordedVolume = Money.amount(vend.totalPurchase || 0);
      const calculatedVolume = Money.amount(totalPurchased);
      const volumeDifference = Money.amount(recordedVolume - calculatedVolume);
      const disbursementLedgerDifference = Money.amount(totalPaymentsOut - totalOutflowPaid);

      const isDiscrepancy = Math.abs(balanceDifference) > 0.01 || Math.abs(disbursementLedgerDifference) > 0.01;
      if (isDiscrepancy) discrepancyCount++;

      items.push({
        partyId: pId,
        partyType: "vendor",
        name: vend.name,
        recordedBalance,
        calculatedBalance,
        balanceDifference,
        recordedVolume,
        calculatedVolume,
        volumeDifference,
        isDiscrepancy,
      });
    }
  }

  return {
    organizationId,
    partyType,
    checkedCount: items.length,
    discrepancyCount,
    items,
    timestamp: now,
  };
}

export interface BranchCountReconciliationReport {
  organizationId: string;
  recordedBranchCount: number;
  actualActiveBranches: number;
  difference: number;
  isDiscrepancy: boolean;
  repaired: boolean;
  activeBranchIds: string[];
  timestamp: string;
}

/**
 * Reconciles organization.branchCount against active branches in organizations/{orgId}/branches
 */
export async function reconcileBranchCounts(
  organizationId: string,
  repair: boolean = false
): Promise<BranchCountReconciliationReport> {
  const now = new Date().toISOString();
  const orgRef = db.collection("organizations").doc(organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new Error(`Organization "${organizationId}" not found.`);
  }

  const orgData = orgSnap.data() as OrganizationDoc;
  const recordedBranchCount = typeof orgData.branchCount === "number" ? orgData.branchCount : 1;

  const branchesSnap = await orgRef.collection("branches").where("isActive", "==", true).get();
  const actualActiveBranches = branchesSnap.size;
  const activeBranchIds = branchesSnap.docs.map((d) => d.id);
  const difference = recordedBranchCount - actualActiveBranches;
  const isDiscrepancy = difference !== 0;

  let repaired = false;
  if (isDiscrepancy && repair) {
    await orgRef.update({
      branchCount: actualActiveBranches,
      updatedAt: now,
    });
    repaired = true;
  }

  return {
    organizationId,
    recordedBranchCount,
    actualActiveBranches,
    difference,
    isDiscrepancy,
    repaired,
    activeBranchIds,
    timestamp: now,
  };
}


