/**
 * Unit of Measurement Callables
 * - unitsCreate: Create tenant or platform unit definition
 * - unitsUpdate: Update display name or precision
 * - unitsList: List units available to tenant (including global catalog)
 */

import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { nameKey } from "../services/naturalKeys.js";
import { commitWithKeys, changedClaims } from "../services/uniqueKeys.js";
import { resolveCatalogWriteAccess } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { db } from "../services/firebase.js";
import {
  CreateUnitSchema,
  UpdateUnitSchema,
  ListUnitsSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { UnitDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { createAuditLog } from "../services/audit.js";

/** Global records: Super Admin; organization records: tenant gate with catalog permission. */
function verifyTenantOrSuperAdmin(request: CallableRequest, organizationId?: string | null) {
  return resolveCatalogWriteAccess(request, organizationId, [AppPermissions.UNIT_MANAGE, AppPermissions.INVENTORY_MANAGE]);
}

export const unitsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateUnitSchema, request.data);

  await verifyTenantOrSuperAdmin(request, input.organizationId);

  const scope = input.organizationId || "platform";
  const idempotency = await reserveIdempotency({
    scope,
    actorUid: request.auth.uid,
    operation: "units.create",
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
    const unitRef = db.collection("units").doc();
    const unitId = unitRef.id;
    const now = new Date().toISOString();

    const unitDoc: UnitDoc = {
      organizationId: input.organizationId || null,
      name: input.name.trim(),
      code: input.code.trim().toLowerCase(),
      group: input.group,
      precision: input.precision,
      baseUnit: input.baseUnit?.trim().toLowerCase() || null,
      conversionFactor: input.conversionFactor,
      isActive: true,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    // Unique name per organization ("global" for platform catalog entries)
    await commitWithKeys(unitDoc.organizationId || "global", "unit", unitRef.id, (batch) => batch.set(unitRef, unitDoc), {
      claim: [{ kind: "unit_name", key: nameKey(unitDoc.name) }],
    });

    const response = {
      unitId,
      organizationId: unitDoc.organizationId,
      code: unitDoc.code,
      name: unitDoc.name,
      status: "created",
      message: "Unit of measure created successfully.",
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
      action: "UNIT_CREATED",
      entityType: "unit",
      entityId: unitId,
      details: { code: unitDoc.code, name: unitDoc.name },
    });

    return response;
  } catch (error) {
    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_UNIT_FAILED", (error as Error).message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to create unit: ${(error as Error).message}`);
  }
});

export const unitsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateUnitSchema, request.data);

  const unitRef = db.collection("units").doc(input.unitId);
  const docSnap = await unitRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Unit not found.");
  }

  const existing = docSnap.data() as UnitDoc;
  await verifyTenantOrSuperAdmin(request, existing.organizationId);

  const updates: Partial<UnitDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name.trim();
  if (input.precision !== undefined) updates.precision = input.precision;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const nameChange = updates.name !== undefined && updates.name !== existing.name
    ? changedClaims([{ kind: "unit_name", key: nameKey(existing.name) }], [{ kind: "unit_name", key: nameKey(updates.name as string) }])
    : { claim: [], release: [] };
  await commitWithKeys(existing.organizationId || "global", "unit", input.unitId, (batch) => batch.update(unitRef, updates), nameChange);

  await createAuditLog({
    organizationId: existing.organizationId,
    actorUid: request.auth.uid,
    action: "UNIT_UPDATED",
    entityType: "unit",
    entityId: input.unitId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Unit updated successfully." };
});

export const unitsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListUnitsSchema, request.data);

  const items: Array<{ unitId: string } & UnitDoc> = [];

  if (input.organizationId) {
    const tenantQuery = await db.collection("units")
      .where("organizationId", "==", input.organizationId)
      .get();
    tenantQuery.forEach((doc) => {
      items.push({ unitId: doc.id, ...(doc.data() as UnitDoc) });
    });
  }

  if (input.includeGlobal !== false) {
    const globalQuery = await db.collection("units")
      .where("organizationId", "==", null)
      .get();
    globalQuery.forEach((doc) => {
      items.push({ unitId: doc.id, ...(doc.data() as UnitDoc) });
    });
  }

  return { items, count: items.length };
});

