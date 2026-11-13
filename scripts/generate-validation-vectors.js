/**
 * Generate Field Validation Test Vectors
 * 
 * Emits canonical test vectors for cross-language validation parity (TypeScript backend / Dart Flutter).
 * 
 * Outputs: docs/generated/field-validation-vectors.json
 */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.resolve(ROOT_DIR, "docs/generated/field-validation-vectors.json");

const vectors = {
  version: "1.0.0",
  description: "Cross-language field validation test vectors (TypeScript backend / Dart Flutter frontend).",
  ibanVectors: [
    { input: "GB82WEST12345698765432", isValid: true, note: "Valid UK IBAN" },
    { input: "AE640330000000000001234", isValid: true, note: "Valid UAE IBAN" },
    { input: "GB82WEST12345698765433", isValid: false, note: "Invalid IBAN checksum" },
    { input: "INVALID_IBAN_STRING", isValid: false, note: "Non-IBAN characters" },
  ],
  ifscVectors: [
    { input: "HDFC0000001", isValid: true, note: "Standard HDFC Bank IFSC" },
    { input: "SBIN0001234", isValid: true, note: "Standard SBI IFSC" },
    { input: "HDFC1000001", isValid: false, note: "Fifth character must be 0" },
    { input: "HDFC00000", isValid: false, note: "Too short (must be 11 chars)" },
    { input: "HDFC00000001", isValid: false, note: "Too long" },
  ],
  swiftVectors: [
    { input: "HDFCINBB", isValid: true, note: "8-char SWIFT code" },
    { input: "HDFCINBBXXX", isValid: true, note: "11-char SWIFT code with branch" },
    { input: "HDFC1NBB", isValid: false, note: "Non-alpha characters in bank/country code" },
    { input: "HDFC", isValid: false, note: "Too short" },
  ],
  usRoutingVectors: [
    { input: "021000021", isValid: true, note: "Valid Chase NY routing number" },
    { input: "026009593", isValid: true, note: "Valid Bank of America routing number" },
    { input: "021000022", isValid: false, note: "Invalid checksum" },
    { input: "12345678", isValid: false, note: "Not 9 digits" },
  ],
  gstinVectors: [
    { input: "27AABCU9603R1ZN", isValid: true, note: "Valid Maharashtra GSTIN" },
    { input: "29AABCS1429B1ZQ", isValid: true, note: "Valid Karnataka GSTIN" },
    { input: "27AABCU9603R1ZM", isValid: false, note: "Invalid check digit" },
    { input: "27AABCU9603R1Z", isValid: false, note: "Too short" },
  ],
  panVectors: [
    { input: "AABCU9603R", isValid: true, note: "Valid corporate PAN" },
    { input: "ABCDE1234F", isValid: true, note: "Valid standard PAN" },
    { input: "12345ABCDE", isValid: false, note: "Inverted structure" },
    { input: "ABCDE12345", isValid: false, note: "Ends with digit instead of letter" },
  ],
  upiVectors: [
    { input: "business@okicici", isValid: true, note: "Standard ICICI VPA" },
    { input: "merchant.hub@okhdfcbank", isValid: true, note: "VPA with dot" },
    { input: "not-a-vpa", isValid: false, note: "Missing handle @" },
  ],
  uaeTrnVectors: [
    { input: "100123456789012", isValid: true, note: "Valid UAE 15-digit TRN starting with 100" },
    { input: "200123456789012", isValid: false, note: "Does not start with 100" },
    { input: "1001234567", isValid: false, note: "Too short" },
  ],
  singaporeUenVectors: [
    { input: "199001234A", isValid: true, note: "Local business registration" },
    { input: "200812345G", isValid: true, note: "Company registration" },
    { input: "T08LL1234Z", isValid: true, note: "LLP format" },
    { input: "INVALIDUEN", isValid: false, note: "Malformed structure" },
  ],
  barcodeVectors: [
    { input: "8901234567890", isValid: true, note: "Valid 13-digit EAN with correct check digit" },
    { input: "8901234567897", isValid: false, note: "Invalid check digit" },
    { input: "12345", isValid: false, note: "Invalid length" },
  ],
  postalCodeVectors: [
    { country: "IN", code: "682001", isValid: true, note: "Valid Kerala PIN" },
    { country: "IN", code: "012345", isValid: false, note: "Cannot start with 0" },
    { country: "US", code: "90210", isValid: true, note: "Standard US ZIP" },
    { country: "US", code: "90210-1234", isValid: true, note: "US ZIP+4" },
    { country: "SG", code: "123456", isValid: true, note: "Singapore 6-digit postal code" },
    { country: "OM", code: "111", isValid: true, note: "Oman 3-digit postal code" },
  ],
  httpsUrlVectors: [
    { input: "https://trado.com", isValid: true, note: "Valid HTTPS URL" },
    { input: "https://sub.domain.co/path/to/page", isValid: true, note: "Valid HTTPS URL with path" },
    { input: "http://insecure.com", isValid: false, note: "HTTP is not permitted (HTTPS only)" },
    { input: "ftp://example.com", isValid: false, note: "Non-HTTP protocol" },
    { input: "not-a-url", isValid: false, note: "Malformed string" },
  ],
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(vectors, null, 2), "utf8");
console.log(`✓ Generated field validation vectors: ${OUTPUT_PATH}`);
