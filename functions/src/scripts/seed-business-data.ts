/**
 * Seed organizations built from one declarative spec each (Part 8.6).
 *
 * - Structure (organization, branches, users, memberships, branch assignments) and master data
 *   (categories, units, products, customers, vendors) are written as typed model documents with
 *   deterministic ids, created only when absent, so a second run never resets live balances.
 * - Stock and transactions go ONLY through the real callables (stockAdjust, outflowsCreate,
 *   billsCreate, …) run in-process with idempotency keys: every invariant (stock ledger,
 *   balances, party ledgers, document numbers) holds and a second run adds zero documents.
 * - Counters (branchCount, activeEmployeeCount) are derived from the spec, never typed twice.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type {
  BranchDoc, CategoryDoc, CustomerDoc, MembershipBranchDoc, MembershipDoc, OrganizationDoc, ProductDoc, UnitDoc, UserDoc, VendorDoc,
} from "../types/models.js";
import { BusinessCategory, BusinessType, EntityStatus, UnitGroup } from "../constants/enums.js";
import { buildSubscriptionFields } from "../services/subscription.js";
import { nameKey, uniqueKeyId, phoneKey, taxIdKey } from "../services/naturalKeys.js";

export interface SeedPersona {
  key: string;
  email: string;
  name: string;
  roleId: string;
  label: string;
  branchIds?: string[]; // default: the default branch
  reportsTo?: string; // persona key
  description: string;
}

export interface SeedOrgSpec {
  organizationId: string;
  name: string;
  businessType: BusinessType;
  businessCategory: BusinessCategory;
  planId: string;
  branches: Array<{ branchId: string; name: string; code: string }>;
  owner: { email: string; name: string };
  personas: SeedPersona[];
  categories?: Array<{ id: string; name: string }>;
  units?: Array<{ id: string; name: string; code: string; group?: UnitGroup }>;
  products?: Array<Partial<ProductDoc> & { id: string; name: string; sellingPrice: number; costPrice: number }>;
  customers?: Array<Partial<CustomerDoc> & { id: string; name: string; code: string }>;
  vendors?: Array<Partial<VendorDoc> & { id: string; name: string; code: string }>;
  openingStock?: Array<{ productId: string; branchId: string; quantity: number }>;
  /** Business transactions through the callables: [persona key, callable name, payload]. */
  transactions?: Array<{ as: string; fn: string; step: string; data: Record<string, unknown> }>;
}

type Callable = { run: (req: unknown) => Promise<unknown> };

async function ensureAuthUser(auth: Auth, email: string, displayName: string, password: string): Promise<string> {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch {
    return (await auth.createUser({ email, password, displayName })).uid;
  }
}

async function createIfAbsent(db: Firestore, collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  const ref = db.collection(collection).doc(id);
  if (!(await ref.get()).exists) await ref.set(data);
}

/** Loads the callable handlers lazily (after the emulator safety check initialized the app). */
async function loadCallables(): Promise<Record<string, Callable>> {
  const mods = await Promise.all([
    import("../callables/stock.js"), import("../callables/outflows.js"), import("../callables/bills.js"),
    import("../callables/payments.js"), import("../callables/returns.js"), import("../callables/deliveries.js"),
  ]);
  return Object.assign({}, ...mods) as Record<string, Callable>;
}

/** Provisions one organization from its spec. Returns the persona → uid map. */
export async function seedOrganizationFromSpec(db: Firestore, auth: Auth, spec: SeedOrgSpec, password: string, createdBy: string): Promise<Record<string, string>> {
  const now = new Date().toISOString();
  const orgId = spec.organizationId;
  const defaultBranchId = spec.branches[0].branchId;
  const uids: Record<string, string> = {};

  // Owner + personas (users and auth claims)
  const people = [{ key: "owner", email: spec.owner.email, name: spec.owner.name, roleId: "role_org_owner", branchIds: spec.branches.map((b) => b.branchId) }, ...spec.personas];
  for (const p of people) {
    const uid = await ensureAuthUser(auth, p.email, p.name, password);
    uids[p.key] = uid;
    await auth.setCustomUserClaims(uid, { primaryOrganizationId: orgId, primaryBranchId: defaultBranchId });
    const user: UserDoc = { name: p.name, email: p.email, accountType: p.key === "owner" ? "admin" : "standard", isActive: true, createdAt: now, createdBy };
    await db.collection("users").doc(uid).set(user);
  }

  // Organization (counters derived from the spec)
  const org: OrganizationDoc = {
    name: spec.name,
    businessType: spec.businessType,
    businessCategory: spec.businessCategory,
    country: "IN",
    currency: "INR",
    taxRegimeCode: "IN_GST",
    status: EntityStatus.ACTIVE,
    planId: spec.planId,
    moduleToggles: {},
    defaultBranchId,
    branchCount: spec.branches.length,
    activeEmployeeCount: spec.personas.length,
    ...buildSubscriptionFields({ durationDays: 365 }),
    createdAt: now,
    createdBy,
  };
  await db.collection("organizations").doc(orgId).set(org);

  for (const [i, b] of spec.branches.entries()) {
    const branch: BranchDoc = { organizationId: orgId, name: b.name, code: b.code, isDefault: i === 0, isActive: true, createdAt: now, createdBy };
    await db.collection("organizations").doc(orgId).collection("branches").doc(b.branchId).set(branch);
    await db.collection("uniqueKeys").doc(uniqueKeyId(orgId, "branch_code", b.code)).set({ organizationId: orgId, kind: "branch_code", entityType: "branch", entityId: b.branchId, createdAt: now });
  }

  // Memberships and branch assignments
  for (const p of people) {
    const membershipId = `${uids[p.key]}_${orgId}`;
    const reportsTo = "reportsTo" in p && p.reportsTo ? [`${uids[p.reportsTo]}_${orgId}`] : [];
    const branchIds = p.branchIds || [defaultBranchId];
    const membership: MembershipDoc = {
      userId: uids[p.key], organizationId: orgId, roleId: p.roleId, jobRoleIds: [], reportingToIds: reportsTo,
      permissions: {}, status: EntityStatus.ACTIVE, isPrimary: true, primaryBranchId: branchIds[0], createdAt: now, createdBy,
    };
    await db.collection("memberships").doc(membershipId).set(membership);
    for (const branchId of branchIds) {
      const mb: MembershipBranchDoc = {
        membershipId, userId: uids[p.key], organizationId: orgId, branchId, status: EntityStatus.ACTIVE,
        isDefaultForMembership: branchId === branchIds[0], permissions: {}, createdAt: now, createdBy,
      };
      await db.collection("membershipBranches").doc(`${membershipId}_${branchId}`).set(mb);
    }
  }

  await seedBusinessData(db, spec, uids);
  return uids;
}

/**
 * Master data and transactions for an organization whose structure already exists
 * (`uids` maps persona keys, incl. "owner", to user ids).
 */
export async function seedBusinessData(db: Firestore, spec: SeedOrgSpec, uids: Record<string, string>): Promise<void> {
  const now = new Date().toISOString();
  const orgId = spec.organizationId;
  const defaultBranchId = spec.branches[0].branchId;
  // Master data (created once; later runs never overwrite balances or stock) + their natural keys
  const owner = uids.owner;
  const claim = (kind: string, key: string | null, entityType: string, entityId: string) => key
    ? db.collection("uniqueKeys").doc(uniqueKeyId(orgId, kind, key)).set({ organizationId: orgId, kind, entityType, entityId, createdAt: now })
    : Promise.resolve();
  for (const c of spec.categories || []) {
    const cat: CategoryDoc = { organizationId: orgId, name: c.name, nameKey: nameKey(c.name), isActive: true, createdAt: now, createdBy: owner };
    await createIfAbsent(db, "categories", c.id, cat as unknown as Record<string, unknown>);
    await claim("category_name", cat.nameKey, "category", c.id);
  }
  for (const u of spec.units || []) {
    const unit: UnitDoc = { organizationId: orgId, name: u.name, code: u.code, group: u.group || UnitGroup.COUNT, precision: 0, isActive: true, createdAt: now, createdBy: owner };
    await createIfAbsent(db, "units", u.id, unit as unknown as Record<string, unknown>);
    await claim("unit_name", nameKey(u.name), "unit", u.id);
  }
  for (const { id, ...p } of spec.products || []) {
    const product: ProductDoc = {
      organizationId: orgId, baseUnit: "piece", taxInclusive: false, taxRatePercent: 0, hasExpiry: false, trackStock: true,
      lowStockThreshold: 5, isActive: true, currentStock: 0, ...p, createdAt: now, createdBy: owner,
    } as ProductDoc;
    await createIfAbsent(db, "products", id, product as unknown as Record<string, unknown>);
    if (p.barcode) await db.collection("uniqueKeys").doc(uniqueKeyId(orgId, "barcode", p.barcode.toLowerCase())).set({ organizationId: orgId, kind: "barcode", entityType: "product", entityId: id, createdAt: now });
  }
  for (const { id, code, ...c } of spec.customers || []) {
    const customer: CustomerDoc = {
      organizationId: orgId, customerCode: code, creditLimit: 0, creditPeriodDays: 0, outstandingBalance: 0, totalSpend: 0,
      visibilityScope: "all_branches", isDefault: false, isActive: true, ...c, createdAt: now, createdBy: owner,
    } as CustomerDoc;
    await createIfAbsent(db, "customers", id, customer as unknown as Record<string, unknown>);
    await claim("customer_phone", phoneKey(customer.mobile), "customer", id);
    await claim("customer_tax", taxIdKey(customer.taxNumber), "customer", id);
  }
  for (const { id, code, ...v } of spec.vendors || []) {
    const vendor: VendorDoc = {
      organizationId: orgId, vendorCode: code, outstandingPayable: 0, totalPurchase: 0, visibilityScope: "all_branches",
      isDefault: false, isActive: true, ...v, createdAt: now, createdBy: owner,
    } as VendorDoc;
    await createIfAbsent(db, "vendors", id, vendor as unknown as Record<string, unknown>);
    await claim("vendor_phone", phoneKey(vendor.mobile), "vendor", id);
    await claim("vendor_tax", taxIdKey(vendor.taxNumber), "vendor", id);
  }

  // Stock and transactions only through the real engines (idempotent)
  const callables = await loadCallables();
  const as = (key: string, branchId = defaultBranchId) => ({
    uid: uids[key],
    token: { primaryOrganizationId: orgId, primaryBranchId: branchId },
  });
  for (const s of spec.openingStock || []) {
    await callables.stockAdjust.run({
      auth: as("owner", s.branchId),
      data: { branchId: s.branchId, productId: s.productId, quantity: s.quantity, reason: "Opening stock (seed)", reasonCode: "opening_stock", idempotencyKey: `seed-${orgId}-open-${s.productId}-${s.branchId}` },
    });
  }
  for (const t of spec.transactions || []) {
    const fn = callables[t.fn];
    if (!fn) throw new Error(`Seed transaction uses unknown callable ${t.fn}`);
    await fn.run({ auth: as(t.as), data: { ...t.data, idempotencyKey: `seed-${orgId}-${t.step}` } });
  }
}

export function personaCredentials(spec: SeedOrgSpec, password: string) {
  const all = [{ key: "owner", email: spec.owner.email, name: spec.owner.name, label: `${spec.name} Owner`, roleId: "role_org_owner", branchIds: spec.branches.map((b) => b.branchId), description: "Organization Owner: settings, staff, approvals, all branches." }, ...spec.personas];
  return all.map((p) => ({
    persona: p.label, label: p.label, role: p.roleId, email: p.email, password,
    organizationName: spec.name, organizationId: spec.organizationId,
    branches: p.branchIds || [spec.branches[0].branchId], scope: "tenant", description: p.description,
  }));
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

const team = (domain: string): SeedPersona[] => [
  { key: "admin", email: `admin@${domain}`, name: "Admin", roleId: "role_admin", label: "Admin", description: "Administrator: day-to-day operations and approvals." },
  { key: "purchaseManager", email: `purchase.manager@${domain}`, name: "Purchase Manager", roleId: "role_store_manager", label: "Purchase Manager", description: "Approves purchases; sees the purchase staff's documents (team scope via reporting line)." },
  { key: "purchaseStaff", email: `purchase.staff@${domain}`, name: "Purchase Staff", roleId: "role_purchase_staff", label: "Purchase Staff", reportsTo: "purchaseManager", description: "Records vendor purchases and receives stock; sees own documents." },
  { key: "salesManager", email: `sales.manager@${domain}`, name: "Sales Manager", roleId: "role_store_manager", label: "Sales Manager", description: "Sales, deliveries and discounts approval for the branch." },
  { key: "cashier", email: `cashier@${domain}`, name: "Cashier", roleId: "role_cashier", label: "Cashier", reportsTo: "salesManager", description: "Counter and B2B billing, customer payments, returns." },
  { key: "rider", email: `rider@${domain}`, name: "Rider", roleId: "role_rider", label: "Delivery Rider", description: "Assigned deliveries and live location (plan includes delivery)." },
];

export const WHOLESALE_HUB_SPEC: SeedOrgSpec = {
  organizationId: "org_wholesale_sample",
  name: "Apex Wholesale Hub",
  businessType: BusinessType.WHOLESALE_ONLY,
  businessCategory: BusinessCategory.GENERAL,
  planId: "plan_growth",
  branches: [{ branchId: "main-branch", name: "Wholesale Main HQ", code: "MAIN" }, { branchId: "branch_warehouse", name: "Central Warehouse", code: "WH01" }],
  owner: { email: "owner@wholesale.trado.local", name: "Apex Wholesale Owner" },
  personas: [
    { key: "manager", email: "manager@wholesale.trado.local", name: "Wholesale Manager", roleId: "role_store_manager", label: "Wholesale Manager", branchIds: ["main-branch", "branch_warehouse"], description: "Manages both branches." },
    { key: "cashier", email: "cashier@wholesale.trado.local", name: "Wholesale Cashier", roleId: "role_cashier", label: "Wholesale Cashier", description: "Billing at the main branch." },
    { key: "rider", email: "rider@wholesale.trado.local", name: "Wholesale Rider", roleId: "role_rider", label: "Wholesale Rider", description: "Delivery rider for wholesale orders." },
  ],
  categories: [{ id: "cat_grains_sample", name: "Grains & Cereals" }],
  units: [{ id: "unit_sack_sample", name: "Sack 25kg", code: "sack" }],
  products: [{ id: "prod_rice_sack", name: "Whole Grain Basmati Rice 25kg", categoryId: "cat_grains_sample", baseUnit: "sack", barcode: "8901234567899", sellingPrice: 1200, costPrice: 950, taxRatePercent: 5 }],
  customers: [
    { id: "cust_wholesale_all", code: "CUST-000001", name: "Apex Bulk Mart", mobile: "9876500001", creditLimit: 200000 },
    { id: "cust_warehouse_only", code: "CUST-000002", name: "Metro Logistics Depot", mobile: "9876500002", visibilityScope: "branch_only", sharedForBranchIds: ["branch_warehouse"] },
  ],
  vendors: [{ id: "vend_bulk_grain", code: "VEND-000001", name: "National Grain Producers", mobile: "9123400001" }],
  openingStock: [{ productId: "prod_rice_sack", branchId: "main-branch", quantity: 100 }, { productId: "prod_rice_sack", branchId: "branch_warehouse", quantity: 250 }],
};

export const CYCLE_WORLD_SPEC: SeedOrgSpec = {
  organizationId: "org_cycle_world",
  name: "Cycle World Wholesale",
  businessType: BusinessType.WHOLESALE_RETAIL,
  businessCategory: BusinessCategory.BICYCLE,
  planId: "plan_growth",
  branches: [{ branchId: "main-branch", name: "Cycle World Main", code: "MAIN" }],
  owner: { email: "owner@cycleworld.trado.local", name: "Cycle World Owner" },
  personas: team("cycleworld.trado.local"),
  categories: [{ id: "cat_cw_bicycles", name: "Bicycles" }, { id: "cat_cw_spares", name: "Spares" }],
  products: [
    { id: "prod_cw_hero26_red", name: "Hero Sprint 26in Red", brand: "Hero", categoryId: "cat_cw_bicycles", sellingPrice: 9000, costPrice: 7000, trackSerial: true, warrantyMonths: 24, variantGroupId: "vg_cw_hero_sprint", variantAttributes: { size: "26in", colour: "red" } },
    { id: "prod_cw_hero24_blue", name: "Hero Sprint 24in Blue", brand: "Hero", categoryId: "cat_cw_bicycles", sellingPrice: 8500, costPrice: 6600, trackSerial: true, warrantyMonths: 24, variantGroupId: "vg_cw_hero_sprint", variantAttributes: { size: "24in", colour: "blue" } },
    { id: "prod_cw_tube26", name: "Tube 26x1.95", categoryId: "cat_cw_spares", sellingPrice: 150, costPrice: 90, barcode: "8907000000261" },
    { id: "prod_cw_chain", name: "Chain KMC Z410", categoryId: "cat_cw_spares", sellingPrice: 400, costPrice: 250, barcode: "8907000000410" },
  ],
  customers: [{ id: "cust_cw_city_cycle", code: "CUST-000001", name: "City Cycle Store", mobile: "9876511111", creditLimit: 100000, taxNumber: "29AACCC1111C1Z1", billingAddress: "12 MG Road, Bengaluru" }],
  vendors: [{ id: "vend_cw_ludhiana", code: "VEND-000001", name: "Ludhiana Cycles", mobile: "9876522222", taxNumber: "03AALCL2222L1Z2" }],
  transactions: [
    { as: "purchaseStaff", fn: "outflowsCreate", step: "pur-LC101", data: { kind: "purchase", vendorId: "vend_cw_ludhiana", invoiceNumber: "LC-101", paidAmount: 10000, paymentMethod: "bank_transfer", lines: [
      { productId: "prod_cw_hero26_red", quantity: 3, unit: "piece", unitPrice: 7000, serialNumbers: ["FR26-001", "FR26-002", "FR26-003"] },
      { productId: "prod_cw_tube26", quantity: 20, unit: "piece", unitPrice: 90, damagedQuantity: 2, damageReason: "punctured in transit" },
      { productId: "prod_cw_chain", quantity: 10, unit: "piece", unitPrice: 250 },
    ] } },
    { as: "cashier", fn: "billsCreate", step: "sale-city-cycle", data: { salesMode: "b2b", customerId: "cust_cw_city_cycle", items: [{ productId: "prod_cw_hero26_red", quantity: 1, serialNumbers: ["FR26-001"] }], paidAmount: 5000 } },
    { as: "cashier", fn: "billsCreate", step: "sale-counter-spares", data: { items: [{ productId: "prod_cw_tube26", quantity: 4 }, { productId: "prod_cw_chain", quantity: 1 }], paidAmount: 1000 } },
  ],
};

export const KITCHEN_MART_SPEC: SeedOrgSpec = {
  organizationId: "org_kitchen_mart",
  name: "Kitchen Mart Wholesale",
  businessType: BusinessType.WHOLESALE_RETAIL,
  businessCategory: BusinessCategory.KITCHENWARE_HOUSEHOLD,
  planId: "plan_growth",
  branches: [{ branchId: "main-branch", name: "Kitchen Mart Main", code: "MAIN" }],
  owner: { email: "owner@kitchenmart.trado.local", name: "Kitchen Mart Owner" },
  personas: team("kitchenmart.trado.local"),
  products: [
    { id: "prod_km_bucket16", name: "Bucket 16L", baseUnit: "piece", sellingPrice: 100, costPrice: 80, barcode: "8908000000016", alternateUnits: [{ unit: "box", factor: 12, sellingPrice: 1100, isPurchaseUnit: true, isSaleUnit: true }] },
    { id: "prod_km_toilet_brush", name: "Toilet Brush", sellingPrice: 60, costPrice: 35, isReturnable: false },
    { id: "prod_km_steel_plate", name: "Steel Plate", sellingPrice: 50, costPrice: 30, maxDiscountPercent: 5 },
  ],
  customers: [{ id: "cust_km_annapurna", code: "CUST-000001", name: "Hotel Annapurna", mobile: "9876533333", creditLimit: 50000 }],
  vendors: [{ id: "vend_km_mumbai_plastics", code: "VEND-000001", name: "Mumbai Plastics", mobile: "9876544444" }],
  openingStock: [{ productId: "prod_km_toilet_brush", branchId: "main-branch", quantity: 30 }, { productId: "prod_km_steel_plate", branchId: "main-branch", quantity: 100 }],
  transactions: [
    { as: "purchaseStaff", fn: "outflowsCreate", step: "pur-buckets", data: { kind: "purchase", vendorId: "vend_km_mumbai_plastics", invoiceNumber: "MP-501", lines: [{ productId: "prod_km_bucket16", quantity: 5, unit: "box", unitPrice: 900 }] } },
    { as: "cashier", fn: "billsCreate", step: "sale-mixed-units", data: { salesMode: "b2b", customerId: "cust_km_annapurna", items: [{ productId: "prod_km_bucket16", quantity: 1, unit: "box" }, { productId: "prod_km_bucket16", quantity: 5, unit: "piece" }], paidAmount: 1600 } },
  ],
};
