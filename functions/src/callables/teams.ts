/**
 * Team Callables
 *
 * Strict architectural rule:
 * - Teams NEVER store a 'members' array.
 * - Team membership is derived dynamically by querying memberships where teamId == teamId.
 *
 * Who manages teams:
 * - team:manage (Owner, Admin): create/update/deactivate any team, add/remove any member.
 * - Team leader (team.leaderMembershipId): rename/describe own team; add own reportees or
 *   unassigned staff, remove members of own team.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { nameKey } from "../services/naturalKeys.js";
import { commitWithKeys, changedClaims } from "../services/uniqueKeys.js";
import { db } from "../services/firebase.js";
import {
  CreateTeamSchema,
  UpdateTeamSchema,
  TeamMemberSchema,
  ContextOnlySchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { TeamDoc, MembershipDoc, UserDoc } from "../types/models.js";
import { createAuditLog, diffChanges } from "../services/audit.js";
import { AppPermissions } from "../constants/permissions.js";
import { resolveRequestContext, collectReporteeUserIds, gateError, type RequestContext } from "../services/contextResolver.js";
import { GateReason } from "../constants/enums.js";

const TEAM_READ = [AppPermissions.TEAM_MANAGE, AppPermissions.EMPLOYEE_VIEW];

async function loadTeam(ctx: RequestContext, teamId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; data: TeamDoc }> {
  const ref = db.collection("teams").doc(teamId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Team not found.");
  const data = snap.data() as TeamDoc;
  if (data.organizationId !== ctx.organizationId) throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  return { ref, data };
}

async function assertMemberOfOrg(orgId: string, membershipId: string): Promise<MembershipDoc> {
  const snap = await db.collection("memberships").doc(membershipId).get();
  if (!snap.exists || (snap.data() as MembershipDoc).organizationId !== orgId) {
    throw new HttpsError("invalid-argument", `Membership "${membershipId}" is not part of this organization.`);
  }
  return snap.data() as MembershipDoc;
}

export const teamsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateTeamSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.TEAM_MANAGE });
  if (input.organizationId !== ctx.organizationId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH, "organizationId does not match caller's organization.");
  }
  if (input.leaderMembershipId) await assertMemberOfOrg(ctx.organizationId, input.leaderMembershipId);

  const now = new Date().toISOString();
  const teamRef = db.collection("teams").doc();
  const teamDoc: TeamDoc = {
    organizationId: ctx.organizationId,
    name: input.name,
    description: input.description || "",
    leaderMembershipId: input.leaderMembershipId || null,
    isActive: true,
    createdAt: now,
    createdBy: ctx.callerUid,
    updatedAt: now,
    updatedBy: ctx.callerUid,
  };

  // Unique name per organization ("global" for platform catalog entries)
  await commitWithKeys(teamDoc.organizationId || "global", "team", teamRef.id, (batch) => batch.set(teamRef, teamDoc), {
    claim: [{ kind: "team_name", key: nameKey(teamDoc.name) }],
  });

  await createAuditLog({
    organizationId: ctx.organizationId,
    actorUid: ctx.callerUid,
    actorMembershipId: ctx.membershipId,
    action: "TEAM_CREATED",
    entityType: "team",
    entityId: teamRef.id,
    details: { name: input.name, leaderMembershipId: teamDoc.leaderMembershipId },
  });

  return { teamId: teamRef.id, ...teamDoc };
});

export const teamsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateTeamSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: TEAM_READ });
  const { ref, data: teamData } = await loadTeam(ctx, input.teamId);

  const canManage = ctx.can(AppPermissions.TEAM_MANAGE);
  const isLeader = !!ctx.membershipId && teamData.leaderMembershipId === ctx.membershipId;
  if (!canManage && !isLeader) {
    throw gateError("permission-denied", GateReason.PERMISSION_DENIED, "Only team:manage holders or the team leader can update this team.");
  }
  if (!canManage && (input.leaderMembershipId !== undefined || input.isActive !== undefined)) {
    throw gateError("permission-denied", GateReason.FIELD_NOT_EDITABLE, "Changing the leader or active status requires team:manage.");
  }
  if (input.leaderMembershipId) await assertMemberOfOrg(ctx.organizationId, input.leaderMembershipId);

  const updates: Partial<TeamDoc> = {
    updatedAt: new Date().toISOString(),
    updatedBy: ctx.callerUid,
  };
  if (input.name) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.leaderMembershipId !== undefined) updates.leaderMembershipId = input.leaderMembershipId;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const nameChange = updates.name !== undefined && updates.name !== teamData.name
    ? changedClaims([{ kind: "team_name", key: nameKey(teamData.name) }], [{ kind: "team_name", key: nameKey(updates.name as string) }])
    : { claim: [], release: [] };
  await commitWithKeys(teamData.organizationId || "global", "team", input.teamId, (batch) => batch.update(ref, updates), nameChange);

  await createAuditLog({
    organizationId: ctx.organizationId,
    actorUid: ctx.callerUid,
    actorMembershipId: ctx.membershipId,
    action: "TEAM_UPDATED",
    entityType: "team",
    entityId: input.teamId,
    changes: diffChanges(teamData as unknown as Record<string, unknown>, updates as Record<string, unknown>),
  });

  return { success: true, message: "Team updated successfully." };
});

/**
 * teamsAssignMember: add a membership to a team or remove it.
 * A team leader may add their own reportees (or unassigned staff) and remove own-team members.
 */
export const teamsAssignMember = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(TeamMemberSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: TEAM_READ });
  const { data: team } = await loadTeam(ctx, input.teamId);
  if (team.isActive === false && input.action === "add") {
    throw new HttpsError("failed-precondition", "Cannot add members to an inactive team.");
  }
  const member = await assertMemberOfOrg(ctx.organizationId, input.membershipId);

  const canManage = ctx.can(AppPermissions.TEAM_MANAGE);
  const isLeader = !!ctx.membershipId && team.leaderMembershipId === ctx.membershipId;
  if (!canManage) {
    if (!isLeader) {
      throw gateError("permission-denied", GateReason.PERMISSION_DENIED, "Only team:manage holders or the team leader can change team members.");
    }
    if (input.action === "add") {
      const reportees = await collectReporteeUserIds(ctx.organizationId, ctx.membershipId as string);
      if (member.teamId && member.teamId !== input.teamId && !reportees.includes(member.userId)) {
        throw gateError("permission-denied", GateReason.PERMISSION_DENIED, "Team leaders can only move their own reportees between teams.");
      }
    } else if (member.teamId !== input.teamId) {
      throw new HttpsError("failed-precondition", "Member is not part of this team.");
    }
  }

  const before = member.teamId || null;
  const after = input.action === "add" ? input.teamId : (member.teamId === input.teamId ? null : member.teamId || null);
  await db.collection("memberships").doc(input.membershipId).update({
    teamId: after,
    updatedAt: new Date().toISOString(),
    updatedBy: ctx.callerUid,
  });

  await createAuditLog({
    organizationId: ctx.organizationId,
    actorUid: ctx.callerUid,
    actorMembershipId: ctx.membershipId,
    action: input.action === "add" ? "TEAM_MEMBER_ADDED" : "TEAM_MEMBER_REMOVED",
    entityType: "employee",
    entityId: input.membershipId,
    changes: [{ field: "teamId", from: before, to: after }],
  });
  return { success: true, membershipId: input.membershipId, teamId: after };
});

export const teamsList = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const ctx = await resolveRequestContext(request, { requiredPermission: TEAM_READ, operation: "read" });
  const organizationId = ctx.organizationId;

  const [teamsQuery, membersQuery] = await Promise.all([
    db.collection("teams").where("organizationId", "==", organizationId).get(),
    db.collection("memberships")
      .where("organizationId", "==", organizationId)
      .where("status", "==", "active")
      .get(),
  ]);

  // Batched user reads for members that belong to a team (no N+1)
  const teamMembers = membersQuery.docs.filter((d) => (d.data() as MembershipDoc).teamId);
  const userIds = Array.from(new Set(teamMembers.map((d) => (d.data() as MembershipDoc).userId)));
  const userSnaps = userIds.length ? await db.getAll(...userIds.map((u) => db.collection("users").doc(u))) : [];
  const users = new Map(userSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as UserDoc]));

  const teams = teamsQuery.docs.map((doc) => {
    const teamData = doc.data() as TeamDoc;
    const members = teamMembers
      .filter((m) => (m.data() as MembershipDoc).teamId === doc.id)
      .map((m) => {
        const md = m.data() as MembershipDoc;
        return { membershipId: m.id, userId: md.userId, name: users.get(md.userId)?.name || "" };
      });
    return {
      teamId: doc.id,
      name: teamData.name,
      description: teamData.description || "",
      leaderMembershipId: teamData.leaderMembershipId || null,
      isActive: teamData.isActive !== false,
      organizationId: teamData.organizationId,
      memberCount: members.length,
      members, // Dynamically computed on read, never embedded in document!
    };
  });

  return { teams };
});
