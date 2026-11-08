/**
 * Trado Firebase Backend — Connected End-to-End Business Scenario Test
 * 
 * Executes a full 10-step lifecycle over Firebase HTTP Callables against Emulators:
 * Step 1: Super Admin provisions Organization & Owner -> asserts claims & Firestore org
 * Step 2: Owner provisions Admin & Employee -> asserts memberships, users & roles
 * Step 3: Admin creates Vendor, tracked Product with barcode, and Customer
 * Step 4: Admin records purchase Outflow -> verifies stock increases (+100) & vendor payable (20000)
 * Step 5: Admin records partial vendor payment -> verifies outflow balance & vendor payable decrease
 * Step 6: Employee creates B2B quotation -> verifies stock unaffected, 0 movements, QTN- number
 * Step 7: Employee finalizes quotation -> verifies INV- number, stock decremented (-20), customer balance (7000)
 * Step 8: Customer makes partial payment on invoice -> verifies bill balance & customer balance decrease (4000)
 * Step 9: Process partial sale return -> verifies over-return rejection, stock restocked (+5), customer balance credit (-1750)
 * Step 10: Run reconcileStockBalances & reconcilePartyLedgers -> verifies 0 discrepancies
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

async function runE2EBusinessFlow() {
  console.log("================================================================================");
  console.log("   TRADO FIREBASE BACKEND — CONNECTED END-TO-END BUSINESS LIFECYCLE SMOKE TEST   ");
  console.log("================================================================================\n");

  const runId = Date.now();
  let step = 1;

  function logStep(title) {
    console.log(`\n[STEP ${step++}] ${title}`);
  }

  // Canonical reference data (plans, roles, catalogs). Suites must never overwrite shared
  // system roles or plans: other suites running on the same emulator depend on them.
  await (await import("../lib/scripts/seed-emulator.js")).seedReferenceData(db);

  // Setup Super Admin Actor
  const superAdminEmail = `superadmin_e2e_${runId}@trado.local`;
  const superAdminAuth = await auth.createUser({
    email: superAdminEmail,
    password: "Password123!",
  });
  await auth.setCustomUserClaims(superAdminAuth.uid, { isSuperAdmin: true });
  await db.collection("users").doc(superAdminAuth.uid).set({
    name: "E2E Platform Super Admin",
    email: superAdminEmail,
    isActive: true,
    accountType: "admin",
  });
  const superAdminToken = await getIdToken(superAdminEmail, "Password123!");

  // STEP 1: Super Admin provisions Org & Owner
  logStep("Super Admin provisions Organization & Owner");
  const orgOwnerEmail = `owner_e2e_${runId}@apex.local`;
  const orgRes = await invokeCallable("organizationsCreate", {
    name: `Apex Traders ${runId}`,
    businessType: "wholesale_retail",
    businessCategory: "grocery_fmcg",
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    planId: "plan_enterprise",
    ownerEmail: orgOwnerEmail,
    ownerName: "Apex Owner",
    initialPassword: "TempPassword123!",
    idempotencyKey: `e2e_org_${runId}`,
  }, superAdminToken);

  assert.equal(orgRes.ok, true, `organizationsCreate failed: ${JSON.stringify(orgRes.error)}`);
  const orgId = orgRes.data.organizationId;
  const ownerUid = orgRes.data.ownerUserId;
  assert.ok(orgId, "organizationId must be returned");
  assert.ok(ownerUid, "ownerUserId must be returned");

  // Verify Owner claims
  const ownerRecord = await auth.getUser(ownerUid);
  assert.equal(ownerRecord.customClaims?.primaryOrganizationId, orgId);
  assert.notEqual(ownerRecord.customClaims?.isSuperAdmin, true);

  // Verify Org doc in Firestore
  const orgDoc = (await db.collection("organizations").doc(orgId).get()).data();
  assert.equal(orgDoc?.name, `Apex Traders ${runId}`);
  assert.equal(orgDoc?.status, "active");

  // Owner signs in
  const ownerToken = await getIdToken(orgOwnerEmail, "TempPassword123!");
  console.log(`  ✓ Organization created: ${orgId}`);
  console.log(`  ✓ Owner user verified with primaryOrganizationId claim: ${ownerUid}`);

  // STEP 2: Owner provisions Admin & Employee (role_employee)
  logStep("Owner provisions Admin & Employee (role_employee)");
  const adminEmail = `admin_e2e_${runId}@apex.local`;
  const adminRes = await invokeCallable("employeesCreate", {
    organizationId: orgId,
    email: adminEmail,
    name: "Apex Store Admin",
    roleId: "role_admin",
    initialPassword: "TempPassword123!",
    idempotencyKey: `e2e_emp_admin_${runId}`,
  }, ownerToken);
  assert.equal(adminRes.ok, true, `employeesCreate admin failed: ${JSON.stringify(adminRes.error)}`);
  const adminUid = adminRes.data.userId;

  const empEmail = `employee_e2e_${runId}@apex.local`;
  const empRes = await invokeCallable("employeesCreate", {
    organizationId: orgId,
    email: empEmail,
    name: "Apex Floor Staff",
    roleId: "role_employee",
    initialPassword: "TempPassword123!",
    idempotencyKey: `e2e_emp_staff_${runId}`,
    // Floor staff duties granted per membership (the base employee role is view-only)
    permissionOverrides: {
      "product:view": true, "inventory:view": true, "bill:create": true, "bill:view": true,
      "bill:update": true, "return:create": true, "payment:create": true, "customer:view": true,
    },
  }, ownerToken);
  assert.equal(empRes.ok, true, `employeesCreate employee failed: ${JSON.stringify(empRes.error)}`);
  const empUid = empRes.data.userId;

  // Verify membership documents
  const adminMem = (await db.collection("memberships").doc(`${adminUid}_${orgId}`).get()).data();
  assert.equal(adminMem?.roleId, "role_admin");
  assert.equal(adminMem?.status, "active");

  const empMem = (await db.collection("memberships").doc(`${empUid}_${orgId}`).get()).data();
  assert.equal(empMem?.roleId, "role_employee");
  assert.equal(empMem?.status, "active");

  const adminToken = await getIdToken(adminEmail, "TempPassword123!");
  const empToken = await getIdToken(empEmail, "TempPassword123!");
  console.log(`  ✓ Administrator provisioned: ${adminUid} (role_admin)`);
  console.log(`  ✓ Standard Employee provisioned: ${empUid} (role_employee)`);

  // STEP 3: Admin creates Vendor, tracked Product with barcode, and Customer
  logStep("Admin creates Vendor, tracked Product with barcode, and Customer");
  const vendorRes = await invokeCallable("vendorsCreate", {
    organizationId: orgId,
    name: "Kerala Spice Suppliers Ltd",
    mobile: "+919876543210",
    taxNumber: "32AABCK1234F1Z1",
    idempotencyKey: `e2e_vend_${runId}`,
  }, adminToken);
  assert.equal(vendorRes.ok, true, `vendorsCreate failed: ${JSON.stringify(vendorRes.error)}`);
  const vendorId = vendorRes.data.vendorId;

  const barcodeVal = `890${runId.toString().slice(-10)}`;
  const productRes = await invokeCallable("productsCreate", {
    organizationId: orgId,
    name: "Green Cardamom Grade A (50g)",
    baseUnit: "piece",
    sellingPrice: 350,
    costPrice: 200,
    barcode: barcodeVal,
    trackStock: true,
    initialStock: 0,
    idempotencyKey: `e2e_prod_${runId}`,
  }, adminToken);
  assert.equal(productRes.ok, true, `productsCreate failed: ${JSON.stringify(productRes.error)}`);
  const productId = productRes.data.productId;

  const customerRes = await invokeCallable("customersCreate", {
    organizationId: orgId,
    name: "Spice Bazaar Wholesalers",
    mobile: "+919123456780",
    creditLimit: 50000,
    creditPeriodDays: 30,
    idempotencyKey: `e2e_cust_${runId}`,
  }, adminToken);
  assert.equal(customerRes.ok, true, `customersCreate failed: ${JSON.stringify(customerRes.error)}`);
  const customerId = customerRes.data.customerId;

  // Assert initial document states
  const prodDocSnap = (await db.collection("products").doc(productId).get()).data();
  assert.equal(prodDocSnap?.currentStock, 0, "Initial product stock must be 0");
  assert.equal(prodDocSnap?.barcode, barcodeVal);

  const vendorDocSnap = (await db.collection("vendors").doc(vendorId).get()).data();
  assert.equal(vendorDocSnap?.outstandingPayable, 0, "Initial vendor payable must be 0");

  const customerDocSnap = (await db.collection("customers").doc(customerId).get()).data();
  assert.equal(customerDocSnap?.outstandingBalance, 0, "Initial customer balance must be 0");

  console.log(`  ✓ Vendor created: ${vendorId} (${vendorRes.data.name})`);
  console.log(`  ✓ Product created: ${productId} (Barcode: ${barcodeVal}, Stock: 0)`);
  console.log(`  ✓ Customer created: ${customerId} (Credit Limit: 50000)`);

  // STEP 4: Admin records Purchase Outflow -> verifies stock increases (+100) & vendor payable (20000)
  logStep("Admin records Purchase Outflow (intake 100 units @ Rs 200)");
  const purchaseRes = await invokeCallable("outflowsCreate", {
    organizationId: orgId,
    kind: "purchase",
    vendorId,
    docDate: new Date().toISOString(),
    lines: [
      {
        productId,
        quantity: 100,
        unit: "piece",
        unitPrice: 200,
        addToStock: true,
      },
    ],
    idempotencyKey: `e2e_pur_${runId}`,
  }, adminToken);
  assert.equal(purchaseRes.ok, true, `outflowsCreate failed: ${JSON.stringify(purchaseRes.error)}`);
  const outflowId = purchaseRes.data.outflowId;
  assert.match(purchaseRes.data.outflowNumber, /^PUR-\d{4}-\d{6}$/);

  // Verify stock was updated to 100
  const stockAfterPurchase = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  assert.equal(stockAfterPurchase, 100, "Product stock must increase to 100 after purchase intake");

  // Verify 1 stock movement created (+100)
  const purchaseMovements = await db.collection("stockMovements")
    .where("referenceId", "==", outflowId)
    .get();
  assert.equal(purchaseMovements.docs.length, 1);
  assert.equal(purchaseMovements.docs[0].data()?.quantity, 100);

  // Verify vendor outstandingPayable set to 20,000
  const vendorAfterPur = (await db.collection("vendors").doc(vendorId).get()).data();
  assert.equal(vendorAfterPur?.outstandingPayable, 20000, "Vendor payable must be 20,000");
  assert.equal(vendorAfterPur?.totalPurchase, 20000);
  console.log(`  ✓ Outflow created: ${outflowId} (${purchaseRes.data.outflowNumber})`);
  console.log(`  ✓ Product currentStock incremented: 0 -> ${stockAfterPurchase}`);
  console.log(`  ✓ Vendor outstandingPayable: Rs ${vendorAfterPur?.outstandingPayable}`);

  // STEP 5: Admin records partial vendor payment
  logStep("Admin records partial vendor payment of Rs 8,000 against purchase");
  const payVendRes = await invokeCallable("paymentsCreate", {
    organizationId: orgId,
    direction: "out",
    partyType: "vendor",
    partyId: vendorId,
    amount: 8000,
    method: "bank_transfer",
    referenceId: outflowId,
    referenceModel: "outflow",
    notes: "Partial payment for Cardamom batch",
    idempotencyKey: `e2e_pay_vend_${runId}`,
  }, adminToken);
  assert.equal(payVendRes.ok, true, `paymentsCreate failed: ${JSON.stringify(payVendRes.error)}`);
  assert.match(payVendRes.data.paymentNumber, /^PAY-\d{4}-\d{6}$/);

  // Verify outflow document settlement
  const outflowDocSnap = (await db.collection("outflows").doc(outflowId).get()).data();
  assert.equal(outflowDocSnap?.paidAmount, 8000, "Outflow paidAmount must be 8,000");
  assert.equal(outflowDocSnap?.balanceAmount, 12000, "Outflow balanceAmount must be 12,000");
  assert.equal(outflowDocSnap?.paymentStatus, "partial");

  // Verify vendor outstandingPayable reduced to 12,000
  const vendorAfterPay = (await db.collection("vendors").doc(vendorId).get()).data();
  assert.equal(vendorAfterPay?.outstandingPayable, 12000, "Vendor payable must decrease to 12,000");
  console.log(`  ✓ Payment recorded: ${payVendRes.data.paymentNumber} (Rs 8,000)`);
  console.log(`  ✓ Outflow updated: paidAmount=8000, balanceAmount=12000, status=partial`);
  console.log(`  ✓ Vendor payable synchronized: Rs 20,000 -> Rs ${vendorAfterPay?.outstandingPayable}`);

  // STEP 6: Employee creates B2B quotation -> verifies stock unaffected, 0 movements, QTN- number
  logStep("Employee creates B2B quotation (20 units @ Rs 350 = Rs 7,000)");
  const qtnRes = await invokeCallable("billsCreate", {
    organizationId: orgId,
    salesMode: "b2b",
    documentType: "quotation",
    customerId,
    items: [
      {
        productId,
        quantity: 20,
      },
    ],
    idempotencyKey: `e2e_qtn_${runId}`,
  }, empToken);
  assert.equal(qtnRes.ok, true, `billsCreate quotation failed: ${JSON.stringify(qtnRes.error)}`);
  const quotationBillId = qtnRes.data.billId;
  const quotationNumber = qtnRes.data.billNumber;
  assert.match(quotationNumber, /^QTN-\d{4}-\d{6}$/, "Quotation must have QTN- format");
  assert.equal(qtnRes.data.status, "draft");

  // Verify product stock is STILL 100 (unaffected!)
  const stockAfterQtn = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  assert.equal(stockAfterQtn, 100, "Physical stock must NOT be decremented on quotation creation");

  // Verify ZERO stock movements created
  const qtnMovements = await db.collection("stockMovements")
    .where("referenceId", "==", quotationBillId)
    .get();
  assert.equal(qtnMovements.empty, true, "Quotation must create exactly 0 stock movements");

  // Verify customer balance STILL 0
  const custAfterQtn = (await db.collection("customers").doc(customerId).get()).data();
  assert.equal(custAfterQtn?.outstandingBalance, 0, "Quotation must NOT update customer receivable balance");
  console.log(`  ✓ Quotation generated: ${quotationBillId} (${quotationNumber})`);
  console.log(`  ✓ Physical stock isolated: currentStock remains ${stockAfterQtn}`);
  console.log(`  ✓ Stock movements for quotation: 0`);

  // STEP 7: Employee finalizes quotation -> verifies INV- number, stock decremented (-20), customer balance (7000)
  logStep("Employee finalizes quotation into active Tax Invoice via billsFinalize");
  const finRes = await invokeCallable("billsFinalize", {
    organizationId: orgId,
    billId: quotationBillId,
    idempotencyKey: `e2e_fin_${runId}`,
  }, empToken);
  assert.equal(finRes.ok, true, `billsFinalize failed: ${JSON.stringify(finRes.error)}`);
  const finalizedInvoiceNumber = finRes.data.billNumber;
  assert.match(finalizedInvoiceNumber, /^INV-\d{4}-\d{6}$/, "Finalized bill must receive sequential INV- invoice number");
  assert.equal(finRes.data.status, "active");

  // Verify bill document fields
  const billDocSnap = (await db.collection("bills").doc(quotationBillId).get()).data();
  assert.equal(billDocSnap?.billNumber, finalizedInvoiceNumber);
  assert.equal(billDocSnap?.originalQuotationNumber, quotationNumber, "Must preserve original QTN- number");
  assert.equal(billDocSnap?.status, "active");
  assert.ok(billDocSnap?.finalizedAt);
  assert.equal(billDocSnap?.finalizedBy, empUid);

  // Verify product stock decremented: 100 -> 80
  const stockAfterFin = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  assert.equal(stockAfterFin, 80, "Product stock must be decremented from 100 to 80");

  // Verify exactly 1 stock movement created (-20)
  const finMovements = await db.collection("stockMovements")
    .where("referenceId", "==", quotationBillId)
    .get();
  assert.equal(finMovements.docs.length, 1);
  assert.equal(finMovements.docs[0].data()?.quantity, -20);
  assert.equal(finMovements.docs[0].data()?.type, "sale_out");

  // Verify customer ledger balance updated: Rs 7,000 (20 * 350)
  const custAfterFin = (await db.collection("customers").doc(customerId).get()).data();
  assert.equal(custAfterFin?.outstandingBalance, 7000, "Customer outstandingBalance must increase to 7,000");
  assert.equal(custAfterFin?.totalSpend, 7000);
  console.log(`  ✓ Quotation finalized to Invoice: ${finalizedInvoiceNumber} (Preserved: ${quotationNumber})`);
  console.log(`  ✓ Stock atomically decremented: 100 -> ${stockAfterFin} (1 stock movement: -20)`);
  console.log(`  ✓ Customer B2B ledger balance updated: Rs ${custAfterFin?.outstandingBalance}`);

  // STEP 8: Customer makes partial payment on invoice -> verifies bill balance & customer balance decrease (4000)
  logStep("Customer makes partial payment of Rs 3,000 on Invoice");
  const payCustRes = await invokeCallable("paymentsCreate", {
    organizationId: orgId,
    direction: "in",
    partyType: "customer",
    partyId: customerId,
    amount: 3000,
    method: "bank_transfer",
    referenceId: quotationBillId,
    referenceModel: "bill",
    notes: "Partial payment for Cardamom invoice",
    idempotencyKey: `e2e_pay_cust_${runId}`,
  }, empToken);
  assert.equal(payCustRes.ok, true, `paymentsCreate failed: ${JSON.stringify(payCustRes.error)}`);

  // Verify bill document settlement
  const billAfterPay = (await db.collection("bills").doc(quotationBillId).get()).data();
  assert.equal(billAfterPay?.paidAmount, 3000, "Bill paidAmount must be 3,000");
  assert.equal(billAfterPay?.balanceAmount, 4000, "Bill balanceAmount must be 4,000");
  assert.equal(billAfterPay?.paymentStatus, "partial");

  // Verify customer balance decreased to 4,000 (7,000 - 3,000)
  const custAfterPay = (await db.collection("customers").doc(customerId).get()).data();
  assert.equal(custAfterPay?.outstandingBalance, 4000, "Customer outstandingBalance must decrease to 4,000");
  console.log(`  ✓ Payment recorded: ${payCustRes.data.paymentNumber} (Rs 3,000)`);
  console.log(`  ✓ Bill updated: paidAmount=3000, balanceAmount=4000, status=partial`);
  console.log(`  ✓ Customer outstanding balance: Rs 7,000 -> Rs ${custAfterPay?.outstandingBalance}`);

  // STEP 9: Process partial sale return -> verifies over-return rejection, stock restocked (+5), customer credit (-1750)
  logStep("Customer processes partial sale return (5 units @ Rs 350 = Rs 1,750)");
  // 1. First assert over-return rejection (try returning 25 units when only 20 were billed)
  const overRetRes = await invokeCallable("returnsCreate", {
    organizationId: orgId,
    returnType: "sales_return",
    referenceId: quotationBillId,
    items: [
      {
        productId,
        quantity: 25,
        refundAmount: 8750,
        reason: "wrong_item",
        disposition: "restocked_to_inventory",
      },
    ],
    refundMethod: "credit_note",
    idempotencyKey: `e2e_over_ret_${runId}`,
  }, empToken);
  assert.equal(overRetRes.status, 400);
  assert.equal(overRetRes.error?.status, "INVALID_ARGUMENT");
  assert.match(overRetRes.error?.message, /remain returnable/);
  console.log(`  ✓ Over-return validation: returning 25 on 20-unit bill correctly rejected with INVALID_ARGUMENT`);

  // 2. Process valid return of 5 units
  const validRetRes = await invokeCallable("returnsCreate", {
    organizationId: orgId,
    returnType: "sales_return",
    referenceId: quotationBillId,
    items: [
      {
        productId,
        quantity: 5,
        refundAmount: 1750,
        reason: "quality_issue",
        disposition: "restocked_to_inventory",
      },
    ],
    refundMethod: "credit_note",
    idempotencyKey: `e2e_valid_ret_${runId}`,
  }, empToken);
  assert.equal(validRetRes.ok, true, `returnsCreate failed: ${JSON.stringify(validRetRes.error)}`);
  const returnNumber = validRetRes.data.returnNumber;
  assert.match(returnNumber, /^RET-\d{4}-\d{6}$/);

  // Verify stock was restored from 80 -> 85
  const stockAfterReturn = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  assert.equal(stockAfterReturn, 85, "Product currentStock must be restored from 80 to 85");

  // Verify 1 stock movement created (+5)
  const returnMovements = await db.collection("stockMovements")
    .where("referenceId", "==", validRetRes.data.returnId)
    .get();
  assert.equal(returnMovements.docs.length, 1);
  assert.equal(returnMovements.docs[0].data()?.quantity, 5);
  assert.equal(returnMovements.docs[0].data()?.type, "sale_return_in");

  // Verify bill line returnedQty updated
  const billAfterReturn = (await db.collection("bills").doc(quotationBillId).get()).data();
  assert.equal(billAfterReturn?.items[0]?.returnedQty, 5, "Bill line item returnedQty must be 5");

  // Verify customer credit note adjustment: 4,000 - 1,750 = 2,250
  const custAfterReturn = (await db.collection("customers").doc(customerId).get()).data();
  assert.equal(custAfterReturn?.outstandingBalance, 2250, "Customer outstandingBalance must decrease by refundAmount to 2,250");
  console.log(`  ✓ Return processed: ${returnNumber} (Refund Rs 1,750 credit note)`);
  console.log(`  ✓ Stock restocked: 80 -> ${stockAfterReturn} (1 stock movement: +5 sale_return_in)`);
  console.log(`  ✓ Bill line item returnedQty: ${billAfterReturn?.items[0]?.returnedQty}`);
  console.log(`  ✓ Customer balance credited: Rs 4,000 -> Rs ${custAfterReturn?.outstandingBalance}`);

  // STEP 10: Run reconcileStockBalances & reconcilePartyLedgers -> verifies 0 discrepancies
  logStep("Run reconciliation tools: reconcileStockBalances & reconcilePartyLedgers");
  const stockRecon = await invokeCallable("reconcileStockBalances", {
    organizationId: orgId,
  }, adminToken);
  assert.equal(stockRecon.ok, true, `reconcileStockBalances failed: ${JSON.stringify(stockRecon.error)}`);
  assert.ok(stockRecon.data.checkedCount > 0);
  assert.equal(stockRecon.data.discrepancyCount, 0, "Stock balance reconciliation must report 0 discrepancies");
  console.log(`  ✓ reconcileStockBalances: ${stockRecon.data.checkedCount} products checked, 0 discrepancies`);

  const custRecon = await invokeCallable("reconcilePartyLedgers", {
    organizationId: orgId,
    partyType: "customer",
  }, adminToken);
  assert.equal(custRecon.ok, true, `reconcilePartyLedgers customer failed: ${JSON.stringify(custRecon.error)}`);
  assert.equal(custRecon.data.discrepancyCount, 0, "Customer ledger reconciliation must report 0 discrepancies");
  console.log(`  ✓ reconcilePartyLedgers (customer): ${custRecon.data.checkedCount} customers checked, 0 discrepancies`);

  const vendRecon = await invokeCallable("reconcilePartyLedgers", {
    organizationId: orgId,
    partyType: "vendor",
  }, adminToken);
  assert.equal(vendRecon.ok, true, `reconcilePartyLedgers vendor failed: ${JSON.stringify(vendRecon.error)}`);
  assert.equal(vendRecon.data.discrepancyCount, 0, "Vendor ledger reconciliation must report 0 discrepancies");
  console.log(`  ✓ reconcilePartyLedgers (vendor): ${vendRecon.data.checkedCount} vendors checked, 0 discrepancies`);

  console.log("\n================================================================================");
  console.log("   ALL 10 CONNECTED E2E BUSINESS LIFECYCLE STEPS PASSED SUCCESSFULLY ✓           ");
  console.log("================================================================================\n");
}

runE2EBusinessFlow().catch((err) => {
  console.error("E2E Business Flow Failed:", err);
  process.exit(1);
});

