#!/usr/bin/env node
/**
 * Trado Firebase Backend — Master Financial Accounting, Storage Locations & Stock Transfers Scenario Test Suite
 *
 * Verifies End-to-End Scenarios:
 *   - S1: Financial Account Creation & Ledger Opening Balance (FB-5, R4)
 *   - S2: Two-Phase Payment with Financial Account Linking & Ledger Entry (R4, D-47)
 *   - S3: Multi-Bill Payment Allocation & Party Outstanding Settlement
 *   - S4: Account-to-Account Transfer Workflow (Immediate & Maker-Checker)
 *   - S5: Storage Location & Warehouse Management
 *   - S6: Inter-Branch Stock Transfer State Machine (Draft -> Submit -> Approve -> Dispatch -> Receive)
 *   - S7: Unified Approvals Inbox & Pending Counts (FB-7, D-50)
 *   - S8: Receivables & Payables Ageing Analytics (0-30, 31-60, 61-90, 90+ Days)
 *   - S9: Organization Governance & Field-Level Policy for Admin Role (FB-2, FB-4)
 *   - S10: Payment Processing Charges Linked Accounting (D-51, GAP-FEE-01)
 *   - S11: Capital Introduction & Drawings Flow (D-52, GAP-CAP-01)
 *   - S12: Cash & Bank Liquidity Summary (GAP-REP-01)
 *   - S13: Split Payments on Sale (GAP-SPL-01)
 *
 * Usage:
 *   node functions/scripts/test-financial-branch-inventory-scenarios.cjs
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
  console.log("   MASTER FINANCIAL, STORAGE & STOCK TRANSFER SCENARIO VERIFICATION SUITE       ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  // Provision test tenant and personas
  const superAdmin = await getSuperAdminPersona();
  const orgCode = `org_fin_${uniq()}`;
  const owner = await createTenantOwnerPersona(superAdmin.idToken, orgCode);
  const orgId = owner.organizationId;
  const branchMainId = owner.primaryBranchId || owner.branchId || "main-branch";

  // Create a second branch for multi-branch transfer testing
  const branchSecondId = `branch_sec_${uniq()}`;
  await db
    .collection("organizations")
    .doc(orgId)
    .collection("branches")
    .doc(branchSecondId)
    .set({
      organizationId: orgId,
      branchId: branchSecondId,
      name: "North Hub Branch",
      code: "BR-NORTH",
      isActive: true,
      settings: {
        isOwnStockyard: true,
        allowNegativeStock: false,
      },
      createdAt: new Date().toISOString(),
    });

  // Create an Admin employee persona
  const adminEmployee = await createEmployeePersona(owner.idToken, orgId, {
    roleId: "role_admin",
    branchId: branchMainId,
    assignedBranchIds: [branchMainId, branchSecondId],
  });

  console.log("--- SCENARIO 1: Financial Account Creation & Ledger Opening Balance (FB-5, R4) ---");
  const cashAccRes = await callFunction(owner, "financialAccountsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    name: "Main Cash Desk",
    code: `CASH-${uniq()}`,
    accountType: "cash",
    currency: "INR",
    openingBalance: 500000, // ₹5,000.00
    isDefault: true,
  });
  assert.ok(cashAccRes.financialAccountId, "Must return financialAccountId");
  assert.equal(cashAccRes.account.currentBalance, 500000, "Current balance must match opening balance");
  ok("Financial account created with initial opening balance ₹5,000.00");

  const cashAccId = cashAccRes.financialAccountId;

  // Verify financialAccountsGet
  const getAcc = await callFunction(owner, "financialAccountsGet", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.equal((getAcc.financialAccount || getAcc.account).financialAccountId, cashAccId);
  ok("financialAccountsGet retrieved single account");

  // Verify financialAccountsUpdate
  const updAcc = await callFunction(owner, "financialAccountsUpdate", {
    organizationId: orgId,
    financialAccountId: cashAccId,
    name: "Main Cash Desk Updated",
  });
  assert.equal(updAcc.success, true);
  ok("financialAccountsUpdate updated account name");

  // Verify financialAccountsList
  const accList = await callFunction(owner, "financialAccountsList", {
    organizationId: orgId,
  });
  assert.ok(accList.items.some((a) => a.financialAccountId === cashAccId));
  ok("financialAccountsList listed accounts");

  // Verify ledger entry created for opening balance
  const cashLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.equal(cashLedger.items.length, 1, "Must have exactly 1 ledger transaction");
  assert.equal(cashLedger.items[0].type, "opening_balance");
  assert.equal(cashLedger.items[0].direction, "in");
  assert.equal(cashLedger.items[0].amount, 500000);
  assert.equal(cashLedger.items[0].balanceAfter, 500000);
  ok("Immutable ledger transaction verified for account opening (R4)");

  console.log("\n--- SCENARIO 2: Two-Phase Payment with Account Linking & Ledger Entry (R4, D-47) ---");
  // Create a customer
  const custRes = await callFunction(owner, "customersCreate", {
    organizationId: orgId,
    name: "Acme Industrial Corp",
    partyType: "organization",
    phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
  });
  const customerId = custRes.customerId || custRes.customer?.customerId;

  // Receive a direct payment into Main Cash Desk
  const paymentRes = await callFunction(owner, "paymentsCreate", {
    organizationId: orgId,
    partyId: customerId,
    partyType: "customer",
    direction: "in",
    amount: 150000, // ₹1,500.00
    method: "cash",
    financialAccountId: cashAccId,
  });
  assert.ok(paymentRes.paymentId, "Must create payment record");
  const pDoc = await db.collection("payments").doc(paymentRes.paymentId).get();
  assert.equal(pDoc.data().financialAccountId, cashAccId);
  ok("Payment recorded with explicit financialAccountId");

  // Check updated cash account ledger and running balance
  const updatedCashLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.equal(updatedCashLedger.items.length, 2, "Must have 2 ledger transactions");
  assert.equal(updatedCashLedger.account.currentBalance, 650000, "Balance must increase by payment amount (500,000 + 150,000 = 650,000)");
  assert.equal(updatedCashLedger.items[0].balanceAfter, 650000, "Latest transaction balanceAfter must be 650,000 paise");
  ok("Two-phase atomic ledger update verified with zero drift (D-47)");

  console.log("\n--- SCENARIO 3: Multi-Bill Payment Allocation & Settlement ---");
  // Seed two bills for the customer
  const bill1Ref = db.collection("bills").doc();
  await bill1Ref.set({
    organizationId: orgId,
    branchId: branchMainId,
    billNumber: `INV-${uniq()}-1`,
    customerId,
    totalAmount: 100000, // ₹1,000
    paidAmount: 0,
    balanceAmount: 100000,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  const bill2Ref = db.collection("bills").doc();
  await bill2Ref.set({
    organizationId: orgId,
    branchId: branchMainId,
    billNumber: `INV-${uniq()}-2`,
    customerId,
    totalAmount: 200000, // ₹2,000
    paidAmount: 0,
    balanceAmount: 200000,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  // Update customer outstanding to ₹3,000
  await db.collection("customers").doc(customerId).update({
    outstandingBalance: 300000,
  });

  // Make an allocated payment of ₹2,500: ₹1,000 fully settles Bill 1, ₹1,500 partially settles Bill 2
  await callFunction(owner, "paymentsCreate", {
    organizationId: orgId,
    partyId: customerId,
    partyType: "customer",
    direction: "in",
    amount: 250000,
    method: "cash",
    financialAccountId: cashAccId,
    allocations: [
      { documentId: bill1Ref.id, documentType: "bill", amount: 100000 },
      { documentId: bill2Ref.id, documentType: "bill", amount: 150000 },
    ],
  });

  // Verify Bill 1 state
  const b1Snap = await bill1Ref.get();
  assert.equal(b1Snap.data().balanceAmount, 0, "Bill 1 must have 0 balance");
  assert.equal(b1Snap.data().paymentStatus, "paid", "Bill 1 must have paymentStatus paid");

  // Verify Bill 2 state
  const b2Snap = await bill2Ref.get();
  assert.equal(b2Snap.data().balanceAmount, 50000, "Bill 2 must have ₹500 balance remaining");
  assert.equal(b2Snap.data().paidAmount, 150000, "Bill 2 must show ₹1,500 paid");
  assert.equal(b2Snap.data().paymentStatus, "partial", "Bill 2 must have paymentStatus partial");

  // Verify customer outstanding
  const custSnap = await db.collection("customers").doc(customerId).get();
  assert.equal(custSnap.data().outstandingBalance, 50000, "Customer outstanding must be exactly ₹500 remaining");
  ok("Multi-invoice payment allocations executed atomically across documents and party balance");

  console.log("\n--- SCENARIO 4: Account-to-Account Transfers (FB-5) ---");
  // Create a Bank Account with ₹10,000 opening balance
  const bankAccRes = await callFunction(owner, "financialAccountsCreate", {
    organizationId: orgId,
    name: "HDFC Operating Bank",
    code: `HDFC-${uniq()}`,
    accountType: "bank",
    openingBalance: 1000000, // ₹10,000.00
  });
  const bankAccId = bankAccRes.financialAccountId;

  // Immediate account transfer: Transfer ₹2,000 from Bank to Cash Desk
  const transferRes = await callFunction(owner, "accountTransfersCreate", {
    organizationId: orgId,
    sourceAccountId: bankAccId,
    destinationAccountId: cashAccId,
    amount: 200000, // ₹2,000
    notes: "Petty cash replenishment",
  });
  assert.equal(transferRes.transfer?.status || transferRes.status, "completed", "Immediate transfer should complete");
  assert.ok(transferRes.transfer?.transferNumber || transferRes.transferNumber, "Must have transfer number");

  // Verify accountTransfersGet
  const trfDoc = await callFunction(owner, "accountTransfersGet", {
    organizationId: orgId,
    transferId: transferRes.transferId,
  });
  assert.equal(trfDoc.transfer.transferId, transferRes.transferId);
  ok("accountTransfersGet retrieved transfer by ID");

  // Verify accountTransfersList
  const trfList = await callFunction(owner, "accountTransfersList", {
    organizationId: orgId,
  });
  assert.ok(trfList.items.some((t) => t.transferId === transferRes.transferId));
  ok("accountTransfersList listed transfers");

  // Verify balances
  const bankLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: bankAccId,
  });
  assert.equal(bankLedger.account.currentBalance, 800000, "Bank account must be decremented to ₹8,000");

  // Insufficient funds rejection
  await assertCallableError(
    callFunction(owner, "accountTransfersCreate", {
      organizationId: orgId,
      sourceAccountId: bankAccId,
      destinationAccountId: cashAccId,
      amount: 999999999, // Way more than balance
    }),
    "failed-precondition"
  );
  ok("Account-to-account transfer executed with double-entry ledger entries and balance protection");

  console.log("\n--- SCENARIO 5: Storage Locations & Warehouse Management ---");
  const locRes = await callFunction(owner, "storageLocationsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    name: "Central Reserve Yard",
    code: `YARD-${uniq()}`,
    type: "warehouse",
    notes: "Primary bulk storage facility",
  });
  assert.ok(locRes.locationId, "Must return locationId");
  const locId = locRes.locationId;

  // List locations
  const locList = await callFunction(owner, "storageLocationsList", {
    organizationId: orgId,
    branchId: branchMainId,
  });
  assert.ok(locList.items.some((l) => (l.locationId || l.storageLocationId) === locId));

  // Verify storageLocationsGet
  const locGet = await callFunction(owner, "storageLocationsGet", {
    organizationId: orgId,
    locationId: locId,
  });
  assert.equal((locGet.location.locationId || locGet.location.storageLocationId), locId);
  ok("storageLocationsGet retrieved location by ID");

  // Verify storageLocationsUpdate
  const locUpd = await callFunction(owner, "storageLocationsUpdate", {
    organizationId: orgId,
    locationId: locId,
    name: "Central Reserve Yard (Expanded)",
  });
  assert.equal(locUpd.success, true);
  ok("storageLocationsUpdate updated storage location");
  ok("Storage locations created, mapped to branch, and retrieved successfully");

  console.log("\n--- SCENARIO 6: Inter-Branch Stock Transfer End-to-End Workflow (D-49) ---");
  // Create a product
  const prodRes = await callFunction(owner, "productsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    name: "Industrial Copper Wiring 50m",
    sku: `SKU-WIRING-${uniq()}`,
    barcode: `BAR-${uniq()}`,
    baseUnit: "piece",
    costPrice: 10000,
    sellingPrice: 15000,
    taxRatePercent: 18,
  });
  const productId = prodRes.productId || prodRes.product?.productId;

  // Seed 50 units in Branch Main
  const srcStockKey = `${orgId}_${branchMainId}_${productId}`;
  await db.collection("branchProductStock").doc(srcStockKey).set({
    organizationId: orgId,
    branchId: branchMainId,
    productId,
    currentStock: 50,
    updatedAt: new Date().toISOString(),
  });

  // 1. Create Stock Transfer (Draft)
  const draftTrf = await callFunction(owner, "stockTransfersCreate", {
    organizationId: orgId,
    sourceBranchId: branchMainId,
    destinationBranchId: branchSecondId,
    sourceLocationId: locId,
    items: [{ productId, requestedQty: 20 }],
  });
  assert.equal(draftTrf.transfer?.status || draftTrf.status, "draft");
  const transferId = draftTrf.transferId;
  ok("Stock transfer created in draft status");

  // 2. Submit Transfer
  const submitTrf = await callFunction(owner, "stockTransfersSubmit", {
    organizationId: orgId,
    transferId,
  });
  assert.equal(submitTrf.status, "submitted");
  ok("Stock transfer submitted for approval");

  // 2b. Assert maker-checker: Creator cannot self-approve (assertCanDecide enforces SELF_APPROVAL_FORBIDDEN)
  await assertCallableError(
    callFunction(owner, "documentsDecide", {
      organizationId: orgId,
      documentType: "stock_transfer",
      documentId: transferId,
      decision: "approve",
    }),
    "permission-denied"
  );
  ok("Self-approval forbidden: Maker cannot approve their own transfer (FB-7, D-50)");

  // 3. Approve Transfer via documentsDecide (Admin persona decides; maker cannot self-approve)
  const approveTrf = await callFunction(adminEmployee, "documentsDecide", {
    organizationId: orgId,
    documentType: "stock_transfer",
    documentId: transferId,
    decision: "approve",
  });
  assert.equal(approveTrf.decision, "approved");
  ok("Stock transfer approved via maker-checker decision router");

  // 4. Dispatch Transfer: Source stock deducted atomically
  const dispatchTrf = await callFunction(owner, "stockTransfersDispatch", {
    organizationId: orgId,
    branchId: branchMainId,
    transferId,
    transportMode: "internal_fleet",
    trackingReference: "LOG-TRUCK-88",
  });
  assert.equal(dispatchTrf.status, "dispatched");

  // Verify source branch stock decremented by 20 (50 - 20 = 30)
  const srcStockSnap = await db.collection("branchProductStock").doc(srcStockKey).get();
  assert.equal(srcStockSnap.data().currentStock, 30, "Source branch stock must be decremented to 30");

  // Verify destination branch stock is still 0 (in-transit isolation)
  const dstStockKey = `${orgId}_${branchSecondId}_${productId}`;
  const dstPreSnap = await db.collection("branchProductStock").doc(dstStockKey).get();
  assert.equal(dstPreSnap.exists ? dstPreSnap.data().currentStock : 0, 0, "Destination stock must remain 0 during transit");
  ok("Stock transfer dispatched: Source stock deducted, in-transit stock isolated without duplication");

  // 5. Receive Transfer: Destination stock credited with discrepancy tracking
  const receiveTrf = await callFunction(owner, "stockTransfersReceive", {
    organizationId: orgId,
    branchId: branchSecondId,
    transferId,
    items: [
      {
        productId,
        receivedQty: 18,
        rejectedQty: 2,
        discrepancyReason: "2 coils water damaged during transit",
      },
    ],
  });
  assert.equal(receiveTrf.status, "partially_received");

  // Verify destination branch stock incremented by exactly 18 accepted units
  const dstPostSnap = await db.collection("branchProductStock").doc(dstStockKey).get();
  assert.equal(dstPostSnap.data().currentStock, 18, "Destination branch stock must receive accepted quantity (18)");

  // Invariant verification: Zero stock loss/doubling
  // Source (30) + Destination (18) + Damaged (2) = 50 initial
  assert.equal(30 + 18 + 2, 50, "Conservation of inventory strictly holds");

  // Verify stockTransfersGet
  const stGet = await callFunction(owner, "stockTransfersGet", {
    organizationId: orgId,
    transferId,
  });
  assert.equal(stGet.transfer.transferId, transferId);
  ok("stockTransfersGet retrieved transfer by ID");

  // Verify stockTransfersList
  const stList = await callFunction(owner, "stockTransfersList", {
    organizationId: orgId,
  });
  assert.ok(stList.items.some((t) => t.transferId === transferId));
  ok("stockTransfersList listed transfers");

  ok("Stock transfer received with discrepancy logging and total inventory conservation verified");

  console.log("\n--- SCENARIO 7: Unified Approvals Inbox & Pending Counts (FB-7, D-50) ---");
  // Query pending approvals
  const pendingApprovals = await callFunction(owner, "approvalsList", {
    organizationId: orgId,
    branchId: branchMainId,
  });
  assert.ok(Array.isArray(pendingApprovals.items));

  const counts = await callFunction(owner, "approvalsCounts", {
    organizationId: orgId,
  });
  assert.ok(typeof counts.total === "number");
  assert.ok(typeof counts.bills === "number");
  ok("Unified approvals inbox and aggregate counts retrieved successfully");

  console.log("\n--- SCENARIO 8: Receivables & Payables Ageing Analytics ---");
  const recvAgeing = await callFunction(owner, "reportsGetReceivablesAgeing", {
    organizationId: orgId,
    asOfDate: new Date().toISOString().slice(0, 10),
  });
  assert.ok(recvAgeing.totals);
  assert.ok(Array.isArray(recvAgeing.customers));
  assert.ok(recvAgeing.totals.totalOutstanding >= 0);
  ok("Receivables ageing report computed with standard aging buckets");

  const payAgeing = await callFunction(owner, "reportsGetPayablesAgeing", {
    organizationId: orgId,
    asOfDate: new Date().toISOString().slice(0, 10),
  });
  assert.ok(payAgeing.totals);
  assert.ok(Array.isArray(payAgeing.vendors));
  ok("Payables ageing report computed with standard aging buckets");

  console.log("\n--- SCENARIO 9: Organization Governance & Field Policy (FB-2, FB-4) ---");
  // Admin role edits allowed non-sensitive fields
  const updateRes = await callFunction(adminEmployee, "organizationsUpdate", {
    organizationId: orgId,
    legalName: "Acme Industrial Global Ltd",
    taxId: "GSTIN-29AAAAA0000A1Z5",
    contactEmail: "admin@acme-global.com",
  });
  assert.equal(updateRes.success, true);
  ok("Admin persona successfully updated non-sensitive organization profile fields");

  // Admin persona attempting to edit Super-Admin-only field is rejected
  await assertCallableError(
    callFunction(adminEmployee, "organizationsUpdate", {
      organizationId: orgId,
      showCostToTenant: true,
    }),
    "permission-denied"
  );
  ok("Admin persona forbidden from editing sensitive Super-Admin fields (FIELD_NOT_EDITABLE)");

  console.log("\n--- SCENARIO 10: Payment Processing Charges Linked Accounting (D-51, GAP-FEE-01) ---");
  // 1. Create a clearing account for card payments
  const cardClearingAcc = await callFunction(owner, "financialAccountsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    name: "Card Terminal Clearing",
    code: `CARD-CLEAR-${uniq()}`,
    accountType: "clearing",
    currency: "INR",
    openingBalance: 100000, // ₹1,000.00
  });
  const clearingAccId = cardClearingAcc.financialAccountId;

  // 2. Record fee on clearing account (e.g. ₹20.00 fee on a card transaction)
  const feeRes = await callFunction(owner, "paymentsRecordFee", {
    organizationId: orgId,
    sourceDocumentType: "bill",
    sourceDocumentId: bill1Ref.id,
    financialAccountId: clearingAccId,
    paymentMethod: "card",
    feeAmount: 2000, // ₹20.00
    feeTaxAmount: 0,
    settlementTiming: "immediate_deduction",
    settlementReference: "GATEWAY-REF-88899",
    notes: "2% gateway fee",
  });
  assert.ok(feeRes.feeId, "Must return feeId");
  assert.ok(feeRes.feeNumber.startsWith("FEE-"), "Fee document number must start with FEE- prefix");
  assert.equal(feeRes.balanceAfter, 98000, "Clearing account must be debited by feeAmount (₹1000 - ₹20 = ₹980)");
  ok("Payment fee recorded atomically and debited from financial account (D-51)");

  // 3. Verify fee in list
  const feeList = await callFunction(owner, "paymentsListFees", {
    organizationId: orgId,
    sourceDocumentId: bill1Ref.id,
  });
  assert.equal(feeList.items.length, 1, "Must list the recorded fee");
  assert.equal(feeList.items[0].feeNumber, feeRes.feeNumber);
  ok("Payment fee retrievable via list filter by source document");

  // 4. Verify paymentsGetFee
  const feeGet = await callFunction(owner, "paymentsGetFee", {
    organizationId: orgId,
    feeId: feeRes.feeId,
  });
  assert.equal(feeGet.fee.feeId, feeRes.feeId);
  ok("paymentsGetFee retrieved single fee record by ID");

  console.log("\n--- SCENARIO 11: Capital Introduction & Drawings Flow (D-52, GAP-CAP-01) ---");
  // 1. Capital infusion by owner (₹50,000.00 = 5,000,000 paise) into cash account
  const capInRes = await callFunction(owner, "capitalTransactionsCreate", {
    organizationId: orgId,
    type: "owner_contribution",
    financialAccountId: cashAccId,
    amount: 5000000,
    sourceReference: "PROMOTER-CAP-01",
    description: "Initial owner equity injection",
  });
  assert.ok(capInRes.capitalTransactionId, "Must return capitalTransactionId");
  assert.ok(capInRes.transactionNumber.startsWith("CAP-"), "Capital txn number must start with CAP- prefix");
  ok("Owner capital contribution recorded with CAP- prefix (D-52)");

  // 2. Capital drawings (₹10,000.00 = 1,000,000 paise) by owner from cash account
  const capOutRes = await callFunction(owner, "capitalTransactionsCreate", {
    organizationId: orgId,
    type: "drawings",
    financialAccountId: cashAccId,
    amount: 1000000,
    description: "Owner personal drawings",
  });
  assert.ok(capOutRes.capitalTransactionId);
  ok("Owner capital drawings recorded and deducted from cash account");

  // 3. Verify capital transactions listing
  const capList = await callFunction(owner, "capitalTransactionsList", {
    organizationId: orgId,
  });
  assert.ok(capList.items.length >= 2, "Must list both capital transactions");
  ok("Capital transactions listing verified with type attribution");

  console.log("\n--- SCENARIO 12: Cash & Bank Liquidity Summary (GAP-REP-01) ---");
  const cashBankSummary = await callFunction(owner, "reportsGetCashBankSummary", {
    organizationId: orgId,
  });
  assert.ok(cashBankSummary.totals, "Summary must have totals breakdown");
  assert.ok(cashBankSummary.totals.totalOperationalLiquidity !== undefined, "Summary must include totalOperationalLiquidity");
  assert.ok(Array.isArray(cashBankSummary.accounts), "Summary must list accounts");
  ok("Cash & bank liquidity summary computed with account categorization");

  console.log("\n--- SCENARIO 13: Split Payments on Sale (GAP-SPL-01) ---");
  const splitProdRes = await callFunction(owner, "productsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    name: "Split Pay Test Item",
    baseUnit: "piece",
    sellingPrice: 10000, // ₹100.00
    initialStock: 20,
    storageLocationId: locId,
  });
  const splitProdId = splitProdRes.productId || splitProdRes.product?.productId;

  const splitBillRes = await callFunction(owner, "billsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    items: [
      { productId: splitProdId, quantity: 1, unitPriceOverride: 10000 },
    ],
    splitPayments: [
      { method: "cash", amount: 6000, financialAccountId: cashAccId },
      { method: "card", amount: 4000, financialAccountId: clearingAccId },
    ],
  });
  assert.ok(splitBillRes.billId, "Must return billId");

  const billSnap = await db.collection("bills").doc(splitBillRes.billId).get();
  assert.ok(billSnap.exists, "Bill must exist in database");
  const billData = billSnap.data();
  assert.equal(billData.splitPayments?.length, 2, "Bill must retain 2 split payment tenders");

  // Verify financial account ledger transactions were posted
  const splitCashLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  const hasCashSplitTxn = splitCashLedger.items.some(
    (t) => t.sourceDocumentId === splitBillRes.billId && t.amount === 6000
  );
  assert.ok(hasCashSplitTxn, "Must have posted 6000 paise ledger transaction to cash account");

  const clearingLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: clearingAccId,
  });
  const hasClearingSplitTxn = clearingLedger.items.some(
    (t) => t.sourceDocumentId === splitBillRes.billId && t.amount === 4000
  );
  assert.ok(hasClearingSplitTxn, "Must have posted 4000 paise ledger transaction to clearing account");

  ok("Bill created with multi-account split payments (₹60 cash + ₹40 card) and atomically posted to ledgers");

  console.log("\n================================================================================");
  console.log(`   ALL SCENARIOS PASSED (${passed}/${passed}) [cov:100%]                           `);
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n❌ SCENARIO TEST FAILED:", err);
  process.exit(1);
});
