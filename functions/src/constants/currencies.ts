/**
 * Canonical Currency Registry for Trado (ISO 4217)
 *
 * ONE Source of Truth for currency facts across Trado backend.
 * All formatting, exponents, unit names, and symbols derive from this table.
 */

export interface CurrencyUnitNames {
  name: string;
  plural: string;
}

export interface CurrencyMinorUnit extends CurrencyUnitNames {
  perMajor: number;
}

export interface CurrencySubMinorUnit extends CurrencyUnitNames {
  perMinor: number;
}

export interface CurrencyDefinition {
  code: string;
  numeric?: string;
  symbol: string;
  symbolPosition: "before" | "after";
  exponent: 0 | 2 | 3 | 4;
  major: CurrencyUnitNames;
  minor?: CurrencyMinorUnit;
  subMinor?: CurrencySubMinorUnit;
}

export const CURRENCIES: Record<string, CurrencyDefinition> = {
  INR: {
    code: "INR",
    numeric: "356",
    symbol: "₹",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Rupee", plural: "Rupees" },
    minor: { name: "Paisa", plural: "Paise", perMajor: 100 },
  },
  AED: {
    code: "AED",
    numeric: "784",
    symbol: "AED",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Dirham", plural: "Dirhams" },
    minor: { name: "Fils", plural: "Fils", perMajor: 100 },
  },
  BHD: {
    code: "BHD",
    numeric: "048",
    symbol: "BD",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Dinar", plural: "Dinars" },
    minor: { name: "Fils", plural: "Fils", perMajor: 1000 },
  },
  OMR: {
    code: "OMR",
    numeric: "512",
    symbol: "OMR",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Rial", plural: "Rials" },
    minor: { name: "Baisa", plural: "Baisa", perMajor: 1000 },
  },
  KWD: {
    code: "KWD",
    numeric: "414",
    symbol: "KD",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Dinar", plural: "Dinars" },
    minor: { name: "Fils", plural: "Fils", perMajor: 1000 },
  },
  QAR: {
    code: "QAR",
    numeric: "634",
    symbol: "QR",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Riyal", plural: "Riyals" },
    minor: { name: "Dirham", plural: "Dirhams", perMajor: 100 },
  },
  SAR: {
    code: "SAR",
    numeric: "682",
    symbol: "SAR",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Riyal", plural: "Riyals" },
    minor: { name: "Halala", plural: "Halalas", perMajor: 100 },
  },
  JOD: {
    code: "JOD",
    numeric: "400",
    symbol: "JD",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Dinar", plural: "Dinars" },
    minor: { name: "Fils", plural: "Fils", perMajor: 1000 }, // VERIFY: ISO 4217 exponent 3 (1 JOD = 1000 fils)
  },
  USD: {
    code: "USD",
    numeric: "840",
    symbol: "$",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Dollar", plural: "Dollars" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  EUR: {
    code: "EUR",
    numeric: "978",
    symbol: "€",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Euro", plural: "Euros" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  GBP: {
    code: "GBP",
    numeric: "826",
    symbol: "£",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Pound", plural: "Pounds" },
    minor: { name: "Penny", plural: "Pence", perMajor: 100 },
  },
  SGD: {
    code: "SGD",
    numeric: "702",
    symbol: "S$",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Dollar", plural: "Dollars" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  CAD: {
    code: "CAD",
    numeric: "124",
    symbol: "CA$",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Dollar", plural: "Dollars" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  AUD: {
    code: "AUD",
    numeric: "036",
    symbol: "A$",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Dollar", plural: "Dollars" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  JPY: {
    code: "JPY",
    numeric: "392",
    symbol: "¥",
    symbolPosition: "before",
    exponent: 0,
    major: { name: "Yen", plural: "Yen" },
  },
  KRW: {
    code: "KRW",
    numeric: "410",
    symbol: "₩",
    symbolPosition: "before",
    exponent: 0,
    major: { name: "Won", plural: "Won" },
  },
  VND: {
    code: "VND",
    numeric: "704",
    symbol: "₫",
    symbolPosition: "after",
    exponent: 0,
    major: { name: "Dong", plural: "Dong" },
  },
  TND: {
    code: "TND",
    numeric: "788",
    symbol: "DT",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Dinar", plural: "Dinars" },
    minor: { name: "Millime", plural: "Millimes", perMajor: 1000 },
  },
  IQD: {
    code: "IQD",
    numeric: "368",
    symbol: "IQD",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Dinar", plural: "Dinars" },
    minor: { name: "Fils", plural: "Fils", perMajor: 1000 },
  },
  LYD: {
    code: "LYD",
    numeric: "434",
    symbol: "LD",
    symbolPosition: "before",
    exponent: 3,
    major: { name: "Dinar", plural: "Dinars" },
    minor: { name: "Dirham", plural: "Dirhams", perMajor: 1000 },
  },
  CNY: {
    code: "CNY",
    numeric: "156",
    symbol: "¥",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Yuan", plural: "Yuan" },
    minor: { name: "Fen", plural: "Fen", perMajor: 100 },
  },
  PKR: {
    code: "PKR",
    numeric: "586",
    symbol: "Rs",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Rupee", plural: "Rupees" },
    minor: { name: "Paisa", plural: "Paise", perMajor: 100 },
  },
  BDT: {
    code: "BDT",
    numeric: "050",
    symbol: "৳",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Taka", plural: "Taka" },
    minor: { name: "Poisha", plural: "Poisha", perMajor: 100 },
  },
  LKR: {
    code: "LKR",
    numeric: "144",
    symbol: "Rs",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Rupee", plural: "Rupees" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  NPR: {
    code: "NPR",
    numeric: "524",
    symbol: "Rs",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Rupee", plural: "Rupees" },
    minor: { name: "Paisa", plural: "Paisa", perMajor: 100 },
  },
  MYR: {
    code: "MYR",
    numeric: "458",
    symbol: "RM",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Ringgit", plural: "Ringgit" },
    minor: { name: "Sen", plural: "Sen", perMajor: 100 },
  },
  THB: {
    code: "THB",
    numeric: "764",
    symbol: "฿",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Baht", plural: "Baht" },
    minor: { name: "Satang", plural: "Satang", perMajor: 100 },
  },
  IDR: {
    code: "IDR",
    numeric: "360",
    symbol: "Rp",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Rupiah", plural: "Rupiah" },
    minor: { name: "Sen", plural: "Sen", perMajor: 100 },
  },
  ZAR: {
    code: "ZAR",
    numeric: "710",
    symbol: "R",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Rand", plural: "Rand" },
    minor: { name: "Cent", plural: "Cents", perMajor: 100 },
  },
  EGP: {
    code: "EGP",
    numeric: "818",
    symbol: "E£",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Pound", plural: "Pounds" },
    minor: { name: "Piastre", plural: "Piastres", perMajor: 100 },
  },
  TRY: {
    code: "TRY",
    numeric: "949",
    symbol: "₺",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Lira", plural: "Lira" },
    minor: { name: "Kuruş", plural: "Kuruş", perMajor: 100 },
  },
  CHF: {
    code: "CHF",
    numeric: "756",
    symbol: "CHF",
    symbolPosition: "before",
    exponent: 2,
    major: { name: "Franc", plural: "Francs" },
    minor: { name: "Rappen", plural: "Rappen", perMajor: 100 },
  },
};

/**
 * Retrieve canonical metadata for a currency code.
 * Throws CURRENCY_REQUIRED if missing or empty.
 * Throws CURRENCY_UNKNOWN if not in registry.
 */
export function getCurrencyInfo(code?: string | null): CurrencyDefinition {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new Error("CURRENCY_REQUIRED");
  }
  const normalized = code.trim().toUpperCase();
  const info = CURRENCIES[normalized];
  if (!info) {
    throw new Error(`CURRENCY_UNKNOWN: ${code}`);
  }
  return info;
}

/**
 * Get decimal exponent for a currency code (e.g. 2 for INR/AED/USD, 3 for BHD/OMR/KWD/JOD, 0 for JPY).
 */
export function getExponent(code?: string | null): number {
  return getCurrencyInfo(code).exponent;
}
