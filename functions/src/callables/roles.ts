/**
 * Role Callables
 * - rolesCreate: Create custom role (tenant-scoped) or system role (Super Admin only).
 * - rolesUpdate: Update role.
 * - rolesList: List available roles (system roles + tenant custom roles).
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateRoleSchema,
  UpdateRoleSchema,
  ContextOnlySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { RoleDoc, MembershipDoc } from "../types/models.js";
import { reserveIdempotency, finalizeIdempotencyFailure, finalizeIdempotencySuccess } from "../services/idempotency.js";

export const rolesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateRoleSchema, request.data);

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  // Platform/system roles can only be created by Super Admin
  if (!input.organizationId || input.organizationId === null) {
    if (!isSuperAdmin) {
      throw new HttpsError("permission-denied", "Super Admin privileges required to create system-wide roles.");
    }
  } else {
    // Tenant custom role: strictly Owner-only within tenant to prevent privilege escalation
    if (!isSuperAdmin) {
      const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
      if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
        throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
      }
      const memData = callerMem.data() as MembershipDoc;
      if (memData.roleId !== "role_org_owner") {
        throw new HttpsError("permission-denied", "Only Organization Owner or Super Admin can create custom roles.");
      }
    }
  }

  const idempotency = await reserveIdempotency({
    scope: input.organizationId || "platform",
    actorUid: request.auth.uid,
    operation: "roles.create",
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
    const roleRef = db.collection("roles").doc();
    const roleDoc: RoleDoc = {
      organizationId: input.organizationId || null,
      name: input.name,
      code: input.code,
      permissions: input.permissions,
      isSystem: !input.organizationId,
      description: input.description,
      createdAt: new Date().toISOString(),
      createdBy: request.auth.uid,
    };

    await roleRef.set(roleDoc);


    const result = { roleId: roleRef.id, ...roleDoc };

    await finalizeIdempotencySuccess(idempotency.recordId, result);

    return result;
  } catch (err) {
    await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_ROLE_FAILED", (err as Error).message);
    throw err;
  }
});

export const rolesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateRoleSchema, request.data);

  const roleRef = db.collection("roles").doc(input.roleId);
  const roleDoc = await roleRef.get();
  if (!roleDoc.exists) {
    throw new HttpsError("not-found", "Role not found.");
  }

  const roleData = roleDoc.data() as RoleDoc;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  // System roles cannot be modified by tenant admins
  if (roleData.isSystem && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cannot modify system-level roles.");
  }

  // Tenant custom role: strictly Owner-only within tenant to prevent privilege escalation
  if (!roleData.isSystem && !isSuperAdmin) {
    if (!roleData.organizationId) {
      throw new HttpsError("permission-denied", "Cannot modify unassociated role.");
    }
    const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${roleData.organizationId}`).get();
    if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
    }
    const memData = callerMem.data() as MembershipDoc;
    if (memData.roleId !== "role_org_owner") {
      throw new HttpsError("permission-denied", "Only Organization Owner or Super Admin can modify custom roles.");
    }
  }

  const updates: Partial<RoleDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;
  if (input.permissions) updates.permissions = input.permissions;
  if (input.description) updates.description = input.description;

  await roleRef.update(updates);


  return { success: true, message: "Role updated successfully." };
});

export const rolesList = onCall({ region: "asia-south1" }, async (request) => {
  const { organizationId } = parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }


  // Fetch system roles (available platform-wide)
  const systemRolesQuery = await db.collection("roles").where("isSystem", "==", true).get();
  const systemRoles = systemRolesQuery.docs.map((doc) => ({ roleId: doc.id, ...(doc.data() as RoleDoc) }));

  // If organizationId provided, also fetch organization-specific custom roles
  let customRoles: Array<{ roleId: string } & RoleDoc> = [];
  if (organizationId) {
    const customRolesQuery = await db.collection("roles").where("organizationId", "==", organizationId).get();
    customRoles = customRolesQuery.docs.map((doc) => ({ roleId: doc.id, ...(doc.data() as RoleDoc) }));
  }

  return {
    roles: [...systemRoles, ...customRoles],
  };
});
