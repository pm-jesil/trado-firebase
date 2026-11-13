/**
 * Department Callables
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { nameKey } from "../services/naturalKeys.js";
import { commitWithKeys, changedClaims } from "../services/uniqueKeys.js";
import { resolveCatalogWriteAccess } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { db } from "../services/firebase.js";
import {
  CreateDepartmentSchema,
  UpdateDepartmentSchema,
  ContextOnlySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { DepartmentDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";

export const departmentsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateDepartmentSchema, request.data);

  await resolveCatalogWriteAccess(request, input.organizationId, AppPermissions.DEPARTMENT_MANAGE);

  const idempotency = await reserveIdempotency({
    scope: input.organizationId || "platform",
    actorUid: request.auth.uid,
    operation: "departments.create",
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
    const deptRef = db.collection("departments").doc();
    const deptDoc: DepartmentDoc = {
      organizationId: input.organizationId || null,
      name: input.name,
      headMembershipIds: input.headMembershipIds || [],
      isSystem: !input.organizationId,
      createdAt: new Date().toISOString(),
      createdBy: request.auth.uid,
    };

    // Unique name per organization ("global" for platform catalog entries)
    await commitWithKeys(deptDoc.organizationId || "global", "department", deptRef.id, (batch) => batch.set(deptRef, deptDoc), {
      claim: [{ kind: "department_name", key: nameKey(deptDoc.name) }],
    });


    const result = { departmentId: deptRef.id, ...deptDoc };

    await finalizeIdempotencySuccess(idempotency.recordId, result);

    return result;
  } catch (err) {
    await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_DEPARTMENT_FAILED", (err as Error).message);
    throw err;
  }
});

export const departmentsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateDepartmentSchema, request.data);

  const deptRef = db.collection("departments").doc(input.departmentId);
  const deptDoc = await deptRef.get();
  if (!deptDoc.exists) {
    throw new HttpsError("not-found", "Department not found.");
  }

  const deptData = deptDoc.data() as DepartmentDoc;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  // Org records: tenant gate on the record's own organization (blocks cross-tenant edits)
  await resolveCatalogWriteAccess(request, deptData.organizationId, AppPermissions.DEPARTMENT_MANAGE);

  if (deptData.isSystem && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cannot modify system-level departments.");
  }

  const updates: Partial<DepartmentDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;
  if (input.headMembershipIds) updates.headMembershipIds = input.headMembershipIds;

  const nameChange = updates.name !== undefined && updates.name !== deptData.name
    ? changedClaims([{ kind: "department_name", key: nameKey(deptData.name) }], [{ kind: "department_name", key: nameKey(updates.name as string) }])
    : { claim: [], release: [] };
  await commitWithKeys(deptData.organizationId || "global", "department", input.departmentId, (batch) => batch.update(deptRef, updates), nameChange);


  return { success: true, message: "Department updated successfully." };
});

export const departmentsList = onCall({ region: "asia-south1" }, async (request) => {
  const { organizationId } = parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }


  const systemQuery = await db.collection("departments").where("isSystem", "==", true).get();
  const systemDepts = systemQuery.docs.map((d) => ({ departmentId: d.id, ...(d.data() as DepartmentDoc) }));

  let customDepts: Array<{ departmentId: string } & DepartmentDoc> = [];
  if (organizationId) {
    const customQuery = await db.collection("departments").where("organizationId", "==", organizationId).get();
    customDepts = customQuery.docs.map((d) => ({ departmentId: d.id, ...(d.data() as DepartmentDoc) }));
  }

  return { departments: [...systemDepts, ...customDepts] };
});
