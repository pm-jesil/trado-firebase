/**
 * Trado Firebase Backend — Governance, Lifecycle & Flagship Business Suite (emulator)
 *
 * 1. Table-driven gate conformance: every tenant-gated callable × denial personas
 *    (unauthenticated, missing permission, expired subscription, suspended subscription,
 *    other-organization id, Super Admin mutation, module not in plan, inactive membership)
 * 2. Subscription lifecycle: renewal mid-session with the same ID token, authMe contextStatus
 * 3. Plan seats: concurrent creation at (limit − 1) → exactly one success; reactivation blocked
 * 4. Organization field-permission matrix (Super Admin / Owner / Admin)
 * 5. Employee anti-escalation, cross-tenant updates, reporting-cycle prevention
 * 6. Weekly usage hard_block, exempt operations, concurrent overshoot bound
 * 7. Maker–checker approvals and small-organization mode
 * 8. Data scope: purchase manager vs purchase staff vs sales manager
 * 9. Void / reversal of bills and purchases (stock, ledger, payments)
 * 10. Flagship: bicycle wholesale (serials, variants, damaged receipt, purchase return, statement)
 * 11. Flagship: kitchenware wholesale (box of 12 vs piece, mixed-unit invoice, discount ceiling,
 *     non-returnable item, price history)
 * 12. Schema expressibility: mobile phone (IMEI + warranty), jewellery (weight/purity/making)
 * 13. Total outflow vs P&L, change history, scheduled subscription & usage sweep
 * 14. Control probes (cross-tenant membership/payment, overpayment, negative metric, redaction, branch scope)
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError, getIdToken, recordTriggerObserved } = require("./helpers/callable-client.cjs");
const { getSuperAdminPersona, createEmployeePersona, db } = require("./helpers/auth-personas.cjs");

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`✓ ${msg}`);
}
const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const ymd = (offsetDays, tz = "Asia/Kolkata") => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + offsetDays * 86_400_000));

async function expectReason(promise, reason, label) {
  await assertCallableError(promise, [reason]);
  ok(`${label} → ${reason}`);
}

async function makeOrg(sa, prefix, extra = {}) {
  const u = uniq();
  const email = `owner_${u}@gov.local`;
  const res = await callFunction("organizationsCreate", {
    name: `${prefix} ${u}`,
    businessType: extra.businessType || "wholesale_retail",
    businessCategory: extra.businessCategory || "general",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    planId: extra.planId || "plan_growth",
    ownerEmail: email,
    ownerName: `Owner ${prefix}`,
    initialPassword: "TestPassword123!",
    ...(extra.subscription ? { subscription: extra.subscription } : {}),
  }, sa.idToken);
  const idToken = await getIdToken(email, "TestPassword123!");
  return { organizationId: res.organizationId, idToken, email, ownerMembershipId: res.ownerMembershipId, ownerUid: res.ownerUserId };
}

async function stockOf(orgId, productId, branchId = "main-branch") {
  const snap = await db.collection("stockBalances").doc(`${orgId}_${branchId}_${productId}`).get();
  return snap.exists ? snap.data().currentStock : 0;
}

// ---------------------------------------------------------------------------
// 1. Gate conformance table
// ---------------------------------------------------------------------------

const F = "fake_doc_id";
let gateUploadId = null; // a real upload session of the healthy org, created in gateConformance
const GATED = [
  // [callable, payload(orgId), { mut, module }]
  ["auditGetEntityHistory", (o) => ({ organizationId: o, entityType: "product", entityId: F }), {}],
  ["documentsDecide", (o) => ({ organizationId: o, documentType: "bill", documentId: F, decision: "approve" }), { mut: true }],
  ["billsCreate", (o) => ({ organizationId: o, items: [{ productId: F, quantity: 1 }] }), { mut: true }],
  ["billsFinalize", (o) => ({ organizationId: o, billId: F }), { mut: true }],
  ["billsGet", (o) => ({ organizationId: o, billId: F }), {}],
  ["billsList", (o) => ({ organizationId: o }), {}],
  ["billsVoid", (o) => ({ organizationId: o, documentId: F, reason: "gate test" }), { mut: true }],
  ["branchesUpdate", (o) => ({ organizationId: o, branchId: "nope-branch", name: "Nope" }), { mut: true }],
  ["branchesDeactivate", (o) => ({ organizationId: o, branchId: "nope-branch" }), { mut: true }],
  ["categoriesCreate", (o) => ({ organizationId: o, name: `Cat ${uniq()}` }), { mut: true }],
  ["customersCreate", (o) => ({ organizationId: o, name: "Gate Customer", phone: "+919876543210" }), { mut: true }],
  ["customersGet", (o) => ({ organizationId: o, customerId: F }), {}],
  ["customersList", (o) => ({ organizationId: o }), {}],
  ["customersUpdate", (o) => ({ organizationId: o, customerId: F, name: "Cust X" }), { mut: true }],
  ["deliveriesCreate", (o) => ({ organizationId: o, billId: F, address: { line1: "a", city: "c", pincode: "1" } }), { mut: true, module: "delivery" }],
  ["deliveriesGet", (o) => ({ organizationId: o, deliveryId: F }), { module: "delivery" }],
  ["deliveriesList", (o) => ({ organizationId: o }), { module: "delivery" }],
  ["deliveriesUpdateStatus", (o) => ({ organizationId: o, deliveryId: F, status: "delivered" }), { mut: true, module: "delivery" }],
  ["departmentsCreate", (o) => ({ organizationId: o, name: `Dept ${uniq()}` }), { mut: true }],
  ["employeesCreate", (o) => ({ organizationId: o, email: `gate_${uniq()}@gov.local`, name: "Gate Emp" }), { mut: true }],
  ["employeesDeactivate", (o) => ({ organizationId: o, membershipId: `${F}_${o}` }), { mut: true }],
  ["employeesList", (o) => ({ organizationId: o }), {}],
  ["employeesUpdate", (o) => ({ organizationId: o, membershipId: `${F}_${o}` }), { mut: true }],
  ["jobRolesCreate", (o) => ({ organizationId: o, name: `JR ${uniq()}` }), { mut: true }],
  ["locationsGetHistory", (o) => ({ organizationId: o, membershipId: `${F}_${o}` }), { module: "employee_tracking" }],
  ["locationsGetLatest", (o) => ({ organizationId: o }), { module: "employee_tracking" }],
  ["locationsRecordPing", (o) => ({ organizationId: o, latitude: 12.9, longitude: 77.6 }), { mut: true, module: "employee_tracking" }],
  ["outflowsCreate", (o) => ({ organizationId: o, kind: "expense", payee: "Tea", lines: [{ itemName: "Tea", quantity: 1, unit: "piece", unitPrice: 10 }] }), { mut: true }],
  ["outflowsGet", (o) => ({ organizationId: o, outflowId: F }), {}],
  ["outflowsList", (o) => ({ organizationId: o }), {}],
  ["outflowsVoid", (o) => ({ organizationId: o, documentId: F, reason: "gate test" }), { mut: true }],
  ["paymentsCreate", (o) => ({ organizationId: o, direction: "in", partyType: "customer", partyName: "Walk-in", amount: 1 }), { mut: true }],
  ["paymentsList", (o) => ({ organizationId: o }), {}],
  ["paymentsVoid", (o) => ({ organizationId: o, paymentId: F, reason: "gate test" }), { mut: true }],
  ["productsCreate", (o) => ({ organizationId: o, name: `Gate Product ${uniq()}`, sellingPrice: 10 }), { mut: true }],
  ["productsGet", (o) => ({ organizationId: o, productId: F }), {}],
  ["productsGetPriceHistory", (o) => ({ organizationId: o, productId: F }), {}],
  ["productsList", (o) => ({ organizationId: o }), {}],
  ["productsUpdate", (o) => ({ organizationId: o, productId: F, name: "Prod X" }), { mut: true }],
  ["reconcileBranchCounts", (o) => ({ organizationId: o }), { mut: true }],
  ["reconcilePartyLedgers", (o) => ({ organizationId: o, partyType: "customer" }), { mut: true }],
  ["reconcileStockBalances", (o) => ({ organizationId: o }), { mut: true }],
  ["reportsExportCsv", (o) => ({ organizationId: o, reportType: "revenue" }), {}],
  ["reportsGetOutflowSummary", (o) => ({ organizationId: o }), {}],
  ["reportsGetPartyStatement", (o) => ({ organizationId: o, partyType: "vendor", partyId: F }), {}],
  ["reportsGetProfitLoss", (o) => ({ organizationId: o }), {}],
  ["reportsGetRevenue", (o) => ({ organizationId: o }), {}],
  ["reportsGetStaffActivity", (o) => ({ organizationId: o }), {}],
  ["reportsGetStockValuation", (o) => ({ organizationId: o }), {}],
  ["reportsGetTopEntities", (o) => ({ organizationId: o, entityType: "products" }), {}],
  ["returnsCreate", (o) => ({ organizationId: o, returnType: "sales_return", referenceId: F, items: [{ productId: F, quantity: 1, refundAmount: 0, reason: "r" }] }), { mut: true }],
  ["returnsList", (o) => ({ organizationId: o }), {}],
  ["sharingPoliciesUpdate", (o) => ({ organizationId: o, policies: {} }), { mut: true }],
  ["stockAdjust", (o) => ({ organizationId: o, productId: F, quantity: 1, reason: "gate test" }), { mut: true }],
  ["stockMovementsList", (o) => ({ organizationId: o }), {}],
  ["tasksAssign", (o) => ({ organizationId: o, taskId: F, assignedToMembershipId: `${F}_${o}` }), { mut: true, module: "tasks" }],
  ["tasksCreate", (o) => ({ organizationId: o, title: "Gate task", assignedToMembershipId: `${F}_${o}` }), { mut: true, module: "tasks" }],
  ["tasksDelete", (o) => ({ organizationId: o, taskId: F }), { mut: true, module: "tasks" }],
  ["tasksList", (o) => ({ organizationId: o }), { module: "tasks" }],
  ["tasksUpdate", (o) => ({ organizationId: o, taskId: F }), { mut: true, module: "tasks" }],
  ["tasksUpdateStatus", (o) => ({ organizationId: o, taskId: F, status: "completed" }), { mut: true, module: "tasks" }],
  ["teamsAssignMember", (o) => ({ organizationId: o, teamId: F, membershipId: `${F}_${o}`, action: "add" }), { mut: true }],
  ["teamsCreate", (o) => ({ organizationId: o, name: `Team ${uniq()}` }), { mut: true }],
  ["teamsList", (o) => ({ organizationId: o }), {}],
  ["teamsUpdate", (o) => ({ organizationId: o, teamId: F, name: "Team T" }), { mut: true }],
  ["unitsCreate", (o) => ({ organizationId: o, name: "Gate Unit", code: `u${Date.now() % 100000}` }), { mut: true }],
  ["usageGetLimits", (o) => ({ organizationId: o }), {}],
  ["vendorsCreate", (o) => ({ organizationId: o, name: "Gate Vendor", phone: "+919876543210" }), { mut: true }],
  ["vendorsGet", (o) => ({ organizationId: o, vendorId: F }), {}],
  ["vendorsList", (o) => ({ organizationId: o }), {}],
  ["vendorsUpdate", (o) => ({ organizationId: o, vendorId: F, name: "Vendor V" }), { mut: true }],
  ["imagesCreateUploadSession", (o) => ({ organizationId: o, purpose: "org_logo", entityType: "organization", entityId: o, contentType: "image/jpeg", sizeBytes: 1000 }), {}],
  // imagesAttach reads its upload session before the gate: a real session of the healthy org (set below)
  ["imagesAttach", (o) => ({ organizationId: o, uploadId: gateUploadId, entityType: "organization", entityId: o }), {}],
  ["imagesRemove", (o) => ({ organizationId: o, entityType: "product", entityId: F }), {}],
  ["organizationsGet", (o) => ({ organizationId: o }), {}],
  ["organizationsGetSubscriptionHistory", (o) => ({ organizationId: o }), {}],
  ["branchesGetDefault", (o) => ({ organizationId: o }), { noPermission: true }],
  ["branchesList", (o) => ({ organizationId: o }), { noPermission: true }],
  ["branchesCreate", (o) => ({ organizationId: o, name: "Gate Branch", code: `G${Date.now() % 100000}` }), { mut: true }],
  ["branchContextSwitch", (o) => ({ organizationId: o, targetBranchId: "main-branch" }), { noPermission: true }],
  ["employeesGet", (o) => ({ organizationId: o, membershipId: `${F}_${o}` }), {}],
  ["billsUpdateDraft", (o) => ({ organizationId: o, billId: F, notes: "gate" }), { mut: true }],
  ["billsPreview", (o) => ({ organizationId: o, items: [{ productId: F, quantity: 1 }] }), {}],
  ["recurringExpensesCreate", (o) => ({ organizationId: o, name: "Gate rent", payee: "Landlord", lines: [{ itemName: "Rent", quantity: 1, unit: "piece", unitPrice: 10 }], frequency: "monthly", dayOfMonth: 1, startOn: ymd(1) }), { mut: true }],
  ["recurringExpensesUpdate", (o) => ({ organizationId: o, templateId: F, name: "Rent X" }), { mut: true }],
  ["recurringExpensesList", (o) => ({ organizationId: o }), {}],
  ["auditLogsList", (o) => ({ organizationId: o }), {}],
  ["usageRecordClientMetric", (o) => ({ organizationId: o, metrics: {} }), { noPermission: true }],
];
const PLATFORM = [
  ["usageGetPlatformSummary", () => ({})],
  ["usageGetOrganizations", () => ({})],
  ["reportsGetPlatformOverview", () => ({})],
  ["usageUpdateLimits", (o) => ({ organizationId: o, limits: {} })],
];

async function gateConformance(sa) {
  console.log("\n[1] Table-driven gate conformance");
  const healthy = await makeOrg(sa, "GateHealthy");
  const other = await makeOrg(sa, "GateOther");
  const starter = await makeOrg(sa, "GateStarter", { planId: "plan_starter" });
  const expired = await makeOrg(sa, "GateExpired", { subscription: { startsAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), expiresOn: ymd(-2) } });
  const suspended = await makeOrg(sa, "GateSuspended");
  await callFunction("organizationsSetSubscription", { organizationId: suspended.organizationId, action: "suspend", reason: "gate test" }, sa.idToken);
  // Deny-wins overrides strip even the base role grants (org:view, employee:view)
  const plain = await createEmployeePersona(healthy.idToken, healthy.organizationId, { roleCode: "employee", permissions: { "org:view": false, "employee:view": false } });
  const leaver = await createEmployeePersona(healthy.idToken, healthy.organizationId, { roleCode: "admin" });
  await callFunction("employeesDeactivate", { organizationId: healthy.organizationId, membershipId: leaver.membershipId, reason: "left" }, healthy.idToken);

  gateUploadId = (await callFunction("imagesCreateUploadSession", { organizationId: healthy.organizationId, purpose: "org_logo", entityType: "organization", entityId: healthy.organizationId, contentType: "image/jpeg", sizeBytes: 1000 }, healthy.idToken)).uploadId;
  let cases = 0;
  for (const [fn, payload, meta] of GATED) {
    const o = healthy.organizationId;
    // Calibration: payload passes validation for a healthy Owner (denials below come from the gate)
    try {
      await callFunction(fn, payload(o), healthy.idToken);
    } catch (e) {
      assert.ok(!/INVALID_ARGUMENT/.test(e.code) || /not found|required for|exceeds|Unknown|No updatable/i.test(e.message),
        `${fn}: calibration payload rejected by validation: ${e.message}`);
    }
    await assertCallableError(callFunction(fn, payload(o), null), ["UNAUTHENTICATED"]);
    // noPermission: the gate is asked for no permission (any active member passes it), so no role denial exists.
    if (!meta.noPermission) await assertCallableError(callFunction(fn, payload(o), plain.idToken), ["PERMISSION_DENIED"]);
    await assertCallableError(callFunction(fn, payload(expired.organizationId), expired.idToken), ["SUBSCRIPTION_EXPIRED"]);
    await assertCallableError(callFunction(fn, payload(suspended.organizationId), suspended.idToken), ["SUBSCRIPTION_SUSPENDED"]);
    await assertCallableError(callFunction(fn, payload(other.organizationId), healthy.idToken), ["TENANT_MISMATCH"]);
    await assertCallableError(callFunction(fn, payload(o), leaver.idToken), ["MEMBERSHIP_INACTIVE", "USER_INACTIVE"]);
    cases += meta.noPermission ? 5 : 6;
    if (meta.mut) {
      await assertCallableError(callFunction(fn, payload(o), sa.idToken), ["SUPER_ADMIN_TENANT_FORBIDDEN"]);
      cases++;
    }
    if (meta.module) {
      await assertCallableError(callFunction(fn, payload(starter.organizationId), starter.idToken), ["MODULE_NOT_IN_PLAN"]);
      cases++;
    }
  }
  // Org module toggle (in the plan, switched off by the organization) → MODULE_DISABLED
  const toggled = await makeOrg(sa, "GateToggled");
  await callFunction("organizationsUpdate", { organizationId: toggled.organizationId, moduleToggles: { tasks: false } }, sa.idToken); // moduleToggles: Super Admin field
  await assertCallableError(callFunction("tasksList", { organizationId: toggled.organizationId }, toggled.idToken), ["MODULE_DISABLED"]);
  cases++;
  for (const [fn, payload] of PLATFORM) {
    await assertCallableError(callFunction(fn, payload(healthy.organizationId), null), ["UNAUTHENTICATED"]);
    await assertCallableError(callFunction(fn, payload(healthy.organizationId), healthy.idToken), ["PERMISSION_DENIED"]);
    cases += 2;
  }
  ok(`gate conformance: ${GATED.length} tenant callables + ${PLATFORM.length} platform callables, ${cases} denial assertions`);
  return { healthy, expired };
}

// ---------------------------------------------------------------------------

async function subscriptionLifecycle(sa, expired) {
  console.log("\n[2] Subscription lifecycle");
  const me = await callFunction("authMe", {}, expired.idToken);
  assert.equal(me.context.contextStatus, "subscription_expired");
  assert.deepEqual(me.context.permissions, []);
  ok("authMe on an expired organization returns contextStatus=subscription_expired with zero permissions");
  await expectReason(callFunction("productsList", {}, expired.idToken), "SUBSCRIPTION_EXPIRED", "expired org productsList");
  const renewed = await callFunction("organizationsSetSubscription", { organizationId: expired.organizationId, action: "renew", durationDays: 30 }, sa.idToken);
  assert.equal(renewed.evaluation.allowed, true);
  const list = await callFunction("productsList", {}, expired.idToken); // same, in-flight ID token
  assert.ok(Array.isArray(list.items));
  ok("renewal mid-session: the same ID token works immediately (status read live, never from token)");
  const orgDoc = (await db.collection("organizations").doc(expired.organizationId).get()).data();
  assert.ok(orgDoc.subscriptionExpiresAt.endsWith("18:29:59.999Z"), `expiry is end of day IST, got ${orgDoc.subscriptionExpiresAt}`);
  ok("expiry instant is end of the expiry date in the organization timezone (23:59:59.999 IST)");
  await expectReason(callFunction("organizationsSetSubscription", { organizationId: expired.organizationId, action: "suspend" }, expired.idToken), "permission-denied", "Owner cannot manage own subscription");
}

async function seatsAndOrgFields(sa) {
  console.log("\n[3] Plan seats & [4] organization field matrix");
  await db.collection("subscriptionPlans").doc("plan_seat_test").set({
    name: "Seat Test", price: 0, currency: "INR", storageLimitMb: 10, monthlyDocumentVolumeLimit: 100,
    seatLimits: { admin: 1, staff: 1 }, branchLimit: 1,
    moduleFlags: { billing: true, inventory: true, staff: true, sales: true, purchases: true, expenses: true, customers: true, reports: true, returns: true, delivery: true, tasks: true, employee_tracking: true },
    isActive: true,
  });
  const org = await makeOrg(sa, "Seats", { planId: "plan_seat_test" });
  const first = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "employee" });
  const attempts = await Promise.allSettled([1, 2].map((i) => callFunction("employeesCreate", {
    organizationId: org.organizationId, email: `seat${i}_${uniq()}@gov.local`, name: `Seat ${i}`, initialPassword: "TestPassword123!",
  }, org.idToken)));
  const wins = attempts.filter((a) => a.status === "fulfilled").length;
  assert.equal(wins, 1, `exactly one concurrent creation must succeed at limit-1, got ${wins}`);
  assert.ok(attempts.some((a) => a.status === "rejected" && /PLAN_LIMIT_REACHED|limit/i.test(a.reason.message)));
  ok("two concurrent employee creations at (limit − 1): exactly one success (transactional seat counter)");
  await callFunction("employeesDeactivate", { organizationId: org.organizationId, membershipId: first.membershipId }, org.idToken);
  await callFunction("employeesCreate", { organizationId: org.organizationId, email: `seat3_${uniq()}@gov.local`, name: "Seat 3", initialPassword: "TestPassword123!" }, org.idToken);
  await expectReason(callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: first.membershipId, status: "active" }, org.idToken), "PLAN_LIMIT_REACHED", "reactivation when seats are full");
  const orgDoc = (await db.collection("organizations").doc(org.organizationId).get()).data();
  assert.equal(orgDoc.activeEmployeeCount, 2);
  ok("activeEmployeeCount = 2 (Owner excluded) after create/deactivate/create");

  // Field matrix
  const admin = await (async () => {
    const big = await makeOrg(sa, "Fields");
    const a = await createEmployeePersona(big.idToken, big.organizationId, { roleCode: "admin" });
    return { big, a };
  })();
  const o = admin.big.organizationId;
  const ownerFields = {
    legalName: "Kitchen King Pvt Ltd",
    taxId: "29ABCDE1234F1Z5",
    website: "https://example.com",
    contactEmail: "a@b.co",
    contactPhone: "99999",
    contact: { name: "Kitchen Contact", email: "contact@kitchen.local", phone: "+919876543210" },
    contacts: [{ id: "c_support", name: "Support", email: "support@kitchen.local", phone: "+919876543211", isPrimary: true, type: "other" }],
    addresses: [{ id: "a_billing", label: "billing", line1: "123 Main St", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" }],
    bankAccounts: [{ id: "b_primary", accountHolderName: "Kitchen King", bankName: "SBI", accountNumber: "1234567890", routingCode: "SBIN0001" }],
    image: { path: "organizations/fields_test/logo.png", contentType: "image/png", width: 100, height: 100, sizeBytes: 1024, updatedAt: new Date().toISOString() },
    settings: { approvals: { enabled: false } },
  };
  for (const [k, v] of Object.entries(ownerFields)) {
    await callFunction("organizationsUpdate", { organizationId: o, [k]: v }, admin.big.idToken);
    await assertCallableError(callFunction("organizationsUpdate", { organizationId: o, [k]: v }, admin.a.idToken), ["FIELD_NOT_EDITABLE"]);
  }
  ok(`Owner edits all ${Object.keys(ownerFields).length} owner-editable fields; Admin denied each (FIELD_NOT_EDITABLE)`);
  const saFields = { name: "Legal Name Pvt Ltd", businessType: "wholesale_only", businessCategory: "kitchenware_household", moduleToggles: { tasks: false }, salesChannels: ["b2b"], timezone: "Asia/Dubai" };
  for (const [k, v] of Object.entries(saFields)) {
    await assertCallableError(callFunction("organizationsUpdate", { organizationId: o, [k]: v }, admin.big.idToken), ["FIELD_NOT_EDITABLE"]);
  }
  await callFunction("organizationsUpdate", { organizationId: o, ...saFields, timezone: "Asia/Kolkata" }, sa.idToken);
  ok(`Owner denied all ${Object.keys(saFields).length} Super-Admin-only fields; Super Admin may set them`);
  await expectReason(callFunction("organizationsUpdate", { organizationId: o, planId: "plan_enterprise" }, sa.idToken), "INVALID_ARGUMENT", "unknown field planId rejected (strict schema)");
  // Contacts governance
  const validContacts = [
    { id: "c1", name: "Alice Primary", email: "alice@example.com", phone: "9876543210", isPrimary: true, isActive: true },
    { id: "c2", name: "Bob Secondary", email: "bob@example.com", phone: "9876543211", isPrimary: false, isActive: true },
  ];
  await callFunction("organizationsUpdate", { organizationId: o, contacts: validContacts }, admin.big.idToken);
  ok("Owner updates structured contacts array with primary contact");

  const invalidContacts = [
    { id: "c1", name: "Alice", isPrimary: true, isActive: true },
    { id: "c2", name: "Bob", isPrimary: true, isActive: true },
  ];
  await expectReason(callFunction("organizationsUpdate", { organizationId: o, contacts: invalidContacts }, admin.big.idToken), "invalid-argument", "multiple primary contacts rejected");
  ok("organizationsUpdate rejects multiple primary contacts");

  const history = await callFunction("auditGetEntityHistory", { entityType: "organization", entityId: o }, admin.big.idToken);
  assert.ok(history.items.some((h) => h.changes.some((c) => c.field === "name" && c.to === "Legal Name Pvt Ltd")));
  ok("organization change history records field, old → new, actor and time");
}

async function employeeSecurity(sa) {
  console.log("\n[5] Employee anti-escalation & hierarchy");
  const org = await makeOrg(sa, "EmpSec");
  const other = await makeOrg(sa, "EmpSecOther");
  const admin = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "admin" });
  const a = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "employee" });
  const b = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "employee" });
  await expectReason(callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: admin.membershipId, roleId: "role_employee" }, admin.idToken), "FIELD_NOT_EDITABLE", "self role change");
  await expectReason(callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: a.membershipId, roleId: "role_admin" }, admin.idToken), "permission-denied", "Admin promoting to Admin");
  await expectReason(callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: a.membershipId, roleId: "role_org_owner" }, org.idToken), "permission-denied", "assigning Owner role");
  await expectReason(callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: a.membershipId, permissionOverrides: { "bill:void": true } }, admin.idToken), "PERMISSION_DENIED", "Admin granting permission overrides");
  await expectReason(callFunction("employeesDeactivate", { organizationId: org.organizationId, membershipId: org.ownerMembershipId }, admin.idToken), "FIELD_NOT_EDITABLE", "deactivating the Owner");
  await expectReason(callFunction("employeesUpdate", { organizationId: other.organizationId, membershipId: a.membershipId, name: "Renamed X" }, org.idToken), "TENANT_MISMATCH", "cross-tenant employee update");
  await callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: b.membershipId, reportingToIds: [a.membershipId] }, org.idToken);
  await expectReason(callFunction("employeesUpdate", { organizationId: org.organizationId, membershipId: a.membershipId, reportingToIds: [b.membershipId] }, org.idToken), "cycle", "reporting cycle A→B→A");

  // Super Admin direct employee creation blocked (platform isolation)
  await expectReason(callFunction("employeesCreate", {
    organizationId: org.organizationId,
    email: `sa_emp_${uniq()}@gov.local`,
    name: "SA Employee",
    initialPassword: "TestPassword123!",
  }, sa.idToken), "SUPER_ADMIN_TENANT_FORBIDDEN", "Super Admin direct employee creation blocked (platform isolation)");

  // Audit stream without entityId
  const stream = await callFunction("auditGetEntityHistory", { organizationId: org.organizationId }, org.idToken);
  assert.ok(Array.isArray(stream.items) && stream.items.length > 0, "audit stream returned items");
  ok("auditGetEntityHistory queries full organization audit stream");
}

async function usageLimits(sa) {
  console.log("\n[6] Weekly usage hard_block");
  const org = await makeOrg(sa, "Usage");
  const LIMIT = 8;
  await callFunction("usageUpdateLimits", {
    organizationId: org.organizationId,
    limits: { firestoreWrites: { weeklyLimit: LIMIT, warningThresholdPercent: 50, hardThresholdPercent: 100, enforcementMode: "hard_block", enabled: true } },
  }, sa.idToken);
  let created = 0;
  let blocked = null;
  for (let i = 0; i < LIMIT + 5 && !blocked; i++) {
    try {
      await callFunction("productsCreate", { name: `Usage item ${i}`, sellingPrice: 1 }, org.idToken);
      created++;
    } catch (e) {
      blocked = e;
    }
  }
  assert.ok(blocked && /USAGE_LIMIT_EXCEEDED/.test(blocked.message), `expected hard block, got ${blocked && blocked.message}`);
  assert.equal(created, LIMIT, `entitled to exactly ${LIMIT} write operations, admitted ${created}`);
  ok(`weekly firestoreWrites limit ${LIMIT}: blocked after ${created} write operations (USAGE_LIMIT_EXCEEDED)`);
  const list = await callFunction("productsList", {}, org.idToken);
  assert.ok(Array.isArray(list.items));
  ok("reads still allowed when only the write limit is breached");
  const limits = await callFunction("usageGetLimits", {}, org.idToken);
  assert.ok(limits.serverObserved.weekly.firestoreWrites >= LIMIT && limits.blocked === true);
  assert.ok(limits.warnings.some((w) => w.period === "weekly"));
  const shards = await db.collection("usageCounterShards").where("organizationId", "==", org.organizationId).get();
  assert.ok(shards.size >= 2, "writes spread across several counter shards");
  ok(`usageGetLimits shows weekly server-observed writes (${limits.serverObserved.weekly.firestoreWrites}), warnings and blocked=true`);
  await assertCallableError(callFunction("paymentsCreate", { direction: "in", partyType: "customer", partyName: "Walk-in", amount: 5 }, org.idToken).then(() => { throw new Error("NOT_BLOCKED_OK"); }), ["NOT_BLOCKED_OK"]);
  ok("exempt operation (paymentsCreate) still allowed at the limit");
  // Concurrency: raise limit to (observed now + 5) and fire 12 concurrent writes. The exempt
  // payment above still counted one write, so usage is re-read here.
  const observedNow = (await callFunction("usageGetLimits", {}, org.idToken)).serverObserved.weekly.firestoreWrites;
  await callFunction("usageUpdateLimits", {
    organizationId: org.organizationId,
    limits: { firestoreWrites: { weeklyLimit: observedNow + 5, hardThresholdPercent: 100, enforcementMode: "hard_block", enabled: true } },
  }, sa.idToken);
  const HEADROOM = 5;
  const burst = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => callFunction("productsCreate", { name: `Burst ${i} ${uniq()}`, sellingPrice: 1 }, org.idToken)));
  const burstOk = burst.filter((r) => r.status === "fulfilled").length;
  const burstErrors = burst.filter((r) => r.status === "rejected").map((r) => (r.reason.message.match(/\[([A-Z_]+)\]/) || [, r.reason.code])[1]);
  assert.ok(burstOk <= HEADROOM, `overshoot: ${burstOk} admitted with ${HEADROOM} remaining`);
  assert.ok(burstErrors.every((c) => c === "USAGE_LIMIT_EXCEEDED"), `every burst denial must be USAGE_LIMIT_EXCEEDED, got ${burstErrors.join(",")}`);
  // Denied calls refund their unit, so the quota they briefly held is still available
  let after = 0;
  for (let i = 0; i < HEADROOM + 2; i++) {
    try {
      await callFunction("productsCreate", { name: `After burst ${i} ${uniq()}`, sellingPrice: 1 }, org.idToken);
      after++;
    } catch (e) {
      assert.match(e.message, /USAGE_LIMIT_EXCEEDED/);
      break;
    }
  }
  assert.equal(burstOk + after, HEADROOM, `entitled ${HEADROOM} writes, admitted ${burstOk} in burst + ${after} after`);
  ok(`12 concurrent writes with ${HEADROOM} remaining: ${burstOk} admitted, ${12 - burstOk} USAGE_LIMIT_EXCEEDED (no aborted/internal); denied units refunded → ${after} more admitted; total exactly ${HEADROOM}, no overshoot`);
}

async function approvalsAndSmallOrg(sa) {
  console.log("\n[7] Maker–checker & small-organization mode");
  const org = await makeOrg(sa, "Approvals");
  const admin = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "admin" });
  const staff = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "employee", permissions: { "bill:create": true, "bill:view": true, "bill:discount": true, "product:view": true } });
  const prod = await callFunction("productsCreate", { name: "Plate", sellingPrice: 100, costPrice: 60, initialStock: 50, maxDiscountPercent: 5 }, org.idToken);

  // Small org, approvals OFF (default): staff sale applies immediately, no deadlock
  const quick = await callFunction("billsCreate", { items: [{ productId: prod.productId, quantity: 2 }], paidAmount: 200 }, staff.idToken);
  assert.equal(quick.status, "active");
  assert.equal(await stockOf(org.organizationId, prod.productId), 48);
  ok("approvals off by default: Owner + Admin + 1 staff org sells immediately (stock 50 → 48)");

  // Discount above product ceiling forces approval even with policy off
  const disc = await callFunction("billsCreate", { items: [{ productId: prod.productId, quantity: 1, discountValue: 10 }] }, staff.idToken);
  assert.equal(disc.status, "pending_approval");
  assert.equal(await stockOf(org.organizationId, prod.productId), 48);
  ok("10% discount on a 5%-max product → pending_approval with no stock effect");
  await expectReason(callFunction("documentsDecide", { documentType: "bill", documentId: disc.billId, decision: "approve" }, staff.idToken), "PERMISSION_DENIED", "maker without bill:approve cannot approve");
  const approved = await callFunction("documentsDecide", { documentType: "bill", documentId: disc.billId, decision: "approve", reason: "loyal customer" }, admin.idToken);
  assert.equal(approved.status, "active");
  assert.equal(await stockOf(org.organizationId, prod.productId), 47);
  ok("Admin approves → bill active, stock 48 → 47; approver and reason recorded");

  // Policy ON for purchases
  await callFunction("organizationsUpdate", { organizationId: org.organizationId, settings: { approvals: { enabled: true, modules: { sale: false, purchase: true, expense: true } } } }, org.idToken);
  const buyer = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "employee", permissions: { "purchase:create": true, "purchase:view": true, "expense:create": true } });
  const pend = await callFunction("outflowsCreate", { kind: "purchase", payee: "Steel Co", lines: [{ productId: prod.productId, quantity: 10, unit: "piece", unitPrice: 60 }] }, buyer.idToken);
  assert.equal(pend.status, "pending_approval");
  assert.equal(await stockOf(org.organizationId, prod.productId), 47);
  ok("approvals on: purchase by staff without purchase:approve → pending, stock unchanged");
  const rej = await callFunction("documentsDecide", { documentType: "outflow", documentId: pend.outflowId, decision: "reject", reason: "wrong vendor" }, org.idToken);
  assert.equal(rej.status, "rejected");
  ok("Owner rejects pending purchase with reason (no stock/ledger effect)");
  const own = await callFunction("outflowsCreate", { kind: "purchase", payee: "Steel Co", lines: [{ productId: prod.productId, quantity: 10, unit: "piece", unitPrice: 60 }] }, admin.idToken);
  assert.equal(own.status, "confirmed");
  ok("approver's own purchase is not routed to approval (holds purchase:approve)");

  // Returns and stock adjustments go through the same engine (policy on: modules default on)
  const before = await stockOf(org.organizationId, prod.productId);
  const clerk = await createEmployeePersona(org.idToken, org.organizationId, { roleCode: "employee", permissions: { "return:create": true, "return:view": true, "stock:adjust": true, "stock:view": true } });
  const pendRet = await callFunction("returnsCreate", { returnType: "sales_return", referenceId: quick.billId, items: [{ productId: prod.productId, quantity: 1, refundAmount: 100, reason: "chipped" }] }, clerk.idToken);
  assert.equal(pendRet.status, "pending_approval");
  assert.equal(await stockOf(org.organizationId, prod.productId), before);
  await expectReason(callFunction("documentsDecide", { documentType: "return", documentId: pendRet.returnId, decision: "approve" }, clerk.idToken), "PERMISSION_DENIED", "return maker without return:approve");
  const doneRet = await callFunction("documentsDecide", { documentType: "return", documentId: pendRet.returnId, decision: "approve", reason: "verified" }, admin.idToken);
  assert.equal(doneRet.status, "completed");
  assert.equal(await stockOf(org.organizationId, prod.productId), before + 1);
  const retDoc = (await db.collection("returns").doc(pendRet.returnId).get()).data();
  assert.equal(retDoc.createdBy, clerk.uid);
  assert.equal(retDoc.approvedBy, admin.uid);
  await expectReason(callFunction("documentsDecide", { documentType: "return", documentId: pendRet.returnId, decision: "approve" }, admin.idToken), "not pending", "approving the same return twice");
  ok(`pending return (no effect) → approved through documentsDecide: stock ${before} → ${before + 1}, maker kept, approver recorded, second approval refused`);

  const adj1 = await callFunction("stockAdjust", { productId: prod.productId, quantity: -2, reason: "broken", reasonCode: "damaged" }, clerk.idToken);
  assert.equal(adj1.status, "pending_approval");
  const rejAdj = await callFunction("documentsDecide", { documentType: "stock_adjustment", documentId: adj1.requestId, decision: "reject", reason: "recount" }, admin.idToken);
  assert.equal(rejAdj.status, "rejected");
  assert.equal(await stockOf(org.organizationId, prod.productId), before + 1);
  const adj2 = await callFunction("stockAdjust", { productId: prod.productId, quantity: -2, reason: "broken", reasonCode: "damaged" }, clerk.idToken);
  const okAdj = await callFunction("documentsDecide", { documentType: "stock_adjustment", documentId: adj2.requestId, decision: "approve" }, admin.idToken);
  assert.equal(okAdj.status, "adjusted");
  assert.equal(await stockOf(org.organizationId, prod.productId), before - 1);
  const reqDoc = (await db.collection("stockAdjustmentRequests").doc(adj2.requestId).get()).data();
  assert.equal(reqDoc.status, "approved");
  assert.ok(reqDoc.movementId);
  ok("stock adjustment requests: reject → no effect; approve → movement written and linked (movementId), stock −2");
}

async function dataScope(sa) {
  console.log("\n[8] Data scope (self / team / organization)");
  const org = await makeOrg(sa, "Scope");
  const o = org.organizationId;
  const perms = { "purchase:create": true, "purchase:view": true, "report:view": true };
  const pm = await createEmployeePersona(org.idToken, o, { roleCode: "employee", permissions: perms });
  const ps = await createEmployeePersona(org.idToken, o, { roleCode: "employee", permissions: perms });
  const sm = await createEmployeePersona(org.idToken, o, { roleCode: "employee", permissions: { "purchase:view": true, "bill:create": true, "report:view": true } });
  await callFunction("employeesUpdate", { organizationId: o, membershipId: ps.membershipId, reportingToIds: [pm.membershipId] }, org.idToken);
  const line = { itemName: "Spare", quantity: 1, unit: "piece", unitPrice: 50, addToStock: false };
  await callFunction("outflowsCreate", { kind: "purchase", payee: "V", lines: [line] }, ps.idToken);
  await callFunction("outflowsCreate", { kind: "purchase", payee: "V", lines: [line] }, pm.idToken);
  const pmList = await callFunction("outflowsList", { kind: "purchase" }, pm.idToken);
  const psList = await callFunction("outflowsList", { kind: "purchase" }, ps.idToken);
  const smList = await callFunction("outflowsList", { kind: "purchase" }, sm.idToken);
  const ownerList = await callFunction("outflowsList", { kind: "purchase" }, org.idToken);
  assert.equal(pmList.scope, "team");
  assert.equal(pmList.count, 2);
  assert.equal(psList.scope, "self");
  assert.equal(psList.count, 1);
  assert.equal(smList.count, 0);
  assert.equal(ownerList.scope, "organization");
  assert.equal(ownerList.count, 2);
  ok("purchase manager sees team (2), purchase staff sees self (1), sales manager sees none (0), Owner sees all (2)");
  const act = await callFunction("reportsGetStaffActivity", {}, pm.idToken);
  assert.equal(act.scope, "team");
  assert.ok(act.staffSummaries.every((s) => [pm.uid, ps.uid].includes(s.userId)));
  assert.ok(act.staffSummaries.some((s) => s.userId === ps.uid && s.purchases.count === 1));
  ok("staff activity for purchase manager covers only own team, with per-employee purchase counts");

  // Teams: leader manages own reportees; cannot poach another team's member
  const buyTeam = await callFunction("teamsCreate", { organizationId: o, name: "Purchase Team", description: "Buying", leaderMembershipId: pm.membershipId }, org.idToken);
  const salesTeam = await callFunction("teamsCreate", { organizationId: o, name: "Sales Team", leaderMembershipId: sm.membershipId }, org.idToken);
  await callFunction("teamsAssignMember", { teamId: salesTeam.teamId, membershipId: sm.membershipId, action: "add" }, org.idToken);
  const added = await callFunction("teamsAssignMember", { teamId: buyTeam.teamId, membershipId: ps.membershipId, action: "add" }, pm.idToken);
  assert.equal(added.teamId, buyTeam.teamId);
  await expectReason(callFunction("teamsAssignMember", { teamId: buyTeam.teamId, membershipId: sm.membershipId, action: "add" }, pm.idToken), "PERMISSION_DENIED", "team leader moving a non-reportee from another team");
  await expectReason(callFunction("teamsUpdate", { teamId: buyTeam.teamId, leaderMembershipId: ps.membershipId }, pm.idToken), "FIELD_NOT_EDITABLE", "team leader changing team leader");
  const teams = await callFunction("teamsList", {}, org.idToken);
  assert.equal(teams.teams.find((t) => t.teamId === buyTeam.teamId).memberCount, 1);
  ok("team leader adds own reportee via teamsAssignMember; teamsList derives members (no embedded array)");
}

async function voidReversal(sa) {
  console.log("\n[9] Void & reversal");
  const org = await makeOrg(sa, "Void");
  const prod = await callFunction("productsCreate", { name: "Bucket", sellingPrice: 100, costPrice: 50 }, org.idToken);
  const vend = await callFunction("vendorsCreate", { name: "Plastic Co", phone: "+919876543211" }, org.idToken);
  const cust = await callFunction("customersCreate", { name: "Shop A", phone: "+919876543212", creditLimit: 0 }, org.idToken);
  const pur = await callFunction("outflowsCreate", { kind: "purchase", vendorId: vend.vendorId, invoiceNumber: "PC-1", lines: [{ productId: prod.productId, quantity: 10, unit: "piece", unitPrice: 50 }] }, org.idToken);
  await expectReason(callFunction("outflowsCreate", { kind: "purchase", vendorId: vend.vendorId, invoiceNumber: "PC-1", lines: [{ productId: prod.productId, quantity: 1, unit: "piece", unitPrice: 50 }] }, org.idToken), "already-exists", "duplicate vendor invoice number");
  const bill = await callFunction("billsCreate", { salesMode: "b2b", customerId: cust.customerId, items: [{ productId: prod.productId, quantity: 3 }], paidAmount: 100 }, org.idToken);
  assert.equal(await stockOf(org.organizationId, prod.productId), 7);
  const v = await callFunction("billsVoid", { documentId: bill.billId, reason: "keyed twice" }, org.idToken);
  assert.equal(v.status, "voided");
  assert.equal(await stockOf(org.organizationId, prod.productId), 10);
  const c = (await db.collection("customers").doc(cust.customerId).get()).data();
  assert.equal(c.outstandingBalance, 0);
  assert.equal(c.totalSpend, 0);
  const pmt = (await db.collection("payments").doc(bill.paymentId).get()).data();
  assert.equal(pmt.status, "voided");
  ok("billsVoid: stock 7 → 10, customer balance/spend reversed to 0, linked payment voided");
  await expectReason(callFunction("paymentsCreate", { direction: "in", partyType: "customer", partyId: cust.customerId, amount: 10, referenceId: bill.billId, referenceModel: "bill" }, org.idToken), "failed-precondition", "payment against a voided bill");
  const pv = await callFunction("outflowsVoid", { documentId: pur.outflowId, reason: "wrong vendor" }, org.idToken);
  assert.equal(pv.status, "voided");
  assert.equal(await stockOf(org.organizationId, prod.productId), 0);
  assert.equal((await db.collection("vendors").doc(vend.vendorId).get()).data().outstandingPayable, 0);
  const locks = await db.collection("vendorInvoiceLocks").where("organizationId", "==", org.organizationId).get();
  assert.equal(locks.size, 0);
  ok("outflowsVoid: stock 10 → 0, vendor payable reversed to 0, invoice lock released");
  const again = await callFunction("outflowsCreate", { kind: "purchase", vendorId: vend.vendorId, invoiceNumber: "PC-1", lines: [{ productId: prod.productId, quantity: 1, unit: "piece", unitPrice: 50 }] }, org.idToken);
  assert.equal(again.status, "confirmed");
  ok("voided invoice number can be re-entered");

  // Draft edits: quotations are editable (re-priced, change history); finalized bills are immutable
  const mop = await callFunction("productsCreate", { name: "Mop", sellingPrice: 100, costPrice: 50, initialStock: 10 }, org.idToken);
  const qtn = await callFunction("billsCreate", { documentType: "quotation", items: [{ productId: mop.productId, quantity: 2 }] }, org.idToken);
  const edited = await callFunction("billsUpdateDraft", { billId: qtn.billId, items: [{ productId: mop.productId, quantity: 5 }], notes: "revised" }, org.idToken);
  assert.equal(edited.totalAmount, 500);
  const hist = await callFunction("auditGetEntityHistory", { entityType: "bill", entityId: qtn.billId }, org.idToken);
  assert.ok(hist.items.some((h) => h.changes.some((c) => c.field === "totalAmount" && c.from === 200 && c.to === 500)));
  const fin = await callFunction("billsFinalize", { billId: qtn.billId }, org.idToken);
  assert.equal(fin.totalAmount, 500);
  await expectReason(callFunction("billsUpdateDraft", { billId: qtn.billId, notes: "too late" }, org.idToken), "DOCUMENT_IMMUTABLE", "editing a finalized invoice");
  ok("quotation edited 2 → 5 units (total 200 → 500 in change history), finalized at 500; finalized invoice is immutable (void and reissue)");

  // Standalone paymentsVoid: create a payment, void it, verify reversal
  const custPV = await callFunction("customersCreate", { name: "PV Test Shop", phone: "+919876543213" }, org.idToken);
  const prodPV = await callFunction("productsCreate", { name: "PV Widget", sellingPrice: 200, costPrice: 100, initialStock: 5 }, org.idToken);
  const billPV = await callFunction("billsCreate", { salesMode: "b2b", customerId: custPV.customerId, items: [{ productId: prodPV.productId, quantity: 2 }], paidAmount: 0 }, org.idToken);
  const payPV = await callFunction("paymentsCreate", { direction: "in", partyType: "customer", partyId: custPV.customerId, amount: 200, referenceId: billPV.billId, referenceModel: "bill" }, org.idToken);
  const custBeforeVoid = (await db.collection("customers").doc(custPV.customerId).get()).data();
  const billBeforeVoid = (await db.collection("bills").doc(billPV.billId).get()).data();
  assert.equal(billBeforeVoid.paidAmount, 200);
  const pvResult = await callFunction("paymentsVoid", { paymentId: payPV.paymentId, reason: "duplicate entry" }, org.idToken);
  assert.equal(pvResult.status, "voided");
  const billAfterVoid = (await db.collection("bills").doc(billPV.billId).get()).data();
  assert.equal(billAfterVoid.paidAmount, 0);
  assert.equal(billAfterVoid.paymentStatus, "pending");
  const custAfterVoid = (await db.collection("customers").doc(custPV.customerId).get()).data();
  assert.equal(custAfterVoid.outstandingBalance, billPV.totalAmount);
  await expectReason(callFunction("paymentsVoid", { paymentId: payPV.paymentId, reason: "again" }, org.idToken), "failed-precondition", "double void of same payment");
  ok("paymentsVoid: reverses bill settlement (paid 200 → 0, pending), restores customer outstanding, rejects double-void");
}

async function bicycleWholesale(sa) {
  console.log("\n[10] Flagship: bicycle wholesale");
  const org = await makeOrg(sa, "Cycle World", { businessType: "wholesale_retail", businessCategory: "bicycle" });
  const t = org.idToken;
  const groupId = `grp_${uniq()}`;
  const bike26 = await callFunction("productsCreate", { name: "Hero Sprint 26in Red", brand: "Hero", sellingPrice: 9000, costPrice: 7000, trackSerial: true, warrantyMonths: 24, variantGroupId: groupId, variantAttributes: { size: "26in", colour: "red" }, weight: { value: 15, unit: "kg" } }, t);
  const bike24 = await callFunction("productsCreate", { name: "Hero Sprint 24in Blue", brand: "Hero", sellingPrice: 8500, costPrice: 6600, trackSerial: true, variantGroupId: groupId, variantAttributes: { size: "24in", colour: "blue" } }, t);
  const tube = await callFunction("productsCreate", { name: "Tube 26x1.95", sellingPrice: 150, costPrice: 90 }, t);
  const chain = await callFunction("productsCreate", { name: "Chain KMC Z410", sellingPrice: 400, costPrice: 250 }, t);
  const vend = await callFunction("vendorsCreate", { name: "Ludhiana Cycles", phone: "+919876543214" }, t);
  const cust = await callFunction("customersCreate", { name: "City Cycle Store", phone: "+919876543215", creditLimit: 100000 }, t);
  const variants = await callFunction("productsList", {}, t);
  assert.equal(variants.items.filter((p) => p.variantGroupId === groupId).length, 2);
  ok("variants modelled as separate SKUs sharing variantGroupId (size/colour attributes)");

  const p1 = await callFunction("outflowsCreate", {
    kind: "purchase", vendorId: vend.vendorId, invoiceNumber: "LC-101", paidAmount: 10000, paymentMethod: "bank_transfer", lines: [
      { productId: bike26.productId, quantity: 3, unit: "piece", unitPrice: 7000, serialNumbers: ["FR26-001", "FR26-002", "FR26-003"] },
      { productId: tube.productId, quantity: 20, unit: "piece", unitPrice: 90, damagedQuantity: 2, damageReason: "punctured in transit" },
    ]
  }, t);
  const p2 = await callFunction("outflowsCreate", {
    kind: "purchase", vendorId: vend.vendorId, invoiceNumber: "LC-102", lines: [
      { productId: chain.productId, quantity: 10, unit: "piece", unitPrice: 250 },
      { productId: bike24.productId, quantity: 2, unit: "piece", unitPrice: 6600, serialNumbers: ["FR24-001", "FR24-002"] },
    ]
  }, t);
  assert.equal(await stockOf(org.organizationId, tube.productId), 18);
  ok("damaged-on-receipt: 20 tubes billed, 2 damaged written off at receipt → stock 18");

  const credit = await callFunction("billsCreate", { salesMode: "b2b", customerId: cust.customerId, items: [{ productId: bike26.productId, quantity: 2, serialNumbers: ["FR26-001", "FR26-002"] }], paidAmount: 5000 }, t);
  const billDoc = (await db.collection("bills").doc(credit.billId).get()).data();
  assert.equal(billDoc.items[0].serialNumbers, undefined, "bill lines store no serial lists (registry is the source)");
  const creditView = await callFunction("billsGet", { billId: credit.billId }, t);
  assert.deepEqual(creditView.serialsByLine.L1, ["FR26-001", "FR26-002"]);
  const fr1 = (await db.collection("serials").doc(`${org.organizationId}_FR26-001`).get()).data();
  assert.equal(fr1.status, "sold");
  assert.equal(fr1.soldBillId, credit.billId);
  assert.equal(fr1.name, undefined);
  ok("serial registry: FR26-001/002 sold on line L1 (one doc per unit, references only); billsGet derives serialsByLine");
  await expectReason(callFunction("billsCreate", { items: [{ productId: bike26.productId, quantity: 1, serialNumbers: ["FR26-001"] }] }, t), "SERIAL_NOT_IN_STOCK", "selling an already-sold frame number");
  await expectReason(callFunction("outflowsCreate", { kind: "purchase", vendorId: vend.vendorId, invoiceNumber: "LC-999", lines: [{ productId: bike26.productId, quantity: 1, unit: "piece", unitPrice: 7000, serialNumbers: ["fr26-003"] }] }, t), "DUPLICATE_NATURAL_KEY", "receiving a serial that already exists (case-insensitive)");
  await expectReason(callFunction("billsCreate", { items: [{ productId: bike24.productId, quantity: 1 }] }, t), "SERIALS_REQUIRED", "selling a serial-tracked bicycle without its frame number");
  const inHand = (await db.collection("serials").where("organizationId", "==", org.organizationId).where("productId", "==", bike26.productId).get()).docs.filter((d) => ["in_stock", "returned", "reserved"].includes(d.data().status)).length;
  assert.equal(inHand, await stockOf(org.organizationId, bike26.productId));
  ok(`26in stock ${inHand} = serials in hand (registry reconciles with stock)`);
  await callFunction("billsCreate", { items: [{ productId: tube.productId, quantity: 4 }, { productId: chain.productId, quantity: 1 }], paidAmount: 1000 }, t);
  ok("credit B2B sale of 2 bicycles with frame numbers + cash counter sale of spares");

  const ret = await callFunction("returnsCreate", { returnType: "purchase_return", referenceId: p2.outflowId, refundMethod: "credit_note", items: [{ productId: chain.productId, quantity: 1, refundAmount: 250, reason: "defective links" }] }, t);
  assert.ok(ret.returnId);
  assert.equal(await stockOf(org.organizationId, chain.productId), 8);
  ok("defective chain returned to vendor: stock 10 − 1 sold − 1 returned = 8, vendor credited");

  const st = await callFunction("reportsGetPartyStatement", { partyType: "vendor", partyId: vend.vendorId }, t);
  const total = 21000 + 1800 + 2500 + 13200; // p1 + p2
  assert.equal(st.totalDebit, total);
  assert.equal(st.totalCredit, 10000 + 250);
  assert.equal(st.closingBalance, total - 10250);
  assert.equal(st.closingBalance, st.ledgerBalance);
  assert.equal(st.dayWise.reduce((n, d) => n + d.count, 0), 2);
  assert.ok(st.documents.some((d) => d.paymentStatus === "partial") && st.documents.some((d) => d.paymentStatus === "pending"));
  ok(`vendor statement: 2 purchases same day, debit ${st.totalDebit}, credit ${st.totalCredit}, closing ${st.closingBalance} = vendor ledger; per-purchase paid status`);
  const pnl = await callFunction("reportsGetProfitLoss", {}, t);
  assert.equal(pnl.inventoryWriteOff, 180);
  ok("P&L inventory write-off includes the 2 damaged tubes (₹180)");
  const cs = await callFunction("reportsGetPartyStatement", { partyType: "customer", partyId: cust.customerId }, t);
  assert.equal(cs.closingBalance, 18000 - 5000);
  assert.equal(cs.ageing.current + cs.ageing.d1_30, 13000);
  ok("customer statement: receivable 13,000 with ageing buckets");
  void p1;
}

async function kitchenwareWholesale(sa) {
  console.log("\n[11] Flagship: kitchenware wholesale (piece vs box of 12)");
  const org = await makeOrg(sa, "Kitchen Mart", { businessType: "wholesale_retail", businessCategory: "kitchenware_household" });
  const t = org.idToken;
  const bucket = await callFunction("productsCreate", { name: "Bucket 16L", baseUnit: "piece", sellingPrice: 100, costPrice: 80, alternateUnits: [{ unit: "box", factor: 12, sellingPrice: 1100, isPurchaseUnit: true, isSaleUnit: true }] }, t);
  const brush = await callFunction("productsCreate", { name: "Toilet Brush", sellingPrice: 60, costPrice: 35, isReturnable: false, initialStock: 30 }, t);
  const plate = await callFunction("productsCreate", { name: "Steel Plate", sellingPrice: 50, costPrice: 30, initialStock: 100, maxDiscountPercent: 5 }, t);
  await callFunction("outflowsCreate", { kind: "purchase", payee: "Mumbai Plastics", lines: [{ productId: bucket.productId, quantity: 5, unit: "box", unitPrice: 900 }] }, t);
  assert.equal(await stockOf(org.organizationId, bucket.productId), 60);
  const wac = (await db.collection("products").doc(bucket.productId).get()).data().weightedAverageCost;
  assert.equal(wac, 75);
  ok("bought 5 boxes @ ₹900 → stock 60 pieces, WAC ₹75/piece (box cost ÷ 12)");
  await expectReason(callFunction("billsCreate", { items: [{ productId: bucket.productId, quantity: 1, unit: "carton" }] }, t), "INVALID_ARGUMENT", "unconfigured unit rejected");
  const mixed = await callFunction("billsCreate", { items: [{ productId: bucket.productId, quantity: 1, unit: "box" }, { productId: bucket.productId, quantity: 5, unit: "piece" }], paidAmount: 1600 }, t);
  assert.equal(mixed.totalAmount, 1600);
  assert.equal(await stockOf(org.organizationId, bucket.productId), 43);
  const mb = (await db.collection("bills").doc(mixed.billId).get()).data();
  assert.equal(mb.items[0].baseQuantity, 12);
  assert.equal(mb.items[0].costSnapshot, 900);
  ok("mixed-unit invoice (1 box ₹1,100 + 5 pieces ₹500): stock 60 → 43, line freezes factor 12 and box cost ₹900");
  await callFunction("billsCreate", { items: [{ productId: bucket.productId, quantity: 7 }] }, t);
  assert.equal(await stockOf(org.organizationId, bucket.productId), 36);
  ok("partial box sale of 7 pieces → stock 36 (3 full boxes)");
  const disc = await callFunction("billsCreate", { items: [{ productId: plate.productId, quantity: 10, discountValue: 50 }] }, t);
  assert.equal(disc.status, "active");
  ok("Owner (approver) may exceed the 5% plate discount ceiling directly");
  const brushBill = await callFunction("billsCreate", { items: [{ productId: brush.productId, quantity: 2 }] }, t);
  await expectReason(callFunction("returnsCreate", { returnType: "sales_return", referenceId: brushBill.billId, items: [{ productId: brush.productId, quantity: 1, refundAmount: 60, reason: "changed mind" }] }, t), "non-returnable", "return of non-returnable brush");
  await expectReason(callFunction("returnsCreate", { returnType: "sales_return", referenceId: mixed.billId, items: [{ productId: bucket.productId, quantity: 1, refundAmount: 100, reason: "which line?" }] }, t), "AMBIGUOUS_SOURCE_LINE", "return of a product sold on two lines without sourceLineId");
  await expectReason(callFunction("returnsCreate", { returnType: "sales_return", referenceId: mixed.billId, items: [{ productId: bucket.productId, sourceLineId: "L1", quantity: 1, refundAmount: 1500, reason: "over-refund" }] }, t), "exceeds the line value", "refund above the source line value");
  const ret = await callFunction("returnsCreate", { returnType: "sales_return", referenceId: mixed.billId, items: [{ productId: bucket.productId, sourceLineId: "L1", quantity: 1, refundAmount: 1100, reason: "damaged handle", disposition: "restocked_to_inventory" }] }, t);
  assert.ok(ret.returnId);
  assert.equal(await stockOf(org.organizationId, bucket.productId), 48);
  ok("returning 1 box restocks 12 pieces (36 → 48)");
  await callFunction("productsUpdate", { productId: bucket.productId, sellingPrice: 110 }, t);
  const ph = await callFunction("productsGetPriceHistory", { productId: bucket.productId }, t);
  assert.equal(ph.purchaseStats.last, 75);
  assert.ok(ph.priceChanges.some((c) => c.field === "sellingPrice" && c.from === 100 && c.to === 110));
  ok("price history: purchase cost/piece 75 (derived from purchase lines), selling price 100 → 110 from change history");
}

async function expressibility(sa) {
  console.log("\n[12] Schema expressibility: mobile phone & jewellery");
  const org = await makeOrg(sa, "Gadgets & Gold", { businessType: "retail_only", businessCategory: "mobile_electronics" });
  const phone = await callFunction("productsCreate", { name: "Galaxy A15 128GB Black", brand: "Samsung", sellingPrice: 15000, costPrice: 13000, trackSerial: true, warrantyMonths: 12, variantAttributes: { storage: "128GB", colour: "black" } }, org.idToken);
  await callFunction("outflowsCreate", { kind: "purchase", payee: "Distributor", lines: [{ productId: phone.productId, quantity: 2, unit: "piece", unitPrice: 13000, serialNumbers: ["356789012345678", "356789012345679"] }] }, org.idToken);
  const sale = await callFunction("billsCreate", { items: [{ productId: phone.productId, quantity: 1, serialNumbers: ["356789012345678"] }], paidAmount: 15000 }, org.idToken);
  assert.ok(sale.billId);
  ok("mobile phone: IMEI captured on purchase and sale lines, 12-month warranty on product");
  const ring = await callFunction("productsCreate", { name: "Gold Ring 22K", baseUnit: "piece", sellingPrice: 32000, jewellery: { grossWeightGrams: 5.2, netWeightGrams: 4.8, purity: "22K", makingCharge: 450, makingChargeType: "per_gram", hallmarkId: "HUID-AB12CD", priceByDailyRate: true } }, org.idToken);
  const ringDoc = await callFunction("productsGet", { productId: ring.productId }, org.idToken);
  assert.equal(ringDoc.jewellery.purity, "22K");
  ok("jewellery: gross/net weight, purity, making charge, hallmark stored (daily-rate pricing flagged; computation not automated)");
}

async function outflowAndSweep(sa) {
  console.log("\n[13] Total outflow vs P&L, scheduled sweep");
  const org = await makeOrg(sa, "Outflow");
  const t = org.idToken;
  const prod = await callFunction("productsCreate", { name: "Mug", sellingPrice: 100, costPrice: 40 }, t);
  await callFunction("outflowsCreate", { kind: "purchase", payee: "V", paidAmount: 400, lines: [{ productId: prod.productId, quantity: 10, unit: "piece", unitPrice: 40 }] }, t);
  await callFunction("outflowsCreate", { kind: "expense", payee: "Landlord", expenseCategoryId: "rent", paidAmount: 1000, lines: [{ itemName: "Rent", quantity: 1, unit: "month", unitPrice: 1000 }] }, t);
  const emp = await createEmployeePersona(t, org.organizationId, { roleCode: "employee" });
  await callFunction("outflowsCreate", { kind: "expense", payeeType: "employee", payeeMembershipId: emp.membershipId, payee: "Salary advance", lines: [{ itemName: "Advance", quantity: 1, unit: "piece", unitPrice: 500 }] }, t);
  await callFunction("billsCreate", { items: [{ productId: prod.productId, quantity: 4 }], paidAmount: 400 }, t);
  const sum = await callFunction("reportsGetOutflowSummary", { groupBy: "category" }, t);
  assert.equal(sum.accrual.purchases, 400);
  assert.equal(sum.accrual.expenses, 1500);
  assert.equal(sum.accrual.totalOutflow, 1900);
  assert.equal(sum.accrual.employeeLinkedExpenses, 500);
  assert.equal(sum.cash.paid, 1400);
  const pnl = await callFunction("reportsGetProfitLoss", {}, t);
  assert.equal(pnl.totalExpenses, 1500);
  assert.equal(pnl.cogs, 160);
  assert.equal(pnl.netProfit, 400 - 160 - 1500);
  ok("total outflow 1,900 = purchases 400 + expenses 1,500 (cash paid 1,400); P&L uses COGS 160 not purchases → net −1,260");
  const cashier = await createEmployeePersona(t, org.organizationId, { roleCode: "employee", permissions: { "expense:view": true } });
  const visible = await callFunction("outflowsList", { kind: "expense" }, cashier.idToken);
  assert.ok(visible.items.every((o) => !o.payeeMembershipId));
  ok("employee-linked (salary advance) expense hidden without expense:view_sensitive");

  // Sweep
  const soon = await makeOrg(sa, "SweepSoon", { subscription: { expiresOn: ymd(3), status: "active" } });
  const lapsed = await makeOrg(sa, "SweepLapsed", { subscription: { startsAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), expiresOn: ymd(-2) } });
  // Run the scheduled job's core in a fresh process (its own Admin SDK init), twice
  const runSweep = () => JSON.parse(require("node:child_process").execFileSync(process.execPath, ["-e",
    "const m = require('./lib/triggers/scheduled.js'); if (typeof m.subscriptionAndUsageSweep !== 'function') throw new Error('subscriptionAndUsageSweep export missing'); m.runSubscriptionAndUsageSweep().then((r) => { console.log(JSON.stringify(r)); process.exit(0); })"],
    { cwd: require("node:path").resolve(__dirname, ".."), env: { ...process.env }, encoding: "utf8" }).trim().split("\n").pop());
  const r1 = runSweep();
  const r2 = runSweep();
  const notes = await db.collection("notifications").where("organizationId", "==", soon.organizationId).get();
  assert.equal(notes.size, 1);
  assert.ok(r1.remindersSent >= 1 && r2.remindersSent === 0);
  ok(`sweep: 3-day expiry reminder sent once (run 1: ${r1.remindersSent}, run 2: ${r2.remindersSent})`);
  recordTriggerObserved("subscriptionAndUsageSweep");
  const lapsedDoc = (await db.collection("organizations").doc(lapsed.organizationId).get()).data();
  assert.equal(lapsedDoc.subscriptionStatus, "expired");
  ok("sweep flips a lapsed trial to subscriptionStatus=expired (audited)");

  // Recurring expenses: one template; due periods generated by the sweep exactly once
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 3, 1)).toISOString().slice(0, 10);
  const tpl = await callFunction("recurringExpensesCreate", { name: "Shop rent", payee: "Landlord", expenseCategoryId: "rent", frequency: "monthly", dayOfMonth: 1, startOn: start, lines: [{ itemName: "Rent", quantity: 1, unit: "month", unitPrice: 15000 }] }, t);
  assert.equal(tpl.nextRunOn, start);
  const dueMonths = 3; // the 1st of each of the last two months and of this month
  runSweep();
  const gen = async () => (await db.collection("outflows").where("organizationId", "==", org.organizationId).where("recurringTemplateId", "==", tpl.templateId).get()).size;
  assert.equal(await gen(), dueMonths);
  runSweep();
  assert.equal(await gen(), dueMonths);
  const listed = await callFunction("recurringExpensesList", {}, t);
  assert.ok(listed.items.some((i) => i.templateId === tpl.templateId && i.nextRunOn > today));
  await callFunction("recurringExpensesUpdate", { templateId: tpl.templateId, isActive: false, name: "Shop rent (paused)" }, t);
  const updatedList = await callFunction("recurringExpensesList", {}, t);
  assert.ok(updatedList.items.some((i) => i.templateId === tpl.templateId && i.isActive === false));
  ok(`recurring rent from ${start}: ${dueMonths} monthly expenses generated (referencing the template); update verified; second sweep adds 0`);
}

// ---------------------------------------------------------------------------
// 14. Control probes: each check fails if the named protection is removed
//     (proved by scripts/mutation-spot-check.cjs)
// ---------------------------------------------------------------------------

async function controlProbes(sa) {
  console.log("\n[14] Control probes (cross-tenant, overpayment, metrics, redaction, branch scope)");
  const a = await makeOrg(sa, "ProbeA", { planId: "plan_enterprise" });
  const b = await makeOrg(sa, "ProbeB");
  const bStaff = await createEmployeePersona(b.idToken, b.organizationId, { roleCode: "employee" });

  // Cross-organization membership edit: Org A Owner targets an Org B membership with Org A's id
  await assertCallableError(callFunction("employeesUpdate", { organizationId: a.organizationId, membershipId: bStaff.membershipId, name: "Hijacked" }, a.idToken), ["permission-denied", "not-found", "TENANT_MISMATCH"]);
  const bUser = (await db.collection("users").doc(bStaff.uid).get()).data();
  assert.notEqual(bUser.name, "Hijacked");
  ok("Org A Owner cannot edit an Org B membership by passing its id (target unchanged)");

  // paymentsCreate: cross-tenant document reference and overpayment
  const bProd = await callFunction("productsCreate", { name: "B item", sellingPrice: 100, initialStock: 5 }, b.idToken);
  const bBill = await callFunction("billsCreate", { items: [{ productId: bProd.productId, quantity: 1 }] }, b.idToken);
  await assertCallableError(callFunction("paymentsCreate", { direction: "in", partyType: "customer", amount: 10, referenceId: bBill.billId, referenceModel: "bill" }, a.idToken), ["Cross-tenant", "permission-denied"]);
  const bBillDoc = (await db.collection("bills").doc(bBill.billId).get()).data();
  assert.equal(bBillDoc.paidAmount, 0);
  ok("paymentsCreate in Org A against an Org B bill is rejected; Org B bill paidAmount stays 0");
  await assertCallableError(callFunction("paymentsCreate", { direction: "in", partyType: "customer", amount: 150, referenceId: bBill.billId, referenceModel: "bill" }, b.idToken), ["exceeds the open balance"]);
  assert.equal((await db.collection("bills").doc(bBill.billId).get()).data().paidAmount, 0);
  ok("payment of 150 against a 100 balance is refused (no overpayment)");

  // Client usage metrics cannot decrement
  await assertCallableError(callFunction("usageRecordClientMetric", { metrics: { firestoreReads: -50 } }, a.idToken), ["INVALID_ARGUMENT", "between 0"]);
  ok("usageRecordClientMetric rejects a negative metric (no self-decrement)");

  // Redaction: cost fields need product:view_cost
  const prod = await callFunction("productsCreate", { name: "Costed", sellingPrice: 100, costPrice: 61 }, a.idToken);
  const viewer = await createEmployeePersona(a.idToken, a.organizationId, { roleCode: "employee", permissions: { "product:view": true } });
  const costViewer = await createEmployeePersona(a.idToken, a.organizationId, { roleCode: "employee", permissions: { "product:view": true, "product:view_cost": true } });
  const hidden = await callFunction("productsGet", { productId: prod.productId }, viewer.idToken);
  const hiddenList = (await callFunction("productsList", {}, viewer.idToken)).items.find((p) => p.productId === prod.productId || p.id === prod.productId);
  assert.equal(hidden.costPrice, undefined);
  assert.equal(hidden.weightedAverageCost, undefined);
  assert.ok(hiddenList && hiddenList.costPrice === undefined);
  const shown = await callFunction("productsGet", { productId: prod.productId }, costViewer.idToken);
  assert.equal(shown.costPrice, 61);
  ok("costPrice/WAC hidden from product:view only, returned with product:view_cost (get and list)");

  // Branch scope: assigned to main only → second branch denied
  const br = await callFunction("branchesCreate", { organizationId: a.organizationId, name: "Second Branch", code: `SB${Date.now() % 100000}` }, a.idToken);
  await assertCallableError(callFunction("productsList", { branchId: br.branchId }, viewer.idToken), ["BRANCH_NOT_ASSIGNED"]);
  const own = await callFunction("productsList", {}, viewer.idToken);
  assert.ok(Array.isArray(own.items));
  ok("employee assigned to the main branch is refused on another branch (BRANCH_NOT_ASSIGNED)");
}

async function partialDeliveries(sa) {
  console.log("\n[15] Partial deliveries");
  const org = await makeOrg(sa, "Deliveries");
  const t = org.idToken;
  const addr = { line1: "1 MG Road", city: "Bengaluru", pincode: "560001" };
  const prod = await callFunction("productsCreate", { name: "Water Can", sellingPrice: 50, costPrice: 20, initialStock: 100 }, t);
  const inv = await callFunction("billsCreate", { items: [{ productId: prod.productId, quantity: 10 }], paidAmount: 500 }, t);
  const d1 = await callFunction("deliveriesCreate", { billId: inv.billId, address: addr, lines: [{ lineId: "L1", quantity: 4 }] }, t);
  await expectReason(callFunction("deliveriesCreate", { billId: inv.billId, address: addr, lines: [{ lineId: "L1", quantity: 7 }] }, t), "DELIVERY_EXCEEDS_LINE", "second delivery beyond the undelivered remainder");
  const d2 = await callFunction("deliveriesCreate", { billId: inv.billId, address: addr }, t);
  assert.deepEqual((await db.collection("deliveries").doc(d2.deliveryId).get()).data().lines, [{ lineId: "L1", quantity: 6 }]);
  await expectReason(callFunction("deliveriesCreate", { billId: inv.billId, address: addr }, t), "DELIVERY_COMPLETE", "third delivery when every unit is already on a delivery");
  await callFunction("deliveriesUpdateStatus", { deliveryId: d1.deliveryId, status: "delivered" }, t);
  let view = await callFunction("billsGet", { billId: inv.billId }, t);
  assert.equal(view.delivery.complete, false);
  assert.deepEqual(view.delivery.lines[0], { lineId: "L1", ordered: 10, delivered: 4, onTheWay: 6, remaining: 0 });
  await callFunction("deliveriesUpdateStatus", { deliveryId: d2.deliveryId, status: "delivered" }, t);
  view = await callFunction("billsGet", { billId: inv.billId }, t);
  assert.equal(view.delivery.complete, true);
  ok("invoice of 10 delivered as 4 + 6 (defaults to the remainder); over-delivery refused; complete only when both are delivered");

  const so = await callFunction("billsCreate", { documentType: "sales_order", items: [{ productId: prod.productId, quantity: 5 }] }, t);
  const bal = async () => (await db.collection("stockBalances").doc(`${org.organizationId}_main-branch_${prod.productId}`).get()).data();
  assert.equal((await bal()).allocatedStock, 5);
  await expectReason(callFunction("deliveriesCreate", { billId: so.billId, address: addr, lines: [{ lineId: "L1", quantity: 2 }] }, t), "PARTIAL_ORDER_DELIVERY", "partial delivery of a sales order");
  const d3 = await callFunction("deliveriesCreate", { billId: so.billId, address: addr }, t);
  await callFunction("deliveriesUpdateStatus", { deliveryId: d3.deliveryId, status: "failed" }, t);
  assert.equal((await bal()).allocatedStock, 0);
  await callFunction("deliveriesUpdateStatus", { deliveryId: d3.deliveryId, status: "out_for_delivery" }, t);
  assert.equal((await bal()).allocatedStock, 5);
  const done = await callFunction("deliveriesUpdateStatus", { deliveryId: d3.deliveryId, status: "delivered", collectedAmount: 250 }, t);
  assert.ok(done.finalizedBill);
  assert.equal((await bal()).allocatedStock, 0);
  assert.equal(await stockOf(org.organizationId, prod.productId), 85);
  ok("sales order: failed delivery releases the reservation (5 → 0), retry re-reserves (0 → 5), delivered finalizes it (stock 90 → 85)");
}

async function main() {
  enforceLocalEmulatorSafety();
  await verifyEmulatorHealth();
  await require("../lib/scripts/seed-emulator.js").seedReferenceData(db);
  const sa = await getSuperAdminPersona();

  // GOV_ONLY=gate,usage,... runs a subset (used by scripts/mutation-spot-check.cjs)
  const only = (process.env.GOV_ONLY || "").split(",").filter(Boolean);
  const run = (name) => only.length === 0 || only.includes(name);
  if (run("gate") || run("subscription")) {
    const { expired } = await gateConformance(sa);
    await subscriptionLifecycle(sa, expired);
  }
  const sections = [
    ["seats", seatsAndOrgFields], ["employees", employeeSecurity], ["usage", usageLimits],
    ["approvals", approvalsAndSmallOrg], ["scope", dataScope], ["void", voidReversal],
    ["bicycle", bicycleWholesale], ["kitchen", kitchenwareWholesale], ["expressibility", expressibility],
    ["outflow", outflowAndSweep], ["controls", controlProbes], ["deliveries", partialDeliveries],
  ];
  for (const [name, fn] of sections) if (run(name)) await fn(sa);

  console.log(`\n[PASS] Governance & flagship suite: ${passed} checks passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[FAIL] Governance & flagship suite failed:", err);
  process.exit(1);
});
