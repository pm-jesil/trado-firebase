import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeEmail, normalizePhone } from "../../services/contactNormalization.js";

interface ContactVectors {
  emailVectors: Array<{ input: string; expected: string | null; isValid: boolean; note: string }>;
  phoneVectors: Array<{ input: string; region: string; expected: string | null; isValid: boolean; note: string }>;
}

describe("Contact Normalization Vectors & Parity Test", () => {
  const candidates = [
    path.resolve(process.cwd(), "docs/generated/contact-normalization-vectors.json"),
    path.resolve(process.cwd(), "../docs/generated/contact-normalization-vectors.json"),
  ];
  const vectorPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  const raw = fs.readFileSync(vectorPath, "utf8");
  const data = JSON.parse(raw) as ContactVectors;

  describe("Email Normalization Vectors", () => {
    data.emailVectors.forEach((v, idx) => {
      it(`email vector #${idx + 1}: ${v.note} [${v.input}]`, () => {
        if (v.isValid) {
          const result = normalizeEmail(v.input);
          assert.equal(result, v.expected, `Failed email vector: ${v.note} (${v.input})`);
        } else {
          assert.throws(() => normalizeEmail(v.input), `Expected error for invalid email: ${v.note} (${v.input})`);
        }
      });
    });
  });

  describe("Phone Normalization Vectors", () => {
    data.phoneVectors.forEach((v, idx) => {
      it(`phone vector #${idx + 1} (${v.region}): ${v.note} [${v.input}]`, () => {
        if (v.isValid) {
          const result = normalizePhone(v.input, v.region);
          assert.equal(result, v.expected, `Failed phone vector: ${v.note} (${v.input})`);
        } else {
          assert.throws(() => normalizePhone(v.input, v.region), `Expected error for invalid phone: ${v.note} (${v.input})`);
        }
      });
    });
  });
});
