/**
 * Canonical Contact Normalization & Validation Service
 * 
 * Provides unified email and phone normalization across Trado using
 * libphonenumber-js for strict E.164 compliance and RFC 5322 email validation.
 */

import parsePhoneNumber, { CountryCode } from "libphonenumber-js";
import { HttpsError } from "firebase-functions/v2/https";

const EMAIL_REGEX = /^(?:[A-Za-z0-9_'+\-]+(?:\.[A-Za-z0-9_'+\-]+)*)@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/**
 * Normalizes and validates an email address.
 * Trims whitespace, converts to lowercase, checks length (<= 254), and validates structure.
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "Email address is required.");
  }

  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > 254) {
    throw new HttpsError("invalid-argument", "Email address must not exceed 254 characters.");
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    throw new HttpsError("invalid-argument", `Invalid email address format: "${trimmed}".`);
  }

  return trimmed;
}

/**
 * Normalizes and validates a phone number to standard E.164 format.
 * Uses libphonenumber-js with the entity's country code as the default region.
 */
export function normalizePhone(phone: string, defaultCountry: string = "IN"): string {
  if (!phone || typeof phone !== "string") {
    throw new HttpsError("invalid-argument", "Phone number is required.");
  }

  const trimmed = phone.trim();
  const region = (defaultCountry || "IN").toUpperCase().trim() as CountryCode;

  try {
    const parsed = parsePhoneNumber(trimmed, region);
    if (!parsed || !parsed.isValid()) {
      throw new HttpsError("invalid-argument", `Invalid phone number "${trimmed}" for region "${region}".`);
    }
    return parsed.format("E.164");
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("invalid-argument", `Invalid phone number format: "${trimmed}".`);
  }
}

/**
 * Normalizes an optional phone number. Returns undefined if omitted.
 */
export function normalizeOptionalPhone(phone?: string | null, defaultCountry: string = "IN"): string | undefined {
  if (!phone || !phone.trim()) return undefined;
  return normalizePhone(phone, defaultCountry);
}

/**
 * Normalizes an optional email address. Returns undefined if omitted.
 */
export function normalizeOptionalEmail(email?: string | null): string | undefined {
  if (!email || !email.trim()) return undefined;
  return normalizeEmail(email);
}
