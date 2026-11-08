/**
 * Category Callables
 * - categoriesCreate: Create hierarchical product or expense category
 * - categoriesUpdate: Update category name, nature, or status
 * - categoriesList: Tenant-scoped listing including system categories
 */

import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { commitWithKeys, changedClaims } from "../services/uniqueKeys.js";
import { nameKey } from "../services/naturalKeys.js";
import { resolveCatalogWriteAccess } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { db } from "../services/firebase.js";
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  ListCategoriesSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { CategoryDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";

/** Global records: Super Admin; organization records: tenant gate with catalog permission. */
function verifyTenantOrSuperAdmin(request: CallableRequest, organizationId?: string | null) {
  return resolveCatalogWriteAccess(request, organizationId, [AppPermissions.CATEGORY_MANAGE, AppPermissions.INVENTORY_MANAGE]);
}

export const categoriesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateCategorySchema, request.data);

  await verifyTenantOrSuperAdmin(request, input.organizationId);

  const scope = input.organizationId || "platform";
  const idempotency = await reserveIdempotency({
    scope,
    actorUid: request.auth.uid,
    operation: "categories.create",
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
    const categoryRef = db.collection("categories").doc();
    const categoryId = categoryRef.id;
    const now = new Date().toISOString();

    const categoryDoc: CategoryDoc = {
      organizationId: input.organizationId || null,
      name: input.name.trim(),
      nameKey: nameKey(input.name),
      parentId: input.parentId || null,
      nature: input.nature?.trim() || "general",
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    // Unique name per organization ("global" for platform catalog entries)
    await commitWithKeys(categoryDoc.organizationId || "global", "category", categoryRef.id, (batch) => batch.set(categoryRef, categoryDoc), {
      claim: [{ kind: "category_name", key: nameKey(categoryDoc.name) }],
    });

    const response = {
      categoryId,
      organizationId: categoryDoc.organizationId,
      name: categoryDoc.name,
      status: "created",
      message: "Category created successfully.",
    };

    if (idempotency.recordId) {
      const idempRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      await idempRef.update({
        status: "succeeded",
        result: response,
        updatedAt: now,
      });
    }

    await createAuditLog({
      organizationId: input.organizationId,
      actorUid: request.auth.uid,
      action: "CATEGORY_CREATED",
      entityType: "category",
      entityId: categoryId,
      details: { name: categoryDoc.name },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_CATEGORY_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create category: ${(error as Error).message}`);
  }
});

export const categoriesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateCategorySchema, request.data);

  const categoryRef = db.collection("categories").doc(input.categoryId);
  const docSnap = await categoryRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Category not found.");
  }

  const existing = docSnap.data() as CategoryDoc;
  await verifyTenantOrSuperAdmin(request, existing.organizationId);

  const updates: Partial<CategoryDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) {
    updates.name = input.name.trim();
    updates.nameKey = nameKey(input.name);
  }
  if (input.parentId !== undefined) updates.parentId = input.parentId;
  if (input.nature !== undefined) updates.nature = input.nature;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const nameChange = updates.name !== undefined && updates.name !== existing.name
    ? changedClaims([{ kind: "category_name", key: nameKey(existing.name) }], [{ kind: "category_name", key: nameKey(updates.name as string) }])
    : { claim: [], release: [] };
  await commitWithKeys(existing.organizationId || "global", "category", input.categoryId, (batch) => batch.update(categoryRef, updates), nameChange);

  await createAuditLog({
    organizationId: existing.organizationId,
    actorUid: request.auth.uid,
    action: "CATEGORY_UPDATED",
    entityType: "category",
    entityId: input.categoryId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Category updated successfully." };
});

export const categoriesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListCategoriesSchema, request.data);

  const items: Array<{ categoryId: string } & CategoryDoc> = [];

  // Query tenant-specific categories
  if (input.organizationId) {
    const tenantQuery = await db.collection("categories")
      .where("organizationId", "==", input.organizationId)
      .get();
    tenantQuery.forEach((doc) => {
      items.push({ categoryId: doc.id, ...(doc.data() as CategoryDoc) });
    });
  }

  // Include global/system categories
  if (input.includeGlobal !== false) {
    const globalQuery = await db.collection("categories")
      .where("organizationId", "==", null)
      .get();
    globalQuery.forEach((doc) => {
      items.push({ categoryId: doc.id, ...(doc.data() as CategoryDoc) });
    });
  }

  return { items, count: items.length };
});

