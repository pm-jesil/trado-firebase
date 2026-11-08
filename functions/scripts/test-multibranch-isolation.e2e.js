/**
 * Trado Firebase Backend ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 15-Scenario Branch-Aware Deep E2E Suite
 * 
 * Matrix of 15 Scenarios per Section 13:
 * - Scenario 1: Multi-Org Setup (Org A with A1/A2, Org B with B1)
 * - Scenario 2: Context Switching (Atomically updates custom claim & membership)
 * - Scenario 3: Cross-Tenant Isolation (Denied access to Org B from Org A token)
 * - Scenario 4: Customer Branch-Only Visibility (Visible at A1, hidden at A2)
 * - Scenario 5: Customer Selected-Branches Sharing (Share with A2, verify access)
 * - Scenario 6: Customer Visibility Revocation (Unshare from A2, verify denied)
 * - Scenario 7: Vendor Branch Visibility (branch_only -> all_branches transition)
 * - Scenario 8: Product Catalog Sharing vs Stock Isolation (Shared catalog, isolated stock)
 * - Scenario 9: Purchase at Branch A1 (Only A1 stock increments)
 * - Scenario 10: Purchase at Branch A2 (Only A2 stock increments, A1 untouched)
 * - Scenario 11: Sale at Branch A1 (Decrements only A1, A2 untouched)
 * - Scenario 12: Sales Return at Branch A1 (Restocks only A1, A2 untouched)
 * - Scenario 13: Delivery Dispatch (Attributed to originating branch)
 * - Scenario 14: Payment Ledger Attribution (Attributed to originating branch)
 * - Scenario 15: Full Reconciliation (0 discrepancies across stock and party ledgers)
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import assert from "node:assert/strict";

const PROJECT_ID = "trado-x";
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const FUNCTIONS_HOST = "http://127.0.0.1:5001";

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();
const auth = getAuth();

async function getIdToken(email, password) {
  const url = `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Auth signIn failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function invokeCallable(functionName, payload, idToken = null) {
  const url = `${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1/${functionName}`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: payload }),
  });

  const responseJson = await res.json();
  return {
    status: res.status,
    ok: res.ok,
    data: responseJson.result,
    error: responseJson.error,
  };
}

async function runBranchDeepE2ESuite() {
  console.log("================================================================================");
  console.log("  TRADO FIREBASE BACKEND ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 15-SCENARIO BRANCH-AWARE DEEP E2E TEST SUITE        ");
  console.log("================================================================================\n");

  const runId = Date.now();
  let passed = 0;
  let failed = 0;

  async function step(num, title, fn) {
    process.stdout.write(`Scenario ${num.toString().padStart(2, "0")}: ${title}... `);
    try {
      await fn();
      console.log("PASSED ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      passed++;
    } catch (err) {
      console.log(`FAILED ÃƒÂ¢Ã…â€œÃ¢â‚¬â€\n   Error: ${err.message}`);
      if (err.stack) console.log(`   ${err.stack.split("\n").slice(1, 4).join("\n   ")}`);
      failed++;
    }
  }

  // Pre-seed test plans
  await db.collection("subscriptionPlans").doc("plan_enterprise_test").set({
    name: "Enterprise Multi-Branch Plan",
    price: 9999,
    currency: "INR",
    storageLimitMb: 10240,
    monthlyDocumentVolumeLimit: 50000,
    branchLimit: 10,
    seatLimits: { admin: 10, staff: 50 },
    moduleFlags: { billing: true, inventory: true, purchases: true, expenses: true, delivery: true, staff: true },
    isActive: true,
  });

  await db.collection("subscriptionPlans").doc("plan_starter_test").set({
    name: "Starter Single-Branch Plan",
    price: 1999,
    currency: "INR",
    storageLimitMb: 1024,
    monthlyDocumentVolumeLimit: 5000,
    branchLimit: 1,
    seatLimits: { admin: 1, staff: 5 },
    moduleFlags: { billing: true, inventory: true, purchases: true, expenses: true, delivery: true, staff: true },
    isActive: true,
  });

  // Canonical system roles. Suites must never overwrite shared system roles/plans.
  await (await import("../lib/scripts/seed-emulator.js")).seedReferenceData(db);

  // Pre-seed Super Admin
  const superAdminEmail = `superadmin_${runId}@trado.local`;
  const superAdminPassword = "SuperAdminPassword123!";
  const superAdminRecord = await auth.createUser({
    email: superAdminEmail,
    password: superAdminPassword,
    displayName: "Super Admin Auditor",
  });
  await auth.setCustomUserClaims(superAdminRecord.uid, { isSuperAdmin: true });
  await db.collection("users").doc(superAdminRecord.uid).set({
    name: "Super Admin Auditor",
    email: superAdminEmail,
    accountType: "admin",
    isActive: true,
    createdAt: new Date().toISOString(),
  });
  const superAdminToken = await getIdToken(superAdminEmail, superAdminPassword);

  // Variables populated across scenarios
  let orgAId = null;
  let ownerAUid = null;
  let ownerAToken = null;
  let branchA1Id = "main-branch";
  let branchA2Id = null;

  let orgBId = null;
  let ownerBUid = null;
  let ownerBToken = null;

  let customer1Id = null;
  let vendor1Id = null;
  let product1Id = null;
  let bill1Id = null;

  // -------------------------------------------------------------------------
  // Scenario 1: Multi-Org Setup
  // -------------------------------------------------------------------------
  await step(1, "Multi-Organization & Branch Topology Setup", async () => {
    // 1. Provision Org A
    const ownerAEmail = `owner_a_${runId}@trado.local`;
    const resA = await invokeCallable("organizationsCreate", {
      name: `Org A Enterprise Wholesale ${runId}`,
      businessType: "wholesale_retail",
      businessCategory: "general",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_enterprise_test",
      ownerEmail: ownerAEmail,
      ownerName: "Alice Owner A",
      initialPassword: "OwnerPassword123!",
      defaultBranchName: "Main Branch Alpha",
      defaultBranchCode: "MAIN",
      idempotencyKey: `org_a_${runId}`,
    }, superAdminToken);

    assert.equal(resA.ok, true, `Org A creation failed: ${JSON.stringify(resA.error)}`);
    orgAId = resA.data.organizationId;
    ownerAUid = resA.data.ownerUserId;
    ownerAToken = await getIdToken(ownerAEmail, "OwnerPassword123!");

    // Verify Org A default branch
    const b1Snap = await db.collection("organizations").doc(orgAId).collection("branches").doc(branchA1Id).get();
    assert.equal(b1Snap.exists, true);
    assert.equal(b1Snap.data().isDefault, true);
    assert.equal(b1Snap.data().code, "MAIN");

    // 2. Add Branch A2 to Org A
    const resA2 = await invokeCallable("branchesCreate", {
      organizationId: orgAId,
      name: "Kochi Marine Drive",
      code: "KOC01",
      address: {
        line1: "Marine Drive Promenade",
        city: "Kochi",
        state: "Kerala",
        postalCode: "682031",
        country: "IN",
      },
    }, ownerAToken);

    assert.equal(resA2.ok, true, `Branch A2 creation failed: ${JSON.stringify(resA2.error)}`);
    branchA2Id = resA2.data.branchId;

    const orgASnap = await db.collection("organizations").doc(orgAId).get();
    assert.equal(orgASnap.data().branchCount, 2, "Org A must have exactly 2 branches");

    // 3. Provision Org B
    const ownerBEmail = `owner_b_${runId}@trado.local`;
    const resB = await invokeCallable("organizationsCreate", {
      name: `Org B Single Branch Store ${runId}`,
      businessType: "retail_only",
      businessCategory: "general",
      country: "IN",
      currency: "INR",
      taxRegimeCode: "IN_GST",
      planId: "plan_starter_test",
      ownerEmail: ownerBEmail,
      ownerName: "Bob Owner B",
      initialPassword: "OwnerPassword123!",
      defaultBranchName: "Main Branch Beta",
      defaultBranchCode: "MAIN",
      idempotencyKey: `org_b_${runId}`,
    }, superAdminToken);

    assert.equal(resB.ok, true, `Org B creation failed: ${JSON.stringify(resB.error)}`);
    orgBId = resB.data.organizationId;
    ownerBUid = resB.data.ownerUserId;
    ownerBToken = await getIdToken(ownerBEmail, "OwnerPassword123!");
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Context Switching
  // -------------------------------------------------------------------------
  await step(2, "Atomic Operating Branch Context Switching", async () => {
    // Switch Owner A to Branch A2
    const res = await invokeCallable("branchContextSwitch", {
      targetBranchId: branchA2Id,
    }, ownerAToken);

    assert.equal(res.ok, true, `branchContextSwitch failed: ${JSON.stringify(res.error)}`);
    assert.equal(res.data.primaryBranchId, branchA2Id);

    // Verify Auth user claim
    const claims = (await auth.getUser(ownerAUid)).customClaims;
    assert.equal(claims.primaryBranchId, branchA2Id);

    // Verify Firestore membership record
    const memDoc = (await db.collection("memberships").doc(`${ownerAUid}_${orgAId}`).get()).data();
    assert.equal(memDoc.primaryBranchId, branchA2Id);

    // Switch back to Branch A1
    const resBack = await invokeCallable("branchContextSwitch", {
      targetBranchId: branchA1Id,
    }, ownerAToken);
    assert.equal(resBack.ok, true);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Cross-Tenant Isolation
  // -------------------------------------------------------------------------
  await step(3, "Cross-Tenant Boundary Enforcement", async () => {
    // Owner A tries to access Org B
    const badList = await invokeCallable("productsList", {
      organizationId: orgBId,
    }, ownerAToken);
    assert.equal(badList.ok, false, "Cross-tenant list must be rejected");

    // Owner A tries to switch context to Org B's branch
    const badSwitch = await invokeCallable("branchContextSwitch", {
      targetBranchId: "main-branch",
    }, ownerAToken);
    // Since Owner A belongs to Org A, this switches inside Org A, not Org B.
    // If Owner A attempts to target Org B directly in context:
    const badOrgGet = await invokeCallable("customersList", {
      organizationId: orgBId,
      branchId: "main-branch",
    }, ownerAToken);
    assert.equal(badOrgGet.ok, false, "Cross-tenant access must be denied");
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Customer Branch-Only Visibility
  // -------------------------------------------------------------------------
  await step(4, "Customer Visibility ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Branch-Only Isolation", async () => {
    const custRes = await invokeCallable("customersCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      name: "Alpha Retail Walk-in Customer",
      mobile: "9876543201",
      visibilityScope: "branch_only",
      idempotencyKey: `cust_b1_${runId}`,
    }, ownerAToken);

    assert.equal(custRes.ok, true, `Customer create failed: ${JSON.stringify(custRes.error)}`);
    customer1Id = custRes.data.customerId;

    // Query from Branch A1 -> must be visible
    const listA1 = await invokeCallable("customersList", {
      organizationId: orgAId,
      branchId: branchA1Id,
    }, ownerAToken);
    assert.equal(listA1.ok, true);
    const foundInA1 = listA1.data.items.some((c) => c.customerId === customer1Id);
    assert.equal(foundInA1, true, "Customer must be visible in originating Branch A1");

    // Query from Branch A2 -> must be hidden
    const listA2 = await invokeCallable("customersList", {
      organizationId: orgAId,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(listA2.ok, true);
    const foundInA2 = listA2.data.items.some((c) => c.customerId === customer1Id);
    assert.equal(foundInA2, false, "Branch-only customer must be HIDDEN in Branch A2");

    // Direct get from Branch A2 -> must be denied
    const getA2 = await invokeCallable("customersGet", {
      organizationId: orgAId,
      customerId: customer1Id,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(getA2.ok, false, "Direct customersGet from non-assigned branch must fail");
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Customer Selected-Branches Sharing
  // -------------------------------------------------------------------------
  await step(5, "Customer Visibility ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Selected Branches Sharing", async () => {
    const updateRes = await invokeCallable("customersUpdate", {
      organizationId: orgAId,
      customerId: customer1Id,
      visibilityScope: "selected_branches",
      sharedForBranchIds: [branchA1Id, branchA2Id],
    }, ownerAToken);

    assert.equal(updateRes.ok, true, `customersUpdate failed: ${JSON.stringify(updateRes.error)}`);

    // Query from Branch A2 -> must NOW be visible
    const listA2 = await invokeCallable("customersList", {
      organizationId: orgAId,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(listA2.ok, true);
    const foundInA2 = listA2.data.items.some((c) => c.customerId === customer1Id);
    assert.equal(foundInA2, true, "Customer must now be visible in Branch A2 after sharing");

    // Direct get from Branch A2 -> must succeed
    const getA2 = await invokeCallable("customersGet", {
      organizationId: orgAId,
      customerId: customer1Id,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(getA2.ok, true, "Direct customersGet from shared branch must succeed");
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Customer Visibility Revocation
  // -------------------------------------------------------------------------
  await step(6, "Customer Visibility Ã¢â‚¬â€ Sharing Revocation", async () => {
    // Revoke Branch A2
    const revokeRes = await invokeCallable("customersUpdate", {
      organizationId: orgAId,
      customerId: customer1Id,
      visibilityScope: "branch_only",
      sharedForBranchIds: [branchA1Id],
    }, ownerAToken);

    assert.equal(revokeRes.ok, true);

    // Query from Branch A2 -> must be hidden again
    const listA2 = await invokeCallable("customersList", {
      organizationId: orgAId,
      branchId: branchA2Id,
    }, ownerAToken);
    const foundInA2 = listA2.data.items.some((c) => c.customerId === customer1Id);
    assert.equal(foundInA2, false, "Customer must be hidden after revocation");
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Vendor Branch Visibility
  // -------------------------------------------------------------------------
  await step(7, "Vendor Visibility Ã¢â‚¬â€ branch_only to all_branches Transition", async () => {
    const vendRes = await invokeCallable("vendorsCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      name: "Kerala Spice Suppliers",
      mobile: "9123456781",
      visibilityScope: "branch_only",
      idempotencyKey: `vend_b1_${runId}`,
    }, ownerAToken);

    assert.equal(vendRes.ok, true);
    vendor1Id = vendRes.data.vendorId;

    // Hidden in A2 initially
    const listA2Init = await invokeCallable("vendorsList", {
      organizationId: orgAId,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(listA2Init.data.items.some((v) => v.vendorId === vendor1Id), false);

    // Transition to all_branches
    const updateVend = await invokeCallable("vendorsUpdate", {
      organizationId: orgAId,
      vendorId: vendor1Id,
      visibilityScope: "all_branches",
    }, ownerAToken);
    assert.equal(updateVend.ok, true);

    // Now visible in A2
    const listA2After = await invokeCallable("vendorsList", {
      organizationId: orgAId,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(listA2After.data.items.some((v) => v.vendorId === vendor1Id), true);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Product Catalog Sharing vs Stock Isolation
  // -------------------------------------------------------------------------
  await step(8, "Product Catalog Sharing vs Branch Stock Isolation", async () => {
    const prodRes = await invokeCallable("productsCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      name: "Premium Cardamom 500g",
      baseUnit: "box",
      costPrice: 500,
      sellingPrice: 850,
      initialStock: 100, // Initial 100 units assigned strictly to Branch A1
      trackStock: true,
      idempotencyKey: `prod_${runId}`,
    }, ownerAToken);

    assert.equal(prodRes.ok, true, `Product create failed: ${JSON.stringify(prodRes.error)}`);
    product1Id = prodRes.data.productId;

    // 1. Catalog is accessible from Branch A2
    const getInA2 = await invokeCallable("productsGet", {
      organizationId: orgAId,
      productId: product1Id,
      branchId: branchA2Id,
    }, ownerAToken);
    assert.equal(getInA2.ok, true, "Product catalog must be visible across all branches");
    assert.equal(getInA2.data.name, "Premium Cardamom 500g");

    // 2. Stock isolation check in stockBalances
    const sbA1 = await db.collection("stockBalances").doc(`${orgAId}_${branchA1Id}_${product1Id}`).get();
    assert.equal(sbA1.exists, true);
    assert.equal(sbA1.data().currentStock, 100, "Branch A1 stock balance must be 100");

    const sbA2 = await db.collection("stockBalances").doc(`${orgAId}_${branchA2Id}_${product1Id}`).get();
    const stockA2 = sbA2.exists ? sbA2.data().currentStock : 0;
    assert.equal(stockA2, 0, "Branch A2 stock balance must strictly be 0");
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Purchase at Branch A1
  // -------------------------------------------------------------------------
  await step(9, "Purchase Inward at Branch A1 (Increments A1 Only)", async () => {
    const res = await invokeCallable("outflowsCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      kind: "purchase",
      vendorId: vendor1Id,
      lines: [
        {
          productId: product1Id,
          quantity: 50,
          unit: "box",
          unitPrice: 500,
          addToStock: true,
        },
      ],
      idempotencyKey: `pur_a1_${runId}`,
    }, ownerAToken);

    assert.equal(res.ok, true, `Purchase at A1 failed: ${JSON.stringify(res.error)}`);

    // Verify A1 stock: 100 + 50 = 150
    const sbA1 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA1Id}_${product1Id}`).get()).data();
    assert.equal(sbA1.currentStock, 150);

    // Verify A2 stock: unchanged at 0
    const sbA2 = await db.collection("stockBalances").doc(`${orgAId}_${branchA2Id}_${product1Id}`).get();
    const stockA2 = sbA2.exists ? sbA2.data().currentStock : 0;
    assert.equal(stockA2, 0);
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Purchase at Branch A2
  // -------------------------------------------------------------------------
  await step(10, "Purchase Inward at Branch A2 (Increments A2, Preserves A1)", async () => {
    const res = await invokeCallable("outflowsCreate", {
      organizationId: orgAId,
      branchId: branchA2Id,
      kind: "purchase",
      vendorId: vendor1Id,
      lines: [
        {
          productId: product1Id,
          quantity: 30,
          unit: "box",
          unitPrice: 500,
          addToStock: true,
        },
      ],
      idempotencyKey: `pur_a2_${runId}`,
    }, ownerAToken);

    assert.equal(res.ok, true, `Purchase at A2 failed: ${JSON.stringify(res.error)}`);

    // Verify A2 stock: 0 + 30 = 30
    const sbA2 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA2Id}_${product1Id}`).get()).data();
    assert.equal(sbA2.currentStock, 30);

    // Verify A1 stock: strictly preserved at 150
    const sbA1 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA1Id}_${product1Id}`).get()).data();
    assert.equal(sbA1.currentStock, 150);

    // Verify aggregate product currentStock: 150 + 30 = 180
    const prodDoc = (await db.collection("products").doc(product1Id).get()).data();
    assert.equal(prodDoc.currentStock, 180);
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Sale at Branch A1
  // -------------------------------------------------------------------------
  await step(11, "POS / B2B Sale at Branch A1 (Decrements A1, Preserves A2)", async () => {
    const res = await invokeCallable("billsCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      salesMode: "pos",
      customerId: customer1Id,
      items: [
        {
          productId: product1Id,
          quantity: 40,
          unit: "box",
          unitPriceOverride: 850,
        },
      ],
      paidAmount: 40 * 850 - 500, // 500 left open for the scenario 14 payment
      paymentMethod: "cash",
      idempotencyKey: `sale_a1_${runId}`,
    }, ownerAToken);

    assert.equal(res.ok, true, `Sale at A1 failed: ${JSON.stringify(res.error)}`);
    bill1Id = res.data.billId;

    // Verify A1 stock: 150 - 40 = 110
    const sbA1 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA1Id}_${product1Id}`).get()).data();
    assert.equal(sbA1.currentStock, 110);

    // Verify A2 stock: strictly untouched at 30
    const sbA2 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA2Id}_${product1Id}`).get()).data();
    assert.equal(sbA2.currentStock, 30);

    // Verify bill document attribution
    const billDoc = (await db.collection("bills").doc(bill1Id).get()).data();
    assert.equal(billDoc.branchId, branchA1Id);
  });

  // -------------------------------------------------------------------------
  // Scenario 12: Sales Return at Branch A1
  // -------------------------------------------------------------------------
  await step(12, "Sales Return at Branch A1 (Restocks A1, Preserves A2)", async () => {
    const res = await invokeCallable("returnsCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      returnType: "sales_return",
      referenceId: bill1Id,
      items: [
        {
          productId: product1Id,
          quantity: 10,
          refundAmount: 10 * 850,
          reason: "Customer ordered excess boxes",
          disposition: "restocked_to_inventory",
        },
      ],
      refundMethod: "cash",
      idempotencyKey: `ret_a1_${runId}`,
    }, ownerAToken);

    assert.equal(res.ok, true, `Return failed: ${JSON.stringify(res.error)}`);

    // Verify A1 stock: 110 + 10 = 120
    const sbA1 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA1Id}_${product1Id}`).get()).data();
    assert.equal(sbA1.currentStock, 120);

    // Verify A2 stock: strictly preserved at 30
    const sbA2 = (await db.collection("stockBalances").doc(`${orgAId}_${branchA2Id}_${product1Id}`).get()).data();
    assert.equal(sbA2.currentStock, 30);
  });

  // -------------------------------------------------------------------------
  // Scenario 13: Delivery Dispatch
  // -------------------------------------------------------------------------
  await step(13, "Delivery Dispatch Branch Attribution", async () => {
    const res = await invokeCallable("deliveriesCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      billId: bill1Id,
      address: {
        line1: "42 MG Road",
        city: "Kochi",
        pincode: "682001",
      },
      partner: "internal",
      deliveryFee: 50,
      idempotencyKey: `del_${runId}`,
    }, ownerAToken);

    assert.equal(res.ok, true, `Delivery create failed: ${JSON.stringify(res.error)}`);
    const delDoc = (await db.collection("deliveries").doc(res.data.deliveryId).get()).data();
    assert.equal(delDoc.branchId, branchA1Id, "Delivery must record originating branchId");
    assert.equal(delDoc.billId, bill1Id, "Anti-embedding: ID reference only");
  });

  // -------------------------------------------------------------------------
  // Scenario 14: Payment Ledger Attribution
  // -------------------------------------------------------------------------
  await step(14, "Payment Ledger Branch Attribution", async () => {
    const res = await invokeCallable("paymentsCreate", {
      organizationId: orgAId,
      branchId: branchA1Id,
      direction: "in",
      partyType: "customer",
      partyId: customer1Id,
      amount: 500,
      method: "upi",
      referenceId: bill1Id,
      referenceModel: "bill",
      idempotencyKey: `pay_${runId}`,
    }, ownerAToken);

    assert.equal(res.ok, true, `Payment create failed: ${JSON.stringify(res.error)}`);
    const payDoc = (await db.collection("payments").doc(res.data.paymentId).get()).data();
    assert.equal(payDoc.branchId, branchA1Id, "Payment must record originating branchId");
  });

  // -------------------------------------------------------------------------
  // Scenario 15: Full Reconciliation
  // -------------------------------------------------------------------------
  await step(15, "Full Multi-Branch Stock & Party Ledger Reconciliation", async () => {
    // 1. Reconcile Stock Balances
    const stockRecon = await invokeCallable("reconcileStockBalances", {
      organizationId: orgAId,
    }, ownerAToken);

    assert.equal(stockRecon.ok, true, `reconcileStockBalances failed: ${JSON.stringify(stockRecon.error)}`);
    assert.equal(stockRecon.data.discrepancyCount, 0, "Stock reconciliation must report 0 discrepancies");

    // Verify calculated balances in response
    const productRecon = stockRecon.data.items.find((p) => p.productId === product1Id);
    assert.ok(productRecon, "Product must be present in stock reconciliation");
    assert.equal(productRecon.currentStock, 150, "Current aggregate stock must be 150 (120 A1 + 30 A2)");
    assert.equal(productRecon.movementSum, 150, "Movement sum must be exactly 150");

    // 2. Reconcile Customer Party Ledgers
    const custPartyRecon = await invokeCallable("reconcilePartyLedgers", {
      organizationId: orgAId,
      partyType: "customer",
    }, ownerAToken);

    assert.equal(custPartyRecon.ok, true, `reconcilePartyLedgers (customer) failed: ${JSON.stringify(custPartyRecon.error)}`);
    assert.equal(custPartyRecon.data.discrepancyCount, 0, "Customer ledger reconciliation must report 0 discrepancies");

    // 3. Reconcile Vendor Party Ledgers
    const vendPartyRecon = await invokeCallable("reconcilePartyLedgers", {
      organizationId: orgAId,
      partyType: "vendor",
    }, ownerAToken);

    assert.equal(vendPartyRecon.ok, true, `reconcilePartyLedgers (vendor) failed: ${JSON.stringify(vendPartyRecon.error)}`);
    assert.equal(vendPartyRecon.data.discrepancyCount, 0, "Vendor ledger reconciliation must report 0 discrepancies");
  });

  console.log("\n================================================================================");
  console.log(`  15-SCENARIO BRANCH E2E SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runBranchDeepE2ESuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
