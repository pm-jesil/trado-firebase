/**
 * Department Callables
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { CreateDepartmentSchema, UpdateDepartmentSchema } from "../validation/schemas.js";
import { DepartmentDoc, MembershipDoc } from "../types/models.js";
import { createAuditLog } from "../services/audit.js";

export const departmentsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateDepartmentSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (input.organizationId) {
    if (!isSuperAdmin) {
      const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
      if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
        throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
      }
    }
  } else if (!isSuperAdmin) {
    throw new HttpsError("permission-denied", "Super Admin privileges required to create global departments.");
  }

  const deptRef = db.collection("departments").doc();
  const deptDoc: DepartmentDoc = {
    organizationId: input.organizationId || null,
    name: input.name,
    headMembershipIds: input.headMembershipIds || [],
    isSystem: !input.organizationId,
    createdAt: new Date().toISOString(),
    createdBy: request.auth.uid,
  };

  await deptRef.set(deptDoc);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "DEPARTMENT_CREATED",
    entityType: "department",
    entityId: deptRef.id,
    details: { name: input.name },
  });

  return { departmentId: deptRef.id, ...deptDoc };
});

export const departmentsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateDepartmentSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const deptRef = db.collection("departments").doc(input.departmentId);
  const deptDoc = await deptRef.get();
  if (!deptDoc.exists) {
    throw new HttpsError("not-found", "Department not found.");
  }

  const deptData = deptDoc.data() as DepartmentDoc;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (deptData.isSystem && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cannot modify system-level departments.");
  }

  const updates: Partial<DepartmentDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;
  if (input.headMembershipIds) updates.headMembershipIds = input.headMembershipIds;

  await deptRef.update(updates);

  await createAuditLog({
    organizationId: deptData.organizationId,
    actorUid: request.auth.uid,
    action: "DEPARTMENT_UPDATED",
    entityType: "department",
    entityId: input.departmentId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Department updated successfully." };
});

export const departmentsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const organizationId = request.data?.organizationId as string | undefined;

  const systemQuery = await db.collection("departments").where("isSystem", "==", true).get();
  const systemDepts = systemQuery.docs.map((d) => ({ departmentId: d.id, ...(d.data() as DepartmentDoc) }));

  let customDepts: Array<{ departmentId: string } & DepartmentDoc> = [];
  if (organizationId) {
    const customQuery = await db.collection("departments").where("organizationId", "==", organizationId).get();
    customDepts = customQuery.docs.map((d) => ({ departmentId: d.id, ...(d.data() as DepartmentDoc) }));
  }

  return { departments: [...systemDepts, ...customDepts] };
});
