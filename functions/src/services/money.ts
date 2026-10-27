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
 * Round a number to N decimal places using commercial rounding.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
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
   * Round amount to the currency's standard decimal places.
   */
  roundCurrency(amount: number, currency: string = "INR"): number {
    return roundTo(amount, getCurrencyDecimals(currency));
  },
} as const;
