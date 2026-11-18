/**
 * Tax Calculation Service (G7: Dynamic DB-Backed Worldwide Tax Engine)
 * 
 * Provides deterministic tax calculation and tax snapshots for:
 * - IN_GST (India GST: standard rates e.g. 0%, 5%, 12%, 18%, 28% with CGST/SGST/IGST split)
 * - AE_VAT (UAE VAT: standard 5%, zero-rated 0%)
 * - OM_VAT (Oman VAT: standard 5%)
 * - BH_VAT (Bahrain VAT: standard 10%, 0% zero-rated)
 * - SG_GST (Singapore GST: standard 9%)
 * - US_SALES_TAX (US destination state/local sales tax)
 * - SA_VAT (Saudi Arabia VAT: standard 15%)
 * - GB_VAT (UK VAT: standard 20%, reduced 5%)
 * - EU_VAT (European Union VAT: standard 19%, reduced 7%)
 * - NONE (Tax exempt)
 * 
 * Supports:
 * - Line-level multi-slab tax calculation with HSN/tax code aggregation.
 * - Dynamic database-backed tax regime definitions with in-memory caching.
 * - Accurate intra-state (CGST + SGST) vs inter-state (IGST) split.
 * - Returns frozen TaxSnapshot objects suitable for immutable audit and invoice printing.
 */

import { TaxSnapshot, TaxRegimeDoc, TaxBreakdownItem } from "../types/models.js";
import { DEFAULT_TAX_REGIMES, TaxRegimeDefinition } from "../constants/catalogs.js";
import { round2 } from "./money.js";
import { db } from "./firebase.js";

export interface TaxLineInput {
  taxableAmount: number;
  taxRatePercent?: number;
  taxCode?: string;
  isTaxable?: boolean;
}

export interface CalculateTaxParams {
  taxRegimeCode: string;
  country: string;
  isRegistered?: boolean;
  registrationNumber?: string;
  subTotal: number;
  taxRatePercent?: number; // Override or line-level fallback rate
  isInterState?: boolean; // India GST: IGST vs CGST+SGST
  lines?: TaxLineInput[]; // Line-level items for multi-slab calculation (G7)
  taxRegime?: TaxRegimeDoc | TaxRegimeDefinition; // Optional DB or catalog regime object
}

export interface TaxCalculationResult {
  taxRatePercent: number;
  taxAmount: number;
  totalWithTax: number;
  breakdown: TaxBreakdownItem[];
  taxSnapshot: TaxSnapshot;
}

// In-memory regime cache initialized from canonical DEFAULT_TAX_REGIMES
const REGIME_CACHE = new Map<string, TaxRegimeDoc>();

for (const def of DEFAULT_TAX_REGIMES) {
  REGIME_CACHE.set(def.code.toUpperCase(), {
    code: def.code,
    country: def.country,
    name: def.name,
    description: def.description,
    isDefault: def.isDefault,
    taxType: def.taxType,
    defaultRate: def.defaultRate,
    rates: def.rates,
    labels: def.labels,
    supportsInterState: def.supportsInterState,
  });
}

/**
 * Resolves a tax regime document by code, querying Firestore `taxRegimes` collection
 * or falling back to canonical defaults.
 */
export async function getTaxRegime(code: string): Promise<TaxRegimeDoc | null> {
  const normalized = (code || "NONE").toUpperCase().trim();
  if (REGIME_CACHE.has(normalized)) {
    return REGIME_CACHE.get(normalized)!;
  }
  try {
    const snap = await db.collection("taxRegimes").doc(normalized).get();
    if (snap.exists) {
      const doc = snap.data() as TaxRegimeDoc;
      REGIME_CACHE.set(normalized, doc);
      return doc;
    }
  } catch (_) {
    // Database query unavailable
  }
  return REGIME_CACHE.get("NONE") || null;
}

/**
 * Calculates tax and produces an immutable TaxSnapshot for bills and outflows.
 */
export function calculateTax(params: CalculateTaxParams): TaxCalculationResult {
  const regimeCode = (params.taxRegimeCode || "NONE").toUpperCase().trim();
  const subTotal = Math.max(0, params.subTotal || 0);

  // Resolve regime definition from passed object, cache, or default
  const regimeDoc: TaxRegimeDoc = (params.taxRegime as TaxRegimeDoc) ||
    REGIME_CACHE.get(regimeCode) ||
    REGIME_CACHE.get("NONE") || {
      code: "NONE",
      country: params.country || "GLOBAL",
      name: "No Tax / Tax Exempt",
      description: "Exempt or zero-tax business operations",
      isDefault: false,
      taxType: "none",
      defaultRate: 0,
      rates: [0],
      labels: { taxName: "None", registrationLabel: "N/A", invoiceTitle: "Bill of Supply" },
    };

  const labels = regimeDoc.labels || {
    taxName: "Tax",
    registrationLabel: "Tax ID",
    invoiceTitle: "Tax Invoice",
  };
  const taxType = regimeDoc.taxType || "none";
  const defaultRate = regimeDoc.defaultRate ?? 0;
  const isInterState = !!params.isInterState && !!regimeDoc.supportsInterState;

  // Case 1: Line-level items passed (multi-slab and category tax calculation)
  if (params.lines && params.lines.length > 0) {
    let totalTaxAmount = 0;
    const rateMap = new Map<number, { taxable: number; tax: number }>();

    for (const line of params.lines) {
      const taxable = Math.max(0, line.taxableAmount || 0);
      const isTaxable = line.isTaxable !== false;
      const rate = isTaxable ? (line.taxRatePercent !== undefined ? line.taxRatePercent : defaultRate) : 0;
      const lineTax = isTaxable && rate > 0 ? round2(taxable * (rate / 100)) : 0;

      totalTaxAmount = round2(totalTaxAmount + lineTax);
      const current = rateMap.get(rate) || { taxable: 0, tax: 0 };
      rateMap.set(rate, {
        taxable: round2(current.taxable + taxable),
        tax: round2(current.tax + lineTax),
      });
    }

    const breakdown: TaxBreakdownItem[] = [];

    // Sort rates ascending for deterministic output
    const sortedRates = Array.from(rateMap.keys()).sort((a, b) => a - b);
    for (const rate of sortedRates) {
      if (rate === 0) continue;
      const val = rateMap.get(rate)!;
      if (taxType === "gst") {
        if (isInterState) {
          breakdown.push({
            name: `IGST (${rate}%)`,
            rate,
            amount: val.tax,
            taxableAmount: val.taxable,
          });
        } else {
          const halfRate = rate / 2;
          const halfAmount = round2(val.tax / 2);
          breakdown.push({
            name: `CGST (${halfRate}%)`,
            rate: halfRate,
            amount: halfAmount,
            taxableAmount: val.taxable,
          });
          breakdown.push({
            name: `SGST (${halfRate}%)`,
            rate: halfRate,
            amount: round2(val.tax - halfAmount),
            taxableAmount: val.taxable,
          });
        }
      } else {
        breakdown.push({
          name: `${labels.taxName} (${rate}%)`,
          rate,
          amount: val.tax,
          taxableAmount: val.taxable,
        });
      }
    }

    const effectiveRate = subTotal > 0 ? round2((totalTaxAmount / subTotal) * 100) : 0;
    const totalWithTax = round2(subTotal + totalTaxAmount);

    const taxSnapshot: TaxSnapshot = {
      regime: regimeCode,
      country: params.country || regimeDoc.country || "IN",
      taxRatePercent: effectiveRate,
      taxAmount: totalTaxAmount,
      taxType,
      isRegistered: params.isRegistered ?? (regimeCode !== "NONE"),
      registrationNumber: params.registrationNumber || undefined,
      breakdown,
      isInterState,
      labels,
    };

    return {
      taxRatePercent: effectiveRate,
      taxAmount: totalTaxAmount,
      totalWithTax,
      breakdown,
      taxSnapshot,
    };
  }

  // Case 2: Document-level subtotal calculation (single rate fallback)
  const effectiveRate = params.taxRatePercent !== undefined ? params.taxRatePercent : defaultRate;
  const taxAmount = effectiveRate > 0 ? round2(subTotal * (effectiveRate / 100)) : 0;
  const totalWithTax = round2(subTotal + taxAmount);
  const breakdown: TaxBreakdownItem[] = [];

  if (effectiveRate > 0) {
    if (taxType === "gst") {
      if (isInterState) {
        breakdown.push({
          name: `IGST (${effectiveRate}%)`,
          rate: effectiveRate,
          amount: taxAmount,
          taxableAmount: subTotal,
        });
      } else {
        const halfRate = effectiveRate / 2;
        const halfAmount = round2(taxAmount / 2);
        breakdown.push({
          name: `CGST (${halfRate}%)`,
          rate: halfRate,
          amount: halfAmount,
          taxableAmount: subTotal,
        });
        breakdown.push({
          name: `SGST (${halfRate}%)`,
          rate: halfRate,
          amount: round2(taxAmount - halfAmount),
          taxableAmount: subTotal,
        });
      }
    } else {
      breakdown.push({
        name: `${labels.taxName} (${effectiveRate}%)`,
        rate: effectiveRate,
        amount: taxAmount,
        taxableAmount: subTotal,
      });
    }
  }

  const taxSnapshot: TaxSnapshot = {
    regime: regimeCode,
    country: params.country || regimeDoc.country || "IN",
    taxRatePercent: effectiveRate,
    taxAmount,
    taxType,
    isRegistered: params.isRegistered ?? (regimeCode !== "NONE"),
    registrationNumber: params.registrationNumber || undefined,
    breakdown,
    isInterState,
    labels,
  };

  return {
    taxRatePercent: effectiveRate,
    taxAmount,
    totalWithTax,
    breakdown,
    taxSnapshot,
  };
}

