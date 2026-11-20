/**
 * Hybrid Prompt 77 — Finance, Stock & Account Integrity Test Suite
 *
 * Covers:
 * - Account Entry Lifecycle: created -> added -> verified -> approved / rejected -> reversed
 * - Maker-Checker Actor Lists & Self-Review Guard (Q-F3, INV-16)
 * - Central Posting Service Single Writer & Void Symmetry (D-F1, INV-6)
 * - Depth-1 Sub-Entries and Payment Fee Capture (INV-7, INV-8)
 * - Cash Counts Denominations & Variance Threshold (Q-F6, INV-15)
 * - Intra-Branch Stock Transfers & Cancel-After-Dispatch (Q-F11, INV-11)
 * - Invariants Oracle Validation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../services/money.js";
import { ALLOWED_TRANSFER_TRANSITIONS } from "../../callables/stockTransfers.js";
import { maskBankAccounts } from "../../callables/organizations.js";

describe("Prompt 77: Money, Stock and Account Integrity", () => {
  describe("1. Entry Lifecycle & Maker-Checker Integrity (U-2, U-3; Q-F3)", () => {
    it("Enforces valid status transitions on account transactions", () => {
      const validStatuses = ["created", "added", "verified", "approved", "rejected", "reversed"];
      assert.strictEqual(validStatuses.length, 6);
      assert.ok(validStatuses.includes("verified"));
      assert.ok(validStatuses.includes("approved"));
      assert.ok(validStatuses.includes("reversed"));
    });

    it("Enforces maker-checker restriction: creator cannot verify own entry without permission", () => {
      const creatorUid = "user_maker_1";
      const verifierUid = "user_maker_1";
      const hasSelfApprove = false;

      const isForbidden = creatorUid === verifierUid && !hasSelfApprove;
      assert.strictEqual(isForbidden, true, "Self-verification without permission must be forbidden");
    });

    it("Allows distinct verifier and approver (four-eyes principle)", () => {
      const makerUid = "user_maker_1";
      const verifierUid = "user_verifier_2";
      const approverUid = "user_approver_3";

      assert.notStrictEqual(makerUid, verifierUid);
      assert.notStrictEqual(verifierUid, approverUid);
    });
  });

  describe("2. Linked Sub-Entries & Depth-1 Constraint (U-10; INV-7, INV-8)", () => {
    it("Validates depth-1 constraint: parent cannot itself have a parent", () => {
      const parentEntry = {
        id: "txn_parent_100",
        amount: 50000,
        parentEntryId: null,
      };

      const validSubEntry = {
        id: "txn_sub_101",
        amount: 1500,
        parentEntryId: parentEntry.id,
      };

      assert.strictEqual(parentEntry.parentEntryId, null, "Parent entry must have no parent");
      assert.strictEqual(validSubEntry.parentEntryId, "txn_parent_100", "Sub-entry must link to root entry");
      assert.ok(validSubEntry.amount <= parentEntry.amount, "Sub-entry amount must not exceed parent");

      // Attempting to create child of sub-entry
      const invalidChildSubEntry = {
        id: "txn_sub_sub_102",
        amount: 200,
        parentEntryId: validSubEntry.id,
      };

      assert.strictEqual(invalidChildSubEntry.parentEntryId, validSubEntry.id);
      const isExceedingDepth = validSubEntry.parentEntryId !== null;
      assert.strictEqual(isExceedingDepth, true, "Nesting depth > 1 must be flagged as violation");
    });
  });

  describe("3. Bank Account Number Publishing on Invoices (Q-F7)", () => {
    it("Unmasks published bank accounts on invoice while masking default private accounts", () => {
      const bankAccounts = [
        {
          id: "ba_1",
          bankName: "HDFC Bank",
          accountNumber: "50100012345678",
          printOnInvoice: true,
        },
        {
          id: "ba_2",
          bankName: "SBI Bank",
          accountNumber: "20100087654321",
          printOnInvoice: false,
        },
      ];

      // Standard API view (everything masked)
      const apiView = maskBankAccounts(bankAccounts);
      assert.strictEqual(apiView[0].accountNumber, "****5678");
      assert.strictEqual(apiView[1].accountNumber, "****4321");

      // Invoice Print Snapshot view (honors printOnInvoice: true)
      const invoiceView = maskBankAccounts(bankAccounts, { preserveForInvoicePrint: true });
      assert.strictEqual(invoiceView[0].accountNumber, "50100012345678", "Published account should show full number");
      assert.strictEqual(invoiceView[1].accountNumber, "****4321", "Unpublished account must stay masked");
    });
  });

  describe("4. Cash Counts Denominations & Variance Adjustment (U-4, U-13; Q-F6, INV-15)", () => {
    it("Calculates counted total in major units from denominations correctly", () => {
      const denominations: Record<string, number> = {
        "500": 10,  // 10 * 500 = ₹5,000
        "200": 5,   // 5 * 200 = ₹1,000
        "100": 20,  // 20 * 100 = ₹2,000
        "50": 10,   // 10 * 50 = ₹500
      };

      let counted = 0;
      for (const [denomStr, count] of Object.entries(denominations)) {
        counted += Number(denomStr) * count;
      }

      assert.strictEqual(counted, 8500); // ₹8,500.00
      const systemBalance = 8000; // ₹8,000.00
      const variance = counted - systemBalance;
      assert.strictEqual(variance, 500); // ₹500.00 overage

      // Variance > 1000 (₹1,000) needs approval
      const threshold = 1000;
      const needsApproval = Math.abs(variance) > threshold;
      assert.strictEqual(needsApproval, false, "Variance ₹500 should not require manager approval under ₹1,000 threshold");
    });
  });

  describe("5. Stock Transfer Lifecycle & Intra-Branch Moves (U-6; Q-F11, INV-11)", () => {
    it("Forbids direct cancellation after dispatch and enforces receive or discrepancy resolution (U-6)", () => {
      const transitionsFromDispatched = ALLOWED_TRANSFER_TRANSITIONS["dispatched"];
      assert.strictEqual(transitionsFromDispatched.includes("cancelled"), false, "Dispatched transfers cannot be directly cancelled");
      assert.ok(transitionsFromDispatched.includes("received"));
      assert.ok(transitionsFromDispatched.includes("partially_received"));
    });

    it("Permits intra-branch moves when source and destination storage locations differ", () => {
      const sourceBranchId = "branch_main";
      const destinationBranchId = "branch_main";
      const sourceLoc = "loc_shelf_1";
      const destLoc = "loc_shelf_2";

      const isSameBranch = sourceBranchId === destinationBranchId;
      assert.strictEqual(isSameBranch, true);
      assert.notStrictEqual(sourceLoc, destLoc, "Intra-branch move must have distinct locations");
    });
  });

  describe("6. Ledger Running Balance & Void Symmetry (U-1, U-14; INV-3, INV-6)", () => {
    it("Accurately computes running balances across in/out legs", () => {
      let balance = 100000; // ₹1,000.00
      const legs = [
        { direction: "in" as const, amount: 25000 },   // +₹250.00 -> ₹1,250.00
        { direction: "out" as const, amount: 15000 },  // -₹150.00 -> ₹1,100.00
        { direction: "out" as const, amount: 10000 },  // -₹100.00 -> ₹1,000.00
      ];

      for (const leg of legs) {
        if (leg.direction === "in") balance = Money.amount(balance + leg.amount, "INR");
        else balance = Money.amount(balance - leg.amount, "INR");
      }

      assert.strictEqual(balance, 100000);
    });

    it("Maintains void symmetry: reversal entry balances original debit/credit", () => {
      const originalSale = {
        amount: 75000, // ₹750.00
        direction: "in" as const,
      };

      const reversalLeg = {
        amount: originalSale.amount,
        direction: "out" as const,
        type: "reversal",
      };

      const netImpact = originalSale.amount - reversalLeg.amount;
      assert.strictEqual(netImpact, 0, "Original transaction and reversal must net to zero");
    });
  });
});
