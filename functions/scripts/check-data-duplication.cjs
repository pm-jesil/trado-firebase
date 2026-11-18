/**
 * @guard-scope: per-collection (every collection derived from source; docs/generated/guard-scopes/check-data-duplication.json)
 * Dynamic data checks on the emulator (Parts 2.3, 2.4, 7.3, 7.6). Read-only.
 *
 *  1. Reference integrity   every *Id / *Ids field resolves to an existing document of the right
 *                           collection in the SAME organization (line ids resolve to a line)
 *  2. Value duplication     no field holds a copy of a descriptive attribute of a document it
 *                           references (name, phone, SKU, …) unless registered in
 *                           duplication-allowlist.json
 *  3. Aggregate reconcile   every R3 cache equals its source, computed independently here
 *                           (ids "reconcile:*" are the reconcileTest names in the register)
 *  4. Date discipline       instants are UTC ISO-8601 "…Z", calendar dates YYYY-MM-DD,
 *                           TTL fields native Timestamps; one format per field
 *
 * Usage: node scripts/check-data-duplication.cjs [--org <organizationId>] [--report]
 * Exit 1 on any finding. Run after seed, after each simulation and after the flagship suite.
 */
const { enforceLocalEmulatorSafety } = require("./helpers/emulator-helper.cjs");
const { db } = require("./helpers/auth-personas.cjs");
const allowlist = require("./duplication-allowlist.json");

const args = process.argv.slice(2);
const ONLY_ORG = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
const REPORT = args.includes("--report");
const EPS = 0.011;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const truth = require("../../scripts/lib/source-truth.js");
const { writeGuardScope } = require("../../scripts/lib/guard-scope.js");
const COLLECTIONS = truth.getCollections().collections; // derived from source, empty collections included

const store = new Map(); // collection name -> Map(id -> data); subcollection ids are "<parentId>/<id>"
async function loadAll() {
  for (const c of COLLECTIONS) {
    const snap = await (c.parent ? db.collectionGroup(c.name) : db.collection(c.name)).get();
    store.set(c.name, new Map(snap.docs.map((d) => [c.parent ? d.ref.parent.parent.id + "/" + d.id : d.id, d.data()])));
  }
}
const col = (name) => store.get(name) || new Map();
const inScope = (doc) => !ONLY_ORG || doc.organizationId === ONLY_ORG || doc.organizationId === undefined;

// ---------------------------------------------------------------------------
// 1. Reference integrity
// ---------------------------------------------------------------------------

const ID_FIELD_COLLECTION = {
  organizationId: "organizations", productId: "products", customerId: "customers", vendorId: "vendors",
  categoryId: "categories", roleId: "roles", departmentId: "departments", teamId: "teams", planId: "subscriptionPlans",
  billId: "bills", outflowId: "outflows", deliveryId: "deliveries", returnId: "returns", paymentId: "payments",
  membershipId: "memberships", userId: "users", jobRoleIds: "jobRoles", reportingToIds: "memberships",
  headMembershipIds: "memberships", leaderMembershipId: "memberships", riderMembershipId: "memberships",
  salespersonMembershipId: "memberships", createdByMembershipId: "memberships", payeeMembershipId: "memberships",
  assignedToMembershipId: "memberships", actorMembershipId: "memberships", ownerMembershipId: "memberships",
};
const BRANCH_FIELDS = new Set(["branchId", "defaultBranchId", "primaryBranchId", "ownerBranchId", "sharedForBranchIds"]);
// Not references to a collection (documented): free grouping keys and external identifiers
const NOT_REFERENCES = new Set(["variantGroupId", "hallmarkId", "requestId", "deviceId", "externalReference", "idempotencyKey", "sourceLineId", "lineId", "referenceLineId", "entityId", "relatedEntityId", "referenceId", "partyId", "expenseCategoryId", "recordId", "taxRegimeCode"]);
// Collections whose documents are platform-level or keyed by composite ids (organizationId only)
const POLYMORPHIC = {
  referenceId: (d) => ({ bill: "bills", outflow: "outflows", return: "returns", manual_adjustment: "products" })[d.referenceModel],
  partyId: (d) => ({ customer: "customers", vendor: "vendors", employee: "memberships" })[d.partyType] || (d.returnType === "purchase_return" ? "vendors" : d.returnType ? "customers" : null),
  relatedEntityId: (d) => ({ bill: "bills", outflow: "outflows", delivery: "deliveries", customer: "customers", vendor: "vendors", product: "products", payment: "payments", task: "tasks", return: "returns" })[d.relatedEntityType],
  entityId: (d) => ({ bill: "bills", outflow: "outflows", delivery: "deliveries", customer: "customers", vendor: "vendors", product: "products", payment: "payments", task: "tasks", return: "returns", organization: "organizations", membership: "memberships", employee: "memberships", team: "teams", role: "roles", branch: "branches", category: "categories", unit: "units", department: "departments", job_role: "jobRoles" })[d.entityType],
};
const SKIP_COLLECTIONS = new Set(["idempotencyRecords", "documentCounters", "usageCounterShards", "platformUsageSnapshots", "usageRateCards", "usageAllocationRuns", "auditLogs", "organizationUsageDaily", "userUsageDaily", "platformCostReconciliation"]);

function lookup(collection, id, orgId) {
  if (collection === "branches") return col("branches").get(`${orgId}/${id}`);
  return col(collection).get(id);
}

const findings = { reference: [], duplication: [], reconcile: [], dates: [] };
const stats = { docs: 0, references: 0, duplicationChecks: 0, reconcileChecks: 0, dateValues: 0 };

function checkReferences(collection, id, doc) {
  const orgId = collection === "organizations" ? id : doc.organizationId;
  const visit = (obj, at) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === "") continue;
      const where = `${collection}/${id}${at}.${k}`;
      let target = null;
      if (BRANCH_FIELDS.has(k)) target = "branches";
      else if (POLYMORPHIC[k]) target = POLYMORPHIC[k](obj);
      else if (ID_FIELD_COLLECTION[k]) target = ID_FIELD_COLLECTION[k];
      if (target && (typeof v === "string" || Array.isArray(v))) {
        for (const ref of Array.isArray(v) ? v : [v]) {
          if (typeof ref !== "string") continue;
          if (k === "organizationId" && ref === "platform") continue;
          stats.references++;
          const hit = lookup(target, ref, orgId);
          if (!hit) {
            // Audit logs legitimately retain entity IDs of entities that have been deleted (e.g. TASK_DELETED)
            if (collection === "auditLogs" && k === "entityId") {
              continue;
            }
            findings.reference.push(`${where} → ${target}/${ref} does not exist`);
            continue;
          }
          if (orgId && hit.organizationId && hit.organizationId !== orgId && target !== "organizations") {
            findings.reference.push(`${where} → ${target}/${ref} belongs to organization ${hit.organizationId}`);
          }
          // Line references resolve to a line on the referenced document
          const lineId = obj.sourceLineId || (k === "referenceId" ? obj.referenceLineId : undefined);
          if (lineId && (target === "bills" || target === "outflows")) {
            const lines = hit.items || hit.lines || [];
            if (!lines.some((l) => l.lineId === lineId)) findings.reference.push(`${where} line ${lineId} not on ${target}/${ref}`);
          }
        }
      }
      if (Array.isArray(v)) v.forEach((item, i) => typeof item === "object" && visit(item, `${at}.${k}[${i}]`));
      else if (typeof v === "object" && !(v.toDate)) visit(v, `${at}.${k}`);
    }
  };
  visit(doc, "");
}

// ---------------------------------------------------------------------------
// 2. Value duplication
// ---------------------------------------------------------------------------

const DESCRIPTIVE = ["name", "displayName", "mobile", "phone", "email", "address", "billingAddress", "shippingAddress", "sku", "barcode", "taxId", "code", "customerCode", "vendorCode", "baseUnit", "billNumber", "outflowNumber", "invoiceNumber", "contactPerson", "brand", "lowStockThreshold", "reorderPoint"];
const norm = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : typeof v === "number" ? String(v) : null);
const registered = (collection, fieldPath) => allowlist.entries.some((e) => e.collection === collection &&
  (fieldPath === e.field || fieldPath.startsWith(`${e.field}.`) || fieldPath.replace(/\[\d+\]/g, "") === e.field || fieldPath.replace(/\[\d+\]/g, "").startsWith(`${e.field}.`)));

function checkDuplication(collection, id, doc) {
  const orgId = collection === "organizations" ? id : doc.organizationId;
  const visit = (obj, at, owner) => {
    // the references held by this object
    const refs = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string" || NOT_REFERENCES.has(k) && !POLYMORPHIC[k]) continue;
      const target = BRANCH_FIELDS.has(k) && k !== "sharedForBranchIds" ? "branches"
        : POLYMORPHIC[k] ? POLYMORPHIC[k](obj) : ID_FIELD_COLLECTION[k];
      if (!target || target === "organizations" || k === "organizationId") continue;
      const hit = lookup(target, v, orgId);
      if (hit) refs.push({ k, target, hit, id: v });
      if (target === "memberships" && hit && col("users").get(hit.userId)) refs.push({ k: `${k}→user`, target: "users", hit: col("users").get(hit.userId) });
    }
    // the owning document's descriptive values may not be repeated anywhere inside it
    const scan = (o, p) => {
      for (const [k, v] of Object.entries(o)) {
        const fieldPath = `${p}${p ? "." : ""}${k}`;
        if (v && typeof v === "object" && !Array.isArray(v) && !v.toDate) { scan(v, fieldPath); continue; }
        const nv = norm(v);
        if (!nv || nv.length < 3 || /^\d{1,4}$/.test(nv)) continue;
        for (const r of refs) {
          for (const attr of DESCRIPTIVE) {
            if (attr === k && r.target === collection) continue;
            const av = norm(r.hit[attr]);
            if (!av || av !== nv) continue;
            stats.duplicationChecks++;
            if (registered(collection, `${at}${at ? "." : ""}${fieldPath}`)) continue;
            findings.duplication.push(`${collection}/${id}${at ? `.${at}` : ""}.${fieldPath} = "${String(v).slice(0, 40)}" copies ${r.target}/${r.id || "?"}.${attr} (via ${r.k})`);
          }
        }
      }
    };
    scan(obj, "");
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) v.forEach((item, i) => item && typeof item === "object" && visit(item, `${at}${at ? "." : ""}${k}[${i}]`, owner));
    }
  };
  visit(doc, "", doc);
}

// ---------------------------------------------------------------------------
// 3. Aggregate reconcile (independent recomputation)
// ---------------------------------------------------------------------------

function reconcile() {
  const fail = (check, msg) => findings.reconcile.push(`${check}: ${msg}`);
  const orgs = Array.from(col("organizations").entries()).filter(([oid]) => !ONLY_ORG || oid === ONLY_ORG);
  const byOrg = (name) => Array.from(col(name).entries()).filter(([, d]) => !ONLY_ORG || d.organizationId === ONLY_ORG);
  const products = new Map(byOrg("products"));

  // reconcile:stockBalances — SUM(movements) per (org, branch, product)
  const mvSum = new Map();
  const movements = byOrg("stockMovements").map(([mid, m]) => ({ mid, ...m }));
  for (const m of movements) {
    const key = `${m.organizationId}_${m.branchId || "main-branch"}_${m.productId}`;
    mvSum.set(key, (mvSum.get(key) || 0) + (m.quantity || 0));
  }
  const balances = byOrg("stockBalances");
  for (const [bid, b] of balances) {
    stats.reconcileChecks++;
    const p = products.get(b.productId);
    if (p && p.trackStock === false) continue;
    const sum = mvSum.get(bid) || 0;
    if (Math.abs(sum - (b.currentStock || 0)) > 1e-6) fail("reconcile:stockBalances", `stockBalances/${bid} currentStock ${b.currentStock} ≠ SUM(movements) ${sum}`);
  }
  for (const [key, sum] of mvSum) {
    if (!col("stockBalances").get(key) && Math.abs(sum) > 1e-6) fail("reconcile:stockBalances", `movements for ${key} sum ${sum} but no stockBalances doc`);
  }
  // reconcile:productStock — product.currentStock = SUM(branch balances)
  const balByProduct = new Map();
  for (const [, b] of balances) balByProduct.set(b.productId, (balByProduct.get(b.productId) || 0) + (b.currentStock || 0));
  for (const [pid, p] of products) {
    if (p.trackStock === false) continue;
    stats.reconcileChecks++;
    const sum = balByProduct.get(pid) || 0;
    if (Math.abs(sum - (p.currentStock || 0)) > 1e-6) fail("reconcile:productStock", `products/${pid} currentStock ${p.currentStock} ≠ SUM(stockBalances) ${sum}`);
  }
  // reconcile:productWac — replay inward purchase movements in order
  const mvByProduct = new Map();
  for (const m of movements) {
    if (!mvByProduct.has(m.productId)) mvByProduct.set(m.productId, []);
    mvByProduct.get(m.productId).push(m);
  }
  for (const [pid, list] of mvByProduct) {
    const p = products.get(pid);
    if (!p || p.trackStock === false || !list.some((m) => m.type === "purchase_in")) continue;
    stats.reconcileChecks++;
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.mid.localeCompare(b.mid));
    let stock = 0;
    let wac = null;
    for (const m of list) {
      if ((m.type === "purchase_in" || m.type === "adjustment_in") && m.quantity > 0) {
        const cost = m.unitCostSnapshot !== undefined ? m.unitCostSnapshot : p.costPrice;
        wac = wac === null || stock <= 0 ? cost : (stock * wac + m.quantity * cost) / (stock + m.quantity);
      }
      stock += m.quantity || 0;
    }
    if (wac !== null && Math.abs(wac - (p.weightedAverageCost ?? wac)) > 0.01) fail("reconcile:productWac", `products/${pid} WAC ${p.weightedAverageCost} ≠ replayed ${Math.round(wac * 10000) / 10000}`);
  }
  // reconcile:serialStock — serial-tracked stock equals the units in hand (in_stock + returned + reserved)
  const inHand = new Map();
  for (const [, s] of byOrg("serials")) {
    if (!["in_stock", "returned", "reserved"].includes(s.status)) continue;
    const key = `${s.organizationId}_${s.branchId}_${s.productId}`;
    inHand.set(key, (inHand.get(key) || 0) + 1);
  }
  for (const [bid, b] of balances) {
    const p = products.get(b.productId);
    if (!p || !p.trackSerial || p.trackStock === false) continue;
    stats.reconcileChecks++;
    if ((inHand.get(bid) || 0) !== (b.currentStock || 0)) fail("reconcile:serialStock", `stockBalances/${bid} currentStock ${b.currentStock} ≠ serials in hand ${inHand.get(bid) || 0}`);
  }
  // reconcile:allocatedStock — open sales orders hold reservations
  const reserved = new Map();
  for (const [, b] of byOrg("bills")) {
    if (!b.stockReserved || b.status !== "draft") continue;
    for (const i of b.items || []) {
      if (i.trackStock === false) continue;
      const key = `${b.organizationId}_${b.branchId || "main-branch"}_${i.productId}`;
      reserved.set(key, (reserved.get(key) || 0) + (i.baseQuantity ?? i.quantity));
    }
  }
  for (const [bid, b] of balances) {
    stats.reconcileChecks++;
    if (Math.abs((reserved.get(bid) || 0) - (b.allocatedStock || 0)) > 1e-6) fail("reconcile:allocatedStock", `stockBalances/${bid} allocatedStock ${b.allocatedStock || 0} ≠ open orders ${reserved.get(bid) || 0}`);
  }
  // reconcile:documentPayments — paid = SUM(completed payments), balance = total − paid, status derived
  const paidByDoc = new Map();
  for (const [, p] of byOrg("payments")) {
    if (p.status !== "completed") continue;
    if (p.referenceId) {
      paidByDoc.set(p.referenceId, (paidByDoc.get(p.referenceId) || 0) + (p.amount || 0));
    }
    if (Array.isArray(p.allocations)) {
      for (const a of p.allocations) {
        if (a.documentId) {
          paidByDoc.set(a.documentId, (paidByDoc.get(a.documentId) || 0) + (a.amount || 0));
        }
      }
    }
  }
  const statusFor = (total, paid) => (paid >= total && total > 0 ? "paid" : paid > 0 ? "partial" : total === 0 ? "paid" : "pending");
  for (const [name, open] of [["bills", "active"], ["outflows", "confirmed"]]) {
    for (const [did, d] of byOrg(name)) {
      if (d.status !== open) continue;
      stats.reconcileChecks++;
      const paid = paidByDoc.get(did) || 0;
      if (Math.abs(paid - (d.paidAmount || 0)) > EPS) fail("reconcile:documentPayments", `${name}/${did} paidAmount ${d.paidAmount} ≠ SUM(payments) ${paid}`);
      if (Math.abs((d.totalAmount - (d.paidAmount || 0)) - (d.balanceAmount || 0)) > EPS) fail("reconcile:documentPayments", `${name}/${did} balanceAmount ${d.balanceAmount} ≠ total − paid`);
      if (d.paymentStatus !== statusFor(d.totalAmount, d.paidAmount || 0)) fail("reconcile:documentPayments", `${name}/${did} paymentStatus ${d.paymentStatus} ≠ ${statusFor(d.totalAmount, d.paidAmount || 0)}`);
    }
  }
  // reconcile:partyBalances — open documents minus payments and credit notes
  const customerCalc = new Map();
  const vendorCalc = new Map();
  const bump = (m, id, f, v) => {
    if (!id) return;
    const r = m.get(id) || { balance: 0, volume: 0 };
    r[f] += v;
    m.set(id, r);
  };
  for (const [, b] of byOrg("bills")) if (b.status === "active" && b.customerId) { bump(customerCalc, b.customerId, "balance", b.totalAmount || 0); bump(customerCalc, b.customerId, "volume", b.totalAmount || 0); }
  for (const [, o] of byOrg("outflows")) if (o.status === "confirmed" && o.kind === "purchase" && o.vendorId) { bump(vendorCalc, o.vendorId, "balance", o.totalAmount || 0); bump(vendorCalc, o.vendorId, "volume", o.totalAmount || 0); }
  for (const [, p] of byOrg("payments")) {
    if (p.status !== "completed" || !p.partyId) continue;
    if (p.partyType === "customer" && p.direction === "in") bump(customerCalc, p.partyId, "balance", -(p.amount || 0));
    if (p.partyType === "vendor" && p.direction === "out") bump(vendorCalc, p.partyId, "balance", -(p.amount || 0));
  }
  for (const [, r] of byOrg("returns")) {
    if (r.status !== "completed" || r.refundMethod !== "credit_note" || !r.partyId) continue;
    bump(r.returnType === "purchase_return" ? vendorCalc : customerCalc, r.partyId, "balance", -(r.totalRefundAmount || 0));
  }
  for (const [name, calc, balField, volField] of [["customers", customerCalc, "outstandingBalance", "totalSpend"], ["vendors", vendorCalc, "outstandingPayable", "totalPurchase"]]) {
    for (const [pid, p] of byOrg(name)) {
      stats.reconcileChecks++;
      const c = calc.get(pid) || { balance: 0, volume: 0 };
      const expected = Math.max(0, Math.round(c.balance * 100) / 100);
      if (Math.abs(expected - (p[balField] || 0)) > EPS) fail("reconcile:partyBalances", `${name}/${pid} ${balField} ${p[balField] || 0} ≠ computed ${expected}`);
      if (Math.abs(c.volume - (p[volField] || 0)) > EPS) fail("reconcile:partyBalances", `${name}/${pid} ${volField} ${p[volField] || 0} ≠ computed ${Math.round(c.volume * 100) / 100}`);
    }
  }
  // reconcile:returnedQty — SUM(return items per source line)
  const returnedByLine = new Map();
  for (const [, r] of byOrg("returns")) {
    if (r.status !== "completed") continue;
    for (const i of r.items || []) {
      const key = `${r.referenceId}#${i.sourceLineId}`;
      returnedByLine.set(key, (returnedByLine.get(key) || 0) + (i.quantity || 0));
    }
  }
  for (const [name, field] of [["bills", "items"], ["outflows", "lines"]]) {
    for (const [did, d] of byOrg(name)) {
      for (const l of d[field] || []) {
        stats.reconcileChecks++;
        const expected = returnedByLine.get(`${did}#${l.lineId}`) || 0;
        if (Math.abs(expected - (l.returnedQty || 0)) > 1e-6) fail("reconcile:returnedQty", `${name}/${did} line ${l.lineId} returnedQty ${l.returnedQty || 0} ≠ SUM(returns) ${expected}`);
      }
    }
  }
  // reconcile:outflowProductIds — equals the lines' productIds
  for (const [oid, o] of byOrg("outflows")) {
    stats.reconcileChecks++;
    const expected = Array.from(new Set((o.lines || []).map((l) => l.productId).filter(Boolean))).sort().join(",");
    const actual = Array.from(new Set(o.productIds || [])).sort().join(",");
    if (expected !== actual) fail("reconcile:outflowProductIds", `outflows/${oid} productIds [${actual}] ≠ lines [${expected}]`);
  }
  // reconcile:auditChangedFields — equals changes[].field or changes.fields[].path
  for (const [lid, l] of byOrg("auditLogs")) {
    if (!l.changes) continue;
    stats.reconcileChecks++;
    const changeFields = Array.isArray(l.changes)
      ? l.changes.map((c) => c.field || c.path)
      : (l.changes.fields || []).map((f) => f.path.split(".")[0]).filter((p, i, a) => p !== "(document)" && a.indexOf(p) === i);
    if ((l.changedFields || []).join(",") !== changeFields.join(",")) fail("reconcile:auditChangedFields", `auditLogs/${lid} changedFields mismatch`);
  }
  // reconcile:branchCount / reconcile:activeEmployeeCount
  const activeBranches = new Map();
  for (const [key, b] of col("branches")) if (b.isActive !== false) activeBranches.set(key.split("/")[0], (activeBranches.get(key.split("/")[0]) || 0) + 1);
  const activeMembers = new Map();
  for (const [, m] of col("memberships")) if (m.status === "active" && m.roleId !== "role_org_owner") activeMembers.set(m.organizationId, (activeMembers.get(m.organizationId) || 0) + 1);
  for (const [oid, o] of orgs) {
    if (typeof o.branchCount === "number") {
      stats.reconcileChecks++;
      if (o.branchCount !== (activeBranches.get(oid) || 0)) fail("reconcile:branchCount", `organizations/${oid} branchCount ${o.branchCount} ≠ active branches ${activeBranches.get(oid) || 0}`);
    }
    if (typeof o.activeEmployeeCount === "number") {
      stats.reconcileChecks++;
      if (o.activeEmployeeCount !== (activeMembers.get(oid) || 0)) fail("reconcile:activeEmployeeCount", `organizations/${oid} activeEmployeeCount ${o.activeEmployeeCount} ≠ active non-owner memberships ${activeMembers.get(oid) || 0}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Date discipline
// ---------------------------------------------------------------------------

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH = /^\d{4}-\d{2}$/;
const TTL_FIELDS = new Set(["locationPings.expiresAt", "auditLogs.expireAt", "auditLogs.occurredAt", "organizationUsageDaily.expireAt", "organizationUsageDaily.lastSeenAt", "userUsageDaily.expireAt", "userUsageDaily.lastSeenAt"]);
const CALENDAR_FIELDS = new Set(["date", "dueDate", "expiryDate", "expiresOn", "day", "startDate", "endDate", "startOn", "nextRunOn", "endOn", "occurredLocalDate", "settlementDate"]);
const dateTable = new Map(); // "collection.field" -> { class, values, bad }

function classify(collection, field) {
  const leaf = field.split(".").pop().replace(/\[\d+\]/g, "");
  if (collection === "requests" && (leaf === "billingPeriod" || leaf === "period")) return null;
  if (TTL_FIELDS.has(`${collection}.${leaf}`)) return "ttl";
  if (["timestamp", "docDate", "recordedAt"].includes(leaf)) return "instant";
  if (CALENDAR_FIELDS.has(leaf) || /Date$/.test(leaf)) return "calendar";
  if (/(At|On)$/.test(leaf)) return "instant";
  if (["yearMonth", "billingPeriod", "month", "period", "lastGeneratedPeriod"].includes(leaf)) return "yearMonth";
  return null;
}

function checkDates(collection, id, doc) {
  const visit = (obj, p) => {
    for (const [k, v] of Object.entries(obj)) {
      const field = `${p}${p ? "." : ""}${k}`;
      if (v === null || v === undefined) continue; // absent is allowed; only present values are checked
      if (collection === "auditLogs" && /^changes./.test(field)) continue; // from/to carry the changed field's own value
      if (v && typeof v === "object" && !Array.isArray(v) && !v.toDate) { visit(v, field); continue; }
      if (Array.isArray(v)) { v.forEach((x) => x && typeof x === "object" && visit(x, field)); continue; }
      const cls = classify(collection, field);
      const looksLikeDate = typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?/.test(v);
      if (!cls && !looksLikeDate && !(v && v.toDate)) continue;
      const key = `${collection}.${field.replace(/\.\d+\./g, ".")}`;
      const row = dateTable.get(key) || { cls: cls || "unclassified", values: 0, bad: 0, sample: null };
      row.values++;
      stats.dateValues++;
      let ok = true;
      if (cls === "ttl") ok = !!(v && v.toDate);
      else if (cls === "instant") ok = typeof v === "string" && INSTANT.test(v);
      else if (cls === "calendar") ok = typeof v === "string" && (CAL_DATE.test(v) || INSTANT.test(v) && false);
      else if (cls === "yearMonth") ok = typeof v === "string" && YEAR_MONTH.test(v);
      else ok = false; // a date-looking value in an unclassified field
      if (!ok) {
        row.bad++;
        row.sample = row.sample || `${collection}/${id} ${field}=${v && v.toDate ? "Timestamp" : JSON.stringify(v)}`;
      }
      dateTable.set(key, row);
    }
  };
  visit(doc, "");
}

// ---------------------------------------------------------------------------

async function main() {
  enforceLocalEmulatorSafety();
  await loadAll();
  for (const [collection, docs] of store) {
    for (const [id, doc] of docs) {
      if (!inScope(doc)) continue;
      stats.docs++;
      checkDates(collection, id, doc);
      if (SKIP_COLLECTIONS.has(collection)) continue;
      checkReferences(collection, id, doc);
      checkDuplication(collection, id, doc);
    }
  }
  reconcile();
  for (const [key, row] of dateTable) if (row.bad) findings.dates.push(`${key} (${row.cls}): ${row.bad}/${row.values} bad, e.g. ${row.sample}`);

  const total = Object.values(findings).reduce((n, f) => n + f.length, 0);
  console.log(`Data checks${ONLY_ORG ? ` (organization ${ONLY_ORG})` : ""}: ${stats.docs} documents, ${stats.references} references, ${stats.duplicationChecks} value matches examined, ${stats.reconcileChecks} cache reconciliations, ${stats.dateValues} date values in ${dateTable.size} fields.`);
  for (const [kind, list] of Object.entries(findings)) {
    console.log(`  ${kind}: ${list.length} finding(s)`);
    for (const f of list.slice(0, REPORT ? 1000 : 15)) console.log(`    ✗ ${f}`);
    if (!REPORT && list.length > 15) console.log(`    … ${list.length - 15} more (--report for all)`);
  }
  if (REPORT) {
    console.log("\n| Field | Class | Values | Bad |\n|---|---|---|---|");
    for (const [key, row] of Array.from(dateTable.entries()).sort()) console.log(`| ${key} | ${row.cls} | ${row.values} | ${row.bad} |`);
  }
  writeGuardScope(__filename, COLLECTIONS.map((c) => c.key), []);
  console.log(total ? `✗ ${total} data finding(s).` : "[PASS] Zero dangling/cross-tenant references, zero unregistered value copies, every cache reconciles, dates consistent.");
  process.exit(total ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
