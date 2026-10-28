/**
 * Costing Engine Pure Unit Tests
 * 
 * Verifies:
 * 1. Weighted-Average Cost (WAC) calculations with various stock & price states
 * 2. Inventory stock valuation
 * 3. COGS computation for sales invoice lines
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateNewWeightedAverageCost,
  calculateStockValuation,
  calculateCOGSForItems,
} from "../../services/costingEngine.js";
import { ProductDoc } from "../../types/models.js";

describe("Costing Engine — Weighted-Average Cost (WAC)", () => {
  it("initial purchase on zero stock sets exact purchase rate as WAC", () => {
    const wac = calculateNewWeightedAverageCost(0, 0, 100, 50);
    assert.strictEqual(wac, 50);
  });

  it("incoming purchase at higher price increases WAC proportionally", () => {
    // Current stock: 100 @ Rs 50 = Rs 5,000
    // Incoming: 50 @ Rs 80 = Rs 4,000
    // Total stock: 150, Total cost: Rs 9,000 -> New WAC = 9000 / 150 = 60
    const wac = calculateNewWeightedAverageCost(100, 50, 50, 80);
    assert.strictEqual(wac, 60);
  });

  it("incoming purchase at lower price decreases WAC proportionally", () => {
    // Current stock: 100 @ Rs 60 = Rs 6,000
    // Incoming: 100 @ Rs 40 = Rs 4,000
    // Total stock: 200, Total cost: Rs 10,000 -> New WAC = 10000 / 200 = 50
    const wac = calculateNewWeightedAverageCost(100, 60, 100, 40);
    assert.strictEqual(wac, 50);
  });

  it("handles decimal quantities and fractional costs with 4-decimal precision", () => {
    // Current stock: 10.5 @ Rs 33.3333
    // Incoming: 5.25 @ Rs 45.5000
    // (10.5 * 33.3333 + 5.25 * 45.5) / 15.75 = (349.99965 + 238.875) / 15.75 = 588.87465 / 15.75 = 37.38886...
    const wac = calculateNewWeightedAverageCost(10.5, 33.3333, 5.25, 45.5);
    assert.strictEqual(typeof wac, "number");
    assert.strictEqual(wac, 37.3889);
  });

  it("zero incoming quantity returns existing WAC unchanged", () => {
    const wac = calculateNewWeightedAverageCost(100, 55.5, 0, 99.9);
    assert.strictEqual(wac, 55.5);
  });
});

describe("Costing Engine — Stock Valuation & COGS", () => {
  it("calculates total stock valuation across products correctly", () => {
    const products: ProductDoc[] = [
      {
        organizationId: "org-1",
        name: "Item Alpha",
        nameKey: "item alpha",
        baseUnit: "piece",
        sellingPrice: 100,
        costPrice: 60,
        weightedAverageCost: 65,
        taxInclusive: false,
        hasExpiry: false,
        trackStock: true,
        currentStock: 100, // 100 * 65 = 6500
        lowStockThreshold: 10,
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: "admin",
      },
      {
        organizationId: "org-1",
        name: "Item Beta",
        nameKey: "item beta",
        baseUnit: "piece",
        sellingPrice: 50,
        costPrice: 30, // No WAC recorded; fallback to costPrice 30 * 50 = 1500
        taxInclusive: false,
        hasExpiry: false,
        trackStock: true,
        currentStock: 50,
        lowStockThreshold: 5,
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: "admin",
      },
    ];

    const result = calculateStockValuation(products);
    assert.strictEqual(result.totalItemsCount, 2);
    assert.strictEqual(result.totalStockValuation, 8000); // 6500 + 1500
    assert.strictEqual(result.items[0].valuation, 6500);
    assert.strictEqual(result.items[1].valuation, 1500);
  });

  it("calculates COGS for sold bill items based on product WAC", () => {
    const productMap = new Map<string, ProductDoc>();
    productMap.set("prod-1", {
      organizationId: "org-1",
      name: "Prod 1",
      nameKey: "prod 1",
      baseUnit: "piece",
      sellingPrice: 150,
      costPrice: 80,
      weightedAverageCost: 90,
      taxInclusive: false,
      hasExpiry: false,
      trackStock: true,
      currentStock: 50,
      lowStockThreshold: 10,
      isActive: true,
      createdAt: "",
      createdBy: "",
    });

    const items = [{ productId: "prod-1", quantity: 15 }];
    const cogs = calculateCOGSForItems(items, productMap);
    // 15 * 90 = 1350
    assert.strictEqual(cogs, 1350);
  });
});

