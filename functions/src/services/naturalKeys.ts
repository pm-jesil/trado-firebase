/**
 * Natural-key normalization (Part 3): the one implementation of "same record" for names,
 * phone numbers and tax ids. Lock documents and uniqueness checks key on these values.
 */

/** Case-folded, Unicode-normalized, whitespace-collapsed name ("  Tea  Cup " → "tea cup"). */
export function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * E.164-style phone key for duplicate detection: digits only, Indian 10-digit numbers get +91.
 * Returns null when there are too few digits to identify anyone.
 */
export function phoneKey(phone: string | null | undefined, defaultCountryCode = "91"): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 12 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+${defaultCountryCode}${digits.slice(1)}`;
  return `+${digits}`;
}

/** Tax registration key (GSTIN / VAT): upper-case, no spaces or separators. */
export function taxIdKey(taxId: string | null | undefined): string | null {
  if (!taxId) return null;
  const key = taxId.replace(/[\s\-./]/g, "").toUpperCase();
  return key.length >= 5 ? key : null;
}

/** Firestore-safe lock document id segment (ids cannot contain "/"). */
export function lockSegment(value: string): string {
  return encodeURIComponent(value).replace(/\./g, "%2E");
}

/** Document id of a natural-key lock: uniqueKeys/{organizationId}_{kind}_{key}. Pure (no Firebase import). */
export function uniqueKeyId(organizationId: string, kind: string, key: string): string {
  return `${organizationId}_${kind}_${lockSegment(key)}`;
}

/**
 * Machine-readable code slug from a human name: Unicode-normalised, lower-case, spaces → underscore,
 * non-word characters stripped. e.g. "Warehouse Manager" → "warehouse_manager".
 * Used for the `code` field on job roles, departments, teams, etc.
 */
export function codeSlug(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "");
}
