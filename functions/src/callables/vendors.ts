/**
 * Vendor Directory Callables
 * - vendorsCreate: Create supplier profile with automatic vendorCode generation
 * - vendorsUpdate: Update address, contact info, payment terms
 * - vendorsList: Tenant-scoped listing
 * - vendorsGet: Retrieve vendor by ID
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateVendorSchema,
  UpdateVendorSchema,
  ListVendorsSchema,
  GetVendorSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { VendorDoc, ImageRef } from "../types/models.js";
import { attachUploadedImage } from "../services/imageEngine.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { commitWithKeys, partyClaims, changedClaims, duplicateOverride } from "../services/uniqueKeys.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { redactVendor } from "../services/redaction.js";
import { AppPermissions } from "../constants/permissions.js";

const VENDOR_READ = [AppPermissions.VENDOR_VIEW, AppPermissions.PURCHASE_CREATE];

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

  const input = parseInput(CreateVendorSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.VENDOR_CREATE });
  const orgId = ctx.organizationId;
  const callerBranchId = ctx.branchId;

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: request.auth.uid,
    operation: "vendors.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
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
      .where("organizationId", "==", orgId)
      .count()
      .get();
    const vendorCode = `VEND-${String(existingCount.data().count + 1).padStart(6, "0")}`;

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

    const partyType = input.partyType || "organization";
    const legalName = partyType === "person" ? null : (input.legalName?.trim() || null);
    let image: ImageRef | null = input.image || null;
    if (input.uploadId) {
      image = await attachUploadedImage({
        uploadId: input.uploadId,
        purpose: partyType === "person" ? "party_photo" : "org_logo",
        entityType: "vendor",
        entityId: vendorId,
        callerUid: request.auth.uid,
        scope: orgId,
      });
    }

    const vendorDoc: VendorDoc = {
      organizationId: orgId,
      vendorCode,
      partyType,
      name: input.name.trim(),
      legalName,
      image,
      phone: input.phone?.trim() || null,
      additionalPhones: input.additionalPhones || [],
      email: input.email?.trim().toLowerCase() || null,
      taxId: input.taxId?.trim() || null,
      addresses: input.addresses || [],
      bankAccounts: input.bankAccounts || [],
      contacts: input.contacts || [],
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

    await commitWithKeys(orgId, "vendor", vendorId, (batch) => batch.set(vendorRef, vendorDoc), {
      claim: duplicateOverride(ctx, input.duplicateOverrideReason) ? [] : partyClaims("vendor", vendorDoc),
    });

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

  const input = parseInput(UpdateVendorSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.VENDOR_UPDATE });
  const orgId = ctx.organizationId;
  if (input.creditLimit !== undefined && !ctx.can(AppPermissions.VENDOR_VIEW_BALANCE)) {
    throw new HttpsError("permission-denied", "[FIELD_NOT_EDITABLE] creditLimit requires vendor:view_balance.", { reason: "FIELD_NOT_EDITABLE", field: "creditLimit" });
  }

  const vendorRef = db.collection("vendors").doc(input.vendorId);
  const docSnap = await vendorRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Vendor not found.");
  }

  const existing = docSnap.data() as VendorDoc;
  if (existing.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const updates: Partial<VendorDoc> = {
    updatedAt: new Date().toISOString(),
    updatedBy: ctx.callerUid,
  };

  if (input.partyType !== undefined) updates.partyType = input.partyType;
  if (input.legalName !== undefined) {
    updates.legalName = (input.partyType === "person" || existing.partyType === "person") ? null : (input.legalName?.trim() || null);
  }
  if (input.uploadId) {
    const isPerson = (input.partyType === "person" || existing.partyType === "person");
    const attachedImage = await attachUploadedImage({
      uploadId: input.uploadId,
      purpose: isPerson ? "party_photo" : "org_logo",
      entityType: "vendor",
      entityId: input.vendorId,
      callerUid: request.auth.uid,
      scope: orgId,
    });
    updates.image = attachedImage;
  } else if (input.image !== undefined) {
    updates.image = input.image;
  }
  if (input.name) updates.name = input.name.trim();
  if (input.phone !== undefined) {
    updates.phone = input.phone?.trim() || null;
  }
  if (input.additionalPhones !== undefined) updates.additionalPhones = input.additionalPhones;
  if (input.email !== undefined) updates.email = input.email?.trim().toLowerCase() || null;
  if (input.taxId !== undefined) {
    updates.taxId = input.taxId?.trim() || null;
  }
  if (input.addresses !== undefined) updates.addresses = input.addresses;
  if (input.bankAccounts !== undefined) updates.bankAccounts = input.bankAccounts;
  if (input.contacts !== undefined) updates.contacts = input.contacts;
  if (input.paymentTermsDays !== undefined) updates.paymentTermsDays = input.paymentTermsDays;
  if (input.creditLimit !== undefined) updates.creditLimit = input.creditLimit;
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

  const before = partyClaims("vendor", existing);
  const after = partyClaims("vendor", { ...existing, ...updates });
  const keyChange = duplicateOverride(ctx, input.duplicateOverrideReason) ? { claim: [], release: changedClaims(before, after).release } : changedClaims(before, after);
  await commitWithKeys(orgId, "vendor", input.vendorId, (batch) => batch.update(vendorRef, updates), keyChange);


  return { success: true, message: "Vendor updated successfully." };
});

export const vendorsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListVendorsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: VENDOR_READ, operation: "read" });
  const orgId = ctx.organizationId;

  const query = db.collection("vendors").where("organizationId", "==", orgId);
  const { snapshot, nextCursor } = await fetchPage(query, "vendors", input.startAfterId, input.limit || 50);
  let items = snapshot.docs.map((doc) => ({
    vendorId: doc.id,
    ...(doc.data() as VendorDoc),
  }));

  // Enforce branch-level visibility in query scope
  // Branch-level visibility uses the gate-validated branch, never an unchecked client value
  const targetBranchId = ctx.branchId;
  if (!ctx.isSuperAdmin) {
    items = items.filter((v) => {
      if (!v.visibilityScope || v.visibilityScope === "all_branches") return true;
      if (v.visibilityScope === "branch_only" || v.visibilityScope === "selected_branches") {
        return Array.isArray(v.sharedForBranchIds) && v.sharedForBranchIds.includes(targetBranchId);
      }
      return true;
    });
  }

  // Filter by partyType if requested
  if (input.partyType) {
    items = items.filter((v) => (v.partyType || "organization") === input.partyType);
  }

  return { items: items.map((i) => redactVendor(i, ctx)), count: items.length, nextCursor };
});

export const vendorsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const { vendorId } = parseInput(GetVendorSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: VENDOR_READ, operation: "read" });
  const orgId = ctx.organizationId;

  const docSnap = await db.collection("vendors").doc(vendorId).get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Vendor not found.");
  }

  const data = docSnap.data() as VendorDoc;
  if (data.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Branch visibility validation
  const callerBranchId = ctx.branchId;
  if (!ctx.isSuperAdmin) {
    if (data.visibilityScope === "branch_only" || data.visibilityScope === "selected_branches") {
      if (!Array.isArray(data.sharedForBranchIds) || !data.sharedForBranchIds.includes(callerBranchId)) {
        throw new HttpsError("permission-denied", "Vendor record is not shared with caller's branch.");
      }
    }
  }

  return redactVendor({ vendorId: docSnap.id, ...data }, ctx);
});

