/**
 * Canonical Country Defaults Catalog
 * 
 * Single source of truth for country financial, tax, timezone, currency,
 * phone formatting, and fiscal year rules.
 * Generated to docs/generated/country-defaults.json.
 */

export interface StateDefinition {
  code: string;
  name: string;
}

export interface CountryDefaultDefinition {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  currencyDecimals: number;
  timezone: string;
  taxRegimeCode: string;
  financialYearStartMonth: number; // 1-12
  phoneRegion: string;
  postalCodePattern: string;
  postalCodePlaceholder: string;
  states?: StateDefinition[];
}

export const COUNTRY_DEFAULTS: Record<string, CountryDefaultDefinition> = {
  IN: {
    countryCode: "IN",
    countryName: "India",
    currencyCode: "INR",
    currencyDecimals: 2,
    timezone: "Asia/Kolkata",
    taxRegimeCode: "IN_GST",
    financialYearStartMonth: 4, // April
    phoneRegion: "IN",
    postalCodePattern: "^[1-9][0-9]{5}$",
    postalCodePlaceholder: "560001",
    states: [
      { code: "AN", name: "Andaman and Nicobar Islands" },
      { code: "AP", name: "Andhra Pradesh" },
      { code: "AR", name: "Arunachal Pradesh" },
      { code: "AS", name: "Assam" },
      { code: "BR", name: "Bihar" },
      { code: "CH", name: "Chandigarh" },
      { code: "CT", name: "Chhattisgarh" },
      { code: "DL", name: "Delhi" },
      { code: "GA", name: "Goa" },
      { code: "GJ", name: "Gujarat" },
      { code: "HR", name: "Haryana" },
      { code: "HP", name: "Himachal Pradesh" },
      { code: "JK", name: "Jammu and Kashmir" },
      { code: "JH", name: "Jharkhand" },
      { code: "KA", name: "Karnataka" },
      { code: "KL", name: "Kerala" },
      { code: "LA", name: "Ladakh" },
      { code: "LD", name: "Lakshadweep" },
      { code: "MP", name: "Madhya Pradesh" },
      { code: "MH", name: "Maharashtra" },
      { code: "MN", name: "Manipur" },
      { code: "ML", name: "Meghalaya" },
      { code: "MZ", name: "Mizoram" },
      { code: "NL", name: "Nagaland" },
      { code: "OD", name: "Odisha" },
      { code: "PY", name: "Puducherry" },
      { code: "PB", name: "Punjab" },
      { code: "RJ", name: "Rajasthan" },
      { code: "SK", name: "Sikkim" },
      { code: "TN", name: "Tamil Nadu" },
      { code: "TS", name: "Telangana" },
      { code: "TR", name: "Tripura" },
      { code: "UP", name: "Uttar Pradesh" },
      { code: "UK", name: "Uttarakhand" },
      { code: "WB", name: "West Bengal" },
    ],
  },
  AE: {
    countryCode: "AE",
    countryName: "United Arab Emirates",
    currencyCode: "AED",
    currencyDecimals: 2,
    timezone: "Asia/Dubai",
    taxRegimeCode: "AE_VAT",
    financialYearStartMonth: 1, // January
    phoneRegion: "AE",
    postalCodePattern: "^[0-9]{5}$",
    postalCodePlaceholder: "00000",
    states: [
      { code: "AZ", name: "Abu Dhabi" },
      { code: "AJ", name: "Ajman" },
      { code: "DU", name: "Dubai" },
      { code: "FU", name: "Fujairah" },
      { code: "RK", name: "Ras Al Khaimah" },
      { code: "SH", name: "Sharjah" },
      { code: "UQ", name: "Umm Al Quwain" },
    ],
  },
  OM: {
    countryCode: "OM",
    countryName: "Oman",
    currencyCode: "OMR",
    currencyDecimals: 3,
    timezone: "Asia/Muscat",
    taxRegimeCode: "OM_VAT",
    financialYearStartMonth: 1, // January
    phoneRegion: "OM",
    postalCodePattern: "^[0-9]{3}$",
    postalCodePlaceholder: "100",
  },
  BH: {
    countryCode: "BH",
    countryName: "Bahrain",
    currencyCode: "BHD",
    currencyDecimals: 3,
    timezone: "Asia/Bahrain",
    taxRegimeCode: "BH_VAT",
    financialYearStartMonth: 1, // January
    phoneRegion: "BH",
    postalCodePattern: "^[0-9]{3,4}$",
    postalCodePlaceholder: "317",
  },
  SG: {
    countryCode: "SG",
    countryName: "Singapore",
    currencyCode: "SGD",
    currencyDecimals: 2,
    timezone: "Asia/Singapore",
    taxRegimeCode: "SG_GST",
    financialYearStartMonth: 1, // January
    phoneRegion: "SG",
    postalCodePattern: "^[0-9]{6}$",
    postalCodePlaceholder: "018956",
  },
  US: {
    countryCode: "US",
    countryName: "United States",
    currencyCode: "USD",
    currencyDecimals: 2,
    timezone: "America/New_York",
    taxRegimeCode: "US_SALES_TAX",
    financialYearStartMonth: 1, // January
    phoneRegion: "US",
    postalCodePattern: "^[0-9]{5}(-[0-9]{4})?$",
    postalCodePlaceholder: "10001",
  },
};

/**
 * Get country defaults for a given ISO 3166-1 alpha-2 country code.
 * Falls back to India (IN) if unknown.
 */
export function getCountryDefaults(countryCode: string = "IN"): CountryDefaultDefinition {
  const code = (countryCode || "IN").toUpperCase().trim();
  return COUNTRY_DEFAULTS[code] || COUNTRY_DEFAULTS.IN;
}
