/**
 * Natural-key uniqueness (Part 3): ONE lock collection for every "only one record may have
 * this value" rule (replaces barcodeLocks, branchCodeLocks and vendorInvoiceLocks).
 *
 *   uniqueKeys/{organizationId}_{kind}_{normalized key}
 *     { organizationId, kind, entityType, entityId, createdAt }   — the key is the id; no copies
 *
 * Claims are written with create() in the SAME batch/transaction as the entity, so concurrent
 * writers cannot both succeed (the second commit fails ALREADY_EXISTS → DUPLICATE_NATURAL_KEY).
 * A pre-read gives a precise error naming the existing record. Deactivating a record keeps its
 * key (decision D-17): the value stays reserved until the record is renamed or reactivated.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { uniqueKeyId, phoneKey, taxIdKey } from "./naturalKeys.js";

export type UniqueKeyKind =
  | "barcode" | "branch_code" | "vendor_invoice" | "customer_phone" | "customer_tax" | "vendor_phone" | "vendor_tax"
  | "category_name" | "unit_name" | "unit_code" | "department_name" | "job_role_name" | "team_name" | "serial";

export interface KeyClaim {
  kind: UniqueKeyKind;
  key: string | null | undefined; // already normalized (naturalKeys.ts); null/empty = nothing to claim
}

type Writer = Pick<FirebaseFirestore.WriteBatch, "create" | "delete"> | Pick<FirebaseFirestore.Transaction, "create" | "delete">;

export function uniqueKeyRef(organizationId: string, kind: UniqueKeyKind, key: string): FirebaseFirestore.DocumentReference {
  return db.collection("uniqueKeys").doc(uniqueKeyId(organizationId, kind, key));
}

const live = (claims: KeyClaim[]) => claims.filter((c): c is { kind: UniqueKeyKind; key: string } => !!c.key);

/** Throws DUPLICATE_NATURAL_KEY if any claim is held by another entity (read before writing). */
export async function assertKeysFree(organizationId: string, claims: KeyClaim[], entityId?: string, txn?: FirebaseFirestore.Transaction): Promise<void> {
  const keys = live(claims);
  if (!keys.length) return;
  const refs = keys.map((c) => uniqueKeyRef(organizationId, c.kind, c.key));
  const snaps = txn ? await txn.getAll(...refs) : await db.getAll(...refs);
  snaps.forEach((s, i) => {
    if (s.exists && s.data()?.entityId !== entityId) {
      throw duplicateError(keys[i].kind, keys[i].key, s.data()?.entityId as string);
    }
  });
}

/** Adds create() of every claim to the writer (fails atomically if someone else claimed it). */
export function claimKeys(writer: Writer, organizationId: string, entityType: string, entityId: string, claims: KeyClaim[]): void {
  const createdAt = new Date().toISOString();
  for (const c of live(claims)) {
    writer.create(uniqueKeyRef(organizationId, c.kind, c.key), { organizationId, kind: c.kind, entityType, entityId, createdAt });
  }
}

export function releaseKeys(writer: Writer, organizationId: string, claims: KeyClaim[]): void {
  for (const c of live(claims)) writer.delete(uniqueKeyRef(organizationId, c.kind, c.key));
}

/** Claims that changed between two versions (release old, claim new). */
export function changedClaims(before: KeyClaim[], after: KeyClaim[]): { release: KeyClaim[]; claim: KeyClaim[] } {
  const key = (c: KeyClaim) => `${c.kind}:${c.key ?? ""}`;
  const b = new Set(before.map(key));
  const a = new Set(after.map(key));
  return { release: before.filter((c) => c.key && !a.has(key(c))), claim: after.filter((c) => c.key && !b.has(key(c))) };
}

export function duplicateError(kind: UniqueKeyKind, key: string, existingEntityId?: string): HttpsError {
  return new HttpsError("already-exists", `[DUPLICATE_NATURAL_KEY] ${kind.replace(/_/g, " ")} "${key}" is already used${existingEntityId ? ` by ${existingEntityId}` : ""}.`, { reason: "DUPLICATE_NATURAL_KEY", kind, existingEntityId });
}

/** Maps a commit that lost the create() race to the stable duplicate error. */
export function asDuplicateIfRace(err: unknown, kind: UniqueKeyKind, key: string): unknown {
  const code = (err as { code?: number | string })?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS" ? duplicateError(kind, key) : err;
}

/** Phone and tax-id claims of a customer or vendor (normalized). */
export function partyClaims(party: "customer" | "vendor", doc: { mobile?: string | null; taxNumber?: string | null }): KeyClaim[] {
  return [
    { kind: party === "customer" ? "customer_phone" : "vendor_phone", key: phoneKey(doc.mobile) },
    { kind: party === "customer" ? "customer_tax" : "vendor_tax", key: taxIdKey(doc.taxNumber) },
  ];
}

/**
 * Writes an entity together with its natural-key changes in one atomic batch:
 * pre-checks for a precise error, then create()s the new keys (race-safe) and deletes released ones.
 */
export async function commitWithKeys(
  organizationId: string,
  entityType: string,
  entityId: string,
  write: (batch: FirebaseFirestore.WriteBatch) => void,
  keys: { claim: KeyClaim[]; release?: KeyClaim[] }
): Promise<void> {
  await assertKeysFree(organizationId, keys.claim, entityId);
  const batch = db.batch();
  write(batch);
  claimKeys(batch, organizationId, entityType, entityId, keys.claim);
  releaseKeys(batch, organizationId, keys.release || []);
  try {
    await batch.commit();
  } catch (err) {
    const first = live(keys.claim)[0];
    throw first ? asDuplicateIfRace(err, first.kind, first.key) : err;
  }
}

/**
 * Explicit duplicate override (decision D-18): an Owner/Admin may record a second customer/vendor
 * with the same phone or tax id by giving a reason (audited); everyone else is blocked.
 */
export function duplicateOverride(ctx: { isOwner: boolean; role?: { code?: string } }, reason?: string): boolean {
  if (!reason) return false;
  if (!ctx.isOwner && ctx.role?.code !== "admin") {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Only the Owner or an Admin may override a duplicate phone / tax id.", { reason: "PERMISSION_DENIED" });
  }
  return true;
}
