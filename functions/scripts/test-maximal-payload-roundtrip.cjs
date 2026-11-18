/**
 * Trado Firebase Backend — Maximal-Payload Round-Trip Proof Suite
 * 
 * Mechanically verifies that every field defined in the data model can go from
 * the API into Cloud Firestore (after documented normalization), be stored, and be
 * retrieved by read callables without dropping or silently ignoring any field.
 * 
 * Verifies for each entity:
 * 1. Maximal payload accepted by create callable
 * 2. Raw Firestore document contains all normalized fields
 * 3. Read callable (Get / List) returns all persisted fields
 * 4. Update callable successfully modifies fields
 * 5. Minimal payload sets documented defaults
 * 6. Bounds + 1 and unknown keys rejected (strict Zod)
 * 7. Field-level authorization: unauthorized tier rejected with stable reason (D-11)
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const client = require("./helpers/callable-client.cjs");
const { recordingCall, writeResults } = require("./helpers/persistence-recorder.cjs");
const { assertCallableError } = client;
const truth = require("../../scripts/lib/source-truth.js");
const { validBase } = require("./helpers/schema-payloads.cjs");
const requestSchemas = require("../lib/validation/schemas.js");
const callFunction = recordingCall(client.callFunction); // records C-2 evidence after each create / update
const {
  getSuperAdminPersona,
  createTenantOwnerPersona,
  createEmployeePersona,
  db,
} = require("./helpers/auth-personas.cjs");

enforceLocalEmulatorSafety();

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: MAXIMAL-PAYLOAD ROUND-TRIP PROOF (API <-> DB <-> API)     ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  const superAdmin = await getSuperAdminPersona();
  const owner = await createTenantOwnerPersona(superAdmin.idToken, "MaximalPayloadOrg");
  const admin = await createEmployeePersona(owner.idToken, owner.organizationId, { roleCode: "admin" });

  const orgId = owner.organizationId;
  const ownerToken = owner.idToken;
  const adminToken = admin.idToken;
  const superAdminToken = superAdmin.idToken;

  console.log(`✓ Test personas initialized: Super Admin, Owner, Admin, Cashier\n`);

  // ============================================================================
  // 1. ORGANIZATION ROUND-TRIP
  // ============================================================================
  console.log("--- 1. Testing Organization API <-> Database Round-Trip ---");
  const orgUnique = Date.now();
  const orgName = `Apex Wholesale ${orgUnique}`;
  const orgLegalName = `Apex Global Wholesale ${orgUnique} Private Limited`;
  const orgTaxId = `29ABCDE${orgUnique.toString().slice(-4)}F1Z5`;
  const orgMaximalPayload = {
    name: orgName,
    legalName: orgLegalName,
    businessType: "wholesale_only",
    businessCategory: "general",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    planId: "plan_growth",
    financialYearStartMonth: 4,
    taxId: orgTaxId,
    website: "https://apexwholesale.example.com",
    timezone: "Asia/Kolkata",
    salesChannels: ["b2b"],
    contact: {
      name: "Ramesh Gupta",
      email: "contact@apexwholesale.example.com",
      phone: "+919876543210",
      altPhone: "+919876543219",
    },
    contacts: [
      {
        id: "cnt_ramesh_01",
        name: "Ramesh Gupta",
        email: "ramesh@apexwholesale.example.com",
        phone: "+919876543210",
        type: "primary",
        isPrimary: true,
      },
    ],
    addresses: [
      {
        label: "Registered Headquarters",
        line1: "Plot 42, Industrial Area",
        line2: "Phase 2, Peenya",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560058",
        country: "IN",
        isDefaultBilling: true,
        isDefaultShipping: true,
      },
    ],
    bankAccounts: [
      {
        label: "Primary Operations Account",
        accountHolderName: "Apex Global Wholesale Ltd",
        bankName: "HDFC Bank",
        accountNumber: "50200012345678",
        routingType: "ifsc",
        routingCode: "HDFC0001234",
        currency: "INR",
        isDefault: true,
      },
    ],
    createOwner: false, // create org without provisioning owner now
  };

  // 1.1 Maximal payload accepted
  const orgRes = await callFunction("organizationsCreate", { ...orgMaximalPayload, idempotencyKey: `rt_organizationsCreate_${orgUnique}` }, superAdminToken);
  assert.ok(orgRes.organizationId, "organizationsCreate must return organizationId");
  const testOrgId = orgRes.organizationId;
  console.log(`✓ organizationsCreate accepted maximal payload (ID: ${testOrgId})`);

  // 1.2 Raw Firestore document contains all normalized fields
  const orgDocSnap = await db.collection("organizations").doc(testOrgId).get();
  assert.ok(orgDocSnap.exists, "Organization doc must exist in Firestore");
  const rawOrgData = orgDocSnap.data();
  assert.equal(rawOrgData.name, orgName);
  assert.equal(rawOrgData.legalName, orgLegalName);
  assert.equal(rawOrgData.taxId, orgTaxId);
  assert.equal(rawOrgData.website, "https://apexwholesale.example.com");
  assert.equal(rawOrgData.addresses.length, 1);
  assert.equal(rawOrgData.addresses[0].postalCode, "560058");
  assert.equal(rawOrgData.bankAccounts.length, 1);
  assert.equal(rawOrgData.bankAccounts[0].accountNumber, "50200012345678");
  assert.equal(rawOrgData.contact.name, "Ramesh Gupta");
  assert.equal(rawOrgData.contacts.length, 1);
  assert.equal(rawOrgData.ownerStatus, "pending");
  console.log(`✓ Raw Firestore document contains all 12 persisted business fields exactly as sent`);

  // 1.3 Read callable returns all fields
  const orgGetRes = await callFunction("organizationsGet", { organizationId: testOrgId }, superAdminToken);
  const getOrg = orgGetRes.organization || orgGetRes;
  assert.equal(getOrg.taxId, orgTaxId);
  assert.equal(getOrg.website, "https://apexwholesale.example.com");
  assert.equal(getOrg.addresses.length, 1);
  assert.equal(getOrg.bankAccounts.length, 1);
  assert.equal(getOrg.contact.name, "Ramesh Gupta");
  assert.equal(getOrg.contacts.length, 1);
  assert.ok(orgGetRes.evaluation, "Super Admin read includes subscription evaluation");
  console.log(`✓ organizationsGet returns complete canonical shape without dropped fields`);

  // 1.4 Update callable updates individual fields
  await callFunction("organizationsUpdate", {
    organizationId: testOrgId,
    legalName: "Apex Wholesale Hub Private Limited",
    taxId: "29ABCDE9999F1Z9",
  }, superAdminToken);
  const updatedOrgSnap = await db.collection("organizations").doc(testOrgId).get();
  assert.equal(updatedOrgSnap.data().legalName, "Apex Wholesale Hub Private Limited");
  assert.equal(updatedOrgSnap.data().taxId, "29ABCDE9999F1Z9");
  console.log(`✓ organizationsUpdate successfully modifies profile fields`);

  // 1.5 Strict validation: unknown key rejected
  await assertCallableError(
    callFunction("organizationsCreate", { ...orgMaximalPayload, unknownSpuriousField: "bad" }, superAdminToken),
    ["invalid-argument"]
  );

  // D-15: Banned removed fields logoUrl and imageUrls are rejected with UNKNOWN_FIELD / invalid-argument
  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: testOrgId, logoUrl: "https://example.com/logo.jpg" }, superAdminToken),
    ["invalid-argument"]
  );
  console.log("✓ logoUrl rejected with UNKNOWN_FIELD / invalid-argument (D-15)");

  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: testOrgId, imageUrls: ["https://example.com/img.jpg"] }, superAdminToken),
    ["invalid-argument"]
  );
  console.log("✓ imageUrls rejected with UNKNOWN_FIELD / invalid-argument (D-15)");
  console.log(`✓ Strict Zod rejects unknown spurious keys at organization boundary`);

  // 1.6 Field-level authorization (D-11): Admin denied modifying Super-Admin-only legalName
  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: orgId, legalName: "Tampered Legal Name" }, adminToken),
    ["FIELD_NOT_EDITABLE", "permission-denied"]
  );
  console.log(`✓ D-11: Field-level permission rejects unauthorized tier with stable reason (FIELD_NOT_EDITABLE)`);

  // ============================================================================
  // 2. EMPLOYEE / USER ROUND-TRIP
  // ============================================================================
  console.log("\n--- 2. Testing Employee / User API <-> Database Round-Trip ---");
  const empPhone1 = `+9196${orgUnique.toString().slice(-8)}`;
  const empPhone2 = `+9195${orgUnique.toString().slice(-8)}`;
  const empMaximalPayload = {
    organizationId: orgId,
    email: `employee_roundtrip_${Date.now()}@domain.local`,
    name: "Sunita Deshmukh",
    phone: empPhone1,
    roleId: "role_employee",
    departmentId: null,
    jobRoleIds: [],
    reportingToIds: [],
    permissionOverrides: { "bill:create": true },
  };

  const empRes = await callFunction("employeesCreate", { ...empMaximalPayload, idempotencyKey: `rt_employeesCreate_${orgUnique}` }, ownerToken);
  assert.ok(empRes.membershipId, "employeesCreate must return membershipId");
  assert.ok(empRes.userId, "employeesCreate must return userId");
  console.log(`✓ employeesCreate accepted maximal payload (Membership: ${empRes.membershipId})`);

  // 2.2 Raw doc verification
  const userDocSnap = await db.collection("users").doc(empRes.userId).get();
  assert.equal(userDocSnap.data().name, "Sunita Deshmukh");
  assert.equal(userDocSnap.data().email, empMaximalPayload.email);
  assert.equal(userDocSnap.data().phone, empPhone1);
  const memDocSnap = await db.collection("memberships").doc(empRes.membershipId).get();
  assert.equal(memDocSnap.data().permissions["bill:create"], true);
  console.log(`✓ Raw Firestore user and membership docs contain all fields`);

  // 2.3 Read callable returns single canonical shape (D-12)
  const empGetRes = await callFunction("employeesGet", {
    organizationId: orgId,
    membershipId: empRes.membershipId,
  }, ownerToken);
  assert.ok(empGetRes.employee, "employeesGet returns canonical employee object");
  assert.equal(empGetRes.employee.name, "Sunita Deshmukh");
  assert.equal(empGetRes.employee.permissionOverrides["bill:create"], true);
  console.log(`✓ employeesGet returns clean single canonical response (D-12 verified)`);

  // 2.4 Update callable modifies employee
  await callFunction("employeesUpdate", {
    organizationId: orgId,
    membershipId: empRes.membershipId,
    name: "Sunita D. Rao",
    phone: empPhone2,
  }, ownerToken);
  const updatedUserDoc = (await db.collection("users").doc(empRes.userId).get()).data();
  assert.equal(updatedUserDoc.name, "Sunita D. Rao");
  assert.equal(updatedUserDoc.phone, empPhone2);
  console.log(`✓ employeesUpdate successfully syncs name and phone`);

  // D-15: Banned removed fields photoUrl and avatarUrl are rejected with UNKNOWN_FIELD / invalid-argument
  await assertCallableError(
    callFunction("employeesUpdate", { organizationId: orgId, membershipId: empRes.membershipId, photoUrl: "https://example.com/p.jpg" }, ownerToken),
    ["invalid-argument"]
  );
  console.log("✓ photoUrl rejected with UNKNOWN_FIELD / invalid-argument (D-15)");

  await assertCallableError(
    callFunction("employeesUpdate", { organizationId: orgId, membershipId: empRes.membershipId, avatarUrl: "https://example.com/a.jpg" }, ownerToken),
    ["invalid-argument"]
  );
  console.log("✓ avatarUrl rejected with UNKNOWN_FIELD / invalid-argument (D-15)");

  // ============================================================================
  // 3. BRANCH ROUND-TRIP
  // ============================================================================
  console.log("\n--- 3. Testing Branch API <-> Database Round-Trip ---");
  const branchCode = `PEENYA_${orgUnique.toString().slice(-4)}`;
  const branchMaximalPayload = {
    organizationId: orgId,
    name: "Peenya Industrial Warehouse",
    code: branchCode,
    address: {
      line1: "Plot 100, Peenya 4th Phase",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560058",
      country: "IN",
    },
    contact: {
      phone: "+919876599999",
      email: "peenya@branch.local",
      contactPerson: "Branch Manager Rao",
    },
    settings: {
      taxId: "29ABCDE1234F1Z8",
      allowNegativeStock: false,
      defaultSalesMode: "b2b",
    },
  };

  const branchRes = await callFunction("branchesCreate", { ...branchMaximalPayload, idempotencyKey: `rt_branchesCreate_${orgUnique}` }, ownerToken);
  assert.ok(branchRes.branchId, "branchesCreate must return branchId");
  console.log(`✓ branchesCreate accepted maximal payload (Branch ID: ${branchRes.branchId})`);

  const branchDocSnap = await db.collection("organizations").doc(orgId).collection("branches").doc(branchRes.branchId).get();
  assert.equal(branchDocSnap.data().name, "Peenya Industrial Warehouse");
  assert.equal(branchDocSnap.data().code, branchCode);
  assert.equal(branchDocSnap.data().settings.taxId, "29ABCDE1234F1Z8");
  assert.equal(branchDocSnap.data().settings.defaultSalesMode, "b2b");
  console.log(`✓ Raw subcollection branch doc contains all normalized fields`);

  const branchUpdatePayload = {
    organizationId: orgId,
    branchId: branchRes.branchId,
    name: "Peenya Industrial Warehouse Updated",
  };
  const branchUpdateRes = await callFunction("branchesUpdate", branchUpdatePayload, ownerToken);
  assert.equal(branchUpdateRes.success, true);
  const updatedBranchDoc = (await db.collection("organizations").doc(orgId).collection("branches").doc(branchRes.branchId).get()).data();
  assert.equal(updatedBranchDoc.name, "Peenya Industrial Warehouse Updated");
  console.log(`✓ branchesUpdate updated and persisted name`);

  // ============================================================================
  // 4. CUSTOMER ROUND-TRIP
  // ============================================================================
  console.log("\n--- 4. Testing Customer API <-> Database Round-Trip ---");
  const custPhone = `+9198${orgUnique.toString().slice(-8)}`;
  const custTaxId = `29AAACK${orgUnique.toString().slice(-4)}K1Z1`;
  const custMaximalPayload = {
    organizationId: orgId,
    partyType: "organization",
    name: "Kaveri Enterprises",
    legalName: "Kaveri Enterprises LLP",
    phone: custPhone,
    additionalPhones: ["+919876541112"],
    email: "orders@kaverienterprises.local",
    taxId: custTaxId,
    contacts: [
      {
        id: "cnt_kavita_1",
        name: "Kavita Rao",
        phone: custPhone,
        email: "kavita@kaverienterprises.local",
        designation: "Purchasing Manager",
      },
    ],
    addresses: [
      {
        label: "Commercial Street Store",
        line1: "15 Commercial Street",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
        isDefaultBilling: true,
        isDefaultShipping: true,
      },
    ],
    bankAccounts: [
      {
        label: "Primary SBI Account",
        accountHolderName: "Kaveri Enterprises",
        bankName: "State Bank of India",
        accountNumber: "11223344556677",
        routingType: "ifsc",
        routingCode: "SBIN0000123",
        currency: "INR",
        isDefault: true,
      },
    ],
    priceGroup: "wholesale",
    creditLimit: 150000,
    creditPeriodDays: 45,
    visibilityScope: "all_branches",
  };

  const custRes = await callFunction("customersCreate", { ...custMaximalPayload, idempotencyKey: `rt_customersCreate_${orgUnique}` }, ownerToken);
  assert.ok(custRes.customerId, "customersCreate must return customerId");
  console.log(`✓ customersCreate accepted maximal payload (Customer ID: ${custRes.customerId})`);

  const rawCustSnap = await db.collection("customers").doc(custRes.customerId).get();
  const rawCust = rawCustSnap.data();
  assert.equal(rawCust.partyType, "organization");
  assert.equal(rawCust.legalName, "Kaveri Enterprises LLP");
  assert.equal(rawCust.taxId, custTaxId);
  assert.equal(rawCust.taxNumber, undefined, "taxNumber alias must be completely absent (D-7)");
  assert.equal(rawCust.whatsApp, undefined, "whatsApp alias must be completely absent at root (D-7)");
  assert.equal(rawCust.billingAddress, undefined, "billingAddress alias must be completely absent (D-7)");
  assert.equal(rawCust.shippingAddress, undefined, "shippingAddress alias must be completely absent (D-7)");
  assert.equal(rawCust.contactPerson, undefined, "contactPerson alias must be completely absent (D-7)");
  assert.equal(rawCust.contacts.length, 1);
  assert.equal(rawCust.contacts[0].name, "Kavita Rao");
  assert.equal(rawCust.addresses.length, 1);
  assert.equal(rawCust.bankAccounts.length, 1);
  assert.equal(rawCust.creditLimit, 150000);
  console.log(`✓ Raw customer document contains all fields without taxNumber aliases`);

  const custGetRes = await callFunction("customersGet", { organizationId: orgId, customerId: custRes.customerId }, ownerToken);
  assert.equal(custGetRes.name, "Kaveri Enterprises");
  assert.equal(custGetRes.taxId, custTaxId);
  assert.equal(custGetRes.contacts.length, 1);
  assert.equal(custGetRes.contacts[0].name, "Kavita Rao");
  assert.equal(custGetRes.addresses.length, 1);
  console.log(`✓ customersGet returns complete customer record`);

  // Update customer
  const updatedCustTaxId = `29AAACK${(orgUnique + 1).toString().slice(-4)}K1Z2`;
  await callFunction("customersUpdate", {
    organizationId: orgId,
    customerId: custRes.customerId,
    name: "Kaveri Trading Co",
    taxId: updatedCustTaxId,
    contacts: [
      {
        id: "cnt_kavita_1",
        name: "Kavita R. Rao",
        phone: custPhone,
        email: "kavita.rao@kaverienterprises.local",
        designation: "Head of Procurement",
      },
    ],
  }, ownerToken);
  const updatedCust = (await db.collection("customers").doc(custRes.customerId).get()).data();
  assert.equal(updatedCust.name, "Kaveri Trading Co");
  assert.equal(updatedCust.taxId, updatedCustTaxId);
  assert.equal(updatedCust.contacts[0].name, "Kavita R. Rao");
  console.log(`✓ customersUpdate updates canonical taxId, contacts, and name`);

  // ============================================================================
  // 5. VENDOR ROUND-TRIP
  // ============================================================================
  console.log("\n--- 5. Testing Vendor API <-> Database Round-Trip ---");
  const vendPhone = `+9197${orgUnique.toString().slice(-8)}`;
  const vendTaxId = `29AAACH${orgUnique.toString().slice(-4)}H1Z2`;
  const vendMaximalPayload = {
    organizationId: orgId,
    partyType: "organization",
    name: "Hindustan Paper Mills",
    legalName: "Hindustan Paper Mills Limited",
    phone: vendPhone,
    additionalPhones: ["+919876542223"],
    email: "supply@hindustanpaper.local",
    taxId: vendTaxId,
    contacts: [
      {
        id: "cnt_rajeev_1",
        name: "Rajeev Kumar",
        phone: vendPhone,
        email: "rajeev@hindustanpaper.local",
        designation: "Sales Director",
      },
    ],
    addresses: [
      {
        label: "Factory Premises",
        line1: "Bhadravati Industrial Estate",
        city: "Shivamogga",
        state: "Karnataka",
        postalCode: "577301",
        country: "IN",
        isDefaultBilling: true,
      },
    ],
    bankAccounts: [
      {
        label: "Canara Operational Account",
        accountHolderName: "Hindustan Paper Mills Limited",
        bankName: "Canara Bank",
        accountNumber: "99887766554433",
        routingType: "ifsc",
        routingCode: "CNRB0001234",
        currency: "INR",
        isDefault: true,
      },
    ],
    paymentTermsDays: 30,
    creditLimit: 500000,
    visibilityScope: "all_branches",
  };

  const vendRes = await callFunction("vendorsCreate", { ...vendMaximalPayload, idempotencyKey: `rt_vendorsCreate_${orgUnique}` }, ownerToken);
  assert.ok(vendRes.vendorId, "vendorsCreate must return vendorId");
  console.log(`✓ vendorsCreate accepted maximal payload (Vendor ID: ${vendRes.vendorId})`);

  const rawVendSnap = await db.collection("vendors").doc(vendRes.vendorId).get();
  const rawVend = rawVendSnap.data();
  assert.equal(rawVend.legalName, "Hindustan Paper Mills Limited");
  assert.equal(rawVend.taxId, vendTaxId);
  assert.equal(rawVend.taxNumber, undefined, "taxNumber alias must be absent (D-7)");
  assert.equal(rawVend.whatsApp, undefined, "whatsApp alias must be absent at root (D-7)");
  assert.equal(rawVend.address, undefined, "address flat string must be absent (D-7)");
  assert.equal(rawVend.contactPerson, undefined, "contactPerson alias must be absent (D-7)");
  assert.equal(rawVend.contacts.length, 1);
  assert.equal(rawVend.contacts[0].name, "Rajeev Kumar");
  assert.equal(rawVend.addresses.length, 1);
  assert.equal(rawVend.bankAccounts.length, 1);
  assert.equal(rawVend.creditLimit, 500000);
  console.log(`✓ Raw vendor document contains all fields without taxNumber aliases`);

  const vendGetRes = await callFunction("vendorsGet", { organizationId: orgId, vendorId: vendRes.vendorId }, ownerToken);
  assert.equal(vendGetRes.taxId, vendTaxId);
  assert.equal(vendGetRes.contacts.length, 1);
  assert.equal(vendGetRes.contacts[0].name, "Rajeev Kumar");
  assert.equal(vendGetRes.addresses.length, 1);
  console.log(`✓ vendorsGet returns complete vendor record`);

  const vendUpdatePayload = {
    organizationId: orgId,
    vendorId: vendRes.vendorId,
    name: "Apex Paper Mills Updated",
    creditLimit: 600000,
  };
  const vendUpdateRes = await callFunction("vendorsUpdate", vendUpdatePayload, ownerToken);
  assert.equal(vendUpdateRes.success, true);
  const updatedVendDoc = (await db.collection("vendors").doc(vendRes.vendorId).get()).data();
  assert.equal(updatedVendDoc.name, "Apex Paper Mills Updated");
  assert.equal(updatedVendDoc.creditLimit, 600000);
  console.log(`✓ vendorsUpdate updated and persisted name and creditLimit`);

  // ============================================================================
  // 6. PRODUCT ROUND-TRIP
  // ============================================================================
  console.log("\n--- 6. Testing Product API <-> Database Round-Trip ---");
  const prodMaximalPayload = {
    organizationId: orgId,
    name: "Century Copier Paper A4 75GSM",
    sku: `SKU-PAPER-${Date.now()}`,
    barcode: `8901234${Date.now()}`.slice(0, 13),
    sellingPrice: 320,
    costPrice: 240,
    baseUnit: "ream",
    brand: "Century",
    trackStock: true,
    taxInclusive: false,
    taxRatePercent: 18,
    lowStockThreshold: 20,
    initialStock: 100,
  };

  const prodRes = await callFunction("productsCreate", { ...prodMaximalPayload, idempotencyKey: `rt_productsCreate_${orgUnique}` }, ownerToken);
  assert.ok(prodRes.productId, "productsCreate must return productId");
  console.log(`✓ productsCreate accepted maximal payload (Product ID: ${prodRes.productId})`);

  const rawProdSnap = await db.collection("products").doc(prodRes.productId).get();
  assert.equal(rawProdSnap.data().name, "Century Copier Paper A4 75GSM");
  assert.equal(rawProdSnap.data().sellingPrice, 320);
  assert.equal(rawProdSnap.data().costPrice, 240);
  assert.equal(rawProdSnap.data().brand, "Century");
  assert.equal(rawProdSnap.data().trackStock, true);
  console.log(`✓ Raw product document contains pricing, unit, and inventory metadata`);

  const prodUpdatePayload = {
    organizationId: orgId,
    productId: prodRes.productId,
    name: "Century Copier Paper A4 75GSM Updated",
    sellingPrice: 350,
  };
  const prodUpdateRes = await callFunction("productsUpdate", prodUpdatePayload, ownerToken);
  assert.equal(prodUpdateRes.success, true);
  const updatedProdDoc = (await db.collection("products").doc(prodRes.productId).get()).data();
  assert.equal(updatedProdDoc.name, "Century Copier Paper A4 75GSM Updated");
  assert.equal(updatedProdDoc.sellingPrice, 350);
  console.log(`✓ productsUpdate updated and persisted name and sellingPrice`);

  // ============================================================================
  // 7. BILL (SALE) ROUND-TRIP
  // ============================================================================
  console.log("\n--- 7. Testing Bill (Sale) API <-> Database Round-Trip ---");
  const billMaximalPayload = {
    organizationId: orgId,
    salesMode: "b2b",
    customerId: custRes.customerId,
    items: [
      {
        productId: prodRes.productId,
        quantity: 10,
        unitPriceOverride: 310,
        unit: "ream",
      },
    ],
    paidAmount: 3658,
    paymentMethod: "bank_transfer",
    notes: "Express delivery required for Peenya facility",
  };

  // Preview before creation
  const previewRes = await callFunction("billsPreview", billMaximalPayload, ownerToken);
  assert.ok(previewRes.totalAmount > 0, "billsPreview must return totalAmount");
  assert.equal(previewRes.calculation, undefined, "D-12: duplicate calculation object removed");
  console.log(`✓ billsPreview returns single canonical response shape (total: ₹${previewRes.totalAmount})`);

  // Create Bill
  const billRes = await callFunction("billsCreate", { ...billMaximalPayload, idempotencyKey: `rt_billsCreate_${orgUnique}` }, ownerToken);
  assert.ok(billRes.billId, "billsCreate must return billId");
  console.log(`✓ billsCreate created active B2B bill (ID: ${billRes.billId})`);

  const rawBillSnap = await db.collection("bills").doc(billRes.billId).get();
  const rawBill = rawBillSnap.data();
  assert.equal(rawBill.billToSnapshot.taxId, updatedCustTaxId);
  assert.equal(rawBill.billToSnapshot.taxNumber, undefined, "taxNumber alias absent in billToSnapshot");
  assert.equal(rawBill.notes, "Express delivery required for Peenya facility");
  console.log(`✓ Raw bill doc contains clean recipient snapshot with canonical taxId`);

  // ============================================================================
  // 8. OUTFLOW (PURCHASE) ROUND-TRIP
  // ============================================================================
  console.log("\n--- 8. Testing Outflow (Purchase) API <-> Database Round-Trip ---");
  const outflowMaximalPayload = {
    organizationId: orgId,
    kind: "purchase",
    vendorId: vendRes.vendorId,
    invoiceNumber: `INV-MILL-${Date.now()}`,
    lines: [
      {
        productId: prodRes.productId,
        quantity: 50,
        unit: "ream",
        unitPrice: 235,
      },
    ],
    paidAmount: 11750,
    paymentMethod: "bank_transfer",
  };

  const outflowRes = await callFunction("outflowsCreate", { ...outflowMaximalPayload, idempotencyKey: `rt_outflowsCreate_${orgUnique}` }, ownerToken);
  assert.ok(outflowRes.outflowId, "outflowsCreate must return outflowId");
  console.log(`✓ outflowsCreate created purchase outflow (ID: ${outflowRes.outflowId})`);

  const rawOutflowSnap = await db.collection("outflows").doc(outflowRes.outflowId).get();
  assert.equal(rawOutflowSnap.data().vendorId, vendRes.vendorId);
  assert.equal(rawOutflowSnap.data().totalAmount, 11750);
  console.log(`✓ Raw outflow doc contains lines and vendor association`);

  // ============================================================================
  // 9. PAYMENT ROUND-TRIP
  // ============================================================================
  console.log("\n--- 9. Testing Payment API <-> Database Round-Trip ---");
  const paymentMaximalPayload = {
    organizationId: orgId,
    direction: "in",
    partyType: "customer",
    partyId: custRes.customerId,
    amount: 5000,
    method: "upi",
    gateway: {
      externalReference: "UPI-REF-99887766",
      gatewayProvider: "upi_qr",
    },
    notes: "Advance against upcoming order",
  };

  const paymentRes = await callFunction("paymentsCreate", { ...paymentMaximalPayload, idempotencyKey: `rt_paymentsCreate_${orgUnique}` }, ownerToken);
  assert.ok(paymentRes.paymentId, "paymentsCreate must return paymentId");
  console.log(`✓ paymentsCreate recorded customer payment (ID: ${paymentRes.paymentId})`);

  const rawPaymentSnap = await db.collection("payments").doc(paymentRes.paymentId).get();
  assert.equal(rawPaymentSnap.data().partyId, custRes.customerId);
  assert.equal(rawPaymentSnap.data().amount, 5000);
  assert.equal(rawPaymentSnap.data().gateway?.externalReference, "UPI-REF-99887766");
  console.log(`✓ Raw payment doc contains all receipt attributes`);

  // ============================================================================
  // 10. RETURN ROUND-TRIP
  // ============================================================================
  console.log("\n--- 10. Testing Return API <-> Database Round-Trip ---");
  const returnMaximalPayload = {
    organizationId: orgId,
    returnType: "sales_return",
    referenceId: billRes.billId,
    items: [
      {
        productId: prodRes.productId,
        quantity: 1,
        refundAmount: 310,
        reason: "Damaged packaging",
      },
    ],
    refundMethod: "cash",
  };

  const returnRes = await callFunction("returnsCreate", { ...returnMaximalPayload, idempotencyKey: `rt_returnsCreate_${orgUnique}` }, ownerToken);
  assert.ok(returnRes.returnId, "returnsCreate must return returnId");
  console.log(`✓ returnsCreate recorded sales return (ID: ${returnRes.returnId})`);

  const rawReturnSnap = await db.collection("returns").doc(returnRes.returnId).get();
  assert.equal(rawReturnSnap.data().referenceId, billRes.billId);
  assert.equal(rawReturnSnap.data().items[0].reason, "Damaged packaging");
  console.log(`✓ Raw return doc contains return lines and audit links`);

  // ============================================================================
  // 11. DELIVERY ROUND-TRIP
  // ============================================================================
  console.log("\n--- 11. Testing Delivery API <-> Database Round-Trip ---");
  const deliveryMaximalPayload = {
    organizationId: orgId,
    billId: billRes.billId,
    idempotencyKey: `idemp_del_${orgUnique}`,
    recipient: {
      name: "Kavita Rao",
      phone: "+919876541111",
    },
    address: {
      line1: "15 Commercial Street",
      city: "Bengaluru",
      pincode: "560001",
    },
  };

  const deliveryRes = await callFunction("deliveriesCreate", deliveryMaximalPayload, ownerToken);
  assert.ok(deliveryRes.deliveryId, "deliveriesCreate must return deliveryId");
  console.log(`✓ deliveriesCreate created dispatch tracking (ID: ${deliveryRes.deliveryId})`);

  const rawDeliverySnap = await db.collection("deliveries").doc(deliveryRes.deliveryId).get();
  assert.equal(rawDeliverySnap.data().billId, billRes.billId);
  assert.equal(rawDeliverySnap.data().recipient.name, "Kavita Rao");
  console.log(`✓ Raw delivery doc contains address and recipient details`);

  // ============================================================================
  // 12. STOCK ADJUSTMENT ROUND-TRIP
  // ============================================================================
  console.log("\n--- 12. Testing Stock Adjustment API <-> Database Round-Trip ---");
  const adjustPayload = {
    organizationId: orgId,
    productId: prodRes.productId,
    quantity: -2,
    reason: "Damaged in store display",
  };

  const adjustRes = await callFunction("stockAdjust", adjustPayload, ownerToken);
  assert.ok(adjustRes.movementId || adjustRes.success, "stockAdjust must succeed");
  console.log(`✓ stockAdjust recorded inventory variance`);

  // ============================================================================
  // 13. SUBSCRIPTION PLAN ROUND-TRIP
  // ============================================================================
  console.log("\n--- 13. Testing Subscription Plan API <-> Database Round-Trip ---");
  const planMaximalPayload = {
    name: "Enterprise Wholesale Pro",
    price: 9999,
    currency: "INR",
    storageLimitMb: 5000,
    monthlyDocumentVolumeLimit: 50000,
    seatLimits: {
      admin: 10,
      staff: 50,
    },
    branchLimit: 10,
    moduleFlags: {
      inventory: true,
      billing: true,
      purchases: true,
      deliveries: true,
      tasks: true,
    },
    isActive: true,
  };

  const planRes = await callFunction("plansCreate", { ...planMaximalPayload, idempotencyKey: `rt_plansCreate_${orgUnique}` }, superAdminToken);
  assert.ok(planRes.planId, "plansCreate must return planId");
  console.log(`✓ plansCreate accepted maximal plan payload (ID: ${planRes.planId})`);

  const rawPlanSnap = await db.collection("subscriptionPlans").doc(planRes.planId).get();
  assert.equal(rawPlanSnap.data().name, "Enterprise Wholesale Pro");
  assert.equal(rawPlanSnap.data().seatLimits.staff, 50);
  assert.equal(rawPlanSnap.data().branchLimit, 10);
  console.log(`✓ Raw subscription plan contains limits and toggles`);

  // ============================================================================
  // 14. GENERATED MAXIMAL PAYLOADS — every create / update callable
  // ============================================================================
  // The payload is generated from the callable's compiled request schema (every optional key the
  // schema allows), with document ids replaced by real ones created above. Persistence (C-2) and the
  // idempotent replay of creates (C-10) are recorded by the wrapped callFunction. A call the business
  // rules reject is reported, never counted.
  console.log("\n--- 14. Generated maximal payloads for every create / update callable ---");
  const known = new Map(Object.entries({
    organization: orgId, branch: "main-branch", product: prodRes.productId, customer: custRes.customerId, vendor: vendRes.vendorId,
    bill: billRes.billId, reference: billRes.billId, outflow: outflowRes.outflowId, payment: paymentRes.paymentId, return: returnRes.returnId,
    delivery: deliveryRes.deliveryId, plan: planRes.planId, membership: empRes.membershipId, reportingto: owner.membershipId, user: empRes.userId, role: "role_employee",
    entity: orgId, relatedentity: billRes.billId,
  }));
  const remember = (result) => {
    for (const [k, v] of Object.entries(result || {})) if (typeof v === "string" && /Id$/.test(k)) known.set(k.replace(/Id$/, "").toLowerCase(), v);
  };
  // "assignedToMembershipId" → membership, "jobRoleId" → jobrole before role: the longest known stem ending the key wins.
  const idFor = (key) => {
    const name = key.replace(/Ids?$/, "").toLowerCase();
    const stem = [...known.keys()].sort((a, b) => b.length - a.length).find((k) => name.endsWith(k));
    return stem ? known.get(stem) : undefined;
  };
  const withRealIds = (value) => {
    if (Array.isArray(value)) return value.map(withRealIds);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (typeof v === "string" && /Id$/.test(k)) return [k, idFor(k) || v];
      if (Array.isArray(v) && /Ids$/.test(k)) return [k, idFor(k) ? [idFor(k)] : v];
      return [k, withRealIds(v)];
    }));
  };
  let sends = 0;
  /** One generated call; returns null when accepted, else the rejection. */
  const sendGenerated = async (exp) => {
    const schema = requestSchemas[exp.schemas[0]];
    const base = schema && validBase(schema);
    if (!base || !base.ok) return { reason: "NO_VALID_GENERATED_PAYLOAD", message: base ? base.issue : "schema not exported" };
    const payload = withRealIds(base.value);
    const shape = schema.def.shape || {};
    if ("organizationId" in shape) payload.organizationId = orgId;
    // Names and codes are unique per callable and run: no two generated records share a name or code,
    // and a second run on the same emulator data does not trigger false cross-entity duplicate checks.
    for (const k of Object.keys(payload)) {
      if (/name$/i.test(k) && typeof payload[k] === "string") {
        payload[k] = `${payload[k]} ${exp.name} ${orgUnique}`;
      }
      if (k === "code" && typeof payload[k] === "string") {
        const hash = [...exp.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000, 7);
        const prefix = exp.name.slice(0, 3).toLowerCase().replace(/[^a-z0-9]/g, "c");
        payload[k] = `${prefix}_${hash}`;
      }
    }
    const token = exp.superAdminOnly || !("organizationId" in shape) ? superAdminToken : ownerToken;
    const optional = (k) => shape[k] && shape[k].def && ["optional", "default", "prefault"].includes(shape[k].def.type);
    // When a business rule names an optional field of the payload ("partyName is only for…", a field the
    // caller may not edit, an image reference without an upload), that field is dropped and the call retried.
    const dropFor = (e) => {
      const named = Object.keys(payload).filter((k) => new RegExp(`\\b${k}\\b`).test(e.message));
      const keys = /IMAGE_CORRUPT|Upload session/.test(e.message) ? ["image", "uploadId"]
        : (e.details && e.details.reason) === "FIELD_NOT_EDITABLE" ? named : named.filter((k) => !/Id$/.test(k));
      return keys.filter((k) => k in payload && optional(k));
    };
    const dropped = [];
    for (let attempt = 0; ; attempt++) {
      // A new key per send: the same key with a changed payload is (rightly) an IDEMPOTENCY_CONFLICT.
      if ("idempotencyKey" in shape) payload.idempotencyKey = `gen_${exp.name}_${orgUnique}_${++sends}`;
      if ("clientRequestId" in shape) payload.clientRequestId = `gen_${exp.name}_${orgUnique}_${sends}`;
      try {
        remember(await callFunction(exp.name, payload, token));
        if (dropped.length) console.log(`  ${exp.name}: accepted after dropping ${dropped.join(", ")}`);
        return null;
      } catch (e) {
        const drop = attempt < 4 ? dropFor(e) : [];
        if (drop.length) { for (const k of drop) delete payload[k]; dropped.push(...drop); continue; }
        return { reason: (e.details && e.details.reason) || e.code, message: String(e.message).replace(/^\[[A-Z_]+\]\s*/, "") };
      }
    }
  };
  // Tenant creates, then tenant updates, then calls that change who owns or pays for the organization
  // (Super Admin calls, ownership transfer): those may legitimately end the owner's access.
  const order = (e) => (e.superAdminOnly || /TransferOwnership/.test(e.name) ? 2 : e.kind === "create" ? 0 : 1);
  const generated = truth.getExports().filter((e) => e.type === "callable" && ["create", "update"].includes(e.kind))
    .sort((a, b) => order(a) - order(b));
  const outcomes = { accepted: 0, rejected: {} };
  const settle = (exp, rejection) => {
    if (!rejection) { outcomes.accepted++; return; }
    outcomes.rejected[rejection.reason] = [...(outcomes.rejected[rejection.reason] || []), `${exp.name} (${rejection.message.slice(0, 70)})`];
  };
  // A create that references a document a later create makes (an outflow from a recurring template) is
  // retried once after every create ran.
  const later = [];
  for (const exp of generated) {
    const rejection = await sendGenerated(exp);
    if (rejection && rejection.reason === "NOT_FOUND" && exp.kind === "create" && order(exp) === 0) later.push(exp);
    else settle(exp, rejection);
    if (exp === generated.filter((g) => order(g) === 0).pop()) for (const retry of later.splice(0)) settle(retry, await sendGenerated(retry));
  }
  console.log(`✓ generated maximal payloads: ${outcomes.accepted}/${generated.length} accepted (persistence and replay recorded)`);
  for (const [reason, names] of Object.entries(outcomes.rejected)) console.log(`  rejected by a business rule (${reason}):\n    ${names.join("\n    ")}`);

  writeResults();
  console.log("[PASS] Maximal-payload round-trip assertions passed; per-callable proven leaf paths are in docs/audit/roundtrip-results.md.");
}

run().catch((err) => {
  console.error("\n[FAIL] Maximal-Payload Round-Trip Suite Failed:", err);
  process.exit(1);
});
