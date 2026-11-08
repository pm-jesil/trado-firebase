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
  GetCustomerSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { CustomerDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { commitWithKeys, partyClaims, changedClaims, duplicateOverride } from "../services/uniqueKeys.js";
import { createAuditLog, diffChanges } from "../services/audit.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { redactCustomer } from "../services/redaction.js";
import { AppPermissions } from "../constants/permissions.js";

const CUSTOMER_READ = [AppPermissions.CUSTOMER_VIEW, AppPermissions.BILL_CREATE];

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

  const input = parseInput(CreateCustomerSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.CUSTOMER_CREATE });
  const orgId = ctx.organizationId;
  const callerBranchId = ctx.branchId;

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
      additionalPhones: input.additionalPhones || [],
      whatsApp: input.whatsApp?.trim() || null,
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

    await commitWithKeys(orgId, "customer", customerId, (batch) => batch.set(customerRef, customerDoc), {
      claim: duplicateOverride(ctx, input.duplicateOverrideReason) ? [] : partyClaims("customer", customerDoc),
    });

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
      details: { duplicateOverrideReason: input.duplicateOverrideReason || null },
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

  const input = parseInput(UpdateCustomerSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.CUSTOMER_UPDATE });
  const orgId = ctx.organizationId;
  if (input.creditLimit !== undefined && !ctx.can(AppPermissions.CUSTOMER_VIEW_BALANCE)) {
    throw new HttpsError("permission-denied", "[FIELD_NOT_EDITABLE] creditLimit requires customer:view_balance.", { reason: "FIELD_NOT_EDITABLE", field: "creditLimit" });
  }

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
    updatedBy: ctx.callerUid,
  };

  if (input.name) updates.name = input.name.trim();
  if (input.mobile !== undefined) updates.mobile = input.mobile?.trim() || null;
  if (input.additionalPhones !== undefined) updates.additionalPhones = input.additionalPhones;
  if (input.whatsApp !== undefined) updates.whatsApp = input.whatsApp?.trim() || null;
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

  const before = partyClaims("customer", existing);
  const after = partyClaims("customer", { ...existing, ...updates });
  const keyChange = duplicateOverride(ctx, input.duplicateOverrideReason) ? { claim: [], release: changedClaims(before, after).release } : changedClaims(before, after);
  await commitWithKeys(orgId, "customer", input.customerId, (batch) => batch.update(customerRef, updates), keyChange);

  await createAuditLog({
    organizationId: orgId,
    branchId: ctx.branchId,
    actorUid: ctx.callerUid,
    actorMembershipId: ctx.membershipId,
    action: "CUSTOMER_UPDATED",
    entityType: "customer",
    entityId: input.customerId,
    changes: diffChanges(existing as unknown as Record<string, unknown>, updates as Record<string, unknown>),
  });

  return { success: true, message: "Customer updated successfully." };
});

export const customersList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListCustomersSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: CUSTOMER_READ, operation: "read" });
  const orgId = ctx.organizationId;

  const query = db.collection("customers").where("organizationId", "==", orgId);
  const { snapshot, nextCursor } = await fetchPage(query, "customers", input.startAfterId, input.limit || 50);
  let items = snapshot.docs.map((doc) => ({
    customerId: doc.id,
    ...(doc.data() as CustomerDoc),
  }));

  // Enforce branch-level visibility in query scope
  // Branch-level visibility uses the gate-validated branch, never an unchecked client value
  const targetBranchId = ctx.branchId;
  if (!ctx.isSuperAdmin) {
    items = items.filter((c) => {
      if (!c.visibilityScope || c.visibilityScope === "all_branches") return true;
      if (c.visibilityScope === "branch_only" || c.visibilityScope === "selected_branches") {
        return Array.isArray(c.sharedForBranchIds) && c.sharedForBranchIds.includes(targetBranchId);
      }
      return true;
    });
  }

  return { items: items.map((i) => redactCustomer(i, ctx)), count: items.length, nextCursor };
});

export const customersGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { customerId } = parseInput(GetCustomerSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: CUSTOMER_READ, operation: "read" });
  const orgId = ctx.organizationId;

  const docSnap = await db.collection("customers").doc(customerId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }

  const data = docSnap.data() as CustomerDoc;
  if (data.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Branch visibility validation
  const callerBranchId = ctx.branchId;
  if (!ctx.isSuperAdmin) {
    if (data.visibilityScope === "branch_only" || data.visibilityScope === "selected_branches") {
      if (!Array.isArray(data.sharedForBranchIds) || !data.sharedForBranchIds.includes(callerBranchId)) {
        throw new HttpsError("permission-denied", "Customer record is not shared with caller's branch.");
      }
    }
  }

  return redactCustomer({ customerId: docSnap.id, ...data }, ctx);
});

