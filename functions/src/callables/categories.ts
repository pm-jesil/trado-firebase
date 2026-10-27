/**
 * Category Callables
 * - categoriesCreate: Create hierarchical product or expense category
 * - categoriesUpdate: Update category name, nature, or status
 * - categoriesList: Tenant-scoped listing including system categories
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  ListCategoriesSchema,
} from "../validation/schemas.js";
import { CategoryDoc, MembershipDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";

async function verifyTenantOrSuperAdmin(auth: any, organizationId?: string | null): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;
  if (!organizationId) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to manage global categories.");
  }

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

export const categoriesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateCategorySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantOrSuperAdmin(request.auth, input.organizationId);

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
      nameKey: input.name.trim().toLowerCase(),
      parentId: input.parentId || null,
      nature: input.nature?.trim() || "general",
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    await categoryRef.set(categoryDoc);

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

  const parsed = UpdateCategorySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const categoryRef = db.collection("categories").doc(input.categoryId);
  const docSnap = await categoryRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Category not found.");
  }

  const existing = docSnap.data() as CategoryDoc;
  await verifyTenantOrSuperAdmin(request.auth, existing.organizationId);

  const updates: Partial<CategoryDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) {
    updates.name = input.name.trim();
    updates.nameKey = input.name.trim().toLowerCase();
  }
  if (input.parentId !== undefined) updates.parentId = input.parentId;
  if (input.nature !== undefined) updates.nature = input.nature;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  await categoryRef.update(updates);

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

  const parsed = ListCategoriesSchema.safeParse(request.data);
  const input = parsed.success ? parsed.data : {};

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

