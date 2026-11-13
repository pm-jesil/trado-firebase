/**
 * Trado Cross-Regime Field Validators
 * 
 * Implements deterministic validators for financial, tax, banking, and identity fields:
 * - IBAN (ISO 13616 Mod-97)
 * - Indian IFSC (RBI 11-char alphanumeric)
 * - SWIFT / BIC (ISO 9362 8 or 11 chars)
 * - US ABA Routing Transit Number (checksum mod-10)
 * - Indian GSTIN (15-char structure + Luhn mod-36 checksum)
 * - Indian PAN (10-char structure)
 * - Indian UPI ID (handle@psp)
 * - UAE TRN (15 digits, starts with 100)
 * - Singapore UEN (Unique Entity Number format)
 * - EAN-13 / UPC-A Barcode (Mod-10 check digit)
 * - HSN / SAC codes (4, 6, or 8 digits)
 * - Postal codes for supported countries (IN, AE, SG, OM, BH, US)
 * - HTTPS URL validation
 */

// 1. Mod-97 IBAN Validator
export function validateIBAN(iban: string): boolean {
  if (!iban) return false;
  const clean = iban.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) return false;

  // Move first 4 characters to end
  const rearranged = clean.slice(4) + clean.slice(0, 4);

  // Convert letters to digits (A=10, B=11 ... Z=35)
  let numeric = "";
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numeric += (code - 55).toString();
    } else {
      numeric += rearranged[i];
    }
  }

  // Large integer mod-97 in chunks
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = remainder.toString() + numeric.substring(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }

  return remainder === 1;
}

// 2. Indian IFSC (4 alpha + '0' + 6 alpha/numeric)
export function validateIFSC(ifsc: string): boolean {
  if (!ifsc) return false;
  const clean = ifsc.trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean);
}

// 3. SWIFT / BIC (8 or 11 characters)
export function validateSWIFT(swift: string): boolean {
  if (!swift) return false;
  const clean = swift.trim().toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean);
}

// 4. US ABA Routing Transit Number (9 digits with weighted checksum)
export function validateUSRoutingNumber(routing: string): boolean {
  if (!routing) return false;
  const clean = routing.trim();
  if (!/^\d{9}$/.test(clean)) return false;

  const d = clean.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

// 5. Indian GSTIN (15 chars: 2 state + 10 PAN + 1 entity + 'Z' + 1 checksum)
export function validateGSTIN(gstin: string): boolean {
  if (!gstin) return false;
  const clean = gstin.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(clean)) {
    return false;
  }

  // Mod-36 Luhn-like check digit validation
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = chars.indexOf(clean[i]);
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 36) + (addend % 36);
    sum += addend;
  }
  const remainder = sum % 36;
  const checkCodePoint = (36 - remainder) % 36;
  return clean[14] === chars[checkCodePoint];
}

// 6. Indian PAN (5 alpha + 4 numeric + 1 alpha)
export function validatePAN(pan: string): boolean {
  if (!pan) return false;
  const clean = pan.trim().toUpperCase();
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean);
}

// 7. Indian UPI ID
export function validateUPI(upi: string): boolean {
  if (!upi) return false;
  const clean = upi.trim().toLowerCase();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(clean);
}

// 8. UAE TRN (Tax Registration Number: 15 digits starting with 100)
export function validateUAETRN(trn: string): boolean {
  if (!trn) return false;
  const clean = trn.replace(/[\s-]/g, "");
  return /^100\d{12}$/.test(clean);
}

// 9. Singapore UEN (Unique Entity Number)
export function validateSingaporeUEN(uen: string): boolean {
  if (!uen) return false;
  const clean = uen.trim().toUpperCase();
  // Standard formats:
  // (A) Businesses: 9 digits (nnnnnnnnX)
  // (B) Local companies: 9 or 10 digits (YYYYnnnnnX)
  // (C) Other entities: TyyPQnnnnX
  if (/^\d{8}[A-Z]$/.test(clean)) return true;
  if (/^(19|20)\d{7}[A-Z]$/.test(clean)) return true;
  if (/^[TRST]\d{2}[A-Z]{2}\d{4}[A-Z]$/.test(clean)) return true;
  return false;
}

// 10. Barcode (EAN-13, EAN-8, UPC-A with Mod-10 Check Digit)
export function validateBarcode(barcode: string): boolean {
  if (!barcode) return false;
  const clean = barcode.trim();
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(clean)) return false;

  // EAN-13 / UPC-A mod 10 check
  const digits = clean.split("").map(Number);
  const checkDigit = digits.pop()!;
  const len = digits.length;

  let sum = 0;
  for (let i = 0; i < len; i++) {
    // Alternating weight 3 and 1 from right to left
    const weight = (len - i) % 2 === 1 ? 3 : 1;
    sum += digits[i] * weight;
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return calculatedCheck === checkDigit;
}

// 11. HSN / SAC (4, 6, or 8 digits)
export function validateHSN(hsn: string): boolean {
  if (!hsn) return false;
  const clean = hsn.trim();
  return /^\d{4}$|^\d{6}$|^\d{8}$/.test(clean);
}

// 12. Postal Code per Country
export function validatePostalCode(postalCode: string, countryCode: string): boolean {
  if (!postalCode || !countryCode) return false;
  const clean = postalCode.trim().toUpperCase();
  const country = countryCode.trim().toUpperCase();

  switch (country) {
    case "IN":
      return /^[1-9][0-9]{5}$/.test(clean); // 6 digits, non-zero start
    case "US":
      return /^\d{5}(-\d{4})?$/.test(clean); // 5 digits or 5+4
    case "SG":
      return /^\d{6}$/.test(clean); // 6 digits
    case "AE":
      // UAE has no official postal code system; '00000', PO Box, or 5 digits are accepted
      return /^(\d{3,6}|P\.?O\.?\s*BOX\s*\d+|00000)$/i.test(clean);
    case "OM":
      return /^\d{3}$/.test(clean); // 3 digits
    case "BH":
      return /^\d{3,4}$/.test(clean); // 3 or 4 digits
    default:
      return clean.length >= 2 && clean.length <= 16;
  }
}

// 13. HTTPS URL Validator
export function validateHTTPSUrl(url: string): boolean {
  if (!url) return false;
  const clean = url.trim();
  if (clean.length > 2048) return false;
  try {
    const parsed = new URL(clean);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

