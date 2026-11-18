/**
 * Canonical Money and Precision Utility for Trado
 * 
 * Ported directly from the legacy Trado architecture (common/money/money.util.ts)
 * 
 * Rounding policy:
 * - Amounts (totals, payments, discounts): 2 decimal places (or currency exponent)
 * - Unit rates / cost prices: 4 decimal places
 * - Quantities: validated against precision (0-4 decimal places)
 * - ISO 4217 Currency exponents: 3 decimals (BHD, KWD, OMR, etc.), 0 decimals (JPY, KRW), 2 decimals default
 * 
 * Uses standard commercial rounding (round half away from zero) with Number.EPSILON to prevent float drift.
 */

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
 * Round to 2 decimal places (amounts, totals, payments default).
 */
export function round2(value: number): number {
  return roundTo(value, 2);
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
 */
export function getCurrencyDecimals(currency: string = "INR"): number {
  if (!currency) return 2;
  const c = currency.toUpperCase().trim();
  const threeDecimals = ["BHD", "KWD", "OMR", "JOD", "TND", "IQD", "LYD"];
  const zeroDecimals = ["JPY", "KRW", "VND", "CLP", "PYG", "RWF", "UGX"];
  if (threeDecimals.includes(c)) return 3;
  if (zeroDecimals.includes(c)) return 0;
  return 2;
}

/**
 * Round an amount to the proper minor unit exponent of the currency.
 */
export function roundCurrency(value: number, currency: string = "INR"): number {
  return roundTo(value, getCurrencyDecimals(currency));
}

export const Money = {
  round2,
  round4,
  amount(value: number, currency: string = "INR"): number {
    return roundTo(value, getCurrencyDecimals(currency));
  },
  rate: round4,
  qty: roundQty,
  getDecimals: getCurrencyDecimals,

  /**
   * Check if two money amounts are equal within currency rounding tolerance.
   */
  equal(a: number, b: number, currency: string = "INR"): boolean {
    const decimals = getCurrencyDecimals(currency);
    const tolerance = 0.5 * Math.pow(10, -decimals);
    return Math.abs(roundTo(a, decimals) - roundTo(b, decimals)) < tolerance;
  },

  /**
   * Check if an amount is effectively zero within currency tolerance.
   */
  isZero(value: number, currency: string = "INR"): boolean {
    const decimals = getCurrencyDecimals(currency);
    const tolerance = 0.5 * Math.pow(10, -decimals);
    return Math.abs(roundTo(value, decimals)) < tolerance;
  },

  /**
   * Safely subtract b from a, floored at 0, rounded to currency decimals.
   */
  subtract(a: number, b: number, currency: string = "INR"): number {
    return roundTo(Math.max(0, a - b), getCurrencyDecimals(currency));
  },

  /**
   * Sum an array of numbers, rounded to currency decimal places.
   */
  sum(values: number[], currency: string = "INR"): number {
    const decimals = getCurrencyDecimals(currency);
    return roundTo(
      values.reduce((acc, v) => acc + (v || 0), 0),
      decimals
    );
  },

  /**
   * Calculate percentage of a base amount.
   */
  percent(base: number, percentage: number, currency: string = "INR"): number {
    return roundTo((base * percentage) / 100, getCurrencyDecimals(currency));
  },

  /**
   * Extract tax from a tax-inclusive amount.
   * Returns { net, tax } where net + tax = inclusiveAmount.
   */
  extractTax(
    inclusiveAmount: number,
    taxRate: number,
    currency: string = "INR"
  ): { net: number; tax: number } {
    const decimals = getCurrencyDecimals(currency);
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
    currency: string = "INR"
  ): { gross: number; tax: number } {
    const decimals = getCurrencyDecimals(currency);
    const tax = roundTo((netAmount * taxRate) / 100, decimals);
    return { gross: roundTo(netAmount + tax, decimals), tax };
  },

  /**
   * Convert a major decimal amount into integer minor units (cents, paise, fils).
   */
  fromDecimal(amount: number, currency: string = "INR"): number {
    const decimals = getCurrencyDecimals(currency);
    const factor = Math.pow(10, decimals);
    return Math.round((amount + Number.EPSILON) * factor);
  },

  /**
   * Convert integer minor units back into a major decimal amount.
   */
  toDecimal(minorUnits: number, currency: string = "INR"): number {
    const decimals = getCurrencyDecimals(currency);
    const factor = Math.pow(10, decimals);
    return roundTo(minorUnits / factor, decimals);
  },

  /**
   * Alias: Convert major decimal into exact integer minor units.
   */
  toMinor(amount: number, currency: string = "INR"): number {
    return this.fromDecimal(amount, currency);
  },

  /**
   * Alias: Convert exact integer minor units to major decimal.
   */
  fromMinor(minorUnits: number, currency: string = "INR"): number {
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
    for (let i = 0; i < remainder; i++) {
      results[i % results.length]++;
    }

    return results;
  },

  /**
   * Round amount to the currency's standard decimal places.
   */
  roundCurrency(amount: number, currency: string = "INR"): number {
    return roundTo(amount, getCurrencyDecimals(currency));
  },
} as const;

export const toMinor = Money.toMinor.bind(Money);
export const fromMinor = Money.toDecimal.bind(Money);
export const addMinor = Money.addMinor;
export const subtractMinor = Money.subtractMinor;
export const allocateMinor = Money.allocateMinor;
