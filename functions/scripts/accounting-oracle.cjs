/**
 * Independent Accounting, Inventory, and Reporting Oracle
 * 
 * Separate test-only oracle outside production services.
 * Calculates independent expected values for:
 * 1. Weighted-Average Cost (WAC) with 4-decimal precision
 * 2. Per-branch stock balances and org-level stock mirrors
 * 3. Customer outstanding balances and vendor payables
 * 4. P&L: Revenue, COGS, Gross Profit, Operating Expenses, Net Profit
 * 5. Inventory Stock Valuation
 */

function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function round4(num) {
  return Math.round((num + Number.EPSILON) * 10000) / 10000;
}

class AccountingOracle {
  constructor() {
    this.events = [];
    this.products = new Map(); // productId -> { name, currentStockByBranch: Map, wac, costPrice, sellingPrice }
    this.customers = new Map(); // customerId -> { name, currentBalance, totalSales }
    this.vendors = new Map(); // vendorId -> { name, outstandingPayable, totalPurchases }
    this.bills = new Map(); // billId -> { ... }
    this.outflows = new Map(); // outflowId -> { ... }
  }

  registerProduct(productId, { name, costPrice, sellingPrice, initialStock = 0, branchId = "main-branch" }) {
    const stockMap = new Map();
    stockMap.set(branchId, initialStock);
    this.products.set(productId, {
      name,
      costPrice,
      sellingPrice,
      wac: costPrice,
      currentStockByBranch: stockMap,
    });
  }

  registerCustomer(customerId, { name, initialBalance = 0 }) {
    this.customers.set(customerId, {
      name,
      currentBalance: initialBalance,
      totalSales: 0,
    });
  }

  registerVendor(vendorId, { name, initialPayable = 0 }) {
    this.vendors.set(vendorId, {
      name,
      outstandingPayable: initialPayable,
      totalPurchases: 0,
    });
  }

  recordPurchase({ outflowId, branchId = "main-branch", vendorId, items, paidAmount = 0 }) {
    let subtotal = 0;
    for (const item of items) {
      const prod = this.products.get(item.productId);
      if (!prod) throw new Error(`Oracle: Unknown product ${item.productId}`);

      const prevBranchStock = prod.currentStockByBranch.get(branchId) || 0;
      const prevTotalStock = Array.from(prod.currentStockByBranch.values()).reduce((a, b) => a + b, 0);
      const prevWac = prod.wac;

      // Calculate new WAC using canonical formula
      let newWac;
      if (prevTotalStock <= 0 || prevWac <= 0) {
        newWac = round4(item.unitPrice);
      } else {
        const rawWac = ((prevTotalStock * prevWac) + (item.quantity * item.unitPrice)) / (prevTotalStock + item.quantity);
        newWac = round4(rawWac);
      }

      prod.wac = newWac;
      prod.currentStockByBranch.set(branchId, prevBranchStock + item.quantity);

      subtotal += item.quantity * item.unitPrice;
      this.events.push({
        type: "PURCHASE",
        outflowId,
        branchId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        prevWac,
        newWac,
        prevBranchStock,
        newBranchStock: prevBranchStock + item.quantity,
      });
    }

    const totalAmount = round2(subtotal);
    const balanceAmount = round2(Math.max(0, totalAmount - paidAmount));

    if (vendorId && this.vendors.has(vendorId)) {
      const v = this.vendors.get(vendorId);
      v.totalPurchases = round2(v.totalPurchases + totalAmount);
      v.outstandingPayable = round2(v.outstandingPayable + balanceAmount);
    }

    this.outflows.set(outflowId, {
      kind: "purchase",
      branchId,
      totalAmount,
      paidAmount,
      balanceAmount,
    });
  }

  recordExpense({ outflowId, branchId = "main-branch", totalAmount, paidAmount = totalAmount }) {
    this.outflows.set(outflowId, {
      kind: "expense",
      branchId,
      totalAmount: round2(totalAmount),
      paidAmount: round2(paidAmount),
      balanceAmount: round2(Math.max(0, totalAmount - paidAmount)),
    });
    this.events.push({
      type: "EXPENSE",
      outflowId,
      branchId,
      totalAmount: round2(totalAmount),
    });
  }

  recordSale({ billId, branchId = "main-branch", customerId, items, paidAmount = 0 }) {
    let subtotal = 0;
    const itemRecords = [];

    for (const item of items) {
      const prod = this.products.get(item.productId);
      if (!prod) throw new Error(`Oracle: Unknown product ${item.productId}`);

      const prevBranchStock = prod.currentStockByBranch.get(branchId) || 0;
      prod.currentStockByBranch.set(branchId, prevBranchStock - item.quantity);

      const lineTotal = round2(item.quantity * item.unitPrice);
      subtotal += lineTotal;

      itemRecords.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        costSnapshot: prod.wac,
      });

      this.events.push({
        type: "SALE",
        billId,
        branchId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        cogs: round2(item.quantity * prod.wac),
        prevBranchStock,
        newBranchStock: prevBranchStock - item.quantity,
      });
    }

    const totalAmount = round2(subtotal);
    const balanceAmount = round2(Math.max(0, totalAmount - paidAmount));

    if (customerId && this.customers.has(customerId)) {
      const c = this.customers.get(customerId);
      c.totalSales = round2(c.totalSales + totalAmount);
      c.currentBalance = round2(c.currentBalance + balanceAmount);
    }

    this.bills.set(billId, {
      branchId,
      totalAmount,
      paidAmount,
      balanceAmount,
      items: itemRecords,
    });
  }

  recordCustomerPayment({ customerId, amount, billId }) {
    const c = this.customers.get(customerId);
    if (c) {
      c.currentBalance = round2(Math.max(0, c.currentBalance - amount));
    }
    if (billId && this.bills.has(billId)) {
      const b = this.bills.get(billId);
      b.paidAmount = round2(b.paidAmount + amount);
      b.balanceAmount = round2(Math.max(0, b.totalAmount - b.paidAmount));
    }
    this.events.push({ type: "CUSTOMER_PAYMENT", customerId, amount, billId });
  }

  recordVendorPayment({ vendorId, amount, outflowId }) {
    const v = this.vendors.get(vendorId);
    if (v) {
      v.outstandingPayable = round2(Math.max(0, v.outstandingPayable - amount));
    }
    if (outflowId && this.outflows.has(outflowId)) {
      const o = this.outflows.get(outflowId);
      o.paidAmount = round2(o.paidAmount + amount);
      o.balanceAmount = round2(Math.max(0, o.totalAmount - o.paidAmount));
    }
    this.events.push({ type: "VENDOR_PAYMENT", vendorId, amount, outflowId });
  }

  recordStockAdjustment({ productId, branchId = "main-branch", quantity, reason }) {
    const prod = this.products.get(productId);
    if (!prod) throw new Error(`Oracle: Unknown product ${productId}`);

    const prevBranchStock = prod.currentStockByBranch.get(branchId) || 0;
    prod.currentStockByBranch.set(branchId, prevBranchStock + quantity);

    this.events.push({
      type: "STOCK_ADJUSTMENT",
      productId,
      branchId,
      quantity,
      reason,
      prevBranchStock,
      newBranchStock: prevBranchStock + quantity,
    });
  }

  recordSalesReturn({ billId, branchId = "main-branch", customerId, items, disposition = "restocked_to_inventory", refundMethod = "credit_note" }) {
    let refundTotal = 0;
    for (const item of items) {
      const prod = this.products.get(item.productId);
      if (!prod) throw new Error(`Oracle: Unknown product ${item.productId}`);

      if (disposition === "restocked_to_inventory") {
        const prevBranchStock = prod.currentStockByBranch.get(branchId) || 0;
        prod.currentStockByBranch.set(branchId, prevBranchStock + item.quantity);
      }

      refundTotal += item.refundAmount;
      this.events.push({
        type: "SALES_RETURN",
        billId,
        branchId,
        productId: item.productId,
        quantity: item.quantity,
        refundAmount: item.refundAmount,
        disposition,
      });
    }

    if (customerId && refundMethod === "credit_note" && this.customers.has(customerId)) {
      const c = this.customers.get(customerId);
      c.currentBalance = round2(Math.max(0, c.currentBalance - refundTotal));
    }
  }

  getExpectedProfitLoss(branchId = null) {
    let grossRevenue = 0;
    let grossCogs = 0;
    let billCount = 0;

    for (const [id, bill] of this.bills.entries()) {
      if (branchId && bill.branchId !== branchId) continue;
      grossRevenue += bill.totalAmount;
      billCount++;
      for (const item of bill.items) {
        grossCogs += item.quantity * item.costSnapshot;
      }
    }

    let salesReturns = 0;
    let cogsReversals = 0;
    let returnCount = 0;

    for (const event of this.events) {
      if (event.type === "SALES_RETURN") {
        if (branchId && event.branchId !== branchId) continue;
        salesReturns += event.refundAmount;
        returnCount++;
        if (event.disposition === "restocked_to_inventory") {
          const originalBill = this.bills.get(event.billId);
          const billItem = originalBill?.items.find((i) => i.productId === event.productId);
          const cost = billItem && billItem.costSnapshot > 0
            ? billItem.costSnapshot
            : (this.products.get(event.productId)?.wac || 0);
          cogsReversals += event.quantity * cost;
        }
      }
    }

    grossRevenue = round2(grossRevenue);
    salesReturns = round2(salesReturns);
    const netRevenue = round2(Math.max(0, grossRevenue - salesReturns));

    grossCogs = round2(grossCogs);
    cogsReversals = round2(cogsReversals);
    const netCogs = round2(Math.max(0, grossCogs - cogsReversals));

    let totalExpenses = 0;
    let outflowCount = 0;

    for (const [id, outflow] of this.outflows.entries()) {
      if (branchId && outflow.branchId !== branchId) continue;
      outflowCount++;
      if (outflow.kind === "expense") {
        totalExpenses += outflow.totalAmount;
      }
    }

    totalExpenses = round2(totalExpenses);
    const grossProfit = round2(netRevenue - netCogs);
    const grossMarginPercent = netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : 0;
    const netProfit = round2(grossProfit - totalExpenses);
    const netMarginPercent = netRevenue > 0 ? round2((netProfit / netRevenue) * 100) : 0;

    return {
      grossRevenue,
      salesReturns,
      netRevenue,
      totalRevenue: netRevenue,
      grossCogs,
      cogsReversals,
      netCogs,
      cogs: netCogs,
      grossProfit,
      grossMarginPercent,
      operatingExpenses: totalExpenses,
      totalExpenses,
      netProfit,
      netMarginPercent,
      billCount,
      returnCount,
      outflowCount,
    };
  }

  getExpectedStockValuation(branchId = null) {
    let totalStockValuation = 0;
    let totalItemsCount = 0;
    const items = [];

    for (const [productId, prod] of this.products.entries()) {
      let stock = 0;
      if (branchId) {
        stock = prod.currentStockByBranch.get(branchId) || 0;
      } else {
        stock = Array.from(prod.currentStockByBranch.values()).reduce((a, b) => a + b, 0);
      }
      const valuation = round2(stock * prod.wac);
      totalStockValuation += valuation;
      totalItemsCount++;
      items.push({
        productId,
        name: prod.name,
        currentStock: stock,
        wac: prod.wac,
        valuation,
      });
    }

    return {
      totalStockValuation: round2(totalStockValuation),
      totalItemsCount,
      items,
    };
  }

  getExpectedStock(productId, branchId = null) {
    const prod = this.products.get(productId);
    if (!prod) return 0;
    if (branchId) {
      return prod.currentStockByBranch.get(branchId) || 0;
    }
    return Array.from(prod.currentStockByBranch.values()).reduce((a, b) => a + b, 0);
  }

  getExpectedWac(productId) {
    const prod = this.products.get(productId);
    return prod ? prod.wac : 0;
  }

  getExpectedCustomerBalance(customerId) {
    const c = this.customers.get(customerId);
    return c ? c.currentBalance : 0;
  }

  getExpectedVendorPayable(vendorId) {
    const v = this.vendors.get(vendorId);
    return v ? v.outstandingPayable : 0;
  }
}

module.exports = { AccountingOracle, round2, round4 };

