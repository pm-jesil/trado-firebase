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
  minorUnitName: string;
  minorUnitNamePlural: string;
  currencySymbol: string;
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
    minorUnitName: "paisa",
    minorUnitNamePlural: "paise",
    currencySymbol: "₹",
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
    minorUnitName: "fils",
    minorUnitNamePlural: "fils",
    currencySymbol: "AED",
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
    minorUnitName: "baisa",
    minorUnitNamePlural: "baisa",
    currencySymbol: "OMR",
    timezone: "Asia/Muscat",
    taxRegimeCode: "OM_VAT",
    financialYearStartMonth: 1, // January
    phoneRegion: "OM",
    postalCodePattern: "^[0-9]{3}$",
    postalCodePlaceholder: "100",
    states: [
      { code: "MC", name: "Muscat" },
      { code: "DH", name: "Dhofar" },
      { code: "MU", name: "Musandam" },
      { code: "BU", name: "Al Buraimi" },
      { code: "DA", name: "Al Dakhiliyah" },
      { code: "BN", name: "Al Batinah North" },
      { code: "BS", name: "Al Batinah South" },
      { code: "SN", name: "Al Sharqiyah North" },
      { code: "SS", name: "Al Sharqiyah South" },
      { code: "ZH", name: "Al Dhahirah" },
      { code: "WU", name: "Al Wusta" },
    ],
  },
  BH: {
    countryCode: "BH",
    countryName: "Bahrain",
    currencyCode: "BHD",
    currencyDecimals: 3,
    minorUnitName: "fils",
    minorUnitNamePlural: "fils",
    currencySymbol: "BD",
    timezone: "Asia/Bahrain",
    taxRegimeCode: "BH_VAT",
    financialYearStartMonth: 1, // January
    phoneRegion: "BH",
    postalCodePattern: "^[0-9]{3,4}$",
    postalCodePlaceholder: "317",
    states: [
      { code: "CAP", name: "Capital Governorate" },
      { code: "MUH", name: "Muharraq Governorate" },
      { code: "NOR", name: "Northern Governorate" },
      { code: "SOU", name: "Southern Governorate" },
    ],
  },
  SG: {
    countryCode: "SG",
    countryName: "Singapore",
    currencyCode: "SGD",
    currencyDecimals: 2,
    minorUnitName: "cent",
    minorUnitNamePlural: "cents",
    currencySymbol: "S$",
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
    minorUnitName: "cent",
    minorUnitNamePlural: "cents",
    currencySymbol: "$",
    timezone: "America/New_York",
    taxRegimeCode: "US_SALES_TAX",
    financialYearStartMonth: 1, // January
    phoneRegion: "US",
    postalCodePattern: "^[0-9]{5}(-[0-9]{4})?$",
    postalCodePlaceholder: "10001",
    states: [
      { code: "CA", name: "California" },
      { code: "NY", name: "New York" },
      { code: "TX", name: "Texas" },
      { code: "FL", name: "Florida" },
      { code: "IL", name: "Illinois" },
      { code: "WA", name: "Washington" },
      { code: "MA", name: "Massachusetts" },
      { code: "CO", name: "Colorado" },
      { code: "GA", name: "Georgia" },
      { code: "NC", name: "North Carolina" },
    ],
  },
  SA: {
    countryCode: "SA",
    countryName: "Saudi Arabia",
    currencyCode: "SAR",
    currencyDecimals: 2,
    minorUnitName: "halala",
    minorUnitNamePlural: "halalas",
    currencySymbol: "SAR",
    timezone: "Asia/Riyadh",
    taxRegimeCode: "SA_VAT",
    financialYearStartMonth: 1,
    phoneRegion: "SA",
    postalCodePattern: "^[0-9]{5}$",
    postalCodePlaceholder: "12211",
    states: [
      { code: "RIY", name: "Riyadh" },
      { code: "MAK", name: "Makkah" },
      { code: "EAS", name: "Eastern Province" },
      { code: "MAD", name: "Madinah" },
      { code: "ASI", name: "Asir" },
      { code: "TAB", name: "Tabuk" },
      { code: "QAS", name: "Al-Qassim" },
    ],
  },
  GB: {
    countryCode: "GB",
    countryName: "United Kingdom",
    currencyCode: "GBP",
    currencyDecimals: 2,
    minorUnitName: "penny",
    minorUnitNamePlural: "pence",
    currencySymbol: "£",
    timezone: "Europe/London",
    taxRegimeCode: "GB_VAT",
    financialYearStartMonth: 4, // April
    phoneRegion: "GB",
    postalCodePattern: "^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$",
    postalCodePlaceholder: "EC1A 1BB",
    states: [
      { code: "ENG", name: "England" },
      { code: "SCT", name: "Scotland" },
      { code: "WLS", name: "Wales" },
      { code: "NIR", name: "Northern Ireland" },
    ],
  },
  DE: {
    countryCode: "DE",
    countryName: "Germany",
    currencyCode: "EUR",
    currencyDecimals: 2,
    minorUnitName: "cent",
    minorUnitNamePlural: "cents",
    currencySymbol: "€",
    timezone: "Europe/Berlin",
    taxRegimeCode: "EU_VAT",
    financialYearStartMonth: 1,
    phoneRegion: "DE",
    postalCodePattern: "^[0-9]{5}$",
    postalCodePlaceholder: "10115",
    states: [
      { code: "BER", name: "Berlin" },
      { code: "BAY", name: "Bavaria" },
      { code: "NRW", name: "North Rhine-Westphalia" },
      { code: "BW", name: "Baden-Württemberg" },
      { code: "HES", name: "Hesse" },
    ],
  },
  QA: {
    countryCode: "QA",
    countryName: "Qatar",
    currencyCode: "QAR",
    currencyDecimals: 2,
    minorUnitName: "dirham",
    minorUnitNamePlural: "dirhams",
    currencySymbol: "QR",
    timezone: "Asia/Qatar",
    taxRegimeCode: "NONE",
    financialYearStartMonth: 1,
    phoneRegion: "QA",
    postalCodePattern: "^[0-9]{4,5}$",
    postalCodePlaceholder: "0000",
  },
  KW: {
    countryCode: "KW",
    countryName: "Kuwait",
    currencyCode: "KWD",
    currencyDecimals: 3,
    minorUnitName: "fils",
    minorUnitNamePlural: "fils",
    currencySymbol: "KD",
    timezone: "Asia/Kuwait",
    taxRegimeCode: "NONE",
    financialYearStartMonth: 1,
    phoneRegion: "KW",
    postalCodePattern: "^[0-9]{5}$",
    postalCodePlaceholder: "13001",
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
