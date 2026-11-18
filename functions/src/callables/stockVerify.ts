/**
 * System-Wide Stock Invariant Verification Callable (Phase 2, Section 8)
 * 
 * Provides:
 * - stockVerify: Comprehensive verification across stockMovements, stockBalances,
 *   in-transit transfers, and serial registries.
 * - Invariants:
 *   1. Movement summation: SUM(stockMovements.quantity) === currentStock per (branch, product)
 *   2. Non-negative stock: currentStock - (allocatedStock || 0) >= 0
 *   3. In-transit conservation: SUM(dispatchedBase - receivedBase on open transfers) === inTransitQty
 *   4. Serial count reconciliation: in-stock serial count === currentStock for serial-tracked items
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { StockVerifySchema } from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  ProductDoc,
  StockBalanceDoc,
  StockMovementDoc,
  StockTransferDoc,
} from "../types/models.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { roundQty } from "../services/money.js";

export interface StockDiscrepancy {
  entity: "stockBalance" | "stockMovement" | "inTransit" | "serial";
  id: string;
  expected: number | string;
  actual: number | string;
  reason: string;
}

export const stockVerify = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(StockVerifySchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.STOCK_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const discrepancies: StockDiscrepancy[] = [];
  let productsChecked = 0;
  let movementsChecked = 0;
  let serialsChecked = 0;
  let transfersChecked = 0;

  // 1. Fetch Products
  let prodQuery: FirebaseFirestore.Query = db
    .collection("products")
    .where("organizationId", "==", orgId);

  if (input.productId) {
    prodQuery = prodQuery.where(FirebaseFirestore.FieldPath.documentId(), "==", input.productId);
  }

  const prodSnap = await prodQuery.get();
  productsChecked = prodSnap.docs.length;

  // 2. Fetch Branches to check
  const branchesSnap = await db
    .collection("organizations")
    .doc(orgId)
    .collection("branches")
    .get();

  const branchIds = input.branchId
    ? [input.branchId]
    : branchesSnap.docs.map((d) => d.id);

  if (branchIds.length === 0) {
    branchIds.push("main-branch");
  }

  // 3. For each Product and Branch: verify stock balance vs movements
  for (const prodDoc of prodSnap.docs) {
    const prod = prodDoc.data() as ProductDoc;
    const prodId = prodDoc.id;

    if (!prod.trackStock) continue;

    for (const bId of branchIds) {
      // Read stockBalances and branchProductStock
      const balanceRef = db.collection("stockBalances").doc(`${orgId}_${bId}_${prodId}`);
      const balanceSnap = await balanceRef.get();
      const balanceData = balanceSnap.exists ? (balanceSnap.data() as StockBalanceDoc) : null;

      const bpsRef = db.collection("branchProductStock").doc(`${orgId}_${bId}_${prodId}`);
      const bpsSnap = await bpsRef.get();
      const bpsData = bpsSnap.exists ? (bpsSnap.data() as Record<string, unknown>) : null;

      const recordedCurrentStock = balanceData
        ? (balanceData.currentStock || 0)
        : (bpsData ? (Number(bpsData.currentStock) || 0) : (bId === "main-branch" ? (prod.currentStock || 0) : 0));

      const recordedInTransit = balanceData
        ? (balanceData.inTransitQty || 0)
        : (bpsData ? (Number(bpsData.inTransitQty) || 0) : 0);

      // Sum all movements for this branch & product
      let movQuery: FirebaseFirestore.Query = db
        .collection("stockMovements")
        .where("organizationId", "==", orgId)
        .where("branchId", "==", bId)
        .where("productId", "==", prodId);

      if (input.storageLocationId) {
        movQuery = movQuery.where("storageLocationId", "==", input.storageLocationId);
      }

      const movSnap = await movQuery.get();
      movementsChecked += movSnap.docs.length;

      let computedMovementSum = 0;
      for (const mDoc of movSnap.docs) {
        const m = mDoc.data() as StockMovementDoc;
        computedMovementSum = roundQty(computedMovementSum + (m.quantity || 0), 4);
      }

      // If movements exist, movement sum must match recorded balance
      if (movSnap.docs.length > 0) {
        if (roundQty(computedMovementSum, 4) !== roundQty(recordedCurrentStock, 4)) {
          discrepancies.push({
            entity: "stockMovement",
            id: `${bId}_${prodId}`,
            expected: recordedCurrentStock,
            actual: computedMovementSum,
            reason: `Stock movement sum drift: recorded ${recordedCurrentStock}, movements sum ${computedMovementSum}`,
          });
        }
      }

      // Available stock invariant: non-negative unless allowed
      const allocatedStock = balanceData?.allocatedStock || 0;
      const available = recordedCurrentStock - allocatedStock;
      if (available < 0) {
        discrepancies.push({
          entity: "stockBalance",
          id: `${bId}_${prodId}`,
          expected: ">= 0",
          actual: available,
          reason: `Negative available stock: current ${recordedCurrentStock}, allocated ${allocatedStock}`,
        });
      }

      // 4. In-Transit Reconciliation
      // Query active stockTransfers originating from this branch
      const trfSnap = await db
        .collection("stockTransfers")
        .where("organizationId", "==", orgId)
        .where("sourceBranchId", "==", bId)
        .where("status", "in", ["dispatched", "partially_received"])
        .get();

      transfersChecked += trfSnap.docs.length;
      let expectedInTransit = 0;

      for (const tDoc of trfSnap.docs) {
        const transfer = tDoc.data() as StockTransferDoc;
        const line = transfer.items.find((i) => i.productId === prodId);
        if (line) {
          const factor = line.conversionFactor || 1;
          const dispatchedBase = line.dispatchedBaseQuantity ?? roundQty((line.dispatchedQty ?? line.requestedQty) * factor, 4);
          const receivedBase = line.receivedBaseQuantity ?? roundQty((line.receivedQty ?? 0) * factor, 4);
          const remainingInTransit = Math.max(0, dispatchedBase - receivedBase);
          expectedInTransit = roundQty(expectedInTransit + remainingInTransit, 4);
        }
      }

      if (trfSnap.docs.length > 0 || recordedInTransit > 0) {
        if (roundQty(expectedInTransit, 4) !== roundQty(recordedInTransit, 4)) {
          discrepancies.push({
            entity: "inTransit",
            id: `${bId}_${prodId}`,
            expected: expectedInTransit,
            actual: recordedInTransit,
            reason: `In-transit stock drift: expected ${expectedInTransit}, recorded ${recordedInTransit}`,
          });
        }
      }

      // 5. Serial Number Reconciliation
      if (prod.trackSerial && prod.trackStock) {
        const serialSnap = await db
          .collection("serials")
          .where("organizationId", "==", orgId)
          .where("productId", "==", prodId)
          .where("branchId", "==", bId)
          .get();

        serialsChecked += serialSnap.docs.length;
        let inStockSerialCount = 0;
        for (const sDoc of serialSnap.docs) {
          const s = sDoc.data();
          if (["in_stock", "returned", "reserved"].includes(s.status as string)) {
            inStockSerialCount++;
          }
        }

        if (inStockSerialCount !== Math.round(recordedCurrentStock) && serialSnap.docs.length > 0) {
          discrepancies.push({
            entity: "serial",
            id: `${bId}_${prodId}`,
            expected: Math.round(recordedCurrentStock),
            actual: inStockSerialCount,
            reason: `Serial count mismatch: recorded stock ${recordedCurrentStock}, registered active serials ${inStockSerialCount}`,
          });
        }
      }
    }
  }

  const verified = discrepancies.length === 0;

  return {
    verified,
    productsChecked,
    movementsChecked,
    serialsChecked,
    transfersChecked,
    discrepancyCount: discrepancies.length,
    discrepancies,
  };
});
