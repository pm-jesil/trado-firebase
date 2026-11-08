/**
 * Job Role Callables
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { nameKey } from "../services/naturalKeys.js";
import { commitWithKeys, changedClaims } from "../services/uniqueKeys.js";
import { resolveCatalogWriteAccess } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { db } from "../services/firebase.js";
import {
  CreateJobRoleSchema,
  UpdateJobRoleSchema,
  ContextOnlySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { JobRoleDoc } from "../types/models.js";
import { createAuditLog } from "../services/audit.js";

export const jobRolesCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateJobRoleSchema, request.data);

  await resolveCatalogWriteAccess(request, input.organizationId, AppPermissions.JOB_ROLE_MANAGE);

  const jobRoleRef = db.collection("jobRoles").doc();
  const jobRoleDoc: JobRoleDoc = {
    organizationId: input.organizationId || null,
    name: input.name,
    isSystem: !input.organizationId,
    createdAt: new Date().toISOString(),
    createdBy: request.auth.uid,
  };

  // Unique name per organization ("global" for platform catalog entries)
  await commitWithKeys(jobRoleDoc.organizationId || "global", "job_role", jobRoleRef.id, (batch) => batch.set(jobRoleRef, jobRoleDoc), {
    claim: [{ kind: "job_role_name", key: nameKey(jobRoleDoc.name) }],
  });

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

  const input = parseInput(UpdateJobRoleSchema, request.data);

  const jobRoleRef = db.collection("jobRoles").doc(input.jobRoleId);
  const jobRoleDoc = await jobRoleRef.get();
  if (!jobRoleDoc.exists) {
    throw new HttpsError("not-found", "Job role not found.");
  }

  const jobRoleData = jobRoleDoc.data() as JobRoleDoc;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  // Org records: tenant gate on the record's own organization (blocks cross-tenant edits)
  await resolveCatalogWriteAccess(request, jobRoleData.organizationId, AppPermissions.JOB_ROLE_MANAGE);

  if (jobRoleData.isSystem && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cannot modify system-level job roles.");
  }

  const updates: Partial<JobRoleDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;

  const nameChange = updates.name !== undefined && updates.name !== jobRoleData.name
    ? changedClaims([{ kind: "job_role_name", key: nameKey(jobRoleData.name) }], [{ kind: "job_role_name", key: nameKey(updates.name as string) }])
    : { claim: [], release: [] };
  await commitWithKeys(jobRoleData.organizationId || "global", "job_role", input.jobRoleId, (batch) => batch.update(jobRoleRef, updates), nameChange);

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
  const { organizationId } = parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }


  const systemQuery = await db.collection("jobRoles").where("isSystem", "==", true).get();
  const systemJobRoles = systemQuery.docs.map((d) => ({ jobRoleId: d.id, ...(d.data() as JobRoleDoc) }));

  let customJobRoles: Array<{ jobRoleId: string } & JobRoleDoc> = [];
  if (organizationId) {
    const customQuery = await db.collection("jobRoles").where("organizationId", "==", organizationId).get();
    customJobRoles = customQuery.docs.map((d) => ({ jobRoleId: d.id, ...(d.data() as JobRoleDoc) }));
  }

  return { jobRoles: [...systemJobRoles, ...customJobRoles] };
});
