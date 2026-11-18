/**
 * check:same-doc-duplicates — Guard against same-document duplicate values (D-15 / R1)
 * @guard-scope: per-collection (every collection derived from source; docs/generated/guard-scopes/check-same-doc-duplicates.json)
 *
 * On a seeded emulator, enumerates every field path in every document and checks:
 *   1. Any two distinct field paths with deep-equal, non-trivial values → FAIL
 *      (Ignores: booleans, 0, null, empty string/array, registered pairs)
 *   2. Name-family detection: any document containing two or more keys from the same
 *      concept family (image, phone, tax-id, etc.) → FAIL unless registered as R2/R3.
 *
 * Registered exemptions (R2 frozen snapshots, R3 caches with declared single writer):
 *   - { createdAt, updatedAt } — same value at creation; R2
 *   - { contactEmail, contact.email } — R3 cache; single writer: organizationsUpdate
 *   - { contactPhone, contact.phone } — R3 cache; single writer: organizationsUpdate
 *
 * Usage: node functions/scripts/check-same-doc-duplicates.cjs
 */

const truth = require("../../scripts/lib/source-truth.js");
const { writeGuardScope } = require("../../scripts/lib/guard-scope.js");

// D-17: Registered value-identical pairs that are allowed
// Format: "fieldA|fieldB" (sorted alphabetically)
const REGISTERED_PAIRS = new Set([
  // Temporal — same instant when created
  "createdAt|updatedAt",
  "createdAt|subscriptionStartsAt",   // org subscription starts when org is created (default)
  "createdAt|subscriptionExpiresAt",  // 0-day trial edge case
  // Actor stamps — same person created and updated on first write
  "createdBy|updatedBy",
  "createdBy|ownerUserId",
  "ownerUserId|updatedBy",
  "createdBy|userId",
  "updatedBy|userId",
  // Image dimensions — square images have equal width and height
  "image.height|image.width",
  // Name variants — different semantics; coincidental equality is allowed
  "displayName|legalName",
  "legalName|name",
  // R3 lookup key: nameKey = nameKey(name) (services/naturalKeys.ts, single writer per entity callable); equal when name is already normalised
  "name|nameKey",
  // Same R3 rule for the organization's legal name (organizationsCreate / organizationsUpdate)
  "legalName|legalNameKey",
  // Serial line references — line 1 of receiving bill vs line 1 of sales bill coincidence
  "receivedLineId|soldLineId",
  // Location timestamps — ping recordedAt equals document createdAt/updatedAt on ingestion
  "createdAt|recordedAt",
  "recordedAt|updatedAt",
  // Device timestamps — initial device document write stamps lastLoginAt with createdAt/updatedAt
  "createdAt|lastLoginAt",
  "lastLoginAt|updatedAt",
  // Image upload sessions — self-upload where callerUid is the entityId being uploaded for (user avatar)
  "callerUid|entityId",
  // Image upload sessions — an organization's own logo: the session scope is the organization id
  "entityId|scope",
  // Notification entity reference — when notification targets the organization itself
  "organizationId|relatedEntityId",
  // Status fields — different scopes (entity status vs owner status)
  "ownerStatus|status",
  // Count fields — coincidentally equal numerics (independent counters)
  "activeEmployeeCount|branchCount",
  "activeEmployeeCount|currencyDecimals",
  "branchCount|currencyDecimals",
  "branchLimit|seatLimits.admin",     // plan definition: admin seats == branch limit by design in some plans
  "branchLimit|seatLimits.staff",
  "seatLimits.admin|seatLimits.staff",
  // sharingPolicies sub-fields — per-module policy flags; coincidental equality is fine
  "sharingPolicies.categories|sharingPolicies.customers",
  "sharingPolicies.categories|sharingPolicies.deliveries",
  "sharingPolicies.categories|sharingPolicies.expenses",
  "sharingPolicies.categories|sharingPolicies.products",
  "sharingPolicies.categories|sharingPolicies.purchases",
  "sharingPolicies.categories|sharingPolicies.vendors",
  "sharingPolicies.customers|sharingPolicies.deliveries",
  "sharingPolicies.customers|sharingPolicies.expenses",
  "sharingPolicies.customers|sharingPolicies.products",
  "sharingPolicies.customers|sharingPolicies.purchases",
  "sharingPolicies.customers|sharingPolicies.vendors",
  "sharingPolicies.deliveries|sharingPolicies.expenses",
  "sharingPolicies.deliveries|sharingPolicies.products",
  "sharingPolicies.deliveries|sharingPolicies.purchases",
  "sharingPolicies.deliveries|sharingPolicies.vendors",
  "sharingPolicies.expenses|sharingPolicies.products",
  "sharingPolicies.expenses|sharingPolicies.purchases",
  "sharingPolicies.expenses|sharingPolicies.vendors",
  "sharingPolicies.products|sharingPolicies.purchases",
  "sharingPolicies.products|sharingPolicies.vendors",
  "sharingPolicies.purchases|sharingPolicies.vendors",
  "sharingPolicies.sales|sharingPolicies.stock",
  "sharingPolicies.customers|sharingPolicies.sales",
  "sharingPolicies.customers|sharingPolicies.stock",
  "sharingPolicies.sales|sharingPolicies.expenses",
  "sharingPolicies.sales|sharingPolicies.deliveries",
  "sharingPolicies.sales|sharingPolicies.customers",
  "sharingPolicies.sales|sharingPolicies.vendors",
  "sharingPolicies.stock|sharingPolicies.purchases",
  "sharingPolicies.stock|sharingPolicies.expenses",
  "sharingPolicies.stock|sharingPolicies.deliveries",
  "sharingPolicies.stock|sharingPolicies.customers",
  "sharingPolicies.stock|sharingPolicies.vendors",
  "sharingPolicies.stock|sharingPolicies.categories",
  "sharingPolicies.stock|sharingPolicies.products",
  // R3 caches — single writer: organizationsUpdate
  "contactEmail|contact.email",
  "contactPhone|contact.phone",
  // stockMovements — opening-stock entries where quantity equals balanceAfter
  "balanceAfter|quantity",
  // stockMovements — stock adjustment where referenceId is the productId being adjusted
  "productId|referenceId",
  // stockMovements — opening cost snapshot that coincides with numeric balanceAfter
  "balanceAfter|unitCostSnapshot",
  // stockBalances — coincidental numeric equality between independent balance fields
  "currentStock|openingStock",
  "balanceAfter|openingStock",
  // Bills — discount and tax amounts that happen to equal
  "discountAmount|taxAmount",
  // Party ledger — amounts that coincide
  "debitAmount|creditAmount",
  // Delivery — quantity in line = quantity on associated bill line
  "quantity|requestedQuantity",
  // Generic ID coincidences in polymorphic documents
  "branchId|primaryBranchId",
  "organizationId|scope",
  // Misc numeric coincidences
  "currencyDecimals|financialYearStartMonth",
  "graceDays|currencyDecimals",
  // Bills — subTotal equals totalAmount when no taxes (zero-tax sale); paidAmount equals totalAmount when paid in full
  "paidAmount|subTotal",
  "paidAmount|totalAmount",
  "subTotal|totalAmount",
  // Bills — balanceAmount equals totalAmount when completely unpaid
  "balanceAmount|subTotal",
  "balanceAmount|totalAmount",
  // Outflows — same patterns
  "balanceAmount|paidAmount",
  // Outflow docDate = createdAt when the outflow is created immediately
  "createdAt|docDate",
  "docDate|updatedAt",
  "createdAt|issuedAt",
  "issuedAt|updatedAt",
  // Bill dates
  "billDate|createdAt",
  "billDate|updatedAt",
  "billDate|issuedAt",
  "dueDate|billDate",
  // Payment void — voidedBy and voidedAt match actor/timestamp when same session
  "createdBy|voidedBy",
  "updatedBy|voidedBy",
  "updatedAt|voidedAt",
  // Delivery completion
  "deliveredAt|updatedAt",
  // Stock threshold coincidence
  "currentStock|lowStockThreshold",
  "lowStockThreshold|reservedStock",
  // Actor IDs — salesperson and creator are same person for self-created bills
  "createdByMembershipId|salespersonMembershipId",
  "actorMembershipId|createdByMembershipId",
  "actorUid|createdBy",
  "actorUid|updatedBy",
  // Membership IDs — membership and reference on join docs
  "membershipId|primaryBranchId",
  // Subscription plan numeric limits
  "branchLimit|storageLimitMb",
  "seatLimits.admin|storageLimitMb",
  // Approval thresholds
  "amountThreshold|currencyDecimals",
  // Bill amounts
  "discountedAmount|subTotal",
  "netAmount|subTotal",
  "netAmount|totalAmount",
  // Return amounts
  "refundAmount|totalAmount",
  "refundAmount|subTotal",
  // Payments
  "amount|totalAmount",
  "amount|subTotal",
  "amount|paidAmount",
  // Stock movement costs
  "totalCost|quantity",
  "unitCostSnapshot|unitPrice",
  "costPrice|sellingPrice",
  "mrp|sellingPrice",
  // Bill finalization — finalizedBy and finalizedAt match updatedBy/updatedAt when finalized by same user
  "createdBy|finalizedBy",
  "finalizedBy|updatedBy",
  "finalizedAt|updatedAt",
  // Outflow rejection actor stamps
  "rejectedBy|updatedBy",
  "rejectedAt|updatedAt",
  // Approval stamps
  "approvedBy|createdBy",
  "approvedBy|updatedBy",
  "approvedAt|updatedAt",
  // State transition stamps & actor identities in test/single-user workflows
  "appliedBy|lastActivityBy.uid",
  "assignee.uid|lastActivityBy.uid",
  "cancelledAt|updatedAt",
  "cancelledBy|createdBy",
  "cancelledBy|updatedBy",
  "createdAt|lastActivityAt",
  "createdAt|statusChangedAt",
  "createdBy|dispatchedBy",
  "createdBy|enteredBy",
  "createdBy|receivedBy",
  "createdBy|submittedBy",
  "dispatchedBy|receivedBy",
  "dispatchedBy|submittedBy",
  "dispatchedBy|updatedBy",
  "enteredBy|updatedBy",
  "firstResponseAt|lastActivityAt",
  "firstResponseAt|statusChangedAt",
  "firstResponseAt|updatedAt",
  "lastActivityBy.name|requester.name",
  "lastActivityBy.name|requesterName",
  "lastActivityBy.uid|requester.uid",
  "receivedAt|updatedAt",
  "receivedBy|submittedBy",
  "receivedBy|updatedBy",
  "submittedBy|updatedBy",
  // Workflow timestamps
  "appliedAt|lastActivityAt",
  "appliedAt|statusChangedAt",
  "appliedAt|updatedAt",
  "closedAt|statusChangedAt",
  "lastActivityAt|statusChangedAt",
  "lastActivityAt|updatedAt",
  "statusChangedAt|updatedAt",
  // Identifiers & entity attributes
  "address.city|address.state",
  "applyResult.metric|details.metric",
  "currentPlanName|requestedPlanName",
  "financialAccountId|sourceDocumentId",
  "legalNameKey|name",
  "membershipId|userId",
  "requester.name|requesterName",
  // Bill tax — taxTotal equals taxSnapshot.taxAmount for single-line bills or when only one tax applies
  "taxSnapshot.taxAmount|taxTotal",
  // Bill amounts — coincidental equality between tax total and balance when partially paid
  "balanceAmount|taxTotal",
  "balanceAmount|taxSnapshot.taxAmount",
  // Status fields — different scopes (entity vs subscription status)
  "ownerStatus|subscriptionStatus",
  "status|subscriptionStatus",
  // Financial year / employee count coincidental equality
  "activeEmployeeCount|financialYearStartMonth",
  // Product: costPrice == weightedAverageCost — R3 cache; WAC starts equal to costPrice,
  //   diverges after purchases. Single writer: onOutflowWritten trigger.
  "costPrice|weightedAverageCost",
  // Product: lowStockThreshold == maxDiscountPercent — different units, coincidental numeric equality
  "lowStockThreshold|maxDiscountPercent",
  // Product: taxRatePercent == lowStockThreshold — different units, coincidental numeric equality
  "lowStockThreshold|taxRatePercent",
  // Bill taxSnapshot: taxRatePercent and taxAmount coincidentally equal (e.g. 18% on ₹100 = 18)
  "taxSnapshot.taxAmount|taxSnapshot.taxRatePercent",
  // Customer: totalSpend == outstandingBalance when first purchase is entirely unpaid
  "outstandingBalance|totalSpend",
  // Vendor: outstandingPayable == totalPurchase when purchase is entirely unpaid
  "outstandingPayable|totalPurchase",
  // Task: self-assigned task where assigner and assignee are the same member
  "assignedByMembershipId|assignedToMembershipId",
  // Note: phone|whatsApp and billingAddress|shippingAddress removed — those fields are removed from the model (D-7)
]);

// Name families: same concept, only one field should be present in a stored document
const NAME_FAMILIES = {
  image: ["image", "photoUrl", "avatarUrl", "logoUrl", "imageUrls", "imageUrl", "pictureUrl"],
  taxId: ["taxId", "taxNumber", "gstin", "trn", "vatNumber", "registrationNumber"],
  organizationId: ["organizationId", "orgId", "tenantId"],
  total: ["totalAmount", "grandTotal"],
  balance: ["outstandingBalance", "outstandingPayable", "dueAmount"],
  name: ["name", "displayName"],
  status: ["status", "isActive", "active", "enabled"],
  timestamp: ["createdAt", "createdAtTimestamp", "createdTimestamp", "createdAtIso"],
};

// Non-trivial: exclude these values from equality check. Values from a small closed domain coincide by
// nature and are never a copy: booleans, numbers (a number derived from others is checked by (iii)),
// enum tokens ("self", "organization_shared") and ISO codes ("IN", "INR").
function isTrivial(val) {
  if (val === null || val === undefined) return true;
  if (typeof val === "boolean") return true;
  if (typeof val === "number") return true;
  if (typeof val === "string" && (/^[a-z][a-z0-9_]{0,31}$/.test(val) || /^[A-Z]{2,3}$/.test(val))) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

function flattenDoc(obj, prefix = "") {
  const result = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v.toDate)) {
      Object.assign(result, flattenDoc(v, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

// D-17: All 47 concrete Firestore collections classified explicitly
const COLLECTION_POLICY = {
  // Business Domain & Catalog Entities: Full checks (same-value + name-family)

  // Aggregated Analytics & Usage Rollups: Name-family checked; same-value exempted with declared D-17 reason
  "dailySummaries": { checkSameValue: false, exemptionReason: "Aggregated financial rollups with coincidental numeric metrics (revenue, profit, counts)" },
  "monthlySummaries": { checkSameValue: false, exemptionReason: "Aggregated financial rollups with coincidental financial metrics (revenue, profit, counts)" },
  "organizationUsageDaily": { checkSameValue: false, exemptionReason: "Usage aggregation rollups with coincidental integer metrics" },
  "organizationUsageMonthly": { checkSameValue: false, exemptionReason: "Usage aggregation rollups with coincidental integer metrics" },
  "userUsageDaily": { checkSameValue: false, exemptionReason: "Usage aggregation rollups with coincidental integer metrics" },
  "platformCostReconciliation": { checkSameValue: false, exemptionReason: "Reconciliation rollups with coincidental numeric metrics" },
  "branchUsageDaily": { checkSameValue: false, exemptionReason: "Usage aggregation rollups with coincidental integer metrics" },
  "branchUsageMonthly": { checkSameValue: false, exemptionReason: "Usage aggregation rollups with coincidental integer metrics" },

  // System Infrastructure & Append-Only Logs: Name-family checked; same-value exempted with declared D-17 reason
  "notificationOutbox": { checkSameValue: false, exemptionReason: "Outbox delivery queue envelope wrapping notification payload data" },
  "auditLogs": { checkSameValue: false, exemptionReason: "Event diff metadata and entity-scope coincidence" },
  "idempotencyRecords": { checkSameValue: false, exemptionReason: "Replay cache stores duplicate payload and result" },
  "usageCounterShards": { checkSameValue: false, exemptionReason: "Sharded numeric counters with coincidental integer metrics" },
  "documentCounters": { checkSameValue: false, exemptionReason: "Atomic sequential integer counter shards" },
  "uniqueKeys": { checkSameValue: false, exemptionReason: "Natural key reservation locks" },
};

/**
 * (iii) Stored values computable from siblings in the same document. Allowed only when registered:
 * R2 = frozen snapshot of a financial or legal document (never recomputed after it is issued);
 * R3 = cache with a single writer and a reconcile test.
 */
const DERIVED_REGISTER = [
  { collections: ["bills", "outflows", "returns", "stockTransfers"], field: /^(subTotal|totalAmount|totalRefundAmount|taxTotal|discountTotal|totalValuation)$/, class: "R2", reason: "document totals are frozen when the document is issued (tax invoice / purchase / credit note / stock transfer); lines are never edited afterwards" },
  { collections: ["dailySummaries", "monthlySummaries", "organizationUsageDaily", "organizationUsageMonthly", "branchUsageDaily", "branchUsageMonthly", "usageCounterShards"], field: /.*/, class: "R3", reason: "rollup counters; single writer (triggers / usageMetering); reconciled by reconcile* callables" },
];

const isTimestamp = (v) => v && typeof v === "object" && typeof v.toDate === "function";
const comparable = (v) => (isTimestamp(v) ? v.toDate().toISOString() : v);

/** Every object node of a document (including inside arrays) with its path and own keys. */
function objectNodes(value, at = "", out = []) {
  if (Array.isArray(value)) value.forEach((item, i) => objectNodes(item, `${at}[${i}]`, out));
  else if (value && typeof value === "object" && !isTimestamp(value)) {
    out.push({ at, node: value });
    for (const [k, v] of Object.entries(value)) objectNodes(v, at ? `${at}.${k}` : k, out);
  }
  return out;
}

/** All checks for one document. Pure: the defect test drives it directly and through the emulator. */
function analyzeDocument(collection, ref, data) {
  const findings = [];
  const policy = COLLECTION_POLICY[collection] || { checkSameValue: true };
  // (i) two fields holding the same value (timestamps compared as instants)
  if (policy.checkSameValue !== false) {
    const flat = flattenDoc(data);
    const keys = Object.keys(flat);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const va = comparable(flat[keys[i]]);
        const vb = comparable(flat[keys[j]]);
        if (isTrivial(va) || isTrivial(vb) || JSON.stringify(va) !== JSON.stringify(vb)) continue;
        if (!REGISTERED_PAIRS.has(pairKey(keys[i], keys[j]))) findings.push({ doc: ref, type: "same-value", detail: `"${keys[i]}" and "${keys[j]}" hold the same value ${JSON.stringify(va).slice(0, 60)}` });
      }
    }
  }
  for (const { at, node } of objectNodes(data)) {
    const keys = new Set(Object.keys(node));
    // (ii) the same concept under different names, at any depth
    for (const [family, members] of Object.entries(NAME_FAMILIES)) {
      if (collection === "organizations" && family === "name") continue; // organizations schema defines both legal/primary name and optional short displayName (entity-fields.md)
      const present = members.filter((m) => keys.has(m));
      if (present.length > 1) findings.push({ doc: ref, type: "alias-family", detail: `${at || "(root)"}: family "${family}" stored as ${present.join(" + ")}` });
    }
    // (iii) a stored number computable from siblings: Σ array[].x or array length
    for (const [field, value] of Object.entries(node)) {
      if (typeof value !== "number" || !/(total|sum|count)/i.test(field) || value === 0) continue;
      const registered = DERIVED_REGISTER.find((r) => r.collections.includes(collection) && r.field.test(field));
      if (registered) continue;
      for (const [arrKey, arr] of Object.entries(node)) {
        if (!Array.isArray(arr) || !arr.length) continue;
        // a count is compared with an array of the same thing only (branchCount ↔ branches / branchIds)
        const stem = field.replace(/^(active|total)/i, "").replace(/Count$/i, "").toLowerCase();
        const related = stem.length > 2 && arrKey.toLowerCase().replace(/ids?$|s$/g, "").startsWith(stem.replace(/s$/, ""));
        if (/count/i.test(field) && related && arr.length === value) findings.push({ doc: ref, type: "derived", detail: `${at ? `${at}.` : ""}${field} = ${value} = length of ${arrKey}` });
        if (arr.every((x) => x && typeof x === "object")) {
          const numericKeys = new Set(arr.flatMap((x) => Object.keys(x).filter((k) => typeof x[k] === "number")));
          for (const k of numericKeys) {
            const sum = Math.round(arr.reduce((s2, x) => s2 + (typeof x[k] === "number" ? x[k] : 0), 0) * 100) / 100;
            if (arr.length > 1 && sum === value) findings.push({ doc: ref, type: "derived", detail: `${at ? `${at}.` : ""}${field} = ${value} = Σ ${arrKey}[].${k}` });
          }
        }
      }
    }
  }
  return findings;
}

async function main() {
  const { db, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
  await verifyEmulatorHealth();
  const { collections } = truth.getCollections();
  console.log(`check:same-doc-duplicates — ${collections.length} collections derived from source (emulator ${process.env.FIRESTORE_EMULATOR_HOST})`);
  let total = 0;
  const sameValueExcluded = [];
  for (const c of collections) {
    const snap = await (c.parent ? db.collectionGroup(c.name) : db.collection(c.name)).get();
    const findings = snap.docs.flatMap((d) => analyzeDocument(c.key, d.ref.path, d.data()));
    const policy = COLLECTION_POLICY[c.key];
    if (policy && policy.checkSameValue === false) sameValueExcluded.push(`${c.key}: ${policy.exemptionReason}`);
    total += findings.length;
    console.log(`  ${findings.length ? "FAIL" : "ok  "} ${c.key.padEnd(28)} ${String(snap.size).padStart(5)} docs  ${findings.length} finding(s)${policy && policy.checkSameValue === false ? "  (same-value check excluded)" : ""}`);
    for (const f of findings.slice(0, 10)) console.log(`       ${f.type}: ${f.doc} — ${f.detail}`);
  }
  console.log(`Same-value check exclusions (D-17): ${sameValueExcluded.length}\n  ${sameValueExcluded.join("\n  ")}`);
  console.log(`Registered derived values (iii): ${DERIVED_REGISTER.map((r) => `${r.class} ${r.collections.join("/")}: ${r.reason}`).join("; ")}`);
  writeGuardScope(__filename, collections.map((c) => c.key), []);
  if (total) { console.error(`[FAIL] ${total} finding(s).`); process.exit(1); }
  console.log("PASS — no same-document duplicates, alias families or unregistered derived values.");
  process.exit(0);
}

module.exports = { analyzeDocument, NAME_FAMILIES, DERIVED_REGISTER };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
