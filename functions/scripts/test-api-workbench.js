/**
 * Trado Firebase Backend — Local API Test Workbench Runner
 * 
 * Tool Role:
 * - Scriptable CLI runner for automated, headless execution of API callable workflows across domains.
 * - Complements the Visual Swagger API Explorer (http://127.0.0.1:3939):
 *   * Explorer is ideal for interactive human discovery, schema inspection, and manual testing.
 *   * Workbench is ideal for terminal regression testing, single-callable debugging, and batch verification.
 *   * scripts/manual-tests/trado-api.http is ideal for VS Code REST Client in-editor execution.
 * 
 * Target Environment:
 *   - Local Firebase Emulator Suite (Auth 9099, Functions 5001, Firestore 8080)
 *   - Project ID: trado-x | Region: asia-south1
 * 
 * Usage:
 *   node functions/scripts/test-api-workbench.js                       # Run all tests
 *   node functions/scripts/test-api-workbench.js --api productsCreate   # Test single API
 *   node functions/scripts/test-api-workbench.js --domain billing      # Test domain suite
 *   node functions/scripts/test-api-workbench.js --list                # List all tests
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import assert from "node:assert/strict";

const PROJECT_ID = "trado-x";
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const FUNCTIONS_HOST = "http://127.0.0.1:5001";

// Safety Guard: Require local emulator host
if (!FIRESTORE_EMULATOR_HOST.includes("127.0.0.1") && !FIRESTORE_EMULATOR_HOST.includes("localhost")) {
  console.error("[CRITICAL SAFETY ERROR] Workbench cannot run against non-local Firestore host:", FIRESTORE_EMULATOR_HOST);
  process.exit(1);
}

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();
const auth = getAuth();

/**
 * Exchange email/password for ID token via Auth Emulator.
 */
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

/**
 * Invoke a 2nd Gen Firebase Callable function over HTTP.
 */
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

// Global Context for workbench run
let context = {
  superAdminToken: null,
  ownerToken: null,
  employeeToken: null,
  orgId: null,
  ownerUid: null,
  employeeUid: null,
  catId: null,
  unitId: null,
  prodId: null,
  custId: null,
  vendId: null,
  billId: null,
  outflowId: null,
};

async function setupWorkbenchContext() {
  const runId = Math.random().toString(36).substring(2, 8);
  const adminEmail = `wb-admin-${runId}@trado.local`;
  const ownerEmail = `wb-owner-${runId}@trado.local`;
  const empEmail = `wb-emp-${runId}@trado.local`;
  const password = "Password123!";

  // 1. Create Super Admin
  const adminUser = await auth.createUser({ email: adminEmail, password, displayName: "Workbench Admin" });
  await auth.setCustomUserClaims(adminUser.uid, { isSuperAdmin: true });
  context.superAdminToken = await getIdToken(adminEmail, password);

  // Pre-seed Growth Plan and System Roles
  await db.collection("subscriptionPlans").doc("plan_workbench").set({
    id: "plan_workbench",
    name: "Workbench Plan",
    price: 0,
    currency: "INR",
    storageLimitMb: 1000,
    monthlyDocumentVolumeLimit: 10000,
    seatLimits: { admin: 10, staff: 50 },
    moduleFlags: { billing: true, sales: true, inventory: true, purchases: true, customers: true, expenses: true, reports: true, staff: true },
    isActive: true,
  });

  await db.collection("roles").doc("role_org_owner").set({
    name: "Organization Owner",
    code: "org_owner",
    permissions: ["*"],
    isSystem: true,
  });

  await db.collection("roles").doc("role_admin").set({
    name: "Administrator",
    code: "admin",
    permissions: ["org:view", "employee:create", "employee:view", "bill:create"],
    isSystem: true,
  });

  await db.collection("roles").doc("role_employee").set({
    name: "Standard Employee",
    code: "employee",
    permissions: ["org:view", "employee:view"],
    isSystem: true,
  });

  // 2. Create Organization via organizationsCreate
  const orgRes = await invokeCallable("organizationsCreate", {
    name: `Workbench Org ${runId}`,
    businessType: "retail_only",
    businessCategory: "general",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "INDIA_GST",
    ownerEmail,
    initialPassword: password,
    ownerName: "Workbench Owner",
    planId: "plan_workbench",
    idempotencyKey: `wb_org_${runId}`,
  }, context.superAdminToken);

  assert.equal(orgRes.ok, true, `Org creation failed: ${JSON.stringify(orgRes.error)}`);
  context.orgId = orgRes.data.organizationId;
  context.ownerUid = orgRes.data.ownerUserId || orgRes.data.ownerUid;
  context.ownerToken = await getIdToken(ownerEmail, password);

  // 3. Create Employee via employeesCreate
  const empRes = await invokeCallable("employeesCreate", {
    organizationId: context.orgId,
    email: empEmail,
    initialPassword: password,
    name: "Workbench Employee",
    roleId: "role_employee",
    idempotencyKey: `wb_emp_${runId}`,
  }, context.ownerToken);

  assert.equal(empRes.ok, true, `Employee creation failed: ${JSON.stringify(empRes.error)}`);
  context.employeeUid = empRes.data.userId;
  context.employeeToken = await getIdToken(empEmail, password);
}

// Registry of workbench tests
const tests = [
  // SYSTEM & AUTH DOMAIN
  {
    name: "healthCheck",
    domain: "system",
    fn: async () => {
      const res = await invokeCallable("healthCheck", {});
      assert.equal(res.ok, true);
      assert.equal(res.data.status, "ok");
      assert.ok(res.data.timestamp);
    },
  },
  {
    name: "authMe",
    domain: "auth",
    fn: async () => {
      // Positive: Owner bootstrap
      const res = await invokeCallable("authMe", {}, context.ownerToken);
      assert.equal(res.ok, true);
      assert.equal(res.data.user.email.includes("wb-owner"), true);
      assert.equal(res.data.activeContext.organizationId, context.orgId);
      assert.equal(res.data.activeContext.isOrgOwner, true);
      assert.ok(Array.isArray(res.data.activeContext.effectivePermissions));

      // Negative: Unauthenticated call
      const unauth = await invokeCallable("authMe", {});
      assert.equal(unauth.ok, false);
      assert.equal(unauth.status, 401);
    },
  },
  // ORGANIZATIONS DOMAIN
  {
    name: "organizationsList",
    domain: "organizations",
    fn: async () => {
      // Positive: Super Admin can list all organizations
      const res = await invokeCallable("organizationsList", { limit: 10 }, context.superAdminToken);
      assert.equal(res.ok, true);
      assert.ok(Array.isArray(res.data.items));
      assert.ok(res.data.items.some(o => o.organizationId === context.orgId));

      // Negative: Tenant Owner cannot list platform organizations
      const nonAdminRes = await invokeCallable("organizationsList", { limit: 10 }, context.ownerToken);
      assert.equal(nonAdminRes.ok, false);
      assert.equal(nonAdminRes.status, 403);
    },
  },
  // CATALOGS DOMAIN
  {
    name: "categoriesCreate",
    domain: "catalogs",
    fn: async () => {
      const res = await invokeCallable("categoriesCreate", {
        organizationId: context.orgId,
        name: "Beverages WB",
        idempotencyKey: `cat_${Math.random()}`,
      }, context.ownerToken);
      assert.equal(res.ok, true);
      assert.ok(res.data.categoryId);
      context.catId = res.data.categoryId;

      // Firestore state check
      const doc = await db.collection("categories").doc(context.catId).get();
      assert.equal(doc.exists, true);
      assert.equal(doc.data().name, "Beverages WB");
    },
  },
  {
    name: "unitsCreate",
    domain: "catalogs",
    fn: async () => {
      const res = await invokeCallable("unitsCreate", {
        organizationId: context.orgId,
        name: "Bottle WB",
        code: `btl_${Math.random().toString(36).substring(2, 5)}`,
        group: "count",
        precision: 0,
        idempotencyKey: `unit_${Math.random()}`,
      }, context.ownerToken);
      assert.equal(res.ok, true);
      assert.ok(res.data.unitId);
      context.unitId = res.data.unitId;
    },
  },
  // PRODUCTS & INVENTORY DOMAIN
  {
    name: "productsCreate",
    domain: "products",
    fn: async () => {
      const barcode = `890${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      const res = await invokeCallable("productsCreate", {
        organizationId: context.orgId,
        name: "Sparkling Water 500ml",
        baseUnit: "pcs",
        sellingPrice: 50.00,
        costPrice: 30.00,
        taxInclusive: true,
        taxRatePercent: 18,
        barcode,
        trackStock: true,
        initialStock: 100,
        lowStockThreshold: 15,
        hasExpiry: true,
        idempotencyKey: `prod_${Math.random()}`,
      }, context.ownerToken);

      assert.equal(res.ok, true);
      assert.ok(res.data.productId);
      context.prodId = res.data.productId;

      // Firestore assertions: product doc and stock movement
      const prodDoc = await db.collection("products").doc(context.prodId).get();
      assert.equal(prodDoc.exists, true);
      assert.equal(prodDoc.data().currentStock, 100);

      const mvtSnap = await db.collection("stockMovements")
        .where("productId", "==", context.prodId)
        .limit(1)
        .get();
      assert.equal(mvtSnap.empty, false);
      assert.equal(mvtSnap.docs[0].data().quantity, 100);

      // Negative: Duplicate barcode in same org rejected
      const dupRes = await invokeCallable("productsCreate", {
        organizationId: context.orgId,
        name: "Duplicate Barcode Item",
        baseUnit: "pcs",
        sellingPrice: 10.00,
        costPrice: 5.00,
        taxInclusive: true,
        barcode,
        trackStock: true,
        initialStock: 10,
        lowStockThreshold: 2,
        hasExpiry: false,
        idempotencyKey: `prod_dup_${Math.random()}`,
      }, context.ownerToken);
      assert.equal(dupRes.ok, false);
      assert.equal(dupRes.status, 409); // already-exists
    },
  },
  {
    name: "productsGet",
    domain: "products",
    fn: async () => {
      const res = await invokeCallable("productsGet", {
        organizationId: context.orgId,
        productId: context.prodId,
      }, context.ownerToken);
      assert.equal(res.ok, true);
      assert.equal(res.data.productId, context.prodId);
      assert.equal(res.data.currentStock, 100);
    },
  },
  // PARTIES: CUSTOMERS & VENDORS
  {
    name: "customersCreate",
    domain: "parties",
    fn: async () => {
      const res = await invokeCallable("customersCreate", {
        organizationId: context.orgId,
        name: "Grand Hotel",
        mobile: "+919876500001",
        creditLimit: 50000,
        creditPeriodDays: 30,
        idempotencyKey: `cust_${Math.random()}`,
      }, context.ownerToken);
      assert.equal(res.ok, true);
      assert.ok(res.data.customerId);
      context.custId = res.data.customerId;
    },
  },
  {
    name: "vendorsCreate",
    domain: "parties",
    fn: async () => {
      const res = await invokeCallable("vendorsCreate", {
        organizationId: context.orgId,
        name: "Beverage Supply Co",
        mobile: "+919876500002",
        idempotencyKey: `vend_${Math.random()}`,
      }, context.ownerToken);
      assert.equal(res.ok, true);
      assert.ok(res.data.vendorId);
      context.vendId = res.data.vendorId;
    },
  },
  // PURCHASES & OUTFLOWS
  {
    name: "outflowsCreate",
    domain: "outflows",
    fn: async () => {
      const preProd = (await db.collection("products").doc(context.prodId).get()).data();
      const preStock = preProd.currentStock;

      const res = await invokeCallable("outflowsCreate", {
        organizationId: context.orgId,
        kind: "purchase",
        status: "confirmed",
        docDate: new Date().toISOString(),
        vendorId: context.vendId,
        lines: [
          {
            productId: context.prodId,
            quantity: 50,
            unit: "pcs",
            unitPrice: 30.00,
            grossAmount: 1500.00,
            discountAmount: 0,
            taxPercent: 18,
            taxAmount: 270.00,
            lineTotal: 1770.00,
            addToStock: true,
          },
        ],
        subTotal: 1500.00,
        discountTotal: 0,
        taxTotal: 270.00,
        totalAmount: 1770.00,
        paidAmount: 0,
        balanceAmount: 1770.00,
        paymentStatus: "pending",
        idempotencyKey: `outflow_${Math.random()}`,
      }, context.ownerToken);

      assert.equal(res.ok, true);
      assert.ok(res.data.outflowId);
      context.outflowId = res.data.outflowId;

      // Post-call state: Stock incremented by 50
      const postProd = (await db.collection("products").doc(context.prodId).get()).data();
      assert.equal(postProd.currentStock, preStock + 50);

      // Vendor payable updated
      const vendDoc = (await db.collection("vendors").doc(context.vendId).get()).data();
      assert.equal(vendDoc.outstandingPayable, 1770.00);
    },
  },
  // BILLING & SALES
  {
    name: "billsCreate",
    domain: "billing",
    fn: async () => {
      // Create B2B Quotation (draft)
      const res = await invokeCallable("billsCreate", {
        organizationId: context.orgId,
        salesMode: "b2b",
        documentType: "quotation",
        status: "draft",
        customerId: context.custId,
        items: [
          {
            productId: context.prodId,
            nameSnapshot: "Sparkling Water 500ml",
            priceSnapshot: 50.00,
            costSnapshot: 30.00,
            quantity: 10,
            unit: "pcs",
            subtotal: 500.00,
            discountValue: 0,
            taxAmount: 76.27,
            lineTotal: 500.00,
          },
        ],
        subTotal: 423.73,
        discountTotal: 0,
        taxTotal: 76.27,
        roundOff: 0,
        totalAmount: 500.00,
        paidAmount: 0,
        balanceAmount: 500.00,
        paymentStatus: "pending",
        idempotencyKey: `bill_qtn_${Math.random()}`,
      }, context.ownerToken);

      assert.equal(res.ok, true);
      assert.ok(res.data.billId);
      assert.ok(res.data.billNumber.startsWith("QTN-"));
      context.billId = res.data.billId;

      // Draft quotation MUST NOT decrement stock
      const prodDoc = (await db.collection("products").doc(context.prodId).get()).data();
      assert.equal(prodDoc.currentStock, 150);
    },
  },
  {
    name: "billsFinalize",
    domain: "billing",
    fn: async () => {
      const res = await invokeCallable("billsFinalize", {
        organizationId: context.orgId,
        billId: context.billId,
        idempotencyKey: `fin_${Math.random()}`,
      }, context.ownerToken);

      assert.equal(res.ok, true);
      assert.ok(res.data.billNumber.startsWith("INV-"));
      assert.equal(res.data.status, "active");

      // Post-call state: Stock decremented by 10 (150 -> 140)
      const prodDoc = (await db.collection("products").doc(context.prodId).get()).data();
      assert.equal(prodDoc.currentStock, 140);

      // Customer outstanding balance updated (500 subtotal + 90 tax = 590)
      const custDoc = (await db.collection("customers").doc(context.custId).get()).data();
      assert.equal(custDoc.outstandingBalance, 590.00);

      // Negative: Re-finalizing active invoice is rejected
      const reFin = await invokeCallable("billsFinalize", {
        organizationId: context.orgId,
        billId: context.billId,
        idempotencyKey: `fin_retry_${Math.random()}`,
      }, context.ownerToken);
      assert.equal(reFin.ok, false);
      assert.equal(reFin.status, 400); // invalid-argument (not draft)
    },
  },
  // PAYMENTS DOMAIN
  {
    name: "paymentsCreate",
    domain: "payments",
    fn: async () => {
      const res = await invokeCallable("paymentsCreate", {
        organizationId: context.orgId,
        direction: "in",
        partyType: "customer",
        partyId: context.custId,
        amount: 200.00,
        method: "cash",
        referenceId: context.billId,
        referenceModel: "bill",
        idempotencyKey: `pay_${Math.random()}`,
      }, context.ownerToken);

      assert.equal(res.ok, true);
      assert.ok(res.data.paymentNumber.startsWith("PAY-"));

      // Customer balance credited: 590 -> 390
      const custDoc = (await db.collection("customers").doc(context.custId).get()).data();
      assert.equal(custDoc.outstandingBalance, 390.00);

      // Bill status updated to partial
      const billDoc = (await db.collection("bills").doc(context.billId).get()).data();
      assert.equal(billDoc.paidAmount, 200.00);
      assert.equal(billDoc.balanceAmount, 390.00);
      assert.equal(billDoc.paymentStatus, "partial");
    },
  },
  // RETURNS DOMAIN
  {
    name: "returnsCreate",
    domain: "returns",
    fn: async () => {
      const res = await invokeCallable("returnsCreate", {
        organizationId: context.orgId,
        returnType: "sales_return",
        referenceId: context.billId,
        refundMethod: "credit_note",
        items: [
          {
            productId: context.prodId,
            nameSnapshot: "Sparkling Water 500ml",
            quantity: 2,
            unit: "pcs",
            priceSnapshot: 50.00,
            refundAmount: 100.00,
            reason: "Over-ordered",
            disposition: "restocked_to_inventory",
          },
        ],
        idempotencyKey: `ret_${Math.random()}`,
      }, context.ownerToken);

      assert.equal(res.ok, true);
      assert.ok(res.data.returnNumber.startsWith("RET-"));

      // Inventory restocked: 140 -> 142
      const prodDoc = (await db.collection("products").doc(context.prodId).get()).data();
      assert.equal(prodDoc.currentStock, 142);

      // Customer credited: 390 -> 290
      const custDoc = (await db.collection("customers").doc(context.custId).get()).data();
      assert.equal(custDoc.outstandingBalance, 290.00);
    },
  },
  // RECONCILIATION DOMAIN
  {
    name: "reconcileStockBalances",
    domain: "reconciliation",
    fn: async () => {
      const res = await invokeCallable("reconcileStockBalances", {
        organizationId: context.orgId,
        autoFix: false,
      }, context.ownerToken);
      assert.equal(res.ok, true);
      assert.equal(res.data.discrepancyCount, 0);
    },
  },
  {
    name: "reconcilePartyLedgers",
    domain: "reconciliation",
    fn: async () => {
      const resCust = await invokeCallable("reconcilePartyLedgers", {
        organizationId: context.orgId,
        partyType: "customer",
        autoFix: false,
      }, context.ownerToken);
      assert.equal(resCust.ok, true);
      assert.equal(resCust.data.discrepancyCount, 0);
    },
  },
];

async function main() {
  const args = process.argv.slice(2);
  const apiIndex = args.indexOf("--api");
  const targetApi = apiIndex !== -1 ? args[apiIndex + 1] : null;

  const domainIndex = args.indexOf("--domain");
  const targetDomain = domainIndex !== -1 ? args[domainIndex + 1] : null;

  if (args.includes("--list")) {
    console.log("Available API Workbench Tests:\n");
    tests.forEach((t, i) => console.log(`  ${i + 1}. [${t.domain}] ${t.name}`));
    process.exit(0);
  }

  let selectedTests = tests;
  if (targetApi) {
    selectedTests = tests.filter(t => t.name.toLowerCase() === targetApi.toLowerCase());
    if (selectedTests.length === 0) {
      console.error(`Unknown API test: "${targetApi}". Run with --list to view available tests.`);
      process.exit(1);
    }
  } else if (targetDomain) {
    selectedTests = tests.filter(t => t.domain.toLowerCase() === targetDomain.toLowerCase());
    if (selectedTests.length === 0) {
      console.error(`Unknown domain: "${targetDomain}". Run with --list to view available tests.`);
      process.exit(1);
    }
  }

  console.log("==========================================================");
  console.log("   TRADO FIREBASE BACKEND — LOCAL TEST WORKBENCH RUNNER   ");
  console.log("==========================================================");
  console.log(`Target: ${targetApi ? `API [${targetApi}]` : targetDomain ? `Domain [${targetDomain}]` : "ALL API Domains"}`);
  console.log(`Emulators: Auth 9099 | Functions 5001 | Firestore 8080\n`);

  console.log("Bootstrapping test environment & seed tenant...");
  await setupWorkbenchContext();
  console.log(`✓ Tenant ready: ${context.orgId}\n`);

  let passed = 0;
  let failed = 0;

  for (const t of selectedTests) {
    process.stdout.write(`• Testing [${t.domain}] ${t.name}... `);
    try {
      await t.fn();
      console.log("PASSED ✓");
      passed++;
    } catch (err) {
      console.log(`FAILED ✗\n  ${err.message}`);
      if (err.stack) console.log(`  ${err.stack.split("\n").slice(1, 3).join("\n")}`);
      failed++;
    }
  }

  console.log("\n==========================================================");
  console.log(`WORKBENCH COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Workbench encountered fatal error:", err);
  process.exit(1);
});

