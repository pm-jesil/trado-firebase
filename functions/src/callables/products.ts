/**
 * Product Callables
 * - productsCreate: Create catalog item with initial stock and movement tracking
 * - productsUpdate: Update product details, pricing, stock thresholds
 * - productsList: Tenant-scoped product listing
 * - productsGet: Retrieve single product by ID
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { uniqueKeyRef } from "../services/uniqueKeys.js";
import {
  CreateProductSchema,
  UpdateProductSchema,
  ListProductsSchema,
  PriceHistorySchema,
  GetProductSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { ProductDoc, StockMovementDoc, OutflowDoc, AuditLogDoc } from "../types/models.js";
import { StockMovementType } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import { nameKey } from "../services/naturalKeys.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { redactProduct, canViewCost } from "../services/redaction.js";
import { hydrate } from "../services/hydration.js";
import { AppPermissions } from "../constants/permissions.js";
import { round4 } from "../services/money.js";

const PRODUCT_MANAGE = [AppPermissions.PRODUCT_CREATE, AppPermissions.INVENTORY_MANAGE];
const PRODUCT_EDIT = [AppPermissions.PRODUCT_UPDATE, AppPermissions.INVENTORY_MANAGE];
/** Cashiers need catalog visibility to bill; costs are redacted for them. */
const PRODUCT_READ = [AppPermissions.PRODUCT_VIEW, AppPermissions.INVENTORY_VIEW, AppPermissions.BILL_CREATE, AppPermissions.PURCHASE_CREATE];

/** True when a product is visible to `branchId` under its visibility scope. */
function isVisibleToBranch(p: ProductDoc, branchId: string): boolean {
  const scope = p.visibilityScope || "all_branches";
  if (scope === "all_branches") return true;
  if (scope === "branch_only") return p.ownerBranchId === branchId;
  return (p.sharedForBranchIds || []).includes(branchId) || p.ownerBranchId === branchId;
}

export const productsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateProductSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: PRODUCT_MANAGE });
  const orgId = ctx.organizationId;
  const branchId = ctx.branchId;
  const callerUid = ctx.callerUid;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "products.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
    recoveryChecker: async () => {
      const existing = await db.collection("products")
        .where("organizationId", "==", orgId)
        .where("nameKey", "==", nameKey(input.name))
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
      ? uniqueKeyRef(orgId, "barcode", cleanBarcode.toLowerCase())
      : null;

    const productDoc: ProductDoc = {
      organizationId: orgId,
      name: input.name.trim(),
      nameKey: nameKey(input.name),
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
      ...pickDefined({
        brand: input.brand,
        alternateUnits: input.alternateUnits?.map((u) => ({ ...u, unit: u.unit.toLowerCase() })),
        isTaxable: input.isTaxable !== false,
        taxExemptionReason: input.taxExemptionReason,
        isDiscountable: input.isDiscountable !== false,
        maxDiscountPercent: input.maxDiscountPercent,
        isReturnable: input.isReturnable,
        returnWindowDays: input.returnWindowDays,
        reorderLevel: input.reorderLevel,
        maxStockLevel: input.maxStockLevel,
        weight: input.weight,
        dimensions: input.dimensions,
        size: input.size,
        imagePaths: input.imagePaths,
        warrantyMonths: input.warrantyMonths,
        jewellery: input.jewellery,
        variantGroupId: input.variantGroupId,
        variantAttributes: input.variantAttributes,
        visibilityScope: input.visibilityScope,
        sharedForBranchIds: input.sharedForBranchIds,
      }),
      ownerBranchId: branchId,
      isActive: true,
      createdAt: now,
      createdBy: callerUid,
      updatedAt: now,
      updatedBy: callerUid,
    };

    const response = {
      productId,
      organizationId: orgId,
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
        txn.set(barcodeLockRef, { organizationId: orgId, kind: "barcode", entityType: "product", entityId: productId, createdAt: now });
      }

      if (input.trackStock && initialStock > 0) {
        const movementRef = db.collection("stockMovements").doc();
        const movementDoc: StockMovementDoc = {
          organizationId: orgId,
          branchId,
          productId,
          type: StockMovementType.ADJUSTMENT_IN,
          quantity: initialStock,
          balanceAfter: initialStock,
          unitCostSnapshot: input.costPrice,
          referenceId: productId,
          referenceModel: "manual_adjustment",
          reason: "Initial stock / opening balance",
          createdAt: now,
          createdBy: callerUid,
        };
        txn.set(movementRef, movementDoc);

        const stockBalanceRef = db.collection("stockBalances").doc(`${orgId}_${branchId}_${productId}`);
        txn.set(stockBalanceRef, {
          organizationId: orgId,
          branchId,
          productId,
          currentStock: initialStock,
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

  const input = parseInput(UpdateProductSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: PRODUCT_EDIT });
  const orgId = ctx.organizationId;

  // Field-level write control: cost fields need cost visibility
  if (input.costPrice !== undefined && !canViewCost(ctx)) {
    throw new HttpsError("permission-denied", "[FIELD_NOT_EDITABLE] costPrice requires product:view_cost.", { reason: "FIELD_NOT_EDITABLE", field: "costPrice" });
  }

  const productRef = db.collection("products").doc(input.productId);
  const docSnap = await productRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }

  const existing = docSnap.data() as ProductDoc;
  if (existing.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const updates: Partial<ProductDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) {
    updates.name = input.name.trim();
    updates.nameKey = nameKey(input.name);
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
  if (input.trackBatch !== undefined) updates.trackBatch = input.trackBatch;
  if (input.trackSerial !== undefined) updates.trackSerial = input.trackSerial;
  Object.assign(updates, pickDefined({
    brand: input.brand,
    alternateUnits: input.alternateUnits?.map((u) => ({ ...u, unit: u.unit.toLowerCase() })),
    isTaxable: input.isTaxable,
    taxExemptionReason: input.taxExemptionReason,
    isDiscountable: input.isDiscountable,
    maxDiscountPercent: input.maxDiscountPercent,
    isReturnable: input.isReturnable,
    returnWindowDays: input.returnWindowDays,
    reorderLevel: input.reorderLevel,
    maxStockLevel: input.maxStockLevel,
    weight: input.weight,
    dimensions: input.dimensions,
    size: input.size,
    imagePaths: input.imagePaths,
    warrantyMonths: input.warrantyMonths,
    jewellery: input.jewellery,
    variantGroupId: input.variantGroupId,
    variantAttributes: input.variantAttributes,
    visibilityScope: input.visibilityScope,
    sharedForBranchIds: input.sharedForBranchIds,
  }));

  const now = new Date().toISOString();
  updates.updatedAt = now;
  updates.updatedBy = ctx.callerUid;

  const oldBarcode = existing.barcode?.trim() || null;
  const newBarcode = input.barcode !== undefined ? (input.barcode?.trim() || null) : undefined;
  const barcodeChanged = newBarcode !== undefined && newBarcode !== oldBarcode;

  if (barcodeChanged) {
    updates.barcode = newBarcode;
    const newLockRef = newBarcode
      ? uniqueKeyRef(orgId, "barcode", newBarcode.toLowerCase())
      : null;
    const oldLockRef = oldBarcode
      ? uniqueKeyRef(orgId, "barcode", oldBarcode.toLowerCase())
      : null;

    await db.runTransaction(async (txn) => {
      if (newLockRef) {
        const lockSnap = await txn.get(newLockRef);
        if (lockSnap.exists && lockSnap.data()?.entityId !== input.productId) {
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
        txn.set(newLockRef, { organizationId: orgId, kind: "barcode", entityType: "product", entityId: input.productId, createdAt: now });
      }
    });
  } else {
    await productRef.update(updates);
  }


  return { success: true, message: "Product updated successfully." };
});

export const productsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListProductsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: PRODUCT_READ, operation: "read" });
  const orgId = ctx.organizationId;

  let query: FirebaseFirestore.Query = db.collection("products").where("organizationId", "==", orgId);

  if (input.categoryId) {
    query = query.where("categoryId", "==", input.categoryId);
  }
  if (input.isActive !== undefined) {
    query = query.where("isActive", "==", input.isActive);
  }

  const { snapshot, nextCursor } = await fetchPage(query, "products", input.startAfterId, input.limit || 50);
  const items = snapshot.docs
    .filter((doc) => isVisibleToBranch(doc.data() as ProductDoc, ctx.branchId))
    .map((doc) => redactProduct({ productId: doc.id, ...(doc.data() as ProductDoc) }, ctx));

  return { items, count: items.length, nextCursor };
});

export const productsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { productId } = parseInput(GetProductSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: PRODUCT_READ, operation: "read" });
  const orgId = ctx.organizationId;

  const docSnap = await db.collection("products").doc(productId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }

  const data = docSnap.data() as ProductDoc;
  if (data.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  if (!isVisibleToBranch(data, ctx.branchId)) {
    throw new HttpsError("permission-denied", "Product is not shared with caller's branch.");
  }

  return redactProduct({ productId: docSnap.id, ...data }, ctx);
});

/** Returns a copy of `obj` without undefined values (Firestore rejects undefined). */
function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * productsGetPriceHistory
 * Purchase-cost trend is derived from purchase lines (never duplicated): per base unit,
 * per vendor, with last / min / max / quantity-weighted average. Selling price, MRP,
 * wholesale and cost edits come from the product's change history (auditLogs.changes).
 */
export const productsGetPriceHistory = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(PriceHistorySchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: PRODUCT_READ, operation: "read" });
  const productSnap = await db.collection("products").doc(input.productId).get();
  if (!productSnap.exists || (productSnap.data() as ProductDoc).organizationId !== ctx.organizationId) {
    throw new HttpsError("not-found", "Product not found.");
  }
  const showCost = canViewCost(ctx);
  const limit = input.limit || 50;

  const [purchasesSnap, changesSnap] = await Promise.all([
    showCost
      ? db.collection("outflows")
        .where("organizationId", "==", ctx.organizationId)
        .where("productIds", "array-contains", input.productId)
        .get()
      : Promise.resolve(null),
    db.collection("auditLogs")
      .where("organizationId", "==", ctx.organizationId)
      .where("entityType", "==", "product")
      .where("entityId", "==", input.productId)
      .get(),
  ]);

  const purchases: Array<Record<string, unknown>> = [];
  purchasesSnap?.docs.forEach((d) => {
    const o = d.data() as OutflowDoc;
    if (o.kind !== "purchase" || o.status !== "confirmed") return;
    if (input.vendorId && o.vendorId !== input.vendorId) return;
    for (const line of o.lines) {
      if (line.productId !== input.productId) continue;
      const factor = line.conversionFactor || 1;
      purchases.push({
        outflowId: d.id,
        outflowNumber: o.outflowNumber,
        at: o.docDate || o.createdAt,
        vendorId: o.vendorId || null,
        lineId: line.lineId,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        baseUnitCost: round4(line.unitPrice / factor),
        baseQuantity: line.baseQuantity ?? line.quantity * factor,
      });
    }
  });
  purchases.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const costs = purchases.map((p) => p.baseUnitCost as number);
  const totalQty = purchases.reduce((t, p) => t + (p.baseQuantity as number), 0);
  const weighted = purchases.reduce((t, p) => t + (p.baseUnitCost as number) * (p.baseQuantity as number), 0);
  const purchaseStats = costs.length
    ? {
      last: costs[0],
      min: Math.min(...costs),
      max: Math.max(...costs),
      average: round4(weighted / (totalQty || 1)),
      count: costs.length,
    }
    : null;

  const PRICE_FIELDS = new Set(["sellingPrice", "mrp", "wholesalePrice", ...(showCost ? ["costPrice"] : [])]);
  const priceChanges = changesSnap.docs
    .map((d) => d.data() as AuditLogDoc)
    .flatMap((log) => (log.changes?.fields || [])
      .filter((c) => PRICE_FIELDS.has(c.path))
      .map((c) => ({ at: log.occurredAt.toDate().toISOString(), actorUid: log.actorUid, field: c.path, from: c.before ?? null, to: c.after ?? null })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);

  return {
    productId: input.productId,
    purchaseCostVisible: showCost,
    purchases: purchases.slice(0, limit),
    purchaseStats,
    priceChanges,
    included: await hydrate(ctx, purchases.slice(0, limit)),
  };
});
