/**
 * Vendor Directory Callables
 * - vendorsCreate: Create supplier profile with automatic vendorCode generation
 * - vendorsUpdate: Update address, contact info, payment terms
 * - vendorsList: Tenant-scoped listing
 * - vendorsGet: Retrieve vendor by ID
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import {
  CreateVendorSchema,
  UpdateVendorSchema,
  ListVendorsSchema,
} from "../validation/schemas.js";
import { VendorDoc, MembershipDoc } from "../types/models.js";
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

async function validateBranchIds(organizationId: string, branchIds: string[]): Promise<void> {
  for (const bId of branchIds) {
    const bSnap = await db.collection("organizations").doc(organizationId).collection("branches").doc(bId).get();
    if (!bSnap.exists || !bSnap.data()?.isActive) {
      throw new HttpsError("invalid-argument", `Branch '${bId}' does not exist or is inactive in organization.`);
    }
  }
}

export const vendorsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateVendorSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "vendors.create",
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
    const vendorRef = db.collection("vendors").doc();
    const vendorId = vendorRef.id;
    const now = new Date().toISOString();

    // Auto-generate vendorCode
    const existingCount = await db.collection("vendors")
      .where("organizationId", "==", input.organizationId)
      .count()
      .get();
    const vendorCode = `VEND-${String(existingCount.data().count + 1).padStart(6, "0")}`;

    // Resolve branch and visibility scope
    const callerBranchId = input.branchId || (request.auth.token?.primaryBranchId as string | undefined) || "main-branch";
    const visibilityScope = input.visibilityScope || "all_branches";
    let sharedForBranchIds: string[] = [];

    if (visibilityScope === "branch_only") {
      sharedForBranchIds = [callerBranchId];
    } else if (visibilityScope === "selected_branches") {
      if (!input.sharedForBranchIds || input.sharedForBranchIds.length === 0) {
        throw new HttpsError("invalid-argument", "sharedForBranchIds must be non-empty when visibilityScope is selected_branches.");
      }
      await validateBranchIds(input.organizationId, input.sharedForBranchIds);
      sharedForBranchIds = Array.from(new Set(input.sharedForBranchIds));
    } else {
      // all_branches
      if (input.sharedForBranchIds && input.sharedForBranchIds.length > 0) {
        await validateBranchIds(input.organizationId, input.sharedForBranchIds);
        sharedForBranchIds = Array.from(new Set(input.sharedForBranchIds));
      } else {
        sharedForBranchIds = [callerBranchId];
      }
    }

    const vendorDoc: VendorDoc = {
      organizationId: input.organizationId,
      vendorCode,
      name: input.name.trim(),
      mobile: input.mobile?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      taxNumber: input.taxNumber?.trim() || null,
      address: input.address?.trim() || null,
      contactPerson: input.contactPerson?.trim() || null,
      paymentTermsDays: input.paymentTermsDays || 0,
      creditLimit: input.creditLimit || 0,
      outstandingPayable: 0,
      totalPurchase: 0,
      visibilityScope,
      sharedForBranchIds,
      isDefault: input.isDefault || false,
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    await vendorRef.set(vendorDoc);

    const response = {
      vendorId,
      organizationId: vendorDoc.organizationId,
      vendorCode: vendorDoc.vendorCode,
      name: vendorDoc.name,
      status: "created",
      message: "Vendor created successfully.",
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
      action: "VENDOR_CREATED",
      entityType: "vendor",
      entityId: vendorId,
      details: { name: vendorDoc.name, vendorCode },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_VENDOR_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create vendor: ${(error as Error).message}`);
  }
});

export const vendorsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateVendorSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const vendorRef = db.collection("vendors").doc(input.vendorId);
  const docSnap = await vendorRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Vendor not found.");
  }

  const existing = docSnap.data() as VendorDoc;
  if (existing.organizationId !== input.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const updates: Partial<VendorDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name.trim();
  if (input.mobile !== undefined) updates.mobile = input.mobile?.trim() || null;
  if (input.email !== undefined) updates.email = input.email?.trim().toLowerCase() || null;
  if (input.taxNumber !== undefined) updates.taxNumber = input.taxNumber?.trim() || null;
  if (input.address !== undefined) updates.address = input.address?.trim() || null;
  if (input.contactPerson !== undefined) updates.contactPerson = input.contactPerson?.trim() || null;
  if (input.paymentTermsDays !== undefined) updates.paymentTermsDays = input.paymentTermsDays;
  if (input.creditLimit !== undefined) updates.creditLimit = input.creditLimit;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.visibilityScope !== undefined) updates.visibilityScope = input.visibilityScope;
  if (input.sharedForBranchIds !== undefined) {
    if (input.sharedForBranchIds.length > 0) {
      await validateBranchIds(input.organizationId, input.sharedForBranchIds);
      updates.sharedForBranchIds = Array.from(new Set(input.sharedForBranchIds));
    } else {
      updates.sharedForBranchIds = [];
    }
  }

  await vendorRef.update(updates);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "VENDOR_UPDATED",
    entityType: "vendor",
    entityId: input.vendorId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Vendor updated successfully." };
});

export const vendorsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListVendorsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  await verifyTenantAccess(request.auth, input.organizationId);

  const query = db.collection("vendors")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  const snapshot = await query.get();
  let items = snapshot.docs.map((doc) => ({
    vendorId: doc.id,
    ...(doc.data() as VendorDoc),
  }));

  // Enforce branch-level visibility in query scope
  const targetBranchId = input.branchId || (request.auth.token?.primaryBranchId as string | undefined);
  if (targetBranchId && request.auth.token?.isSuperAdmin !== true) {
    items = items.filter((v) => {
      if (!v.visibilityScope || v.visibilityScope === "all_branches") return true;
      if (v.visibilityScope === "branch_only" || v.visibilityScope === "selected_branches") {
        return Array.isArray(v.sharedForBranchIds) && v.sharedForBranchIds.includes(targetBranchId);
      }
      return true;
    });
  }

  return { items, count: items.length };
});

export const vendorsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const vendorId = request.data?.vendorId;
  const organizationId = request.data?.organizationId;
  if (!vendorId || !organizationId) {
    throw new HttpsError("invalid-argument", "vendorId and organizationId required.");
  }

  await verifyTenantAccess(request.auth, organizationId);

  const docSnap = await db.collection("vendors").doc(vendorId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Vendor not found.");
  }

  const data = docSnap.data() as VendorDoc;
  if (data.organizationId !== organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Branch visibility validation
  const callerBranchId = request.data?.branchId || (request.auth.token?.primaryBranchId as string | undefined);
  if (callerBranchId && request.auth.token?.isSuperAdmin !== true) {
    if (data.visibilityScope === "branch_only" || data.visibilityScope === "selected_branches") {
      if (!Array.isArray(data.sharedForBranchIds) || !data.sharedForBranchIds.includes(callerBranchId)) {
        throw new HttpsError("permission-denied", "Vendor record is not shared with caller's branch.");
      }
    }
  }

  return { vendorId: docSnap.id, ...data };
});

