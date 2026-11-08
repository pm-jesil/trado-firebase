/**
 * Business-type defaults (Part 8.5): ONE table keyed by businessType. An organization stores only
 * its OVERRIDES (organizations.moduleToggles, organizations.settings.businessConfig); the effective
 * configuration is resolved at read time as override ?? default — never copied into the organization.
 * The plan still decides entitlement (a module the plan excludes stays MODULE_NOT_IN_PLAN).
 */

import { BusinessType, SalesMode } from "./enums.js";

export interface BusinessDefaults {
  /** Module switches (false = off by default for this kind of business; absent = on). */
  modules: Record<string, boolean>;
  /** Units offered first when creating products. */
  defaultUnits: string[];
  /** Product form fields the app shows by default. */
  productFields: { expiry: boolean; batch: boolean; serial: boolean; variants: boolean; alternateUnits: boolean; jewellery: boolean };
  /** Default sales mode for new bills. */
  salesMode: SalesMode;
}

const RETAIL: BusinessDefaults = {
  modules: {},
  defaultUnits: ["piece", "kg", "litre"],
  productFields: { expiry: false, batch: false, serial: false, variants: true, alternateUnits: false, jewellery: false },
  salesMode: SalesMode.POS,
};
const WHOLESALE: BusinessDefaults = {
  modules: {},
  defaultUnits: ["piece", "box", "carton", "kg"],
  productFields: { expiry: false, batch: true, serial: false, variants: true, alternateUnits: true, jewellery: false },
  salesMode: SalesMode.B2B,
};

export const BUSINESS_TYPE_DEFAULTS: Record<BusinessType, BusinessDefaults> = {
  [BusinessType.RETAIL_ONLY]: RETAIL,
  [BusinessType.POS_COUNTER]: { ...RETAIL, modules: { delivery: false, sales: false } },
  [BusinessType.WHOLESALE_ONLY]: WHOLESALE,
  [BusinessType.WHOLESALE_RETAIL]: { ...WHOLESALE, salesMode: SalesMode.POS },
  [BusinessType.DISTRIBUTOR]: WHOLESALE,
  [BusinessType.MANUFACTURER_B2B]: { ...WHOLESALE, productFields: { ...WHOLESALE.productFields, batch: true, expiry: true } },
  [BusinessType.GENERAL_TRADING]: { ...WHOLESALE, salesMode: SalesMode.POS },
  [BusinessType.RESTAURANT]: { modules: { purchases: true, returns: false }, defaultUnits: ["plate", "piece", "kg", "litre"], productFields: { expiry: true, batch: false, serial: false, variants: true, alternateUnits: false, jewellery: false }, salesMode: SalesMode.POS },
  [BusinessType.CAFE_BAKERY]: { modules: { returns: false }, defaultUnits: ["piece", "kg", "pack"], productFields: { expiry: true, batch: true, serial: false, variants: true, alternateUnits: false, jewellery: false }, salesMode: SalesMode.POS },
  [BusinessType.SERVICE]: { modules: { inventory: false, delivery: false }, defaultUnits: ["hour", "job"], productFields: { expiry: false, batch: false, serial: false, variants: false, alternateUnits: false, jewellery: false }, salesMode: SalesMode.B2B },
};

export interface EffectiveBusinessConfig extends BusinessDefaults {
  businessType: BusinessType;
}

/** Effective configuration = organization override ?? business-type default (computed, never stored). */
export function effectiveBusinessConfig(org: {
  businessType: BusinessType;
  moduleToggles?: Record<string, boolean>;
  settings?: { businessConfig?: { defaultUnits?: string[]; productFields?: Partial<BusinessDefaults["productFields"]>; salesMode?: SalesMode } };
}): EffectiveBusinessConfig {
  const d = BUSINESS_TYPE_DEFAULTS[org.businessType] || WHOLESALE;
  const o = org.settings?.businessConfig || {};
  return {
    businessType: org.businessType,
    modules: { ...d.modules, ...(org.moduleToggles || {}) },
    defaultUnits: o.defaultUnits || d.defaultUnits,
    productFields: { ...d.productFields, ...(o.productFields || {}) },
    salesMode: o.salesMode || d.salesMode,
  };
}
