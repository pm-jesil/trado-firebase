/**
 * Platform Users Directory Callables (Super Admin Only)
 * - platformUsersList: List and search users across the platform with cursor pagination and included references.
 * - platformUsersGet: Retrieve detailed user profile, memberships, and server-computed effective permissions.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { ListPlatformUsersSchema, GetPlatformUserSchema } from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { UserDoc, MembershipDoc, OrganizationDoc, RoleDoc, MembershipBranchDoc, SubscriptionPlanDoc } from "../types/models.js";
import { resolveAllEffectivePermissions } from "../services/permissionResolver.js";
import { AppPermissions } from "../constants/permissions.js";

export const platformUsersList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Platform Super Admin privileges required.");
  }

  const input = parseInput(ListPlatformUsersSchema, request.data);
  const limit = input.limit || 20;

  // Query users collection with stable ordering by email
  let usersQuery: FirebaseFirestore.Query = db.collection("users").orderBy("email");

  if (input.cursor) {
    const cursorDoc = await db.collection("users").doc(input.cursor).get();
    if (cursorDoc.exists) {
      usersQuery = usersQuery.startAfter(cursorDoc);
    }
  }

  // Fetch limit + 1 to detect nextCursor
  const usersSnap = await usersQuery.limit(limit + 1).get();
  const rawUserDocs = usersSnap.docs.slice(0, limit);
  const nextCursor = usersSnap.docs.length > limit ? usersSnap.docs[limit - 1].id : null;

  // Retrieve all memberships for these users
  const userIds = rawUserDocs.map((d) => d.id);
  const membershipsByUser = new Map<string, Array<{ id: string } & MembershipDoc>>();
  const orgIdsSet = new Set<string>();
  const roleIdsSet = new Set<string>();

  if (userIds.length > 0) {
    for (let i = 0; i < userIds.length; i += 10) {
      const slice = userIds.slice(i, i + 10);
      const mSnap = await db.collection("memberships").where("userId", "in", slice).get();
      for (const mDoc of mSnap.docs) {
        const m = mDoc.data() as MembershipDoc;
        if (!membershipsByUser.has(m.userId)) membershipsByUser.set(m.userId, []);
        membershipsByUser.get(m.userId)!.push({ id: mDoc.id, ...m });
        if (m.organizationId) orgIdsSet.add(m.organizationId);
        if (m.roleId) roleIdsSet.add(m.roleId);
      }
    }
  }

  // Retrieve branch assignments for these users
  const branchIdsByMembership = new Map<string, string[]>();
  if (userIds.length > 0) {
    for (let i = 0; i < userIds.length; i += 10) {
      const slice = userIds.slice(i, i + 10);
      const mbSnap = await db.collection("membershipBranches").where("userId", "in", slice).get();
      for (const mbDoc of mbSnap.docs) {
        const mb = mbDoc.data() as MembershipBranchDoc;
        const list = branchIdsByMembership.get(mb.membershipId) || [];
        list.push(mb.branchId);
        branchIdsByMembership.set(mb.membershipId, list);
      }
    }
  }

  // Load referenced organizations and roles for the normalized 'included' map
  const [orgSnaps, roleSnaps] = await Promise.all([
    orgIdsSet.size > 0 ? db.getAll(...Array.from(orgIdsSet).map((id) => db.collection("organizations").doc(id))) : [],
    roleIdsSet.size > 0 ? db.getAll(...Array.from(roleIdsSet).map((id) => db.collection("roles").doc(id))) : [],
  ]);

  const includedOrganizations: Record<string, { id: string; name: string; status: string }> = {};
  for (const s of orgSnaps) {
    if (s.exists) {
      const o = s.data() as OrganizationDoc;
      includedOrganizations[s.id] = { id: s.id, name: o.name, status: o.status };
    }
  }

  const includedRoles: Record<string, { id: string; name: string; code: string }> = {};
  for (const s of roleSnaps) {
    if (s.exists) {
      const r = s.data() as RoleDoc;
      includedRoles[s.id] = { id: s.id, name: r.name, code: r.code };
    }
  }

  // Build items and apply in-memory filters (organizationId, roleId, status, branchId, q)
  const items: Array<{
    id: string;
    name: string;
    email: string;
    accountType?: string;
    status: string;
    phone?: string;
    memberships: Array<{
      membershipId: string;
      organizationId: string;
      roleId: string;
      branchIds: string[];
      status: string;
    }>;
  }> = [];

  const qLower = input.q?.toLowerCase().trim();

  for (const doc of rawUserDocs) {
    const user = doc.data() as UserDoc;
    const userMemberships = membershipsByUser.get(doc.id) || [];

    // Filter by organizationId
    if (input.organizationId && !userMemberships.some((m) => m.organizationId === input.organizationId)) {
      continue;
    }

    // Filter by roleId
    if (input.roleId && !userMemberships.some((m) => m.roleId === input.roleId)) {
      continue;
    }

    // Filter by status
    if (input.status && user.isActive !== (input.status === "active")) {
      continue;
    }

    // Filter by branchId
    if (input.branchId) {
      const hasBranch = userMemberships.some((m) => {
        const bIds = branchIdsByMembership.get(m.id) || (m.primaryBranchId ? [m.primaryBranchId] : []);
        return bIds.includes(input.branchId!);
      });
      if (!hasBranch) continue;
    }

    // Free-text query q (name, email, phone)
    if (qLower) {
      const nameMatch = user.name?.toLowerCase().includes(qLower);
      const emailMatch = user.email?.toLowerCase().includes(qLower);
      const phoneMatch = user.phone ? user.phone.toLowerCase().includes(qLower) : false;
      if (!nameMatch && !emailMatch && !phoneMatch) {
        continue;
      }
    }

    items.push({
      id: doc.id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      status: user.isActive ? "active" : "inactive",
      phone: user.phone || undefined,
      memberships: userMemberships.map((m) => ({
        membershipId: m.id,
        organizationId: m.organizationId,
        roleId: m.roleId,
        branchIds: branchIdsByMembership.get(m.id) || (m.primaryBranchId ? [m.primaryBranchId] : []),
        status: m.status,
      })),
    });
  }

  const countSnap = await db.collection("users").count().get();
  const totalCount = countSnap.data().count;

  return {
    items,
    users: items,
    count: items.length,
    totalCount,
    nextCursor,
    included: {
      organizations: includedOrganizations,
      roles: includedRoles,
    },
  };
});

export const platformUsersGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth || request.auth.token.isSuperAdmin !== true) {
    throw new HttpsError("permission-denied", "Platform Super Admin privileges required.");
  }

  const input = parseInput(GetPlatformUserSchema, request.data);

  const userDoc = await db.collection("users").doc(input.userId).get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", `User "${input.userId}" not found.`);
  }

  const user = userDoc.data() as UserDoc;

  // Load all memberships for this user
  const membershipsSnap = await db.collection("memberships").where("userId", "==", input.userId).get();
  const rawMemberships = membershipsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as MembershipDoc) }));

  // Load branch assignments for this user
  const mbSnap = await db.collection("membershipBranches").where("userId", "==", input.userId).get();
  const branchesByMembership = new Map<string, string[]>();
  for (const mbDoc of mbSnap.docs) {
    const mb = mbDoc.data() as MembershipBranchDoc;
    const list = branchesByMembership.get(mb.membershipId) || [];
    list.push(mb.branchId);
    branchesByMembership.set(mb.membershipId, list);
  }

  // Collect referenced organizations, roles, and plans to resolve effective permissions
  const orgIds = Array.from(new Set(rawMemberships.map((m) => m.organizationId).filter(Boolean)));
  const roleIds = Array.from(new Set(rawMemberships.map((m) => m.roleId).filter(Boolean)));

  const [orgSnaps, roleSnaps] = await Promise.all([
    orgIds.length > 0 ? db.getAll(...orgIds.map((id) => db.collection("organizations").doc(id))) : [],
    roleIds.length > 0 ? db.getAll(...roleIds.map((id) => db.collection("roles").doc(id))) : [],
  ]);

  const orgMap = new Map(orgSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as OrganizationDoc]));
  const roleMap = new Map(roleSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as RoleDoc]));

  // Load plans referenced by organizations
  const planIds = Array.from(new Set(Array.from(orgMap.values()).map((o) => o.planId).filter(Boolean)));
  const planSnaps = planIds.length > 0 ? await db.getAll(...planIds.map((id) => db.collection("subscriptionPlans").doc(id))) : [];
  const planMap = new Map(planSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as SubscriptionPlanDoc]));

  const allPermissionCodes = Object.values(AppPermissions);

  // Build memberships with computed effective permissions
  const memberships = rawMemberships.map((m) => {
    const org = orgMap.get(m.organizationId);
    const role = roleMap.get(m.roleId);
    const plan = org?.planId ? planMap.get(org.planId) : undefined;

    const effectivePermissions = role
      ? resolveAllEffectivePermissions(allPermissionCodes, {
        isSuperAdmin: false,
        roleCode: role.code,
        rolePermissions: role.permissions || [],
        membershipOverrides: m.permissions || {},
        planModuleFlags: plan?.moduleFlags || {},
        orgModuleToggles: org?.moduleToggles || {},
      })
      : [];

    return {
      membershipId: m.id,
      organizationId: m.organizationId,
      organizationName: org?.name || null,
      roleId: m.roleId,
      roleName: role?.name || null,
      branchIds: branchesByMembership.get(m.id) || (m.primaryBranchId ? [m.primaryBranchId] : []),
      status: m.status,
      effectivePermissions,
      createdAt: m.createdAt,
    };
  });

  return {
    user: {
      id: userDoc.id,
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      accountType: user.accountType,
      isActive: user.isActive,
      createdAt: user.createdAt,
    },
    memberships,
    included: {
      organizations: Object.fromEntries(Array.from(orgMap.entries()).map(([k, v]) => [k, { id: k, name: v.name, status: v.status }])),
      roles: Object.fromEntries(Array.from(roleMap.entries()).map(([k, v]) => [k, { id: k, name: v.name, code: v.code }])),
    },
  };
});
