/**
 * Trado Firebase Backend — Catalog & Inventory Callables Contract Test
 * 
 * Tests 13 exports across catalog, categories, units, products, stock, and reconciliation:
 * 1. categoriesCreate
 * 2. categoriesUpdate
 * 3. categoriesList
 * 4. unitsCreate
 * 5. unitsUpdate
 * 6. unitsList
 * 7. productsCreate
 * 8. productsUpdate
 * 9. productsList
 * 10. productsGet
 * 11. stockAdjust
 * 12. stockMovementsList
 * 13. reconcileStockBalances
 */

const assert = require("node:assert/strict");
const { verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const { createTenantOwnerPersona, createUnassignedUserPersona } = require("./helpers/auth-personas.cjs");
const { buildProductPayload } = require("./helpers/domain-builders.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: CATALOG & INVENTORY CALLABLES CONTRACT                     ");
  console.log("================================================================================\n");

  await verifyEmulatorHealth();

  console.log("[SETUP] Provisioning test personas...");
  const owner = await createTenantOwnerPersona({
    businessName: "Catalog Inventory Testing Mart",
    defaultBranchName: "Main Store",
    defaultBranchCode: "MAIN",
  });
  const unassigned = await createUnassignedUserPersona();
  const ownerToken = owner.idToken;
  const orgId = owner.organizationId;
  console.log(`✓ Tenant Owner authenticated: ${owner.email} (Org: ${orgId})\n`);

  // ============================================================
  // 1. Categories Lifecycle: Create, Update, List
  // ============================================================
  console.log("[DOMAIN: CATEGORIES] Testing categoriesCreate, categoriesUpdate, categoriesList...");

  // Unauthenticated/Unassigned rejected
  await assertCallableError(
    callFunction("categoriesCreate", {
      organizationId: orgId,
      name: "Dairy & Frozen",
    }, unassigned.idToken),
    ["permission-denied"]
  );
  console.log("✓ categoriesCreate rejected unassigned user");

  // Create parent category
  const catCreateRes = await callFunction("categoriesCreate", {
    organizationId: orgId,
    name: "Beverages",
    nature: "product",
  }, ownerToken);
  assert.ok(catCreateRes.categoryId, "categoriesCreate must return categoryId");
  assert.equal(catCreateRes.name, "Beverages");
  const parentCatId = catCreateRes.categoryId;
  console.log(`✓ Parent category created: Beverages (ID: ${parentCatId})`);

  // Create subcategory with parentId
  const subCatRes = await callFunction("categoriesCreate", {
    organizationId: orgId,
    name: "Fruit Juices",
    parentId: parentCatId,
    nature: "product",
  }, ownerToken);
  assert.ok(subCatRes.categoryId);
  const subCatId = subCatRes.categoryId;
  console.log(`✓ Subcategory created: Fruit Juices (ID: ${subCatId}, Parent: ${parentCatId})`);

  // Update category
  const catUpdateRes = await callFunction("categoriesUpdate", {
    categoryId: subCatId,
    name: "Fresh Fruit Juices & Smoothies",
  }, ownerToken);
  assert.ok(catUpdateRes.success, "categoriesUpdate must succeed");
  console.log("✓ categoriesUpdate updated subcategory name");

  // List categories
  const catListRes = await callFunction("categoriesList", {
    organizationId: orgId,
    includeGlobal: true,
  }, ownerToken);
  assert.ok(Array.isArray(catListRes.items), "categoriesList must return items array");
  const foundSubCat = catListRes.items.find(c => c.name === "Fresh Fruit Juices & Smoothies");
  assert.ok(foundSubCat, "categoriesList must contain updated subcategory");
  console.log(`✓ categoriesList returned ${catListRes.items.length} categories including newly created ones`);

  // ============================================================
  // 2. Units Lifecycle: Create, Update, List
  // ============================================================
  console.log("\n[DOMAIN: UNITS] Testing unitsCreate, unitsUpdate, unitsList...");

  const unitCode = `pk${Math.floor(Math.random() * 1000)}`;
  const unitCreateRes = await callFunction("unitsCreate", {
    organizationId: orgId,
    name: "Six Pack",
    code: unitCode,
    group: "count",
    precision: 0,
  }, ownerToken);
  assert.ok(unitCreateRes.unitId, "unitsCreate must return unitId");
  const testUnitId = unitCreateRes.unitId;
  console.log(`✓ Unit created: Six Pack (${unitCode}, ID: ${testUnitId})`);

  // Update unit
  const unitUpdateRes = await callFunction("unitsUpdate", {
    unitId: testUnitId,
    name: "Six-Pack Carton",
    precision: 0,
  }, ownerToken);
  assert.ok(unitUpdateRes.success, "unitsUpdate must succeed");
  console.log("✓ unitsUpdate updated unit name");

  // List units
  const unitListRes = await callFunction("unitsList", {
    organizationId: orgId,
    includeGlobal: true,
  }, ownerToken);
  assert.ok(Array.isArray(unitListRes.items), "unitsList must return items array");
  assert.ok(unitListRes.items.some(u => u.name === "Six-Pack Carton"));
  console.log(`✓ unitsList returned ${unitListRes.items.length} units`);

  // ============================================================
  // 3. Products Lifecycle: Create, Update, List, Get
  // ============================================================
  console.log("\n[DOMAIN: PRODUCTS] Testing productsCreate, productsUpdate, productsList, productsGet...");

  const barcode1 = `BC${Date.now().toString().slice(-8)}`;
  const prod1Payload = buildProductPayload(orgId, {
    name: "Mango Smoothie 500ml",
    categoryId: subCatId,
    baseUnit: "piece",
    barcode: barcode1,
    sellingPrice: 120,
    costPrice: 75,
    initialStock: 50,
    trackStock: true,
  });

  const prod1Res = await callFunction("productsCreate", prod1Payload, ownerToken);
  assert.ok(prod1Res.productId, "productsCreate must return productId");
  assert.equal(prod1Res.currentStock, 50, "Initial stock must be 50");
  const prod1Id = prod1Res.productId;
  console.log(`✓ Product created: Mango Smoothie 500ml (ID: ${prod1Id}, Stock: 50, Barcode: ${barcode1})`);

  // Reject duplicate barcode in same org
  const duplicateBarcodePayload = buildProductPayload(orgId, {
    name: "Mango Smoothie Deluxe",
    barcode: barcode1,
  });
  await assertCallableError(
    callFunction("productsCreate", duplicateBarcodePayload, ownerToken),
    ["already-exists"]
  );
  console.log("✓ productsCreate correctly rejected duplicate barcode within organization");

  // Update product details
  const prodUpdateRes = await callFunction("productsUpdate", {
    organizationId: orgId,
    productId: prod1Id,
    sellingPrice: 135,
    lowStockThreshold: 15,
  }, ownerToken);
  assert.ok(prodUpdateRes.success, "productsUpdate must succeed");
  console.log("✓ productsUpdate updated selling price and lowStockThreshold");

  // Get product by ID
  const prodGetRes = await callFunction("productsGet", {
    organizationId: orgId,
    productId: prod1Id,
  }, ownerToken);
  assert.equal(prodGetRes.productId, prod1Id);
  assert.equal(prodGetRes.sellingPrice, 135);
  assert.equal(prodGetRes.currentStock, 50);
  console.log("✓ productsGet retrieved product details matching updates");

  // Reject cross-tenant access for productsGet
  const otherOwner = await createTenantOwnerPersona({
    businessName: "Competing Supermarket",
    defaultBranchName: "Downtown",
    defaultBranchCode: "DOWN",
  });
  await assertCallableError(
    callFunction("productsGet", {
      organizationId: otherOwner.organizationId,
      productId: prod1Id,
    }, otherOwner.idToken),
    ["permission-denied", "not-found"]
  );
  console.log("✓ productsGet correctly rejected cross-tenant access");

  // List products
  const prodListRes = await callFunction("productsList", {
    organizationId: orgId,
    categoryId: subCatId,
  }, ownerToken);
  assert.ok(Array.isArray(prodListRes.items));
  assert.ok(prodListRes.items.some(p => p.productId === prod1Id));
  console.log(`✓ productsList returned ${prodListRes.items.length} items for category ${subCatId}`);

  // ============================================================
  // 4. Stock Management: stockAdjust, stockMovementsList
  // ============================================================
  console.log("\n[DOMAIN: STOCK] Testing stockAdjust, stockMovementsList...");

  // Positive stock adjustment (+25)
  const stockInRes = await callFunction("stockAdjust", {
    organizationId: orgId,
    productId: prod1Id,
    quantity: 25,
    reason: "New stock arrival from local supplier",
  }, ownerToken);
  assert.equal(stockInRes.previousStock, 50);
  assert.equal(stockInRes.newStock, 75);
  assert.equal(stockInRes.quantityAdjusted, 25);
  assert.ok(stockInRes.movementId);
  console.log("✓ [stockAdjust#ok] stockAdjust (+) increased stock from 50 to 75");

  // Negative stock adjustment (-10 for damage/breakage)
  const stockOutRes = await callFunction("stockAdjust", {
    organizationId: orgId,
    productId: prod1Id,
    quantity: -10,
    reason: "Damaged bottles written off",
  }, ownerToken);
  assert.equal(stockOutRes.previousStock, 75);
  assert.equal(stockOutRes.newStock, 65);
  assert.equal(stockOutRes.quantityAdjusted, -10);
  console.log("✓ [stockAdjust#ok] stockAdjust (-) decreased stock from 75 to 65");

  // List stock movements
  const movementsRes = await callFunction("stockMovementsList", {
    organizationId: orgId,
    productId: prod1Id,
  }, ownerToken);
  assert.ok(Array.isArray(movementsRes.items));
  // At least 3 movements: opening (50), adjustment (+25), adjustment (-10)
  assert.ok(movementsRes.items.length >= 3, `Expected at least 3 stock movements, got ${movementsRes.items.length}`);
  console.log(`✓ [stockMovementsList#ok] stockMovementsList returned ${movementsRes.items.length} immutable movement records`);

  // ============================================================
  // 5. Reconciliation: reconcileStockBalances
  // ============================================================
  console.log("\n[DOMAIN: RECONCILIATION] Testing reconcileStockBalances...");

  const reconRes = await callFunction("reconcileStockBalances", {
    organizationId: orgId,
    productId: prod1Id,
  }, ownerToken);

  assert.equal(reconRes.organizationId, orgId);
  assert.equal(reconRes.discrepancyCount, 0, "No discrepancy expected between movements and currentStock");
  const reconItem = reconRes.items.find(i => i.productId === prod1Id);
  assert.ok(reconItem, "Reconciliation item for product must exist");
  assert.equal(reconItem.currentStock, 65);
  assert.equal(reconItem.movementSum, 65);
  assert.equal(reconItem.isDiscrepancy, false);
  console.log(`✓ reconcileStockBalances verified: currentStock (${reconItem.currentStock}) exactly matches movementSum (${reconItem.movementSum}) with 0 discrepancies`);

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 13 CATALOG & INVENTORY CALLABLES VERIFIED SUCCESSFULLY! ✓         ");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
