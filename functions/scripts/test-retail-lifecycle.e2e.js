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
  let checkCount = 0;

  function logStep(title) {
    console.log(`\n[STEP ${step++}] ${title}`);
  }

  function assertCheck(num, description, condition) {
    assert.strictEqual(num, ++checkCount, `Check number mismatch: expected ${checkCount}, got ${num}`);
    assert.ok(condition, `[Check ${num}/37] FAILED: ${description}`);
    console.log(`  ✓ [Check ${num}/37] ${description}`);
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

  const orgId = orgRes.data?.organizationId;
  const ownerUid = orgRes.data?.ownerUserId;
  assertCheck(1, "organizationsCreate returns status 200 with organizationId & ownerUserId", orgRes.ok && !!orgId && !!ownerUid);

  // Verify Owner claims
  const ownerRecord = await auth.getUser(ownerUid);
  assertCheck(2, "Owner custom claims verify primaryOrganizationId matches orgId", ownerRecord.customClaims?.primaryOrganizationId === orgId);
  assertCheck(3, "Owner custom claims verify isSuperAdmin is false", ownerRecord.customClaims?.isSuperAdmin !== true);

  // Verify Org doc in Firestore
  const orgDoc = (await db.collection("organizations").doc(orgId).get()).data();
  assertCheck(4, "Organization document exists in Firestore with status 'active'", orgDoc?.name === `Apex Traders ${runId}` && orgDoc?.status === "active");

  // Owner signs in
  const ownerToken = await getIdToken(orgOwnerEmail, "TempPassword123!");

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
  const adminUid = adminRes.data?.userId;
  assertCheck(5, "Owner provisions Admin via employeesCreate (role_admin)", adminRes.ok && !!adminUid);

  const empEmail = `employee_e2e_${runId}@apex.local`;
  const empRes = await invokeCallable("employeesCreate", {
    organizationId: orgId,
    email: empEmail,
    name: "Apex Floor Staff",
    roleId: "role_employee",
    initialPassword: "TempPassword123!",
    idempotencyKey: `e2e_emp_staff_${runId}`,
    permissionOverrides: {
      "product:view": true, "inventory:view": true, "bill:create": true, "bill:view": true,
      "bill:update": true, "return:create": true, "payment:create": true, "customer:view": true,
    },
  }, ownerToken);
  const empUid = empRes.data?.userId;
  assertCheck(6, "Owner provisions Employee via employeesCreate (role_employee)", empRes.ok && !!empUid);

  // Verify membership documents
  const adminMem = (await db.collection("memberships").doc(`${adminUid}_${orgId}`).get()).data();
  assertCheck(7, "Admin membership document exists in Firestore with roleId 'role_admin'", adminMem?.roleId === "role_admin" && adminMem?.status === "active");

  const empMem = (await db.collection("memberships").doc(`${empUid}_${orgId}`).get()).data();
  assertCheck(8, "Employee membership document exists in Firestore with roleId 'role_employee'", empMem?.roleId === "role_employee" && empMem?.status === "active");

  const adminToken = await getIdToken(adminEmail, "TempPassword123!");
  const empToken = await getIdToken(empEmail, "TempPassword123!");

  // STEP 3: Admin creates Vendor, tracked Product with barcode, and Customer
  logStep("Admin creates Vendor, tracked Product with barcode, and Customer");
  const vendorRes = await invokeCallable("vendorsCreate", {
    organizationId: orgId,
    name: "Kerala Spice Suppliers Ltd",
    phone: "+919876543210",
    taxId: "32AABCK1234F1Z1",
    idempotencyKey: `e2e_vend_${runId}`,
  }, adminToken);
  const vendorId = vendorRes.data?.vendorId;
  assertCheck(9, "Admin creates Vendor via vendorsCreate", vendorRes.ok && !!vendorId);

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
  const productId = productRes.data?.productId;
  assertCheck(10, "Admin creates tracked Product with barcode via productsCreate", productRes.ok && !!productId);

  const customerRes = await invokeCallable("customersCreate", {
    organizationId: orgId,
    name: "Spice Bazaar Wholesalers",
    phone: "+919123456780",
    creditLimit: 50000,
    creditPeriodDays: 30,
    idempotencyKey: `e2e_cust_${runId}`,
  }, adminToken);
  const customerId = customerRes.data?.customerId;
  assertCheck(11, "Admin creates Customer via customersCreate", customerRes.ok && !!customerId);

  // Assert initial document states
  const prodDocSnap = (await db.collection("products").doc(productId).get()).data();
  assertCheck(12, "Initial product document has currentStock 0 and matches barcode", prodDocSnap?.currentStock === 0 && prodDocSnap?.barcode === barcodeVal);

  const vendorDocSnap = (await db.collection("vendors").doc(vendorId).get()).data();
  assertCheck(13, "Initial vendor document has outstandingPayable 0", vendorDocSnap?.outstandingPayable === 0);

  const customerDocSnap = (await db.collection("customers").doc(customerId).get()).data();
  assertCheck(14, "Initial customer document has outstandingBalance 0", customerDocSnap?.outstandingBalance === 0);

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
  const outflowId = purchaseRes.data?.outflowId;
  assertCheck(15, "Admin records Purchase Outflow via outflowsCreate with PUR- series", purchaseRes.ok && /^PUR-\d{4}-\d{6}$/.test(purchaseRes.data?.outflowNumber));

  // Verify stock was updated to 100
  const stockAfterPurchase = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  assertCheck(16, "Purchase atomically increments product currentStock to 100", stockAfterPurchase === 100);

  // Verify 1 stock movement created (+100)
  const purchaseMovements = await db.collection("stockMovements")
    .where("referenceId", "==", outflowId)
    .get();
  assertCheck(17, "Purchase creates exactly 1 stock movement (+100)", purchaseMovements.docs.length === 1 && purchaseMovements.docs[0].data()?.quantity === 100);

  // Verify vendor outstandingPayable set to 20,000
  const vendorAfterPur = (await db.collection("vendors").doc(vendorId).get()).data();
  assertCheck(18, "Vendor outstandingPayable and totalPurchase set to Rs 20,000", vendorAfterPur?.outstandingPayable === 20000 && vendorAfterPur?.totalPurchase === 20000);

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
  assertCheck(19, "Admin records partial vendor payment of Rs 8,000 with PAY- series", payVendRes.ok && /^PAY-\d{4}-\d{6}$/.test(payVendRes.data?.paymentNumber));

  // Verify outflow document settlement
  const outflowDocSnap = (await db.collection("outflows").doc(outflowId).get()).data();
  assertCheck(20, "Outflow settled: paidAmount=8000, balanceAmount=12000, status=partial", outflowDocSnap?.paidAmount === 8000 && outflowDocSnap?.balanceAmount === 12000 && outflowDocSnap?.paymentStatus === "partial");

  // Verify vendor outstandingPayable reduced to 12,000
  const vendorAfterPay = (await db.collection("vendors").doc(vendorId).get()).data();
  assertCheck(21, "Vendor outstandingPayable reduced to Rs 12,000", vendorAfterPay?.outstandingPayable === 12000);

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
  const quotationBillId = qtnRes.data?.billId;
  const quotationNumber = qtnRes.data?.billNumber;
  assertCheck(22, "Employee creates B2B quotation via billsCreate with QTN- series in draft status", qtnRes.ok && /^QTN-\d{4}-\d{6}$/.test(quotationNumber) && qtnRes.data?.status === "draft");

  // Verify product stock is STILL 100 (unaffected!)
  const stockAfterQtn = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  const qtnMovements = await db.collection("stockMovements")
    .where("referenceId", "==", quotationBillId)
    .get();
  assertCheck(23, "B2B quotation leaves physical stock unchanged (100) and creates 0 stock movements", stockAfterQtn === 100 && qtnMovements.empty);

  // Verify customer balance STILL 0
  const custAfterQtn = (await db.collection("customers").doc(customerId).get()).data();
  assertCheck(24, "B2B quotation leaves customer receivable balance unchanged (0)", custAfterQtn?.outstandingBalance === 0);

  // STEP 7: Employee finalizes quotation -> verifies INV- number, stock decremented (-20), customer balance (7000)
  logStep("Employee finalizes quotation into active Tax Invoice via billsFinalize");
  const finRes = await invokeCallable("billsFinalize", {
    organizationId: orgId,
    billId: quotationBillId,
    idempotencyKey: `e2e_fin_${runId}`,
  }, empToken);
  const finalizedInvoiceNumber = finRes.data?.billNumber;
  assertCheck(25, "Employee finalizes quotation into active Tax Invoice with INV- series", finRes.ok && /^INV-\d{4}-\d{6}$/.test(finalizedInvoiceNumber) && finRes.data?.status === "active");

  // Verify bill document fields
  const billDocSnap = (await db.collection("bills").doc(quotationBillId).get()).data();
  assertCheck(26, "Finalized invoice preserves originalQuotationNumber and records finalizedBy", billDocSnap?.billNumber === finalizedInvoiceNumber && billDocSnap?.originalQuotationNumber === quotationNumber && billDocSnap?.finalizedBy === empUid);

  // Verify product stock decremented: 100 -> 80
  const stockAfterFin = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  assertCheck(27, "Invoice atomically decrements product currentStock from 100 to 80", stockAfterFin === 80);

  // Verify exactly 1 stock movement created (-20)
  const finMovements = await db.collection("stockMovements")
    .where("referenceId", "==", quotationBillId)
    .get();
  assertCheck(28, "Invoice creates exactly 1 sale_out stock movement (-20)", finMovements.docs.length === 1 && finMovements.docs[0].data()?.quantity === -20 && finMovements.docs[0].data()?.type === "sale_out");

  // Verify customer ledger balance updated: Rs 7,000 (20 * 350)
  const custAfterFin = (await db.collection("customers").doc(customerId).get()).data();
  assertCheck(29, "Customer ledger balance updated to Rs 7,000", custAfterFin?.outstandingBalance === 7000 && custAfterFin?.totalSpend === 7000);

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
  assertCheck(30, "Customer makes partial payment of Rs 3,000 via paymentsCreate", payCustRes.ok && /^PAY-\d{4}-\d{6}$/.test(payCustRes.data?.paymentNumber));

  // Verify bill document settlement
  const billAfterPay = (await db.collection("bills").doc(quotationBillId).get()).data();
  assertCheck(31, "Bill document updated: paidAmount=3000, balanceAmount=4000, status=partial", billAfterPay?.paidAmount === 3000 && billAfterPay?.balanceAmount === 4000 && billAfterPay?.paymentStatus === "partial");

  // Verify customer balance decreased to 4,000 (7,000 - 3,000)
  const custAfterPay = (await db.collection("customers").doc(customerId).get()).data();
  assertCheck(32, "Customer outstanding balance reduced to Rs 4,000", custAfterPay?.outstandingBalance === 4000);

  // STEP 9: Process partial sale return -> verifies over-return rejection, stock restocked (+5), customer credit (-1750)
  logStep("Customer processes partial sale return (5 units @ Rs 350 = Rs 1,750)");
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
  assertCheck(33, "Over-return of 25 on 20 units rejected with 400 INVALID_ARGUMENT", overRetRes.status === 400 && overRetRes.error?.status === "INVALID_ARGUMENT" && /remain returnable/.test(overRetRes.error?.message));

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
  const returnNumber = validRetRes.data?.returnNumber;
  assertCheck(34, "Valid return of 5 units processed with RET- series and credit_note refund", validRetRes.ok && /^RET-\d{4}-\d{6}$/.test(returnNumber));

  // Verify stock was restored from 80 -> 85
  const stockAfterReturn = (await db.collection("products").doc(productId).get()).data()?.currentStock;
  const returnMovements = await db.collection("stockMovements")
    .where("referenceId", "==", validRetRes.data?.returnId)
    .get();
  assertCheck(35, "Return atomically restores stock from 80 to 85 (+5 sale_return_in)", stockAfterReturn === 85 && returnMovements.docs.length === 1 && returnMovements.docs[0].data()?.quantity === 5 && returnMovements.docs[0].data()?.type === "sale_return_in");

  // Verify bill line returnedQty updated & customer balance credited
  const billAfterReturn = (await db.collection("bills").doc(quotationBillId).get()).data();
  const custAfterReturn = (await db.collection("customers").doc(customerId).get()).data();
  assertCheck(36, "Customer balance credited by refund amount to Rs 2,250 and bill line returnedQty is 5", custAfterReturn?.outstandingBalance === 2250 && billAfterReturn?.items[0]?.returnedQty === 5);

  // STEP 10: Run reconcileStockBalances & reconcilePartyLedgers -> verifies 0 discrepancies
  logStep("Run reconciliation tools: reconcileStockBalances & reconcilePartyLedgers");
  const stockRecon = await invokeCallable("reconcileStockBalances", {
    organizationId: orgId,
  }, adminToken);

  const custRecon = await invokeCallable("reconcilePartyLedgers", {
    organizationId: orgId,
    partyType: "customer",
  }, adminToken);

  const vendRecon = await invokeCallable("reconcilePartyLedgers", {
    organizationId: orgId,
    partyType: "vendor",
  }, adminToken);

  assertCheck(37, "Reconciliation tools report 0 stock discrepancies and 0 customer/vendor ledger discrepancies", 
    stockRecon.ok && stockRecon.data?.discrepancyCount === 0 &&
    custRecon.ok && custRecon.data?.discrepancyCount === 0 &&
    vendRecon.ok && vendRecon.data?.discrepancyCount === 0
  );

  console.log("\n================================================================================");
  console.log("   ALL 10 CONNECTED E2E BUSINESS LIFECYCLE STEPS PASSED SUCCESSFULLY ✓           ");
  console.log("================================================================================\n");
}

runE2EBusinessFlow().catch((err) => {
  console.error("E2E Business Flow Failed:", err);
  process.exit(1);
});

