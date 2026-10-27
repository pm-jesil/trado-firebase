/**
 * Job Role Callables
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { CreateJobRoleSchema, UpdateJobRoleSchema } from "../validation/schemas.js";
import { JobRoleDoc, MembershipDoc } from "../types/models.js";
import { createAuditLog } from "../services/audit.js";

export const jobRolesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateJobRoleSchema.safeParse(request.data);
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
    throw new HttpsError("permission-denied", "Super Admin privileges required to create global job roles.");
  }

  const jobRoleRef = db.collection("jobRoles").doc();
  const jobRoleDoc: JobRoleDoc = {
    organizationId: input.organizationId || null,
    name: input.name,
    isSystem: !input.organizationId,
    createdAt: new Date().toISOString(),
    createdBy: request.auth.uid,
  };

  await jobRoleRef.set(jobRoleDoc);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "JOB_ROLE_CREATED",
    entityType: "jobRole",
    entityId: jobRoleRef.id,
    details: { name: input.name },
  });

  return { jobRoleId: jobRoleRef.id, ...jobRoleDoc };
});

export const jobRolesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateJobRoleSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const jobRoleRef = db.collection("jobRoles").doc(input.jobRoleId);
  const jobRoleDoc = await jobRoleRef.get();
  if (!jobRoleDoc.exists) {
    throw new HttpsError("not-found", "Job role not found.");
  }

  const jobRoleData = jobRoleDoc.data() as JobRoleDoc;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (jobRoleData.isSystem && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cannot modify system-level job roles.");
  }

  const updates: Partial<JobRoleDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;

  await jobRoleRef.update(updates);

  await createAuditLog({
    organizationId: jobRoleData.organizationId,
    actorUid: request.auth.uid,
    action: "JOB_ROLE_UPDATED",
    entityType: "jobRole",
    entityId: input.jobRoleId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Job role updated successfully." };
});

export const jobRolesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const organizationId = request.data?.organizationId as string | undefined;

  const systemQuery = await db.collection("jobRoles").where("isSystem", "==", true).get();
  const systemJobRoles = systemQuery.docs.map((d) => ({ jobRoleId: d.id, ...(d.data() as JobRoleDoc) }));

  let customJobRoles: Array<{ jobRoleId: string } & JobRoleDoc> = [];
  if (organizationId) {
    const customQuery = await db.collection("jobRoles").where("organizationId", "==", organizationId).get();
    customJobRoles = customQuery.docs.map((d) => ({ jobRoleId: d.id, ...(d.data() as JobRoleDoc) }));
  }

  return { jobRoles: [...systemJobRoles, ...customJobRoles] };
});
