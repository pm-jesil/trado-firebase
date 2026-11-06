/**
 * Trado Firebase Backend — Reusable Domain Payload Builders
 * 
 * Provides standard, schema-compliant payloads with realistic defaults.
 */

function buildProductPayload(organizationId, overrides = {}) {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const barcode = `${Date.now()}`.slice(-12) + `${Math.floor(Math.random() * 10)}`;
  return {
    organizationId,
    name: `Product ${unique}`,
    sku: `SKU-${unique}`,
    barcode: overrides.barcode !== undefined ? overrides.barcode : barcode,
    sellingPrice: overrides.sellingPrice ?? 100,
    costPrice: overrides.costPrice ?? overrides.baseCost ?? 70,
    baseUnit: overrides.baseUnit ?? overrides.unit ?? "piece",
    taxInclusive: overrides.taxInclusive ?? false,
    taxRatePercent: overrides.taxRatePercent ?? 18,
    lowStockThreshold: overrides.lowStockThreshold ?? 10,
    trackStock: overrides.trackStock ?? true,
    initialStock: overrides.initialStock ?? 20,
    ...overrides,
  };
}

function buildCustomerPayload(organizationId, overrides = {}) {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    organizationId,
    name: `Customer ${unique}`,
    phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `customer_${unique}@domain.local`,
    businessType: overrides.businessType ?? "individual",
    visibilityScope: overrides.visibilityScope ?? "all_branches",
    ...overrides,
  };
}

function buildVendorPayload(organizationId, overrides = {}) {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    organizationId,
    name: `Vendor ${unique}`,
    phone: `+9199${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `vendor_${unique}@vendor.local`,
    visibilityScope: overrides.visibilityScope ?? "all_branches",
    ...overrides,
  };
}

function buildPurchasePayload(organizationId, vendorId, productId, overrides = {}) {
  const qty = overrides.quantity ?? 10;
  const unitCost = overrides.unitPrice ?? 50;
  const total = qty * unitCost;
  return {
    organizationId,
    branchId: overrides.branchId ?? "main-branch",
    type: "purchase",
    vendorId,
    totalAmount: total,
    paidAmount: overrides.paidAmount ?? total,
    items: [
      {
        productId,
        quantity: qty,
        unitPrice: unitCost,
        total,
      },
    ],
    ...overrides,
  };
}

function buildBillPayload(organizationId, customerId, productId, overrides = {}) {
  const qty = overrides.quantity ?? 2;
  const unitPrice = overrides.unitPrice ?? 100;
  const total = qty * unitPrice;
  return {
    organizationId,
    branchId: overrides.branchId ?? "main-branch",
    customerId,
    salesMode: overrides.salesMode ?? "pos",
    docType: overrides.docType ?? "invoice",
    status: overrides.status ?? "active",
    items: [
      {
        productId,
        quantity: qty,
        unitPrice,
        subtotal: total,
        taxAmount: 0,
        total,
      },
    ],
    totalAmount: total,
    paidAmount: overrides.paidAmount ?? total,
    ...overrides,
  };
}

function buildTaskPayload(organizationId, assigneeMembershipId, overrides = {}) {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    organizationId,
    title: `Task ${unique}`,
    description: `Automated test task description ${unique}`,
    assignedToMembershipId: assigneeMembershipId,
    priority: overrides.priority ?? "medium",
    ...overrides,
  };
}

module.exports = {
  buildProductPayload,
  buildCustomerPayload,
  buildVendorPayload,
  buildPurchasePayload,
  buildBillPayload,
  buildTaskPayload,
};
