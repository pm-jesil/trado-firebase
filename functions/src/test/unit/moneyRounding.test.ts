import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roundTo, Money, assertAmountMatchesCurrency, getCurrencyDecimals } from "../../services/money.js";
import { CURRENCIES, getCurrencyInfo, getExponent } from "../../constants/currencies.js";
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
      currency: "INR",
      subTotal: 100.05,
      taxRegimeCode: "IN_GST",
      country: "IN",
      taxRatePercent: 18,
      isInterState: false,
    });
    const cgst = res.breakdown.find((b) => b.name.startsWith("CGST"))?.amount || 0;
    const sgst = res.breakdown.find((b) => b.name.startsWith("SGST"))?.amount || 0;
    assert.equal(Money.amount(cgst + sgst, "INR"), res.taxAmount);
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

  it("canonical Money.amount respects ISO 4217 minor unit exponents and rounding", () => {
    assert.equal(Money.amount(10.005, "INR"), 10.01);
    assert.equal(Money.amount(10.005, "USD"), 10.01);
    assert.equal(Money.amount(10.005, "AED"), 10.01);
    assert.equal(Money.amount(10.0005, "OMR"), 10.001);
    assert.equal(Money.amount(10.0005, "BHD"), 10.001);
    assert.equal(Money.amount(100.5, "JPY"), 101);

    // Prompt 77D S2 specific assertions:
    // 0.125 BHD (3 decimals) -> 0.125
    assert.equal(Money.amount(0.125, "BHD"), 0.125);
    // 0.125 AED (2 decimals, half away from zero) -> 0.13
    assert.equal(Money.amount(0.125, "AED"), 0.13);
    // Negative values half away from zero
    assert.equal(Money.amount(-0.125, "AED"), -0.13);
    assert.equal(Money.amount(-0.125, "BHD"), -0.125);
    assert.equal(Money.amount(-2.5, "JPY"), -3);

    // Float trap tests (exact ties across exponents)
    assert.equal(Money.amount(1.005, "AED"), 1.01);
    assert.equal(Money.amount(2.675, "AED"), 2.68);
    assert.equal(Money.amount(1.0005, "BHD"), 1.001);
    assert.equal(Money.amount(-1.005, "AED"), -1.01);
    assert.equal(Money.amount(0.5, "JPY"), 1);
  });

  describe("assertAmountMatchesCurrency validation", () => {
    it("accepts valid decimal precision matching currency exponent", () => {
      assert.doesNotThrow(() => assertAmountMatchesCurrency(100, "JPY"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(0, "JPY"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(12.5, "AED"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(12.55, "AED"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(0.125, "BHD"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(1.234, "OMR"));
    });

    it("rejects amounts exceeding currency exponent with AMOUNT_PRECISION_INVALID", () => {
      assert.throws(
        () => assertAmountMatchesCurrency(100.5, "JPY"),
        /AMOUNT_PRECISION_INVALID/
      );
      assert.throws(
        () => assertAmountMatchesCurrency(12.555, "AED"),
        /AMOUNT_PRECISION_INVALID/
      );
      assert.throws(
        () => assertAmountMatchesCurrency(0.1234, "BHD"),
        /AMOUNT_PRECISION_INVALID/
      );
    });

    it("rejects unknown or invalid currencies and non-finite amounts", () => {
      assert.throws(
        () => assertAmountMatchesCurrency(NaN, "AED"),
        /AMOUNT_INVALID/
      );
      assert.throws(
        () => assertAmountMatchesCurrency(Infinity, "AED"),
        /AMOUNT_INVALID/
      );
      assert.throws(
        () => assertAmountMatchesCurrency(10, "UNKNOWN_CURRENCY"),
        /CURRENCY_UNKNOWN/
      );
    });
  });

  describe("Prompt 77D S1 — Currency Table (Unit)", () => {
    it("includes all required currencies with valid definitions", () => {
      const requiredCodes = [
        "INR", "AED", "BHD", "OMR", "KWD", "QAR", "SAR", "JOD", "USD", "EUR",
        "GBP", "SGD", "CAD", "AUD", "JPY", "CNY", "PKR", "BDT", "LKR", "NPR",
        "MYR", "THB", "IDR", "ZAR", "EGP", "TRY", "CHF", "KRW", "VND", "TND", "IQD", "LYD",
      ];

      for (const code of requiredCodes) {
        const info = CURRENCIES[code];
        assert.ok(info, `Currency ${code} must exist in CURRENCIES`);
        assert.equal(info.code, code);
        assert.ok([0, 2, 3, 4].includes(info.exponent), `${code} exponent must be 0, 2, 3, or 4`);
        assert.ok(info.symbol && typeof info.symbol === "string", `${code} must have a symbol string`);
        assert.ok(
          info.symbolPosition === "before" || info.symbolPosition === "after",
          `${code} symbolPosition must be 'before' or 'after'`
        );
        assert.ok(info.major && info.major.name && info.major.plural, `${code} must have major name and plural`);

        if (info.minor) {
          assert.ok(info.minor.name && info.minor.plural, `${code} must have minor name and plural`);
          const expectedPerMajor = Math.pow(10, info.exponent);
          assert.equal(
            info.minor.perMajor,
            expectedPerMajor,
            `${code} minor.perMajor must equal 10^exponent (${expectedPerMajor})`
          );
        }
      }
    });

    it("verifies specific ISO 4217 exponents", () => {
      assert.equal(getExponent("BHD"), 3);
      assert.equal(getExponent("OMR"), 3);
      assert.equal(getExponent("KWD"), 3);
      assert.equal(getExponent("JOD"), 3);
      assert.equal(getExponent("JPY"), 0);
      assert.equal(getExponent("INR"), 2);
      assert.equal(getExponent("AED"), 2);
      assert.equal(getExponent("USD"), 2);
    });

    it("verifies minor unit names and perMajor", () => {
      const bhd = getCurrencyInfo("BHD");
      assert.equal(bhd.minor?.name, "Fils");
      assert.equal(bhd.minor?.perMajor, 1000);

      const aed = getCurrencyInfo("AED");
      assert.equal(aed.minor?.name, "Fils");
      assert.equal(aed.minor?.perMajor, 100);

      const inr = getCurrencyInfo("INR");
      assert.equal(inr.minor?.name, "Paisa");
      assert.equal(inr.minor?.plural, "Paise");
      assert.equal(inr.minor?.perMajor, 100);

      const jpy = getCurrencyInfo("JPY");
      assert.equal(jpy.minor, undefined, "JPY has exponent 0 and no minor unit in circulation");
    });

    it("throws CURRENCY_REQUIRED when currency code is missing or empty", () => {
      assert.throws(() => getCurrencyInfo(""), /CURRENCY_REQUIRED/);
      assert.throws(() => getCurrencyInfo(null as any), /CURRENCY_REQUIRED/);
      assert.throws(() => getCurrencyInfo(undefined as any), /CURRENCY_REQUIRED/);
      assert.throws(() => getExponent("   "), /CURRENCY_REQUIRED/);
    });

    it("throws CURRENCY_UNKNOWN for unrecognized currency codes", () => {
      assert.throws(() => getCurrencyInfo("XYZ"), /CURRENCY_UNKNOWN/);
      assert.throws(() => getCurrencyInfo("INVALID"), /CURRENCY_UNKNOWN/);
      assert.throws(() => getExponent("FOO"), /CURRENCY_UNKNOWN/);
    });

    it("delegates getCurrencyDecimals in money.ts to getExponent", () => {
      assert.equal(getCurrencyDecimals("BHD"), 3);
      assert.equal(getCurrencyDecimals("OMR"), 3);
      assert.equal(getCurrencyDecimals("KWD"), 3);
      assert.equal(getCurrencyDecimals("JOD"), 3);
      assert.equal(getCurrencyDecimals("JPY"), 0);
    });
  });

  describe("Prompt 77D S3b — Multi-document Report Totals by Currency", () => {
    it("sums BHD report total of 3-decimal values without float drift", () => {
      const bhdValues = [1.125, 2.375, 0.005, 10.5];
      const total = Money.sum(bhdValues, "BHD");
      assert.equal(total, 14.005);

      const rowDebits = [0.1001, 0.2004, 0.3005];
      const normalizedDebits = rowDebits.map((d) => Money.amount(d, "BHD"));
      assert.deepEqual(normalizedDebits, [0.1, 0.2, 0.301]);
      assert.equal(Money.sum(normalizedDebits, "BHD"), 0.601);
    });

    it("sums JPY report total of 0-decimal values correctly as integers", () => {
      const jpyValues = [100.4, 250.6, 45.0, 1000.5];
      const normalized = jpyValues.map((v) => Money.amount(v, "JPY"));
      assert.deepEqual(normalized, [100, 251, 45, 1001]);
      const total = Money.sum(normalized, "JPY");
      assert.equal(total, 1397);
    });

    it("sums AED report total of 2-decimal values without float accumulation error", () => {
      const aedValues = [0.1, 0.2, 10.05, 20.655, 30.125];
      const normalized = aedValues.map((v) => Money.amount(v, "AED"));
      assert.deepEqual(normalized, [0.1, 0.2, 10.05, 20.66, 30.13]);
      const total = Money.sum(normalized, "AED");
      assert.equal(total, 61.14);
    });
  });
});


