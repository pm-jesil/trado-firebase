/**
 * Tax Calculation Service
 * 
 * Provides deterministic tax calculation and tax snapshots for:
 * - IN_GST (India GST: standard rates e.g. 0%, 5%, 12%, 18%, 28%)
 * - AE_VAT (UAE VAT: standard 5%)
 * - US_SALES_TAX (Destination sales tax)
 * - NONE (Tax exempt)
 * 
 * Returns frozen TaxSnapshot objects suitable for immutable audit and invoice printing.
 */

import { TaxSnapshot } from "../types/models.js";
import { round2 } from "./money.js";

export interface CalculateTaxParams {
  taxRegimeCode: string;
  country: string;
  isRegistered?: boolean;
  registrationNumber?: string;
  subTotal: number;
  taxRatePercent?: number; // Override or line-level tax rate
  isInterState?: boolean; // India GST: IGST vs CGST+SGST
}

export interface TaxCalculationResult {
  taxRatePercent: number;
  taxAmount: number;
  totalWithTax: number;
  breakdown: Array<{
    name: string;
    rate: number;
    amount: number;
  }>;
  taxSnapshot: TaxSnapshot;
}

/**
 * Calculates tax and produces an immutable TaxSnapshot for bills and outflows.
 */
export function calculateTax(params: CalculateTaxParams): TaxCalculationResult {
  const regime = (params.taxRegimeCode || "NONE").toUpperCase();
  const subTotal = Math.max(0, params.subTotal || 0);

  // Default tax rate based on regime if not explicitly specified
  let effectiveRate = params.taxRatePercent !== undefined ? params.taxRatePercent : 0;
  let taxName = "Tax";
  let regLabel = "Tax ID";
  let invoiceTitle = "Invoice";

  switch (regime) {
    case "IN_GST":
      if (params.taxRatePercent === undefined) effectiveRate = 18; // Default standard GST
      taxName = "GST";
      regLabel = "GSTIN";
      invoiceTitle = "Tax Invoice";
      break;

    case "AE_VAT":
      if (params.taxRatePercent === undefined) effectiveRate = 5; // Standard UAE 5%
      taxName = "VAT";
      regLabel = "TRN";
      invoiceTitle = "Tax Invoice";
      break;

    case "OM_VAT":
      if (params.taxRatePercent === undefined) effectiveRate = 5; // Standard Oman 5%
      taxName = "VAT";
      regLabel = "VATIN";
      invoiceTitle = "Tax Invoice";
      break;

    case "BH_VAT":
      if (params.taxRatePercent === undefined) effectiveRate = 10; // Standard Bahrain 10%
      taxName = "VAT";
      regLabel = "TRN";
      invoiceTitle = "Tax Invoice";
      break;

    case "SG_GST":
      if (params.taxRatePercent === undefined) effectiveRate = 9; // Standard Singapore 9%
      taxName = "GST";
      regLabel = "GST Reg No";
      invoiceTitle = "Tax Invoice";
      break;

    case "US_SALES_TAX":
      if (params.taxRatePercent === undefined) effectiveRate = 7;
      taxName = "Sales Tax";
      regLabel = "Tax Permit";
      invoiceTitle = "Sales Invoice";
      break;

    case "NONE":
    default:
      effectiveRate = 0;
      taxName = "None";
      regLabel = "N/A";
      invoiceTitle = "Bill of Supply";
      break;
  }

  // Round amounts using decimal-safe commercial rounding
  const taxAmount = round2(subTotal * (effectiveRate / 100));
  const totalWithTax = round2(subTotal + taxAmount);

  const breakdown: Array<{ name: string; rate: number; amount: number }> = [];

  if (regime === "IN_GST" && effectiveRate > 0) {
    if (params.isInterState) {
      breakdown.push({
        name: `IGST (${effectiveRate}%)`,
        rate: effectiveRate,
        amount: taxAmount,
      });
    } else {
      const halfRate = effectiveRate / 2;
      const halfAmount = round2(taxAmount / 2);
      breakdown.push({
        name: `CGST (${halfRate}%)`,
        rate: halfRate,
        amount: halfAmount,
      });
      breakdown.push({
        name: `SGST (${halfRate}%)`,
        rate: halfRate,
        amount: round2(taxAmount - halfAmount),
      });
    }
  } else if (effectiveRate > 0) {
    breakdown.push({
      name: `${taxName} (${effectiveRate}%)`,
      rate: effectiveRate,
      amount: taxAmount,
    });
  }

  const taxSnapshot: TaxSnapshot = {
    regime,
    country: params.country || "IN",
    taxRatePercent: effectiveRate,
    taxAmount,
    taxType: regime === "IN_GST" || regime === "SG_GST" ? "gst" : (regime === "AE_VAT" || regime === "OM_VAT" || regime === "BH_VAT") ? "vat" : "sales_tax",
    isRegistered: params.isRegistered ?? (regime !== "NONE"),
    registrationNumber: params.registrationNumber || undefined,
    labels: {
      taxName,
      registrationLabel: regLabel,
      invoiceTitle,
    },
  };

  return {
    taxRatePercent: effectiveRate,
    taxAmount,
    totalWithTax,
    breakdown,
    taxSnapshot,
  };
}

