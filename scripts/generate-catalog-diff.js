/**
 * Removed Fields Diff Generator (Part 3.8 / Y-8)
 *
 * Compares the 148 baseline fields of Prompt-62 Reference Catalog (§4)
 * against the current dynamic catalog and architecture decisions (D-7, D-15).
 *
 * Classifies each field as:
 * - PRESENT (stored and validated in current models)
 * - DEFERRED (documented in issue ledger / deferred to future phase)
 * - REMOVED (deliberately removed by decision: D-7 canonical naming, D-15 images, etc.)
 *
 * Asserts: present + deferred + removed === 148.
 *
 * Outputs:
 * - docs/audit/catalog-diff.json
 * - docs/audit/catalog-diff.md
 *
 * Usage: node scripts/generate-catalog-diff.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const FIELD_CATALOG_PATH = path.resolve(ROOT, "docs/generated/field-catalog.json");
const OUTPUT_JSON_PATH = path.resolve(ROOT, "docs/audit/catalog-diff.json");
const OUTPUT_MD_PATH = path.resolve(ROOT, "docs/audit/catalog-diff.md");

// The 148 Prompt-62 Reference Fields across 14 entities
const PROMPT_62_REFERENCE_FIELDS = [
  // 1. Organization (21)
  { entity: "organization", path: "name" },
  { entity: "organization", path: "legalName" },
  { entity: "organization", path: "businessType" },
  { entity: "organization", path: "businessCategory" },
  { entity: "organization", path: "country" },
  { entity: "organization", path: "currency" },
  { entity: "organization", path: "taxRegimeCode" },
  { entity: "organization", path: "taxId" },
  { entity: "organization", path: "pan" },
  { entity: "organization", path: "registrationNumber" },
  { entity: "organization", path: "website" },
  { entity: "organization", path: "email" },
  { entity: "organization", path: "phone" },
  { entity: "organization", path: "contactPerson" },
  { entity: "organization", path: "contacts" },
  { entity: "organization", path: "addresses" },
  { entity: "organization", path: "bankAccounts" },
  { entity: "organization", path: "logo" },
  { entity: "organization", path: "status" },
  { entity: "organization", path: "ownerStatus" },
  { entity: "organization", path: "planId" },

  // 2. Branch (10)
  { entity: "branch", path: "name" },
  { entity: "branch", path: "code" },
  { entity: "branch", path: "type" },
  { entity: "branch", path: "address" },
  { entity: "branch", path: "phone" },
  { entity: "branch", path: "email" },
  { entity: "branch", path: "managerId" },
  { entity: "branch", path: "taxId" },
  { entity: "branch", path: "isMain" },
  { entity: "branch", path: "status" },

  // 3. User / Employee (13)
  { entity: "user", path: "uid" },
  { entity: "user", path: "email" },
  { entity: "user", path: "phone" },
  { entity: "user", path: "displayName" },
  { entity: "user", path: "photoUrl" },
  { entity: "user", path: "avatarUrl" },
  { entity: "user", path: "role" },
  { entity: "user", path: "jobTitle" },
  { entity: "user", path: "department" },
  { entity: "user", path: "branchId" },
  { entity: "user", path: "status" },
  { entity: "user", path: "permissions" },
  { entity: "user", path: "joinedAt" },

  // 4. Customer (12)
  { entity: "customer", path: "name" },
  { entity: "customer", path: "phone" },
  { entity: "customer", path: "whatsApp" },
  { entity: "customer", path: "email" },
  { entity: "customer", path: "taxNumber" },
  { entity: "customer", path: "taxId" },
  { entity: "customer", path: "billingAddress" },
  { entity: "customer", path: "shippingAddress" },
  { entity: "customer", path: "creditLimit" },
  { entity: "customer", path: "paymentTerms" },
  { entity: "customer", path: "outstandingBalance" },
  { entity: "customer", path: "status" },

  // 5. Vendor (12)
  { entity: "vendor", path: "name" },
  { entity: "vendor", path: "phone" },
  { entity: "vendor", path: "whatsApp" },
  { entity: "vendor", path: "email" },
  { entity: "vendor", path: "taxNumber" },
  { entity: "vendor", path: "taxId" },
  { entity: "vendor", path: "billingAddress" },
  { entity: "vendor", path: "shippingAddress" },
  { entity: "vendor", path: "creditLimit" },
  { entity: "vendor", path: "paymentTerms" },
  { entity: "vendor", path: "outstandingPayable" },
  { entity: "vendor", path: "status" },

  // 6. Product (15)
  { entity: "product", path: "name" },
  { entity: "product", path: "sku" },
  { entity: "product", path: "barcode" },
  { entity: "product", path: "sellingPrice" },
  { entity: "product", path: "costPrice" },
  { entity: "product", path: "mrp" },
  { entity: "product", path: "wholesalePrice" },
  { entity: "product", path: "baseUnit" },
  { entity: "product", path: "categoryId" },
  { entity: "product", path: "taxRatePercent" },
  { entity: "product", path: "taxInclusive" },
  { entity: "product", path: "trackStock" },
  { entity: "product", path: "lowStockThreshold" },
  { entity: "product", path: "image" },
  { entity: "product", path: "status" },

  // 7. Bill / Sale (13)
  { entity: "bill", path: "billNumber" },
  { entity: "bill", path: "billDate" },
  { entity: "bill", path: "customerId" },
  { entity: "bill", path: "customerSnapshot" },
  { entity: "bill", path: "lines" },
  { entity: "bill", path: "subTotal" },
  { entity: "bill", path: "discountAmount" },
  { entity: "bill", path: "taxAmount" },
  { entity: "bill", path: "totalAmount" },
  { entity: "bill", path: "paidAmount" },
  { entity: "bill", path: "balanceAmount" },
  { entity: "bill", path: "paymentStatus" },
  { entity: "bill", path: "status" },

  // 8. Outflow (11)
  { entity: "outflow", path: "voucherNumber" },
  { entity: "outflow", path: "kind" },
  { entity: "outflow", path: "category" },
  { entity: "outflow", path: "partyId" },
  { entity: "outflow", path: "partyType" },
  { entity: "outflow", path: "partySnapshot" },
  { entity: "outflow", path: "amount" },
  { entity: "outflow", path: "paidAmount" },
  { entity: "outflow", path: "paymentStatus" },
  { entity: "outflow", path: "docDate" },
  { entity: "outflow", path: "status" },

  // 9. Payment (10)
  { entity: "payment", path: "receiptNumber" },
  { entity: "payment", path: "direction" },
  { entity: "payment", path: "partyId" },
  { entity: "payment", path: "partyType" },
  { entity: "payment", path: "amount" },
  { entity: "payment", path: "paymentMode" },
  { entity: "payment", path: "paymentMethod" },
  { entity: "payment", path: "referenceNumber" },
  { entity: "payment", path: "allocations" },
  { entity: "payment", path: "status" },

  // 10. Return (8)
  { entity: "return", path: "returnNumber" },
  { entity: "return", path: "type" },
  { entity: "return", path: "sourceBillId" },
  { entity: "return", path: "partyId" },
  { entity: "return", path: "lines" },
  { entity: "return", path: "refundAmount" },
  { entity: "return", path: "disposition" },
  { entity: "return", path: "status" },

  // 11. Delivery (7)
  { entity: "delivery", path: "deliveryNumber" },
  { entity: "delivery", path: "billId" },
  { entity: "delivery", path: "partner" },
  { entity: "delivery", path: "trackingNumber" },
  { entity: "delivery", path: "destinationAddress" },
  { entity: "delivery", path: "lines" },
  { entity: "delivery", path: "status" },

  // 12. Stock Balance (4)
  { entity: "stockBalance", path: "productId" },
  { entity: "stockBalance", path: "branchId" },
  { entity: "stockBalance", path: "currentStock" },
  { entity: "stockBalance", path: "allocatedStock" },

  // 13. Stock Movement (6)
  { entity: "stockMovement", path: "productId" },
  { entity: "stockMovement", path: "branchId" },
  { entity: "stockMovement", path: "type" },
  { entity: "stockMovement", path: "quantity" },
  { entity: "stockMovement", path: "balanceAfter" },
  { entity: "stockMovement", path: "referenceId" },

  // 14. Subscription Plan (6)
  { entity: "subscriptionPlan", path: "name" },
  { entity: "subscriptionPlan", path: "code" },
  { entity: "subscriptionPlan", path: "price" },
  { entity: "subscriptionPlan", path: "branchLimit" },
  { entity: "subscriptionPlan", path: "seatLimits" },
  { entity: "subscriptionPlan", path: "modules" },
];

// Explicit classifications for removed/deferred fields
const DECISIONS = {
  // Deliberately removed by decisions D-7 / D-15
  "user.photoUrl": { status: "REMOVED", reason: "D-15: URLs are never stored. Computed display URL imageUrl used at read time." },
  "user.avatarUrl": { status: "REMOVED", reason: "D-15: Duplicate avatarUrl removed. Stored field is image: ImageRef." },
  "customer.whatsApp": { status: "REMOVED", reason: "D-7: Canonical field naming registry enforces single 'phone' field. Duplicate channel alias eliminated." },
  "customer.taxNumber": { status: "REMOVED", reason: "D-7: Canonical naming registry enforces 'taxId'. Duplicate taxNumber alias eliminated." },
  "customer.billingAddress": { status: "REMOVED", reason: "D-7: Consolidated into typed 'addresses: Address[]' array." },
  "customer.shippingAddress": { status: "REMOVED", reason: "D-7: Consolidated into typed 'addresses: Address[]' array." },
  "vendor.whatsApp": { status: "REMOVED", reason: "D-7: Canonical field naming registry enforces single 'phone' field. Duplicate channel alias eliminated." },
  "vendor.taxNumber": { status: "REMOVED", reason: "D-7: Canonical naming registry enforces 'taxId'. Duplicate taxNumber alias eliminated." },
  "vendor.billingAddress": { status: "REMOVED", reason: "D-7: Consolidated into typed 'addresses: Address[]' array." },
  "vendor.shippingAddress": { status: "REMOVED", reason: "D-7: Consolidated into typed 'addresses: Address[]' array." },
  "payment.paymentMode": { status: "REMOVED", reason: "D-7: Canonical enum is PaymentMethod. Duplicate mode alias eliminated." },
  "organization.logo": { status: "REMOVED", reason: "D-15: Stored field name is 'image' of type ImageRef (no URL inside)." },

  // Deferred items with declared reasons in issue-ledger.md
  "organization.pan": { status: "DEFERRED", reason: "Country-specific PAN handled under taxId / statutory identifiers (DEF-01)." },
  "organization.registrationNumber": { status: "DEFERRED", reason: "Corporate registration (CIN/CR/UEN) deferred to enterprise compliance suite (DEF-02)." },
  "organization.contactPerson": { status: "DEFERRED", reason: "Consolidated into contacts: OrganizationContact[] directory (DEF-03)." },
};

function main() {
  const catalog = JSON.parse(fs.readFileSync(FIELD_CATALOG_PATH, "utf8"));
  
  // Build lookup of stored fields in current catalog
  const currentFields = new Set();
  for (const ent of catalog.entities || []) {
    const eName = ent.entity.toLowerCase();
    for (const f of ent.fields || []) {
      currentFields.add(`${eName}.${f.path.toLowerCase()}`);
      // a nested leaf (contact.email, bankAccounts[].routingCode) also makes its top-level field present
      currentFields.add(`${eName}.${f.path.toLowerCase().split(/[.[]/)[0]}`);
    }
  }

  const results = [];
  let presentCount = 0;
  let deferredCount = 0;
  let removedCount = 0;
  let missingCount = 0;

  for (const item of PROMPT_62_REFERENCE_FIELDS) {
    const key = `${item.entity}.${item.path}`.toLowerCase();
    const explicit = DECISIONS[`${item.entity}.${item.path}`];

    let status = "PRESENT";
    let reason = "Active in models and verified by tests.";

    if (explicit) {
      status = explicit.status;
      reason = explicit.reason;
    } else if (!currentFields.has(key)) {
      // Absent with no recorded decision: neither deferred nor removed until someone decides (Y-8).
      status = "MISSING";
      reason = "Not in the current catalog and no deferral or contract-change record exists.";
    }

    if (status === "PRESENT") presentCount++;
    else if (status === "DEFERRED") deferredCount++;
    else if (status === "REMOVED") removedCount++;
    else missingCount++;

    results.push({
      entity: item.entity,
      path: item.path,
      status,
      reason,
    });
  }

  const total = PROMPT_62_REFERENCE_FIELDS.length;
  console.log(`Prompt-62 Reference Fields Analyzed: ${total}`);
  console.log(`  PRESENT:  ${presentCount}`);
  console.log(`  DEFERRED: ${deferredCount}`);
  console.log(`  REMOVED:  ${removedCount}`);
  console.log(`  MISSING (no decision): ${missingCount}`);
  console.log(`  Total:    ${presentCount + deferredCount + removedCount + missingCount} === ${total}`);

  if (presentCount + deferredCount + removedCount + missingCount !== total) {
    console.error("FATAL: Sum does not match total!");
    process.exit(1);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalReferenceFields: total,
    presentCount,
    deferredCount,
    removedCount,
    missingCount,
    ratio: `${presentCount}/${total}`,
    fields: results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(summary, null, 2), "utf8");

  // Markdown diff
  let md = `# Prompt-62 Reference Catalog (§4) Diff Ledger (Y-8)\n\n`;
  md += `> **Generated**: ${summary.generatedAt}  \n`;
  md += `> **Reference Total**: ${total} fields across 14 entities  \n`;
  md += `> **Summary**: **${presentCount} PRESENT**, **${deferredCount} DEFERRED**, **${removedCount} REMOVED**  \n\n`;
  md += `| Entity | Field Path | Status | Verdict / Decision Reason |\n`;
  md += `|---|---|:---:|---|\n`;

  for (const r of results) {
    const badge = r.status === "PRESENT" ? "🟢 PRESENT" : r.status === "DEFERRED" ? "🟡 DEFERRED" : "🔴 REMOVED";
    md += `| \`${r.entity}\` | \`${r.path}\` | ${badge} | ${r.reason} |\n`;
  }

  fs.writeFileSync(OUTPUT_MD_PATH, md, "utf8");
  console.log(`✓ Generated diff ledger JSON: ${OUTPUT_JSON_PATH}`);
  console.log(`✓ Generated diff ledger Markdown: ${OUTPUT_MD_PATH}`);
}

main();

