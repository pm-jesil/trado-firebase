/**
 * Employee / Membership Callables
 * - employeesCreate: Tenant-scoped provisioning with role tier validation and compensation.
 * - employeesUpdate: Tenant-scoped updates.
 * - employeesDeactivate: Soft membership deactivation preserving multi-tenant accounts.
 * - employeesList: Tenant-scoped, paginated.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth } from "../services/firebase.js";
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  DeactivateEmployeeSchema,
  ListEmployeesSchema,
} from "../validation/schemas.js";
import { CreateEmployeeResponse } from "../types/api.js";
import { UserDoc, MembershipDoc, RoleDoc, OrganizationDoc, SubscriptionPlanDoc } from "../types/models.js";
import { EntityStatus, IdempotencyStatus } from "../constants/enums.js";
import { reserveIdempotency, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { compensateAuthUser } from "../services/compensation.js";
import { getUserCustomClaims, setPrimaryOrganizationClaim } from "../services/claims.js";
import { createAuditLog } from "../services/audit.js";
import { queueWelcomeNotification } from "../services/notificationSender.js";

export const employeesCreate = onCall({ region: "asia-south1" }, async (request): Promise<CreateEmployeeResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateEmployeeSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  // 1. Authorization & Role Tier Escalation Check
  let callerRoleCode = "";
  if (!isSuperAdmin) {
    const callerMembershipRef = db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`);
    const callerMembershipDoc = await callerMembershipRef.get();

    if (!callerMembershipDoc.exists || (callerMembershipDoc.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Caller does not have an active membership in the target organization.");
    }

    const callerRoleId = (callerMembershipDoc.data() as MembershipDoc).roleId;
    const callerRoleDoc = await db.collection("roles").doc(callerRoleId).get();
    callerRoleCode = callerRoleDoc.exists ? (callerRoleDoc.data() as RoleDoc).code : "";

    if (callerRoleCode !== "org_owner" && callerRoleCode !== "admin") {
      throw new HttpsError("permission-denied", "Insufficient privileges to provision employees.");
    }
  }

  // Prevent role tier escalation: Only Super Admin can provision org_owner; Admin cannot provision org_owner
  const assignedRoleId = input.roleId || "role_employee";
  const targetRoleDoc = await db.collection("roles").doc(assignedRoleId).get();
  if (!targetRoleDoc.exists) {
    throw new HttpsError("not-found", `Target role "${assignedRoleId}" not found.`);
  }
  const targetRoleData = targetRoleDoc.data() as RoleDoc;

  if (targetRoleData.code === "org_owner" && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Only Super Admin can assign the Organization Owner role.");
  }
  if (targetRoleData.code === "admin" && callerRoleCode === "admin" && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Administrators cannot provision peer Administrators.");
  }

  // 2. Check Subscription Plan Seat Limits
  const orgDoc = await db.collection("organizations").doc(input.organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", `Organization "${input.organizationId}" not found.`);
  }
  const orgData = orgDoc.data() as OrganizationDoc;

  const planDoc = await db.collection("subscriptionPlans").doc(orgData.planId).get();
  if (planDoc.exists) {
    const planData = planDoc.data() as SubscriptionPlanDoc;
    const currentMemberships = await db
      .collection("memberships")
      .where("organizationId", "==", input.organizationId)
      .where("status", "==", "active")
      .get();

    const totalSeats = (planData.seatLimits?.admin || 1) + (planData.seatLimits?.staff || 10);
    if (currentMemberships.docs.length >= totalSeats) {
      throw new HttpsError("resource-exhausted", `Plan seat limit of ${totalSeats} reached for this organization.`);
    }
  }

  // 3. Idempotency Check & Reservation (with lease expiry & side-effect recovery)
  const idempotency = await reserveIdempotency({
    scope: input.organizationId,
    actorUid: request.auth.uid,
    operation: "employees.create",
    clientKey: input.idempotencyKey,
    payload: input as unknown as Record<string, unknown>,
    recoveryChecker: async () => {
      try {
        const existingAuth = await auth.getUserByEmail(input.email);
        const checkMemRef = db.collection("memberships").doc(`${existingAuth.uid}_${input.organizationId}`);
        const checkMemDoc = await checkMemRef.get();
        if (checkMemDoc.exists && (checkMemDoc.data() as MembershipDoc).status === EntityStatus.ACTIVE) {
          return {
            userId: existingAuth.uid,
            membershipId: checkMemRef.id,
            organizationId: input.organizationId,
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
    // 4. Create Firebase Auth user or lookup existing user by email (for multi-tenant membership join)
    let targetUid: string;
    try {
      const existingUser = await auth.getUserByEmail(input.email);
      targetUid = existingUser.uid;
    } catch {
      // User does not exist, create new Auth user
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

    const membershipId = `${targetUid}_${input.organizationId}`;
    const membershipRef = db.collection("memberships").doc(membershipId);

    // Verify membership does not already exist
    const existingMembership = await membershipRef.get();
    if (existingMembership.exists && (existingMembership.data() as MembershipDoc).status === "active") {
      throw new HttpsError("already-exists", "User is already an active member of this organization.");
    }

    // Ensure user has primaryOrganizationId claim if not already set
    const userClaims = await getUserCustomClaims(targetUid);
    if (!userClaims.primaryOrganizationId) {
      await setPrimaryOrganizationClaim(targetUid, input.organizationId);
    }

    const userRef = db.collection("users").doc(targetUid);
    const now = new Date().toISOString();

    const membershipDocData: MembershipDoc = {
      userId: targetUid,
      organizationId: input.organizationId,
      roleId: assignedRoleId,
      departmentId: input.departmentId || null,
      jobRoleIds: input.jobRoleIds || [],
      teamId: input.teamId || null,
      reportingToIds: input.reportingToIds || [],
      permissions: input.permissionOverrides || {},
      status: EntityStatus.ACTIVE,
      isPrimary: !userClaims.primaryOrganizationId,
      createdAt: now,
      createdBy: request.auth.uid,
    };

    const response: CreateEmployeeResponse = {
      userId: targetUid,
      membershipId,
      organizationId: input.organizationId,
      status: "active",
      message: "Employee provisioned successfully.",
    };

    const batch = db.batch();

    // Upsert user document
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      const userDocData: UserDoc = {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        accountType: "standard",
        isActive: true,
        createdAt: now,
        createdBy: request.auth.uid,
      };
      batch.set(userRef, userDocData);
    } else {
      batch.update(userRef, { updatedAt: now });
    }

    batch.set(membershipRef, membershipDocData);

    const auditRef = db.collection("auditLogs").doc();
    batch.set(auditRef, {
      organizationId: input.organizationId,
      actorUid: request.auth.uid,
      action: "EMPLOYEE_CREATED",
      entityType: "membership",
      entityId: membershipId,
      details: {
        userId: targetUid,
        email: input.email,
        roleId: assignedRoleId,
      },
      createdAt: now,
    });

    if (idempotency.recordId) {
      const idempotencyRef = db.collection("idempotencyRecords").doc(idempotency.recordId);
      batch.update(idempotencyRef, {
        status: IdempotencyStatus.SUCCEEDED,
        result: response as unknown as Record<string, unknown>,
        updatedAt: now,
      });
    }

    await batch.commit();

    // 5. Queue Welcome Notification
    await queueWelcomeNotification(targetUid, input.name, orgData.name);

    return response;
  } catch (error) {
    // 7. Compensating Rollback of newly created Auth user
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

export const employeesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateEmployeeSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMembershipRef = db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`);
    const callerMemDoc = await callerMembershipRef.get();
    if (!callerMemDoc.exists || (callerMemDoc.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
    }
  }

  const membershipRef = db.collection("memberships").doc(input.membershipId);
  const membershipDoc = await membershipRef.get();
  if (!membershipDoc.exists) {
    throw new HttpsError("not-found", "Membership record not found.");
  }

  const updates: Partial<MembershipDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.roleId) updates.roleId = input.roleId;
  if (input.departmentId !== undefined) updates.departmentId = input.departmentId;
  if (input.jobRoleIds) updates.jobRoleIds = input.jobRoleIds;
  if (input.teamId !== undefined) updates.teamId = input.teamId;
  if (input.reportingToIds) updates.reportingToIds = input.reportingToIds;
  if (input.permissionOverrides) updates.permissions = input.permissionOverrides;
  if (input.status) updates.status = input.status;

  await membershipRef.update(updates);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "EMPLOYEE_UPDATED",
    entityType: "membership",
    entityId: input.membershipId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Employee membership updated successfully." };
});

export const employeesDeactivate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = DeactivateEmployeeSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMembershipRef = db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`);
    const callerMemDoc = await callerMembershipRef.get();
    if (!callerMemDoc.exists || (callerMemDoc.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Caller does not have permission in this organization.");
    }
  }

  const membershipRef = db.collection("memberships").doc(input.membershipId);
  const memDoc = await membershipRef.get();
  if (!memDoc.exists) {
    throw new HttpsError("not-found", "Membership record not found.");
  }

  const memData = memDoc.data() as MembershipDoc;

  // Multi-tenant check: Soft-deactivate this specific membership
  await membershipRef.update({
    status: EntityStatus.INACTIVE,
    updatedAt: new Date().toISOString(),
  });

  // Check if user has other active memberships before touching global user status
  const otherMemberships = await db
    .collection("memberships")
    .where("userId", "==", memData.userId)
    .where("status", "==", "active")
    .get();

  if (otherMemberships.docs.length === 0) {
    // No remaining active memberships anywhere, soft-disable user profile
    await db.collection("users").doc(memData.userId).update({
      isActive: false,
      updatedAt: new Date().toISOString(),
    });
  }

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "EMPLOYEE_DEACTIVATED",
    entityType: "membership",
    entityId: input.membershipId,
    details: { reason: input.reason },
  });

  return { success: true, message: "Employee deactivated successfully in this organization." };
});

export const employeesList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ListEmployeesSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
    if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Access denied to organization staff list.");
    }
  }

  let query = db
    .collection("memberships")
    .where("organizationId", "==", input.organizationId)
    .limit(input.limit || 50);

  if (input.status) {
    query = query.where("status", "==", input.status);
  }

  const snapshot = await query.get();
  const items = [];

  for (const doc of snapshot.docs) {
    const memData = doc.data() as MembershipDoc;
    const userDoc = await db.collection("users").doc(memData.userId).get();
    const roleDoc = await db.collection("roles").doc(memData.roleId).get();

    items.push({
      membershipId: doc.id,
      userId: memData.userId,
      userName: userDoc.exists ? (userDoc.data() as UserDoc).name : "",
      userEmail: userDoc.exists ? (userDoc.data() as UserDoc).email : "",
      roleId: memData.roleId,
      roleName: roleDoc.exists ? (roleDoc.data() as RoleDoc).name : "",
      status: memData.status,
      departmentId: memData.departmentId,
      teamId: memData.teamId,
      createdAt: memData.createdAt,
    });
  }

  return {
    items,
    count: items.length,
  };
});
