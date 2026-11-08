/**
 * Read-time hydration (zero-duplication rule, Part 1.3).
 *
 * Stored documents hold only references (customerId, productId, vendorId, membership ids,
 * referenceId …). List/get callables return display data by joining at read time:
 *
 *   { items: [...], included: { customers: {id: {...}}, products: {...}, members: {...}, ... } }
 *
 * Each referenced entity appears once per response however many rows point at it. All ids of
 * one kind are fetched with a single batched getAll (all kinds in parallel = one round trip),
 * tenant-checked (another organization's document is never returned) and redacted by the
 * caller's permissions. Read cost = number of DISTINCT referenced documents (page size ≤ 100).
 */

import { db } from "./firebase.js";
import type { RequestContext } from "./contextResolver.js";
import { redactCustomer, redactVendor } from "./redaction.js";

export type IncludedKind = "customers" | "vendors" | "products" | "members" | "bills" | "outflows";
export type IncludedMap = Partial<Record<IncludedKind, Record<string, Record<string, unknown>>>>;
type Doc = Record<string, unknown>;

/** Display projection per kind (never the whole document). */
const PROJECTION: Record<Exclude<IncludedKind, "members">, { collection: string; fields: string[] }> = {
  customers: { collection: "customers", fields: ["name", "customerCode", "mobile", "taxNumber", "billingAddress", "outstandingBalance", "creditLimit", "isActive"] },
  vendors: { collection: "vendors", fields: ["name", "vendorCode", "mobile", "taxNumber", "outstandingPayable", "creditLimit", "isActive"] },
  products: { collection: "products", fields: ["name", "sku", "barcode", "baseUnit", "brand", "taxCode", "isActive"] },
  bills: { collection: "bills", fields: ["billNumber", "documentType", "salesMode", "status", "customerId", "totalAmount", "createdAt"] },
  outflows: { collection: "outflows", fields: ["outflowNumber", "kind", "status", "vendorId", "invoiceNumber", "totalAmount", "createdAt"] },
};

/** Field name → included kind, for automatic collection from stored documents. */
const REFERENCE_FIELDS: Record<string, IncludedKind> = {
  customerId: "customers",
  vendorId: "vendors",
  productId: "products",
  riderMembershipId: "members",
  salespersonMembershipId: "members",
  createdByMembershipId: "members",
  payeeMembershipId: "members",
  assignedToMembershipId: "members",
  membershipId: "members",
  billId: "bills",
};

export class ReferenceCollector {
  private readonly ids = new Map<IncludedKind, Set<string>>();

  add(kind: IncludedKind, id: unknown): this {
    if (typeof id !== "string" || !id) return this;
    if (!this.ids.has(kind)) this.ids.set(kind, new Set());
    (this.ids.get(kind) as Set<string>).add(id);
    return this;
  }

  /**
   * Collects known reference fields from documents and their line arrays (items / lines),
   * plus polymorphic references (partyType+partyId, referenceModel+referenceId).
   */
  collect(docs: Doc[]): this {
    for (const doc of docs) {
      this.collectOne(doc);
      for (const key of ["items", "lines"]) {
        if (Array.isArray(doc[key])) for (const line of doc[key] as Doc[]) this.collectOne(line);
      }
    }
    return this;
  }

  private collectOne(doc: Doc): void {
    for (const [field, kind] of Object.entries(REFERENCE_FIELDS)) this.add(kind, doc[field]);
    if (doc.partyId) this.add(doc.partyType === "vendor" ? "vendors" : "customers", doc.partyId);
    if (doc.referenceId && (doc.referenceModel === "bill" || doc.referenceModel === "outflow")) {
      this.add(doc.referenceModel === "bill" ? "bills" : "outflows", doc.referenceId);
    }
    if (doc.returnType && doc.referenceId) this.add(doc.returnType === "purchase_return" ? "outflows" : "bills", doc.referenceId);
  }

  /** One parallel round trip; tenant-checked and permission-redacted. */
  async resolve(ctx: Pick<RequestContext, "organizationId" | "can">): Promise<IncludedMap> {
    const orgId = ctx.organizationId;
    const included: IncludedMap = {};
    await Promise.all(Array.from(this.ids.entries()).map(async ([kind, set]) => {
      const ids = Array.from(set);
      if (!ids.length) return;
      if (kind === "members") {
        // Membership id = `${uid}_${organizationId}` → the user's display name, one read per member
        const suffix = `_${orgId}`;
        const owned = ids.filter((id) => id.endsWith(suffix));
        const snaps = owned.length ? await db.getAll(...owned.map((id) => db.collection("users").doc(id.slice(0, -suffix.length)))) : [];
        const out: Record<string, Doc> = {};
        snaps.forEach((s, i) => {
          if (s.exists) out[owned[i]] = { name: (s.data() as Doc).name ?? null };
        });
        included.members = out;
        return;
      }
      const spec = PROJECTION[kind];
      const snaps = await db.getAll(...ids.map((id) => db.collection(spec.collection).doc(id)));
      const out: Record<string, Doc> = {};
      for (const s of snaps) {
        if (!s.exists) continue;
        const data = s.data() as Doc;
        if (data.organizationId !== orgId) continue; // never leak another tenant's record
        let view: Doc = {};
        for (const f of spec.fields) if (data[f] !== undefined) view[f] = data[f];
        if (kind === "customers") view = redactCustomer(view, ctx);
        if (kind === "vendors") view = redactVendor(view, ctx);
        out[s.id] = view;
      }
      included[kind] = out;
    }));
    return included;
  }
}

/** Convenience: hydrate the references of a page of documents. */
export function hydrate(ctx: Pick<RequestContext, "organizationId" | "can">, docs: Doc[]): Promise<IncludedMap> {
  return new ReferenceCollector().collect(docs).resolve(ctx);
}

/** Converts a membership id to the user's uid within an organization (`${uid}_${orgId}`). */
export function membershipIdFor(uid: string, organizationId: string): string {
  return `${uid}_${organizationId}`;
}
