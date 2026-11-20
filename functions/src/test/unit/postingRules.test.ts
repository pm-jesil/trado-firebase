/**
 * Unit Tests for Posting Rules & Double-Entry Journal Balancing (Phase 1, Task 1E)
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { Money } from "../../services/money.js";
import { STANDARD_ACCOUNTS, PostingEventCode } from "../../services/postingRules.js";

describe("Posting Rules & Financial Engine Unit Tests (Phase 1)", () => {
  describe("1. Minor Units Integer Arithmetic", () => {
    it("converts major to minor without precision drift", () => {
      assert.strictEqual(Money.toMinor(12.34, "INR"), 1234);
      assert.strictEqual(Money.toMinor(12.345, "BHD"), 12345);
      assert.strictEqual(Money.toMinor(100, "JPY"), 100);
      assert.strictEqual(Money.toMinor(0.01, "USD"), 1);
    });

    it("converts minor to major correctly", () => {
      assert.strictEqual(Money.fromMinor(1234, "INR"), 12.34);
      assert.strictEqual(Money.fromMinor(12345, "BHD"), 12.345);
      assert.strictEqual(Money.fromMinor(100, "JPY"), 100);
    });

    it("adds and subtracts minor units safely", () => {
      const a = Money.toMinor(10.50, "INR");
      const b = Money.toMinor(5.25, "INR");
      assert.strictEqual(Money.addMinor(a, b), 1575);
      assert.strictEqual(Money.subtractMinor(a, b), 525);
    });

    it("allocates minor units with zero remainder drift", () => {
      // Divide 100.00 (10000 minor units) across 3 ratios (1:1:1)
      const allocated = Money.allocateMinor(10000, [1, 1, 1]);
      assert.strictEqual(allocated.length, 3);
      assert.strictEqual(allocated.reduce((s, x) => s + x, 0), 10000);
      assert.deepStrictEqual(allocated, [3334, 3333, 3333]);
    });
  });

  describe("2. Standard Chart of Accounts Mapping", () => {
    it("has all foundational balance sheet and P&L accounts defined", () => {
      assert.strictEqual(STANDARD_ACCOUNTS.CASH.code, "1010");
      assert.strictEqual(STANDARD_ACCOUNTS.BANK.code, "1020");
      assert.strictEqual(STANDARD_ACCOUNTS.CLEARING.code, "1030");
      assert.strictEqual(STANDARD_ACCOUNTS.RECEIVABLE.code, "1200");
      assert.strictEqual(STANDARD_ACCOUNTS.INVENTORY.code, "1300");
      assert.strictEqual(STANDARD_ACCOUNTS.PAYABLE.code, "2100");
      assert.strictEqual(STANDARD_ACCOUNTS.TAX_OUTPUT.code, "2200");
      assert.strictEqual(STANDARD_ACCOUNTS.CAPITAL.code, "3000");
      assert.strictEqual(STANDARD_ACCOUNTS.SALES_REVENUE.code, "4000");
      assert.strictEqual(STANDARD_ACCOUNTS.COGS.code, "5000");
      assert.strictEqual(STANDARD_ACCOUNTS.PROCESSING_FEES.code, "6010");
    });
  });

  describe("3. Double-Entry Journal Invariant", () => {
    it("enforces debits === credits for balanced journal entries", () => {
      // Simulate Sale of 1,000 INR with 18% tax (180 INR)
      const gross = 1180;
      const net = 1000;
      const tax = 180;

      const journalLines = [
        { accountCode: STANDARD_ACCOUNTS.CASH.code, accountName: STANDARD_ACCOUNTS.CASH.name, debit: gross, credit: 0 },
        { accountCode: STANDARD_ACCOUNTS.SALES_REVENUE.code, accountName: STANDARD_ACCOUNTS.SALES_REVENUE.name, debit: 0, credit: net },
        { accountCode: STANDARD_ACCOUNTS.TAX_OUTPUT.code, accountName: STANDARD_ACCOUNTS.TAX_OUTPUT.name, debit: 0, credit: tax },
      ];

      const totalDebit = journalLines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = journalLines.reduce((s, l) => s + l.credit, 0);

      assert.strictEqual(Money.equal(totalDebit, totalCredit, "INR"), true);
      assert.strictEqual(totalDebit, 1180);
      assert.strictEqual(totalCredit, 1180);
    });

    it("detects imbalanced lines immediately", () => {
      const journalLines = [
        { accountCode: STANDARD_ACCOUNTS.CASH.code, accountName: STANDARD_ACCOUNTS.CASH.name, debit: 1000, credit: 0 },
        { accountCode: STANDARD_ACCOUNTS.SALES_REVENUE.code, accountName: STANDARD_ACCOUNTS.SALES_REVENUE.name, debit: 0, credit: 950 },
      ];

      const totalDebit = journalLines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = journalLines.reduce((s, l) => s + l.credit, 0);

      assert.strictEqual(Money.equal(totalDebit, totalCredit, "INR"), false);
    });
  });

  describe("4. Posting Event Coverage", () => {
    it("defines distinct event codes for all core business transitions", () => {
      const events: PostingEventCode[] = [
        "cash_sale",
        "credit_sale",
        "partial_sale",
        "split_tender_sale",
        "card_gateway_sale",
        "customer_payment",
        "cash_purchase",
        "credit_purchase",
        "vendor_payment",
        "expense_payment",
        "sales_return_refund",
        "sales_return_credit",
        "purchase_return_refund",
        "purchase_return_debit",
        "document_void_reversal",
        "account_transfer",
        "capital_contribution",
        "capital_drawings",
        "processing_fee_charge",
        "opening_balance",
        "manual_adjustment",
        "round_off_difference",
        "cod_cashier_handover",
        "stock_transfer_valuation",
        "bank_reconciliation",
      ];
      const uniqueEvents = new Set(events);
      assert.strictEqual(uniqueEvents.size, events.length, "All event codes must be unique");
    });
  });
});
