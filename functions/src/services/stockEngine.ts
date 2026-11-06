/**
 * Stock Engine Service
 * 
 * Implements Stock Read Strategy Option (a):
 * - Maintains a real-time `currentStock` balance directly on `products/{productId}`
 * - Records immutable `stockMovements` for every physical inventory intake or dispatch
 * - Operates transactionally to prevent stale inventory reads or double-allocation
 */

import { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { StockMovementDoc, ProductDoc, StockBalanceDoc } from "../types/models.js";
import { StockMovementType } from "../constants/enums.js";
import { roundQty } from "./money.js";
import { calculateNewWeightedAverageCost } from "./costingEngine.js";

const INWARD_MOVEMENT_TYPES = new Set<StockMovementType>([
  StockMovementType.PURCHASE_IN,
  StockMovementType.RETURN_IN,
  StockMovementType.SALE_RETURN_IN,
  StockMovementType.ADJUSTMENT_IN,
]);

const OUTWARD_MOVEMENT_TYPES = new Set<StockMovementType>([
  StockMovementType.SALE_OUT,
  StockMovementType.RETURN_OUT,
  StockMovementType.PURCHASE_RETURN_OUT,
  StockMovementType.DAMAGE_OUT,
  StockMovementType.ADJUSTMENT_OUT,
]);

export interface StockChangeItem {
  productId: string;
  quantity: number; // Signed: positive for inward, negative for outward
  costPrice?: number; // Inward unit purchase price for transactional WAC calculation
  type: StockMovementType;
  unit: string;
  referenceId: string;
  referenceModel: "bill" | "outflow" | "return" | "manual_adjustment";
  reason?: string;
}

export interface ApplyStockChangesParams {
  organizationId: string;
  branchId?: string; // Branch context (defaults to "main-branch")
  actorUid: string;
  items: StockChangeItem[];
  allowNegativeStock?: boolean;
}

export interface StockChangeResult {
  productId: string;
  previousStock: number;
  newStock: number;
  branchStock: number;
  movementId: string;
}

export interface PreparedStockOperation {
  docRef: FirebaseFirestore.DocumentReference;
  stockBalanceRef: FirebaseFirestore.DocumentReference;
  stockBalanceDoc: StockBalanceDoc;
  item: StockChangeItem;
  trackStock: boolean;
  previousStock: number;
  newStock: number;
  newWac?: number; // Transactionally computed Weighted-Average Cost for inward purchases
  previousBranchStock: number;
  newBranchStock: number;
  movementRef: FirebaseFirestore.DocumentReference;
  movementDoc: StockMovementDoc;
  result: StockChangeResult;
}

export interface PreparedStockChanges {
  operations: PreparedStockOperation[];
  results: StockChangeResult[];
}

/**
 * Reads all product and branch stock balance documents, validates tenant isolation and stock availability,
 * and precomputes stock movements.
 * MUST be executed during the transaction read phase (before any writes).
 */
export async function prepareStockChangesInTxn(
  txn: Transaction,
  params: ApplyStockChangesParams
): Promise<PreparedStockChanges> {
  const operations: PreparedStockOperation[] = [];
  const results: StockChangeResult[] = [];
  const now = new Date().toISOString();
  const branchId = params.branchId || "main-branch";

  // 1. Read all product documents and branch balance documents first (Firestore rule: all reads before writes)
  const productReads: Array<{
    item: StockChangeItem;
    docSnap: FirebaseFirestore.DocumentSnapshot;
    balanceSnap: FirebaseFirestore.DocumentSnapshot;
  }> = [];

  for (const item of params.items) {
    const productRef = db.collection("products").doc(item.productId);
    const balanceRef = db.collection("stockBalances").doc(`${params.organizationId}_${branchId}_${item.productId}`);

    const [docSnap, balanceSnap] = await Promise.all([
      txn.get(productRef),
      txn.get(balanceRef),
    ]);

    if (!docSnap.exists) {
      throw new HttpsError("not-found", `Product with ID "${item.productId}" not found.`);
    }

    const prodData = docSnap.data() as ProductDoc;
    if (prodData.organizationId !== params.organizationId) {
      throw new HttpsError("permission-denied", `Cross-tenant product access rejected for "${item.productId}".`);
    }

    productReads.push({ item, docSnap, balanceSnap });
  }

  // 2. Perform calculations and precompute updates + movements
  for (const { item, docSnap, balanceSnap } of productReads) {
    // Validate movement directional sign matches type
    if (INWARD_MOVEMENT_TYPES.has(item.type) && item.quantity <= 0) {
      throw new HttpsError(
        "invalid-argument",
        `Inward stock movement type "${item.type}" requires a positive quantity (> 0), got ${item.quantity}.`
      );
    }
    if (OUTWARD_MOVEMENT_TYPES.has(item.type) && item.quantity >= 0) {
      throw new HttpsError(
        "invalid-argument",
        `Outward stock movement type "${item.type}" requires a negative quantity (< 0), got ${item.quantity}.`
      );
    }

    const prodData = docSnap.data() as ProductDoc;
    const balanceData = balanceSnap.exists ? (balanceSnap.data() as StockBalanceDoc) : null;

    // Previous branch stock: if stockBalance exists, use it; otherwise fallback to product currentStock for main-branch, or 0
    const previousBranchStock = balanceData
      ? (balanceData.currentStock || 0)
      : (branchId === "main-branch" ? (prodData.currentStock || 0) : 0);
    const previousStock = prodData.currentStock || 0;
    const roundedQuantity = roundQty(item.quantity, 4);

    const newBranchStock = roundQty(previousBranchStock + roundedQuantity, 4);
    const newStock = roundQty(previousStock + roundedQuantity, 4);

    // Check negative stock prohibition if tracking is enabled
    if (prodData.trackStock && newBranchStock < 0 && !params.allowNegativeStock) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient branch stock for "${prodData.name}". Available at branch: ${previousBranchStock}, Requested: ${Math.abs(item.quantity)}.`
      );
    }

    // Create immutable stock movement record with branchId
    const movementRef = db.collection("stockMovements").doc();
    const movementDoc: StockMovementDoc = {
      organizationId: params.organizationId,
      branchId,
      productId: item.productId,
      type: item.type,
      quantity: item.quantity,
      balanceAfter: prodData.trackStock ? newBranchStock : previousBranchStock,
      unit: item.unit || prodData.baseUnit || "piece",
      referenceId: item.referenceId,
      referenceModel: item.referenceModel,
      reason: item.reason || null,
      createdAt: now,
      createdBy: params.actorUid,
    };

    const stockBalanceRef = balanceSnap.ref;
    const stockBalanceDoc: StockBalanceDoc = {
      organizationId: params.organizationId,
      branchId,
      productId: item.productId,
      currentStock: prodData.trackStock ? newBranchStock : previousBranchStock,
      lowStockThreshold: prodData.lowStockThreshold || 5,
      updatedAt: now,
      updatedBy: params.actorUid,
    };

    const result: StockChangeResult = {
      productId: item.productId,
      previousStock,
      newStock: prodData.trackStock ? newStock : previousStock,
      branchStock: prodData.trackStock ? newBranchStock : previousBranchStock,
      movementId: movementRef.id,
    };

    // Calculate new Weighted-Average Cost atomically for inward purchases
    let newWac: number | undefined;
    if (item.type === StockMovementType.PURCHASE_IN && item.costPrice !== undefined && item.costPrice !== null) {
      const currentWac = prodData.weightedAverageCost ?? prodData.costPrice ?? 0;
      newWac = calculateNewWeightedAverageCost(
        previousStock,
        currentWac,
        item.quantity,
        item.costPrice
      );
    }

    operations.push({
      docRef: docSnap.ref,
      stockBalanceRef,
      stockBalanceDoc,
      item,
      trackStock: Boolean(prodData.trackStock),
      previousStock,
      newStock,
      newWac,
      previousBranchStock,
      newBranchStock,
      movementRef,
      movementDoc,
      result,
    });
    results.push(result);
  }

  return { operations, results };
}

/**
 * Commits precomputed stock updates and movement records.
 * MUST be executed during the transaction write phase (after all reads).
 */
export function commitStockChangesInTxn(
  txn: Transaction,
  prepared: PreparedStockChanges
): StockChangeResult[] {
  const now = new Date().toISOString();
  for (const op of prepared.operations) {
    if (op.trackStock) {
      // 1. Maintain global aggregate mirror on product document (and WAC if purchase inward)
      const updatePayload: Record<string, any> = {
        currentStock: op.newStock,
        updatedAt: now,
      };
      if (op.newWac !== undefined) {
        updatePayload.weightedAverageCost = op.newWac;
      }
      txn.update(op.docRef, updatePayload);

      // 2. Maintain physical inventory balance on stockBalances document
      txn.set(op.stockBalanceRef, op.stockBalanceDoc, { merge: true });
    }

    // 3. Write immutable stock movement record
    txn.set(op.movementRef, op.movementDoc);
  }
  return prepared.results;
}

/**
 * Applies a batch of stock changes transactionally, updating currentStock on each product
 * and creating corresponding stockMovement documents.
 */
export async function applyStockChangesInTxn(
  txn: Transaction,
  params: ApplyStockChangesParams
): Promise<StockChangeResult[]> {
  const prepared = await prepareStockChangesInTxn(txn, params);
  return commitStockChangesInTxn(txn, prepared);
}
