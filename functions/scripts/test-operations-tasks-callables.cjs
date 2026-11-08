/**
 * Trado Firebase Backend — Operations, Tasks, Locations, Notifications & Deliveries Callables Contract Test
 * 
 * Tests 16 exports:
 * 1. tasksCreate
 * 2. tasksUpdate
 * 3. tasksAssign
 * 4. tasksUpdateStatus
 * 5. tasksList
 * 6. tasksDelete
 * 7. locationsRecordPing
 * 8. locationsGetLatest
 * 9. locationsGetHistory
 * 10. notificationsRegisterFcmToken
 * 11. notificationsList
 * 12. notificationsMarkRead
 * 13. deliveriesCreate
 * 14. deliveriesUpdateStatus
 * 15. deliveriesList
 * 16. deliveriesGet
 */

const assert = require("node:assert/strict");
const { verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { createTenantOwnerPersona, createEmployeePersona, createUnassignedUserPersona, db } = require("./helpers/auth-personas.cjs");
const { buildProductPayload, buildCustomerPayload } = require("./helpers/domain-builders.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: OPERATIONS, TASKS, LOCATIONS & NOTIFICATIONS CONTRACT      ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  console.log("[SETUP] Provisioning test personas...");
  const owner = await createTenantOwnerPersona({
    businessName: "Operations & Logistics Hub",
    defaultBranchName: "Central Hub",
    defaultBranchCode: "HUB",
  });
  const unassigned = await createUnassignedUserPersona();
  const ownerToken = owner.idToken;
  const orgId = owner.organizationId;
  console.log(`✓ Tenant Owner authenticated: ${owner.email} (Org: ${orgId})`);

  // Create staff employee
  const staff = await createEmployeePersona(ownerToken, orgId, {
    roleCode: "cashier",
    branchId: "main-branch",
    // Explicit grants: the base employee role has no task/location permissions
    permissions: {
      "task:view": true,
      "task:update": true,
      "location:ping": true,
      "location:view_own": true,
      "notification:view": true,
    },
  });
  const staffToken = staff.idToken;
  const staffMembershipId = staff.membershipId;
  console.log(`✓ Staff Employee authenticated: ${staff.email} (Membership: ${staffMembershipId})\n`);

  // Enable location tracking for staff member in memberships collection for location tests
  await db.collection("memberships").doc(staffMembershipId).update({
    locationTrackingEnabled: true,
  });

  // ============================================================
  // 1. Tasks Lifecycle: Create, Update, Assign, UpdateStatus, List, Delete
  // ============================================================
  console.log("[DOMAIN: TASKS] Testing tasksCreate, tasksUpdate, tasksAssign, tasksUpdateStatus, tasksList, tasksDelete...");

  // Unassigned user rejected
  await assertCallableError(
    callFunction("tasksCreate", {
      organizationId: orgId,
      title: "Audit stock shelves",
      assignedToMembershipId: staffMembershipId,
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ tasksCreate rejected unassigned user");

  // Create Task assigned to staff
  const taskCreateRes = await callFunction("tasksCreate", {
    organizationId: orgId,
    title: "Quarterly stock shelf count",
    description: "Verify physical counts on Aisle 4 and 5",
    assignedToMembershipId: staffMembershipId,
    priority: "high",
  }, ownerToken);
  assert.ok(taskCreateRes.taskId, "tasksCreate must return taskId");
  assert.equal(taskCreateRes.status, "pending");
  const taskId = taskCreateRes.taskId;
  console.log(`✓ Task created: ID ${taskId}, Status: pending, Assignee: ${staffMembershipId}`);

  // Update Task details
  const taskUpdateRes = await callFunction("tasksUpdate", {
    organizationId: orgId,
    taskId,
    title: "Quarterly stock shelf count (Aisles 4, 5, 6)",
    priority: "urgent",
  }, ownerToken);
  assert.ok(taskUpdateRes.taskId, "tasksUpdate must return taskId");
  assert.equal(taskUpdateRes.priority, "urgent");
  console.log("✓ tasksUpdate updated title and priority");

  // Assign Task (reassign to owner)
  const ownerMembershipId = owner.membershipId || `${owner.ownerUid}_${orgId}`;
  const taskAssignRes = await callFunction("tasksAssign", {
    organizationId: orgId,
    taskId,
    assignedToMembershipId: ownerMembershipId,
  }, ownerToken);
  assert.ok(taskAssignRes.taskId);
  assert.equal(taskAssignRes.assignedToMembershipId, ownerMembershipId);
  console.log(`✓ tasksAssign reassigned task to owner: ${ownerMembershipId}`);

  // Update Task Status
  const statusRes = await callFunction("tasksUpdateStatus", {
    organizationId: orgId,
    taskId,
    status: "in_progress",
  }, ownerToken);
  assert.ok(statusRes.taskId);
  assert.equal(statusRes.status, "in_progress");
  console.log("✓ tasksUpdateStatus changed status to in_progress");

  // List Tasks
  const taskListRes = await callFunction("tasksList", {
    organizationId: orgId,
    status: "in_progress",
  }, ownerToken);
  assert.ok(Array.isArray(taskListRes.items));
  assert.ok(taskListRes.items.some(t => t.taskId === taskId));
  console.log(`✓ tasksList returned ${taskListRes.items.length} tasks`);

  // Delete Task
  const deleteRes = await callFunction("tasksDelete", {
    organizationId: orgId,
    taskId,
  }, ownerToken);
  assert.ok(deleteRes.deleted, "tasksDelete must succeed");
  console.log("✓ tasksDelete removed task");

  // ============================================================
  // 2. Live Location Tracking: RecordPing, GetLatest, GetHistory
  // ============================================================
  console.log("\n[DOMAIN: LOCATIONS] Testing locationsRecordPing, locationsGetLatest, locationsGetHistory...");

  // Staff records location ping
  const pingRes = await callFunction("locationsRecordPing", {
    organizationId: orgId,
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 10,
    speed: 0,
    heading: 90,
    source: "foreground",
  }, staffToken);
  assert.ok(pingRes.success, "locationsRecordPing must succeed");
  assert.equal(pingRes.latitude, 12.9716);
  assert.equal(pingRes.longitude, 77.5946);
  console.log(`✓ locationsRecordPing recorded coordinates (12.9716, 77.5946)`);

  // Verify native Firestore Timestamp on persisted locationPing
  const pingDocsSnap = await db.collection("locationPings")
    .where("organizationId", "==", orgId)
    .where("membershipId", "==", staffMembershipId)
    .get();
  assert.ok(!pingDocsSnap.empty, "locationPing document must be persisted");
  const pingData = pingDocsSnap.docs[0].data();
  assert.ok(pingData.expiresAt, "expiresAt must exist on persisted location ping");
  assert.ok(typeof pingData.expiresAt.toDate === "function" || pingData.expiresAt._seconds !== undefined, "expiresAt must be a native Firestore Timestamp");
  const expiresMs = typeof pingData.expiresAt.toDate === "function" ? pingData.expiresAt.toDate().getTime() : pingData.expiresAt._seconds * 1000;
  const createdMs = new Date(pingData.createdAt).getTime();
  const diffMs = expiresMs - createdMs;
  assert.ok(Math.abs(diffMs - 604800000) < 5000, `expiresAt must be 604,800,000 ms after createdAt, got diff: ${diffMs}`);
  console.log(`✓ locationPing persisted with native Firestore Timestamp expiresAt (+7 days exact TTL offset)`);

  // Test Privacy & Consent Lifecycle: Deactivated employee ping rejection
  await db.collection("memberships").doc(staffMembershipId).update({ status: "inactive" });
  await assertCallableError(
    callFunction("locationsRecordPing", {
      organizationId: orgId,
      latitude: 12.9716,
      longitude: 77.5946,
    }, staffToken),
    ["failed-precondition", "permission-denied", "permissiondenied"]
  );
  await db.collection("memberships").doc(staffMembershipId).update({ status: "active" });
  console.log(`✓ locationsRecordPing correctly rejected deactivated employee ping`);

  // Query latest locations
  const latestLocRes = await callFunction("locationsGetLatest", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(Array.isArray(latestLocRes.locations));
  assert.ok(latestLocRes.locations.some(l => l.membershipId === staffMembershipId));
  console.log(`✓ locationsGetLatest retrieved ${latestLocRes.locations.length} active location pings`);

  // Query location history
  const historyLocRes = await callFunction("locationsGetHistory", {
    organizationId: orgId,
    membershipId: staffMembershipId,
  }, ownerToken);
  assert.ok(Array.isArray(historyLocRes.pings));
  assert.ok(historyLocRes.pings.length >= 1);
  console.log(`✓ locationsGetHistory retrieved ${historyLocRes.pings.length} breadcrumb points`);

  // ============================================================
  // 3. Notifications: RegisterFcmToken, List, MarkRead
  // ============================================================
  console.log("\n[DOMAIN: NOTIFICATIONS] Testing notificationsRegisterFcmToken, notificationsList, notificationsMarkRead...");

  // Register FCM Token
  const tokenRes = await callFunction("notificationsRegisterFcmToken", {
    deviceId: "device_test_phone_001",
    fcmToken: "fcm_token_sample_test_string_1234567890",
    platform: "android",
  }, staffToken);
  assert.ok(tokenRes.success);
  assert.equal(tokenRes.deviceId, "device_test_phone_001");
  console.log("✓ notificationsRegisterFcmToken registered device FCM token");

  // Create an in-app notification directly for testing mark read
  const notifRef = await db.collection("notifications").add({
    userId: staff.userId || staff.uid,
    organizationId: orgId,
    title: "Test In-App Notification",
    body: "You have a new delivery assigned.",
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  const testNotifId = notifRef.id;

  // List notifications
  const notifListRes = await callFunction("notificationsList", {
    unreadOnly: true,
  }, staffToken);
  assert.ok(Array.isArray(notifListRes.items));
  assert.ok(notifListRes.items.some(n => n.notificationId === testNotifId));
  console.log(`✓ notificationsList returned ${notifListRes.items.length} unread notifications`);

  // Mark notification as read
  const markReadRes = await callFunction("notificationsMarkRead", {
    notificationId: testNotifId,
  }, staffToken);
  assert.equal(markReadRes.notificationId, testNotifId);
  assert.equal(markReadRes.isRead, true);
  console.log("✓ notificationsMarkRead marked notification as read");

  // ============================================================
  // 4. Deliveries Lifecycle: Create, UpdateStatus, List, Get
  // ============================================================
  console.log("\n[DOMAIN: DELIVERIES] Testing deliveriesCreate, deliveriesUpdateStatus, deliveriesList, deliveriesGet...");

  // Setup product and bill for delivery reference
  const prodRes = await callFunction("productsCreate", buildProductPayload(orgId, {
    name: "Express Delivery Item",
    sellingPrice: 500,
    costPrice: 300,
    initialStock: 50,
  }), ownerToken);

  const billRes = await callFunction("billsCreate", {
    organizationId: orgId,
    salesMode: "pos",
    items: [{ productId: prodRes.productId, quantity: 1 }],
    paidAmount: 500,
    paymentMethod: "cash",
  }, ownerToken);
  const billId = billRes.billId;

  // Create Delivery
  const deliveryCreateRes = await callFunction("deliveriesCreate", {
    organizationId: orgId,
    billId,
    address: {
      line1: "Flat 402, Sunshine Apartments",
      city: "Bengaluru",
      pincode: "560001",
    },
    partner: "internal",
    deliveryFee: 40,
  }, ownerToken);

  assert.ok(deliveryCreateRes.deliveryId, "deliveriesCreate must return deliveryId");
  assert.equal(deliveryCreateRes.billId, billId);
  const deliveryId = deliveryCreateRes.deliveryId;
  console.log(`✓ Delivery created: ID ${deliveryId}, Status: ${deliveryCreateRes.status}`);

  // Update Delivery Status to out_for_delivery
  const updateStatusRes = await callFunction("deliveriesUpdateStatus", {
    organizationId: orgId,
    deliveryId,
    status: "out_for_delivery",
  }, ownerToken);
  assert.ok(updateStatusRes.success, "deliveriesUpdateStatus must succeed");
  console.log("✓ deliveriesUpdateStatus updated status to out_for_delivery");

  // Get delivery by ID
  const deliveryGetRes = await callFunction("deliveriesGet", {
    organizationId: orgId,
    deliveryId,
  }, ownerToken);
  assert.equal(deliveryGetRes.deliveryId, deliveryId);
  assert.equal(deliveryGetRes.status, "out_for_delivery");
  console.log("✓ deliveriesGet retrieved updated delivery details");

  // List deliveries
  const deliveryListRes = await callFunction("deliveriesList", {
    organizationId: orgId,
    status: "out_for_delivery",
  }, ownerToken);
  assert.ok(Array.isArray(deliveryListRes.items));
  assert.ok(deliveryListRes.items.some(d => d.deliveryId === deliveryId));
  console.log(`✓ deliveriesList returned ${deliveryListRes.items.length} deliveries matching status`);

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 16 OPERATIONS, TASKS & DELIVERIES CALLABLES VERIFIED! ✓          ");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
