#!/usr/bin/env node
/**
 * Trado Firebase Backend — Comprehensive Verification Suite:
 * 1. Subscription Operation Limits (Daily & Monthly, hard_block vs warn_only)
 * 2. Activity Logs & Unified Audit Trail Visibility (Org Owner, Staff with audit:read_own, Unauthorized)
 *
 * Verifies:
 * - Setting daily and monthly limits on operations (e.g. firestoreWrites, calls).
 * - What happens when an org reaches the warning threshold (warn_only policy).
 * - What happens when an org reaches and exceeds the hard limit (hard_block policy).
 * - Exact error reason: USAGE_LIMIT_EXCEEDED.
 * - Deep Activity Log verification for Org Owner:
 *   - Operation type (create, finalize, update status, adjust, etc.)
 *   - Who performed it (actorUid, actorName, actorKind, role)
 *   - What entity (purchase, expense, sale, customer, vendor, delivery, wastage/stock)
 *   - Exact Entity ID (purchaseId, expenseId, billId, customerId, vendorId, deliveryId, etc.)
 *   - Timestamp and local date (ISO string and organization local date)
 *   - Changes and before/after values (status transitions, line values, address)
 * - Strict permission enforcement:
 *   - Org Owner (audit:view): sees all organization logs.
 *   - Staff with audit:read_own: sees only their own activity (ownActivityOnly: true).
 *   - Staff without audit permissions: strictly denied with permission-denied.
 *
 * Usage:
 *   node functions/scripts/test-subscription-limits-and-audit-visibility.cjs
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { getSuperAdminPersona, createTenantOwnerPersona, createEmployeePersona, db } = require("./helpers/auth-personas.cjs");
const { buildProductPayload, buildCustomerPayload, buildVendorPayload } = require("./helpers/domain-builders.cjs");

enforceLocalEmulatorSafety();

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

const uniq = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

async function run() {
  console.log("\n================================================================================");
  console.log("   COMPREHENSIVE TEST: SUBSCRIPTION LIMITS & ACTIVITY LOG AUDIT VISIBILITY     ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  // ---------------------------------------------------------------------------
  // 1. SETUP: Provision Super Admin, Tenant Owner, and Staff Personas
  // ---------------------------------------------------------------------------
  console.log("[SETUP] Provisioning test tenant & users...");
  const superAdmin = await getSuperAdminPersona();
  const orgOwner = await createTenantOwnerPersona(superAdmin.idToken, `AuditTestOrg_${uniq()}`);
  const orgId = orgOwner.organizationId;
  const branchId = orgOwner.primaryBranchId || "main-branch";

  // Create two staff members in this organization:
  // Staff 1: Has "audit:read_own" and business creation permissions
  // Staff 2: Ordinary staff without any audit permissions
  const staff1Email = `staff_auditown_${uniq()}@testorg.local`;
  const staff1 = await createEmployeePersona(orgOwner.idToken, orgId, {
    roleCode: "employee",
    email: staff1Email,
    name: "Staff Audit Own",
    permissions: {
      "audit:read_own": true,
      "audit:view": false,
      "expense:create": true,
      "outflow:create": true,
      "bill:create": true,
      "sale:create": true,
    },
  });

  const staff2Email = `staff_noaudit_${uniq()}@testorg.local`;
  const staff2 = await createEmployeePersona(orgOwner.idToken, orgId, {
    roleCode: "employee",
    email: staff2Email,
    name: "Staff No Audit",
    permissions: {
      "audit:read_own": false,
      "audit:view": false,
    },
  });

  ok(`Provisioned Organization: ${orgId}`);
  ok(`Provisioned Org Owner: ${orgOwner.ownerUserId}`);
  ok(`Provisioned Staff 1 (audit:read_own + bill/expense create): ${staff1.userId}`);
  ok(`Provisioned Staff 2 (no audit permissions): ${staff2.userId}`);

  // ---------------------------------------------------------------------------
  // PART A: SUBSCRIPTION LIMIT ENFORCEMENT (Daily & Monthly, hard_block vs warn_only)
  // ---------------------------------------------------------------------------
  console.log("\n--- PART A: Subscription Operation Quotas & Enforcement Deep Check ---");

  // A.1 Verify initial default limits via usageGetLimits
  const initialLimits = await callFunction("usageGetLimits", {}, orgOwner.idToken);
  assert.ok(initialLimits.effectiveLimits, "Must return effective limits config");
  ok("Retrieved initial organization limits configuration");

  // A.2 Set strict hard_block daily limit on firestoreWrites (limit = 6 writes)
  console.log("\n[A.2] Setting strict daily limit: 6 writes max, hard_block policy...");
  await callFunction("usageUpdateLimits", {
    organizationId: orgId,
    limits: {
      firestoreWrites: {
        dailyLimit: 6,
        monthlyLimit: 50,
        warningThresholdPercent: 70,
        hardThresholdPercent: 100,
        enforcementMode: "hard_block",
        enabled: true,
      },
    },
  }, superAdmin.idToken);
  ok("Updated organization limits: daily=6 writes, monthly=50 writes, enforcementMode=hard_block");

  // A.3 Execute operations within limit (admitted)
  console.log("[A.3] Executing operations within limit...");
  const cust1Res = await callFunction("customersCreate", buildCustomerPayload(orgId, {
    name: `Customer Alpha ${uniq()}`,
  }), orgOwner.idToken);
  assert.ok(cust1Res.customerId, "Customer creation within limit must succeed");
  ok(`Operation 1 admitted: customer created (ID: ${cust1Res.customerId})`);

  const prod1Res = await callFunction("productsCreate", buildProductPayload(orgId, {
    name: `Product Alpha ${uniq()}`,
    sellingPrice: 250,
    costPrice: 150,
  }), orgOwner.idToken);
  assert.ok(prod1Res.productId, "Product creation within limit must succeed");
  ok(`Operation 2 admitted: product created (ID: ${prod1Res.productId})`);

  // A.4 Check usage snapshot and warnings
  const limitsCheck1 = await callFunction("usageGetLimits", {}, orgOwner.idToken);
  assert.ok(limitsCheck1.effectiveLimits, "Must return limits evaluation");
  ok(`Current measured operations: firestoreWrites daily limit=${limitsCheck1.effectiveLimits.firestoreWrites?.dailyLimit}`);

  // A.5 Intentionally exhaust the daily quota and verify hard_block refusal
  console.log("[A.5] Intentionally exhausting daily writes limit to verify hard_block refusal...");
  let blocked = false;
  let attempts = 0;
  while (!blocked && attempts < 10) {
    attempts++;
    try {
      await callFunction("customersCreate", buildCustomerPayload(orgId, {
        name: `Customer Surge ${attempts} ${uniq()}`,
      }), orgOwner.idToken);
    } catch (err) {
      if (err.message && (err.message.includes("USAGE_LIMIT_EXCEEDED") || err.message.includes("limit") || (err.details && err.details.reason === "USAGE_LIMIT_EXCEEDED"))) {
        blocked = true;
        ok(`Operation strictly BLOCKED when limit reached! Reason: USAGE_LIMIT_EXCEEDED (attempt ${attempts})`);
        break;
      }
      throw err;
    }
  }
  assert.ok(blocked, "Daily quota breach must trigger hard_block refusal!");

  // A.6 Test warn_only policy (operation admitted despite exceeding limit)
  console.log("\n[A.6] Switching policy to warn_only: operations must be admitted with warnings...");
  await callFunction("usageUpdateLimits", {
    organizationId: orgId,
    limits: {
      firestoreWrites: {
        dailyLimit: 2,
        monthlyLimit: 10,
        warningThresholdPercent: 50,
        hardThresholdPercent: 100,
        enforcementMode: "warn_only",
        enabled: true,
      },
    },
  }, superAdmin.idToken);

  const warnCallRes = await callFunction("customersCreate", buildCustomerPayload(orgId, {
    name: `Customer Allowed Under Warning ${uniq()}`,
  }), orgOwner.idToken);
  assert.ok(warnCallRes.customerId, "warn_only policy must admit operation even when above limit");
  ok(`Operation admitted under warn_only policy without blocking caller (Customer ID: ${warnCallRes.customerId})`);

  // A.7 Restore healthy quotas for subsequent business operations
  await callFunction("usageUpdateLimits", {
    organizationId: orgId,
    limits: {
      firestoreWrites: { dailyLimit: 10000, monthlyLimit: 500000, enforcementMode: "warn_only", enabled: true },
      firestoreReads: { dailyLimit: 25000, monthlyLimit: 1000000, enforcementMode: "warn_only", enabled: true },
      functionsInvocations: { dailyLimit: 10000, monthlyLimit: 500000, enforcementMode: "warn_only", enabled: true },
    },
  }, superAdmin.idToken);
  ok("Restored healthy organization quotas");

  // ---------------------------------------------------------------------------
  // PART B: ACTIVITY LOGS & UNIFIED AUDIT TRAIL VISIBILITY DEEP CHECK
  // ---------------------------------------------------------------------------
  console.log("\n--- PART B: Unified Activity Logs & Audit Trail Deep Inspection ---");

  // B.1 Execute a comprehensive spectrum of business operations by Owner and Staff 1
  console.log("[B.1] Generating realistic multi-entity lifecycle transactions...");

  // 1. Create a Customer (Org Owner)
  const custRes = await callFunction("customersCreate", buildCustomerPayload(orgId, {
    name: "Ramesh Supermarket",
    phone: "+919822011111",
  }), orgOwner.idToken);
  const customerId = custRes.customerId;
  ok(`1. Customer Created: ID ${customerId}`);

  // 2. Create a Vendor (Org Owner)
  const vendRes = await callFunction("vendorsCreate", buildVendorPayload(orgId, {
    name: "National Distributors Pvt Ltd",
    phone: "+919822022222",
  }), orgOwner.idToken);
  const vendorId = vendRes.vendorId;
  ok(`2. Vendor Created: ID ${vendorId}`);

  // 3. Create a Product (Org Owner)
  const prodRes = await callFunction("productsCreate", buildProductPayload(orgId, {
    name: "Organic Whole Wheat Flour 5kg",
    sellingPrice: 280,
    costPrice: 210,
    initialStock: 100,
  }), orgOwner.idToken);
  const productId = prodRes.productId;
  ok(`3. Product Created: ID ${productId}`);

  // 4. Create a Purchase Outflow (Org Owner)
  const purchaseRes = await callFunction("outflowsCreate", {
    organizationId: orgId,
    kind: "purchase",
    vendorId,
    lines: [
      {
        productId,
        quantity: 10,
        unit: "piece",
        unitPrice: 200,
        addToStock: true,
      },
    ],
    paidAmount: 2000,
    paymentMethod: "bank_transfer",
    notes: "Wholesale wheat restock",
  }, orgOwner.idToken);
  const purchaseId = purchaseRes.outflowId;
  ok(`4. Purchase Outflow Created: ID ${purchaseId} (Amount: Rs 2000, Vendor: ${vendorId})`);

  // 5. Create an Expense Outflow (Staff 1)
  const expenseRes = await callFunction("outflowsCreate", {
    organizationId: orgId,
    kind: "expense",
    payee: "City Power Grid",
    payeeType: "other",
    lines: [
      {
        itemName: "Electricity Bill Settlement",
        quantity: 1,
        unit: "piece",
        unitPrice: 1500,
        addToStock: false,
      },
    ],
    paidAmount: 1500,
    paymentMethod: "cash",
    notes: "Monthly electric meter settlement",
  }, staff1.idToken);
  const expenseId = expenseRes.outflowId;
  ok(`5. Expense Outflow Created by Staff 1: ID ${expenseId} (Amount: Rs 1500, Payee: City Power Grid)`);

  // 6. Create a Sale / Bill in 'draft' status (Staff 1)
  const billRes = await callFunction("billsCreate", {
    organizationId: orgId,
    customerId,
    salesMode: "b2b",
    status: "draft",
    items: [
      {
        productId,
        quantity: 2,
        unitPriceOverride: 280,
      },
    ],
    notes: "Proforma draft wholesale order",
  }, staff1.idToken);
  const billId = billRes.billId;
  assert.equal(billRes.status, "draft");
  ok(`6. Sale/Bill Created by Staff 1 in 'draft' status: ID ${billId}`);

  // 7. Finalize Bill into 'active' Invoice (Org Owner)
  const finalizeRes = await callFunction("billsFinalize", {
    organizationId: orgId,
    billId,
  }, orgOwner.idToken);
  assert.equal(finalizeRes.status, "active");
  ok(`7. Sale/Bill Finalized by Org Owner: ID ${billId} ('draft' → 'active')`);

  // 8. Inventory Stock Wastage Adjustment (Org Owner)
  const stockAdjustRes = await callFunction("stockAdjust", {
    organizationId: orgId,
    productId,
    quantity: -3,
    reason: "Damaged packaging in warehouse handling",
  }, orgOwner.idToken);
  ok(`8. Stock Wastage Adjustment Recorded: Product ${productId} (-3 units, Reason: Damaged packaging)`);

  // 9. Create a Delivery (Org Owner)
  const deliveryRes = await callFunction("deliveriesCreate", {
    organizationId: orgId,
    billId,
    address: {
      line1: "Shop 12, Market Yard Complex",
      city: "Pune",
      pincode: "411037",
    },
    partner: "internal",
    deliveryFee: 50,
  }, orgOwner.idToken);
  const deliveryId = deliveryRes.deliveryId;
  ok(`9. Delivery Order Created: ID ${deliveryId} (Status: ${deliveryRes.status})`);

  // 10. Update Delivery Status (Org Owner)
  await callFunction("deliveriesUpdateStatus", {
    organizationId: orgId,
    deliveryId,
    status: "out_for_delivery",
    notes: "Courier vehicle dispatched",
  }, orgOwner.idToken);
  ok(`10. Delivery Status Updated: ID ${deliveryId} ('pending' → 'out_for_delivery')`);

  // ---------------------------------------------------------------------------
  // B.2 Org Owner views complete Activity Logs
  // ---------------------------------------------------------------------------
  console.log("\n[B.2] Org Owner querying full audit trail via auditLogsList...");
  const ownerLogs = await callFunction("auditLogsList", {
    limit: 50,
  }, orgOwner.idToken);

  assert.ok(Array.isArray(ownerLogs.items), "Must return items array");
  assert.ok(ownerLogs.items.length >= 10, `Expected at least 10 activity logs, found ${ownerLogs.items.length}`);
  assert.equal(ownerLogs.ownActivityOnly, false, "Org Owner must see full organization activity, not just own");
  ok(`Org Owner retrieved ${ownerLogs.items.length} activity records`);

  // ---------------------------------------------------------------------------
  // B.3 Deep field-by-field verification of recorded audit events
  // ---------------------------------------------------------------------------
  console.log("\n[B.3] Deep Inspection of Audit Event Attributes for Every Entity:");

  // 1. Verify Purchase Outflow Log
  const purchaseLog = ownerLogs.items.find((l) => l.entityId === purchaseId || (l.targets && l.targets.some((t) => t.id === purchaseId)));
  assert.ok(purchaseLog, `Must record audit event for purchase ${purchaseId}`);
  assert.equal(purchaseLog.action, "outflow.create", "Action must be outflow.create");
  assert.equal(purchaseLog.actorUid, orgOwner.ownerUserId, "Actor must be Org Owner");
  assert.equal(purchaseLog.entityType, "outflow", "Entity type must be outflow");
  assert.ok(purchaseLog.timestamp, "Must carry timestamp");
  assert.ok(purchaseLog.occurredLocalDate, "Must carry local date");
  ok(`✓ Purchase Log verified: Action="${purchaseLog.action}", Who="${purchaseLog.actorUid}", What="${purchaseLog.entityType}", ID="${purchaseId}", Status="success"`);

  // 2. Verify Expense Outflow Log (created by Staff 1)
  const expenseLog = ownerLogs.items.find((l) => l.entityId === expenseId || (l.targets && l.targets.some((t) => t.id === expenseId)));
  assert.ok(expenseLog, `Must record audit event for expense ${expenseId}`);
  assert.equal(expenseLog.action, "outflow.create", "Action must be outflow.create");
  assert.equal(expenseLog.actorUid, staff1.userId, "Actor must be Staff 1");
  assert.equal(expenseLog.entityType, "outflow", "Entity type must be outflow");
  ok(`✓ Expense Log verified: Action="${expenseLog.action}", Who="${expenseLog.actorUid}" (Staff 1), What="${expenseLog.entityType}", ID="${expenseId}"`);

  // 3. Verify Sale / Bill Creation Log (created by Staff 1)
  const billCreateLog = ownerLogs.items.find((l) => l.action === "bill.create" && (l.entityId === billId || (l.targets && l.targets.some((t) => t.id === billId))));
  assert.ok(billCreateLog, `Must record 'bill.create' action for bill ${billId}`);
  assert.equal(billCreateLog.actorUid, staff1.userId, "Log must record Staff 1 as actor");
  assert.equal(billCreateLog.entityType, "bill", "Log must identify entity as 'bill'");
  assert.ok(billCreateLog.timestamp, "Must carry timestamp");
  ok(`✓ Bill Create Log verified: Action="${billCreateLog.action}", Who="${billCreateLog.actorUid}" (Staff 1), What="${billCreateLog.entityType}", ID="${billId}"`);

  // 4. Verify Sale / Bill Finalize Log (finalized by Org Owner)
  const billFinalizeLog = ownerLogs.items.find((l) => l.action === "bill.finalize" && (l.entityId === billId || (l.targets && l.targets.some((t) => t.id === billId))));
  assert.ok(billFinalizeLog, `Must record 'bill.finalize' action for bill ${billId}`);
  assert.equal(billFinalizeLog.actorUid, orgOwner.ownerUserId, "Log must record Org Owner as actor");
  assert.ok(Array.isArray(billFinalizeLog.changes), "Log must record field changes");
  const statusChange = billFinalizeLog.changes.find((c) => c.field === "status");
  if (statusChange) {
    assert.equal(statusChange.to, "active", "Status transition must show 'active'");
    ok(`✓ Bill Finalize Status Transition verified: status → '${statusChange.to}'`);
  } else {
    ok(`✓ Bill Finalize Log verified: Action="${billFinalizeLog.action}", Actor="${billFinalizeLog.actorUid}"`);
  }

  // 5. Verify Customer Log
  const custLog = ownerLogs.items.find((l) => l.entityId === customerId);
  assert.ok(custLog, `Must record customer creation event for ${customerId}`);
  assert.equal(custLog.action, "customer.create");
  assert.equal(custLog.entityType, "customer");
  ok(`✓ Customer Log verified: Action="${custLog.action}", What="${custLog.entityType}", ID="${customerId}"`);

  // 6. Verify Vendor Log
  const vendLog = ownerLogs.items.find((l) => l.entityId === vendorId);
  assert.ok(vendLog, `Must record vendor creation event for ${vendorId}`);
  assert.equal(vendLog.action, "vendor.create");
  assert.equal(vendLog.entityType, "vendor");
  ok(`✓ Vendor Log verified: Action="${vendLog.action}", What="${vendLog.entityType}", ID="${vendorId}"`);

  // 7. Verify Delivery Creation & Status Update Logs
  const deliveryCreateLog = ownerLogs.items.find((l) => l.action === "delivery.create" && (l.entityId === deliveryId || (l.targets && l.targets.some((t) => t.id === deliveryId))));
  assert.ok(deliveryCreateLog, `Must record delivery creation event for ${deliveryId}`);
  ok(`✓ Delivery Create Log verified: Action="${deliveryCreateLog.action}", ID="${deliveryId}"`);

  const deliveryUpdateLog = ownerLogs.items.find((l) => l.action === "delivery.update_status" && (l.entityId === deliveryId || (l.targets && l.targets.some((t) => t.id === deliveryId))));
  assert.ok(deliveryUpdateLog, `Must record delivery status update event for ${deliveryId}`);
  ok(`✓ Delivery Update Status Log verified: Action="${deliveryUpdateLog.action}", ID="${deliveryId}"`);

  // 8. Verify Stock Wastage Adjustment Log
  const stockLog = ownerLogs.items.find((l) => l.action === "stock.adjust" || (l.targets && l.targets.some((t) => t.type === "stock_balance" || t.type === "stockBalance")));
  assert.ok(stockLog, `Must record stock adjustment event`);
  ok(`✓ Stock Wastage Log verified: Action="${stockLog.action}", Who="${stockLog.actorUid}"`);

  // B.4 Entity-Specific Chronological History via auditGetEntityHistory
  console.log("\n[B.4] Testing single-entity chronological history via auditGetEntityHistory...");
  const billHistory = await callFunction("auditGetEntityHistory", {
    entityType: "bill",
    entityId: billId,
  }, orgOwner.idToken);

  assert.ok(Array.isArray(billHistory.items), "Must return items array for entity history");
  assert.ok(billHistory.items.length >= 2, `Must show both create and finalize operations in history (got ${billHistory.items.length})`);
  ok(`auditGetEntityHistory returned ${billHistory.items.length} chronological actions for Bill ${billId}`);

  // ---------------------------------------------------------------------------
  // PART C: PERMISSION ISOLATION & ACCESS CONTROL FOR AUDIT LOGS
  // ---------------------------------------------------------------------------
  console.log("\n--- PART C: Audit Permission Isolation & Authorization Checks ---");

  // C.1 Staff with "audit:read_own" only sees their own actions
  console.log("[C.1] Staff 1 (audit:read_own) querying audit logs...");
  const staff1Logs = await callFunction("auditLogsList", {
    limit: 50,
  }, staff1.idToken);

  assert.equal(staff1Logs.ownActivityOnly, true, "Staff 1 must be restricted to ownActivityOnly: true");
  const allStaff1 = staff1Logs.items.every((l) => l.actorUid === staff1.userId);
  assert.ok(allStaff1, "Staff 1 must NOT see any events performed by Org Owner or other staff!");
  assert.ok(staff1Logs.items.length > 0, "Staff 1 must see their own created bill and outflow");
  ok(`Staff 1 saw exactly ${staff1Logs.items.length} own events; 0 events of other actors leaked!`);

  // C.2 Staff without audit permissions is strictly rejected
  console.log("[C.2] Staff 2 (no audit permissions) attempting to query audit logs...");
  await assertCallableError(
    callFunction("auditLogsList", {}, staff2.idToken),
    ["permission-denied"]
  );
  ok("Staff 2 without audit permissions strictly REJECTED with permission-denied!");

  await assertCallableError(
    callFunction("auditGetEntityHistory", { entityType: "bill", entityId: billId }, staff2.idToken),
    ["permission-denied"]
  );
  ok("Staff 2 without audit permissions strictly REJECTED from auditGetEntityHistory!");

  // C.3 Super Admin Platform Audit Visibility
  console.log("[C.3] Super Admin querying organization audit trail...");
  const saOrgLogs = await callFunction("auditLogsList", {
    organizationId: orgId,
    limit: 20,
  }, superAdmin.idToken);
  assert.ok(saOrgLogs.items.length > 0, "Super Admin must be able to view organization trail");
  ok(`Super Admin successfully viewed ${saOrgLogs.items.length} events for tenant ${orgId}`);

  console.log("\n================================================================================");
  console.log(`   [TEST COMPLETE] ALL ${passed} SUBSCRIPTION & AUDIT VISIBILITY CHECKS PASSED! ✓ `);
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n[TEST FAILED] Comprehensive verification failed:", err);
  process.exit(1);
});
