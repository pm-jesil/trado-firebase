/**
 * Tasks Module Callables
 * 
 * Provides:
 * - `tasksCreate`: Creates task, assigns to self or staff member, dispatches notification
 * - `tasksUpdate`: Updates task attributes
 * - `tasksAssign`: Reassigns task to a staff member
 * - `tasksUpdateStatus`: Updates status (pending, in_progress, completed, cancelled)
 * - `tasksList`: Lists tasks (filtered by assignee, status, priority, role)
 * - `tasksDelete`: Removes task
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  AssignTaskSchema,
  UpdateTaskStatusSchema,
  ListTasksSchema,
  DeleteTaskSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { TaskDoc } from "../types/models.js";
import { createAndDispatchNotification } from "../services/notificationService.js";

/**
 * 1. tasksCreate
 */
export const tasksCreate = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.TASK_CREATE,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(CreateTaskSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  const canAssignOthers = isOwnerOrAdmin || context.effectivePermissions.includes(AppPermissions.TASK_ASSIGN);
  const targetMembershipId = validated.assignedToMembershipId;

  // Regular employees cannot assign tasks to other staff members
  if (!canAssignOthers && targetMembershipId !== callerMembershipId) {
    throw new HttpsError(
      "permission-denied",
      "Employees can only assign tasks to themselves. Admin or Owner permission required to assign to others."
    );
  }

  // Verify target membership exists and belongs to the same organization
  const targetMemberSnap = await db.collection("memberships").doc(targetMembershipId).get();
  if (!targetMemberSnap.exists) {
    throw new HttpsError("not-found", `Target assignee membership "${targetMembershipId}" not found`);
  }
  const targetMemberData = targetMemberSnap.data()!;
  if (targetMemberData.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Assignee belongs to a different organization");
  }

  const taskDoc: TaskDoc = {
    organizationId: orgId,
    title: validated.title,
    description: validated.description || "",
    assignedToMembershipId: targetMembershipId,
    assignedByMembershipId: callerMembershipId,
    status: "pending",
    priority: validated.priority || "medium",
    dueAt: validated.dueAt || undefined,
    relatedEntityType: validated.relatedEntityType || null,
    relatedEntityId: validated.relatedEntityId || null,
    completedAt: null,
    completedByMembershipId: null,
    createdAt: new Date().toISOString(),
    createdBy: context.callerUid,
    updatedAt: new Date().toISOString(),
  };

  const ref = await db.collection("tasks").add(taskDoc);

  // Send push & in-app notification to assignee if assigning to someone else
  if (targetMembershipId !== callerMembershipId) {
    try {
      await createAndDispatchNotification({
        organizationId: orgId,
        userId: targetMemberData.userId,
        membershipId: targetMembershipId,
        type: "task_assigned",
        title: "New Task Assigned",
        body: `You have been assigned task: "${validated.title}"`,
        relatedEntityType: "task",
        relatedEntityId: ref.id,
      });
    } catch {
      // Non-blocking notification dispatch
    }
  }

  return {
    taskId: ref.id,
    ...taskDoc,
  };
});

/**
 * 2. tasksUpdate
 */
export const tasksUpdate = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.TASK_UPDATE, AppPermissions.TASK_VIEW],
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(UpdateTaskSchema, request.data);

  const taskRef = db.collection("tasks").doc(validated.taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", `Task "${validated.taskId}" not found`);
  }

  const task = taskSnap.data() as TaskDoc;
  if (task.organizationId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${task.organizationId}`;
  const isAssignee = task.assignedToMembershipId === callerMembershipId;
  const isCreator = task.assignedByMembershipId === callerMembershipId || task.createdBy === context.callerUid;
  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  const canUpdate = isOwnerOrAdmin || isAssignee || isCreator || context.effectivePermissions.includes(AppPermissions.TASK_UPDATE);

  if (!canUpdate) {
    throw new HttpsError("permission-denied", "Not authorized to update this task");
  }

  const updates: Partial<TaskDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (validated.title !== undefined) updates.title = validated.title;
  if (validated.description !== undefined) updates.description = validated.description;
  if (validated.priority !== undefined) updates.priority = validated.priority;
  if (validated.dueAt !== undefined) updates.dueAt = validated.dueAt || undefined;
  if (validated.status !== undefined) updates.status = validated.status;

  await taskRef.update(updates as any);

  return {
    taskId: validated.taskId,
    ...task,
    ...updates,
  };
});

/**
 * 3. tasksAssign
 */
export const tasksAssign = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.TASK_ASSIGN,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(AssignTaskSchema, request.data);

  const taskRef = db.collection("tasks").doc(validated.taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", `Task "${validated.taskId}" not found`);
  }

  const task = taskSnap.data() as TaskDoc;
  if (task.organizationId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const targetMemberSnap = await db.collection("memberships").doc(validated.assignedToMembershipId).get();
  if (!targetMemberSnap.exists) {
    throw new HttpsError("not-found", `Assignee membership "${validated.assignedToMembershipId}" not found`);
  }
  const targetMember = targetMemberSnap.data()!;
  if (targetMember.organizationId !== task.organizationId) {
    throw new HttpsError("permission-denied", "Assignee belongs to a different organization");
  }

  await taskRef.update({
    assignedToMembershipId: validated.assignedToMembershipId,
    updatedAt: new Date().toISOString(),
  });

  // Notify new assignee
  try {
    await createAndDispatchNotification({
      organizationId: task.organizationId,
      userId: targetMember.userId,
      membershipId: validated.assignedToMembershipId,
      type: "task_assigned",
      title: "Task Reassigned to You",
      body: `You have been assigned task: "${task.title}"`,
      relatedEntityType: "task",
      relatedEntityId: validated.taskId,
    });
  } catch {
    // Non-blocking
  }

  return {
    taskId: validated.taskId,
    assignedToMembershipId: validated.assignedToMembershipId,
    status: task.status,
  };
});

/**
 * 4. tasksUpdateStatus
 */
export const tasksUpdateStatus = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: [AppPermissions.TASK_UPDATE, AppPermissions.TASK_VIEW],
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(UpdateTaskStatusSchema, request.data);

  const taskRef = db.collection("tasks").doc(validated.taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", `Task "${validated.taskId}" not found`);
  }

  const task = taskSnap.data() as TaskDoc;
  if (task.organizationId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${task.organizationId}`;
  const isAssignee = task.assignedToMembershipId === callerMembershipId;
  const isCreator = task.assignedByMembershipId === callerMembershipId;
  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  const canChangeStatus = isOwnerOrAdmin || isAssignee || isCreator;

  if (!canChangeStatus) {
    throw new HttpsError("permission-denied", "Not authorized to update status of this task");
  }

  const updates: Partial<TaskDoc> = {
    status: validated.status,
    updatedAt: new Date().toISOString(),
  };

  if (validated.status === "completed") {
    updates.completedAt = new Date().toISOString();
    updates.completedByMembershipId = callerMembershipId;
  } else {
    updates.completedAt = null;
    updates.completedByMembershipId = null;
  }

  await taskRef.update(updates as any);

  return {
    taskId: validated.taskId,
    ...task,
    ...updates,
  };
});

/**
 * 5. tasksList
 */
export const tasksList = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.TASK_VIEW,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(ListTasksSchema, request.data);
  const orgId = validated.organizationId || context.organizationId;

  if (orgId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  const callerMembershipId = `${context.callerUid}_${orgId}`;
  const isOwnerOrAdmin = context.isOwner || context.role?.code === "admin" || context.role?.code === "org_owner" || context.role?.code === "owner";
  const canViewAll = isOwnerOrAdmin || context.effectivePermissions.includes(AppPermissions.TASK_ASSIGN);

  let query = db.collection("tasks").where("organizationId", "==", orgId);

  // Regular employee sees only own tasks
  if (!canViewAll) {
    query = query.where("assignedToMembershipId", "==", callerMembershipId);
  } else if (validated.assignedToMembershipId) {
    query = query.where("assignedToMembershipId", "==", validated.assignedToMembershipId);
  }

  if (validated.status) {
    query = query.where("status", "==", validated.status);
  }
  if (validated.priority) {
    query = query.where("priority", "==", validated.priority);
  }

  const { snapshot: snap, nextCursor } = await fetchPage(query, "tasks", validated.startAfterId, validated.limit || 50);

  const tasks = snap.docs.map((d) => ({
    taskId: d.id,
    ...(d.data() as TaskDoc),
  }));

  return {
    organizationId: orgId,
    items: tasks,
    nextCursor,
    count: tasks.length,
  };
});

/**
 * 6. tasksDelete
 */
export const tasksDelete = onCall({ region: "asia-south1" }, async (request) => {
  const context = await resolveRequestContext(request, {
    requiredPermission: AppPermissions.TASK_DELETE,
    allowPlatformSuperAdmin: true,
  });

  const validated = parseInput(DeleteTaskSchema, request.data);

  const taskRef = db.collection("tasks").doc(validated.taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", `Task "${validated.taskId}" not found`);
  }

  const task = taskSnap.data() as TaskDoc;
  if (task.organizationId !== context.organizationId && !context.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Cross-organization access denied");
  }

  // Notifications deep-link to the task: delete them with it so no reference is left dangling
  const notes = await db.collection("notifications")
    .where("organizationId", "==", task.organizationId)
    .where("relatedEntityType", "==", "task")
    .where("relatedEntityId", "==", validated.taskId)
    .get();
  const batch = db.batch();
  batch.delete(taskRef);
  notes.docs.forEach((n) => batch.delete(n.ref));
  await batch.commit();

  return {
    taskId: validated.taskId,
    deleted: true,
    deletedNotifications: notes.size,
  };
});
