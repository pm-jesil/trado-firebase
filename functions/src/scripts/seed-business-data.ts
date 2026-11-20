/**
 * Seed organizations built from one declarative spec each (Part 8.6).
 *
 * - Structure (organization, branches, users, memberships, branch assignments) and master data
 *   (categories, units, storageLocations, financialAccounts, products, customers, vendors) are written as typed model documents with
 *   deterministic ids, created only when absent, so a second run never resets live balances.
 * - Stock and transactions go ONLY through the real callables (stockAdjust, outflowsCreate,
 *   billsCreate, stockTransfers, …) run in-process with idempotency keys: every invariant (stock ledger,
 *   balances, party ledgers, document numbers) holds and a second run adds zero documents.
 * - Counters (branchCount, activeEmployeeCount) are derived from the spec, never typed twice.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type {
  AddressRecord,
  BranchDoc,
  CategoryDoc,
  CustomerDoc,
  FinancialAccountDoc,
  FinancialAccountType,
  MembershipBranchDoc,
  MembershipDoc,
  OrganizationDoc,
  ProductDoc,
  StorageLocationDoc,
  StorageLocationType,
  UnitDoc,
  UserDoc,
  VendorDoc,
} from "../types/models.js";
import {
  BusinessCategory,
  BusinessType,
  EntityStatus,
  UnitGroup,
} from "../constants/enums.js";
import { buildSubscriptionFields } from "../services/subscription.js";
import { nameKey, uniqueKeyId, phoneKey, taxIdKey } from "../services/naturalKeys.js";
import { getCountryDefaults } from "../constants/countryDefaults.js";

export interface SeedPersona {
  key: string;
  email: string;
  name: string;
  roleId: string;
  label: string;
  branchIds?: string[]; // default: the default branch
  reportsTo?: string; // persona key
  description: string;
  status?: EntityStatus;
  permissionOverrides?: Record<string, boolean>;
}

export interface SeedStorageLocation {
  id: string;
  branchId?: string;
  name: string;
  code: string;
  type?: StorageLocationType;
  isDefault?: boolean;
  notes?: string;
}

export interface SeedFinancialAccount {
  id: string;
  branchId?: string | null;
  assignedBranchIds?: string[];
  name: string;
  code: string;
  type?: FinancialAccountType;
  currency?: string;
  openingBalance?: number;
  bankDetails?: {
    bankName?: string;
    accountNumberMasked?: string;
    ifscOrSwift?: string;
    bankBranchName?: string;
    upiId?: string;
  };
  isDefault?: boolean;
}

export interface SeedStockTransfer {
  sourceBranchId: string;
  destinationBranchId: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unit?: string;
    serialNumbers?: string[];
    batchNumber?: string;
  }>;
  createdAs?: string;
  approvedAs?: string;
  dispatchedAs?: string;
  receivedAs?: string;
  notes?: string;
}

export interface SeedOrgSpec {
  organizationId: string;
  name: string;
  businessType: BusinessType;
  businessCategory: BusinessCategory;
  country?: string;
  currency?: string;
  currencyDecimals?: number;
  minorUnitName?: string;
  minorUnitNamePlural?: string;
  currencySymbol?: string;
  timezone?: string;
  taxRegimeCode?: string;
  planId: string;
  branches: Array<{
    branchId: string;
    name: string;
    code: string;
    address?: AddressRecord;
    taxId?: string;
  }>;
  owner: { email: string; name: string };
  personas: SeedPersona[];
  storageLocations?: SeedStorageLocation[];
  financialAccounts?: SeedFinancialAccount[];
  categories?: Array<{ id: string; name: string }>;
  units?: Array<{ id: string; name: string; code: string; group?: UnitGroup; precision?: number }>;
  products?: Array<Partial<ProductDoc> & { id: string; name: string; sellingPrice: number; costPrice: number }>;
  customers?: Array<Partial<CustomerDoc> & { id: string; name: string; code: string }>;
  vendors?: Array<Partial<VendorDoc> & { id: string; name: string; code: string }>;
  openingStock?: Array<{ productId: string; branchId: string; quantity: number; storageLocationId?: string; serialNumbers?: string[] }>;
  stockTransfers?: SeedStockTransfer[];
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
    import("../callables/stock.js"),
    import("../callables/outflows.js"),
    import("../callables/bills.js"),
    import("../callables/payments.js"),
    import("../callables/returns.js"),
    import("../callables/deliveries.js"),
    import("../callables/stockTransfers.js"),
    import("../callables/approvals.js"),
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
    const user: UserDoc = {
      name: p.name,
      email: p.email,
      accountType: p.key === "owner" ? "admin" : "standard",
      isActive: "status" in p && p.status ? p.status === EntityStatus.ACTIVE : true,
      createdAt: now,
      createdBy,
    };
    await db.collection("users").doc(uid).set(user);
  }

  // Organization (counters derived from the spec)
  const countryDef = getCountryDefaults(spec.country || "IN");
  const org: OrganizationDoc = {
    name: spec.name,
    legalName: spec.name,
    legalNameKey: nameKey(spec.name),
    businessType: spec.businessType,
    businessCategory: spec.businessCategory,
    country: spec.country || "IN",
    currency: spec.currency || countryDef.currencyCode,
    currencyDecimals: spec.currencyDecimals ?? countryDef.currencyDecimals,
    minorUnitName: spec.minorUnitName || countryDef.minorUnitName,
    minorUnitNamePlural: spec.minorUnitNamePlural || countryDef.minorUnitNamePlural,
    currencySymbol: spec.currencySymbol || countryDef.currencySymbol,
    timezone: spec.timezone || countryDef.timezone,
    taxRegimeCode: spec.taxRegimeCode || countryDef.taxRegimeCode,
    status: EntityStatus.ACTIVE,
    planId: spec.planId,
    moduleToggles: {},
    defaultBranchId,
    branchCount: spec.branches.length,
    activeEmployeeCount: spec.personas.filter((p) => !("status" in p) || p.status === EntityStatus.ACTIVE).length,
    ...buildSubscriptionFields({ durationDays: 365 }),
    createdAt: now,
    createdBy,
  };
  await db.collection("organizations").doc(orgId).set(org);

  for (const [i, b] of spec.branches.entries()) {
    const branch: BranchDoc = {
      organizationId: orgId,
      name: b.name,
      code: b.code,
      isDefault: i === 0,
      isActive: true,
      address: b.address,
      taxId: b.taxId,
      createdAt: now,
      createdBy,
    };
    await db.collection("organizations").doc(orgId).collection("branches").doc(b.branchId).set(branch);
    await db.collection("uniqueKeys").doc(uniqueKeyId(orgId, "branch_code", b.code.toLowerCase())).set({
      organizationId: orgId,
      kind: "branch_code",
      entityType: "branch",
      entityId: b.branchId,
      createdAt: now,
    });
  }

  // Memberships and branch assignments
  for (const p of people) {
    const membershipId = `${uids[p.key]}_${orgId}`;
    const reportsTo = "reportsTo" in p && p.reportsTo ? [`${uids[p.reportsTo]}_${orgId}`] : [];
    const branchIds = p.branchIds || [defaultBranchId];
    const membership: MembershipDoc = {
      userId: uids[p.key],
      organizationId: orgId,
      roleId: p.roleId,
      jobRoleIds: [],
      reportingToIds: reportsTo,
      permissions: ("permissionOverrides" in p && p.permissionOverrides) || {},
      status: ("status" in p && p.status) || EntityStatus.ACTIVE,
      isPrimary: true,
      primaryBranchId: branchIds[0],
      createdAt: now,
      createdBy,
    };
    await db.collection("memberships").doc(membershipId).set(membership);
    for (const branchId of branchIds) {
      const mb: MembershipBranchDoc = {
        membershipId,
        userId: uids[p.key],
        organizationId: orgId,
        branchId,
        status: ("status" in p && p.status) || EntityStatus.ACTIVE,
        isDefaultForMembership: branchId === branchIds[0],
        permissions: {},
        createdAt: now,
        createdBy,
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
    const unit: UnitDoc = {
      organizationId: orgId,
      name: u.name,
      code: u.code,
      group: u.group || UnitGroup.COUNT,
      precision: u.precision ?? 0,
      isActive: true,
      createdAt: now,
      createdBy: owner,
    };
    await createIfAbsent(db, "units", u.id, unit as unknown as Record<string, unknown>);
    await claim("unit_name", nameKey(u.name), "unit", u.id);
  }

  for (const loc of spec.storageLocations || []) {
    const storageLoc: StorageLocationDoc = {
      organizationId: orgId,
      branchId: loc.branchId || defaultBranchId,
      name: loc.name,
      code: loc.code,
      type: loc.type || "warehouse",
      isDefault: loc.isDefault ?? false,
      isActive: true,
      notes: loc.notes,
      createdAt: now,
      createdBy: owner,
    };
    await createIfAbsent(db, "storageLocations", loc.id, storageLoc as unknown as Record<string, unknown>);
  }

  for (const fa of spec.financialAccounts || []) {
    const account: FinancialAccountDoc = {
      organizationId: orgId,
      branchId: fa.branchId ?? null,
      assignedBranchIds: fa.assignedBranchIds || (fa.branchId ? [fa.branchId] : spec.branches.map((b) => b.branchId)),
      name: fa.name,
      code: fa.code,
      accountType: fa.type || "cash",
      currency: fa.currency || spec.currency || "INR",
      bankDetails: fa.bankDetails,
      openingBalance: fa.openingBalance || 0,
      currentBalance: fa.openingBalance || 0,
      isDefault: fa.isDefault ?? false,
      isActive: true,
      createdAt: now,
      createdBy: owner,
    };
    await createIfAbsent(db, "financialAccounts", fa.id, account as unknown as Record<string, unknown>);
  }

  for (const { id, ...p } of spec.products || []) {
    const product: ProductDoc = {
      organizationId: orgId,
      baseUnit: "piece",
      taxInclusive: false,
      taxRatePercent: 0,
      hasExpiry: false,
      trackStock: true,
      lowStockThreshold: 5,
      isActive: true,
      currentStock: 0,
      ...p,
      nameKey: nameKey(p.name),
      createdAt: now,
      createdBy: owner,
    } as ProductDoc;
    await createIfAbsent(db, "products", id, product as unknown as Record<string, unknown>);
    if (p.barcode) {
      await db.collection("uniqueKeys").doc(uniqueKeyId(orgId, "barcode", p.barcode.toLowerCase())).set({
        organizationId: orgId,
        kind: "barcode",
        entityType: "product",
        entityId: id,
        createdAt: now,
      });
    }
  }

  for (const { id, code, ...c } of spec.customers || []) {
    const customer: CustomerDoc = {
      organizationId: orgId,
      customerCode: code,
      creditLimit: 0,
      creditPeriodDays: 0,
      outstandingBalance: 0,
      totalSpend: 0,
      visibilityScope: "all_branches",
      isDefault: false,
      isActive: true,
      ...c,
      createdAt: now,
      createdBy: owner,
    } as CustomerDoc;
    await createIfAbsent(db, "customers", id, customer as unknown as Record<string, unknown>);
    await claim("customer_phone", phoneKey(customer.phone), "customer", id);
    await claim("customer_tax", taxIdKey(customer.taxId), "customer", id);
  }

  for (const { id, code, ...v } of spec.vendors || []) {
    const vendor: VendorDoc = {
      organizationId: orgId,
      vendorCode: code,
      outstandingPayable: 0,
      totalPurchase: 0,
      visibilityScope: "all_branches",
      isDefault: false,
      isActive: true,
      ...v,
      createdAt: now,
      createdBy: owner,
    } as VendorDoc;
    await createIfAbsent(db, "vendors", id, vendor as unknown as Record<string, unknown>);
    await claim("vendor_phone", phoneKey(vendor.phone), "vendor", id);
    await claim("vendor_tax", taxIdKey(vendor.taxId), "vendor", id);
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
      data: {
        branchId: s.branchId,
        productId: s.productId,
        quantity: s.quantity,
        reason: "Opening stock (seed)",
        reasonCode: "opening_stock",
        storageLocationId: s.storageLocationId,
        serialNumbers: s.serialNumbers,
        idempotencyKey: `seed-${orgId}-open-${s.productId}-${s.branchId}`,
      },
    });
  }

  // Inter-branch stock transfers through state machine (created once; later runs skip to avoid re-dispatching)
  if (spec.stockTransfers && spec.stockTransfers.length > 0) {
    const existingTransfersSnap = await db.collection("stockTransfers").where("organizationId", "==", orgId).limit(1).get();
    if (existingTransfersSnap.empty) {
      for (const [idx, tr] of spec.stockTransfers.entries()) {
        const createKey = `seed-${orgId}-st-${idx}-create`;
        const submitKey = `seed-${orgId}-st-${idx}-submit`;
        const approveKey = `seed-${orgId}-st-${idx}-approve`;
        const dispatchKey = `seed-${orgId}-st-${idx}-dispatch`;
        const receiveKey = `seed-${orgId}-st-${idx}-receive`;

        const createRes = (await callables.stockTransfersCreate.run({
          auth: as(tr.createdAs || "admin", tr.sourceBranchId),
          data: {
            sourceBranchId: tr.sourceBranchId,
            destinationBranchId: tr.destinationBranchId,
            sourceLocationId: tr.sourceLocationId,
            destinationLocationId: tr.destinationLocationId,
            items: tr.items,
            notes: tr.notes || "Inter-branch stock transfer (seed)",
            idempotencyKey: createKey,
          },
        })) as { transferId: string };

        const transferId = createRes?.transferId;
        if (transferId) {
          await callables.stockTransfersSubmit.run({
            auth: as(tr.createdAs || "admin", tr.sourceBranchId),
            data: {
              transferId,
              idempotencyKey: submitKey,
            },
          });

          await callables.documentsDecide.run({
            auth: as(tr.approvedAs || "owner", tr.sourceBranchId),
            data: {
              documentType: "stock_transfer",
              documentId: transferId,
              decision: "approve",
              reason: "Approved flagship stock transfer",
              idempotencyKey: approveKey,
            },
          });

          await callables.stockTransfersDispatch.run({
            auth: as(tr.dispatchedAs || "purchaseManager", tr.sourceBranchId),
            data: {
              transferId,
              transportMode: "road",
              trackingReference: `TRK-${spec.country || "BH"}-${idx + 1}`,
              idempotencyKey: dispatchKey,
            },
          });

          await callables.stockTransfersReceive.run({
            auth: as(tr.receivedAs || "salesManager", tr.destinationBranchId),
            data: {
              transferId,
              items: tr.items.map((it) => ({
                productId: it.productId,
                receivedQty: it.quantity,
                shortQty: 0,
                rejectedQty: 0,
                serialNumbers: it.serialNumbers,
              })),
              idempotencyKey: receiveKey,
            },
          });
        }
      }
    }
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

const team = (domain: string, allBranchIds?: string[]): SeedPersona[] => [
  { key: "admin", email: `admin@${domain}`, name: "Admin", roleId: "role_admin", label: "Admin", branchIds: allBranchIds, description: "Administrator: day-to-day operations and approvals across all branches." },
  { key: "purchaseManager", email: `purchase.manager@${domain}`, name: "Purchase Manager", roleId: "role_store_manager", label: "Purchase Manager", branchIds: allBranchIds, description: "Approves purchases; sees the purchase staff's documents (team scope via reporting line)." },
  { key: "purchaseStaff", email: `purchase.staff@${domain}`, name: "Purchase Staff", roleId: "role_purchase_staff", label: "Purchase Staff", reportsTo: "purchaseManager", branchIds: allBranchIds, description: "Records vendor purchases and receives stock; sees own documents." },
  { key: "salesManager", email: `sales.manager@${domain}`, name: "Sales Manager", roleId: "role_store_manager", label: "Sales Manager", branchIds: allBranchIds, description: "Sales, deliveries and discounts approval for the branches." },
  { key: "cashier", email: `cashier@${domain}`, name: "Cashier", roleId: "role_cashier", label: "Cashier", reportsTo: "salesManager", description: "Counter and B2B billing, customer payments, returns." },
  { key: "rider", email: `rider@${domain}`, name: "Rider", roleId: "role_rider", label: "Delivery Rider", branchIds: allBranchIds, description: "Assigned deliveries and live location (plan includes delivery)." },
];

/**
 * Flagship Organization 1: Bahrain Bicycle Shop (BH / BHD, 3 decimals, fils)
 */
export const BAHRAIN_BICYCLE_SPEC: SeedOrgSpec = {
  organizationId: "org_cycle_world",
  name: "Al-Manama Cycles & Sports WLL",
  businessType: BusinessType.WHOLESALE_RETAIL,
  businessCategory: BusinessCategory.BICYCLE,
  country: "BH",
  currency: "BHD",
  currencyDecimals: 3,
  minorUnitName: "fils",
  minorUnitNamePlural: "fils",
  currencySymbol: "BD",
  timezone: "Asia/Bahrain",
  taxRegimeCode: "BH_VAT",
  planId: "plan_growth",
  branches: [
    {
      branchId: "main-branch",
      name: "Manama Flagship Showroom",
      code: "MANAMA",
      address: { id: "addr_bh_main", line1: "Building 123, Road 45, Block 308", city: "Manama", state: "Capital", postalCode: "308", country: "BH", isDefaultBilling: true },
    },
    {
      branchId: "branch_riffa",
      name: "Riffa Distribution Center",
      code: "RIFFA",
      address: { id: "addr_bh_riffa", line1: "Gate 4, East Riffa Logistics Park", city: "Riffa", state: "Southern", postalCode: "901", country: "BH", isDefaultBilling: false },
    },
  ],
  owner: { email: "owner@cycleworld.trado.local", name: "Salman Al-Khalifa" },
  personas: team("cycleworld.trado.local", ["main-branch", "branch_riffa"]),
  storageLocations: [
    { id: "loc_bh_manama_floor", branchId: "main-branch", name: "Manama Showroom Floor", code: "MNM-FLR", type: "counter", isDefault: true },
    { id: "loc_bh_riffa_depot", branchId: "branch_riffa", name: "Riffa Warehouse Depot", code: "RFA-DEP", type: "warehouse", isDefault: true },
  ],
  financialAccounts: [
    {
      id: "acc_bh_cash",
      branchId: "main-branch",
      name: "Manama Cash Drawer (BHD)",
      code: "CSH-BHD",
      type: "cash",
      currency: "BHD",
      openingBalance: 1500,
      isDefault: true,
    },
    {
      id: "acc_bh_nbb_bank",
      branchId: null,
      name: "National Bank of Bahrain Corporate Account",
      code: "NBB-001",
      type: "bank",
      currency: "BHD",
      openingBalance: 10000,
      isDefault: false,
      bankDetails: {
        bankName: "National Bank of Bahrain",
        accountNumberMasked: "•••••••4821",
        ifscOrSwift: "NBBBBHBM",
      },
    },
  ],
  categories: [
    { id: "cat_bh_bicycles", name: "Bicycles & E-Bikes" },
    { id: "cat_bh_spares", name: "Bicycle Components & Spares" },
  ],
  units: [
    { id: "unit_bh_piece", name: "Piece", code: "piece", group: UnitGroup.COUNT, precision: 0 },
    { id: "unit_bh_set", name: "Set", code: "set", group: UnitGroup.COUNT, precision: 0 },
  ],
  products: [
    {
      id: "prod_bh_road_racer",
      name: "Trekker Domane Road Racer 700c",
      categoryId: "cat_bh_bicycles",
      brand: "Trekker",
      baseUnit: "piece",
      barcode: "6001234567801",
      sellingPrice: 450,
      costPrice: 320,
      trackStock: true,
      trackSerial: true,
      warrantyMonths: 24,
      taxRatePercent: 10,
      variantGroupId: "vg_bh_trekker",
      variantAttributes: { frame: "Carbon", wheels: "700c" },
    },
    {
      id: "prod_bh_mountain_exp",
      name: "Trekker Mountain Explorer 29in",
      categoryId: "cat_bh_bicycles",
      brand: "Trekker",
      baseUnit: "piece",
      barcode: "6001234567802",
      sellingPrice: 380,
      costPrice: 270,
      trackStock: true,
      trackSerial: true,
      warrantyMonths: 24,
      taxRatePercent: 10,
      variantGroupId: "vg_bh_trekker",
      variantAttributes: { frame: "Alloy", wheels: "29in" },
    },
    {
      id: "prod_bh_city_hybrid",
      name: "City Commuter Hybrid 28in",
      categoryId: "cat_bh_bicycles",
      brand: "UrbanRide",
      baseUnit: "piece",
      barcode: "6001234567803",
      sellingPrice: 220,
      costPrice: 150,
      trackStock: true,
      trackBatch: true,
      taxRatePercent: 10,
    },
    {
      id: "prod_bh_tube_26",
      name: "Continental High Pressure Tube 700x25c",
      categoryId: "cat_bh_spares",
      baseUnit: "piece",
      barcode: "6001234567891",
      sellingPrice: 4.5,
      costPrice: 2.2,
      trackStock: true,
      taxRatePercent: 10,
    },
    {
      id: "prod_bh_shimano_chain",
      name: "Shimano Deore 11-Speed Chain",
      categoryId: "cat_bh_spares",
      baseUnit: "piece",
      barcode: "6001234567892",
      sellingPrice: 18,
      costPrice: 11.5,
      trackStock: true,
      taxRatePercent: 10,
    },
  ],
  customers: [
    {
      id: "cust_bh_cycling_club",
      code: "CUST-000001",
      name: "Bahrain Cycling Federation WLL",
      phone: "+97339112233",
      taxId: "BH2000300040",
      creditLimit: 25000000,
      addresses: [{ id: "addr_cust_1", line1: "Seef District Tower 4", city: "Manama", state: "Capital", postalCode: "428", country: "BH", isDefaultBilling: true }],
    },
  ],
  vendors: [
    {
      id: "vend_bh_gulf_cycles",
      code: "VEND-000001",
      name: "Gulf Cycle Distributing WLL",
      phone: "+97339445566",
      taxId: "BH1000200030",
      addresses: [{ id: "addr_vend_1", line1: "Sitra Industrial Area", city: "Sitra", state: "Capital", postalCode: "601", country: "BH", isDefaultBilling: true }],
    },
  ],
  openingStock: [
    { productId: "prod_bh_road_racer", branchId: "main-branch", quantity: 5, storageLocationId: "loc_bh_manama_floor", serialNumbers: ["BH-RR-OPEN-01", "BH-RR-OPEN-02", "BH-RR-OPEN-03", "BH-RR-OPEN-04", "BH-RR-OPEN-05"] },
    { productId: "prod_bh_road_racer", branchId: "branch_riffa", quantity: 3, storageLocationId: "loc_bh_riffa_depot", serialNumbers: ["BH-RR-OPEN-06", "BH-RR-OPEN-07", "BH-RR-OPEN-08"] },
    { productId: "prod_bh_mountain_exp", branchId: "main-branch", quantity: 4, storageLocationId: "loc_bh_manama_floor", serialNumbers: ["BH-ME-OPEN-01", "BH-ME-OPEN-02", "BH-ME-OPEN-03", "BH-ME-OPEN-04"] },
    { productId: "prod_bh_mountain_exp", branchId: "branch_riffa", quantity: 2, storageLocationId: "loc_bh_riffa_depot", serialNumbers: ["BH-ME-OPEN-05", "BH-ME-OPEN-06"] },
    { productId: "prod_bh_city_hybrid", branchId: "main-branch", quantity: 10, storageLocationId: "loc_bh_manama_floor" },
    { productId: "prod_bh_city_hybrid", branchId: "branch_riffa", quantity: 5, storageLocationId: "loc_bh_riffa_depot" },
    { productId: "prod_bh_tube_26", branchId: "main-branch", quantity: 50, storageLocationId: "loc_bh_manama_floor" },
    { productId: "prod_bh_tube_26", branchId: "branch_riffa", quantity: 30, storageLocationId: "loc_bh_riffa_depot" },
    { productId: "prod_bh_shimano_chain", branchId: "main-branch", quantity: 25, storageLocationId: "loc_bh_manama_floor" },
    { productId: "prod_bh_shimano_chain", branchId: "branch_riffa", quantity: 15, storageLocationId: "loc_bh_riffa_depot" },
  ],
  stockTransfers: [
    {
      sourceBranchId: "main-branch",
      destinationBranchId: "branch_riffa",
      sourceLocationId: "loc_bh_manama_floor",
      destinationLocationId: "loc_bh_riffa_depot",
      createdAs: "purchaseStaff",
      approvedAs: "owner",
      dispatchedAs: "purchaseManager",
      receivedAs: "salesManager",
      notes: "Stock transfer of tubes and chains from Manama Showroom to Riffa Depot",
      items: [
        { productId: "prod_bh_tube_26", quantity: 10, unit: "piece" },
        { productId: "prod_bh_shimano_chain", quantity: 5, unit: "piece" },
      ],
    },
  ],
  transactions: [
    {
      as: "purchaseStaff",
      fn: "outflowsCreate",
      step: "pur-bh-cycles-01",
      data: {
        kind: "purchase",
        vendorId: "vend_bh_gulf_cycles",
        invoiceNumber: "GCD-2026-001",
        paidAmount: 640,
        paymentMethod: "bank_transfer",
        financialAccountId: "acc_bh_nbb_bank",
        lines: [
          { productId: "prod_bh_road_racer", quantity: 2, unit: "piece", unitPrice: 320, serialNumbers: ["BH-RR-001", "BH-RR-002"] },
          { productId: "prod_bh_tube_26", quantity: 20, unit: "piece", unitPrice: 2.2, damagedQuantity: 1, damageReason: "punctured packaging" },
          { productId: "prod_bh_shimano_chain", quantity: 10, unit: "piece", unitPrice: 11.5 },
        ],
      },
    },
    {
      as: "cashier",
      fn: "billsCreate",
      step: "sale-bh-b2b-01",
      data: {
        salesMode: "b2b",
        customerId: "cust_bh_cycling_club",
        items: [
          { productId: "prod_bh_road_racer", quantity: 1, serialNumbers: ["BH-RR-001"] },
          { productId: "prod_bh_shimano_chain", quantity: 2 },
        ],
        paidAmount: 500,
        paymentMethod: "cash",
        financialAccountId: "acc_bh_cash",
      },
    },
    {
      as: "cashier",
      fn: "billsCreate",
      step: "sale-bh-counter-spares",
      data: {
        items: [
          { productId: "prod_bh_tube_26", quantity: 4 },
          { productId: "prod_bh_shimano_chain", quantity: 1 },
        ],
        paidAmount: 39.6,
        paymentMethod: "cash",
        financialAccountId: "acc_bh_cash",
      },
    },
  ],
};
export const CYCLE_WORLD_SPEC = BAHRAIN_BICYCLE_SPEC;
export const WHOLESALE_HUB_SPEC = BAHRAIN_BICYCLE_SPEC;

/**
 * Flagship Organization 2: UAE Kitchenware & Hospitality (AE / AED, 2 decimals, fils)
 */
export const UAE_KITCHENWARE_SPEC: SeedOrgSpec = {
  organizationId: "org_kitchen_mart",
  name: "Emirates Kitchen & Hospitality Supplies LLC",
  businessType: BusinessType.WHOLESALE_RETAIL,
  businessCategory: BusinessCategory.KITCHENWARE_HOUSEHOLD,
  country: "AE",
  currency: "AED",
  currencyDecimals: 2,
  minorUnitName: "fils",
  minorUnitNamePlural: "fils",
  currencySymbol: "AED",
  timezone: "Asia/Dubai",
  taxRegimeCode: "AE_VAT",
  planId: "plan_growth",
  branches: [
    {
      branchId: "main-branch",
      name: "Dubai Deira Flagship",
      code: "DEIRA",
      address: { id: "addr_ae_deira", line1: "Al Rigga Road, Deira", city: "Dubai", state: "Dubai", postalCode: "00000", country: "AE", isDefaultBilling: true },
    },
    {
      branchId: "branch_abu_dhabi",
      name: "Abu Dhabi Central Store",
      code: "AUH",
      address: { id: "addr_ae_auh", line1: "Electra Street, Al Danah", city: "Abu Dhabi", state: "Abu Dhabi", postalCode: "00000", country: "AE", isDefaultBilling: false },
    },
  ],
  owner: { email: "owner@kitchenmart.trado.local", name: "Rashid Al-Nuaimi" },
  personas: team("kitchenmart.trado.local", ["main-branch", "branch_abu_dhabi"]),
  storageLocations: [
    { id: "loc_ae_deira_sales", branchId: "main-branch", name: "Deira Main Sales Floor", code: "DRA-FLR", type: "counter", isDefault: true },
    { id: "loc_ae_auh_wh", branchId: "branch_abu_dhabi", name: "Abu Dhabi Distribution Depot", code: "AUH-DPT", type: "warehouse", isDefault: true },
  ],
  financialAccounts: [
    {
      id: "acc_ae_cash",
      branchId: "main-branch",
      name: "Deira Cash Drawer (AED)",
      code: "CSH-AED",
      type: "cash",
      currency: "AED",
      openingBalance: 2500,
      isDefault: true,
    },
    {
      id: "acc_ae_enbd_bank",
      branchId: null,
      name: "Emirates NBD Corporate Account",
      code: "ENBD-001",
      type: "bank",
      currency: "AED",
      openingBalance: 50000,
      isDefault: false,
      bankDetails: {
        bankName: "Emirates NBD",
        accountNumberMasked: "•••••••8902",
        ifscOrSwift: "EBILAEAD",
      },
    },
  ],
  categories: [
    { id: "cat_ae_cookware", name: "Commercial Cookware" },
    { id: "cat_ae_knives", name: "Chef Knives & Cutlery" },
    { id: "cat_ae_bulk_clean", name: "Bulk Sanitation Supplies" },
  ],
  units: [
    { id: "unit_ae_piece", name: "Piece", code: "piece", group: UnitGroup.COUNT, precision: 0 },
    { id: "unit_ae_box", name: "Box (6 pcs)", code: "box", group: UnitGroup.COUNT, precision: 0 },
    { id: "unit_ae_kg", name: "Kilogram", code: "kg", group: UnitGroup.WEIGHT, precision: 3 },
  ],
  products: [
    {
      id: "prod_ae_cookware_set",
      name: "MasterChef 10-Piece Stainless Steel Set",
      categoryId: "cat_ae_cookware",
      baseUnit: "piece",
      barcode: "6291000000011",
      sellingPrice: 350,
      costPrice: 220,
      trackStock: true,
      taxRatePercent: 5,
      alternateUnits: [{ unit: "box", factor: 6, sellingPrice: 1950, isPurchaseUnit: true, isSaleUnit: true }],
    },
    {
      id: "prod_ae_cast_iron_skillet",
      name: "Heavy Cast Iron Skillet 30cm",
      categoryId: "cat_ae_cookware",
      baseUnit: "piece",
      barcode: "6291000000028",
      sellingPrice: 120,
      costPrice: 75,
      trackStock: true,
      taxRatePercent: 5,
    },
    {
      id: "prod_ae_chef_knife",
      name: "Japanese Steel Chef Knife 8in (Serial Tracked)",
      categoryId: "cat_ae_knives",
      baseUnit: "piece",
      barcode: "6291000000035",
      sellingPrice: 85,
      costPrice: 45,
      trackStock: true,
      trackSerial: true,
      warrantyMonths: 12,
      taxRatePercent: 5,
    },
    {
      id: "prod_ae_sanitizer_bulk",
      name: "Food-Grade Kitchen Sanitizer Concentrate (kg)",
      categoryId: "cat_ae_bulk_clean",
      baseUnit: "kg",
      barcode: "6291000000042",
      sellingPrice: 25,
      costPrice: 14,
      trackStock: true,
      taxRatePercent: 5,
    },
    {
      id: "prod_ae_paper_napkins",
      name: "Eco-Friendly Kraft Table Napkins (Tax-Exempt)",
      categoryId: "cat_ae_bulk_clean",
      baseUnit: "box",
      barcode: "6291000000059",
      sellingPrice: 40,
      costPrice: 20,
      trackStock: true,
      isTaxable: false,
      taxRatePercent: 0,
    },
  ],
  customers: [
    {
      id: "cust_ae_gourmet_resto",
      code: "CUST-000001",
      name: "Burj Al Arab Hospitality LLC",
      phone: "+971501234567",
      taxId: "100200300400003",
      creditLimit: 10000000,
      addresses: [{ id: "addr_ae_cust_1", line1: "Jumeirah Beach Road", city: "Dubai", state: "Dubai", postalCode: "00000", country: "AE", isDefaultBilling: true }],
    },
  ],
  vendors: [
    {
      id: "vend_ae_hotel_supplies",
      code: "VEND-000001",
      name: "Middle East Hotelware Importers LLC",
      phone: "+971509876543",
      taxId: "100999888777003",
      addresses: [{ id: "addr_ae_vend_1", line1: "Al Quoz Industrial 3", city: "Dubai", state: "Dubai", postalCode: "00000", country: "AE", isDefaultBilling: true }],
    },
  ],
  openingStock: [
    { productId: "prod_ae_cookware_set", branchId: "main-branch", quantity: 20, storageLocationId: "loc_ae_deira_sales" },
    { productId: "prod_ae_cookware_set", branchId: "branch_abu_dhabi", quantity: 10, storageLocationId: "loc_ae_auh_wh" },
    { productId: "prod_ae_cast_iron_skillet", branchId: "main-branch", quantity: 40, storageLocationId: "loc_ae_deira_sales" },
    { productId: "prod_ae_cast_iron_skillet", branchId: "branch_abu_dhabi", quantity: 25, storageLocationId: "loc_ae_auh_wh" },
    { productId: "prod_ae_chef_knife", branchId: "main-branch", quantity: 5, storageLocationId: "loc_ae_deira_sales", serialNumbers: ["AE-CK-01", "AE-CK-02", "AE-CK-03", "AE-CK-04", "AE-CK-05"] },
    { productId: "prod_ae_chef_knife", branchId: "branch_abu_dhabi", quantity: 3, storageLocationId: "loc_ae_auh_wh", serialNumbers: ["AE-CK-06", "AE-CK-07", "AE-CK-08"] },
    { productId: "prod_ae_sanitizer_bulk", branchId: "main-branch", quantity: 200, storageLocationId: "loc_ae_deira_sales" },
    { productId: "prod_ae_sanitizer_bulk", branchId: "branch_abu_dhabi", quantity: 100, storageLocationId: "loc_ae_auh_wh" },
    { productId: "prod_ae_paper_napkins", branchId: "main-branch", quantity: 100, storageLocationId: "loc_ae_deira_sales" },
    { productId: "prod_ae_paper_napkins", branchId: "branch_abu_dhabi", quantity: 50, storageLocationId: "loc_ae_auh_wh" },
  ],
  stockTransfers: [
    {
      sourceBranchId: "main-branch",
      destinationBranchId: "branch_abu_dhabi",
      sourceLocationId: "loc_ae_deira_sales",
      destinationLocationId: "loc_ae_auh_wh",
      createdAs: "purchaseStaff",
      approvedAs: "owner",
      dispatchedAs: "purchaseManager",
      receivedAs: "salesManager",
      notes: "Stock transfer of cookware and bulk sanitizer to Abu Dhabi Central Store",
      items: [
        { productId: "prod_ae_cookware_set", quantity: 5, unit: "piece" },
        { productId: "prod_ae_sanitizer_bulk", quantity: 30, unit: "kg" },
      ],
    },
  ],
  transactions: [
    {
      as: "purchaseStaff",
      fn: "outflowsCreate",
      step: "pur-ae-hotel-01",
      data: {
        kind: "purchase",
        vendorId: "vend_ae_hotel_supplies",
        invoiceNumber: "MEH-2026-901",
        paidAmount: 1800,
        paymentMethod: "bank_transfer",
        financialAccountId: "acc_ae_enbd_bank",
        lines: [
          { productId: "prod_ae_cookware_set", quantity: 5, unit: "box", unitPrice: 220 },
          { productId: "prod_ae_chef_knife", quantity: 3, unit: "piece", unitPrice: 45, serialNumbers: ["AE-KN-001", "AE-KN-002", "AE-KN-003"] },
          { productId: "prod_ae_sanitizer_bulk", quantity: 50, unit: "kg", unitPrice: 14 },
        ],
      },
    },
    {
      as: "cashier",
      fn: "billsCreate",
      step: "sale-ae-b2b-01",
      data: {
        salesMode: "b2b",
        customerId: "cust_ae_gourmet_resto",
        items: [
          { productId: "prod_ae_cookware_set", quantity: 2, unit: "piece" },
          { productId: "prod_ae_chef_knife", quantity: 1, serialNumbers: ["AE-KN-001"] },
          { productId: "prod_ae_sanitizer_bulk", quantity: 10, unit: "kg" },
          { productId: "prod_ae_paper_napkins", quantity: 2, unit: "box" },
        ],
        paidAmount: 500,
        paymentMethod: "bank_transfer",
        financialAccountId: "acc_ae_enbd_bank",
      },
    },
    {
      as: "cashier",
      fn: "billsCreate",
      step: "sale-ae-counter-skillet",
      data: {
        items: [
          { productId: "prod_ae_cast_iron_skillet", quantity: 1 },
          { productId: "prod_ae_sanitizer_bulk", quantity: 2, unit: "kg" },
        ],
        paidAmount: 178.5,
        paymentMethod: "cash",
        financialAccountId: "acc_ae_cash",
      },
    },
  ],
};
export const KITCHEN_MART_SPEC = UAE_KITCHENWARE_SPEC;

export const ALL_SEED_SPECS: SeedOrgSpec[] = [
  CYCLE_WORLD_SPEC,
  KITCHEN_MART_SPEC,
];
