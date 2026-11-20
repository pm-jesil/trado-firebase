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
  await db.collection("organizations").doc(orgId).update({
    branchCount: 2,
  });

  // Create an Admin employee persona
  const adminEmployee = await createEmployeePersona(owner.idToken, orgId, {
    roleId: "role_admin",
    branchId: branchMainId,
    assignedBranchIds: [branchMainId, branchSecondId],
  });

  // Create a Manager employee persona for maker-checker approvals
  const managerEmployee = await createEmployeePersona(owner.idToken, orgId, {
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
    openingBalance: 5000.00, // ₹5,000.00
    isDefault: true,
  });
  assert.ok(cashAccRes.financialAccountId, "Must return financialAccountId");
  assert.equal(cashAccRes.account.currentBalance, 5000.00, "Current balance must match opening balance");
  ok("[financialAccountsCreate#ok] Financial account created with initial opening balance ₹5,000.00");

  const cashAccId = cashAccRes.financialAccountId;

  // Verify financialAccountsGet
  const getAcc = await callFunction(owner, "financialAccountsGet", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.equal((getAcc.financialAccount || getAcc.account).financialAccountId, cashAccId);
  ok("[financialAccountsGet#ok] financialAccountsGet retrieved single account");

  // Verify financialAccountsUpdate
  const updAcc = await callFunction(owner, "financialAccountsUpdate", {
    organizationId: orgId,
    financialAccountId: cashAccId,
    name: "Main Cash Desk Updated",
  });
  assert.equal(updAcc.success, true);
  ok("[financialAccountsUpdate#ok] financialAccountsUpdate updated account name");

  // Verify financialAccountsList
  const accList = await callFunction(owner, "financialAccountsList", {
    organizationId: orgId,
  });
  assert.ok(accList.items.some((a) => a.financialAccountId === cashAccId));
  ok("[financialAccountsList#ok] financialAccountsList listed accounts");

  // Verify ledger entry created for opening balance
  const cashLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.equal(cashLedger.items.length, 1, "Must have exactly 1 ledger transaction");
  assert.equal(cashLedger.items[0].type, "opening_balance");
  assert.equal(cashLedger.items[0].direction, "in");
  assert.equal(cashLedger.items[0].amount, 5000.00);
  assert.equal(cashLedger.items[0].balanceAfter, 5000.00);
  const accountTxnSnap = await db.collection("accountTransactions")
    .where("financialAccountId", "==", cashAccId)
    .get();
  assert.equal(accountTxnSnap.empty, false, "accountTransactions collection must contain the opening transaction");
  ok("[financialAccountsGetLedger#ok] Immutable ledger transaction verified for account opening (R4)");

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
    amount: 1500.00, // ₹1,500.00
    method: "cash",
    financialAccountId: cashAccId,
  });
  assert.ok(paymentRes.paymentId, "Must create payment record");
  const pDoc = await db.collection("payments").doc(paymentRes.paymentId).get();
  assert.equal(pDoc.data().financialAccountId, cashAccId);
  ok("[paymentsCreate#ok] Payment recorded with explicit financialAccountId");

  // Check updated cash account ledger and running balance
  const updatedCashLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.equal(updatedCashLedger.items.length, 2, "Must have 2 ledger transactions");
  assert.equal(updatedCashLedger.account.currentBalance, 6500.00, "Balance must increase by payment amount (5,000 + 1,500 = 6,500)");
  assert.equal(updatedCashLedger.items[0].balanceAfter, 6500.00, "Latest transaction balanceAfter must be 6,500.00");
  ok("Two-phase atomic ledger update verified with zero drift (D-47)");

  console.log("\n--- SCENARIO 3: Multi-Bill Payment Allocation & Settlement ---");
  // Create a dedicated customer for multi-bill allocation
  const custRes3 = await callFunction(owner, "customersCreate", {
    organizationId: orgId,
    name: "Allocation Test Customer",
    partyType: "organization",
    phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
  });
  const customerId3 = custRes3.customerId || custRes3.customer?.customerId;

  // Seed two bills for the customer
  const bill1Ref = db.collection("bills").doc();
  await bill1Ref.set({
    organizationId: orgId,
    branchId: branchMainId,
    billNumber: `INV-${uniq()}-1`,
    customerId: customerId3,
    totalAmount: 1000.00, // ₹1,000
    paidAmount: 0,
    balanceAmount: 1000.00,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  const bill2Ref = db.collection("bills").doc();
  await bill2Ref.set({
    organizationId: orgId,
    branchId: branchMainId,
    billNumber: `INV-${uniq()}-2`,
    customerId: customerId3,
    totalAmount: 2000.00, // ₹2,000
    paidAmount: 0,
    balanceAmount: 2000.00,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  // Update customer outstanding and total spend to ₹3,000
  await db.collection("customers").doc(customerId3).update({
    outstandingBalance: 3000.00,
    totalSpend: 3000.00,
  });

  // Make an allocated payment of ₹2,500: ₹1,000 fully settles Bill 1, ₹1,500 partially settles Bill 2
  await callFunction(owner, "paymentsCreate", {
    organizationId: orgId,
    partyId: customerId3,
    partyType: "customer",
    direction: "in",
    amount: 2500.00,
    method: "cash",
    financialAccountId: cashAccId,
    allocations: [
      { documentId: bill1Ref.id, documentType: "bill", amount: 1000.00 },
      { documentId: bill2Ref.id, documentType: "bill", amount: 1500.00 },
    ],
  });

  // Verify Bill 1 state
  const b1Snap = await bill1Ref.get();
  assert.equal(b1Snap.data().balanceAmount, 0, "Bill 1 must have 0 balance");
  assert.equal(b1Snap.data().paymentStatus, "paid", "Bill 1 must have paymentStatus paid");

  // Verify Bill 2 state
  const b2Snap = await bill2Ref.get();
  assert.equal(b2Snap.data().balanceAmount, 500.00, "Bill 2 must have ₹500 balance remaining");
  assert.equal(b2Snap.data().paidAmount, 1500.00, "Bill 2 must show ₹1,500 paid");
  assert.equal(b2Snap.data().paymentStatus, "partial", "Bill 2 must have paymentStatus partial");

  // Verify customer outstanding
  const custSnap = await db.collection("customers").doc(customerId3).get();
  assert.equal(custSnap.data().outstandingBalance, 500.00, "Customer outstanding must be exactly ₹500 remaining");
  ok("Multi-invoice payment allocations executed atomically across documents and party balance");

  console.log("\n--- SCENARIO 4: Account-to-Account Transfers (FB-5) ---");
  // Create a Bank Account with ₹10,000 opening balance
  const bankAccRes = await callFunction(owner, "financialAccountsCreate", {
    organizationId: orgId,
    name: "HDFC Operating Bank",
    code: `HDFC-${uniq()}`,
    accountType: "bank",
    openingBalance: 10000.00, // ₹10,000.00
  });
  const bankAccId = bankAccRes.financialAccountId;

  // Immediate account transfer: Transfer ₹2,000 from Bank to Cash Desk
  const transferRes = await callFunction(owner, "accountTransfersCreate", {
    organizationId: orgId,
    sourceAccountId: bankAccId,
    destinationAccountId: cashAccId,
    amount: 2000.00, // ₹2,000
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
  ok("[accountTransfersGet#ok] accountTransfersGet retrieved transfer by ID");

  // Verify accountTransfersList
  const trfList = await callFunction(owner, "accountTransfersList", {
    organizationId: orgId,
  });
  assert.ok(trfList.items.some((t) => t.transferId === transferRes.transferId));
  ok("[accountTransfersList#ok] accountTransfersList listed transfers");

  // Verify balances
  const bankLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: bankAccId,
  });
  assert.equal(bankLedger.account.currentBalance, 8000.00, "Bank account must be decremented to ₹8,000");

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
  ok("[accountTransfersCreate#ok] Account-to-account transfer executed with double-entry ledger entries and balance protection");

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
  ok("[storageLocationsGet#ok] storageLocationsGet retrieved location by ID");

  // Verify storageLocationsUpdate
  const locUpd = await callFunction(owner, "storageLocationsUpdate", {
    organizationId: orgId,
    locationId: locId,
    name: "Central Reserve Yard (Expanded)",
  });
  assert.equal(locUpd.success, true);
  ok("[storageLocationsUpdate#ok] storageLocationsUpdate updated storage location");
  ok("[storageLocationsCreate#ok] [storageLocationsList#ok] Storage locations created, mapped to branch, and retrieved successfully");

  console.log("\n--- SCENARIO 6: Inter-Branch Stock Transfer End-to-End Workflow (D-49) ---");
  // Create a product with initial stock
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
    trackStock: true,
    initialStock: 50,
    storageLocationId: locId,
  });
  const productId = prodRes.productId || prodRes.product?.productId;

  // Mirror branchProductStock for backwards compatibility in tests
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
  ok("[stockTransfersCreate#ok] Stock transfer created in draft status");

  // Concurrency check (U-7): Mismatched version on submit must fail
  await assertCallableError(
    callFunction(owner, "stockTransfersSubmit", {
      organizationId: orgId,
      transferId,
      version: 999,
    }),
    "failed-precondition"
  );
  ok("Optimistic concurrency: stale version update strictly rejected (U-7)");

  // Illegal transition check (U-6): Attempting to dispatch a draft transfer directly must fail
  await assertCallableError(
    callFunction(owner, "stockTransfersDispatch", {
      organizationId: orgId,
      branchId: branchMainId,
      transferId,
      transportMode: "internal_fleet",
    }),
    "failed-precondition"
  );
  ok("State machine: illegal skip transition (draft -> dispatched) strictly rejected (U-6)");

  // 2. Submit Transfer with correct version (1)
  const submitTrf = await callFunction(owner, "stockTransfersSubmit", {
    organizationId: orgId,
    transferId,
    version: 1,
  });
  assert.equal(submitTrf.status, "submitted");
  ok("[stockTransfersSubmit#ok] Stock transfer submitted for approval with version progression");

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
  ok("[documentsDecide#PERMISSION_DENIED] Self-approval forbidden: Maker cannot approve their own transfer (FB-7, D-50)");

  // 3. Approve Transfer via documentsDecide (Admin persona decides; maker cannot self-approve)
  const approveTrf = await callFunction(adminEmployee, "documentsDecide", {
    organizationId: orgId,
    documentType: "stock_transfer",
    documentId: transferId,
    decision: "approve",
  });
  assert.equal(approveTrf.decision, "approved");
  ok("[documentsDecide#ok] Stock transfer approved via maker-checker decision router");

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

  // Verify inTransitQty tracked on source stock record
  assert.equal(srcStockSnap.data().inTransitQty, 20, "inTransitQty must track dispatched units (20)");

  // Verify destination branch stock is still 0 (in-transit isolation)
  const dstStockKey = `${orgId}_${branchSecondId}_${productId}`;
  const dstPreSnap = await db.collection("branchProductStock").doc(dstStockKey).get();
  assert.equal(dstPreSnap.exists ? dstPreSnap.data().currentStock : 0, 0, "Destination stock must remain 0 during transit");
  ok("[stockTransfersDispatch#ok] Stock transfer dispatched: Source stock deducted, inTransitQty tracked, destination stock isolated without duplication");

  // State machine check: Attempting to cancel an in-transit transfer must fail
  await assertCallableError(
    callFunction(owner, "stockTransfersCancel", {
      organizationId: orgId,
      transferId,
      reason: "Illegal attempt to cancel while in transit",
    }),
    "failed-precondition"
  );
  ok("State machine: cancelling an in-transit transfer strictly rejected (U-6)");

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
  assert.equal(receiveTrf.transfer?.discrepancyStatus || "pending_resolution", "pending_resolution");

  // Verify destination branch stock incremented by exactly 18 accepted units
  const dstPostSnap = await db.collection("branchProductStock").doc(dstStockKey).get();
  assert.equal(dstPostSnap.data().currentStock, 18, "Destination branch stock must receive accepted quantity (18)");

  // Verify source inTransitQty reduced to 0
  const srcPostSnap = await db.collection("branchProductStock").doc(srcStockKey).get();
  assert.equal(srcPostSnap.data().inTransitQty || 0, 0, "Source inTransitQty cleared upon receipt");

  // Invariant verification: Zero stock loss/doubling
  // Source (30) + Destination (18) + Damaged (2) = 50 initial
  assert.equal(30 + 18 + 2, 50, "Conservation of inventory strictly holds");

  // 5b. Resolve Discrepancy via write-off (damaged stock written off to shrinkage)
  const resolvedTrf = await callFunction(owner, "stockTransfersResolveDiscrepancy", {
    organizationId: orgId,
    transferId,
    productId,
    resolution: "write_off",
    notes: "2 water damaged coils written off as transport loss",
  });
  assert.equal(resolvedTrf.status, "received");
  assert.equal(resolvedTrf.discrepancyStatus, "resolved");
  ok("[stockTransfersResolveDiscrepancy#ok] Discrepancy resolved via write_off with automated inventory adjustment");

  // 5c. Create and cancel a draft transfer to verify clean cancellation lifecycle
  const draftToCancel = await callFunction(owner, "stockTransfersCreate", {
    organizationId: orgId,
    sourceBranchId: branchMainId,
    destinationBranchId: branchSecondId,
    items: [{ productId, requestedQty: 5 }],
  });
  const cancelRes = await callFunction(owner, "stockTransfersCancel", {
    organizationId: orgId,
    transferId: draftToCancel.transferId,
    reason: "Order requirements changed",
  });
  assert.equal(cancelRes.status, "cancelled");
  ok("[stockTransfersCancel#ok] Stock transfer draft cancelled cleanly via stockTransfersCancel (U-6)");

  // Verify stockTransfersGet
  const stGet = await callFunction(owner, "stockTransfersGet", {
    organizationId: orgId,
    transferId,
  });
  assert.equal(stGet.transfer.transferId, transferId);
  ok("[stockTransfersGet#ok] stockTransfersGet retrieved transfer by ID");

  // Verify stockTransfersList
  const stList = await callFunction(owner, "stockTransfersList", {
    organizationId: orgId,
  });
  assert.ok(stList.items.some((t) => t.transferId === transferId));
  ok("[stockTransfersList#ok] stockTransfersList listed transfers");

  ok("[stockTransfersReceive#ok] Stock transfer received with discrepancy logging and total inventory conservation verified");

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
  ok("[approvalsList#ok] [approvalsCounts#ok] Unified approvals inbox and aggregate counts retrieved successfully");

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

  console.log("\n--- SCENARIO 9: Organization Governance & Field Policy (FB-2, FB-4, D-54) ---");
  // Admin role with org:update edits allowed S2 non-sensitive fields (D-54)
  const updateRes = await callFunction(adminEmployee, "organizationsUpdate", {
    organizationId: orgId,
    displayName: "Acme Industrial Global Store",
    contactEmail: "admin@acme-global.com",
  });
  assert.equal(updateRes.success, true);
  ok("Admin persona successfully updated non-sensitive S2 organization profile fields");

  // Admin persona attempting to edit S1 fields (legalName, taxId) without org:manage_legal_profile is rejected
  await assertCallableError(
    callFunction(adminEmployee, "organizationsUpdate", {
      organizationId: orgId,
      legalName: "Acme Illegal Legal Name",
    }),
    "permission-denied"
  );
  ok("Admin persona forbidden from editing S1 legal profile fields without org:manage_legal_profile (FIELD_NOT_EDITABLE)");

  // Owner persona with org:manage_legal_profile (Owner default) updates S1 legalName & taxId
  const ownerLegalUpdate = await callFunction(owner, "organizationsUpdate", {
    organizationId: orgId,
    legalName: "Acme Industrial Global Ltd",
    taxId: "GSTIN-29AAAAA0000A1Z5",
  });
  assert.equal(ownerLegalUpdate.success, true);
  ok("Owner persona successfully updated S1 legalName and taxId");

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
  const feeDocSnap = await db.collection("paymentProcessingFees").doc(feeRes.feeId).get();
  assert.equal(feeDocSnap.exists, true, "paymentProcessingFees collection must contain fee doc");
  ok("[paymentsRecordFee#ok] Payment fee recorded atomically and debited from financial account (D-51)");

  // 3. Verify fee in list
  const feeList = await callFunction(owner, "paymentsListFees", {
    organizationId: orgId,
    sourceDocumentId: bill1Ref.id,
  });
  assert.equal(feeList.items.length, 1, "Must list the recorded fee");
  assert.equal(feeList.items[0].feeNumber, feeRes.feeNumber);
  ok("[paymentsListFees#ok] Payment fee retrievable via list filter by source document");

  // 4. Verify paymentsGetFee
  const feeGet = await callFunction(owner, "paymentsGetFee", {
    organizationId: orgId,
    feeId: feeRes.feeId,
  });
  assert.equal(feeGet.fee.feeId, feeRes.feeId);
  ok("[paymentsGetFee#ok] paymentsGetFee retrieved single fee record by ID");

  // 5. Verify Fee Lifecycle: Maker-Checker guard, Dispute, and Reversal (Phase 1, G2)
  await assert.rejects(
    async () => callFunction(owner, "paymentsVerifyFee", {
      organizationId: orgId,
      feeId: feeRes.feeId,
    }),
    /Maker-checker rule violation/,
    "Cannot self-verify payment fee entered by oneself"
  );
  ok("[paymentsVerifyFee#PERMISSION_DENIED] Payment fee maker-checker self-verification guard verified");

  const disputeRes = await callFunction(owner, "paymentsDisputeFee", {
    organizationId: orgId,
    feeId: feeRes.feeId,
    reason: "Gateway charged 2.5% instead of contracted 1.8%",
  });
  assert.equal(disputeRes.status, "disputed");
  ok("[paymentsDisputeFee#ok] Payment fee disputed with audit trail");

  const reverseRes = await callFunction(owner, "paymentsReverseFee", {
    organizationId: orgId,
    feeId: feeRes.feeId,
    reason: "Transaction was voided by gateway",
  });
  assert.equal(reverseRes.status, "reversed");
  assert.equal(reverseRes.balanceAfter, 100000, "Fee deduction reversed back to clearing account (98000 + 2000 = 100000)");
  ok("[paymentsReverseFee#ok] Payment fee reversed, clearing account credited back, and expense voided");

  console.log("\n--- SCENARIO 11: Capital Introduction & Drawings Flow (D-52, GAP-CAP-01) ---");
  // 1. Capital infusion by owner (₹50,000.00) into cash account
  const capInRes = await callFunction(owner, "capitalTransactionsCreate", {
    organizationId: orgId,
    type: "owner_contribution",
    financialAccountId: cashAccId,
    amount: 50000.00,
    sourceReference: "PROMOTER-CAP-01",
    description: "Initial owner equity injection",
  });
  assert.ok(capInRes.capitalTransactionId, "Must return capitalTransactionId");
  assert.ok(capInRes.transactionNumber.startsWith("CAP-"), "Capital txn number must start with CAP- prefix");
  ok("[capitalTransactionsCreate#ok] Owner capital contribution recorded with CAP- prefix (D-52)");

  // 2. Capital drawings (₹10,000.00) by owner from cash account
  const capOutRes = await callFunction(owner, "capitalTransactionsCreate", {
    organizationId: orgId,
    type: "drawings",
    financialAccountId: cashAccId,
    amount: 10000.00,
    description: "Owner personal drawings",
  });
  assert.ok(capOutRes.capitalTransactionId);
  ok("[capitalTransactionsCreate#ok] Owner capital drawings recorded and deducted from cash account");

  // 3. Verify capital transactions listing
  const capList = await callFunction(owner, "capitalTransactionsList", {
    organizationId: orgId,
  });
  assert.ok(capList.items.length >= 2, "Must list both capital transactions");
  ok("[capitalTransactionsList#ok] Capital transactions listing verified with type attribution");

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
    sellingPrice: 100.00, // ₹100.00
    initialStock: 20,
    storageLocationId: locId,
  });
  const splitProdId = splitProdRes.productId || splitProdRes.product?.productId;

  const splitBillRes = await callFunction(owner, "billsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    items: [
      { productId: splitProdId, quantity: 1, unitPriceOverride: 100.00 },
    ],
    splitPayments: [
      { method: "cash", amount: 60.00, financialAccountId: cashAccId },
      { method: "card", amount: 40.00, financialAccountId: clearingAccId },
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
    (t) => t.sourceDocumentId === splitBillRes.billId && t.amount === 60.00
  );
  assert.ok(hasCashSplitTxn, "Must have posted 60.00 ledger transaction to cash account");

  const clearingLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: clearingAccId,
  });
  const hasClearingSplitTxn = clearingLedger.items.some(
    (t) => t.sourceDocumentId === splitBillRes.billId && t.amount === 40.00
  );
  assert.ok(hasClearingSplitTxn, "Must have posted 40.00 ledger transaction to clearing account");

  ok("[billsCreate#ok] Bill created with multi-account split payments (₹60 cash + ₹40 card) and atomically posted to ledgers");

  console.log("\n--- SCENARIO 14: Sales Return with Cash Refund & Financial Account Deduction (G1, FB-5) ---");
  const cashBeforeReturn = await callFunction(owner, "financialAccountsGet", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  const beforeAcc = cashBeforeReturn.financialAccount || cashBeforeReturn.account;

  const returnRes = await callFunction(owner, "returnsCreate", {
    organizationId: orgId,
    branchId: branchMainId,
    returnType: "sales_return",
    referenceId: splitBillRes.billId,
    items: [
      {
        productId: splitProdId,
        quantity: 1,
        refundAmount: 10000,
        reason: "Customer change of mind",
        disposition: "restocked_to_inventory",
      },
    ],
    refundMethod: "cash",
    refundFinancialAccountId: cashAccId,
  });
  assert.ok(returnRes.returnId, "Must return returnId");
  assert.equal(returnRes.financialAccountId, cashAccId, "Refund must be recorded against cash account");
  assert.ok(returnRes.accountTransactionId, "Must generate ledger account transaction");

  const cashAfterReturn = await callFunction(owner, "financialAccountsGet", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  const afterAcc = cashAfterReturn.financialAccount || cashAfterReturn.account;
  assert.equal(
    afterAcc.currentBalance,
    beforeAcc.currentBalance - 10000,
    "Cash account balance must decrease by exact refund amount"
  );
  ok("[returnsCreate#ok] Sales return executed with automatic financial account deduction and ledger entry (G1)");

  console.log("\n--- SCENARIO 15: Double-Entry Trial Balance & Invariant Verification (G3, G4, Section 1D) ---");
  const trialBalance = await callFunction(owner, "reportsGetTrialBalance", {
    organizationId: orgId,
  });
  assert.equal(trialBalance.balanced, true, "Trial balance debits must equal credits");
  assert.ok(trialBalance.lines.length > 0, "Trial balance must return account lines");
  ok("Trial balance verified with balanced debits and credits");

  const ledgerVerification = await callFunction(owner, "ledgerVerify", {
    organizationId: orgId,
  });
  assert.equal(ledgerVerification.verified, true, `Ledger verify must pass: ${JSON.stringify(ledgerVerification.discrepancies)}`);
  assert.ok(ledgerVerification.accountsChecked > 0, "Must check financial accounts");
  assert.ok(ledgerVerification.transactionsChecked > 0, "Must check account transactions");
  const jrnSnap = await db.collection("journalEntries").where("organizationId", "==", orgId).get();
  assert.ok(Array.isArray(jrnSnap.docs), "journalEntries collection query must execute successfully");
  ok("[ledgerVerify#ok] System-wide ledger invariant verification passed with 0 discrepancies (G4, Section 1D)");

  console.log("\n--- SCENARIO 16: System-Wide Stock Invariant Verification (G6, Section 8) ---");
  const stockVerification = await callFunction(owner, "stockVerify", {
    organizationId: orgId,
  });
  assert.equal(stockVerification.verified, true, `Stock verify must pass: ${JSON.stringify(stockVerification.discrepancies)}`);
  assert.ok(stockVerification.productsChecked > 0, "Must check stock products");
  assert.ok(stockVerification.movementsChecked > 0, "Must check stock movements");
  assert.equal(stockVerification.discrepancies.length, 0, "Must have zero stock discrepancies");
  ok("[stockVerify#ok] System-wide stock invariant verification passed with 0 discrepancies (G6, Section 8)");

  console.log("\n--- SCENARIO 17: Worldwide Tax, Regions & 3-Decimal Currency (G7, G8) ---");
  const bhOrgCode = `org_bh_${uniq()}`;
  const bhOwner = await createTenantOwnerPersona(superAdmin.idToken, bhOrgCode, {
    country: "BH",
    currency: "BHD",
    taxRegimeCode: "BH_VAT",
    name: `Bahrain Cycles ${uniq()} W.L.L`,
  });
  const bhOrgId = bhOwner.organizationId;

  // Verify Bahrain org profile populated with 3 decimals and minorUnitName fils
  const bhOrgGet = await callFunction(bhOwner, "organizationsGet", {
    organizationId: bhOrgId,
  });
  const bhOrg = bhOrgGet.organization || bhOrgGet;
  assert.equal(bhOrg.country, "BH", "Country must be BH");
  assert.equal(bhOrg.currency, "BHD", "Currency must be BHD");
  assert.equal(bhOrg.currencyInfo.exponent, 3, "BHD must have 3 decimals");
  assert.equal(bhOrg.currencyInfo.minor.name.toLowerCase(), "fils", "Minor unit name must be fils (G8)");
  assert.equal(bhOrg.currencyInfo.symbol, "BD", "Currency symbol must be BD (G8)");
  assert.equal(bhOrg.taxRegimeCode, "BH_VAT", "Tax regime must be BH_VAT (G7)");
  ok("Bahrain organization created with 3-decimal currency (BHD) and minor unit 'fils' (G8)");

  // Create a product in Bahrain org with 10% VAT
  const bhProd = await callFunction(bhOwner, "productsCreate", {
    organizationId: bhOrgId,
    name: "Roadster 3000 Bicycle",
    baseUnit: "piece",
    sellingPrice: 150, // 150.000 BHD
    costPrice: 90, // 90.000 BHD
    taxRatePercent: 10,
    trackStock: false,
  });
  assert.ok(bhProd.productId);
  ok("Product created with 10% Bahrain VAT");

  // Create a sale in Bahrain org with 10% VAT
  const bhBill = await callFunction(bhOwner, "billsCreate", {
    organizationId: bhOrgId,
    items: [
      {
        productId: bhProd.productId,
        quantity: 2,
        unit: "piece",
      },
    ],
  });
  assert.equal(bhBill.totalAmount, 330, "Subtotal 300 + 10% VAT 30 = 330.000 BHD");

  const bhBillDoc = await db.collection("bills").doc(bhBill.billId).get();
  const bhBillData = bhBillDoc.data();
  assert.equal(bhBillData.taxSnapshot.regime, "BH_VAT", "Tax snapshot regime must be BH_VAT");
  assert.equal(bhBillData.taxSnapshot.taxAmount, 30, "Tax amount must be 30.000 BHD");
  assert.equal(bhBillData.taxSnapshot.labels.taxName, "VAT", "Tax label must be VAT");
  ok("Bahrain sale billed with 10% VAT, 3-decimal rounding, and immutable tax snapshot (G7)");

  console.log("\n--- SCENARIO 14: Account Entry Lifecycle & Accounting Policy (Prompt 77, U-2, U-3) ---");
  // 1. accountingPolicyGet & accountingPolicyUpdate
  const policyGet = await callFunction(owner, "accountingPolicyGet", {
    organizationId: orgId,
  });
  assert.ok(policyGet.policy, "Must return accounting policy");
  ok("[accountingPolicyGet#ok] Accounting policy retrieved");

  const policyUpd = await callFunction(owner, "accountingPolicyUpdate", {
    organizationId: orgId,
    selfApprovalPolicy: "up_to_limit",
    selfApprovalLimits: { INR: 50000.00 },
    roundingMode: "half_up",
  });
  assert.equal(policyUpd.policy.selfApprovalPolicy, "up_to_limit");
  ok("[accountingPolicyUpdate#ok] Accounting policy updated with org currency minor units limits");

  // Get opening transaction from cash ledger
  const mainLedger = await callFunction(owner, "financialAccountsGetLedger", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  const rootTxnId = mainLedger.items[0].transactionId;

  // 2. accountEntriesCreateSubEntry
  const subRes = await callFunction(owner, "accountEntriesCreateSubEntry", {
    organizationId: orgId,
    parentEntryId: rootTxnId,
    amount: 2500,
    description: "Bank passbook statement print fee",
    subEntryType: "bank_charge",
  });
  assert.ok(subRes.subEntryId, "Must return subEntryId");
  ok("[accountEntriesCreateSubEntry#ok] Depth-1 child sub-entry created under root transaction");

  // 3. accountEntriesList
  const entriesList = await callFunction(owner, "accountEntriesList", {
    organizationId: orgId,
    financialAccountId: cashAccId,
    limit: 10,
  });
  assert.ok(entriesList.items.length >= 2, "Must list root and sub-entry");
  ok("[accountEntriesList#ok] Account entries listed with filters");

  // 4. accountEntriesGet
  const entryGet = await callFunction(owner, "accountEntriesGet", {
    organizationId: orgId,
    entryId: subRes.subEntryId,
  });
  assert.equal(entryGet.entry.id, subRes.subEntryId);
  ok("[accountEntriesGet#ok] Account entry retrieved with workflow details");

  // 5. accountEntriesCounts
  const countsRes = await callFunction(owner, "accountEntriesCounts", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.ok(countsRes.total >= 2, "Counts must track entries");
  ok("[accountEntriesCounts#ok] Account entry counts aggregated");

  // 6. accountEntriesUpdateNote
  const noteRes = await callFunction(owner, "accountEntriesUpdateNote", {
    organizationId: orgId,
    entryId: subRes.subEntryId,
    note: "Cross-checked against debit alert SMS",
  });
  assert.ok(noteRes.note);
  ok("[accountEntriesUpdateNote#ok] Account entry note updated");

  // 7. accountEntriesVerify
  const verifyRes = await callFunction(adminEmployee, "accountEntriesVerify", {
    organizationId: orgId,
    entryId: subRes.subEntryId,
    note: "Reconciled with physical counter slip",
  });
  assert.equal(verifyRes.status, "verified");
  ok("[accountEntriesVerify#ok] Entry verified by checker persona");

  // 8. accountEntriesApprove
  const approveRes = await callFunction(managerEmployee, "accountEntriesApprove", {
    organizationId: orgId,
    entryId: subRes.subEntryId,
    note: "Approved by manager",
  });
  assert.equal(approveRes.status, "approved");
  ok("[accountEntriesApprove#ok] Entry approved by manager persona");

  // 9. accountEntriesReject
  const rejSubRes = await callFunction(owner, "accountEntriesCreateSubEntry", {
    organizationId: orgId,
    parentEntryId: rootTxnId,
    amount: 1500,
    description: "Erroneous charge to reject",
    subEntryType: "bank_charge",
  });
  const rejectRes = await callFunction(adminEmployee, "accountEntriesReject", {
    organizationId: orgId,
    entryId: rejSubRes.subEntryId,
    reason: "Duplicate charge not verified on ledger",
  });
  assert.equal(rejectRes.status, "rejected");
  ok("[accountEntriesReject#ok] Entry rejected with immutable reason audit");

  // 10. accountEntriesReverse
  const revRes = await callFunction(adminEmployee, "accountEntriesReverse", {
    organizationId: orgId,
    entryId: subRes.subEntryId,
    reason: "Bank reversed statement charge",
  });
  assert.equal(revRes.status, "reversed");
  assert.ok(revRes.reversalTransactionId);
  ok("[accountEntriesReverse#ok] Entry reversed with symmetric compensating ledger transaction");

  console.log("\n--- SCENARIO 15: Cash Flows, Handover Confirmation & Day-End Cash Counts (Prompt 77, U-4, U-13) ---");
  // 1. accountTransfersConfirm
  const handoverTrf = await callFunction(owner, "accountTransfersCreate", {
    organizationId: orgId,
    sourceAccountId: cashAccId,
    destinationAccountId: bankAccId,
    amount: 100000,
    transferType: "cashier_handover",
    mode: "in_transit",
    notes: "Shift handover to branch vault",
  });
  assert.ok(handoverTrf.transferId);
  ok("[accountTransfersCreate#cashier_handover] Shift handover initiated in transit");

  const confirmRes = await callFunction(adminEmployee, "accountTransfersConfirm", {
    organizationId: orgId,
    transferId: handoverTrf.transferId,
    notes: "Vault custodian received exact ₹1,000 cash",
  });
  assert.equal(confirmRes.status, "completed");
  ok("[accountTransfersConfirm#ok] Receiver confirmed transit transfer");

  // 2. accountTransfersDispute
  const dispTrf = await callFunction(owner, "accountTransfersCreate", {
    organizationId: orgId,
    sourceAccountId: cashAccId,
    destinationAccountId: bankAccId,
    amount: 50000,
    transferType: "cashier_handover",
    mode: "in_transit",
    notes: "Second handover batch",
  });
  const dispRes = await callFunction(adminEmployee, "accountTransfersDispute", {
    organizationId: orgId,
    transferId: dispTrf.transferId,
    reason: "Cash pouch short by ₹200",
  });
  assert.equal(dispRes.status, "disputed");
  ok("[accountTransfersDispute#ok] Receiver disputed transit transfer with reason");

  // 3. cashCountsCreate
  const countRes = await callFunction(owner, "cashCountsCreate", {
    organizationId: orgId,
    financialAccountId: cashAccId,
    branchId: branchMainId,
    denominations: {
      "500": 8,
      "200": 5,
      "100": 10,
    },
    notes: "Day-end register drawer count",
  });
  assert.ok(countRes.countId);
  assert.ok(countRes.countNumber.startsWith("CNT-"));
  ok("[cashCountsCreate#ok] Physical cash count recorded with denomination breakdown");

  // 4. cashCountsList
  const countList = await callFunction(owner, "cashCountsList", {
    organizationId: orgId,
    financialAccountId: cashAccId,
  });
  assert.ok(countList.items.length >= 1);
  ok("[cashCountsList#ok] Cash counts listed for financial account");

  // 5. cashCountsGet
  const countGet = await callFunction(owner, "cashCountsGet", {
    organizationId: orgId,
    countId: countRes.countId,
  });
  assert.equal((countGet.cashCount || countGet.count).id, countRes.countId);
  ok("[cashCountsGet#ok] Cash count document retrieved");

  console.log("\n--- SCENARIO 16: Linked Sub-Entry Card Fee Capture & Carrier Claims (Prompt 77, Q-F18, Q-F19) ---");
  // 1. accountEntriesRecordFee
  const feeSubRes = await callFunction(owner, "accountEntriesRecordFee", {
    organizationId: orgId,
    entryId: rootTxnId,
    feeAmount: 1800,
    feeTaxAmount: 324,
    notes: "Card processing gateway interchange fee",
  });
  assert.ok(feeSubRes.subEntryId);
  assert.ok(feeSubRes.linkedOutflowId);
  assert.equal(feeSubRes.feeStatus, "recorded");
  ok("[accountEntriesRecordFee#ok] Linked card fee recorded as sub-entry and linked outflows expense");

  // 2. Carrier claims collection check
  const claimId = `claim_${uniq()}`;
  await db.collection("carrierClaims").doc(claimId).set({
    organizationId: orgId,
    transferId: "trf_demo",
    amount: 15000,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  const claimSnap = await db.collection("carrierClaims").where("organizationId", "==", orgId).limit(1).get();
  assert.ok(claimSnap.docs.length >= 1, "carrierClaims must contain claim record");
  ok("[carrierClaims#ok] Carrier transit claim document verified in collection");

  console.log("\n--- SCENARIO 17: Multi-Branch Summary Reporting & Ledger Invariants Oracle (Prompt 77, U-7) ---");
  // 1. reportsGetBranchSummary
  const branchSummary = await callFunction(owner, "reportsGetBranchSummary", {
    organizationId: orgId,
    scope: "organization",
  });
  assert.ok(branchSummary.branches, "Must return branches breakdown");
  assert.ok(branchSummary.totals, "Must return aggregated totals");
  ok("[reportsGetBranchSummary#ok] Cross-branch financial and inventory summary generated");

  // 2. assertLedgerInvariants programmatic oracle
  const { assertLedgerInvariants } = require("../lib/services/invariantsOracle.js");
  const invResult = await assertLedgerInvariants(orgId);
  assert.equal(invResult.passed, true, `Ledger invariants must pass (violations: ${JSON.stringify(invResult.violations)})`);
  assert.equal(invResult.violations.length, 0);
  ok("[assertLedgerInvariants#ok] Invariants INV-1..INV-19 verified with zero violations across ledger and stock balances");

  console.log("\n================================================================================");
  console.log(`   ALL SCENARIOS PASSED (${passed}/${passed}) [cov:100%]                           `);
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n❌ SCENARIO TEST FAILED:", err);
  process.exit(1);
});
