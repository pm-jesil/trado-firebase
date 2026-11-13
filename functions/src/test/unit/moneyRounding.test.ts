import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roundTo, round2, roundCurrency } from "../../services/money.js";
import { calculateTax } from "../../services/taxCalculation.js";

describe("Commercial Money Rounding (Half Away From Zero)", () => {
  it("rounds exact ties and floating-point boundary cases correctly (2 decimals)", () => {
    assert.equal(roundTo(1.005, 2), 1.01);
    assert.equal(roundTo(2.675, 2), 2.68);
    assert.equal(roundTo(10.005, 2), 10.01);
    assert.equal(roundTo(0.285, 2), 0.29);
    assert.equal(roundTo(35.255, 2), 35.26);
  });

  it("rounds negative exact ties away from zero correctly (preserves sign symmetry)", () => {
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(-0.125, 2), -0.13);
    assert.equal(roundTo(-1.005, 2), -1.01);
    assert.equal(roundTo(-2.675, 2), -2.68);
    assert.equal(roundTo(-10.005, 2), -10.01);
    assert.equal(roundTo(-0.285, 2), -0.29);
  });

  it("handles 0 decimals (integers / currencies like JPY, KRW)", () => {
    assert.equal(roundTo(2.5, 0), 3);
    assert.equal(roundTo(2.49, 0), 2);
    assert.equal(roundTo(-2.49, 0), -2);
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(100.5, 0), 101);
    assert.equal(roundTo(-100.5, 0), -101);
  });

  it("handles 3 decimals (currencies like OMR, BHD, KWD)", () => {
    assert.equal(roundTo(1.0005, 3), 1.001);
    assert.equal(roundTo(-1.0005, 3), -1.001);
    assert.equal(roundTo(0.1235, 3), 0.124);
    assert.equal(roundTo(-0.1235, 3), -0.124);
    assert.equal(roundTo(15.5555, 3), 15.556);
    assert.equal(roundTo(-15.5555, 3), -15.556);
  });

  it("handles large financial values safely without precision loss", () => {
    assert.equal(roundTo(9876543210.125, 2), 9876543210.13);
    assert.equal(roundTo(-9876543210.125, 2), -9876543210.13);
  });

  it("guarantees tax-split parity (CGST + SGST === total tax exactly)", () => {
    // 18% GST on Rs 100.05
    const res = calculateTax({
      subTotal: 100.05,
      taxRegimeCode: "IN_GST",
      country: "IN",
      taxRatePercent: 18,
      isInterState: false,
    });
    const cgst = res.breakdown.find((b) => b.name.startsWith("CGST"))?.amount || 0;
    const sgst = res.breakdown.find((b) => b.name.startsWith("SGST"))?.amount || 0;
    assert.equal(round2(cgst + sgst), res.taxAmount);
    assert.equal(res.taxAmount, 18.01);
    assert.equal(cgst, 9.01);
    assert.equal(sgst, 9.0);
  });

  it("handles scientific notation strings without producing NaN (C-1 defect fix)", () => {
    assert.equal(roundTo(1e-7, 2), 0);
    assert.equal(roundTo(5e-7, 2), 0);
    assert.equal(roundTo(-1e-7, 2), 0);
    assert.equal(roundTo(1e21, 2), 1e21);
    assert.equal(roundTo(0.1 + 0.2 - 0.3, 2), 0);
    assert.equal(roundTo(100 - 99.99 - 0.01, 2), 0);
    assert.equal(Object.is(roundTo(-0, 0), -0), false);
    assert.equal(roundTo(-0, 0), 0);
  });

  it("satisfies mathematical property tests across decimal exponents", () => {
    const testDecimals = [0, 2, 3, 4];
    const testValues = [
      0, 1.005, -1.005, 2.675, -2.675, 10.005, 0.285, 35.255,
      1e-7, -1e-7, 0.1 + 0.2 - 0.3, 9876543210.125, -9876543210.125,
      42.4242, -42.4242, 100.5, -100.5,
    ];

    for (const d of testDecimals) {
      const halfUnit = 0.5 * Math.pow(10, -d) + 1e-11;

      for (const val of testValues) {
        const rounded = roundTo(val, d);

        // 1. Finite in -> finite out
        assert.equal(Number.isFinite(rounded), true, `Value ${val} rounded to ${d} must be finite`);

        // 2. Sign symmetry: round(-x) === -round(x) (0 normalized to +0)
        const roundedNeg = roundTo(-val, d);
        assert.equal(roundedNeg, rounded === 0 ? 0 : -rounded, `Sign symmetry failed for ${val} at ${d} decimals`);

        // 3. Idempotent: round(round(x)) === round(x)
        assert.equal(roundTo(rounded, d), rounded, `Idempotence failed for ${val} at ${d} decimals`);

        // 4. Maximum error <= half a unit (for values within standard range)
        if (Math.abs(val) < 1e12) {
          const diff = Math.abs(rounded - val);
          assert.equal(diff <= halfUnit, true, `Error ${diff} > ${halfUnit} for ${val} at ${d} decimals`);
        }
      }
    }
  });

  it("currency helper roundCurrency respects ISO 4217 minor unit exponents", () => {
    assert.equal(roundCurrency(10.005, "INR"), 10.01);
    assert.equal(roundCurrency(10.005, "USD"), 10.01);
    assert.equal(roundCurrency(10.005, "AED"), 10.01);
    assert.equal(roundCurrency(10.0005, "OMR"), 10.001);
    assert.equal(roundCurrency(10.0005, "BHD"), 10.001);
    assert.equal(roundCurrency(100.5, "JPY"), 101);
  });
});

