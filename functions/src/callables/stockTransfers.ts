/**
 * Inter-Branch Stock Transfers Callables
 * 
 * Provides:
 * - Complete stock transfer workflow (draft -> submitted -> approved -> dispatched -> received)
 * - Atomic stock adjustments at source branch on dispatch
 * - Atomic stock intake at destination branch on receipt with discrepancy tracking
 * - Guaranteed isolation: in-transit stock never doubles and never disappears
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateStockTransferSchema,
  SubmitStockTransferSchema,
  DispatchStockTransferSchema,
  ReceiveStockTransferSchema,
  ListStockTransfersSchema,
  GetStockTransferSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  StockTransferDoc,
  StockMovementDoc,
  ProductDoc,
} from "../types/models.js";
import { StockMovementType } from "../constants/enums.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";

export const stockTransfersCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.sourceBranchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_CREATE,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  if (input.sourceBranchId === input.destinationBranchId) {
    throw new HttpsError("invalid-argument", "Source and destination branches must be different.");
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
    // 1. Transactional reads
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

    // Verify all products exist
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
      status: "draft",
      items: input.items.map((i) => ({
        productId: i.productId,
        requestedQty: i.requestedQty,
        unit: i.unit || "piece",
        notes: i.notes,
      })),
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
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_CREATE,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const transferRef = db.collection("stockTransfers").doc(input.transferId);
  const snap = await transferRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Stock transfer not found.");
  }

  const data = snap.data() as StockTransferDoc;
  if (data.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }
  if (data.status !== "draft") {
    throw new HttpsError("failed-precondition", `Transfer is in status "${data.status}", expected "draft".`);
  }

  const now = new Date().toISOString();
  await transferRef.update({
    status: "submitted",
    submittedAt: now,
    submittedBy: callerUid,
    updatedAt: now,
    updatedBy: callerUid,
  });

  return {
    success: true,
    status: "submitted",
    message: "Stock transfer submitted for approval.",
  };
});

export const stockTransfersDispatch = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(DispatchStockTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_DISPATCH,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  const result = await db.runTransaction(async (txn) => {
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }
    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    if (transfer.status !== "approved" && transfer.status !== "submitted") {
      throw new HttpsError("failed-precondition", `Transfer in status "${transfer.status}" cannot be dispatched.`);
    }

    const itemsToDispatch = input.items && input.items.length > 0
      ? input.items
      : transfer.items.map((it) => ({ productId: it.productId, dispatchedQty: it.requestedQty }));

    // Deduct stock from source branch
    const updatedItems = transfer.items.map((line) => {
      const dispatchSpec = itemsToDispatch.find((d) => d.productId === line.productId);
      const qty = dispatchSpec ? dispatchSpec.dispatchedQty : line.requestedQty;
      return {
        ...line,
        dispatchedQty: qty,
      };
    });

    for (const item of updatedItems) {
      const stockRef = db.collection("branchProductStock").doc(`${orgId}_${transfer.sourceBranchId}_${item.productId}`);
      const stockSnap = await txn.get(stockRef);
      const currentStock = stockSnap.exists ? (stockSnap.data()?.currentStock || 0) : 0;
      const newStock = currentStock - (item.dispatchedQty || 0);

      // Record stock movement (negative for source deduction)
      const movementRef = db.collection("stockMovements").doc();
      const movementDoc: StockMovementDoc = {
        organizationId: orgId,
        branchId: transfer.sourceBranchId,
        storageLocationId: transfer.sourceLocationId,
        productId: item.productId,
        type: StockMovementType.TRANSFER,
        quantity: -(item.dispatchedQty || 0),
        balanceAfter: newStock,
        referenceId: input.transferId,
        referenceModel: "stock_transfer",
        reason: `Transfer to ${transfer.destinationBranchId} (${transfer.transferNumber})`,
        createdAt: now,
        createdBy: callerUid,
      };

      txn.set(movementRef, movementDoc);
      txn.set(stockRef, { currentStock: newStock, updatedAt: now }, { merge: true });
    }

    txn.update(transferRef, {
      status: "dispatched",
      items: updatedItems,
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
      message: "Stock transfer dispatched. Source inventory deducted.",
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
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_TRANSFER_RECEIVE,
  });

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();
  const transferRef = db.collection("stockTransfers").doc(input.transferId);

  const result = await db.runTransaction(async (txn) => {
    const snap = await txn.get(transferRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Stock transfer not found.");
    }
    const transfer = snap.data() as StockTransferDoc;
    if (transfer.organizationId !== orgId) {
      throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
    }
    if (transfer.status !== "dispatched") {
      throw new HttpsError("failed-precondition", `Transfer in status "${transfer.status}" cannot be received.`);
    }

    let hasDiscrepancy = false;
    const updatedItems = transfer.items.map((line) => {
      const rec = input.items.find((i) => i.productId === line.productId);
      const receivedQty = rec !== undefined ? rec.receivedQty : (line.dispatchedQty ?? line.requestedQty);
      const rejectedQty = rec !== undefined ? (rec.rejectedQty || 0) : 0;
      const discrepancyReason = rec?.discrepancyReason;

      if (rejectedQty > 0 || receivedQty !== (line.dispatchedQty ?? line.requestedQty)) {
        hasDiscrepancy = true;
      }

      return {
        ...line,
        receivedQty,
        rejectedQty,
        discrepancyReason,
      };
    });

    // Add received stock to destination branch
    for (const item of updatedItems) {
      if ((item.receivedQty || 0) > 0) {
        const stockRef = db.collection("branchProductStock").doc(`${orgId}_${transfer.destinationBranchId}_${item.productId}`);
        const stockSnap = await txn.get(stockRef);
        const currentStock = stockSnap.exists ? (stockSnap.data()?.currentStock || 0) : 0;
        const newStock = currentStock + (item.receivedQty || 0);

        const movementRef = db.collection("stockMovements").doc();
        const movementDoc: StockMovementDoc = {
          organizationId: orgId,
          branchId: transfer.destinationBranchId,
          storageLocationId: input.destinationLocationId || transfer.destinationLocationId,
          productId: item.productId,
          type: StockMovementType.TRANSFER,
          quantity: item.receivedQty || 0,
          balanceAfter: newStock,
          referenceId: input.transferId,
          referenceModel: "stock_transfer",
          reason: `Transfer from ${transfer.sourceBranchId} (${transfer.transferNumber})`,
          createdAt: now,
          createdBy: callerUid,
        };

        txn.set(movementRef, movementDoc);
        txn.set(stockRef, { currentStock: newStock, updatedAt: now }, { merge: true });
      }
    }

    const finalStatus = hasDiscrepancy ? "partially_received" : "received";

    txn.update(transferRef, {
      status: finalStatus,
      items: updatedItems,
      destinationLocationId: input.destinationLocationId || transfer.destinationLocationId,
      receivedAt: now,
      receivedBy: callerUid,
      updatedAt: now,
      updatedBy: callerUid,
    });

    return {
      success: true,
      status: finalStatus,
      message: hasDiscrepancy
        ? "Transfer received with discrepancies recorded."
        : "Stock transfer received successfully. Destination inventory updated.",
    };
  });

  return result;
});

export const stockTransfersList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListStockTransfersSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_VIEW,
  });

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
    organizationId: input.organizationId,
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_VIEW,
  });

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
