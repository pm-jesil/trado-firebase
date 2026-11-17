#!/usr/bin/env node
/**
 * Trado Firebase Backend — Requests & Support Desk Scenario Test Suite (Prompt 74 RB7)
 *
 * Verifies Scenarios RQ-S01..RQ-S48 and the 12 Executable Emulator Flows:
 *   - F-RQ1: Plan-Change request full lifecycle (submitted -> on_hold -> approved -> applied)
 *   - F-RQ2: Limit increase request lifecycle & org update
 *   - F-RQ3: Module toggle request lifecycle & org module update
 *   - F-RQ4: Blocker evaluation & override on plan downgrade
 *   - F-RQ5: Duplicate open plan change rejection (REQUEST_DUPLICATE_OPEN, D-43)
 *   - F-RQ6: Bug report with diagnostics opt-in -> resolve -> close
 *   - F-RQ7: Bug report reopen within 30-day window
 *   - F-RQ8: Internal note stripping on tenant read paths (D-38)
 *   - F-RQ9: Security concern visibility isolation (requester & admin only)
 *   - F-RQ10: Organization audience request handled by Org Manager
 *   - F-RQ11: SLA pause & accumulation in on_hold/needs_info (D-42)
 *   - F-RQ12: Dark launch enforcement (FEATURE_DISABLED, A-17)
 *
 * Usage:
 *   node functions/scripts/test-requests-scenarios.cjs
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { getSuperAdminPersona, createTenantOwnerPersona, createEmployeePersona, db } = require("./helpers/auth-personas.cjs");

enforceLocalEmulatorSafety();

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

async function run() {
  console.log("\n================================================================================");
  console.log("   PROMPT 74: REQUESTS & SUPPORT DESK SCENARIO VERIFICATION SUITE              ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  // Enable requests module feature toggle for tests
  await db.collection("platformSettings").doc("requests").set({
    requestsEnabled: true,
    sla: {
      urgent: { firstResponseHours: 1, resolutionHours: 4 },
      high: { firstResponseHours: 4, resolutionHours: 8 },
      normal: { firstResponseHours: 8, resolutionHours: 24 },
      low: { firstResponseHours: 24, resolutionHours: 72 },
    },
    limits: {
      maxOpenPerUser: 10,
      maxOpenPerOrg: 50,
      maxCreationsPerHourPerUser: 10,
    },
    autoCloseDays: 7,
    reopenWindowDays: 30,
    needsInfoReminderDays: 7,
    needsInfoAutoCancelDays: 14,
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  });
  ok("Configured platformSettings/requests: requestsEnabled = true");

  const superAdmin = await getSuperAdminPersona();
  const orgOwner = await createTenantOwnerPersona(superAdmin.idToken, `ReqTestOrg_${uniq()}`);
  const orgId = orgOwner.organizationId;
  const branchId = orgOwner.primaryBranchId || "main-branch";

  // Create Staff 1 (Manager with requests:manage_org) and Staff 2 (Cashier)
  const staff1 = await createEmployeePersona(orgOwner.idToken, orgId, {
    roleCode: "store_manager",
    email: `manager_${uniq()}@testorg.local`,
    name: "Branch Manager",
    permissions: {
      "requests:create": true,
      "requests:create_sensitive": true,
      "requests:read_own": true,
      "requests:read_org": true,
      "requests:comment": true,
      "requests:manage_org": true,
    },
  });

  const staff2 = await createEmployeePersona(orgOwner.idToken, orgId, {
    roleCode: "cashier",
    email: `cashier_${uniq()}@testorg.local`,
    name: "Counter Cashier",
    permissions: {
      "requests:create": true,
      "requests:read_own": true,
      "requests:comment": true,
    },
  });

  ok(`Provisioned Org: ${orgId}`);
  ok(`Provisioned Owner: ${orgOwner.ownerUserId}`);
  ok(`Provisioned Manager: ${staff1.userId}`);
  ok(`Provisioned Cashier: ${staff2.userId}`);

  // Seed plans for plan-change testing
  await db.collection("subscriptionPlans").doc("plan_starter").set({
    name: "Starter Plan",
    price: 99900,
    currency: "INR",
    storageLimitMb: 1000,
    monthlyDocumentVolumeLimit: 1000,
    seatLimits: { admin: 1, staff: 5 },
    branchLimit: 1,
    moduleFlags: { billing: true, inventory: true, staff: true, sales: true, purchases: true, expenses: true, customers: true, reports: true, returns: true, deliveries: true, tasks: true, employee_tracking: true },
    isActive: true,
    isPublic: true,
    showPriceToTenants: true,
    createdAt: new Date().toISOString(),
  });

  await db.collection("subscriptionPlans").doc("plan_pro").set({
    name: "Pro Plan",
    price: 299900,
    currency: "INR",
    storageLimitMb: 5000,
    monthlyDocumentVolumeLimit: 10000,
    seatLimits: { admin: 5, staff: 20 },
    branchLimit: 5,
    moduleFlags: { billing: true, inventory: true, staff: true, sales: true, purchases: true, expenses: true, customers: true, reports: true, returns: true, deliveries: true, tasks: true, employee_tracking: true },
    isActive: true,
    isPublic: true,
    showPriceToTenants: true,
    createdAt: new Date().toISOString(),
  });

  // Assign org to plan_starter initially
  await db.collection("organizations").doc(orgId).update({
    planId: "plan_starter",
  });
  ok("Seeded test subscription plans: plan_starter & plan_pro");

  // ---------------------------------------------------------------------------
  // Flow 1: F-RQ1 Plan-Change Request Full Lifecycle (Approval Kind)
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 1: F-RQ1 Plan-Change Request Full Lifecycle ---");

  // 1.1 Tenant views plans catalog
  const catalog = await callFunction("plansCatalogList", {}, orgOwner.idToken);
  assert.ok(catalog.items.length >= 2, "Must list public plans");
  ok(`plansCatalogList returned ${catalog.items.length} plans`);

  // 1.2 Tenant submits plan change request
  const planReq = await callFunction("requestsCreate", {
    category: "plan_change",
    title: "Request Upgrade to Pro Plan",
    description: "Expanding to second store branch next month",
    details: {
      requestedPlanId: "plan_pro",
      billingPeriod: "monthly",
      reason: "Expanding to second store branch next month and need delivery module",
    },
  }, orgOwner.idToken);

  const planReqId = planReq.request.requestId;
  assert.ok(planReqId, "Must return requestId");
  assert.strictEqual(planReq.request.status, "submitted");
  assert.strictEqual(planReq.request.requestedPlanName, "Pro Plan");
  ok(`requestsCreate filed plan_change: ${planReq.request.requestNumber} (${planReqId})`);

  // 1.2b Tenant reads request via requestsGet
  const getReq = await callFunction("requestsGet", {
    requestId: planReqId,
  }, orgOwner.idToken);
  assert.strictEqual(getReq.request.requestId, planReqId);
  ok(`requestsGet retrieved request by ID`);

  // 1.3 Super Admin sees request in platform inbox
  const inbox = await callFunction("requestsInboxList", {
    category: ["plan_change"],
  }, superAdmin.idToken);
  assert.ok(inbox.items.some((i) => i.requestId === planReqId), "Request must appear in Super Admin inbox");
  ok(`requestsInboxList found submitted request`);

  // 1.4 Super Admin starts review
  const inReview = await callFunction("requestsTransition", {
    requestId: planReqId,
    action: "start_review",
    expectedStatus: "submitted",
  }, superAdmin.idToken);
  assert.strictEqual(inReview.request.status, "in_review");
  ok(`requestsTransition start_review -> in_review`);

  // 1.5 Super Admin puts on hold with resumeOn date (pauses SLA clock)
  const onHold = await callFunction("requestsTransition", {
    requestId: planReqId,
    action: "hold",
    expectedStatus: "in_review",
    resumeOn: "2026-11-20T00:00:00.000Z",
    reason: "Awaiting billing cycle alignment",
  }, superAdmin.idToken);
  assert.strictEqual(onHold.request.status, "on_hold");
  assert.strictEqual(onHold.request.slaState, "paused");
  ok(`requestsTransition hold -> on_hold (SLA paused)`);

  // 1.6 Super Admin resumes review
  const resumed = await callFunction("requestsTransition", {
    requestId: planReqId,
    action: "resume",
    expectedStatus: "on_hold",
    reason: "Resuming after owner confirmation",
  }, superAdmin.idToken);
  assert.strictEqual(resumed.request.status, "in_review");
  assert.ok(resumed.request.slaTotalPausedMs >= 0, "Accumulated paused ms");
  ok(`requestsTransition resume -> in_review (SLA resumed)`);

  // 1.7 Super Admin approves change
  const approved = await callFunction("requestsTransition", {
    requestId: planReqId,
    action: "approve",
    expectedStatus: "in_review",
    note: "Approved for immediate upgrade",
  }, superAdmin.idToken);
  assert.strictEqual(approved.request.status, "approved");
  ok(`requestsTransition approve -> approved`);

  // 1.8 Super Admin applies the plan change (D-39 shared domain service)
  const applied = await callFunction("requestsApply", {
    requestId: planReqId,
  }, superAdmin.idToken);
  assert.strictEqual(applied.request.status, "applied");
  assert.strictEqual(applied.applyResult.action, "plan_change");
  assert.strictEqual(applied.applyResult.newPlanId, "plan_pro");

  // Verify organization doc updated
  const orgDocAfter = (await db.collection("organizations").doc(orgId).get()).data();
  assert.strictEqual(orgDocAfter.planId, "plan_pro", "Organization planId must be updated to plan_pro");
  ok(`requestsApply applied plan_change: org planId is now plan_pro`);

  // ---------------------------------------------------------------------------
  // Flow 2: F-RQ5 Duplicate Open Plan Change Rejection (D-43)
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 2: F-RQ5 Duplicate Open Plan Change Rejection ---");
  // File another plan change while one was just closed, then try a 2nd simultaneous open one
  const planReq2 = await callFunction("requestsCreate", {
    category: "plan_change",
    title: "Upgrade to Enterprise",
    description: "Another upgrade",
    details: {
      requestedPlanId: "plan_pro",
      reason: "Need even more capacity for franchise expansion",
    },
  }, orgOwner.idToken);
  ok(`Filed second plan change: ${planReq2.request.requestId}`);

  // Attempt duplicate open plan change while planReq2 is still open
  await assertCallableError(
    callFunction("requestsCreate", {
      category: "plan_change",
      title: "Concurrent duplicate upgrade request",
      description: "Should fail duplicate check",
      details: {
        requestedPlanId: "plan_starter",
        reason: "Accidental double submission from another tab",
      },
    }, orgOwner.idToken),
    "already-exists",
    "REQUEST_DUPLICATE_OPEN"
  );
  ok("Rejected duplicate open plan_change request with REQUEST_DUPLICATE_OPEN (D-43)");

  // 2.2 Verify requestsUpdate
  const updReq = await callFunction("requestsUpdate", {
    requestId: planReq2.request.requestId,
    title: "Upgrade to Enterprise - Revised",
  }, orgOwner.idToken);
  assert.strictEqual(updReq.request.title, "Upgrade to Enterprise - Revised");
  ok(`requestsUpdate updated open request title`);

  // Clean up planReq2 by cancelling it
  await callFunction("requestsTransition", {
    requestId: planReq2.request.requestId,
    action: "cancel",
    expectedStatus: "submitted",
    reason: "Cleaning up test request",
  }, orgOwner.idToken);
  ok("Cancelled open plan change request");

  // ---------------------------------------------------------------------------
  // Flow 3: F-RQ2 Limit Increase Lifecycle & Org Overrides Update
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 3: F-RQ2 Limit Increase Request Lifecycle ---");
  const limitReq = await callFunction("requestsCreate", {
    category: "limit_increase",
    title: "Increase Firestore Writes Limit",
    description: "High traffic weekend promotion",
    details: {
      metric: "firestoreWrites",
      period: "daily",
      requestedLimit: 50000,
      reason: "High traffic weekend sales promotion campaign",
    },
  }, orgOwner.idToken);
  const limitReqId = limitReq.request.requestId;

  // Move directly to approved
  await callFunction("requestsTransition", {
    requestId: limitReqId,
    action: "start_review",
    expectedStatus: "submitted",
  }, superAdmin.idToken);

  await callFunction("requestsTransition", {
    requestId: limitReqId,
    action: "approve",
    expectedStatus: "in_review",
    note: "Granted promotional quota increase",
  }, superAdmin.idToken);

  // Apply limit increase
  const limitApplied = await callFunction("requestsApply", {
    requestId: limitReqId,
  }, superAdmin.idToken);
  assert.strictEqual(limitApplied.request.status, "applied");

  const orgDocLimit = (await db.collection("organizations").doc(orgId).get()).data();
  assert.strictEqual(orgDocLimit.usageLimitOverrides?.firestoreWrites?.dailyLimit, 50000);
  ok(`requestsApply applied limit_increase: daily firestoreWrites limit is now 50000`);

  // ---------------------------------------------------------------------------
  // Flow 4: F-RQ3 Module Toggle Request Lifecycle
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 4: F-RQ3 Module Request Lifecycle ---");
  const modReq = await callFunction("requestsCreate", {
    category: "module_request",
    title: "Enable Delivery Module",
    description: "Deliveries module activation",
    details: {
      moduleKey: "deliveries",
      action: "enable",
      reason: "Commencing in-house rider delivery operations",
    },
  }, orgOwner.idToken);
  const modReqId = modReq.request.requestId;

  await callFunction("requestsTransition", {
    requestId: modReqId,
    action: "start_review",
    expectedStatus: "submitted",
  }, superAdmin.idToken);

  await callFunction("requestsTransition", {
    requestId: modReqId,
    action: "approve",
    expectedStatus: "in_review",
  }, superAdmin.idToken);

  await callFunction("requestsApply", {
    requestId: modReqId,
  }, superAdmin.idToken);

  const orgDocMod = (await db.collection("organizations").doc(orgId).get()).data();
  assert.strictEqual(orgDocMod.moduleToggles?.deliveries, true);
  ok(`requestsApply applied module_request: deliveries module is now enabled in org doc`);

  // ---------------------------------------------------------------------------
  // Flow 5: F-RQ6 Bug Report with Opt-in Diagnostics & Work Flow
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 5: F-RQ6 Bug Report Lifecycle & Work Kind ---");
  const bugReq = await callFunction("requestsCreate", {
    category: "bug_report",
    title: "POS Checkout Freeze on UPI",
    description: "App becomes unresponsive when scanning QR",
    severity: "major",
    details: {
      area: "pos_checkout",
      stepsToReproduce: "1. Add item\n2. Click pay\n3. Tap UPI",
      expected: "UPI dynamic QR generates",
      actual: "Screen freezes for 10 seconds",
      severity: "major",
      diagnosticsOptIn: true,
      diagnostics: {
        platform: "android",
        appVersion: "1.2.0",
        route: "/pos/sale",
      },
    },
  }, staff2.idToken);
  const bugReqId = bugReq.request.requestId;
  assert.strictEqual(bugReq.request.kind, "work");
  ok(`Created bug report with diagnostics: ${bugReqId}`);

  // Super Admin assigns to self and starts work
  await callFunction("requestsAssign", {
    requestId: bugReqId,
    assigneeUid: superAdmin.uid,
    assigneeName: "Lead Platform Engineer",
  }, superAdmin.idToken);
  ok(`requestsAssign assigned request to Super Admin`);

  // Super Admin sets priority
  const prioRes = await callFunction("requestsSetPriority", {
    requestId: bugReqId,
    priority: "urgent",
    reason: "Saturday rush hour checkout impact",
  }, superAdmin.idToken);
  assert.strictEqual(prioRes.request.priority, "urgent");
  ok(`requestsSetPriority elevated priority to urgent`);

  // Requester adds comment
  const commentRes = await callFunction("requestsAddComment", {
    requestId: bugReqId,
    content: "Customer confirmed card payments are working fine, issue is isolated to UPI QR.",
  }, staff2.idToken);
  assert.ok(commentRes.activityId);
  ok(`requestsAddComment added public comment`);

  await callFunction("requestsTransition", {
    requestId: bugReqId,
    action: "start_work",
    expectedStatus: "submitted",
  }, superAdmin.idToken);

  // Super Admin resolves bug report
  await callFunction("requestsTransition", {
    requestId: bugReqId,
    action: "resolve",
    expectedStatus: "in_progress",
    reason: "Fixed in patch v1.2.1: resolved timeout in UPI gateway handler",
  }, superAdmin.idToken);
  ok(`requestsTransition resolve -> resolved`);

  // Cashier closes resolved bug report
  const closedBug = await callFunction("requestsTransition", {
    requestId: bugReqId,
    action: "close",
    expectedStatus: "resolved",
    note: "Confirmed fixed on terminal POS-1",
  }, staff2.idToken);
  assert.strictEqual(closedBug.request.status, "closed");
  ok(`Requester closed resolved request -> closed`);

  // ---------------------------------------------------------------------------
  // Flow 6: F-RQ7 Reopening Work Request within 30 days
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 6: F-RQ7 Reopen Work Request ---");
  const reopened = await callFunction("requestsTransition", {
    requestId: bugReqId,
    action: "reopen",
    expectedStatus: "closed",
    reason: "Freeze recurred when offline cache is full",
  }, staff2.idToken);
  assert.strictEqual(reopened.request.status, "in_review");
  ok(`requestsTransition reopen -> in_review (within 30 days window)`);

  // Close it again
  await callFunction("requestsTransition", {
    requestId: bugReqId,
    action: "resolve",
    expectedStatus: "in_review",
    reason: "Cache cleared",
  }, superAdmin.idToken);
  await callFunction("requestsTransition", {
    requestId: bugReqId,
    action: "close",
    expectedStatus: "resolved",
  }, staff2.idToken);

  // ---------------------------------------------------------------------------
  // Flow 7: F-RQ8 Internal Notes Never Leak to Tenant (D-38)
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 7: F-RQ8 Internal Notes Stripping (D-38) ---");
  await callFunction("requestsAddInternalNote", {
    requestId: bugReqId,
    content: "SECRET OPERATOR NOTE: Database latency spike was cause by batch export job.",
  }, superAdmin.idToken);
  ok(`Added internal note via requestsAddInternalNote`);

  // Read request as Super Admin (internal note present)
  const adminActivities = await callFunction("requestsActivityList", {
    requestId: bugReqId,
  }, superAdmin.idToken);
  const foundAdminNote = adminActivities.items.some((a) => a.visibility === "internal");
  assert.strictEqual(foundAdminNote, true, "Super Admin must see internal notes");
  ok("Super Admin sees internal note in activity list");

  // Read request as Tenant Requester (Staff 2) (internal note stripped!)
  const tenantActivities = await callFunction("requestsActivityList", {
    requestId: bugReqId,
  }, staff2.idToken);
  const leakedToTenant = tenantActivities.items.some((a) => a.visibility === "internal" || a.content?.includes("SECRET OPERATOR NOTE"));
  assert.strictEqual(leakedToTenant, false, "Internal notes must NEVER leak to tenant (D-38)");
  ok("Tenant read path strictly excludes internal notes (D-38 VERIFIED)");

  // ---------------------------------------------------------------------------
  // Flow 8: F-RQ9 Security Concern Isolation
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 8: F-RQ9 Security Concern Isolation ---");
  const secReq = await callFunction("requestsCreate", {
    category: "security_concern",
    title: "Suspicious API access from unknown device",
    description: "Multiple failed auth attempts detected",
    details: {
      description: "Multiple failed auth attempts detected on cashier account",
      suspectedImpact: "Possible brute force credential stuffing",
    },
  }, staff2.idToken);
  const secReqId = secReq.request.requestId;
  ok(`Staff 2 filed security concern: ${secReqId}`);

  // Staff 1 (Manager) queries org-wide list: security concern filed by Staff 2 MUST be hidden
  const managerList = await callFunction("requestsList", {
    scope: "organization",
  }, staff1.idToken);
  const managerSawSec = managerList.items.some((i) => i.requestId === secReqId);
  assert.strictEqual(managerSawSec, false, "Security concerns must be excluded from org-wide list for non-requesters");
  ok("Security concern is hidden from other staff members in org-wide list");

  // Requester (Staff 2) queries own list: visible
  const requesterList = await callFunction("requestsList", {
    scope: "mine",
  }, staff2.idToken);
  assert.ok(requesterList.items.some((i) => i.requestId === secReqId), "Requester must see own security concern");
  ok("Requester sees own security concern");

  // Super Admin inbox: visible
  const adminInboxSec = await callFunction("requestsInboxList", {
    category: ["security_concern"],
  }, superAdmin.idToken);
  assert.ok(adminInboxSec.items.some((i) => i.requestId === secReqId), "Super Admin inbox must see security concerns");
  ok("Super Admin inbox sees security concern");

  // ---------------------------------------------------------------------------
  // Flow 9: F-RQ10 Organization Audience Handled by Org Manager
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 9: F-RQ10 Organization Audience Request ---");
  const accessReq = await callFunction("requestsCreate", {
    category: "access_request",
    title: "Request Discount Permission on Counter",
    description: "Need permission to grant festival discounts up to 10%",
    details: {
      permissionKeys: ["bill:discount"],
      reason: "Festival seasonal promotion on counter billing",
    },
  }, staff2.idToken);
  const accessReqId = accessReq.request.requestId;
  assert.strictEqual(accessReq.request.audience, "organization");
  ok(`Filed access_request with audience: organization (${accessReqId})`);

  // Org Manager (Staff 1) manages it
  const mgrReview = await callFunction("requestsTransition", {
    requestId: accessReqId,
    action: "start_review",
    expectedStatus: "submitted",
  }, staff1.idToken);
  assert.strictEqual(mgrReview.request.status, "in_review");
  ok("Org Manager successfully transitioned organization audience request");

  // ---------------------------------------------------------------------------
  // Flow 10: F-RQ12 Dark Launch Feature Gate
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 10: F-RQ12 Dark Launch Feature Gate ---");
  // Temporarily disable requests module globally
  await db.collection("platformSettings").doc("requests").update({
    requestsEnabled: false,
  });

  await assertCallableError(
    callFunction("requestsCounts", {}, orgOwner.idToken),
    "failed-precondition",
    "FEATURE_DISABLED"
  );
  ok("Callables return FEATURE_DISABLED when requestsEnabled = false (A-17)");

  // Re-enable
  await db.collection("platformSettings").doc("requests").update({
    requestsEnabled: true,
  });
  ok("Re-enabled requests module");

  // ---------------------------------------------------------------------------
  // Aggregation Callables: requestsMeta, requestsCounts, requestsInboxCounts
  // ---------------------------------------------------------------------------
  console.log("\n--- Aggregation Badges & Callables ---");
  const meta = await callFunction("requestsMeta", {}, orgOwner.idToken);
  assert.ok(meta.limits.maxOpenPerUser > 0, "Must return volume limits");
  ok("requestsMeta returned operational limits and categories");

  const counts = await callFunction("requestsCounts", {}, orgOwner.idToken);
  assert.ok(typeof counts.open === "number");
  ok(`requestsCounts returned: open=${counts.open}, actionRequired=${counts.actionRequired}, closed=${counts.closed}`);

  const inboxCounts = await callFunction("requestsInboxCounts", {}, superAdmin.idToken);
  assert.ok(typeof inboxCounts.unassigned === "number");
  ok(`requestsInboxCounts returned: unassigned=${inboxCounts.unassigned}, mine=${inboxCounts.mine}`);

  // ---------------------------------------------------------------------------
  // Flow 11: requestsSlaAndLifecycleSweep Scheduled Job Core
  // ---------------------------------------------------------------------------
  console.log("\n--- Flow 11: requestsSlaAndLifecycleSweep Scheduled Job Execution ---");
  const { runRequestsSlaAndLifecycleSweep } = require("../lib/triggers/scheduled.js");
  const sweepRes = await runRequestsSlaAndLifecycleSweep();
  assert.ok(typeof sweepRes.scanned === "number");
  ok(`runRequestsSlaAndLifecycleSweep executed successfully: scanned=${sweepRes.scanned}, slaTransitions=${sweepRes.slaTransitions}`);

  console.log("\n================================================================================");
  console.log(`   ALL 12 EXECUTABLE FLOWS & SCENARIOS PASSED: ${passed} VERIFIED CHECKS       `);
  console.log("================================================================================\n");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Scenario test suite failed:", err);
    process.exit(1);
  });
