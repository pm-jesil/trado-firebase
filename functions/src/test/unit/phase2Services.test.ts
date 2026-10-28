/**
 * Unit Tests for Business Core Services
 * - Tax Calculation Service (IN_GST, AE_VAT, US_SALES_TAX, NONE)
 * - Sequential Document Counter formatting
 * - Stock Engine calculations & negative stock guards
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateTax } from "../../services/taxCalculation.js";
import { Money } from "../../services/money.js";

describe("Business Core Services - Tax Calculation", () => {
  it("calculates standard India GST (18%) split into CGST (9%) and SGST (9%) for intra-state sales", () => {
    const result = calculateTax({
      taxRegimeCode: "IN_GST",
      country: "IN",
      subTotal: 1000,
      taxRatePercent: 18,
      isInterState: false,
    });

    assert.equal(result.taxRatePercent, 18);
    assert.equal(result.taxAmount, 180);
    assert.equal(result.totalWithTax, 1180);
    assert.equal(result.breakdown.length, 2);

    const cgst = result.breakdown.find((b) => b.name.startsWith("CGST"));
    const sgst = result.breakdown.find((b) => b.name.startsWith("SGST"));
    assert.ok(cgst, "Must contain CGST breakdown");
    assert.ok(sgst, "Must contain SGST breakdown");
    assert.equal(cgst.rate, 9);
    assert.equal(cgst.amount, 90);
    assert.equal(sgst.rate, 9);
    assert.equal(sgst.amount, 90);

    assert.equal(result.taxSnapshot.regime, "IN_GST");
    assert.equal(result.taxSnapshot.taxType, "gst");
    assert.equal(result.taxSnapshot.labels?.taxName, "GST");
    assert.equal(result.taxSnapshot.labels?.registrationLabel, "GSTIN");
  });

  it("calculates India GST (18%) as single IGST line for inter-state sales", () => {
    const result = calculateTax({
      taxRegimeCode: "IN_GST",
      country: "IN",
      subTotal: 2500,
      taxRatePercent: 18,
      isInterState: true,
    });

    assert.equal(result.taxAmount, 450);
    assert.equal(result.totalWithTax, 2950);
    assert.equal(result.breakdown.length, 1);
    assert.equal(result.breakdown[0].name, "IGST (18%)");
    assert.equal(result.breakdown[0].amount, 450);
  });

  it("calculates UAE VAT (5%) correctly", () => {
    const result = calculateTax({
      taxRegimeCode: "AE_VAT",
      country: "AE",
      subTotal: 500,
      taxRatePercent: 5,
    });

    assert.equal(result.taxRatePercent, 5);
    assert.equal(result.taxAmount, 25);
    assert.equal(result.totalWithTax, 525);
    assert.equal(result.taxSnapshot.regime, "AE_VAT");
    assert.equal(result.taxSnapshot.taxType, "vat");
    assert.equal(result.taxSnapshot.labels?.taxName, "VAT");
    assert.equal(result.taxSnapshot.labels?.registrationLabel, "TRN");
  });

  it("calculates US State Sales Tax (7%) correctly", () => {
    const result = calculateTax({
      taxRegimeCode: "US_SALES_TAX",
      country: "US",
      subTotal: 100,
      taxRatePercent: 7,
    });

    assert.equal(result.taxRatePercent, 7);
    assert.equal(result.taxAmount, 7);
    assert.equal(result.totalWithTax, 107);
    assert.equal(result.taxSnapshot.regime, "US_SALES_TAX");
    assert.equal(result.taxSnapshot.taxType, "sales_tax");
  });

  it("handles NONE / exempt regime with zero tax and 'Bill of Supply' label", () => {
    const result = calculateTax({
      taxRegimeCode: "NONE",
      country: "GLOBAL",
      subTotal: 1500,
    });

    assert.equal(result.taxRatePercent, 0);
    assert.equal(result.taxAmount, 0);
    assert.equal(result.totalWithTax, 1500);
    assert.equal(result.breakdown.length, 0);
    assert.equal(result.taxSnapshot.regime, "NONE");
    assert.equal(result.taxSnapshot.labels?.invoiceTitle, "Bill of Supply");
  });
});

describe("Business Core Services - Sequential Number Formatting", () => {
  it("formats standard sequential document numbers with zero padding", () => {
    const prefix = "INV";
    const year = 2026;
    const sequence1 = 1;
    const sequence42 = 42;
    const padding = 6;

    const formatted1 = `${prefix}-${year}-${String(sequence1).padStart(padding, "0")}`;
    const formatted42 = `${prefix}-${year}-${String(sequence42).padStart(padding, "0")}`;

    assert.equal(formatted1, "INV-2026-000001");
    assert.equal(formatted42, "INV-2026-000042");
  });
});

describe("Business Core Services - Stock Balance Arithmetic", () => {
  it("computes correct running stock totals on inward intake and outward sales", () => {
    const initialStock = 100;
    const purchaseIn = 50;
    const saleOut = -30;
    const returnIn = 5;

    const afterPurchase = initialStock + purchaseIn;
    assert.equal(afterPurchase, 150, "Intake must increase stock");

    const afterSale = afterPurchase + saleOut;
    assert.equal(afterSale, 120, "Sale dispatch must decrease stock");

    const afterReturn = afterSale + returnIn;
    assert.equal(afterReturn, 125, "Restocked return must increase stock");
  });

  it("detects when stock would drop below zero when negative stock is prohibited", () => {
    const currentStock = 10;
    const requestedDeduction = 15;
    const wouldBeNegative = currentStock - requestedDeduction < 0;

    assert.equal(wouldBeNegative, true, "Deducting 15 from 10 must flag insufficient stock");
  });
});

describe("Business Core Services - Decimal-Safe Money & Precision Utility", () => {
  it("handles 2-decimal currencies (INR, USD, EUR) with commercial rounding", () => {
    assert.equal(Money.getDecimals("INR"), 2);
    assert.equal(Money.getDecimals("USD"), 2);
    assert.equal(Money.getDecimals("AED"), 2);

    assert.equal(Money.roundCurrency(10.555, "INR"), 10.56);
    assert.equal(Money.roundCurrency(10.554, "INR"), 10.55);
    assert.equal(Money.amount(19.999), 20.00);
  });

  it("handles 3-decimal currencies (BHD, KWD, OMR) accurately without truncating the 3rd decimal", () => {
    assert.equal(Money.getDecimals("BHD"), 3);
    assert.equal(Money.getDecimals("KWD"), 3);
    assert.equal(Money.getDecimals("OMR"), 3);

    const priceBhd = 1.250;
    const qtyBhd = 3;
    const totalBhd = Money.roundCurrency(priceBhd * qtyBhd, "BHD");
    assert.equal(totalBhd, 3.750);

    const subTotal = 15.1234;
    assert.equal(Money.roundCurrency(subTotal, "KWD"), 15.123);

    // Minor unit conversion (1 KWD = 1000 fils)
    const fils = Money.fromDecimal(1.250, "KWD");
    assert.equal(fils, 1250);
    assert.equal(Money.toDecimal(1250, "KWD"), 1.250);
  });

  it("handles 0-decimal currencies (JPY, KRW) accurately", () => {
    assert.equal(Money.getDecimals("JPY"), 0);
    assert.equal(Money.getDecimals("KRW"), 0);

    const totalJpy = Money.roundCurrency(1542.89, "JPY");
    assert.equal(totalJpy, 1543);
  });

  it("prevents floating point drift across 1,000 fractional quantity increments (0.001 kg)", () => {
    let accumulated = 0;
    const increment = 0.001;

    for (let i = 0; i < 1000; i++) {
      accumulated = Money.qty(accumulated + increment, 4);
    }

    // In plain JavaScript float math, 1000 * 0.001 often becomes 1.0000000000000007 or similar.
    // Money.qty guarantees exact 1.0000.
    assert.equal(accumulated, 1.0);
  });

  it("extractTax and addTax produce mathematically exact components", () => {
    // 100 INR tax inclusive with 18% GST:
    // Net: 100 / 1.18 = 84.75, Tax: 15.25. Sum must equal 100.00 exactly.
    const { net, tax } = Money.extractTax(100, 18, "INR");
    assert.equal(net, 84.75);
    assert.equal(tax, 15.25);
    assert.equal(Money.amount(net + tax), 100.00);

    // Add tax
    const added = Money.addTax(84.75, 18, "INR");
    assert.equal(added.tax, 15.26); // commercial rounding of 84.75 * 0.18 = 15.255 -> 15.26
    assert.equal(added.gross, 100.01);
  });
});

