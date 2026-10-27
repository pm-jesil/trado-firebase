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
import { CustomerDoc, MembershipDoc } from "../types/models.js";
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

export const customersCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateCustomerSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
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
      .where("organizationId", "==", input.organizationId)
      .count()
      .get();
    const customerCode = `CUST-${String(existingCount.data().count + 1).padStart(6, "0")}`;

    const customerDoc: CustomerDoc = {
      organizationId: input.organizationId,
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
      organizationId: input.organizationId,
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

  await verifyTenantAccess(request.auth, input.organizationId);

  const customerRef = db.collection("customers").doc(input.customerId);
  const docSnap = await customerRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }

  const existing = docSnap.data() as CustomerDoc;
  if (existing.organizationId !== input.organizationId) {
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

  await customerRef.update(updates);

  await createAuditLog({
    organizationId: input.organizationId,
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

  await verifyTenantAccess(request.auth, input.organizationId);

  const query = db.collection("customers")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({
    customerId: doc.id,
    ...(doc.data() as CustomerDoc),
  }));

  return { items, count: items.length };
});

export const customersGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const customerId = request.data?.customerId;
  const organizationId = request.data?.organizationId;
  if (!customerId || !organizationId) {
    throw new HttpsError("invalid-argument", "customerId and organizationId required.");
  }

  await verifyTenantAccess(request.auth, organizationId);

  const docSnap = await db.collection("customers").doc(customerId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }

  const data = docSnap.data() as CustomerDoc;
  if (data.organizationId !== organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return { customerId: docSnap.id, ...data };
});

