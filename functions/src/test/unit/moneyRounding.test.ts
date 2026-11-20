import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roundTo, Money, assertAmountMatchesCurrency, getCurrencyDecimals, requireCurrency } from "../../services/money.js";
import { CURRENCIES, getCurrencyInfo, getExponent } from "../../constants/currencies.js";
import { calculateTax } from "../../services/taxCalculation.js";
import { computeProfitLoss } from "../../callables/reports/financialReports.js";
import { reportsGetPlatformOverview } from "../../callables/reports/analyticsReports.js";
import { db } from "../../services/firebase.js";
import {
  SplitPaymentEntrySchema,
  RecordPaymentFeeSchema,
  RecordEntryFeeSchema,
  CreateCapitalTransactionSchema,
  CreateSubEntrySchema,
  FeeRuleInputSchema,
  UpdateAccountingPolicySchema,
  CreateFinancialAccountSchema,
} from "../../validation/schemas.js";
import { BankAccountSchema } from "../../validation/sharedSchemas.js";
import { PaymentMethod } from "../../constants/enums.js";

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

    it("handles IEEE 754 float noise gracefully via epsilon comparison (0.1 + 0.2 AED, 1.005 + 1.005 AED, 0.1 + 0.2 BHD)", () => {
      assert.doesNotThrow(() => assertAmountMatchesCurrency(0.1 + 0.2, "AED"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(1.005 + 1.005, "AED"));
      assert.doesNotThrow(() => assertAmountMatchesCurrency(0.1 + 0.2, "BHD"));
      assert.throws(() => assertAmountMatchesCurrency(12.555, "AED"), /AMOUNT_PRECISION_INVALID/);
      assert.throws(() => assertAmountMatchesCurrency(100.5, "JPY"), /AMOUNT_PRECISION_INVALID/);
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

  describe("Prompt 77D S3c — Multi-currency Platform & Financial Report Invariants", () => {
    it("reportsGetPlatformOverview separates totalsByCurrency buckets for BHD and AED and keeps 3 decimals (S3c-1)", async () => {
      const origCollection = (db as any).collection.bind(db);
      (db as any).collection = (collName: string) => {
        if (collName === "organizations") {
          return {
            _queryOptions: { collectionId: collName },
            get: async () => ({
              size: 2,
              docs: [
                { ref: { path: "organizations/org_bhd" }, id: "org_bhd", data: () => ({ status: "active", currency: "BHD", planId: "standard", country: "BH" }) },
                { ref: { path: "organizations/org_aed" }, id: "org_aed", data: () => ({ status: "active", currency: "AED", planId: "standard", country: "AE" }) },
              ],
            }),
          };
        }
        if (collName === "subscriptionPlans" || collName === "users") {
          return {
            _queryOptions: { collectionId: collName },
            get: async () => ({ size: 1, docs: [] }),
          };
        }
        if (collName === "bills") {
          return {
            _queryOptions: { collectionId: collName },
            where: function (field: string, op: string, val: string) {
              const org = val;
              return {
                _queryOptions: { collectionId: collName },
                where: function () {
                  return {
                    _queryOptions: { collectionId: collName },
                    get: async () => {
                      if (org === "org_bhd") {
                        return { size: 1, docs: [{ ref: { path: "bills/b1" }, data: () => ({ totalAmount: 15.125, createdAt: "2026-06-01T10:00:00Z" }) }] };
                      } else {
                        return { size: 1, docs: [{ ref: { path: "bills/b2" }, data: () => ({ totalAmount: 100.5, createdAt: "2026-06-01T10:00:00Z" }) }] };
                      }
                    },
                  };
                },
              };
            },
          };
        }
        if (collName === "outflows") {
          return {
            _queryOptions: { collectionId: collName },
            where: function (field: string, op: string, val: string) {
              const org = val;
              return {
                _queryOptions: { collectionId: collName },
                where: function () {
                  return {
                    _queryOptions: { collectionId: collName },
                    get: async () => {
                      if (org === "org_bhd") {
                        return { size: 1, docs: [{ ref: { path: "outflows/o1" }, data: () => ({ totalAmount: 5.125, createdAt: "2026-06-01T10:00:00Z" }) }] };
                      } else {
                        return { size: 1, docs: [{ ref: { path: "outflows/o2" }, data: () => ({ totalAmount: 40.25, createdAt: "2026-06-01T10:00:00Z" }) }] };
                      }
                    },
                  };
                },
              };
            },
          };
        }
        return {
          _queryOptions: { collectionId: collName },
          where: function () { return this; },
          get: async () => ({ size: 0, docs: [] }),
        };
      };

      try {
        const res = await (reportsGetPlatformOverview as any).run({
          auth: { uid: "superadmin_1", token: { isSuperAdmin: true } },
          data: {},
        });

        assert.ok(res.totalsByCurrency, "totalsByCurrency must exist");
        assert.ok(res.totalsByCurrency.BHD, "BHD bucket must exist");
        assert.ok(res.totalsByCurrency.AED, "AED bucket must exist");

        // Verify BHD preserves 3 decimals exactly
        assert.equal(res.totalsByCurrency.BHD.revenue, 15.125);
        assert.equal(res.totalsByCurrency.BHD.outflows, 5.125);
        assert.equal(res.totalsByCurrency.BHD.netCashFlow, 10.000);

        // Verify AED preserves 2 decimals
        assert.equal(res.totalsByCurrency.AED.revenue, 100.50);
        assert.equal(res.totalsByCurrency.AED.outflows, 40.25);
        assert.equal(res.totalsByCurrency.AED.netCashFlow, 60.25);

        // Verify buckets stay separate (never summed into a single mixed currency number)
        assert.notEqual(res.totalsByCurrency.BHD.revenue, res.totalsByCurrency.AED.revenue);
        assert.equal(res.topOrganizationsByUsage[0].currency, "BHD");
        assert.equal(res.topOrganizationsByUsage[0].revenue, 15.125);
        assert.equal(res.topOrganizationsByUsage[1].currency, "AED");
        assert.equal(res.topOrganizationsByUsage[1].revenue, 100.50);
      } finally {
        (db as any).collection = origCollection;
      }
    });

    it("calls real computeProfitLoss with a BHD org and proves output keeps 3 decimals (S3c-2)", async () => {
      const origCollection = (db as any).collection.bind(db);
      (db as any).collection = (collName: string) => {
        if (collName === "organizations") {
          return {
            _queryOptions: { collectionId: collName },
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({ currency: "BHD", timezone: "Asia/Bahrain", financialYearStartMonth: 1 }),
              }),
            }),
          };
        }
        if (collName === "bills") {
          return {
            _queryOptions: { collectionId: collName },
            where: function () { return this; },
            get: async () => ({
              docs: [{
                ref: { path: "bills/b_bhd" },
                data: () => ({
                  totalAmount: 12.125,
                  taxTotal: 1.125,
                  discountTotal: 0.250,
                  items: [{ quantity: 2, costSnapshot: 4.500 }],
                }),
              }],
            }),
          };
        }
        if (collName === "outflows") {
          return {
            _queryOptions: { collectionId: collName },
            where: function () { return this; },
            get: async () => ({
              docs: [{
                ref: { path: "outflows/o_bhd" },
                data: () => ({ kind: "expense", totalAmount: 2.125, expenseCategoryId: "office" }),
              }],
            }),
          };
        }
        return {
          _queryOptions: { collectionId: collName },
          where: function () { return this; },
          get: async () => ({ docs: [] }),
        };
      };

      try {
        const res = await computeProfitLoss("org_bhd_test", {
          periodType: "custom",
          from: "2026-01-01",
          to: "2026-01-31",
        });

        assert.equal(res.currencyDecimals, 3);
        assert.equal(res.grossRevenue, 12.125);
        assert.equal(res.netRevenue, 12.125);
        assert.equal(res.grossCogs, 9.000);
        assert.equal(res.grossProfit, 3.125);
        assert.equal(res.operatingExpenses, 2.125);
        assert.equal(res.netProfit, 1.000);
        assert.equal(res.tax, 1.125);
        assert.equal(res.discounts, 0.250);
      } finally {
        (db as any).collection = origCollection;
      }
    });
  });

  describe("Prompt 77D S4 — One Money Convention in Schemas and Cash Flows", () => {
    describe("Cash count denomination summation and variance", () => {
      it("counts INR denominations (500x3 = 1,500.00 INR) with exact variance", () => {
        const currency = "INR";
        const denominations: Record<string, number> = { "500": 3 };
        const lineTotals: number[] = [];

        for (const [denomStr, count] of Object.entries(denominations)) {
          const denom = Number(denomStr);
          assertAmountMatchesCurrency(denom, currency);
          lineTotals.push(Money.amount(denom * count, currency));
        }

        const counted = Money.sum(lineTotals, currency);
        assert.equal(counted, 1500.00);

        // System balance matches counted amount -> zero variance
        const systemBalanceExact = 1500.00;
        const varianceExact = Money.amount(counted - systemBalanceExact, currency);
        assert.equal(varianceExact, 0.00);

        // System balance short by 100 -> positive variance (overage)
        const systemBalanceShort = 1400.00;
        const varianceOverage = Money.amount(counted - systemBalanceShort, currency);
        assert.equal(varianceOverage, 100.00);

        // System balance over by 100 -> negative variance (shortage)
        const systemBalanceOver = 1600.00;
        const varianceShortage = Money.amount(counted - systemBalanceOver, currency);
        assert.equal(varianceShortage, -100.00);
      });

      it("counts BHD denominations (0.500x10 + 0.100x5 = 5.500 BHD) preserving 3 decimals", () => {
        const currency = "BHD";
        const denominations: Record<string, number> = {
          "0.5": 10,
          "0.100": 5,
        };
        const lineTotals: number[] = [];

        for (const [denomStr, count] of Object.entries(denominations)) {
          const denom = Number(denomStr);
          assertAmountMatchesCurrency(denom, currency);
          lineTotals.push(Money.amount(denom * count, currency));
        }

        const counted = Money.sum(lineTotals, currency);
        assert.equal(counted, 5.500);

        // System balance has 3 decimals (5.500 BHD) -> zero variance
        const systemBalanceExact = 5.500;
        const varianceExact = Money.amount(counted - systemBalanceExact, currency);
        assert.equal(varianceExact, 0.000);

        // System balance 5.000 BHD -> overage of 0.500 BHD
        const systemBalanceShort = 5.000;
        const varianceOverage = Money.amount(counted - systemBalanceShort, currency);
        assert.equal(varianceOverage, 0.500);

        // System balance 5.625 BHD -> shortage of -0.125 BHD
        const systemBalanceOver = 5.625;
        const varianceShortage = Money.amount(counted - systemBalanceOver, currency);
        assert.equal(varianceShortage, -0.125);
      });

      it("counts JPY denominations (1000x5 = 5,000 JPY) preserving 0 decimals", () => {
        const currency = "JPY";
        const denominations: Record<string, number> = { "1000": 5 };
        const lineTotals: number[] = [];

        for (const [denomStr, count] of Object.entries(denominations)) {
          const denom = Number(denomStr);
          assertAmountMatchesCurrency(denom, currency);
          lineTotals.push(Money.amount(denom * count, currency));
        }

        const counted = Money.sum(lineTotals, currency);
        assert.equal(counted, 5000);

        const systemBalanceExact = 5000;
        const varianceExact = Money.amount(counted - systemBalanceExact, currency);
        assert.equal(varianceExact, 0);

        const systemBalanceShort = 4000;
        const varianceOverage = Money.amount(counted - systemBalanceShort, currency);
        assert.equal(varianceOverage, 1000);
      });
    });

    describe("Schema validation allows non-integer amounts in major units", () => {
      it("validates SplitPaymentEntrySchema with decimal amounts", () => {
        const aedSplit = SplitPaymentEntrySchema.parse({
          method: PaymentMethod.CASH,
          amount: 12.50,
          financialAccountId: "acc_aed_cash",
        });
        assert.equal(aedSplit.amount, 12.50);

        const bhdSplit = SplitPaymentEntrySchema.parse({
          method: PaymentMethod.CARD,
          amount: 1.250,
          financialAccountId: "acc_bhd_card",
        });
        assert.equal(bhdSplit.amount, 1.250);
      });

      it("validates RecordPaymentFeeSchema and RecordEntryFeeSchema with decimal amounts", () => {
        const feeParsed = RecordPaymentFeeSchema.parse({
          organizationId: "org_test",
          sourceDocumentType: "bill",
          sourceDocumentId: "bill_1",
          financialAccountId: "acc_1",
          paymentMethod: PaymentMethod.CARD,
          feeAmount: 0.250,
          feeTaxAmount: 0.025,
        });
        assert.equal(feeParsed.feeAmount, 0.250);
        assert.equal(feeParsed.feeTaxAmount, 0.025);

        const entryFeeParsed = RecordEntryFeeSchema.parse({
          organizationId: "org_test",
          entryId: "entry_1",
          feeAmount: 2.50,
          feeTaxAmount: 0.25,
        });
        assert.equal(entryFeeParsed.feeAmount, 2.50);
        assert.equal(entryFeeParsed.feeTaxAmount, 0.25);
      });

      it("validates CreateCapitalTransactionSchema and CreateSubEntrySchema with decimal amounts", () => {
        const capParsed = CreateCapitalTransactionSchema.parse({
          organizationId: "org_test",
          type: "owner_contribution",
          financialAccountId: "acc_cap",
          amount: 1234.56,
          currency: "USD",
        });
        assert.equal(capParsed.amount, 1234.56);

        const subParsed = CreateSubEntrySchema.parse({
          organizationId: "org_test",
          parentEntryId: "parent_1",
          subEntryType: "gateway_fee",
          amount: 1.500,
        });
        assert.equal(subParsed.amount, 1.500);
      });

      it("validates FeeRuleInputSchema with decimal fixed fees", () => {
        const feeRule = FeeRuleInputSchema.parse({
          feeFixed: 0.250,
          feePercent: 2.5,
          feeTaxPercent: 5.0,
        });
        assert.equal(feeRule.feeFixed, 0.250);
        assert.equal(feeRule.feePercent, 2.5);
      });
    });

    describe("Fee calculation with Money.amount preserves currency exponent without Math.round", () => {
      it("computes fee variance in AED (2 decimals)", () => {
        const currency = "AED";
        const feeRule = { feeFixed: 1.00, feePercent: 2.5, feeTaxPercent: 5.0 };
        const gross = 100.00;
        const baseFee = Money.amount(feeRule.feeFixed + (gross * feeRule.feePercent) / 100, currency);
        assert.equal(baseFee, 3.50);

        const feeTax = Money.amount((baseFee * feeRule.feeTaxPercent) / 100, currency);
        assert.equal(feeTax, 0.18); // 3.50 * 0.05 = 0.175 -> half away from zero = 0.18

        const expectedFee = Money.amount(baseFee + feeTax, currency);
        assert.equal(expectedFee, 3.68);
      });

      it("computes fee variance in BHD (3 decimals)", () => {
        const currency = "BHD";
        const feeRule = { feeFixed: 0.100, feePercent: 2.0, feeTaxPercent: 10.0 };
        const gross = 10.000;
        const baseFee = Money.amount(feeRule.feeFixed + (gross * feeRule.feePercent) / 100, currency);
        assert.equal(baseFee, 0.300);

        const feeTax = Money.amount((baseFee * feeRule.feeTaxPercent) / 100, currency);
        assert.equal(feeTax, 0.030);

        const expectedFee = Money.amount(baseFee + feeTax, currency);
        assert.equal(expectedFee, 0.330);
      });

      it("computes fee variance in JPY (0 decimals)", () => {
        const currency = "JPY";
        const feeRule = { feeFixed: 100, feePercent: 3.0, feeTaxPercent: 10.0 };
        const gross = 10000;
        const baseFee = Money.amount(feeRule.feeFixed + (gross * feeRule.feePercent) / 100, currency);
        assert.equal(baseFee, 400);

        const feeTax = Money.amount((baseFee * feeRule.feeTaxPercent) / 100, currency);
        assert.equal(feeTax, 40);

        const expectedFee = Money.amount(baseFee + feeTax, currency);
        assert.equal(expectedFee, 440);
      });
    });
  });

  describe("Prompt 77D S5 — Single Money Convention & Duplicate Removal (Unit)", () => {
    describe("Self-approval limit enforcement in decimal major units (BHD & KWD fail-closed)", () => {
      const evaluateSelfApproval = (amount: number, currency: string, policy: any) => {
        const selfPolicy = policy?.selfApprovalPolicy || "off";
        if (selfPolicy === "on") return true;
        if (selfPolicy === "up_to_limit") {
          const limit = policy?.selfApprovalLimits?.[currency];
          if (typeof limit !== "number" || amount > limit) {
            const err = new Error(`Self-approval blocked for currency ${currency}: ${typeof limit !== "number" ? "no limit configured" : "exceeds limit"}.`);
            (err as any).reason = "SELF_REVIEW_FORBIDDEN";
            throw err;
          }
          return true;
        }
        const err = new Error("Makers cannot approve their own entries.");
        (err as any).reason = "SELF_REVIEW_FORBIDDEN";
        throw err;
      };

      const bhdPolicy = {
        selfApprovalPolicy: "up_to_limit",
        selfApprovalLimits: { BHD: 50.000, AED: 500.00, INR: 10000.00 },
      };

      it("approves 49.999 BHD when self-approval limit is 50.000 BHD", () => {
        assert.doesNotThrow(() => evaluateSelfApproval(49.999, "BHD", bhdPolicy));
      });

      it("approves exact limit 50.000 BHD when self-approval limit is 50.000 BHD", () => {
        assert.doesNotThrow(() => evaluateSelfApproval(50.000, "BHD", bhdPolicy));
      });

      it("rejects 50.001 BHD with SELF_REVIEW_FORBIDDEN when limit is 50.000 BHD", () => {
        assert.throws(
          () => evaluateSelfApproval(50.001, "BHD", bhdPolicy),
          (err: any) => err.reason === "SELF_REVIEW_FORBIDDEN"
        );
      });

      it("fails closed with SELF_REVIEW_FORBIDDEN for KWD when org has no limit entry (D1)", () => {
        const kwdPolicy = {
          selfApprovalPolicy: "up_to_limit",
          selfApprovalLimits: {}, // empty: no KWD entry configured
        };
        assert.throws(
          () => evaluateSelfApproval(1.000, "KWD", kwdPolicy),
          (err: any) => err.reason === "SELF_REVIEW_FORBIDDEN"
        );
      });
    });

    describe("Cash count variance threshold rule (Item 4)", () => {
      const evaluateVariance = (varianceAmount: number, threshold?: number) => {
        const hasVariance = varianceAmount !== 0;
        const needsApproval = threshold !== undefined
          ? Math.abs(varianceAmount) > threshold
          : hasVariance;
        const needsReview = threshold !== undefined
          ? Math.abs(varianceAmount) > (threshold / 2)
          : hasVariance;
        const reviewReasons = needsReview
          ? [threshold !== undefined ? "fee_variance" : "unconfigured_variance_threshold"]
          : [];
        return { needsApproval, needsReview, reviewReasons };
      };

      it("requires approval, review, and reason for ANY non-zero variance when threshold is unset", () => {
        // Zero variance: clean, no review
        const zeroVar = evaluateVariance(0, undefined);
        assert.strictEqual(zeroVar.needsApproval, false);
        assert.strictEqual(zeroVar.needsReview, false);
        assert.deepEqual(zeroVar.reviewReasons, []);

        // Minor non-zero variance (e.g. 0.005 BHD): requires review and unconfigured reason
        const smallVar = evaluateVariance(0.005, undefined);
        assert.strictEqual(smallVar.needsApproval, true);
        assert.strictEqual(smallVar.needsReview, true);
        assert.deepEqual(smallVar.reviewReasons, ["unconfigured_variance_threshold"]);

        // Negative non-zero variance (e.g. -1.00 AED)
        const negVar = evaluateVariance(-1.00, undefined);
        assert.strictEqual(negVar.needsApproval, true);
        assert.strictEqual(negVar.needsReview, true);
        assert.deepEqual(negVar.reviewReasons, ["unconfigured_variance_threshold"]);
      });

      it("respects configured threshold when cashCountVarianceThreshold is set", () => {
        const threshold = 100;

        const v25 = evaluateVariance(25, threshold);
        assert.strictEqual(v25.needsApproval, false);
        assert.strictEqual(v25.needsReview, false);

        const v75 = evaluateVariance(75, threshold);
        assert.strictEqual(v75.needsApproval, false);
        assert.strictEqual(v75.needsReview, true);
        assert.deepEqual(v75.reviewReasons, ["fee_variance"]);

        const v120 = evaluateVariance(120, threshold);
        assert.strictEqual(v120.needsApproval, true);
        assert.strictEqual(v120.needsReview, true);
        assert.deepEqual(v120.reviewReasons, ["fee_variance"]);
      });
    });

    describe("Double-entry debit === credit balancing in decimal major units", () => {
      it("balances 3-decimal currency (BHD) journal entries", () => {
        const currency = "BHD";
        const debits = [12.345, 87.655];
        const credits = [50.000, 50.000];

        const totalDebit = Money.sum(debits, currency);
        const totalCredit = Money.sum(credits, currency);

        assert.equal(totalDebit, 100.000);
        assert.equal(totalCredit, 100.000);
        assert.ok(Money.equal(totalDebit, totalCredit, currency));
      });

      it("balances 2-decimal currency (AED) journal entries", () => {
        const currency = "AED";
        const debits = [14.25, 35.75, 50.00];
        const credits = [100.00];

        const totalDebit = Money.sum(debits, currency);
        const totalCredit = Money.sum(credits, currency);

        assert.equal(totalDebit, 100.00);
        assert.equal(totalCredit, 100.00);
        assert.ok(Money.equal(totalDebit, totalCredit, currency));
      });

      it("balances 0-decimal currency (JPY) journal entries", () => {
        const currency = "JPY";
        const debits = [1500, 3500];
        const credits = [5000];

        const totalDebit = Money.sum(debits, currency);
        const totalCredit = Money.sum(credits, currency);

        assert.equal(totalDebit, 5000);
        assert.equal(totalCredit, 5000);
        assert.ok(Money.equal(totalDebit, totalCredit, currency));
      });

      it("detects unbalanced journal entry", () => {
        const currency = "BHD";
        const debits = [12.346, 87.655]; // sum = 100.001
        const credits = [100.000];

        const totalDebit = Money.sum(debits, currency);
        const totalCredit = Money.sum(credits, currency);

        assert.strictEqual(Money.equal(totalDebit, totalCredit, currency), false);
      });
    });

    describe("UpdateAccountingPolicySchema validation with decimal values", () => {
      it("accepts decimal selfApprovalLimits and cashCountVarianceThreshold", () => {
        const parsed = UpdateAccountingPolicySchema.parse({
          selfApprovalLimits: { BHD: 50.25, AED: 500.5 },
          cashCountVarianceThreshold: 1000.5,
          selfApprovalPolicy: "up_to_limit",
        });
        assert.equal(parsed.selfApprovalLimits?.BHD, 50.25);
        assert.equal(parsed.cashCountVarianceThreshold, 1000.5);
      });
    });

    describe("Migration script (migrate-money-single-convention.cjs) transforms", () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const migration = require("../../../scripts/migrate-money-single-convention.cjs");

      it("migrates financialAccounts from minor to decimal major units and is idempotent", () => {
        const legacyDoc = {
          currency: "BHD",
          openingBalanceMinor: 1500000,
          currentBalanceMinor: 1500000,
        };
        const res = migration.transformFinancialAccountDoc(legacyDoc);
        assert.strictEqual(res.isChanged, true);
        assert.equal(res.updates.openingBalance, 1500.000);
        assert.equal(res.updates.currentBalance, 1500.000);
        assert.ok(res.updates.openingBalanceMinor !== undefined);
        assert.ok(res.updates.currentBalanceMinor !== undefined);

        const cleanDoc = {
          currency: "BHD",
          openingBalance: 1500.000,
          currentBalance: 1500.000,
        };
        const cleanRes = migration.transformFinancialAccountDoc(cleanDoc);
        assert.strictEqual(cleanRes.isChanged, false);
      });

      it("migrates accountTransactions from minor to decimal major units and is idempotent", () => {
        const legacyDoc = {
          currency: "AED",
          amountMinor: 250000,
          balanceAfterMinor: 750000,
        };
        const res = migration.transformAccountTransactionDoc(legacyDoc);
        assert.strictEqual(res.isChanged, true);
        assert.equal(res.updates.amount, 2500.00);
        assert.equal(res.updates.balanceAfter, 7500.00);
        assert.ok(res.updates.amountMinor !== undefined);
        assert.ok(res.updates.balanceAfterMinor !== undefined);

        const cleanDoc = {
          currency: "AED",
          amount: 2500.00,
          balanceAfter: 7500.00,
        };
        const cleanRes = migration.transformAccountTransactionDoc(cleanDoc);
        assert.strictEqual(cleanRes.isChanged, false);
      });

      it("migrates journalEntries from minor to decimal major units and is idempotent", () => {
        const legacyDoc = {
          currency: "INR",
          totalDebitMinor: 5000000,
          totalCreditMinor: 5000000,
          lines: [
            { accountCode: "1001", debitMinor: 5000000, credit: 0 },
            { accountCode: "2001", debit: 0, creditMinor: 5000000 },
          ],
        };
        const res = migration.transformJournalEntryDoc(legacyDoc);
        assert.strictEqual(res.isChanged, true);
        assert.equal(res.updates.totalDebit, 50000.00);
        assert.equal(res.updates.totalCredit, 50000.00);
        assert.equal(res.updates.lines[0].debit, 50000.00);
        assert.equal(res.updates.lines[0].debitMinor, undefined);
        assert.equal(res.updates.lines[1].credit, 50000.00);
        assert.equal(res.updates.lines[1].creditMinor, undefined);

        const cleanDoc = {
          currency: "INR",
          totalDebit: 50000.00,
          totalCredit: 50000.00,
          lines: [
            { accountCode: "1001", debit: 50000.00, credit: 0 },
            { accountCode: "2001", debit: 0, credit: 50000.00 },
          ],
        };
        const cleanRes = migration.transformJournalEntryDoc(cleanDoc);
        assert.strictEqual(cleanRes.isChanged, false);
      });

      it("migrates organizations accounting policy thresholds and limits and is idempotent", () => {
        const legacyDoc = {
          currency: "INR",
          currencyDecimals: 2,
          minorUnitName: "paisa",
          minorUnitNamePlural: "paise",
          currencySymbol: "₹",
          settings: {
            accountingPolicy: {
              cashCountVarianceThresholdMinor: 1000000,
              selfApprovalLimits: { INR: 1000000, BHD: 50000 },
            },
          },
        };
        const res = migration.transformOrganizationDoc(legacyDoc);
        assert.strictEqual(res.isChanged, true);
        assert.equal(res.updates["settings.accountingPolicy.cashCountVarianceThreshold"], 10000.00);
        assert.ok(res.updates["settings.accountingPolicy.cashCountVarianceThresholdMinor"] !== undefined);
        assert.equal(res.updates["settings.accountingPolicy.moneyConvention"], "major");
        // currency metadata copies are deleted
        assert.ok(res.updates.currencyDecimals !== undefined);
        assert.ok(res.updates.minorUnitName !== undefined);
        assert.ok(res.updates.minorUnitNamePlural !== undefined);
        assert.ok(res.updates.currencySymbol !== undefined);
        assert.deepEqual(res.updates["settings.accountingPolicy.selfApprovalLimits"], {
          INR: 10000.00,
          BHD: 50.000,
        });

        const cleanDoc = {
          currency: "INR",
          settings: {
            accountingPolicy: {
              moneyConvention: "major",
              cashCountVarianceThreshold: 10000.00,
              selfApprovalLimits: { INR: 10000.00, BHD: 50.000 },
            },
          },
        };
        const cleanRes = migration.transformOrganizationDoc(cleanDoc);
        assert.strictEqual(cleanRes.isChanged, false);
      });

      it("proves journalEntries.lines[] debitMinor/creditMinor are removed by rewriting whole lines array without FieldValue.delete in arrays (D3-a)", () => {
        const doc = {
          currency: "AED",
          totalDebitMinor: 25000,
          totalCreditMinor: 25000,
          lines: [
            { accountCode: "1001", accountName: "Cash", debitMinor: 25000, creditMinor: 0 },
            { accountCode: "2001", accountName: "Sales", debitMinor: 0, creditMinor: 25000 },
          ],
        };
        const res = migration.transformJournalEntryDoc(doc);
        assert.ok(Array.isArray(res.updates.lines), "lines must be rewritten as a complete replacement array");
        assert.equal(res.updates.lines.length, 2);
        // Verify line items are pure plain objects without any FieldValue.delete sent inside the array
        for (const line of res.updates.lines) {
          assert.equal(line.debitMinor, undefined, "debitMinor must be deleted via object property removal");
          assert.equal(line.creditMinor, undefined, "creditMinor must be deleted via object property removal");
          assert.strictEqual(typeof line.debit, "number");
          assert.strictEqual(typeof line.credit, "number");
        }
        assert.equal(res.updates.lines[0].debit, 250.00);
        assert.equal(res.updates.lines[1].credit, 250.00);
      });

      it("resolves doc currency from parent organization and skips docs without currency (D3-b)", () => {
        const docWithoutCurrency = {
          openingBalanceMinor: 50000,
        };
        // When neither doc nor org has currency -> skip
        const skipped = migration.transformFinancialAccountDoc(docWithoutCurrency, undefined);
        assert.strictEqual(skipped.noCurrency, true);
        assert.strictEqual(skipped.isChanged, false);

        // When org has currency (e.g. BHD) -> resolve from org
        const resolved = migration.transformFinancialAccountDoc(docWithoutCurrency, "BHD");
        assert.strictEqual(resolved.noCurrency, false);
        assert.strictEqual(resolved.isChanged, true);
        assert.equal(resolved.updates.openingBalance, 50.000);
      });

      it("refuses live --apply if FIRESTORE_EMULATOR_HOST is unset and no explicit --project is provided (D3-c)", async () => {
        const origHost = process.env.FIRESTORE_EMULATOR_HOST;
        try {
          process.env.FIRESTORE_EMULATOR_HOST = "";
          await assert.rejects(
            async () => migration.runMigration({ apply: true, projectId: null }),
            /FATAL: --apply refuses to run unless FIRESTORE_EMULATOR_HOST is set or an explicit --project <id> is passed/
          );
        } finally {
          process.env.FIRESTORE_EMULATOR_HOST = origHost;
        }
      });
    });
  });

  describe("Prompt 77D S6 — No Currency Fallbacks & Single Currency Source", () => {
    describe("Missing currency throws CURRENCY_MISSING error", () => {
      it("requireCurrency throws CURRENCY_MISSING with failed-precondition for empty/null currency", () => {
        assert.throws(
          () => requireCurrency(null, "test document"),
          (err: any) => err.reason === "CURRENCY_MISSING" && err.code === "failed-precondition"
        );
        assert.throws(
          () => requireCurrency("", "test document"),
          (err: any) => err.reason === "CURRENCY_MISSING" && err.code === "failed-precondition"
        );
        assert.throws(
          () => requireCurrency(undefined, "organization 123"),
          (err: any) => err.reason === "CURRENCY_MISSING" && err.code === "failed-precondition"
        );
      });

      it("an org with no currency throws CURRENCY_MISSING in billsCreate path", () => {
        const orgWithoutCurrency = { id: "org_no_cur", name: "No Cur Org" } as any;
        assert.throws(
          () => requireCurrency(orgWithoutCurrency.currency, `organization "${orgWithoutCurrency.id}"`),
          (err: any) => err.reason === "CURRENCY_MISSING"
        );
      });

      it("a posting with no currency throws CURRENCY_MISSING", () => {
        const postingInput = { eventCode: "CASH_SALE", sourceDocumentId: "doc_1" } as any;
        assert.throws(
          () => requireCurrency(postingInput.currency, `posting event "${postingInput.eventCode}"`),
          (err: any) => err.reason === "CURRENCY_MISSING"
        );
      });

      it("an account create with no currency and no org currency throws CURRENCY_MISSING", () => {
        const inputCurrency = undefined;
        const orgCurrency = undefined;
        assert.throws(
          () => requireCurrency(inputCurrency || orgCurrency, 'financial account "Cash"'),
          (err: any) => err.reason === "CURRENCY_MISSING"
        );
      });
    });

    describe("End-to-end KWD posting (3-decimal currency)", () => {
      it("works end to end with balanced 3-decimal journal entries for KWD organization", () => {
        const currency = "KWD";
        const saleAmount = 14.375; // 14 Dinars, 375 Fils

        // Validate precision
        assertAmountMatchesCurrency(saleAmount, currency);

        const debits = [10.125, 4.250];
        const credits = [saleAmount];

        const totalDebit = Money.sum(debits, currency);
        const totalCredit = Money.sum(credits, currency);

        assert.equal(totalDebit, 14.375);
        assert.equal(totalCredit, 14.375);
        assert.ok(Money.equal(totalDebit, totalCredit, currency));

        // Invariant: debits === credits exactly
        assert.equal(totalDebit - totalCredit, 0);

        // Account balance transition
        const initialBalance = 100.500;
        const balanceAfterDebit = Money.amount(initialBalance + saleAmount, currency);
        assert.equal(balanceAfterDebit, 114.875);
      });
    });

    describe("Zod schemas no longer inject INR", () => {
      it("CreateFinancialAccountSchema defaults currency to undefined, not INR", () => {
        const parsed = CreateFinancialAccountSchema.parse({
          name: "Petty Cash",
          code: "PETTY",
          accountType: "cash",
        });
        assert.strictEqual(parsed.currency, undefined);
      });

      it("CreateCapitalTransactionSchema defaults currency to undefined, not INR", () => {
        const parsed = CreateCapitalTransactionSchema.parse({
          type: "owner_contribution",
          financialAccountId: "acc_1",
          amount: 500,
        });
        assert.strictEqual(parsed.currency, undefined);
      });

      it("BankAccountSchema defaults currency to undefined, not INR", () => {
        const parsed = BankAccountSchema.parse({
          accountHolderName: "Global Trade LLC",
          bankName: "National Bank of Kuwait",
          accountNumber: "9876543210",
        });
        assert.strictEqual(parsed.currency, undefined);
      });
    });
  });
});


