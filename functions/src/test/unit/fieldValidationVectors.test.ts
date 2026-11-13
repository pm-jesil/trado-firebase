import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateIBAN,
  validateIFSC,
  validateSWIFT,
  validateUSRoutingNumber,
  validateGSTIN,
  validatePAN,
  validateUPI,
  validateUAETRN,
  validateSingaporeUEN,
  validateBarcode,
  validatePostalCode,
  validateHTTPSUrl,
} from "../../validation/validators.js";

describe("Field Validation Vectors & Cross-Language Parity (Part 3)", () => {
  const candidates = [
    path.resolve(process.cwd(), "docs/generated/field-validation-vectors.json"),
    path.resolve(process.cwd(), "../docs/generated/field-validation-vectors.json"),
  ];
  const vectorPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  const raw = fs.readFileSync(vectorPath, "utf8");
  const data = JSON.parse(raw);

  it("validates IBAN Mod-97 vectors", () => {
    for (const v of data.ibanVectors) {
      assert.strictEqual(validateIBAN(v.input), v.isValid, `Failed IBAN vector: ${v.note} (${v.input})`);
    }
  });

  it("validates Indian IFSC vectors", () => {
    for (const v of data.ifscVectors) {
      assert.strictEqual(validateIFSC(v.input), v.isValid, `Failed IFSC vector: ${v.note} (${v.input})`);
    }
  });

  it("validates SWIFT / BIC vectors", () => {
    for (const v of data.swiftVectors) {
      assert.strictEqual(validateSWIFT(v.input), v.isValid, `Failed SWIFT vector: ${v.note} (${v.input})`);
    }
  });

  it("validates US ABA Routing Transit Number vectors", () => {
    for (const v of data.usRoutingVectors) {
      assert.strictEqual(validateUSRoutingNumber(v.input), v.isValid, `Failed US Routing vector: ${v.note} (${v.input})`);
    }
  });

  it("validates Indian GSTIN vectors", () => {
    for (const v of data.gstinVectors) {
      assert.strictEqual(validateGSTIN(v.input), v.isValid, `Failed GSTIN vector: ${v.note} (${v.input})`);
    }
  });

  it("validates Indian PAN vectors", () => {
    for (const v of data.panVectors) {
      assert.strictEqual(validatePAN(v.input), v.isValid, `Failed PAN vector: ${v.note} (${v.input})`);
    }
  });

  it("validates Indian UPI ID vectors", () => {
    for (const v of data.upiVectors) {
      assert.strictEqual(validateUPI(v.input), v.isValid, `Failed UPI vector: ${v.note} (${v.input})`);
    }
  });

  it("validates UAE TRN vectors", () => {
    for (const v of data.uaeTrnVectors) {
      assert.strictEqual(validateUAETRN(v.input), v.isValid, `Failed UAE TRN vector: ${v.note} (${v.input})`);
    }
  });

  it("validates Singapore UEN vectors", () => {
    for (const v of data.singaporeUenVectors) {
      assert.strictEqual(validateSingaporeUEN(v.input), v.isValid, `Failed Singapore UEN vector: ${v.note} (${v.input})`);
    }
  });

  it("validates EAN/UPC barcode vectors", () => {
    for (const v of data.barcodeVectors) {
      assert.strictEqual(validateBarcode(v.input), v.isValid, `Failed Barcode vector: ${v.note} (${v.input})`);
    }
  });

  it("validates postal code vectors", () => {
    for (const v of data.postalCodeVectors) {
      assert.strictEqual(validatePostalCode(v.code, v.country), v.isValid, `Failed Postal code vector: ${v.note} (${v.code})`);
    }
  });

  it("validates HTTPS URL vectors", () => {
    for (const v of data.httpsUrlVectors) {
      assert.strictEqual(validateHTTPSUrl(v.input), v.isValid, `Failed HTTPS URL vector: ${v.note} (${v.input})`);
    }
  });
});

