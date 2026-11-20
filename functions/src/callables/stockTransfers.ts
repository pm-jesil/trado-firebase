/**
 * Inter-Branch Stock Transfers Callables (Phase 2, Gap G6)
 * 
 * Provides:
 * - Complete stock transfer workflow (draft -> submitted -> approved -> dispatched -> received/partially_received)
 * - Exact unit conversion (unit, quantity, frozen conversionFactor, baseQuantity) with integer validation
 * - In-transit stock tracking (inTransitQty on stockBalances & branchProductStock)
 * - Source WAC cost carry and destination WAC recalculation (inventory valuation conservation)
 * - Full serial tracking during transit (prepareSerialsInTxn)
 * - Storage locations and warehouse scoping (storageLocations)
 * - Discrepancy resolution (stockTransfersResolveDiscrepancy -> return_to_source | write_off | claim_carrier)
 * - Optimistic concurrency precondition (version check, closing U-7)
 * - Complete state machine transition table (closing U-6)
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateStockTransferSchema,
  SubmitStockTransferSchema,
  CancelStockTransferSchema,
  DispatchStockTransferSchema,
  ReceiveStockTransferSchema,
  ResolveTransferDiscrepancySchema,
  ListStockTransfersSchema,
  GetStockTransferSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  StockTransferDoc,
  StockTransferLine,
  StockTransferStatus,
  StockMovementDoc,
  StockBalanceDoc,
  ProductDoc,
  OutflowDoc,
} from "../types/models.js";
import { StockMovementType, OutflowKind, OutflowStatus, PaymentStatus } from "../constants/enums.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";
import {
  resolveUnitConversion,
} from "../services/stockEngine.js";
import { calculateNewWeightedAverageCost } from "../services/costingEngine.js";
import { Money, roundQty } from "../services/money.js";
import {
  prepareSerialsInTxn,
  assertSerialCount,
  SerialLine,
} from "../services/serials.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";

// State Machine Allowed Transitions (U-6)
export const ALLOWED_TRANSFER_TRANSITIONS: Record<StockTransferStatus, StockTransferStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled", "dispatched"],
  approved: ["dispatched", "cancelled"],
  dispatched: ["received", "partially_received"],
  partially_received: ["received"],
  received: [],
  rejected: [],
  cancelled: [],
};

export function assertValidTransferTransition(current: StockTransferStatus, target: StockTransferStatus): void {
  const allowed = ALLOWED_TRANSFER_TRANSITIONS[current] || [];
  if (!allowed.includes(target)) {
    throw new HttpsError(
      "failed-precondition",
      `Illegal stock transfer status transition from "${current}" to "${target}". Allowed: ${allowed.join(", ") || "none (terminal state)"}.`
    );
  }
}

export const stockTransfersCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.sourceBranchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_CREATE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const currency = ctx.organization.currency;
  const now = new Date().toISOString();

  const isSameBranch = input.sourceBranchId === input.destinationBranchId;
  const isInternal = isSameBranch || input.internal === true;
  if (isSameBranch) {
    if (!input.sourceLocationId || !input.destinationLocationId || input.sourceLocationId === input.destinationLocationId) {
      throw new HttpsError(
        "invalid-argument",
        "Intra-branch transfers require distinct source and destination storage locations."
      );
    }
  }

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "stockTransfers.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  const transferRef = db.collection("stockTransfers").doc();
  const transferId = transferRef.id;

  const result = await db.runTransaction(async (txn) => {
    const reservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "TRF",
    });

    // Verify destination branch exists and belongs to same organization
    const destBranchRef = db
      .collection("organizations")
      .doc(orgId)
      .collection("branches")
      .doc(input.destinationBranchId);
    const destBranchSnap = await txn.get(destBranchRef);
    if (!destBranchSnap.exists) {
      throw new HttpsError("not-found", `Destination branch "${input.destinationBranchId}" not found.`);
    }

    // Verify source location belongs to source branch
    if (input.sourceLocationId) {
      const locRef = db.collection("storageLocations").doc(input.sourceLocationId);
      const locSnap = await txn.get(locRef);
      if (!locSnap.exists || locSnap.data()?.organizationId !== orgId || locSnap.data()?.branchId !== input.sourceBranchId) {
        throw new HttpsError("invalid-argument", "Source storage location does not belong to source branch.");
      }
    }

    // Verify destination location belongs to destination branch
    if (input.destinationLocationId) {
      const locRef = db.collection("storageLocations").doc(input.destinationLocationId);
      const locSnap = await txn.get(locRef);
      if (!locSnap.exists || locSnap.data()?.organizationId !== orgId || locSnap.data()?.branchId !== input.destinationBranchId) {
        throw new HttpsError("invalid-argument", "Destination storage location does not belong to destination branch.");
      }
    }

    // Verify all products exist and calculate units, conversions and frozen cost
    const resolvedItems: StockTransferLine[] = [];
    let totalValuation = 0;

    for (const item of input.items) {
      const prodRef = db.collection("products").doc(item.productId);
      const prodSnap = await txn.get(prodRef);
      if (!prodSnap.exists) {
        throw new HttpsError("not-found", `Product "${item.productId}" not found.`);
      }
      const prodData = prodSnap.data() as ProductDoc;
      if (prodData.organizationId !== orgId) {
        throw new HttpsError("permission-denied", `Product "${item.productId}" does not belong to this organization.`);
      }

      const rawQty = item.requestedQty ?? item.quantity ?? 1;
      const unitConv = resolveUnitConversion(prodData, item.unit);
      const conversionFactor = item.conversionFactor || unitConv.factor;
      const baseQuantity = roundQty(rawQty * conversionFactor, 4);

      // Whole-number validation for non-fractional units
      const isFractional = ["kg", "g", "meter", "m", "cm", "liter", "l", "ml"].includes((unitConv.unit || "").toLowerCase());
      if (!isFractional) {
        if (!Number.isInteger(rawQty)) {
          throw new HttpsError("invalid-argument", `Quantity for non-fractional item "${prodData.name}" must be an integer, got ${rawQty}.`);
        }
        if (!Number.isInteger(baseQuantity)) {
          throw new HttpsError("invalid-argument", `Base quantity for non-fractional item "${prodData.name}" must be an integer, got ${baseQuantity}.`);
        }
      }

      const unitCost = prodData.weightedAverageCost && prodData.weightedAverageCost > 0
        ? prodData.weightedAverageCost
        : (prodData.costPrice || 0);
      const lineTotalCost = Money.amount(unitCost * baseQuantity, currency);
      totalValuation = Money.amount(totalValuation + lineTotalCost, currency);

      resolvedItems.push({
        productId: item.productId,
        requestedQty: rawQty,
        quantity: rawQty,
        unit: unitConv.unit,
        conversionFactor,
        baseQuantity,
        unitCost,
        totalCost: lineTotalCost,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        notes: item.notes,
      });
    }

    commitDocumentNumberInTxn(txn, reservation);
    const transferNumber = reservation.formattedNumber;

    const transferDoc: StockTransferDoc = {
      organizationId: orgId,
      transferNumber,
      sourceBranchId: input.sourceBranchId,
      destinationBranchId: input.destinationBranchId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      internal: isInternal,
      status: "draft",
      version: 1,
      items: resolvedItems,
      totalValuation: Money.amount(totalValuation, currency),
      handlingFee: input.handlingFee,
      handlingFeeFinancialAccountId: input.handlingFeeFinancialAccountId,
      discrepancyStatus: "none",
      notes: input.notes,
      createdAt: now,
      createdBy: callerUid,
      createdByMembershipId: ctx.membershipId || null,
      updatedAt: now,
      updatedBy: callerUid,
    };

    txn.set(transferRef, transferDoc);

    return {
      transferId,
      transfer: {
        transferId,
        ...transferDoc,
      },
      message: "Stock transfer draft created successfully.",
    };
  });

  return result;
});

export const stockTransfersSubmit = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(SubmitStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_CREATE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  return await db.runTransaction(async (txn) => {
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }

    const data = snap.data() as StockTransferDoc;
    if (data.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    assertValidTransferTransition(data.status, "submitted");

    // Optimistic Concurrency Precondition (U-7)
    if (input.version !== undefined && data.version !== undefined && data.version !== input.version) {
      throw new HttpsError("failed-precondition", "VERSION_MISMATCH: Concurrent edit detected. Please refresh and retry.");
    }

    const now = new Date().toISOString();
    const nextVersion = (data.version || 1) + 1;

    txn.update(transferRef, {
      status: "submitted",
      version: nextVersion,
      submittedAt: now,
      submittedBy: callerUid,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      success: true,
      status: "submitted",
      version: nextVersion,
      message: "Stock transfer submitted for approval.",
    };
  });
});

export const stockTransfersCancel = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CancelStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_CREATE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  return await db.runTransaction(async (txn) => {
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }

    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    assertValidTransferTransition(transfer.status, "cancelled");

    // Optimistic Concurrency Precondition (U-7)
    if (input.version !== undefined && transfer.version !== undefined && transfer.version !== input.version) {
      throw new HttpsError("failed-precondition", "VERSION_MISMATCH: Concurrent edit detected. Please refresh and retry.");
    }

    const now = new Date().toISOString();
    const nextVersion = (transfer.version || 1) + 1;

    // If cancelled after dispatch, return in-transit stock back to source branch
    if (transfer.status === "dispatched") {
      for (const line of transfer.items) {
        const factor = line.conversionFactor || 1;
        const dispatchedQty = line.dispatchedQty ?? line.requestedQty;
        const dispatchedBase = line.dispatchedBaseQuantity ?? roundQty(dispatchedQty * factor, 4);

        if (dispatchedBase > 0) {
          const sourceStockBalanceRef = db.collection("stockBalances").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`);
          const sourceStockSnap = await txn.get(sourceStockBalanceRef);
          const sourceBalance = sourceStockSnap.exists ? (sourceStockSnap.data() as StockBalanceDoc) : null;
          const currentStock = sourceBalance?.currentStock || 0;
          const currentInTransit = sourceBalance?.inTransitQty || dispatchedBase;

          const newSourceStock = roundQty(currentStock + dispatchedBase, 4);
          const newInTransit = Math.max(0, roundQty(currentInTransit - dispatchedBase, 4));

          txn.set(
            sourceStockBalanceRef,
            {
              organizationId: orgId,
              branchId: transfer.sourceBranchId,
              productId: line.productId,
              currentStock: newSourceStock,
              inTransitQty: newInTransit,
              updatedAt: now,
              updatedBy: callerUid,
            },
            { merge: true }
          );

          txn.set(
            db.collection("branchProductStock").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`),
            { currentStock: newSourceStock, inTransitQty: newInTransit, updatedAt: now },
            { merge: true }
          );

          const movementRef = db.collection("stockMovements").doc();
          const movementDoc: StockMovementDoc = {
            organizationId: orgId,
            branchId: transfer.sourceBranchId,
            storageLocationId: transfer.sourceLocationId,
            productId: line.productId,
            type: StockMovementType.TRANSFER,
            quantity: dispatchedBase,
            balanceAfter: newSourceStock,
            unitCostSnapshot: line.unitCost,
            referenceId: input.transferId,
            referenceModel: "stock_transfer",
            reason: `Dispatched transfer cancelled, in-transit returned to source: ${transfer.transferNumber}`,
            createdAt: now,
            createdBy: callerUid,
          };
          txn.set(movementRef, movementDoc);
        }
      }
    }

    txn.update(transferRef, {
      status: "cancelled",
      version: nextVersion,
      cancelledAt: now,
      cancelledBy: callerUid,
      rejectionReason: input.reason || null,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      success: true,
      status: "cancelled",
      version: nextVersion,
      message: "Stock transfer cancelled successfully.",
    };
  });
});

export const stockTransfersDispatch = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(DispatchStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_DISPATCH,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const currency = ctx.organization.currency;
  const now = new Date().toISOString();
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  const result = await db.runTransaction(async (txn) => {
    // 1. Transactional Reads
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }
    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    assertValidTransferTransition(transfer.status, "dispatched");

    // Optimistic Concurrency Precondition (U-7)
    if (input.version !== undefined && transfer.version !== undefined && transfer.version !== input.version) {
      throw new HttpsError("failed-precondition", "VERSION_MISMATCH: Concurrent edit detected. Please refresh and retry.");
    }

    const itemsToDispatch = input.items && input.items.length > 0
      ? input.items
      : transfer.items.map((it) => ({
        productId: it.productId,
        dispatchedQty: it.requestedQty,
        serialNumbers: it.serialNumbers,
        batchNumber: it.batchNumber,
        expiryDate: it.expiryDate,
      }));

    // Pre-read source stock balances and product documents
    const linePlans: Array<{
      line: StockTransferLine;
      prodData: ProductDoc;
      stockBalanceRef: FirebaseFirestore.DocumentReference;
      stockBalanceData: StockBalanceDoc | null;
      branchProductStockRef: FirebaseFirestore.DocumentReference;
      branchProductStockData: Record<string, unknown> | null;
      dispatchedQty: number;
      dispatchedBaseQuantity: number;
      newSourceStock: number;
      newInTransit: number;
      unitCost: number;
      totalCost: number;
      serialNumbers?: string[];
    }> = [];

    const serialLinesToDispatch: SerialLine[] = [];

    for (const line of transfer.items) {
      const dispatchSpec = itemsToDispatch.find((d) => d.productId === line.productId);
      const dispatchedQty = dispatchSpec ? dispatchSpec.dispatchedQty : line.requestedQty;
      const factor = line.conversionFactor || 1;
      const dispatchedBaseQuantity = roundQty(dispatchedQty * factor, 4);

      const prodRef = db.collection("products").doc(line.productId);
      const prodSnap = await txn.get(prodRef);
      if (!prodSnap.exists) {
        throw new HttpsError("not-found", `Product "${line.productId}" not found.`);
      }
      const prodData = prodSnap.data() as ProductDoc;

      const stockBalanceRef = db.collection("stockBalances").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`);
      const stockBalanceSnap = await txn.get(stockBalanceRef);
      const stockBalanceData = stockBalanceSnap.exists ? (stockBalanceSnap.data() as StockBalanceDoc) : null;

      const branchProductStockRef = db.collection("branchProductStock").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`);
      const branchProductStockSnap = await txn.get(branchProductStockRef);
      const branchProductStockData = branchProductStockSnap.exists ? (branchProductStockSnap.data() as Record<string, unknown>) : null;

      // Available stock check (considering reserved stock)
      const currentStock = stockBalanceData
        ? (stockBalanceData.currentStock || 0)
        : (branchProductStockData ? (Number(branchProductStockData.currentStock) || 0) : 0);
      const allocatedStock = stockBalanceData?.allocatedStock || 0;
      const availableStock = currentStock - allocatedStock;

      if (prodData.trackStock && dispatchedBaseQuantity > availableStock) {
        throw new HttpsError(
          "failed-precondition",
          `Insufficient available stock for "${prodData.name}" at source branch. Available: ${availableStock}, requested dispatch: ${dispatchedBaseQuantity}.`
        );
      }

      // Serial handling
      const serials = dispatchSpec?.serialNumbers || line.serialNumbers;
      if (prodData.trackSerial && prodData.trackStock !== false) {
        assertSerialCount(
          { lineId: line.productId, productId: line.productId, serials: serials || [] },
          dispatchedBaseQuantity
        );
        serialLinesToDispatch.push({
          lineId: line.productId,
          productId: line.productId,
          serials: serials || [],
        });
      }

      const unitCost = prodData.weightedAverageCost && prodData.weightedAverageCost > 0
        ? prodData.weightedAverageCost
        : (prodData.costPrice || 0);
      const totalCost = Money.amount(unitCost * dispatchedBaseQuantity, currency);

      const newSourceStock = roundQty(currentStock - dispatchedBaseQuantity, 4);
      const currentInTransit = (stockBalanceData?.inTransitQty || Number(branchProductStockData?.inTransitQty) || 0);
      const newInTransit = roundQty(currentInTransit + dispatchedBaseQuantity, 4);

      linePlans.push({
        line,
        prodData,
        stockBalanceRef,
        stockBalanceData,
        branchProductStockRef,
        branchProductStockData,
        dispatchedQty,
        dispatchedBaseQuantity,
        newSourceStock,
        newInTransit,
        unitCost,
        totalCost,
        serialNumbers: serials,
      });
    }

    // Prepare serial transactions
    const serialCommit = serialLinesToDispatch.length > 0
      ? await prepareSerialsInTxn(txn, {
        organizationId: orgId,
        branchId: transfer.sourceBranchId,
        lines: serialLinesToDispatch,
        action: { kind: "transfer_dispatch", transferId: input.transferId },
      })
      : () => undefined;

    // Optional Handling Fee Pre-reads (Phase 1 Ledger Wiring)
    let feePrep: Awaited<ReturnType<typeof prepareAccountTransactionInTxn>> | undefined;
    if (transfer.handlingFee && transfer.handlingFee > 0 && transfer.handlingFeeFinancialAccountId) {
      feePrep = await prepareAccountTransactionInTxn(txn, {
        organizationId: orgId,
        financialAccountId: transfer.handlingFeeFinancialAccountId,
        branchId: transfer.sourceBranchId,
        type: "expense",
        direction: "out",
        amount: transfer.handlingFee,
        sourceDocumentType: "outflow",
        sourceDocumentId: input.transferId,
        description: `Handling charge for stock transfer ${transfer.transferNumber}`,
        actorUid: callerUid,
        now,
      });
    }

    // 2. Transactional Writes
    let totalValuation = 0;
    const updatedItems: StockTransferLine[] = [];

    for (const plan of linePlans) {
      totalValuation += plan.totalCost;

      // Update source stock balances and inTransitQty
      txn.set(
        plan.stockBalanceRef,
        {
          organizationId: orgId,
          branchId: transfer.sourceBranchId,
          productId: plan.line.productId,
          currentStock: plan.newSourceStock,
          inTransitQty: plan.newInTransit,
          updatedAt: now,
          updatedBy: callerUid,
        },
        { merge: true }
      );

      // Keep branchProductStock backwards-compatible
      txn.set(
        plan.branchProductStockRef,
        {
          currentStock: plan.newSourceStock,
          inTransitQty: plan.newInTransit,
          updatedAt: now,
        },
        { merge: true }
      );

      // Record stock movement at source branch (negative for outbound dispatch)
      const movementRef = db.collection("stockMovements").doc();
      const movementDoc: StockMovementDoc = {
        organizationId: orgId,
        branchId: transfer.sourceBranchId,
        storageLocationId: transfer.sourceLocationId,
        productId: plan.line.productId,
        type: StockMovementType.TRANSFER,
        quantity: -plan.dispatchedBaseQuantity,
        balanceAfter: plan.newSourceStock,
        unitCostSnapshot: plan.unitCost,
        referenceId: input.transferId,
        referenceModel: "stock_transfer",
        reason: `Transfer dispatched to ${transfer.destinationBranchId} (${transfer.transferNumber})`,
        createdAt: now,
        createdBy: callerUid,
      };
      txn.set(movementRef, movementDoc);

      updatedItems.push({
        ...plan.line,
        dispatchedQty: plan.dispatchedQty,
        dispatchedBaseQuantity: plan.dispatchedBaseQuantity,
        unitCost: plan.unitCost,
        totalCost: plan.totalCost,
        serialNumbers: plan.serialNumbers,
      });
    }

    // Execute serial updates
    serialCommit();

    // Commit Handling Charge if applicable
    if (feePrep && transfer.handlingFeeFinancialAccountId && transfer.handlingFee) {
      applyAccountTransactionInTxn(txn, feePrep, {
        organizationId: orgId,
        financialAccountId: transfer.handlingFeeFinancialAccountId,
        branchId: transfer.sourceBranchId,
        type: "expense",
        direction: "out",
        amount: transfer.handlingFee,
        sourceDocumentType: "outflow",
        sourceDocumentId: input.transferId,
        description: `Handling charge for stock transfer ${transfer.transferNumber}`,
        actorUid: callerUid,
        now,
      });

      const expenseRef = db.collection("outflows").doc();
      const expenseDoc: OutflowDoc = {
        organizationId: orgId,
        branchId: transfer.sourceBranchId,
        outflowNumber: `EXP-${transfer.transferNumber}`,
        kind: OutflowKind.EXPENSE,
        docDate: now,
        subTotal: transfer.handlingFee,
        discountTotal: 0,
        taxTotal: 0,
        payee: "Freight / Transfer Logistics",
        totalAmount: transfer.handlingFee,
        paidAmount: transfer.handlingFee,
        balanceAmount: 0,
        status: OutflowStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        financialAccountId: transfer.handlingFeeFinancialAccountId,
        notes: `Transfer handling charge for ${transfer.transferNumber}`,
        lines: [],
        createdAt: now,
        createdBy: callerUid,
        updatedAt: now,
        updatedBy: callerUid,
      };
      txn.set(expenseRef, expenseDoc);
    }

    const nextVersion = (transfer.version || 1) + 1;
    txn.update(transferRef, {
      status: "dispatched",
      version: nextVersion,
      items: updatedItems,
      totalValuation: Money.amount(totalValuation, currency),
      transportMode: input.transportMode || transfer.transportMode,
      trackingReference: input.trackingReference || transfer.trackingReference,
      dispatchedAt: now,
      dispatchedBy: callerUid,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      success: true,
      status: "dispatched",
      version: nextVersion,
      totalValuation: Money.amount(totalValuation, currency),
      message: "Stock transfer dispatched. Source inventory deducted and in-transit stock recorded.",
    };
  });

  return result;
});

export const stockTransfersReceive = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReceiveStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_RECEIVE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  const result = await db.runTransaction(async (txn) => {
    // 1. Transactional Reads
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }
    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    assertValidTransferTransition(transfer.status, "received");

    // Optimistic Concurrency Precondition (U-7)
    if (input.version !== undefined && transfer.version !== undefined && transfer.version !== input.version) {
      throw new HttpsError("failed-precondition", "VERSION_MISMATCH: Concurrent edit detected. Please refresh and retry.");
    }

    const destLocationId = input.destinationLocationId || transfer.destinationLocationId;
    if (destLocationId) {
      const locRef = db.collection("storageLocations").doc(destLocationId);
      const locSnap = await txn.get(locRef);
      if (!locSnap.exists || locSnap.data()?.organizationId !== orgId || locSnap.data()?.branchId !== transfer.destinationBranchId) {
        throw new HttpsError("invalid-argument", "Destination storage location does not belong to destination branch.");
      }
    }

    let hasDiscrepancy = false;
    const serialLinesToReceive: SerialLine[] = [];

    const receivePlans: Array<{
      line: StockTransferLine;
      prodRef: FirebaseFirestore.DocumentReference;
      prodData: ProductDoc;
      sourceStockBalanceRef: FirebaseFirestore.DocumentReference;
      destStockBalanceRef: FirebaseFirestore.DocumentReference;
      sourceBranchProductStockRef: FirebaseFirestore.DocumentReference;
      destBranchProductStockRef: FirebaseFirestore.DocumentReference;
      receivedQty: number;
      receivedBaseQuantity: number;
      rejectedQty: number;
      shortQty: number;
      discrepancyReason?: string;
      newDestStock: number;
      newInTransit: number;
      newDestWac: number;
    }> = [];

    for (const line of transfer.items) {
      const rec = input.items.find((i) => i.productId === line.productId);
      const factor = line.conversionFactor || 1;
      const dispatchedQty = line.dispatchedQty ?? line.requestedQty;
      const dispatchedBase = line.dispatchedBaseQuantity ?? roundQty(dispatchedQty * factor, 4);

      const receivedQty = rec !== undefined ? rec.receivedQty : dispatchedQty;
      const receivedBaseQuantity = roundQty(receivedQty * factor, 4);
      const rejectedQty = rec?.rejectedQty || 0;
      const shortQty = rec?.shortQty !== undefined
        ? rec.shortQty
        : Math.max(0, dispatchedQty - (receivedQty + rejectedQty));
      const discrepancyReason = rec?.discrepancyReason;

      if (rejectedQty > 0 || shortQty > 0 || receivedQty !== dispatchedQty) {
        hasDiscrepancy = true;
      }

      const prodRef = db.collection("products").doc(line.productId);
      const prodSnap = await txn.get(prodRef);
      if (!prodSnap.exists) {
        throw new HttpsError("not-found", `Product "${line.productId}" not found.`);
      }
      const prodData = prodSnap.data() as ProductDoc;

      // Source inTransit reading
      const sourceStockBalanceRef = db.collection("stockBalances").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`);
      const sourceBalanceSnap = await txn.get(sourceStockBalanceRef);
      const sourceBalanceData = sourceBalanceSnap.exists ? (sourceBalanceSnap.data() as StockBalanceDoc) : null;
      const sourceBranchProductStockRef = db.collection("branchProductStock").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`);
      const sourceBpsSnap = await txn.get(sourceBranchProductStockRef);
      const sourceBpsData = sourceBpsSnap.exists ? (sourceBpsSnap.data() as Record<string, unknown>) : null;

      const currentInTransit = sourceBalanceData?.inTransitQty || Number(sourceBpsData?.inTransitQty) || dispatchedBase;
      const newInTransit = Math.max(0, roundQty(currentInTransit - dispatchedBase, 4));

      // Destination stock balance reading
      const destStockBalanceRef = db.collection("stockBalances").doc(`${orgId}_${transfer.destinationBranchId}_${line.productId}`);
      const destBalanceSnap = await txn.get(destStockBalanceRef);
      const destBalanceData = destBalanceSnap.exists ? (destBalanceSnap.data() as StockBalanceDoc) : null;
      const destBranchProductStockRef = db.collection("branchProductStock").doc(`${orgId}_${transfer.destinationBranchId}_${line.productId}`);
      const destBpsSnap = await txn.get(destBranchProductStockRef);
      const destBpsData = destBpsSnap.exists ? (destBpsSnap.data() as Record<string, unknown>) : null;

      const currentDestStock = destBalanceData
        ? (destBalanceData.currentStock || 0)
        : (destBpsData ? (Number(destBpsData.currentStock) || 0) : 0);
      const newDestStock = roundQty(currentDestStock + receivedBaseQuantity, 4);

      // Destination WAC recalculation
      const currentDestWac = prodData.weightedAverageCost && prodData.weightedAverageCost > 0
        ? prodData.weightedAverageCost
        : (prodData.costPrice || 0);
      const incomingRate = line.unitCost || currentDestWac;
      const newDestWac = calculateNewWeightedAverageCost(
        currentDestStock,
        currentDestWac,
        receivedBaseQuantity,
        incomingRate
      );

      // Serial Verification
      const receivedSerials = rec?.serialNumbers || line.serialNumbers;
      if (prodData.trackSerial && prodData.trackStock !== false && receivedBaseQuantity > 0) {
        assertSerialCount(
          { lineId: line.productId, productId: line.productId, serials: receivedSerials || [] },
          receivedBaseQuantity
        );
        serialLinesToReceive.push({
          lineId: line.productId,
          productId: line.productId,
          serials: receivedSerials || [],
        });
      }

      receivePlans.push({
        line,
        prodRef,
        prodData,
        sourceStockBalanceRef,
        destStockBalanceRef,
        sourceBranchProductStockRef,
        destBranchProductStockRef,
        receivedQty,
        receivedBaseQuantity,
        rejectedQty,
        shortQty,
        discrepancyReason,
        newDestStock,
        newInTransit,
        newDestWac,
      });
    }

    // Prepare serial receive commit
    const serialCommit = serialLinesToReceive.length > 0
      ? await prepareSerialsInTxn(txn, {
        organizationId: orgId,
        branchId: transfer.destinationBranchId,
        lines: serialLinesToReceive,
        action: {
          kind: "transfer_receive",
          transferId: input.transferId,
          destinationBranchId: transfer.destinationBranchId,
        },
      })
      : () => undefined;

    // 2. Transactional Writes
    const updatedItems: StockTransferLine[] = [];

    for (const plan of receivePlans) {
      // 1. Decrement inTransitQty on source
      txn.set(
        plan.sourceStockBalanceRef,
        {
          inTransitQty: plan.newInTransit,
          updatedAt: now,
          updatedBy: callerUid,
        },
        { merge: true }
      );
      txn.set(
        plan.sourceBranchProductStockRef,
        {
          inTransitQty: plan.newInTransit,
          updatedAt: now,
        },
        { merge: true }
      );

      // 2. Increment currentStock on destination
      txn.set(
        plan.destStockBalanceRef,
        {
          organizationId: orgId,
          branchId: transfer.destinationBranchId,
          productId: plan.line.productId,
          currentStock: plan.newDestStock,
          updatedAt: now,
          updatedBy: callerUid,
        },
        { merge: true }
      );
      txn.set(
        plan.destBranchProductStockRef,
        {
          currentStock: plan.newDestStock,
          updatedAt: now,
        },
        { merge: true }
      );

      // 3. Update Product WAC and adjust product currentStock if transit loss occurred
      const dispatchedBase = plan.line.dispatchedBaseQuantity ?? (plan.line.dispatchedQty ?? plan.line.requestedQty);
      const transitLossBaseQty = Math.max(0, dispatchedBase - plan.receivedBaseQuantity);
      const productUpdate: Record<string, unknown> = {
        weightedAverageCost: plan.newDestWac,
        updatedAt: now,
      };
      if (transitLossBaseQty > 0) {
        productUpdate.currentStock = Math.max(0, roundQty((plan.prodData.currentStock || 0) - transitLossBaseQty, 4));
      }
      txn.update(plan.prodRef, productUpdate);

      // 4. Record stock movement at destination branch
      if (plan.receivedBaseQuantity > 0) {
        const movementRef = db.collection("stockMovements").doc();
        const movementDoc: StockMovementDoc = {
          organizationId: orgId,
          branchId: transfer.destinationBranchId,
          storageLocationId: destLocationId,
          productId: plan.line.productId,
          type: StockMovementType.TRANSFER,
          quantity: plan.receivedBaseQuantity,
          balanceAfter: plan.newDestStock,
          unitCostSnapshot: plan.line.unitCost,
          referenceId: input.transferId,
          referenceModel: "stock_transfer",
          reason: `Transfer received from ${transfer.sourceBranchId} (${transfer.transferNumber})`,
          createdAt: now,
          createdBy: callerUid,
        };
        txn.set(movementRef, movementDoc);
      }

      updatedItems.push({
        ...plan.line,
        receivedQty: plan.receivedQty,
        receivedBaseQuantity: plan.receivedBaseQuantity,
        rejectedQty: plan.rejectedQty,
        shortQty: plan.shortQty,
        discrepancyReason: plan.discrepancyReason,
      });
    }

    // Execute serial receive commit
    serialCommit();

    const finalStatus: StockTransferStatus = hasDiscrepancy ? "partially_received" : "received";
    const nextVersion = (transfer.version || 1) + 1;

    txn.update(transferRef, {
      status: finalStatus,
      version: nextVersion,
      items: updatedItems,
      destinationLocationId: destLocationId,
      discrepancyStatus: hasDiscrepancy ? "pending_resolution" : "none",
      receivedAt: now,
      receivedBy: callerUid,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      success: true,
      status: finalStatus,
      version: nextVersion,
      hasDiscrepancy,
      discrepancyStatus: hasDiscrepancy ? "pending_resolution" : "none",
      message: hasDiscrepancy
        ? "Transfer received with discrepancies recorded. Pending discrepancy resolution."
        : "Stock transfer received successfully. Destination inventory and WAC updated.",
    };
  });

  return result;
});

export const stockTransfersResolveDiscrepancy = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ResolveTransferDiscrepancySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_RECEIVE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const currency = ctx.organization.currency;
  const now = new Date().toISOString();
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  return await db.runTransaction(async (txn) => {
    // 1. Transactional Reads
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }
    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    if (transfer.status !== "partially_received" && transfer.discrepancyStatus !== "pending_resolution") {
      throw new HttpsError("failed-precondition", `Transfer is in status "${transfer.status}", no pending discrepancy to resolve.`);
    }

    // Optimistic Concurrency Precondition (U-7)
    if (input.version !== undefined && transfer.version !== undefined && transfer.version !== input.version) {
      throw new HttpsError("failed-precondition", "VERSION_MISMATCH: Concurrent edit detected. Please refresh and retry.");
    }

    const lineIndex = transfer.items.findIndex((i) => i.productId === input.productId);
    if (lineIndex === -1) {
      throw new HttpsError("not-found", `Product "${input.productId}" not found on transfer.`);
    }
    const line = transfer.items[lineIndex];

    const dispatchedBase = line.dispatchedBaseQuantity ?? roundQty((line.dispatchedQty ?? line.requestedQty) * (line.conversionFactor || 1), 4);
    const receivedBase = line.receivedBaseQuantity ?? roundQty((line.receivedQty ?? 0) * (line.conversionFactor || 1), 4);
    const discrepancyBaseQty = Math.max(0, roundQty(dispatchedBase - receivedBase, 4));

    if (discrepancyBaseQty <= 0) {
      throw new HttpsError("failed-precondition", "No discrepancy quantity remaining on this line to resolve.");
    }

    // Read Source Stock Balance for return_to_source
    const sourceStockBalanceRef = db.collection("stockBalances").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`);
    const sourceStockSnap = await txn.get(sourceStockBalanceRef);
    const sourceCurrentStock = sourceStockSnap.exists ? (sourceStockSnap.data()?.currentStock || 0) : 0;

    const prodRef = db.collection("products").doc(line.productId);
    const prodSnap = await txn.get(prodRef);
    const prodData = prodSnap.data() as ProductDoc;

    // 2. Transactional Writes
    if (input.resolution === "return_to_source") {
      // Return physical stock to source branch
      const newSourceStock = roundQty(sourceCurrentStock + discrepancyBaseQty, 4);
      txn.set(
        sourceStockBalanceRef,
        {
          currentStock: newSourceStock,
          updatedAt: now,
          updatedBy: callerUid,
        },
        { merge: true }
      );
      txn.set(
        db.collection("branchProductStock").doc(`${orgId}_${transfer.sourceBranchId}_${line.productId}`),
        { currentStock: newSourceStock, updatedAt: now },
        { merge: true }
      );
      txn.update(prodRef, {
        currentStock: roundQty((prodData.currentStock || 0) + discrepancyBaseQty, 4),
        updatedAt: now,
      });

      const movementRef = db.collection("stockMovements").doc();
      const movementDoc: StockMovementDoc = {
        organizationId: orgId,
        branchId: transfer.sourceBranchId,
        storageLocationId: transfer.sourceLocationId,
        productId: line.productId,
        type: StockMovementType.TRANSFER,
        quantity: discrepancyBaseQty,
        balanceAfter: newSourceStock,
        unitCostSnapshot: line.unitCost,
        referenceId: input.transferId,
        referenceModel: "stock_transfer",
        reason: `Discrepancy returned to source (${transfer.transferNumber}): ${input.notes || "shortage returned"}`,
        createdAt: now,
        createdBy: callerUid,
      };
      txn.set(movementRef, movementDoc);
    } else if (input.resolution === "write_off") {
      // Inventory shortage write-off:
      // Damaged receipt write-off expense is posted to source branch (Q-F10)
      const lineUnitCost = line.unitCost || prodData.weightedAverageCost || prodData.costPrice || 0;
      const writeOffAmount = Money.amount(lineUnitCost * discrepancyBaseQty, currency);

      if (writeOffAmount > 0) {
        const outflowRef = db.collection("outflows").doc();
        const outflowDoc: OutflowDoc = {
          organizationId: orgId,
          branchId: transfer.sourceBranchId,
          outflowNumber: `EXP-TRF-${transfer.transferNumber}`,
          kind: OutflowKind.EXPENSE,
          docDate: now,
          status: OutflowStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
          subTotal: writeOffAmount,
          discountTotal: 0,
          taxTotal: 0,
          totalAmount: writeOffAmount,
          paidAmount: writeOffAmount,
          balanceAmount: 0,
          payee: "Transit Loss / Write-off",
          notes: input.notes || `Damaged stock transfer write-off (${transfer.transferNumber}) - ${prodData.name} (${discrepancyBaseQty} units)`,
          lines: [],
          createdAt: now,
          createdBy: callerUid,
          updatedAt: now,
          updatedBy: callerUid,
        };
        txn.set(outflowRef, outflowDoc);
      }
    } else if (input.resolution === "claim_carrier") {
      // Carrier claim records a receivable on source branch (Q-F10)
      const lineUnitCost = line.unitCost || prodData.weightedAverageCost || prodData.costPrice || 0;
      const claimAmount = Money.amount(lineUnitCost * discrepancyBaseQty, currency);

      if (claimAmount > 0) {
        const receivableRef = db.collection("carrierClaims").doc();
        txn.set(receivableRef, {
          organizationId: orgId,
          branchId: transfer.sourceBranchId,
          transferId: input.transferId,
          transferNumber: transfer.transferNumber,
          productId: line.productId,
          productName: prodData.name,
          claimAmount,
          discrepancyQuantity: discrepancyBaseQty,
          status: "pending_claim",
          trackingReference: transfer.trackingReference || null,
          carrierName: transfer.transportMode || "Carrier",
          notes: input.notes || "Claim submitted for transit damage/loss",
          createdAt: now,
          createdBy: callerUid,
        });
      }
    }

    // Update transfer document line resolution
    const updatedLine: StockTransferLine = {
      ...line,
      discrepancyResolution: input.resolution,
      discrepancyResolvedAt: now,
      discrepancyResolvedBy: callerUid,
      notes: input.notes ? `${line.notes || ""} [Resolved: ${input.resolution} - ${input.notes}]`.trim() : line.notes,
    };

    const updatedItems = [...transfer.items];
    updatedItems[lineIndex] = updatedLine;

    // Check if all lines are now resolved
    const allResolved = updatedItems.every((item) => {
      const dBase = item.dispatchedBaseQuantity ?? (item.dispatchedQty ?? item.requestedQty);
      const rBase = item.receivedBaseQuantity ?? (item.receivedQty ?? 0);
      if (dBase > rBase) {
        return Boolean(item.discrepancyResolution);
      }
      return true;
    });

    const nextVersion = (transfer.version || 1) + 1;
    const finalStatus: StockTransferStatus = allResolved ? "received" : "partially_received";
    const discrepancyStatus = allResolved ? "resolved" : "pending_resolution";

    txn.update(transferRef, {
      items: updatedItems,
      status: finalStatus,
      discrepancyStatus,
      version: nextVersion,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      success: true,
      productId: input.productId,
      resolution: input.resolution,
      discrepancyBaseQty,
      discrepancyStatus,
      status: finalStatus,
      version: nextVersion,
      message: `Discrepancy for product "${input.productId}" resolved via "${input.resolution}".`,
    };
  });
});

export const stockTransfersList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListStockTransfersSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  let query: FirebaseFirestore.Query = db
    .collection("stockTransfers")
    .where("organizationId", "==", orgId);

  if (input.sourceBranchId) {
    query = query.where("sourceBranchId", "==", input.sourceBranchId);
  }
  if (input.destinationBranchId) {
    query = query.where("destinationBranchId", "==", input.destinationBranchId);
  }
  if (input.status) {
    query = query.where("status", "==", input.status);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "stockTransfers",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    transferId: doc.id,
    ...(doc.data() as StockTransferDoc),
  }));

  return {
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

export const stockTransfersGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const transferRef = db.collection("stockTransfers").doc(input.transferId);
  const snap = await transferRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Stock transfer not found.");
  }

  const data = snap.data() as StockTransferDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return {
    transfer: {
      transferId: snap.id,
      ...data,
    },
  };
});
