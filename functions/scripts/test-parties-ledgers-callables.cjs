/**
 * Trado Firebase Backend — Parties & Ledgers Callables Contract Test
 * 
 * Tests 11 exports across customers, vendors, payments, and ledger reconciliation:
 * 1. customersCreate
 * 2. customersUpdate
 * 3. customersList
 * 4. customersGet
 * 5. vendorsCreate
 * 6. vendorsUpdate
 * 7. vendorsList
 * 8. vendorsGet
 * 9. paymentsCreate
 * 10. paymentsList
 * 11. reconcilePartyLedgers
 */

const assert = require("node:assert/strict");
const { verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { createTenantOwnerPersona, createUnassignedUserPersona } = require("./helpers/auth-personas.cjs");
const { buildCustomerPayload, buildVendorPayload } = require("./helpers/domain-builders.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: PARTIES & LEDGERS CALLABLES CONTRACT                       ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  console.log("[SETUP] Provisioning test personas...");
  const owner = await createTenantOwnerPersona({
    businessName: "Parties & Ledgers Enterprise",
    defaultBranchName: "Wholesale Depot",
    defaultBranchCode: "DEPOT",
  });
  const unassigned = await createUnassignedUserPersona();
  const ownerToken = owner.idToken;
  const orgId = owner.organizationId;
  console.log(`✓ Tenant Owner authenticated: ${owner.email} (Org: ${orgId})\n`);

  // ============================================================
  // 1. Customers Lifecycle: Create, Update, List, Get
  // ============================================================
  console.log("[DOMAIN: CUSTOMERS] Testing customersCreate, customersUpdate, customersList, customersGet...");

  // Unassigned user rejected
  await assertCallableError(
    callFunction("customersCreate", {
      organizationId: orgId,
      name: "Sneha Patel",
      phone: "+919876500123",
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ customersCreate rejected unassigned user");

  // Create customer
  const custPayload = buildCustomerPayload(orgId, {
    name: "Sneha Patel",
    phone: "+919876500123",
    email: "sneha.patel@example.local",
    addresses: [
      {
        line1: "42 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
        isDefaultBilling: true,
      },
    ],
    creditLimit: 50000,
    creditPeriodDays: 15,
  });

  const custRes = await callFunction("customersCreate", custPayload, ownerToken);
  assert.ok(custRes.customerId, "customersCreate must return customerId");
  assert.equal(custRes.name, "Sneha Patel");
  assert.ok(custRes.customerCode.startsWith("CUST-"), `customerCode must start with CUST-, got ${custRes.customerCode}`);
  const customerId = custRes.customerId;
  console.log(`✓ Customer created: Sneha Patel (ID: ${customerId}, Code: ${custRes.customerCode})`);

  // Update customer
  const custUpdateRes = await callFunction("customersUpdate", {
    organizationId: orgId,
    customerId,
    phone: "+919876500999",
    creditLimit: 75000,
  }, ownerToken);
  assert.ok(custUpdateRes.success, "customersUpdate must succeed");
  console.log("✓ customersUpdate updated phone and creditLimit");

  // Get customer
  const custGetRes = await callFunction("customersGet", {
    organizationId: orgId,
    customerId,
  }, ownerToken);
  assert.equal(custGetRes.customerId, customerId);
  assert.equal(custGetRes.phone, "+919876500999");
  assert.equal(custGetRes.creditLimit, 75000);
  console.log("✓ customersGet retrieved updated customer details");

  // Reject cross-tenant get
  const otherOwner = await createTenantOwnerPersona({
    businessName: "Other Mart",
  });
  await assertCallableError(
    callFunction("customersGet", {
      organizationId: otherOwner.organizationId,
      customerId,
    }, otherOwner.idToken),
    ["permission-denied", "not-found"]
  );
  console.log("✓ customersGet rejected cross-tenant retrieval");

  // List customers
  const custListRes = await callFunction("customersList", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(Array.isArray(custListRes.items));
  assert.ok(custListRes.items.some(c => c.customerId === customerId));
  console.log(`✓ customersList returned ${custListRes.items.length} customers`);

  // ============================================================
  // 2. Vendors Lifecycle: Create, Update, List, Get
  // ============================================================
  console.log("\n[DOMAIN: VENDORS] Testing vendorsCreate, vendorsUpdate, vendorsList, vendorsGet...");

  // Unassigned user rejected
  await assertCallableError(
    callFunction("vendorsCreate", {
      organizationId: orgId,
      name: "Sunrise Agro Foods",
      phone: "+919811223344",
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ vendorsCreate rejected unassigned user");

  // Create vendor
  const vendPayload = buildVendorPayload(orgId, {
    name: "Sunrise Agro Foods",
    phone: "+919811223344",
    email: "supply@sunriseagro.local",
    contacts: [
      {
        id: "cnt_rajesh_1",
        name: "Rajesh Kumar",
        phone: "+919811223344",
        email: "supply@sunriseagro.local",
        designation: "Sales Rep",
      },
    ],
    addresses: [
      {
        line1: "Warehouse 12, APMC Yard",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560022",
        country: "IN",
        isDefaultBilling: true,
      },
    ],
    paymentTermsDays: 30,
    creditLimit: 200000,
  });

  const vendRes = await callFunction("vendorsCreate", vendPayload, ownerToken);
  assert.ok(vendRes.vendorId, "vendorsCreate must return vendorId");
  assert.equal(vendRes.name, "Sunrise Agro Foods");
  assert.ok(vendRes.vendorCode.startsWith("VEND-"), `vendorCode must start with VEND-, got ${vendRes.vendorCode}`);
  const vendorId = vendRes.vendorId;
  console.log(`✓ Vendor created: Sunrise Agro Foods (ID: ${vendorId}, Code: ${vendRes.vendorCode})`);

  // Update vendor
  const vendUpdateRes = await callFunction("vendorsUpdate", {
    organizationId: orgId,
    vendorId,
    contacts: [
      {
        id: "cnt_rajesh_1",
        name: "Rajesh Kumar (Senior Manager)",
        phone: "+919811223344",
        email: "supply@sunriseagro.local",
        designation: "Senior Manager",
      },
    ],
    creditLimit: 300000,
  }, ownerToken);
  assert.ok(vendUpdateRes.success, "vendorsUpdate must succeed");
  console.log("✓ vendorsUpdate updated contacts and creditLimit");

  // Get vendor
  const vendGetRes = await callFunction("vendorsGet", {
    organizationId: orgId,
    vendorId,
  }, ownerToken);
  assert.equal(vendGetRes.vendorId, vendorId);
  assert.equal(vendGetRes.contacts[0].name, "Rajesh Kumar (Senior Manager)");
  assert.equal(vendGetRes.creditLimit, 300000);
  console.log("✓ vendorsGet retrieved updated vendor details");

  // Reject cross-tenant get
  await assertCallableError(
    callFunction("vendorsGet", {
      organizationId: otherOwner.organizationId,
      vendorId,
    }, otherOwner.idToken),
    ["permission-denied", "not-found"]
  );
  console.log("✓ vendorsGet rejected cross-tenant retrieval");

  // List vendors
  const vendListRes = await callFunction("vendorsList", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(Array.isArray(vendListRes.items));
  assert.ok(vendListRes.items.some(v => v.vendorId === vendorId));
  console.log(`✓ vendorsList returned ${vendListRes.items.length} vendors`);

  // ============================================================
  // 3. Payments Ledger: Inbound & Outbound, List
  // ============================================================
  console.log("\n[DOMAIN: PAYMENTS] Testing paymentsCreate (inbound & outbound), paymentsList...");

  // Inbound payment (collection from customer)
  const inboundPayRes = await callFunction("paymentsCreate", {
    organizationId: orgId,
    direction: "in",
    partyType: "customer",
    partyId: customerId,
    amount: 1500,
    method: "upi",
    notes: "Advance deposit for bulk orders",
  }, ownerToken);
  assert.ok(inboundPayRes.paymentId);
  assert.equal(inboundPayRes.direction, "in");
  assert.equal(inboundPayRes.amount, 1500);
  assert.ok(inboundPayRes.paymentNumber.startsWith("PAY-"));
  const inboundPayId = inboundPayRes.paymentId;
  console.log(`✓ Inbound payment created: ₹1500 via UPI (ID: ${inboundPayId}, Num: ${inboundPayRes.paymentNumber})`);

  // Outbound payment (disbursement to vendor)
  const outboundPayRes = await callFunction("paymentsCreate", {
    organizationId: orgId,
    direction: "out",
    partyType: "vendor",
    partyId: vendorId,
    amount: 5000,
    method: "bank_transfer",
    notes: "Vendor retainer payment",
  }, ownerToken);
  assert.ok(outboundPayRes.paymentId);
  assert.equal(outboundPayRes.direction, "out");
  assert.equal(outboundPayRes.amount, 5000);
  const outboundPayId = outboundPayRes.paymentId;
  console.log(`✓ Outbound payment created: ₹5000 via Bank Transfer (ID: ${outboundPayId}, Num: ${outboundPayRes.paymentNumber})`);

  // List payments
  const payListRes = await callFunction("paymentsList", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(Array.isArray(payListRes.items));
  assert.ok(payListRes.items.length >= 2);
  console.log(`✓ paymentsList returned ${payListRes.items.length} payments`);

  // List payments filtered by partyId
  const custPayListRes = await callFunction("paymentsList", {
    organizationId: orgId,
    partyId: customerId,
  }, ownerToken);
  assert.ok(Array.isArray(custPayListRes.items));
  assert.ok(custPayListRes.items.some(p => p.paymentId === inboundPayId));
  console.log(`✓ paymentsList filtered by partyId returned customer payment`);

  // ============================================================
  // 4. Ledger Reconciliation: reconcilePartyLedgers
  // ============================================================
  console.log("\n[DOMAIN: RECONCILIATION] Testing reconcilePartyLedgers...");

  // Customer reconciliation
  const custReconRes = await callFunction("reconcilePartyLedgers", {
    organizationId: orgId,
    partyType: "customer",
    partyId: customerId,
  }, ownerToken);
  assert.equal(custReconRes.organizationId, orgId);
  assert.equal(custReconRes.partyType, "customer");
  assert.ok(Array.isArray(custReconRes.items));
  const custItem = custReconRes.items.find(i => i.partyId === customerId);
  assert.ok(custItem, "Customer reconciliation entry must exist");
  assert.equal(custItem.recordedBalance, 0);
  console.log(`✓ reconcilePartyLedgers verified customer ledger (checked: ${custReconRes.checkedCount}, discrepancies: ${custReconRes.discrepancyCount})`);

  // Vendor reconciliation
  const vendReconRes = await callFunction("reconcilePartyLedgers", {
    organizationId: orgId,
    partyType: "vendor",
    partyId: vendorId,
  }, ownerToken);
  assert.equal(vendReconRes.organizationId, orgId);
  assert.equal(vendReconRes.partyType, "vendor");
  assert.ok(Array.isArray(vendReconRes.items));
  const vendItem = vendReconRes.items.find(i => i.partyId === vendorId);
  assert.ok(vendItem, "Vendor reconciliation entry must exist");
  console.log(`✓ reconcilePartyLedgers verified vendor ledger (checked: ${vendReconRes.checkedCount}, discrepancies: ${vendReconRes.discrepancyCount})`);

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 11 PARTIES & LEDGERS CALLABLES VERIFIED SUCCESSFULLY! ✓           ");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
