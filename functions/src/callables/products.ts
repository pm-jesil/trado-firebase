/**
 * Product Callables
 * - productsCreate: Create catalog item with initial stock and movement tracking
 * - productsUpdate: Update product details, pricing, stock thresholds
 * - productsList: Tenant-scoped product listing
 * - productsGet: Retrieve single product by ID
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateProductSchema,
  UpdateProductSchema,
  ListProductsSchema,
} from "../validation/schemas.js";
import { ProductDoc, MembershipDoc, StockMovementDoc } from "../types/models.js";
import { StockMovementType } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const productsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateProductSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const callerUid = request.auth.uid;

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: callerUid,
    operation: "products.create",
    clientKey: input.idempotencyKey,
    payload: input as unknown as Record<string, unknown>,
    recoveryChecker: async () => {
      const existing = await db.collection("products")
        .where("organizationId", "==", input.organizationId)
        .where("nameKey", "==", input.name.trim().toLowerCase())
        .limit(1)
        .get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        return { productId: doc.id, ...doc.data() };
      }
      return null;
    },
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  try {
    const productRef = db.collection("products").doc();
    const productId = productRef.id;
    const now = new Date().toISOString();
    const initialStock = input.initialStock || 0;
    const cleanBarcode = input.barcode?.trim() || null;
    const barcodeLockRef = cleanBarcode
      ? db.collection("barcodeLocks").doc(`${input.organizationId}_${cleanBarcode.toLowerCase()}`)
      : null;

    const productDoc: ProductDoc = {
      organizationId: input.organizationId,
      name: input.name.trim(),
      nameKey: input.name.trim().toLowerCase(),
      description: input.description?.trim() || "",
      categoryId: input.categoryId || null,
      baseUnit: input.baseUnit.trim().toLowerCase(),
      sellingPrice: input.sellingPrice,
      costPrice: input.costPrice,
      mrp: input.mrp ?? null,
      wholesalePrice: input.wholesalePrice ?? null,
      taxInclusive: input.taxInclusive,
      taxRatePercent: input.taxRatePercent,
      taxCode: input.taxCode?.trim() || "",
      barcode: cleanBarcode,
      sku: input.sku?.trim() || null,
      hasExpiry: input.hasExpiry,
      trackStock: input.trackStock,
      currentStock: initialStock,
      lowStockThreshold: input.lowStockThreshold,
      trackBatch: input.trackBatch || false,
      trackSerial: input.trackSerial || false,
      hasVariants: input.hasVariants || false,
      isPurchaseOnly: input.isPurchaseOnly || false,
      isExpenseOnly: input.isExpenseOnly || false,
      isSaleOnly: input.isSaleOnly || false,
      isActive: true,
      createdAt: now,
      createdBy: callerUid,
    };

    const response = {
      productId,
      organizationId: input.organizationId,
      name: productDoc.name,
      currentStock: productDoc.currentStock,
      status: "created",
      message: "Product created successfully.",
    };

    await db.runTransaction(async (txn) => {
      // 1. Transaction Read phase: Verify barcode uniqueness concurrently
      if (barcodeLockRef) {
        const lockSnap = await txn.get(barcodeLockRef);
        if (lockSnap.exists) {
          throw new HttpsError(
            "already-exists",
            `Product with barcode "${cleanBarcode}" already exists in this organization.`
          );
        }
      }

      // 2. Transaction Write phase: Save product, barcode lock, opening stock, and idempotency
      txn.set(productRef, productDoc);

      if (barcodeLockRef) {
        txn.set(barcodeLockRef, {
          organizationId: input.organizationId,
          productId,
          barcode: cleanBarcode,
          createdAt: now,
        });
      }

      if (input.trackStock && initialStock > 0) {
        const targetBranchId = input.branchId || (request.auth?.token?.primaryBranchId as string | undefined) || "main-branch";
        const movementRef = db.collection("stockMovements").doc();
        const movementDoc: StockMovementDoc = {
          organizationId: input.organizationId,
          branchId: targetBranchId,
          productId,
          type: StockMovementType.ADJUSTMENT_IN,
          quantity: initialStock,
          balanceAfter: initialStock,
          unit: input.baseUnit.trim().toLowerCase(),
          referenceId: productId,
          referenceModel: "manual_adjustment",
          reason: "Initial stock / opening balance",
          createdAt: now,
          createdBy: callerUid,
        };
        txn.set(movementRef, movementDoc);

        const stockBalanceRef = db.collection("stockBalances").doc(`${input.organizationId}_${targetBranchId}_${productId}`);
        txn.set(stockBalanceRef, {
          organizationId: input.organizationId,
          branchId: targetBranchId,
          productId,
          currentStock: initialStock,
          lowStockThreshold: input.lowStockThreshold || 5,
          updatedAt: now,
          updatedBy: callerUid,
        });
      }

      if (idempotency.recordId) {
        const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
        txn.update(idempRef, {
          status: "succeeded",
          result: response,
          updatedAt: now,
        });
      }
    });

    await createAuditLog({
      organizationId: input.organizationId,
      actorUid: callerUid,
      action: "PRODUCT_CREATED",
      entityType: "product",
      entityId: productId,
      details: { name: productDoc.name, initialStock },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_PRODUCT_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create product: ${(error as Error).message}`);
  }
});

export const productsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateProductSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const productRef = db.collection("products").doc(input.productId);
  const docSnap = await productRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }

  const existing = docSnap.data() as ProductDoc;
  if (existing.organizationId !== input.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const updates: Partial<ProductDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) {
    updates.name = input.name.trim();
    updates.nameKey = input.name.trim().toLowerCase();
  }
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.categoryId !== undefined) updates.categoryId = input.categoryId;
  if (input.baseUnit) updates.baseUnit = input.baseUnit.trim().toLowerCase();
  if (input.sellingPrice !== undefined) updates.sellingPrice = input.sellingPrice;
  if (input.costPrice !== undefined) updates.costPrice = input.costPrice;
  if (input.mrp !== undefined) updates.mrp = input.mrp;
  if (input.wholesalePrice !== undefined) updates.wholesalePrice = input.wholesalePrice;
  if (input.taxInclusive !== undefined) updates.taxInclusive = input.taxInclusive;
  if (input.taxRatePercent !== undefined) updates.taxRatePercent = input.taxRatePercent;
  if (input.taxCode !== undefined) updates.taxCode = input.taxCode;
  if (input.sku !== undefined) updates.sku = input.sku;
  if (input.hasExpiry !== undefined) updates.hasExpiry = input.hasExpiry;
  if (input.trackStock !== undefined) updates.trackStock = input.trackStock;
  if (input.lowStockThreshold !== undefined) updates.lowStockThreshold = input.lowStockThreshold;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const now = new Date().toISOString();
  updates.updatedAt = now;

  const oldBarcode = existing.barcode?.trim() || null;
  const newBarcode = input.barcode !== undefined ? (input.barcode?.trim() || null) : undefined;
  const barcodeChanged = newBarcode !== undefined && newBarcode !== oldBarcode;

  if (barcodeChanged) {
    updates.barcode = newBarcode;
    const newLockRef = newBarcode
      ? db.collection("barcodeLocks").doc(`${input.organizationId}_${newBarcode.toLowerCase()}`)
      : null;
    const oldLockRef = oldBarcode
      ? db.collection("barcodeLocks").doc(`${input.organizationId}_${oldBarcode.toLowerCase()}`)
      : null;

    await db.runTransaction(async (txn) => {
      if (newLockRef) {
        const lockSnap = await txn.get(newLockRef);
        if (lockSnap.exists && lockSnap.data()?.productId !== input.productId) {
          throw new HttpsError(
            "already-exists",
            `Product with barcode "${newBarcode}" already exists in this organization.`
          );
        }
      }

      txn.update(productRef, updates);

      if (oldLockRef) {
        txn.delete(oldLockRef);
      }
      if (newLockRef) {
        txn.set(newLockRef, {
          organizationId: input.organizationId,
          productId: input.productId,
          barcode: newBarcode,
          createdAt: now,
        });
      }
    });
  } else {
    await productRef.update(updates);
  }

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "PRODUCT_UPDATED",
    entityType: "product",
    entityId: input.productId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Product updated successfully." };
});

export const productsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListProductsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  let query = db.collection("products")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.categoryId) {
    query = query.where("categoryId", "==", input.categoryId);
  }
  if (input.isActive !== undefined) {
    query = query.where("isActive", "==", input.isActive);
  }

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    productId: doc.id,
    ...(doc.data() as ProductDoc),
  }));

  return { items, count: items.length };
});

export const productsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const productId = request.data?.productId;
  const organizationId = request.data?.organizationId;
  if (!productId || !organizationId) {
    throw new HttpsError("invalid-argument", "productId and organizationId required.");
  }

  await verifyTenantAccess(request.auth, organizationId);

  const docSnap = await db.collection("products").doc(productId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }

  const data = docSnap.data() as ProductDoc;
  if (data.organizationId !== organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return { productId: docSnap.id, ...data };
});
