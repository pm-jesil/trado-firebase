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
import { StockMovementDoc, ProductDoc } from "../types/models.js";
import { StockMovementType } from "../constants/enums.js";
import { roundQty } from "./money.js";

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
  type: StockMovementType;
  unit: string;
  referenceId: string;
  referenceModel: "bill" | "outflow" | "return" | "manual_adjustment";
  reason?: string;
}

export interface ApplyStockChangesParams {
  organizationId: string;
  actorUid: string;
  items: StockChangeItem[];
  allowNegativeStock?: boolean;
}

export interface StockChangeResult {
  productId: string;
  previousStock: number;
  newStock: number;
  movementId: string;
}

export interface PreparedStockOperation {
  docRef: FirebaseFirestore.DocumentReference;
  item: StockChangeItem;
  trackStock: boolean;
  previousStock: number;
  newStock: number;
  movementRef: FirebaseFirestore.DocumentReference;
  movementDoc: StockMovementDoc;
  result: StockChangeResult;
}

export interface PreparedStockChanges {
  operations: PreparedStockOperation[];
  results: StockChangeResult[];
}

/**
 * Reads all product documents, validates tenant isolation and stock availability,
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

  // 1. Read all product documents first (Firestore rule: all reads before writes)
  const productReads: Array<{ item: StockChangeItem; docSnap: FirebaseFirestore.DocumentSnapshot }> = [];

  for (const item of params.items) {
    const productRef = db.collection("products").doc(item.productId);
    const docSnap = await txn.get(productRef);
    if (!docSnap.exists) {
      throw new HttpsError("not-found", `Product with ID "${item.productId}" not found.`);
    }

    const prodData = docSnap.data() as ProductDoc;
    if (prodData.organizationId !== params.organizationId) {
      throw new HttpsError("permission-denied", `Cross-tenant product access rejected for "${item.productId}".`);
    }

    productReads.push({ item, docSnap });
  }

  // 2. Perform calculations and precompute updates + movements
  for (const { item, docSnap } of productReads) {
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
    const previousStock = prodData.currentStock || 0;
    const roundedQuantity = roundQty(item.quantity, 4);
    const newStock = roundQty(previousStock + roundedQuantity, 4);

    // Check negative stock prohibition if tracking is enabled
    if (prodData.trackStock && newStock < 0 && !params.allowNegativeStock) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient stock for "${prodData.name}". Available: ${previousStock}, Requested: ${Math.abs(item.quantity)}.`
      );
    }

    // Create immutable stock movement record
    const movementRef = db.collection("stockMovements").doc();
    const movementDoc: StockMovementDoc = {
      organizationId: params.organizationId,
      productId: item.productId,
      type: item.type,
      quantity: item.quantity,
      balanceAfter: prodData.trackStock ? newStock : previousStock,
      unit: item.unit || prodData.baseUnit || "piece",
      referenceId: item.referenceId,
      referenceModel: item.referenceModel,
      reason: item.reason || null,
      createdAt: now,
      createdBy: params.actorUid,
    };

    const result: StockChangeResult = {
      productId: item.productId,
      previousStock,
      newStock: prodData.trackStock ? newStock : previousStock,
      movementId: movementRef.id,
    };

    operations.push({
      docRef: docSnap.ref,
      item,
      trackStock: Boolean(prodData.trackStock),
      previousStock,
      newStock,
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
      txn.update(op.docRef, {
        currentStock: op.newStock,
        updatedAt: now,
      });
    }
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
