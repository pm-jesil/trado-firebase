/**
 * Employee / Membership Callables
 * - employeesCreate: Tenant-scoped provisioning with role tier validation, transactional plan
 *   seat enforcement and Auth-user compensation.
 * - employeesUpdate: Tenant-scoped updates with field-level rules (no self-escalation, tier
 *   limits, reporting-cycle prevention, seat check on reactivation).
 * - employeesDeactivate: Soft membership deactivation preserving multi-tenant accounts.
 * - employeesList: Tenant-scoped, batched reads.
 *
 * Seats: organizations.activeEmployeeCount counts ACTIVE memberships EXCLUDING the Owner and is
 * changed only inside transactions, so two concurrent creations at (limit − 1) yield one success.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import type { Transaction } from "firebase-admin/firestore";
import { db, auth } from "../services/firebase.js";
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  DeactivateEmployeeSchema,
  ListEmployeesSchema,
  GetEmployeeSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { CreateEmployeeResponse } from "../types/api.js";
import {
  UserDoc,
  MembershipDoc,
  RoleDoc,
  OrganizationDoc,
  SubscriptionPlanDoc,
  MembershipBranchDoc,
  TeamDoc,
} from "../types/models.js";
import { EntityStatus, IdempotencyStatus, GateReason } from "../constants/enums.js";
import { AppPermissions } from "../constants/permissions.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { compensateAuthUser } from "../services/compensation.js";
import { getUserCustomClaims, setPrimaryOrganizationClaim, setPrimaryBranchClaim } from "../services/claims.js";
import { attachUploadedImage } from "../services/imageEngine.js";
import { queueWelcomeNotification } from "../services/notificationSender.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext, gateError, type RequestContext } from "../services/contextResolver.js";

const OWNER_ROLE_ID = "role_org_owner";

/** Plan seat capacity (admin + staff seats). */
function seatCapacity(plan: SubscriptionPlanDoc): number {
  return (plan.seatLimits?.admin || 1) + (plan.seatLimits?.staff || 10);
}

/**
 * Reads the current active employee count inside a transaction. Organizations created before
 * the counter existed are counted once from memberships (Owner excluded).
 */
async function readActiveEmployeeCount(txn: Transaction, orgId: string, org: OrganizationDoc): Promise<number> {
  if (typeof org.activeEmployeeCount === "number") return org.activeEmployeeCount;
  const snap = await txn.get(
    db.collection("memberships").where("organizationId", "==", orgId).where("status", "==", EntityStatus.ACTIVE)
  );
  return snap.docs.filter((d) => (d.data() as MembershipDoc).roleId !== OWNER_ROLE_ID).length;
}

async function assertSeatAvailable(txn: Transaction, orgId: string): Promise<{ orgRef: FirebaseFirestore.DocumentReference; next: number }> {
  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await txn.get(orgRef);
  const org = orgSnap.data() as OrganizationDoc;
  const planSnap = await txn.get(db.collection("subscriptionPlans").doc(org.planId));
  const current = await readActiveEmployeeCount(txn, orgId, org);
  if (planSnap.exists) {
    const capacity = seatCapacity(planSnap.data() as SubscriptionPlanDoc);
    if (current >= capacity) {
      throw gateError("resource-exhausted", GateReason.PLAN_LIMIT_REACHED,
        `Plan seat limit of ${capacity} employee(s) reached for this organization.`);
    }
  }
  return { orgRef, next: current + 1 };
}

/** Validates that a role is assignable by the caller in this organization. */
async function assertAssignableRole(ctx: RequestContext, roleId: string): Promise<RoleDoc> {
  const roleSnap = await db.collection("roles").doc(roleId).get();
  if (!roleSnap.exists) {
    throw new HttpsError("not-found", `Target role "${roleId}" not found.`);
  }
  const role = roleSnap.data() as RoleDoc;
  if (role.organizationId && role.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Role belongs to another organization.");
  }
  if (role.code === "org_owner") {
    throw new HttpsError("permission-denied", "Only Super Admin can assign the Organization Owner role (via organization provisioning).");
  }
  if (role.code === "admin" && !ctx.isOwner) {
    throw new HttpsError("permission-denied", "Administrators cannot provision or promote peer Administrators.");
  }
  return role;
}

/** Validates referenced memberships/teams and rejects reporting cycles (A→B→A). */
async function assertHierarchy(orgId: string, membershipId: string | null, managerIds: string[], teamId?: string | null): Promise<void> {
  if (membershipId && managerIds.includes(membershipId)) {
    throw new HttpsError("invalid-argument", "An employee cannot report to themselves.");
  }
  if (managerIds.length) {
    const snaps = await db.getAll(...managerIds.map((id) => db.collection("memberships").doc(id)));
    for (const s of snaps) {
      if (!s.exists || (s.data() as MembershipDoc).organizationId !== orgId) {
        throw new HttpsError("invalid-argument", `Reporting manager "${s.id}" is not a member of this organization.`);
      }
    }
    if (membershipId) {
      // Walk up from each manager; reaching the employee means a cycle
      const seen = new Set<string>();
      let frontier = [...managerIds];
      for (let depth = 0; depth < 20 && frontier.length; depth++) {
        const next: string[] = [];
        const ups = await db.getAll(...frontier.map((id) => db.collection("memberships").doc(id)));
        for (const u of ups) {
          if (!u.exists || seen.has(u.id)) continue;
          seen.add(u.id);
          for (const m of (u.data() as MembershipDoc).reportingToIds || []) {
            if (m === membershipId) {
              throw new HttpsError("invalid-argument", "Reporting line would create a cycle.");
            }
            next.push(m);
          }
        }
        frontier = next;
      }
    }
  }
  if (teamId) {
    const team = await db.collection("teams").doc(teamId).get();
    if (!team.exists || (team.data() as TeamDoc).organizationId !== orgId) {
      throw new HttpsError("invalid-argument", "teamId does not belong to this organization.");
    }
  }
}

async function assertBranches(orgId: string, branchIds: string[]): Promise<void> {
  const snaps = await db.getAll(...branchIds.map((b) => db.collection("organizations").doc(orgId).collection("branches").doc(b)));
  for (const s of snaps) {
    if (!s.exists || s.data()?.isActive === false) {
      throw new HttpsError("invalid-argument", `Branch "${s.id}" does not exist or is inactive.`);
    }
  }
}

// ---------------------------------------------------------------------------
// employeesCreate
// ---------------------------------------------------------------------------

export const employeesCreate = onCall({ region: "asia-south1" }, async (request): Promise<CreateEmployeeResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateEmployeeSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EMPLOYEE_CREATE });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH, "organizationId does not match caller's organization.");
  }
  const orgId = ctx.organizationId;
  const orgData = ctx.organization;

  const assignedRoleId = input.roleId || "role_employee";
  await assertAssignableRole(ctx, assignedRoleId);
  if (input.permissionOverrides && Object.keys(input.permissionOverrides).length > 0 &&
    !ctx.can(AppPermissions.EMPLOYEE_PERMISSION_UPDATE)) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Permission overrides require employee:permission_update.", { reason: "PERMISSION_DENIED" });
  }

  const assignedBranchIds = (input.branchIds && input.branchIds.length > 0)
    ? Array.from(new Set(input.branchIds))
    : [orgData.defaultBranchId || "main-branch"];
  const employeeDefaultBranch = input.defaultBranchId || assignedBranchIds[0];
  if (!assignedBranchIds.includes(employeeDefaultBranch)) assignedBranchIds.push(employeeDefaultBranch);
  await assertBranches(orgId, assignedBranchIds);
  await assertHierarchy(orgId, null, input.reportingToIds || [], input.teamId);

  // Idempotency Check & Reservation (with lease expiry & side-effect recovery)
  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: ctx.callerUid,
    operation: "employees.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
    recoveryChecker: async () => {
      try {
        const existingAuth = await auth.getUserByEmail(input.email);
        const checkMemRef = db.collection("memberships").doc(`${existingAuth.uid}_${orgId}`);
        const checkMemDoc = await checkMemRef.get();
        if (checkMemDoc.exists && (checkMemDoc.data() as MembershipDoc).status === EntityStatus.ACTIVE) {
          return {
            userId: existingAuth.uid,
            membershipId: checkMemRef.id,
            organizationId: orgId,
            status: "active",
            message: "Employee provisioned successfully.",
          };
        }
      } catch {
        // User not yet created
      }
      return null;
    },
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation is currently in progress. Please retry shortly.");
    }
    return idempotency.cachedResult as unknown as CreateEmployeeResponse;
  }

  let createdAuthUid: string | null = null;

  try {
    // Create Firebase Auth user or join an existing user (multi-tenant membership)
    let targetUid: string;
    try {
      const existingUser = await auth.getUserByEmail(input.email);
      targetUid = existingUser.uid;
    } catch {
      const password = input.initialPassword || Math.random().toString(36).slice(-10) + "Bb2@";
      const newAuthUser = await auth.createUser({
        email: input.email,
        displayName: input.name,
        phoneNumber: input.phone || undefined,
        password,
      });
      createdAuthUid = newAuthUser.uid;
      targetUid = newAuthUser.uid;
    }

    const membershipId = `${targetUid}_${orgId}`;
    const membershipRef = db.collection("memberships").doc(membershipId);
    const userRef = db.collection("users").doc(targetUid);
    const now = new Date().toISOString();
    const userClaims = await getUserCustomClaims(targetUid);

    const membershipDocData: MembershipDoc = {
      userId: targetUid,
      organizationId: orgId,
      roleId: assignedRoleId,
      departmentId: input.departmentId || null,
      jobRoleIds: input.jobRoleIds || [],
      teamId: input.teamId || null,
      reportingToIds: input.reportingToIds || [],
      permissions: input.permissionOverrides || {},
      status: EntityStatus.ACTIVE,
      isPrimary: !userClaims.primaryOrganizationId,
      primaryBranchId: employeeDefaultBranch,
      createdAt: now,
      createdBy: ctx.callerUid,
      updatedAt: now,
      updatedBy: ctx.callerUid,
    };

    const response: CreateEmployeeResponse = {
      userId: targetUid,
      membershipId,
      organizationId: orgId,
      status: "active",
      message: "Employee provisioned successfully.",
    };

    let imageRef = input.image || null;
    if (input.uploadId) {
      imageRef = await attachUploadedImage({
        uploadId: input.uploadId,
        purpose: "user_photo",
        entityType: "user",
        entityId: targetUid,
        callerUid: ctx.callerUid,
        scope: orgId,
      });
    }

    await db.runTransaction(async (txn) => {
      // === READS ===
      const existingMembership = await txn.get(membershipRef);
      if (existingMembership.exists && (existingMembership.data() as MembershipDoc).status === EntityStatus.ACTIVE) {
        throw new HttpsError("already-exists", "User is already an active member of this organization.");
      }
      const seat = await assertSeatAvailable(txn, orgId);
      const userSnapshot = await txn.get(userRef);

      // === WRITES ===
      if (!userSnapshot.exists) {
        const userDocData: UserDoc = {
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          /** D-15: ONE stored image field, NO url inside, NO photoUrl/avatarUrl duplicates. */
          image: imageRef || undefined,
          accountType: "standard",
          isActive: true,
          createdAt: now,
          createdBy: ctx.callerUid,
        };
        txn.set(userRef, userDocData);
      } else {
        txn.update(userRef, {
          isActive: true,
          updatedAt: now,
          /** D-15: only the typed ImageRef stored; no url, no photoUrl, no avatarUrl. */
          ...(imageRef ? { image: imageRef } : {}),
        });
      }
      txn.set(membershipRef, membershipDocData);
      for (const bId of assignedBranchIds) {
        const mbDoc: MembershipBranchDoc = {
          organizationId: orgId,
          branchId: bId,
          membershipId,
          userId: targetUid,
          status: EntityStatus.ACTIVE,
          isDefaultForMembership: bId === employeeDefaultBranch,
          permissions: {},
          createdAt: now,
          createdBy: ctx.callerUid,
          updatedAt: now,
        };
        txn.set(db.collection("membershipBranches").doc(`${membershipId}_${bId}`), mbDoc);
      }
      txn.update(seat.orgRef, { activeEmployeeCount: seat.next, updatedAt: now });
      if (idempotency.recordId) {
        txn.update(db.collection("idempotencyRecords").doc(idempotency.recordId), {
          status: IdempotencyStatus.SUCCEEDED,
          result: response as unknown as Record<string, unknown>,
          updatedAt: now,
        });
      }
    });

    // Claims are set only after the membership committed (seat may have been refused)
    if (!userClaims.primaryOrganizationId) {
      await setPrimaryOrganizationClaim(targetUid, orgId);
    }
    if (!userClaims.primaryBranchId) {
      await setPrimaryBranchClaim(targetUid, employeeDefaultBranch);
    }


    await queueWelcomeNotification(targetUid, input.name, orgData.name);

    return response;
  } catch (error) {
    if (createdAuthUid) {
      const rollback = await compensateAuthUser(createdAuthUid, (error as Error).message);
      if (!rollback.success) {
        console.error(`[CRITICAL] Rollback incomplete for auth user ${createdAuthUid}:`, rollback.error);
      }
    }

    if (idempotency.recordId) {
      await finalizeIdempotencyFailure(idempotency.recordId, "PROVISIONING_FAILED", (error as Error).message);
    }

    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to provision employee: ${(error as Error).message}`);
  }
});

// ---------------------------------------------------------------------------
// employeesUpdate
// ---------------------------------------------------------------------------

export const employeesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateEmployeeSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EMPLOYEE_UPDATE });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH, "organizationId does not match caller's organization.");
  }
  const orgId = ctx.organizationId;

  const membershipRef = db.collection("memberships").doc(input.membershipId);
  const membershipDoc = await membershipRef.get();
  if (!membershipDoc.exists) {
    throw new HttpsError("not-found", "Membership record not found.");
  }
  const target = membershipDoc.data() as MembershipDoc;
  if (target.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  // Field-level write rules
  const isSelf = input.membershipId === ctx.membershipId;
  const privileged = input.roleId !== undefined || input.permissionOverrides !== undefined ||
    input.status !== undefined || input.dataScopes !== undefined;
  if (isSelf && privileged) {
    throw gateError("permission-denied", GateReason.FIELD_NOT_EDITABLE, "You cannot change your own role, permissions, data scope or status.");
  }
  if (target.roleId === OWNER_ROLE_ID && !isSelf) {
    throw gateError("permission-denied", GateReason.FIELD_NOT_EDITABLE, "The Organization Owner membership is managed by the platform.");
  }
  if (!ctx.isOwner && target.roleId === "role_admin" && !isSelf) {
    throw gateError("permission-denied", GateReason.FIELD_NOT_EDITABLE, "Administrators cannot modify peer Administrators.");
  }
  if (input.permissionOverrides !== undefined && !ctx.can(AppPermissions.EMPLOYEE_PERMISSION_UPDATE)) {
    throw gateError("permission-denied", GateReason.PERMISSION_DENIED, "Permission overrides require employee:permission_update.");
  }
  if (input.roleId) await assertAssignableRole(ctx, input.roleId);
  if (input.reportingToIds !== undefined || input.teamId !== undefined) {
    await assertHierarchy(orgId, input.membershipId, input.reportingToIds || [], input.teamId);
  }

  const now = new Date().toISOString();
  const updates: Partial<MembershipDoc> = { updatedAt: now, updatedBy: ctx.callerUid };
  if (input.roleId) updates.roleId = input.roleId;
  if (input.departmentId !== undefined) updates.departmentId = input.departmentId;
  if (input.jobRoleIds) updates.jobRoleIds = input.jobRoleIds;
  if (input.teamId !== undefined) updates.teamId = input.teamId;
  if (input.reportingToIds) updates.reportingToIds = input.reportingToIds;
  if (input.permissionOverrides) updates.permissions = input.permissionOverrides;
  if (input.dataScopes) updates.dataScopes = input.dataScopes;
  if (input.status) updates.status = input.status;

  const reactivating = input.status === EntityStatus.ACTIVE && target.status !== EntityStatus.ACTIVE;
  const deactivating = input.status !== undefined && input.status !== EntityStatus.ACTIVE && target.status === EntityStatus.ACTIVE;

  await db.runTransaction(async (txn) => {
    const orgRef = db.collection("organizations").doc(orgId);
    if (reactivating) {
      const seat = await assertSeatAvailable(txn, orgId);
      txn.update(membershipRef, updates);
      txn.update(seat.orgRef, { activeEmployeeCount: seat.next, updatedAt: now });
      return;
    }
    if (deactivating) {
      const org = (await txn.get(orgRef)).data() as OrganizationDoc;
      const current = await readActiveEmployeeCount(txn, orgId, org);
      txn.update(membershipRef, updates);
      txn.update(orgRef, { activeEmployeeCount: Math.max(0, current - 1), updatedAt: now });
      return;
    }
    txn.update(membershipRef, updates);
  });

  let updatedImageRef = input.image;
  if (input.uploadId) {
    updatedImageRef = await attachUploadedImage({
      uploadId: input.uploadId,
      purpose: "user_photo",
      entityType: "user",
      entityId: target.userId,
      callerUid: ctx.callerUid,
      scope: orgId,
    });
  }

  if (input.name !== undefined || input.phone !== undefined || updatedImageRef !== undefined) {
    await db.collection("users").doc(target.userId).update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
    /** D-15: only the typed ImageRef; no url, no photoUrl, no avatarUrl. */
    ...(updatedImageRef ? { image: updatedImageRef } : {}),
      updatedAt: now,
    });
  }


  return { success: true, message: "Employee membership updated successfully." };
});

// ---------------------------------------------------------------------------
// employeesDeactivate
// ---------------------------------------------------------------------------

export const employeesDeactivate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(DeactivateEmployeeSchema, request.data);

  const ctx = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.EMPLOYEE_SUSPEND, AppPermissions.EMPLOYEE_DELETE, AppPermissions.EMPLOYEE_UPDATE],
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH, "organizationId does not match caller's organization.");
  }
  const orgId = ctx.organizationId;

  const membershipRef = db.collection("memberships").doc(input.membershipId);
  const memDoc = await membershipRef.get();
  if (!memDoc.exists) {
    throw new HttpsError("not-found", "Membership record not found.");
  }
  const memData = memDoc.data() as MembershipDoc;
  if (memData.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }
  if (input.membershipId === ctx.membershipId) {
    throw new HttpsError("failed-precondition", "You cannot deactivate your own membership.");
  }
  if (memData.roleId === OWNER_ROLE_ID) {
    throw gateError("permission-denied", GateReason.FIELD_NOT_EDITABLE, "The Organization Owner can only be changed by the platform Super Admin.");
  }
  if (!ctx.isOwner && memData.roleId === "role_admin") {
    throw gateError("permission-denied", GateReason.FIELD_NOT_EDITABLE, "Administrators cannot deactivate peer Administrators.");
  }

  const now = new Date().toISOString();
  await db.runTransaction(async (txn) => {
    const orgRef = db.collection("organizations").doc(orgId);
    const org = (await txn.get(orgRef)).data() as OrganizationDoc;
    const wasActive = (await txn.get(membershipRef)).data()?.status === EntityStatus.ACTIVE;
    const current = wasActive ? await readActiveEmployeeCount(txn, orgId, org) : 0;
    txn.update(membershipRef, { status: EntityStatus.INACTIVE, updatedAt: now, updatedBy: ctx.callerUid });
    if (wasActive) txn.update(orgRef, { activeEmployeeCount: Math.max(0, current - 1), updatedAt: now });
  });

  // Soft-disable the global user only when no active memberships remain anywhere
  const otherMemberships = await db
    .collection("memberships")
    .where("userId", "==", memData.userId)
    .where("status", "==", "active")
    .get();

  if (otherMemberships.docs.length === 0) {
    await db.collection("users").doc(memData.userId).update({
      isActive: false,
      updatedAt: now,
    });
  }


  return { success: true, message: "Employee deactivated successfully in this organization." };
});

// ---------------------------------------------------------------------------
// employeesList
// ---------------------------------------------------------------------------

export const employeesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListEmployeesSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EMPLOYEE_VIEW });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH, "organizationId does not match caller's organization.");
  }

  let query: FirebaseFirestore.Query = db
    .collection("memberships")
    .where("organizationId", "==", ctx.organizationId);
  if (input.status) {
    query = query.where("status", "==", input.status);
  }
  const { snapshot, nextCursor } = await fetchPage(query, "memberships", input.startAfterId, input.limit || 50);

  // Batched user / role reads (no N+1)
  const members = snapshot.docs.map((d) => ({ id: d.id, data: d.data() as MembershipDoc }));
  const userIds = Array.from(new Set(members.map((m) => m.data.userId)));
  const roleIds = Array.from(new Set(members.map((m) => m.data.roleId).filter(Boolean)));
  const [userSnaps, roleSnaps] = await Promise.all([
    userIds.length ? db.getAll(...userIds.map((u) => db.collection("users").doc(u))) : Promise.resolve([]),
    roleIds.length ? db.getAll(...roleIds.map((r) => db.collection("roles").doc(r))) : Promise.resolve([]),
  ]);
  const users = new Map(userSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as UserDoc]));
  const roles = new Map(roleSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as RoleDoc]));

  const items = members.map(({ id, data }) => ({
    membershipId: id,
    userId: data.userId,
    userName: users.get(data.userId)?.name || "",
    userEmail: users.get(data.userId)?.email || "",
    roleId: data.roleId,
    roleName: roles.get(data.roleId)?.name || "",
    status: data.status,
    departmentId: data.departmentId,
    jobRoleIds: data.jobRoleIds || [],
    teamId: data.teamId,
    reportingToIds: data.reportingToIds || [],
    primaryBranchId: data.primaryBranchId,
    createdAt: data.createdAt,
  }));

  return {
    items,
    count: items.length,
    nextCursor,
  };
});

// ---------------------------------------------------------------------------
// employeesGet: single employee full profile (permission-gated)
// ---------------------------------------------------------------------------

export const employeesGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetEmployeeSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EMPLOYEE_VIEW });

  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH, "organizationId does not match caller's organization.");
  }
  const orgId = ctx.organizationId;

  const memRef = db.collection("memberships").doc(input.membershipId);
  const memDoc = await memRef.get();
  if (!memDoc.exists) {
    throw new HttpsError("not-found", "Membership record not found.");
  }
  const memData = memDoc.data() as MembershipDoc;
  if (memData.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const userSnap = await db.collection("users").doc(memData.userId).get();
  const userData = userSnap.exists ? (userSnap.data() as UserDoc) : null;

  const branchSnap = await db
    .collection("membershipBranches")
    .where("membershipId", "==", input.membershipId)
    .where("organizationId", "==", orgId)
    .get();

  const branchAssignments = branchSnap.docs.map((d) => {
    const b = d.data() as MembershipBranchDoc;
    return {
      branchId: b.branchId,
      isDefault: b.isDefaultForMembership || false,
    };
  });

  const isSelf = input.membershipId === ctx.membershipId;
  const isAdmin = ctx.isOwner || ctx.role?.code === "admin" || ctx.membership?.roleId === "role_admin";
  const canViewPhone = isSelf || isAdmin || ctx.can(AppPermissions.EMPLOYEE_UPDATE);
  const canViewOverrides = isSelf || ctx.isOwner || ctx.can(AppPermissions.EMPLOYEE_PERMISSION_UPDATE) || ctx.can(AppPermissions.EMPLOYEE_UPDATE);

  const employeePayload = {
    membershipId: input.membershipId,
    userId: memData.userId,
    organizationId: memData.organizationId,
    name: userData?.name || "",
    email: userData?.email || "",
    phone: canViewPhone ? (userData?.phone || null) : undefined,
    roleId: memData.roleId,
    departmentId: memData.departmentId || null,
    jobRoleIds: memData.jobRoleIds || [],
    teamId: memData.teamId || null,
    reportingToIds: memData.reportingToIds || [],
    status: memData.status,
    primaryBranchId: memData.primaryBranchId || null,
    branchAssignments,
    permissionOverrides: canViewOverrides ? (memData.permissions || {}) : undefined,
    dataScopes: memData.dataScopes || null,
    createdAt: memData.createdAt,
    updatedAt: memData.updatedAt,
  };

  return {
    employee: employeePayload,
  };
});
