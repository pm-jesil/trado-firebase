/**
 * Canonical Money and Precision Utility for Trado
 *
 * ONE Source of Truth for rounding and precision across Trado backend.
 * All operations require an explicit ISO 4217 currency code.
 * Exponents derive from constants/currencies.ts.
 */

import { getExponent, getCurrencyInfo } from "../constants/currencies.js";
import { HttpsError } from "firebase-functions/v2/https";

export { getExponent, getCurrencyInfo };

/**
 * Validates that a currency code is present and non-empty.
 * Throws HttpsError with status failed-precondition and reason CURRENCY_MISSING if missing.
 */
export function requireCurrency(value: string | null | undefined, contextDescription: string): string {
  if (!value || typeof value !== "string" || value.trim() === "") {
    const err = Object.assign(
      new HttpsError(
        "failed-precondition",
        `[CURRENCY_MISSING] Currency is missing for ${contextDescription}. Documents and accounts must have a valid currency.`,
        { reason: "CURRENCY_MISSING" }
      ),
      { reason: "CURRENCY_MISSING" }
    );
    throw err;
  }
  return value.trim().toUpperCase();
}

/**
 * Validates that a country code is present and non-empty.
 * Throws HttpsError with status failed-precondition and reason COUNTRY_MISSING if missing.
 */
export function requireCountry(value: string | null | undefined, contextDescription: string): string {
  if (!value || typeof value !== "string" || value.trim() === "") {
    const err = Object.assign(
      new HttpsError(
        "failed-precondition",
        `[COUNTRY_MISSING] Country is missing for ${contextDescription}. Organizations must have a valid country.`,
        { reason: "COUNTRY_MISSING" }
      ),
      { reason: "COUNTRY_MISSING" }
    );
    throw err;
  }
  return value.trim().toUpperCase();
}

/**
 * Validates that a timezone is present and non-empty.
 * Throws HttpsError with status failed-precondition and reason TIMEZONE_MISSING if missing.
 */
export function requireTimezone(value: string | null | undefined, contextDescription: string): string {
  if (!value || typeof value !== "string" || value.trim() === "") {
    const err = Object.assign(
      new HttpsError(
        "failed-precondition",
        `[TIMEZONE_MISSING] Timezone is missing for ${contextDescription}. Organizations must have a valid timezone.`,
        { reason: "TIMEZONE_MISSING" }
      ),
      { reason: "TIMEZONE_MISSING" }
    );
    throw err;
  }
  return value.trim();
}

/**
 * Validates that a tax regime code is present and non-empty.
 * Throws HttpsError with status failed-precondition and reason TAX_REGIME_MISSING if missing.
 */
export function requireTaxRegime(value: string | null | undefined, contextDescription: string): string {
  if (!value || typeof value !== "string" || value.trim() === "") {
    const err = Object.assign(
      new HttpsError(
        "failed-precondition",
        `[TAX_REGIME_MISSING] Tax regime code is missing for ${contextDescription}. Organizations must have a valid taxRegimeCode.`,
        { reason: "TAX_REGIME_MISSING" }
      ),
      { reason: "TAX_REGIME_MISSING" }
    );
    throw err;
  }
  return value.trim();
}

/**
 * Validates that a financial year start month is present and valid (1-12).
 * Throws HttpsError with status failed-precondition and reason FINANCIAL_YEAR_START_MONTH_MISSING if missing/invalid.
 */
export function requireFinancialYearStartMonth(value: number | null | undefined, contextDescription: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12) {
    const err = Object.assign(
      new HttpsError(
        "failed-precondition",
        `[FINANCIAL_YEAR_START_MONTH_MISSING] Financial year start month is missing or invalid for ${contextDescription}. Organizations must specify an integer month between 1 and 12.`,
        { reason: "FINANCIAL_YEAR_START_MONTH_MISSING" }
      ),
      { reason: "FINANCIAL_YEAR_START_MONTH_MISSING" }
    );
    throw err;
  }
  return value;
}

/**
 * Round a number to N decimal places using standard commercial rounding (round half away from zero).
 * Preserves the sign for negative values (-2.5 -> -3) and avoids IEEE 754 float drift via exponential notation.
 * Safe against scientific notation strings (e.g. 1e-7), non-finite inputs, and negative zero.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0; // Guarantees +0, never -0

  const d = Math.floor(Math.max(0, Math.min(20, decimals)));
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);

  // Parse mantissa and exponent separately to avoid string concatenation like "1e-7e2" -> NaN
  const str = abs.toString().toLowerCase();
  const [mantissa, expStr] = str.split("e");
  const exp = expStr ? parseInt(expStr, 10) : 0;

  // Shift decimal point by d places
  const shiftedExp = exp + d;
  const shifted = Number(mantissa + "e" + shiftedExp);
  const rounded = Math.round(shifted);

  // Unshift decimal point by d places
  const roundedStr = rounded.toString().toLowerCase();
  const [rMantissa, rExpStr] = roundedStr.split("e");
  const rExp = rExpStr ? parseInt(rExpStr, 10) : 0;

  const unshiftedExp = rExp - d;
  const result = Number(rMantissa + "e" + unshiftedExp) * sign;

  return result === 0 ? 0 : result;
}

/**
 * Round to 4 decimal places (unit rates, cost prices).
 */
export function round4(value: number): number {
  return roundTo(value, 4);
}

/**
 * Validate and round a quantity to the allowed precision (0-4 decimal places).
 */
export function roundQty(value: number, precision: number = 4): number {
  if (precision < 0 || precision > 4) {
    throw new Error(`Quantity precision must be between 0 and 4, received ${precision}`);
  }
  return roundTo(value, precision);
}

/**
 * ISO 4217 Currency minor unit exponents (decimals).
 * Delegates to canonical CURRENCIES table in constants/currencies.ts.
 */
export function getCurrencyDecimals(currency: string): number {
  return getExponent(currency);
}

/**
 * Assert that an amount matches the decimal precision allowed by the currency.
 * Throws AMOUNT_PRECISION_INVALID if the amount has more decimals than the currency exponent.
 */
export function assertAmountMatchesCurrency(amount: number, currency: string): void {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error("AMOUNT_INVALID: amount must be a finite number");
  }
  const exponent = getExponent(currency);
  const rounded = roundTo(amount, exponent);
  if (Math.abs(amount - rounded) > 1e-7) {
    throw new Error(`AMOUNT_PRECISION_INVALID: amount ${amount} has more decimals than allowed for ${currency} (${exponent} decimals)`);
  }
}

export const Money = {
  round4,
  qty: roundQty,
  getDecimals: getCurrencyDecimals,

  /**
   * Primary canonical rounding entry point: rounds amount to currency exponent.
   */
  amount(value: number, currency: string): number {
    return roundTo(value, getExponent(currency));
  },

  /**
   * Rate rounding helper: rounds unit rates / cost prices to 4 decimal places.
   */
  rate(value: number): number {
    return round4(value);
  },

  /**
   * Check if two money amounts are equal within currency rounding tolerance.
   */
  equal(a: number, b: number, currency: string): boolean {
    const decimals = getExponent(currency);
    const tolerance = 0.5 * Math.pow(10, -decimals);
    return Math.abs(roundTo(a, decimals) - roundTo(b, decimals)) < tolerance;
  },

  /**
   * Check if an amount is effectively zero within currency tolerance.
   */
  isZero(value: number, currency: string): boolean {
    const decimals = getExponent(currency);
    const tolerance = 0.5 * Math.pow(10, -decimals);
    return Math.abs(roundTo(value, decimals)) < tolerance;
  },

  /**
   * Safely subtract b from a, floored at 0, rounded to currency decimals.
   */
  subtract(a: number, b: number, currency: string): number {
    return roundTo(Math.max(0, a - b), getExponent(currency));
  },

  /**
   * Sum an array of numbers, rounded to currency decimal places.
   */
  sum(values: number[], currency: string): number {
    const decimals = getExponent(currency);
    return roundTo(
      values.reduce((acc, v) => acc + (v || 0), 0),
      decimals
    );
  },

  /**
   * Calculate percentage of a base amount.
   */
  percent(base: number, percentage: number, currency: string): number {
    return roundTo((base * percentage) / 100, getExponent(currency));
  },

  /**
   * Extract tax from a tax-inclusive amount.
   * Returns { net, tax } where net + tax = inclusiveAmount.
   */
  extractTax(
    inclusiveAmount: number,
    taxRate: number,
    currency: string
  ): { net: number; tax: number } {
    const decimals = getExponent(currency);
    if (taxRate <= 0) {
      return { net: roundTo(inclusiveAmount, decimals), tax: 0 };
    }
    const net = roundTo(inclusiveAmount / (1 + taxRate / 100), decimals);
    const tax = roundTo(inclusiveAmount - net, decimals);
    return { net, tax };
  },

  /**
   * Add tax to a net amount.
   * Returns { gross, tax } where gross = net + tax.
   */
  addTax(
    netAmount: number,
    taxRate: number,
    currency: string
  ): { gross: number; tax: number } {
    const decimals = getExponent(currency);
    const tax = roundTo((netAmount * taxRate) / 100, decimals);
    return { gross: roundTo(netAmount + tax, decimals), tax };
  },

  /**
   * Convert a major decimal amount into integer minor units (cents, paise, fils).
   */
  fromDecimal(amount: number, currency: string): number {
    const decimals = getExponent(currency);
    const factor = Math.pow(10, decimals);
    return Math.round((amount + Number.EPSILON) * factor);
  },

  /**
   * Convert integer minor units back into a major decimal amount.
   */
  toDecimal(minorUnits: number, currency: string): number {
    const decimals = getExponent(currency);
    const factor = Math.pow(10, decimals);
    return roundTo(minorUnits / factor, decimals);
  },

  /**
   * Convert major decimal into exact integer minor units.
   */
  toMinor(amount: number, currency: string): number {
    return this.fromDecimal(amount, currency);
  },

  /**
   * Convert exact integer minor units to major decimal.
   */
  fromMinor(minorUnits: number, currency: string): number {
    return this.toDecimal(minorUnits, currency);
  },

  /**
   * Add integer minor units with exact integer arithmetic.
   */
  addMinor(a: number, b: number): number {
    return Math.round(a) + Math.round(b);
  },

  /**
   * Subtract integer minor units with exact integer arithmetic.
   */
  subtractMinor(a: number, b: number): number {
    return Math.round(a) - Math.round(b);
  },

  /**
   * Allocate integer minor units across proportions without fractional remainder loss.
   */
  allocateMinor(totalMinor: number, ratios: number[]): number[] {
    const totalRatio = ratios.reduce((sum, r) => sum + r, 0);
    if (totalRatio <= 0) return ratios.map(() => 0);

    const intTotal = Math.round(totalMinor);
    let remainder = intTotal;
    const results: number[] = [];

    for (let i = 0; i < ratios.length; i++) {
      const share = Math.floor((intTotal * ratios[i]) / totalRatio);
      results.push(share);
      remainder -= share;
    }

    // Distribute remaining cents/paise one by one to parts with highest remainder
    if (remainder > 0) {
      const remaindersWithIndex = ratios.map((r, idx) => ({
        idx,
        rem: (intTotal * r) / totalRatio - results[idx],
      }));
      remaindersWithIndex.sort((a, b) => b.rem - a.rem);

      for (let i = 0; i < remainder; i++) {
        results[remaindersWithIndex[i].idx]++;
      }
    }

    return results;
  },
};

export const toMinor = Money.toMinor.bind(Money);
export const fromMinor = Money.fromMinor.bind(Money);
export const addMinor = Money.addMinor.bind(Money);
export const subtractMinor = Money.subtractMinor.bind(Money);
export const allocateMinor = Money.allocateMinor.bind(Money);
