/**
 * Trado Worldwide Tax, Regions & Currency Unit Test Suite (Phase 3: Gaps G7, G8)
 *
 * Verifies:
 * 1. Worldwide Country Defaults & Minor Unit Naming (Gap G8)
 * 2. 3-Decimal Currency Minor Unit Precision (BHD, OMR, KWD)
 * 3. Database-Backed Tax Regimes Catalog & Metadata (Gap G7)
 * 4. Multi-Slab & Line-Level Tax Calculation
 * 5. Intra-State vs Inter-State India GST Split (CGST+SGST vs IGST)
 * 6. Worldwide Tax Regimes (Bahrain 10%, UAE 5%, Saudi 15%, UK 20%, US Sales Tax 7%)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCountryDefaults } from "../../constants/countryDefaults.js";
import { DEFAULT_TAX_REGIMES } from "../../constants/catalogs.js";
import { calculateTax, getTaxRegime } from "../../services/taxCalculation.js";
import { toMinor, fromMinor, getCurrencyDecimals, Money } from "../../services/money.js";

describe("Phase 3 — Worldwide Tax, Regions & Currency (Unit)", () => {
  describe("1. Country Defaults & Minor Unit Naming (Gap G8)", () => {
    it("provides minor unit names and symbols across all canonical countries", () => {
      const expected: Record<string, { currency: string; decimals: number; minor: string; minorPlural: string; symbol: string }> = {
        IN: { currency: "INR", decimals: 2, minor: "paisa", minorPlural: "paise", symbol: "₹" },
        AE: { currency: "AED", decimals: 2, minor: "fils", minorPlural: "fils", symbol: "AED" },
        OM: { currency: "OMR", decimals: 3, minor: "baisa", minorPlural: "baisa", symbol: "OMR" },
        BH: { currency: "BHD", decimals: 3, minor: "fils", minorPlural: "fils", symbol: "BD" },
        SG: { currency: "SGD", decimals: 2, minor: "cent", minorPlural: "cents", symbol: "S$" },
        US: { currency: "USD", decimals: 2, minor: "cent", minorPlural: "cents", symbol: "$" },
        SA: { currency: "SAR", decimals: 2, minor: "halala", minorPlural: "halalas", symbol: "SAR" },
        GB: { currency: "GBP", decimals: 2, minor: "penny", minorPlural: "pence", symbol: "£" },
        DE: { currency: "EUR", decimals: 2, minor: "cent", minorPlural: "cents", symbol: "€" },
        QA: { currency: "QAR", decimals: 2, minor: "dirham", minorPlural: "dirhams", symbol: "QR" },
        KW: { currency: "KWD", decimals: 3, minor: "fils", minorPlural: "fils", symbol: "KD" },
      };

      for (const [code, exp] of Object.entries(expected)) {
        const def = getCountryDefaults(code);
        assert.ok(def, `Country definition for ${code} must exist`);
        assert.equal(def.currencyCode, exp.currency, `${code} currencyCode mismatch`);
        assert.equal(def.currencyDecimals, exp.decimals, `${code} currencyDecimals mismatch`);
        assert.equal(def.minorUnitName, exp.minor, `${code} minorUnitName mismatch`);
        assert.equal(def.minorUnitNamePlural, exp.minorPlural, `${code} minorUnitNamePlural mismatch`);
        assert.equal(def.currencySymbol, exp.symbol, `${code} currencySymbol mismatch`);
      }
    });

    it("includes sub-national administrative divisions for multi-region countries", () => {
      // Bahrain governorates
      const bh = getCountryDefaults("BH");
      assert.ok(bh.states && bh.states.length === 4, "Bahrain must have 4 governorates");
      assert.ok(bh.states.some((s) => s.code === "CAP" && s.name.includes("Capital")));

      // UAE Emirates
      const ae = getCountryDefaults("AE");
      assert.ok(ae.states && ae.states.length === 7, "UAE must have 7 emirates");
      assert.ok(ae.states.some((s) => s.code === "DU" && s.name === "Dubai"));

      // Oman governorates
      const om = getCountryDefaults("OM");
      assert.ok(om.states && om.states.length >= 10, "Oman must have governorates defined");
      assert.ok(om.states.some((s) => s.code === "MC" && s.name === "Muscat"));

      // Saudi Arabia provinces
      const sa = getCountryDefaults("SA");
      assert.ok(sa.states && sa.states.length >= 5, "Saudi Arabia must have provinces defined");
      assert.ok(sa.states.some((s) => s.code === "RIY" && s.name === "Riyadh"));
    });

    it("falls back safely to India (IN) for unknown country codes", () => {
      const def = getCountryDefaults("XX");
      assert.equal(def.countryCode, "IN");
      assert.equal(def.currencyCode, "INR");
      assert.equal(def.minorUnitName, "paisa");
    });
  });

  describe("2. 3-Decimal Currency Minor Unit Precision (Gap G8)", () => {
    it("converts 3-decimal currencies (BHD, OMR, KWD) with exact integer fils/baisa arithmetic", () => {
      assert.equal(getCurrencyDecimals("BHD"), 3);
      assert.equal(getCurrencyDecimals("OMR"), 3);
      assert.equal(getCurrencyDecimals("KWD"), 3);

      // Bahrain: 1.500 BHD = 1500 fils
      assert.equal(toMinor(1.5, "BHD"), 1500);
      assert.equal(fromMinor(1500, "BHD"), 1.5);

      // Bahrain: 0.005 BHD = 5 fils
      assert.equal(toMinor(0.005, "BHD"), 5);
      assert.equal(fromMinor(5, "BHD"), 0.005);

      // Oman: 12.750 OMR = 12750 baisa
      assert.equal(toMinor(12.75, "OMR"), 12750);
      assert.equal(fromMinor(12750, "OMR"), 12.75);

      // Kuwait: 100.250 KWD = 100250 fils
      assert.equal(toMinor(100.25, "KWD"), 100250);
      assert.equal(fromMinor(100250, "KWD"), 100.25);
    });

    it("rounds currency amounts using correct exponent", () => {
      assert.equal(Money.amount(1.23456, "BHD"), 1.235);
      assert.equal(Money.amount(1.23456, "INR"), 1.23);
      assert.equal(Money.amount(1.23456, "JPY"), 1);
    });
  });

  describe("3. Database-Backed Tax Regimes Catalog & Metadata (Gap G7)", () => {
    it("defines complete structured metadata for canonical tax regimes", () => {
      const codes = DEFAULT_TAX_REGIMES.map((r) => r.code);
      assert.ok(codes.includes("IN_GST"));
      assert.ok(codes.includes("AE_VAT"));
      assert.ok(codes.includes("BH_VAT"));
      assert.ok(codes.includes("OM_VAT"));
      assert.ok(codes.includes("SG_GST"));
      assert.ok(codes.includes("US_SALES_TAX"));
      assert.ok(codes.includes("SA_VAT"));
      assert.ok(codes.includes("GB_VAT"));
      assert.ok(codes.includes("EU_VAT"));
      assert.ok(codes.includes("NONE"));

      for (const regime of DEFAULT_TAX_REGIMES) {
        assert.ok(regime.code, "Must have code");
        assert.ok(regime.country, "Must have country");
        assert.ok(regime.name, "Must have name");
        assert.ok(["gst", "vat", "sales_tax", "none"].includes(regime.taxType), "Valid taxType");
        assert.ok(typeof regime.defaultRate === "number", "defaultRate is number");
        assert.ok(Array.isArray(regime.rates), "rates is array");
        assert.ok(regime.labels.taxName, "taxName is present");
        assert.ok(regime.labels.registrationLabel, "registrationLabel is present");
        assert.ok(regime.labels.invoiceTitle, "invoiceTitle is present");
      }
    });

    it("resolves tax regime from cache or defaults", async () => {
      const inGst = await getTaxRegime("IN_GST");
      assert.ok(inGst);
      assert.equal(inGst.taxType, "gst");
      assert.equal(inGst.supportsInterState, true);

      const bhVat = await getTaxRegime("BH_VAT");
      assert.ok(bhVat);
      assert.equal(bhVat.taxType, "vat");
      assert.equal(bhVat.defaultRate, 10);
    });
  });

  describe("4. Multi-Slab & Line-Level Tax Calculation (Gap G7)", () => {
    it("computes multi-slab line-level tax with rate-wise breakdown", () => {
      // 3 items with distinct tax rates:
      // Line 1: ₹1,000 at 0% (zero-rated / food) -> tax ₹0
      // Line 2: ₹2,000 at 5% (packaged goods) -> tax ₹100
      // Line 3: ₹5,000 at 18% (electronics) -> tax ₹900
      const lines = [
        { taxableAmount: 1000, taxRatePercent: 0 },
        { taxableAmount: 2000, taxRatePercent: 5 },
        { taxableAmount: 5000, taxRatePercent: 18 },
      ];

      const result = calculateTax({
        taxRegimeCode: "IN_GST",
        country: "IN",
        subTotal: 8000,
        lines,
        isInterState: false,
      });

      assert.equal(result.taxAmount, 1000, "Total tax must be ₹100 + ₹900 = ₹1,000");
      assert.equal(result.totalWithTax, 9000, "Gross total must be ₹9,000");
      assert.equal(result.taxRatePercent, 12.5, "Effective rate: 1000/8000 = 12.5%");

      // Breakdown: 5% split into CGST 2.5% + SGST 2.5%, 18% split into CGST 9% + SGST 9%
      assert.equal(result.breakdown.length, 4, "Must have 4 breakdown entries for intra-state GST (2 slabs * 2)");

      const cgst25 = result.breakdown.find((b) => b.name === "CGST (2.5%)");
      const sgst25 = result.breakdown.find((b) => b.name === "SGST (2.5%)");
      assert.ok(cgst25 && cgst25.amount === 50);
      assert.ok(sgst25 && sgst25.amount === 50);

      const cgst9 = result.breakdown.find((b) => b.name === "CGST (9%)");
      const sgst9 = result.breakdown.find((b) => b.name === "SGST (9%)");
      assert.ok(cgst9 && cgst9.amount === 450);
      assert.ok(sgst9 && sgst9.amount === 450);

      // Conservation invariant: sum of breakdown amounts === total taxAmount
      const sumBreakdown = result.breakdown.reduce((sum, b) => sum + b.amount, 0);
      assert.equal(sumBreakdown, result.taxAmount, "Breakdown sum must exactly equal taxAmount");
    });

    it("respects item-level tax exemption (isTaxable = false)", () => {
      const lines = [
        { taxableAmount: 500, taxRatePercent: 18, isTaxable: false },
        { taxableAmount: 500, taxRatePercent: 18, isTaxable: true },
      ];

      const result = calculateTax({
        taxRegimeCode: "IN_GST",
        country: "IN",
        subTotal: 1000,
        lines,
      });

      assert.equal(result.taxAmount, 90, "Only taxable line should be taxed (500 * 18% = 90)");
    });
  });

  describe("5. Intra-State vs Inter-State India GST Split (Gap G7)", () => {
    it("splits intra-state GST into equal CGST and SGST", () => {
      const result = calculateTax({
        taxRegimeCode: "IN_GST",
        country: "IN",
        subTotal: 10000,
        taxRatePercent: 18,
        isInterState: false,
      });

      assert.equal(result.taxAmount, 1800);
      assert.equal(result.breakdown.length, 2);

      const cgst = result.breakdown.find((b) => b.name.includes("CGST"));
      const sgst = result.breakdown.find((b) => b.name.includes("SGST"));
      assert.ok(cgst && cgst.amount === 900 && cgst.rate === 9);
      assert.ok(sgst && sgst.amount === 900 && sgst.rate === 9);
      assert.equal(result.taxSnapshot.isInterState, false);
    });

    it("applies single IGST for inter-state transactions", () => {
      const result = calculateTax({
        taxRegimeCode: "IN_GST",
        country: "IN",
        subTotal: 10000,
        taxRatePercent: 18,
        isInterState: true,
      });

      assert.equal(result.taxAmount, 1800);
      assert.equal(result.breakdown.length, 1);

      const igst = result.breakdown[0];
      assert.equal(igst.name, "IGST (18%)");
      assert.equal(igst.rate, 18);
      assert.equal(igst.amount, 1800);
      assert.equal(result.taxSnapshot.isInterState, true);
    });
  });

  describe("6. Worldwide Tax Regimes (Gap G7)", () => {
    it("calculates Bahrain 10% VAT with standard labels", () => {
      const result = calculateTax({
        taxRegimeCode: "BH_VAT",
        country: "BH",
        subTotal: 100, // 100.000 BHD
      });

      assert.equal(result.taxRatePercent, 10);
      assert.equal(result.taxAmount, 10);
      assert.equal(result.totalWithTax, 110);
      assert.equal(result.taxSnapshot.labels?.taxName, "VAT");
      assert.equal(result.taxSnapshot.labels?.registrationLabel, "TRN");
      assert.equal(result.taxSnapshot.labels?.invoiceTitle, "Tax Invoice");
    });

    it("calculates UAE 5% VAT", () => {
      const result = calculateTax({
        taxRegimeCode: "AE_VAT",
        country: "AE",
        subTotal: 500,
      });

      assert.equal(result.taxRatePercent, 5);
      assert.equal(result.taxAmount, 25);
      assert.equal(result.totalWithTax, 525);
    });

    it("calculates Saudi Arabia 15% VAT", () => {
      const result = calculateTax({
        taxRegimeCode: "SA_VAT",
        country: "SA",
        subTotal: 1000,
      });

      assert.equal(result.taxRatePercent, 15);
      assert.equal(result.taxAmount, 150);
      assert.equal(result.totalWithTax, 1150);
    });

    it("calculates UK 20% VAT with VAT Invoice title", () => {
      const result = calculateTax({
        taxRegimeCode: "GB_VAT",
        country: "GB",
        subTotal: 200,
      });

      assert.equal(result.taxRatePercent, 20);
      assert.equal(result.taxAmount, 40);
      assert.equal(result.taxSnapshot.labels?.invoiceTitle, "VAT Invoice");
    });

    it("handles tax-exempt (NONE) operations returning 0 tax and Bill of Supply", () => {
      const result = calculateTax({
        taxRegimeCode: "NONE",
        country: "GLOBAL",
        subTotal: 1500,
      });

      assert.equal(result.taxRatePercent, 0);
      assert.equal(result.taxAmount, 0);
      assert.equal(result.totalWithTax, 1500);
      assert.equal(result.taxSnapshot.labels?.invoiceTitle, "Bill of Supply");
    });
  });
});
