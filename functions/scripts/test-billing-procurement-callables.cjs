/**
 * Trado Firebase Backend — Billing & Procurement Callables Contract Test
 * 
 * Tests 9 exports across sales billing, outflows (purchases/expenses), and returns:
 * 1. outflowsCreate
 * 2. outflowsList
 * 3. outflowsGet
 * 4. billsCreate
 * 5. billsFinalize
 * 6. billsList
 * 7. billsGet
 * 8. returnsCreate
 * 9. returnsList
 */

const assert = require("node:assert/strict");
const { verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { createTenantOwnerPersona, createUnassignedUserPersona } = require("./helpers/auth-personas.cjs");
const { buildProductPayload, buildCustomerPayload, buildVendorPayload } = require("./helpers/domain-builders.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: BILLING & PROCUREMENT CALLABLES CONTRACT                   ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  console.log("[SETUP] Provisioning test personas...");
  const owner = await createTenantOwnerPersona({
    businessName: "Billing & Procurement Superstore",
    defaultBranchName: "Main Hypermarket",
    defaultBranchCode: "HYPER",
  });
  const unassigned = await createUnassignedUserPersona();
  const ownerToken = owner.idToken;
  const orgId = owner.organizationId;
  console.log(`✓ Tenant Owner authenticated: ${owner.email} (Org: ${orgId})\n`);

  // Provision test product, customer, and vendor
  console.log("[SETUP] Provisioning test entities (Product, Customer, Vendor)...");
  const prodRes = await callFunction("productsCreate", buildProductPayload(orgId, {
    name: "Organic Honey 500g",
    sellingPrice: 450,
    costPrice: 300,
    initialStock: 100,
    trackStock: true,
  }), ownerToken);
  const productId = prodRes.productId;

  const custRes = await callFunction("customersCreate", buildCustomerPayload(orgId, {
    name: "Vikram Sharma",
    phone: "+919988776655",
  }), ownerToken);
  const customerId = custRes.customerId;

  const vendRes = await callFunction("vendorsCreate", buildVendorPayload(orgId, {
    name: "Pure Agro Organics",
    phone: "+919988112233",
  }), ownerToken);
  const vendorId = vendRes.vendorId;
  console.log(`✓ Test entities ready: Product ${productId}, Customer ${customerId}, Vendor ${vendorId}\n`);

  // ============================================================
  // 1. Outflows Lifecycle: Create (Purchase), List, Get
  // ============================================================
  console.log("[DOMAIN: OUTFLOWS] Testing outflowsCreate, outflowsList, outflowsGet...");

  // Unassigned user rejected
  await assertCallableError(
    callFunction("outflowsCreate", {
      organizationId: orgId,
      kind: "purchase",
      vendorId,
      lines: [
        {
          productId,
          quantity: 20,
          unit: "piece",
          unitPrice: 300,
          taxPercent: 5,
        },
      ],
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ outflowsCreate rejected unassigned user");

  // Create Purchase outflow (20 jars @ 300 = 6000 + 5% tax = 6300, paid 3000, balance 3300)
  const purchaseRes = await callFunction("outflowsCreate", {
    organizationId: orgId,
    kind: "purchase",
    vendorId,
    lines: [
      {
        productId,
        quantity: 20,
        unit: "piece",
        unitPrice: 300,
        taxPercent: 5,
      },
    ],
    paidAmount: 3000,
    paymentMethod: "bank_transfer",
    notes: "Restock PO #8892",
  }, ownerToken);

  assert.ok(purchaseRes.outflowId, "outflowsCreate must return outflowId");
  assert.ok(purchaseRes.outflowNumber.startsWith("PUR-") || purchaseRes.outflowNumber.startsWith("PO-"), `outflowNumber must start with PUR- or PO-, got ${purchaseRes.outflowNumber}`);
  assert.equal(purchaseRes.paidAmount, 3000);
  const outflowId = purchaseRes.outflowId;
  console.log(`✓ [outflowsCreate#ok] Purchase outflow created: ID ${outflowId}, Number: ${purchaseRes.outflowNumber}, Total: ₹${purchaseRes.totalAmount}, Bal: ₹${purchaseRes.balanceAmount}`);

  // Get outflow by ID
  const outflowGetRes = await callFunction("outflowsGet", {
    organizationId: orgId,
    outflowId,
  }, ownerToken);
  assert.equal(outflowGetRes.outflowId, outflowId);
  assert.equal(outflowGetRes.vendorId, vendorId);
  assert.equal(outflowGetRes.kind, "purchase");
  console.log("✓ [outflowsGet#ok] outflowsGet retrieved purchase outflow details");

  // Reject cross-tenant get
  const otherOwner = await createTenantOwnerPersona({ businessName: "Competitor Mart" });
  await assertCallableError(
    callFunction("outflowsGet", {
      organizationId: otherOwner.organizationId,
      outflowId,
    }, otherOwner.idToken),
    ["permission-denied", "not-found"]
  );
  console.log("✓ [outflowsGet#PERMISSION_DENIED] outflowsGet rejected cross-tenant access");

  // List outflows
  const outflowListRes = await callFunction("outflowsList", {
    organizationId: orgId,
    kind: "purchase",
  }, ownerToken);
  assert.ok(Array.isArray(outflowListRes.items));
  assert.ok(outflowListRes.items.some(o => o.outflowId === outflowId));
  console.log(`✓ [outflowsList#ok] outflowsList returned ${outflowListRes.items.length} purchase outflows`);

  // ============================================================
  // 2. Billing Lifecycle: Create (Draft & Active), Finalize, List, Get
  // ============================================================
  console.log("\n[DOMAIN: BILLS] Testing billsCreate (Active & Draft), billsFinalize, billsList, billsGet...");

  // Unassigned user rejected
  await assertCallableError(
    callFunction("billsCreate", {
      organizationId: orgId,
      salesMode: "pos",
      items: [{ productId, quantity: 2 }],
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ billsCreate rejected unassigned user");

  // Preview POS Bill (read-only pricing preview)
  const previewBillRes = await callFunction("billsPreview", {
    organizationId: orgId,
    salesMode: "pos",
    customerId,
    items: [
      {
        productId,
        quantity: 5,
        unitPriceOverride: 450,
      },
    ],
    paidAmount: 2250,
    paymentMethod: "upi",
  }, ownerToken);
  const calc = previewBillRes.calculation || previewBillRes;
  assert.ok(calc, "billsPreview must return calculation");
  assert.ok(Array.isArray(previewBillRes.warnings), "billsPreview must return warnings array");
  console.log(`✓ [billsPreview#ok] billsPreview returned live pricing preview (total: ₹${calc.grandTotal || calc.totalAmount})`);

  // Create Active POS Bill (immediate counter sale)
  const activeBillRes = await callFunction("billsCreate", {
    organizationId: orgId,
    salesMode: "pos",
    customerId,
    items: [
      {
        productId,
        quantity: 5,
        unitPriceOverride: 450,
      },
    ],
    paidAmount: 2250,
    paymentMethod: "upi",
    notes: "Counter POS sale",
  }, ownerToken);

  assert.ok(activeBillRes.billId, "billsCreate must return billId");
  assert.equal(activeBillRes.status, "active");
  const activeBillId = activeBillRes.billId;
  console.log(`✓ [billsCreate#ok] Active POS bill created: ID ${activeBillId}, Number: ${activeBillRes.billNumber}, Total: ₹${activeBillRes.totalAmount}`);

  // Create Draft / Quotation Bill
  const draftBillRes = await callFunction("billsCreate", {
    organizationId: orgId,
    salesMode: "b2b",
    status: "draft",
    customerId,
    items: [
      {
        productId,
        quantity: 10,
        unitPriceOverride: 400,
      },
    ],
    notes: "Proforma quotation for wholesale order",
  }, ownerToken);

  assert.ok(draftBillRes.billId);
  assert.equal(draftBillRes.status, "draft");
  const draftBillId = draftBillRes.billId;
  console.log(`✓ Draft Quotation bill created: ID ${draftBillId}, Number: ${draftBillRes.billNumber}, Status: draft`);

  // Finalize Draft Bill into official Active Invoice
  const finalizeRes = await callFunction("billsFinalize", {
    organizationId: orgId,
    billId: draftBillId,
  }, ownerToken);

  assert.ok(finalizeRes.billId);
  assert.equal(finalizeRes.status, "active");
  assert.ok(finalizeRes.billNumber.startsWith("INV-"), `Finalized bill must have INV- prefix, got ${finalizeRes.billNumber}`);
  console.log(`✓ [billsFinalize#ok] billsFinalize converted draft into active Invoice: ${finalizeRes.billNumber}`);

  // Get bill by ID
  const billGetRes = await callFunction("billsGet", {
    organizationId: orgId,
    billId: activeBillId,
  }, ownerToken);
  assert.equal(billGetRes.billId, activeBillId);
  assert.equal(billGetRes.customerId, customerId);
  console.log("✓ [billsGet#ok] billsGet retrieved bill details");

  // Reject cross-tenant get
  await assertCallableError(
    callFunction("billsGet", {
      organizationId: otherOwner.organizationId,
      billId: activeBillId,
    }, otherOwner.idToken),
    ["permission-denied", "not-found"]
  );
  console.log("✓ [billsGet#PERMISSION_DENIED] billsGet rejected cross-tenant access");

  // List bills
  const billListRes = await callFunction("billsList", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(Array.isArray(billListRes.items));
  assert.ok(billListRes.items.some(b => b.billId === activeBillId));
  assert.ok(billListRes.items.some(b => b.billId === draftBillId));
  console.log(`✓ [billsList#ok] billsList returned ${billListRes.items.length} bills`);

  // ============================================================
  // 3. Returns Lifecycle: Create, List
  // ============================================================
  console.log("\n[DOMAIN: RETURNS] Testing returnsCreate, returnsList...");

  // Unassigned user rejected
  await assertCallableError(
    callFunction("returnsCreate", {
      organizationId: orgId,
      returnType: "sales_return",
      referenceId: activeBillId,
      items: [
        {
          productId,
          quantity: 1,
          refundAmount: 450,
          reason: "Customer changed mind",
          disposition: "restocked_to_inventory",
        },
      ],
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ [returnsCreate#PERMISSION_DENIED] returnsCreate rejected unassigned user");

  // Create Sales Return against active bill
  const returnRes = await callFunction("returnsCreate", {
    organizationId: orgId,
    returnType: "sales_return",
    referenceId: activeBillId,
    items: [
      {
        productId,
        quantity: 1,
        refundAmount: 450,
        reason: "Customer bought excess",
        disposition: "restocked_to_inventory",
      },
    ],
    refundMethod: "cash",
    notes: "Counter return processed",
  }, ownerToken);

  assert.ok(returnRes.returnId, "returnsCreate must return returnId");
  assert.ok(returnRes.returnNumber.startsWith("RET-"), `returnNumber must start with RET-, got ${returnRes.returnNumber}`);
  const returnId = returnRes.returnId;
  console.log(`✓ [returnsCreate#ok] Sales return created: ID ${returnId}, Number: ${returnRes.returnNumber}, Refund: ₹${returnRes.totalRefundAmount}`);

  // List returns
  const returnListRes = await callFunction("returnsList", {
    organizationId: orgId,
    returnType: "sales_return",
  }, ownerToken);
  assert.ok(Array.isArray(returnListRes.items));
  assert.ok(returnListRes.items.some(r => r.returnId === returnId));
  console.log(`✓ [returnsList#ok] returnsList returned ${returnListRes.items.length} return records`);

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 9 BILLING & PROCUREMENT CALLABLES VERIFIED SUCCESSFULLY! ✓        ");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
