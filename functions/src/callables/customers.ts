/**
 * Customer Directory Callables
 * - customersCreate: Create customer profile with automatic customerCode generation
 * - customersUpdate: Update address, contact info, credit limits
 * - customersList: Tenant-scoped listing
 * - customersGet: Retrieve customer by ID
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  ListCustomersSchema,
} from "../validation/schemas.js";
import { CustomerDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";
import { verifyTenantAccess, resolveBranchContext } from "../services/tenantContext.js";

async function validateBranchIds(organizationId: string, branchIds: string[]): Promise<void> {
  for (const bId of branchIds) {
    const bSnap = await db.collection("organizations").doc(organizationId).collection("branches").doc(bId).get();
    if (!bSnap.exists || !bSnap.data()?.isActive) {
      throw new HttpsError("invalid-argument", `Branch '${bId}' does not exist or is inactive in organization.`);
    }
  }
}

export const customersCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateCustomerSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const orgId = await verifyTenantAccess(request.auth, input.organizationId);
  const callerBranchId = await resolveBranchContext(request.auth, orgId, input.branchId);

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: request.auth.uid,
    operation: "customers.create",
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
    const customerRef = db.collection("customers").doc();
    const customerId = customerRef.id;
    const now = new Date().toISOString();

    // Auto-generate customerCode
    const existingCount = await db.collection("customers")
      .where("organizationId", "==", orgId)
      .count()
      .get();
    const customerCode = `CUST-${String(existingCount.data().count + 1).padStart(6, "0")}`;

    // Resolve visibility scope
    const visibilityScope = input.visibilityScope || "all_branches";
    let sharedForBranchIds: string[] = [];

    if (visibilityScope === "branch_only") {
      sharedForBranchIds = [callerBranchId];
    } else if (visibilityScope === "selected_branches") {
      if (!input.sharedForBranchIds || input.sharedForBranchIds.length === 0) {
        throw new HttpsError("invalid-argument", "sharedForBranchIds must be non-empty when visibilityScope is selected_branches.");
      }
      await validateBranchIds(orgId, input.sharedForBranchIds);
      sharedForBranchIds = Array.from(new Set(input.sharedForBranchIds));
    } else {
      // all_branches
      if (input.sharedForBranchIds && input.sharedForBranchIds.length > 0) {
        await validateBranchIds(orgId, input.sharedForBranchIds);
        sharedForBranchIds = Array.from(new Set(input.sharedForBranchIds));
      } else {
        sharedForBranchIds = [callerBranchId];
      }
    }

    const customerDoc: CustomerDoc = {
      organizationId: orgId,
      customerCode,
      name: input.name.trim(),
      mobile: input.mobile?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      taxNumber: input.taxNumber?.trim() || null,
      billingAddress: input.billingAddress?.trim() || null,
      shippingAddress: input.shippingAddress?.trim() || null,
      priceGroup: input.priceGroup?.trim() || "retail",
      creditLimit: input.creditLimit || 0,
      creditPeriodDays: input.creditPeriodDays || 30,
      outstandingBalance: 0,
      totalSpend: 0,
      visibilityScope,
      sharedForBranchIds,
      isDefault: input.isDefault || false,
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    await customerRef.set(customerDoc);

    const response = {
      customerId,
      organizationId: customerDoc.organizationId,
      customerCode: customerDoc.customerCode,
      name: customerDoc.name,
      status: "created",
      message: "Customer created successfully.",
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
      organizationId: orgId,
      actorUid: request.auth.uid,
      action: "CUSTOMER_CREATED",
      entityType: "customer",
      entityId: customerId,
      details: { name: customerDoc.name, customerCode },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_CUSTOMER_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create customer: ${(error as Error).message}`);
  }
});

export const customersUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateCustomerSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const orgId = await verifyTenantAccess(request.auth, input.organizationId);

  const customerRef = db.collection("customers").doc(input.customerId);
  const docSnap = await customerRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }

  const existing = docSnap.data() as CustomerDoc;
  if (existing.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const updates: Partial<CustomerDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name.trim();
  if (input.mobile !== undefined) updates.mobile = input.mobile?.trim() || null;
  if (input.email !== undefined) updates.email = input.email?.trim().toLowerCase() || null;
  if (input.taxNumber !== undefined) updates.taxNumber = input.taxNumber?.trim() || null;
  if (input.billingAddress !== undefined) updates.billingAddress = input.billingAddress?.trim() || null;
  if (input.shippingAddress !== undefined) updates.shippingAddress = input.shippingAddress?.trim() || null;
  if (input.priceGroup !== undefined) updates.priceGroup = input.priceGroup;
  if (input.creditLimit !== undefined) updates.creditLimit = input.creditLimit;
  if (input.creditPeriodDays !== undefined) updates.creditPeriodDays = input.creditPeriodDays;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.visibilityScope !== undefined) updates.visibilityScope = input.visibilityScope;
  if (input.sharedForBranchIds !== undefined) {
    if (input.sharedForBranchIds.length > 0) {
      await validateBranchIds(orgId, input.sharedForBranchIds);
      updates.sharedForBranchIds = Array.from(new Set(input.sharedForBranchIds));
    } else {
      updates.sharedForBranchIds = [];
    }
  }

  await customerRef.update(updates);

  await createAuditLog({
    organizationId: orgId,
    actorUid: request.auth.uid,
    action: "CUSTOMER_UPDATED",
    entityType: "customer",
    entityId: input.customerId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Customer updated successfully." };
});

export const customersList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListCustomersSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const orgId = await verifyTenantAccess(request.auth, input.organizationId);

  const query = db.collection("customers")
    .where("organizationId", "==", orgId)
    .limit(input.limit || 50);

  const snapshot = await query.get();
  let items = snapshot.docs.map((doc) => ({
    customerId: doc.id,
    ...(doc.data() as CustomerDoc),
  }));

  // Enforce branch-level visibility in query scope
  const targetBranchId = input.branchId || (request.auth.token?.primaryBranchId as string | undefined);
  if (targetBranchId && request.auth.token?.isSuperAdmin !== true) {
    items = items.filter((c) => {
      if (!c.visibilityScope || c.visibilityScope === "all_branches") return true;
      if (c.visibilityScope === "branch_only" || c.visibilityScope === "selected_branches") {
        return Array.isArray(c.sharedForBranchIds) && c.sharedForBranchIds.includes(targetBranchId);
      }
      return true;
    });
  }

  return { items, count: items.length };
});

export const customersGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const customerId = request.data?.customerId;
  if (!customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }

  const orgId = await verifyTenantAccess(request.auth, request.data?.organizationId);

  const docSnap = await db.collection("customers").doc(customerId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }

  const data = docSnap.data() as CustomerDoc;
  if (data.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Branch visibility validation
  const callerBranchId = request.data?.branchId || (request.auth.token?.primaryBranchId as string | undefined);
  if (callerBranchId && request.auth.token?.isSuperAdmin !== true) {
    if (data.visibilityScope === "branch_only" || data.visibilityScope === "selected_branches") {
      if (!Array.isArray(data.sharedForBranchIds) || !data.sharedForBranchIds.includes(callerBranchId)) {
        throw new HttpsError("permission-denied", "Customer record is not shared with caller's branch.");
      }
    }
  }

  return { customerId: docSnap.id, ...data };
});

