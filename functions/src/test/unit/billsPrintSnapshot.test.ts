import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBillPrintSnapshot } from "../../callables/bills/helpers.js";

describe("BC4.1 / Q-B8: Complete Print Snapshot for Bills/Receipts", () => {
  const sampleOrg = {
    name: "Trado Retail Store",
    legalName: "Trado Retail Private Limited",
    taxId: "27AABCU9603R1ZM",
    contactEmail: "billing@trado.org",
    contactPhone: "+919876543210",
    address: { street: "123 Market Rd", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
    bankAccounts: [
      {
        id: "ba_1",
        bankName: "HDFC Bank",
        accountHolderName: "Trado Retail Pvt Ltd",
        accountNumber: "50100012345678",
        routingType: "ifsc",
        routingCode: "HDFC0001234",
      },
    ],
  };

  const sampleBill = {
    billNumber: "INV-2026-00042",
    salesMode: "b2b",
    documentType: "invoice",
    createdAt: "2026-11-19T08:00:00.000Z",
    finalizedAt: "2026-11-19T08:05:00.000Z",
    billToSnapshot: {
      name: "Acme Enterprises",
      taxId: "27AAACA1234A1Z5",
      phone: "+919123456780",
      billingAddress: { street: "45 Industrial Area", city: "Pune", state: "MH", postalCode: "411001", country: "IN" },
    },
    items: [
      {
        lineId: "line_1",
        productId: "prod_widget_a",
        name: "Standard Steel Widget",
        sku: "WGT-A-01",
        quantity: 10,
        unit: "pcs",
        unitPrice: 10000, // ₹100.00
        discountAmount: 1000, // ₹10.00
        taxAmount: 1620, // 18% on ₹90.00 = ₹16.20
        taxRatePercent: 18,
        totalAmount: 10620,
      },
    ],
    subTotal: 100000,
    discountTotal: 10000,
    taxTotal: 16200,
    roundOff: 0,
    totalAmount: 106200,
    paidAmount: 50000,
    balanceAmount: 56200,
    taxSnapshot: {
      invoiceTitle: "TAX INVOICE",
      taxName: "GST",
      slabs: [
        { name: "CGST", ratePercent: 9, taxableAmount: 90000, amount: 8100 },
        { name: "SGST", ratePercent: 9, taxableAmount: 90000, amount: 8100 },
      ],
    },
  };

  it("Generates a versioned (version: 1) print snapshot with all required legal and financial fields [billsFinalize#ok] [billsGet#ok] [billsPreview#ok]", () => {
    const snap = buildBillPrintSnapshot(sampleOrg as any, sampleBill as any);

    assert.strictEqual(snap.version, 1);
    assert.strictEqual(snap.invoiceTitle, "TAX INVOICE");
    assert.strictEqual(snap.billNumber, "INV-2026-00042");
    assert.strictEqual(snap.organization.legalName, "Trado Retail Private Limited");
    assert.strictEqual(snap.organization.taxId, "27AABCU9603R1ZM");
    assert.strictEqual(snap.customer?.name, "Acme Enterprises");
    assert.strictEqual(snap.customer?.taxId, "27AAACA1234A1Z5");

    // Masked bank account verification
    assert.strictEqual(snap.organization.bankAccounts.length, 1);
    assert.strictEqual(snap.organization.bankAccounts[0].accountNumber, "****5678");
    assert.strictEqual(snap.organization.bankAccounts[0].bankName, "HDFC Bank");

    // Line items verification
    assert.strictEqual(snap.items.length, 1);
    assert.strictEqual(snap.items[0].unit, "pcs");
    assert.strictEqual(snap.items[0].quantity, 10);
    assert.strictEqual(snap.items[0].unitPrice, 10000);
    assert.strictEqual(snap.items[0].taxAmount, 1620);

    // Totals verification
    assert.strictEqual(snap.totals.subTotal, 100000);
    assert.strictEqual(snap.totals.discountTotal, 10000);
    assert.strictEqual(snap.totals.taxTotal, 16200);
    assert.strictEqual(snap.totals.totalAmount, 106200);
    assert.strictEqual(snap.totals.paidAmount, 50000);
    assert.strictEqual(snap.totals.balanceAmount, 56200);

    // Tax breakdown verification
    assert.strictEqual(snap.taxBreakdown.length, 2);
    assert.strictEqual(snap.taxBreakdown[0].name, "CGST");
    assert.strictEqual(snap.taxBreakdown[0].ratePercent, 9);
    assert.strictEqual(snap.taxBreakdown[1].name, "SGST");
    assert.strictEqual(snap.taxBreakdown[1].ratePercent, 9);
  });

  it("Falls back gracefully for retail walk-in bills without customer record or tax slabs [billsCreate#ok]", () => {
    const walkInBill = {
      billNumber: "POS-2026-00001",
      salesMode: "pos",
      documentType: "receipt",
      subTotal: 1500,
      totalAmount: 1500,
      paidAmount: 1500,
      balanceAmount: 0,
      items: [
        {
          lineId: "l1",
          productId: "prod_candy",
          name: "Candy Bar",
          quantity: 1,
          unit: "pcs",
          unitPrice: 1500,
          totalAmount: 1500,
        },
      ],
    };

    const snap = buildBillPrintSnapshot(sampleOrg as any, walkInBill as any);
    assert.strictEqual(snap.invoiceTitle, "RETAIL INVOICE");
    assert.strictEqual(snap.customer, null);
    assert.strictEqual(snap.totals.totalAmount, 1500);
    assert.strictEqual(snap.totals.balanceAmount, 0);
    assert.strictEqual(snap.organization.bankAccounts[0].accountNumber, "****5678");
  });
});
