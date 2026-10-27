/**
 * Team Callables
 * 
 * Strict architectural rule:
 * - Teams NEVER store a 'members' array.
 * - Team membership is derived dynamically by querying memberships where teamId == teamId.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { CreateTeamSchema, UpdateTeamSchema } from "../validation/schemas.js";
import { TeamDoc, MembershipDoc, UserDoc } from "../types/models.js";
import { createAuditLog } from "../services/audit.js";

export const teamsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = CreateTeamSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${input.organizationId}`).get();
    if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
    }
  }

  const teamRef = db.collection("teams").doc();
  const teamDoc: TeamDoc = {
    organizationId: input.organizationId,
    name: input.name,
    createdAt: new Date().toISOString(),
    createdBy: request.auth.uid,
  };

  await teamRef.set(teamDoc);

  await createAuditLog({
    organizationId: input.organizationId,
    actorUid: request.auth.uid,
    action: "TEAM_CREATED",
    entityType: "team",
    entityId: teamRef.id,
    details: { name: input.name },
  });

  return { teamId: teamRef.id, ...teamDoc };
});

export const teamsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = UpdateTeamSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const teamRef = db.collection("teams").doc(input.teamId);
  const teamDoc = await teamRef.get();
  if (!teamDoc.exists) {
    throw new HttpsError("not-found", "Team not found.");
  }

  const teamData = teamDoc.data() as TeamDoc;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${teamData.organizationId}`).get();
    if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Insufficient permissions to update this team.");
    }
  }

  const updates: Partial<TeamDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name) updates.name = input.name;

  await teamRef.update(updates);

  await createAuditLog({
    organizationId: teamData.organizationId,
    actorUid: request.auth.uid,
    action: "TEAM_UPDATED",
    entityType: "team",
    entityId: input.teamId,
    details: updates as Record<string, unknown>,
  });

  return { success: true, message: "Team updated successfully." };
});

export const teamsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const organizationId = request.data?.organizationId as string;
  if (!organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  const isSuperAdmin = request.auth.token.isSuperAdmin === true;

  if (!isSuperAdmin) {
    const callerMem = await db.collection("memberships").doc(`${request.auth.uid}_${organizationId}`).get();
    if (!callerMem.exists || (callerMem.data() as MembershipDoc).status !== "active") {
      throw new HttpsError("permission-denied", "Access denied to organization teams.");
    }
  }

  const teamsQuery = await db.collection("teams").where("organizationId", "==", organizationId).get();
  const teams = [];

  for (const doc of teamsQuery.docs) {
    const teamData = doc.data() as TeamDoc;

    // Derived member count: query memberships where teamId == team.id
    const membersQuery = await db
      .collection("memberships")
      .where("organizationId", "==", organizationId)
      .where("teamId", "==", doc.id)
      .where("status", "==", "active")
      .get();

    const memberDetails = [];
    for (const memDoc of membersQuery.docs) {
      const memData = memDoc.data() as MembershipDoc;
      const userDoc = await db.collection("users").doc(memData.userId).get();
      memberDetails.push({
        membershipId: memDoc.id,
        userId: memData.userId,
        name: userDoc.exists ? (userDoc.data() as UserDoc).name : "",
      });
    }

    teams.push({
      teamId: doc.id,
      name: teamData.name,
      organizationId: teamData.organizationId,
      memberCount: memberDetails.length,
      members: memberDetails, // Dynamically computed on read, never embedded in document!
    });
  }

  return { teams };
});
