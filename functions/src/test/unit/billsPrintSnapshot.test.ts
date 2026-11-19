import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBillPrintSnapshot,
  buildPaymentPrintSnapshot,
  buildCreditNotePrintSnapshot,
} from "../../callables/bills/helpers.js";

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
    assert.strictEqual(snap.invoiceTitle, "SALES RECEIPT");
    assert.strictEqual(snap.customer, null);
    assert.strictEqual(snap.totals.totalAmount, 1500);
    assert.strictEqual(snap.totals.balanceAmount, 0);
    assert.strictEqual(snap.organization.bankAccounts[0].accountNumber, "****5678");
  });

  it("Generates a payment print snapshot for customer collections and vendor vouchers [paymentsCreate#ok]", () => {
    const customerPayment = {
      paymentNumber: "PAY-2026-000001",
      direction: "in",
      partyName: "Acme Enterprises",
      partyType: "customer",
      partyPhone: "+919123456780",
      partyTaxId: "27AAACA1234A1Z5",
      amount: 50000,
      method: "upi",
      referenceId: "INV-2026-00042",
      allocations: [{ documentId: "INV-2026-00042", documentType: "bill", amount: 50000 }],
      notes: "Advance installment via UPI",
      createdAt: "2026-11-19T09:00:00.000Z",
    };

    const receiptSnap = buildPaymentPrintSnapshot(sampleOrg as any, customerPayment as any);
    assert.strictEqual(receiptSnap.version, 1);
    assert.strictEqual(receiptSnap.voucherTitle, "PAYMENT RECEIPT");
    assert.strictEqual(receiptSnap.paymentNumber, "PAY-2026-000001");
    assert.strictEqual(receiptSnap.issueDate, "2026-11-19");
    assert.strictEqual(receiptSnap.amount, 50000);
    assert.strictEqual(receiptSnap.paymentMethod, "upi");
    assert.strictEqual(receiptSnap.party?.name, "Acme Enterprises");
    assert.strictEqual(receiptSnap.allocations.length, 1);
    assert.strictEqual(receiptSnap.organization.bankAccounts[0].accountNumber, "****5678");

    const vendorPayment = {
      paymentNumber: "PAY-2026-000002",
      direction: "out",
      partyName: "Steel Suppliers Ltd",
      partyType: "vendor",
      amount: 75000,
      method: "bank_transfer",
      allocations: [{ documentId: "PUR-2026-00010", documentType: "outflow", amount: 75000 }],
      createdAt: "2026-11-19T09:30:00.000Z",
    };

    const voucherSnap = buildPaymentPrintSnapshot(sampleOrg as any, vendorPayment as any);
    assert.strictEqual(voucherSnap.voucherTitle, "PAYMENT VOUCHER");
    assert.strictEqual(voucherSnap.direction, "out");
    assert.strictEqual(voucherSnap.amount, 75000);
  });

  it("Generates a credit note print snapshot for sales returns [returnsCreate#ok]", () => {
    const salesReturn = {
      returnNumber: "RET-2026-000001",
      returnType: "sales_return",
      referenceId: "INV-2026-00042",
      customerSnapshot: {
        name: "Acme Enterprises",
        phone: "+919123456780",
        taxId: "27AAACA1234A1Z5",
        address: "45 Industrial Area, Pune",
      },
      items: [
        {
          sourceLineId: "line_1",
          productId: "prod_widget_a",
          name: "Standard Steel Widget",
          quantity: 2,
          unitPrice: 10000,
          refundAmount: 21240,
          reason: "Damaged packaging",
          disposition: "restocked_to_inventory",
        },
      ],
      totalRefundAmount: 21240,
      refundMethod: "credit_note",
      notes: "Customer accepted store credit",
      createdAt: "2026-11-19T10:00:00.000Z",
    };

    const cnSnap = buildCreditNotePrintSnapshot(sampleOrg as any, salesReturn as any);
    assert.strictEqual(cnSnap.version, 1);
    assert.strictEqual(cnSnap.documentTitle, "CREDIT NOTE");
    assert.strictEqual(cnSnap.returnNumber, "RET-2026-000001");
    assert.strictEqual(cnSnap.issueDate, "2026-11-19");
    assert.strictEqual(cnSnap.referenceId, "INV-2026-00042");
    assert.strictEqual(cnSnap.customer?.name, "Acme Enterprises");
    assert.strictEqual(cnSnap.items.length, 1);
    assert.strictEqual(cnSnap.items[0].quantity, 2);
    assert.strictEqual(cnSnap.items[0].refundAmount, 21240);
    assert.strictEqual(cnSnap.totalRefundAmount, 21240);
    assert.strictEqual(cnSnap.refundMethod, "credit_note");
    assert.strictEqual(cnSnap.organization.bankAccounts[0].accountNumber, "****5678");

    const purchaseReturn = {
      returnNumber: "RET-2026-000002",
      returnType: "purchase_return",
      referenceId: "PUR-2026-00010",
      totalRefundAmount: 15000,
    };
    const dnSnap = buildCreditNotePrintSnapshot(sampleOrg as any, purchaseReturn as any);
    assert.strictEqual(dnSnap.documentTitle, "DEBIT NOTE");
  });

  it("Honors printOnInvoice: true to publish full account number on invoices while masking others (Q-F7)", () => {
    const orgWithPublishedBank = {
      ...sampleOrg,
      bankAccounts: [
        {
          id: "ba_pub",
          bankName: "HDFC Bank",
          accountHolderName: "Trado Retail Pvt Ltd",
          accountNumber: "50100012345678",
          routingType: "ifsc",
          routingCode: "HDFC0001234",
          printOnInvoice: true,
        },
        {
          id: "ba_priv",
          bankName: "ICICI Bank",
          accountHolderName: "Trado Retail Pvt Ltd",
          accountNumber: "12345678901234",
          routingType: "ifsc",
          routingCode: "ICIC0001234",
          printOnInvoice: false,
        },
      ],
    };

    const snap = buildBillPrintSnapshot(orgWithPublishedBank as any, sampleBill as any);
    assert.strictEqual(snap.organization.bankAccounts[0].accountNumber, "50100012345678", "Published bank account should display unmasked");
    assert.strictEqual(snap.organization.bankAccounts[1].accountNumber, "****1234", "Private bank account should remain masked");
  });
});
