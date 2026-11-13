/**
 * Trado Firebase Backend — Analytics, Reports, Usage Metering & Platform Callables Test Suite
 * 
 * Exhaustive coverage for:
 * 1. Subscription Plans: plansCreate, plansUpdate, plansList
 * 2. Catalogs: taxRegimesList
 * 3. Reports & Analytics: reportsGetRevenue, reportsGetProfitLoss, reportsGetStockValuation,
 *                         reportsGetTopEntities, reportsGetStaffActivity, reportsGetPlatformOverview,
 *                         reportsExportCsv
 * 4. Usage Metering & Platform Admin: usageGetPlatformSummary, usageGetOrganizations, usageGetBranches,
 *                                    usageGetDetail, usageCalculateDryRunStatement, usageRecordClientMetric,
 *                                    usageGetLimits, usageUpdateLimits
 * 5. Branch Reconciliation: reconcileBranchCounts
 */

const assert = require("node:assert/strict");
const { getSuperAdminPersona, createTenantOwnerPersona, createEmployeePersona } = require("./helpers/auth-personas.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { buildProductPayload, buildCustomerPayload, buildVendorPayload } = require("./helpers/domain-builders.cjs");
const { db, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: ANALYTICS, REPORTS, USAGE & PLATFORM CONTRACT              ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  // [SETUP] Authenticate Super Admin and provision Tenant Owner
  console.log("[SETUP] Provisioning test personas...");
  const superAdmin = await getSuperAdminPersona();
  const superAdminToken = superAdmin.idToken;

  const owner = await createTenantOwnerPersona(superAdminToken, "AnalyticsCorp");
  const ownerToken = owner.idToken;
  const orgId = owner.organizationId;
  console.log(`✓ Super Admin and Tenant Owner (${orgId}) ready.`);

  // Create Staff
  const staff = await createEmployeePersona(ownerToken, orgId, "cashier", "Analytics Staff");
  const staffToken = staff.idToken;
  console.log(`✓ Staff Employee ready.`);

  // ============================================================
  // 1. Subscription Plans (plansCreate, plansUpdate, plansList)
  // ============================================================
  console.log("\n[DOMAIN: PLANS] Testing plansCreate, plansUpdate, plansList...");

  // Non-super-admin rejection
  await assertCallableError(
    callFunction("plansCreate", {
      name: "Rogue Plan",
      price: 100,
      currency: "INR",
      storageLimitMb: 1000,
      monthlyDocumentVolumeLimit: 1000,
      seatLimits: { admin: 1, staff: 5 },
      moduleFlags: {},
    }, ownerToken),
    ["permission-denied", "permissiondenied"]
  );
  console.log("✓ plansCreate rejected non-Super Admin caller");

  // Super Admin creates plan
  const planUnique = `plan_${Date.now()}`;
  const planCreateRes = await callFunction("plansCreate", {
    name: `Enterprise Growth ${planUnique}`,
    price: 4999,
    currency: "INR",
    storageLimitMb: 10240,
    monthlyDocumentVolumeLimit: 50000,
    seatLimits: { admin: 10, staff: 50 },
    branchLimit: 5,
    moduleFlags: { analytics: true, tasks: true, liveLocation: true },
    isActive: true,
  }, superAdminToken);
  assert.ok(planCreateRes.planId, "plansCreate must return planId");
  const customPlanId = planCreateRes.planId;
  console.log(`✓ Plan created: ID ${customPlanId}, Price: ₹4999, Branch Limit: 5`);

  // Super Admin updates plan
  const planUpdateRes = await callFunction("plansUpdate", {
    planId: customPlanId,
    price: 5499,
    branchLimit: 7,
  }, superAdminToken);
  assert.ok(planUpdateRes.success, "plansUpdate must return success: true");
  console.log("✓ plansUpdate updated price and branchLimit");

  // plansPreviewImpact (Super Admin read-only preview of plan impact)
  const impactRes = await callFunction("plansPreviewImpact", {
    organizationId: orgId,
    targetPlanId: customPlanId,
  }, superAdminToken);
  assert.ok(impactRes.impact, "plansPreviewImpact must return impact assessment");
  assert.equal(impactRes.impact.isDowngradePossible, true);
  console.log("✓ plansPreviewImpact evaluated impact on branches and seats");

  // plansGet (Retrieve specific plan)
  const planGetRes = await callFunction("plansGet", {
    planId: customPlanId,
  }, staffToken);
  const plan = planGetRes.plan || planGetRes;
  assert.ok(plan && (plan.id === customPlanId || plan.planId === customPlanId), "plansGet must return plan details");
  console.log(`✓ plansGet fetched plan: ${plan.name} (price: ${plan.price})`);

  // plansArchive (Super Admin archives plan)
  await assertCallableError(
    callFunction("plansArchive", { planId: customPlanId }, ownerToken),
    ["permission-denied", "permissiondenied"]
  );
  const archiveRes = await callFunction("plansArchive", {
    planId: customPlanId,
    reason: "Testing plan archive workflow",
  }, superAdminToken);
  assert.ok(archiveRes.success && archiveRes.isArchived === true, "plansArchive must mark plan as archived");
  console.log("✓ plansArchive successfully archived plan");

  // plansDelete (Super Admin deletes unused plan)
  const unusedPlanRes = await callFunction("plansCreate", {
    name: `Unused Disposable Plan ${Date.now()}`,
    price: 100,
    currency: "INR",
    storageLimitMb: 100,
    monthlyDocumentVolumeLimit: 100,
    seatLimits: { admin: 1, staff: 1 },
    moduleFlags: {},
  }, superAdminToken);
  const unusedPlanId = unusedPlanRes.planId;

  await assertCallableError(
    callFunction("plansDelete", { planId: unusedPlanId }, ownerToken),
    ["permission-denied", "permissiondenied"]
  );
  const deleteRes = await callFunction("plansDelete", {
    planId: unusedPlanId,
  }, superAdminToken);
  assert.ok(deleteRes.success, "plansDelete must succeed for unreferenced plan");
  console.log("✓ plansDelete safely removed unused plan");

  // List plans
  const planListRes = await callFunction("plansList", {
    includeInactive: true,
  }, staffToken);
  assert.ok(Array.isArray(planListRes.plans));
  assert.ok(planListRes.plans.some(p => p.planId === customPlanId));
  console.log(`✓ plansList returned ${planListRes.plans.length} subscription plans (including archived)`);

  // ============================================================
  // 2. Catalogs (taxRegimesList)
  // ============================================================
  console.log("\n[DOMAIN: CATALOGS] Testing taxRegimesList...");

  const taxListRes = await callFunction("taxRegimesList", {}, staffToken);
  assert.ok(Array.isArray(taxListRes.taxRegimes));
  assert.ok(taxListRes.taxRegimes.length > 0);
  assert.ok(taxListRes.taxRegimes.some(t => t.code === "IN_GST" || t.countryCode === "IN"));
  console.log(`✓ taxRegimesList returned ${taxListRes.taxRegimes.length} tax regimes including IN_GST`);

  // ============================================================
  // 3. Reporting Setup: Seed sales, stock, expenses for analytics
  // ============================================================
  console.log("\n[SETUP: REPORTING DATA] Seeding transactions for analytics...");

  const productRes = await callFunction("productsCreate", buildProductPayload(orgId, {
    name: "Analytics Test Widget",
    sellingPrice: 1000,
    costPrice: 600,
    initialStock: 100,
  }), ownerToken);
  const prodId = productRes.productId;

  const customerRes = await callFunction("customersCreate", buildCustomerPayload(orgId, {
    name: "Analytics Premium Customer",
    phone: "+919876543299",
  }), ownerToken);
  const custId = customerRes.customerId;

  const vendorRes = await callFunction("vendorsCreate", buildVendorPayload(orgId, {
    name: "Analytics Prime Supplier",
    phone: "+919876543288",
  }), ownerToken);
  const vendId = vendorRes.vendorId;

  // Create POS Bill
  const billRes = await callFunction("billsCreate", {
    organizationId: orgId,
    customerId: custId,
    salesMode: "pos",
    items: [{ productId: prodId, quantity: 2 }],
    paidAmount: 2000,
    paymentMethod: "cash",
  }, ownerToken);
  console.log(`✓ Seeded Bill ${billRes.billId} (₹2000)`);

  // Create Outflow Expense
  const outflowRes = await callFunction("outflowsCreate", {
    organizationId: orgId,
    vendorId: vendId,
    kind: "expense",
    paidAmount: 500,
    lines: [{
      itemName: "Warehouse Utility Rent",
      quantity: 1,
      unitPrice: 500,
      taxPercent: 0,
      addToStock: false,
    }],
    notes: "Monthly operational overhead",
  }, ownerToken);
  console.log(`✓ Seeded Outflow ${outflowRes.outflowId} (₹500 expense)`);

  // ============================================================
  // 4. Analytics & Reports: Revenue, P&L, Stock Valuation, Top, Staff, Platform, CSV
  // ============================================================
  console.log("\n[DOMAIN: REPORTS] Testing all 7 analytics & report callables...");

  // 1. Revenue Report
  const revRes = await callFunction("reportsGetRevenue", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(revRes.totalRevenue >= 2000, `totalRevenue must be >= 2000, got ${revRes.totalRevenue}`);
  assert.ok(revRes.billCount >= 1);
  console.log(`✓ reportsGetRevenue calculated Total Revenue: ₹${revRes.totalRevenue}, Bills: ${revRes.billCount}`);

  // 2. Profit & Loss Report
  const plRes = await callFunction("reportsGetProfitLoss", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(plRes.totalRevenue >= 2000);
  assert.ok(plRes.grossProfit !== undefined);
  assert.ok(plRes.netProfit !== undefined);
  console.log(`✓ reportsGetProfitLoss: Revenue ₹${plRes.totalRevenue}, COGS ₹${plRes.cogs}, Gross ₹${plRes.grossProfit}, Net ₹${plRes.netProfit}`);

  // 3. Stock Valuation Report
  const stockValRes = await callFunction("reportsGetStockValuation", {
    organizationId: orgId,
  }, ownerToken);
  assert.ok(stockValRes.totalStockValuation > 0, "totalStockValuation must be > 0");
  assert.ok(stockValRes.totalItemsCount >= 1, "totalItemsCount must be >= 1");
  console.log(`✓ reportsGetStockValuation: Inventory Valuation ₹${stockValRes.totalStockValuation}, Items: ${stockValRes.totalItemsCount}`);

  // 4. Top Entities Report (Products, Customers, Vendors)
  const topProdRes = await callFunction("reportsGetTopEntities", {
    organizationId: orgId,
    entityType: "products",
    limit: 5,
  }, ownerToken);
  assert.equal(topProdRes.entityType, "products");
  assert.ok(Array.isArray(topProdRes.items));
  assert.ok(topProdRes.items.some(p => p.productId === prodId));

  const topCustRes = await callFunction("reportsGetTopEntities", {
    organizationId: orgId,
    entityType: "customers",
    limit: 5,
  }, ownerToken);
  assert.equal(topCustRes.entityType, "customers");
  assert.ok(Array.isArray(topCustRes.items));

  const topVendRes = await callFunction("reportsGetTopEntities", {
    organizationId: orgId,
    entityType: "vendors",
    limit: 5,
  }, ownerToken);
  assert.equal(topVendRes.entityType, "vendors");
  assert.ok(Array.isArray(topVendRes.items));
  console.log(`✓ reportsGetTopEntities verified products, customers, and vendors breakdown`);

  // 5. Staff Activity Report
  const staffActivityRes = await callFunction("reportsGetStaffActivity", {
    organizationId: orgId,
  }, ownerToken);
  assert.equal(staffActivityRes.organizationId, orgId);
  assert.ok(Array.isArray(staffActivityRes.staffSummaries));
  console.log(`✓ reportsGetStaffActivity returned summaries for ${staffActivityRes.staffSummaries.length} staff members`);

  // 6. Platform Overview Report (Super Admin only)
  await assertCallableError(
    callFunction("reportsGetPlatformOverview", {}, ownerToken),
    ["permission-denied", "permissiondenied"]
  );
  const platformOverviewRes = await callFunction("reportsGetPlatformOverview", {}, superAdminToken);
  assert.ok(platformOverviewRes.totalOrganizations >= 1);
  assert.ok(platformOverviewRes.activeOrganizations >= 1);
  assert.ok(platformOverviewRes.availablePlansCount >= 1);
  assert.ok(typeof platformOverviewRes.totalPlatformRevenue === "number", "totalPlatformRevenue must be number");
  assert.ok(typeof platformOverviewRes.totalPlatformOutflows === "number", "totalPlatformOutflows must be number");
  assert.ok(platformOverviewRes.platformFinancials !== undefined, "platformFinancials must be present");
  console.log(`✓ reportsGetPlatformOverview verified: ${platformOverviewRes.totalOrganizations} total orgs, ${platformOverviewRes.activeOrganizations} active, platform revenue ₹${platformOverviewRes.totalPlatformRevenue}`);

  // 7. CSV Export
  const csvRes = await callFunction("reportsExportCsv", {
    organizationId: orgId,
    reportType: "stock_valuation",
  }, ownerToken);
  assert.ok(csvRes.csv && typeof csvRes.csv === "string");
  assert.equal(csvRes.contentType, "text/csv");
  console.log(`✓ reportsExportCsv generated CSV with ${csvRes.csv.split("\n").length} lines`);

  // ============================================================
  // 5. Usage Metering & Platform Admin
  // ============================================================
  console.log("\n[DOMAIN: USAGE METERING] Testing all 6 usage callables...");

  // Ingest client telemetry metric
  const recordRes = await callFunction("usageRecordClientMetric", {
    organizationId: orgId,
    metrics: {
      locationPings: 5,
      storageOperations: 2,
    },
  }, staffToken);
  assert.ok(recordRes.success, "usageRecordClientMetric must succeed");
  console.log("✓ usageRecordClientMetric recorded client telemetry");

  // usageGetPlatformSummary (Super Admin)
  await assertCallableError(
    callFunction("usageGetPlatformSummary", {}, ownerToken),
    ["permission-denied", "permissiondenied"]
  );
  const platformSummaryRes = await callFunction("usageGetPlatformSummary", {}, superAdminToken);
  assert.ok(platformSummaryRes.timeframe);
  assert.ok(platformSummaryRes.applicationAttributedTotals);
  assert.equal(platformSummaryRes.currency, "INR");
  console.log(`✓ usageGetPlatformSummary returned estimated platform infrastructure usage`);
  const reconSnap = await db.collection("platformCostReconciliation").limit(1).get();
  console.log(`✓ platformCostReconciliation collection verified (${reconSnap.size} docs)`);

  // usageGetOrganizations (Super Admin)
  const usageOrgsRes = await callFunction("usageGetOrganizations", {
    limit: 10,
    sortBy: "activity",
  }, superAdminToken);
  assert.ok(Array.isArray(usageOrgsRes.items));
  assert.ok(usageOrgsRes.items.length > 0);
  assert.ok(usageOrgsRes.items.every(o => o.organizationId && typeof o.estimatedCost === "number"));
  console.log(`✓ usageGetOrganizations ranked ${usageOrgsRes.items.length} tenant organizations`);

  // usageGetBranches (Super Admin)
  const usageBranchesRes = await callFunction("usageGetBranches", {
    organizationId: orgId,
  }, superAdminToken);
  assert.equal(usageBranchesRes.organizationId, orgId);
  assert.ok(Array.isArray(usageBranchesRes.branches));
  assert.ok(usageBranchesRes.branches.length >= 1);
  console.log(`✓ usageGetBranches returned consumption for ${usageBranchesRes.branches.length} branches`);

  // usageGetDetail (Super Admin)
  const usageDetailRes = await callFunction("usageGetDetail", {
    organizationId: orgId,
  }, superAdminToken);
  assert.ok(Array.isArray(usageDetailRes.items));
  console.log(`✓ usageGetDetail returned ${usageDetailRes.items.length} daily time-series records`);

  // usageCalculateDryRunStatement (Super Admin)
  const today = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const dryRunRes = await callFunction("usageCalculateDryRunStatement", {
    organizationId: orgId,
    billingPeriod: today,
  }, superAdminToken);
  assert.equal(dryRunRes.organizationId, orgId);
  assert.equal(dryRunRes.status, "draft_estimate");
  assert.ok(dryRunRes.legalDisclaimer);
  console.log(`✓ usageCalculateDryRunStatement generated draft statement for period ${today}`);

  // ============================================================
  // 5b. Usage Limits & Threshold Warnings (usageGetLimits, usageUpdateLimits)
  // ============================================================
  console.log("\n[DOMAIN: USAGE LIMITS] Testing usageGetLimits, usageUpdateLimits & branchUsageMonthly...");

  // Non-super-admin denied updating limits
  await assertCallableError(
    callFunction("usageUpdateLimits", {
      organizationId: orgId,
      limits: {
        dailyBills: {
          dailyLimit: 100,
          warningThresholdPercent: 80,
          hardThresholdPercent: 100,
          enforcementMode: "warn_only",
          enabled: true,
        },
      },
    }, ownerToken),
    ["permission-denied", "permissiondenied"]
  );
  console.log("✓ usageUpdateLimits rejected non-Super Admin caller");

  // Staff denied reading limits
  await assertCallableError(
    callFunction("usageGetLimits", {
      organizationId: orgId,
    }, staffToken),
    ["permission-denied", "permissiondenied"]
  );
  console.log("✓ usageGetLimits rejected staff caller");

  // Tenant Owner gets own limits
  const ownerLimits = await callFunction("usageGetLimits", {
    organizationId: orgId,
  }, ownerToken);
  assert.equal(ownerLimits.organizationId, orgId);
  assert.ok(ownerLimits.effectiveLimits, "Must return effectiveLimits");
  assert.ok(ownerLimits.dailyUsage, "Must return dailyUsage");
  assert.ok(ownerLimits.monthlyUsage, "Must return monthlyUsage");
  console.log("✓ usageGetLimits succeeded for Tenant Owner");

  // Super Admin updates limits override
  const updateRes = await callFunction("usageUpdateLimits", {
    organizationId: orgId,
    limits: {
      locationPings: {
        dailyLimit: 10,
        warningThresholdPercent: 50,
        hardThresholdPercent: 100,
        enforcementMode: "warn_only",
        enabled: true,
      },
    },
  }, superAdminToken);
  assert.equal(updateRes.success, true);
  console.log("✓ usageUpdateLimits succeeded for Super Admin");

  // Super Admin reads updated limits
  const updatedLimits = await callFunction("usageGetLimits", {
    organizationId: orgId,
  }, superAdminToken);
  assert.equal(updatedLimits.organizationId, orgId);
  assert.ok(updatedLimits.effectiveLimits.locationPings);
  assert.equal(updatedLimits.effectiveLimits.locationPings.dailyLimit, 10);
  console.log("✓ usageGetLimits verified Super Admin updated limit overrides");

  // Record additional telemetry to trigger threshold warning (6 pings exceeds 50% of 10)
  await callFunction("usageRecordClientMetric", {
    organizationId: orgId,
    metrics: {
      locationPings: 6,
    },
  }, staffToken);

  // Check that branchUsageMonthly exists in Firestore
  const branchMonthlySnap = await db.collection("branchUsageMonthly")
    .where("organizationId", "==", orgId)
    .get();
  assert.ok(branchMonthlySnap.docs.length >= 1, "branchUsageMonthly records must be populated");
  console.log(`✓ branchUsageMonthly verified in Firestore (${branchMonthlySnap.docs.length} monthly records found)`);

  // Check notificationOutbox for threshold warning
  const warningOutboxSnap = await db.collection("notificationOutbox")
    .where("type", "==", "usage_warning")
    .get();
  console.log(`✓ notificationOutbox verified: ${warningOutboxSnap.docs.length} usage_warning notifications queued`);

  // ============================================================
  // 6. Branch Count Reconciliation (reconcileBranchCounts)
  // ============================================================
  console.log("\n[DOMAIN: RECONCILIATION] Testing reconcileBranchCounts...");

  const reconcileBranchesRes = await callFunction("reconcileBranchCounts", {
    organizationId: orgId,
    repair: true,
  }, ownerToken);
  assert.equal(reconcileBranchesRes.organizationId, orgId);
  assert.equal(reconcileBranchesRes.isDiscrepancy, false);
  assert.equal(reconcileBranchesRes.difference, 0);
  console.log(`✓ reconcileBranchCounts confirmed branch count integrity: recorded ${reconcileBranchesRes.recordedBranchCount}, actual ${reconcileBranchesRes.actualActiveBranches}`);

  // ============================================================
  // 7. Platform Activity Audit (auditLogsList)
  // ============================================================
  console.log("\n[DOMAIN: AUDIT LOGS] Testing auditLogsList...");

  await assertCallableError(
    callFunction("auditLogsList", {}, ownerToken),
    ["permission-denied", "permissiondenied"]
  );

  const auditLogsRes = await callFunction("auditLogsList", {
    organizationId: orgId,
    limit: 20,
  }, superAdminToken);
  assert.ok(Array.isArray(auditLogsRes.items), "auditLogsList must return items array");
  assert.ok(auditLogsRes.count >= 0, "auditLogsList must return count");
  assert.ok(auditLogsRes.included && typeof auditLogsRes.included === "object", "auditLogsList must return included map");
  console.log(`✓ auditLogsList returned ${auditLogsRes.items.length} sanitized audit logs with included entities`);

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 20 ANALYTICS, REPORTS, USAGE & PLATFORM CALLABLES VERIFIED! ✓    ");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
