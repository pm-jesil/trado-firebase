/**
 * Costing Engine Service — Weighted-Average Cost (WAC) & Valuation
 * 
 * Provides financial costing logic for inventory valuation and cost-of-goods-sold (COGS):
 * 1. Computes new weighted-average unit cost upon purchase inwards (outflows).
 * 2. Computes line-item and aggregate COGS for sales invoices.
 * 3. Computes inventory stock valuation at current WAC.
 * 
 * All monetary calculations use Trado's canonical money.ts rounding discipline (Money.amount & round4).
 */

import { Money, round4 } from "./money.js";
import { ProductDoc } from "../types/models.js";

export interface StockValuationItem {
  productId: string;
  name: string;
  currentStock: number;
  costPrice: number;
  weightedAverageCost: number;
  valuation: number;
}

export interface StockValuationResult {
  totalStockValuation: number;
  totalItemsCount: number;
  items: StockValuationItem[];
}

/**
 * Calculates updated Weighted-Average Cost (WAC) following a purchase receipt.
 * 
 * Formula:
 * If current stock <= 0:
 *   newWAC = newPurchaseRate
 * Else:
 *   newWAC = ((currentStock * currentWAC) + (newQty * newPurchaseRate)) / (currentStock + newQty)
 */
export function calculateNewWeightedAverageCost(
  currentStock: number,
  currentWAC: number,
  incomingQty: number,
  incomingRate: number
): number {
  if (incomingQty <= 0) {
    return round4(currentWAC);
  }

  // If previous stock is non-positive, the new purchase price sets the full baseline
  if (currentStock <= 0 || currentWAC <= 0) {
    return round4(incomingRate);
  }

  const existingTotalCost = currentStock * currentWAC;
  const incomingTotalCost = incomingQty * incomingRate;
  const newTotalQty = currentStock + incomingQty;

  const rawWac = (existingTotalCost + incomingTotalCost) / newTotalQty;
  return round4(rawWac);
}

/**
 * Computes Cost of Goods Sold (COGS) for a set of sold items.
 * Uses the product's weightedAverageCost (falling back to costPrice if unrecorded).
 */
export function calculateCOGSForItems(
  items: Array<{ productId: string; quantity: number }>,
  productMap: Map<string, ProductDoc>,
  currency: string
): number {
  let totalCogs = 0;

  for (const item of items) {
    const product = productMap.get(item.productId);
    const unitCost = product?.weightedAverageCost ?? product?.costPrice ?? 0;
    const lineCogs = item.quantity * unitCost;
    totalCogs = Money.amount(totalCogs + lineCogs, currency);
  }

  return Money.amount(totalCogs, currency);
}

/**
 * Calculates stock valuation across a list of active products.
 */
export function calculateStockValuation(
  products: (ProductDoc & { id?: string; productId?: string })[],
  currency: string
): StockValuationResult {
  let totalValuation = 0;
  const items: StockValuationItem[] = [];

  for (const product of products) {
    const stock = Math.max(0, product.currentStock || 0);
    const effectiveCost = product.weightedAverageCost && product.weightedAverageCost > 0
      ? product.weightedAverageCost
      : (product.costPrice || 0);

    const valuation = Money.amount(stock * effectiveCost, currency);
    totalValuation = Money.amount(totalValuation + valuation, currency);

    items.push({
      productId: product.id || product.productId || "",
      name: product.name,
      currentStock: stock,
      costPrice: product.costPrice || 0,
      weightedAverageCost: product.weightedAverageCost ?? product.costPrice ?? 0,
      valuation,
    });
  }

  return {
    totalStockValuation: Money.amount(totalValuation, currency),
    totalItemsCount: items.length,
    items,
  };
}

