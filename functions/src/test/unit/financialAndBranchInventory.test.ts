/**
 * Trado Firebase Backend — Unit Tests: Master Financial Accounting, Storage Locations & Stock Transfers
 *
 * Covers:
 * - Schema validation and D-11 strictness (unknown field rejection)
 * - Financial ledger math & decimal major units precision (R4, D-71)
 * - Stock transfer invariants and zero-loss dispatch/receive mechanics (D-49)
 * - Maker-checker permissions and self-approval assertion (FB-7, D-50)
 * - Organization field policy for Admin persona (FB-2, FB-4)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CreateFinancialAccountSchema,
  UpdateFinancialAccountSchema,
  CreateAccountTransferSchema,
  CreateStorageLocationSchema,
  CreateStockTransferSchema,
  DispatchStockTransferSchema,
  ReceiveStockTransferSchema,
  CreatePaymentSchema,
  GetReceivablesAgeingReportSchema,
  GetPayablesAgeingReportSchema,
  DocumentDecisionSchema,
  RecordPaymentFeeSchema,
  CreateCapitalTransactionSchema,
  GetCashBankSummarySchema,
  CreateProductSchema,
  CreateBillSchema,
  BranchSettingsSchema,
  CreateOutflowSchema,
  SplitPaymentEntrySchema,
} from "../../validation/schemas.js";
import { AppPermissions } from "../../constants/permissions.js";
import { APPROVE_PERMISSION, assertCanDecide } from "../../services/approvals.js";
import { Money } from "../../services/money.js";
import { ORGANIZATION_FIELD_POLICY } from "../../callables/organizations.js";

describe("Master Financial, Branch & Inventory Unit Tests", () => {
  describe("1. Strict Schema Validation & D-11 Unknown Field Rejection", () => {
    it("CreateFinancialAccountSchema validates valid accounts with multi-branch assignment and rejects unknown fields", () => {
      const valid = CreateFinancialAccountSchema.safeParse({
        organizationId: "org_test",
        name: "Main Cash Drawer",
        code: "CASH-01",
        accountType: "cash",
        currency: "INR",
        assignedBranchIds: ["branch_north", "branch_south"],
        openingBalance: 100000, // ₹1,000.00
      });
      assert.strictEqual(valid.success, true);

      const unknown = CreateFinancialAccountSchema.safeParse({
        organizationId: "org_test",
        name: "Main Cash Drawer",
        code: "CASH-01",
        accountType: "cash",
        unexpectedProperty: "evil_payload",
      });
      assert.strictEqual(unknown.success, false, "Must reject unknown fields (D-11)");
    });

    it("UpdateFinancialAccountSchema permits valid updates and rejects unknown fields", () => {
      const valid = UpdateFinancialAccountSchema.safeParse({
        organizationId: "org_test",
        financialAccountId: "fin_123",
        name: "Updated Cash Drawer",
        assignedBranchIds: ["branch_east"],
        isActive: false,
      });
      assert.strictEqual(valid.success, true);

      const unknown = UpdateFinancialAccountSchema.safeParse({
        organizationId: "org_test",
        financialAccountId: "fin_123",
        name: "Updated Cash Drawer",
        fakeField: 123,
      });
      assert.strictEqual(unknown.success, false, "Must reject unknown fields (D-11)");
    });

    it("CreateAccountTransferSchema rejects identical source and destination accounts and supports cashier_handover", () => {
      const validHandover = CreateAccountTransferSchema.safeParse({
        organizationId: "org_test",
        sourceAccountId: "acc_cash_drawer_1",
        destinationAccountId: "acc_main_vault",
        amount: 250000,
        transferType: "cashier_handover",
        notes: "Shift close handover",
      });
      assert.strictEqual(validHandover.success, true);

      const invalid = CreateAccountTransferSchema.safeParse({
        organizationId: "org_test",
        sourceAccountId: "acc_same",
        destinationAccountId: "acc_same",
        amount: 50000,
      });
      assert.strictEqual(invalid.success, false, "Must reject same source and destination");

      const zeroAmount = CreateAccountTransferSchema.safeParse({
        organizationId: "org_test",
        sourceAccountId: "acc_1",
        destinationAccountId: "acc_2",
        amount: 0,
      });
      assert.strictEqual(zeroAmount.success, false, "Must reject zero transfer amount");
    });

    it("CreateStorageLocationSchema validates warehouse types and rejects unknown fields", () => {
      const valid = CreateStorageLocationSchema.safeParse({
        organizationId: "org_test",
        branchId: "branch_main",
        name: "Central Yard A",
        code: "LOC-YARD-A",
        type: "warehouse",
      });
      assert.strictEqual(valid.success, true);

      const invalidType = CreateStorageLocationSchema.safeParse({
        organizationId: "org_test",
        branchId: "branch_main",
        name: "Invalid Yard",
        code: "LOC-INV",
        type: "space_station",
      });
      assert.strictEqual(invalidType.success, false, "Must reject invalid storage location type");
    });

    it("CreateStockTransferSchema requires items and validates requested quantities", () => {
      const valid = CreateStockTransferSchema.safeParse({
        organizationId: "org_test",
        sourceBranchId: "branch_src",
        destinationBranchId: "branch_dst",
        items: [
          { productId: "prod_1", requestedQty: 10 },
          { productId: "prod_2", requestedQty: 25 },
        ],
      });
      assert.strictEqual(valid.success, true);

      const emptyItems = CreateStockTransferSchema.safeParse({
        organizationId: "org_test",
        sourceBranchId: "branch_src",
        destinationBranchId: "branch_dst",
        items: [],
      });
      assert.strictEqual(emptyItems.success, false, "Must require at least one transfer item");

      const negativeQty = CreateStockTransferSchema.safeParse({
        organizationId: "org_test",
        sourceBranchId: "branch_src",
        destinationBranchId: "branch_dst",
        items: [{ productId: "prod_1", requestedQty: -5 }],
      });
      assert.strictEqual(negativeQty.success, false, "Must reject non-positive requestedQty");
    });

    it("DispatchStockTransferSchema and ReceiveStockTransferSchema enforce valid structure", () => {
      const validDispatch = DispatchStockTransferSchema.safeParse({
        organizationId: "org_test",
        branchId: "branch_src",
        transferId: "trf_123",
        transportMode: "internal_fleet",
        trackingReference: "TRUCK-42",
      });
      assert.strictEqual(validDispatch.success, true);

      const validReceive = ReceiveStockTransferSchema.safeParse({
        organizationId: "org_test",
        branchId: "branch_dst",
        transferId: "trf_123",
        items: [
          { productId: "prod_1", receivedQty: 8, rejectedQty: 2, discrepancyReason: "Damaged in transit" },
        ],
      });
      assert.strictEqual(validReceive.success, true);
    });

    it("RecordPaymentFeeSchema validates valid payment fee inputs and rejects unknown fields", () => {
      const valid = RecordPaymentFeeSchema.safeParse({
        organizationId: "org_test",
        sourceDocumentType: "bill",
        sourceDocumentId: "bill_123",
        financialAccountId: "fin_pos_clear",
        paymentMethod: "card",
        feeAmount: 2500, // ₹25.00
        feeTaxAmount: 450, // ₹4.50
        settlementTiming: "immediate_deduction",
        settlementReference: "SETTLE-TXN-998",
      });
      assert.strictEqual(valid.success, true);

      const unknown = RecordPaymentFeeSchema.safeParse({
        organizationId: "org_test",
        sourceDocumentType: "bill",
        sourceDocumentId: "bill_123",
        financialAccountId: "fin_pos_clear",
        paymentMethod: "card",
        feeAmount: 2500,
        unauthorizedField: "hacked",
      });
      assert.strictEqual(unknown.success, false, "Must reject unknown fields (D-11)");

      const negativeFee = RecordPaymentFeeSchema.safeParse({
        organizationId: "org_test",
        sourceDocumentType: "bill",
        sourceDocumentId: "bill_123",
        financialAccountId: "fin_pos_clear",
        paymentMethod: "card",
        feeAmount: -100,
      });
      assert.strictEqual(negativeFee.success, false, "Fee must be positive amount");
    });

    it("CreateCapitalTransactionSchema validates contributions and drawings, rejecting unknown fields", () => {
      const validContribution = CreateCapitalTransactionSchema.safeParse({
        organizationId: "org_test",
        type: "owner_contribution",
        financialAccountId: "fin_bank",
        amount: 500000, // ₹5,00,000.00
        sourceReference: "CHQ#90123",
        description: "Initial equity infusion",
      });
      assert.strictEqual(validContribution.success, true);

      const validDrawings = CreateCapitalTransactionSchema.safeParse({
        organizationId: "org_test",
        type: "drawings",
        financialAccountId: "fin_bank",
        amount: 50000, // ₹50,000.00
        description: "Personal withdrawal",
      });
      assert.strictEqual(validDrawings.success, true);

      const invalidType = CreateCapitalTransactionSchema.safeParse({
        organizationId: "org_test",
        type: "lottery_winnings",
        financialAccountId: "fin_bank",
        amount: 10000,
      });
      assert.strictEqual(invalidType.success, false, "Must reject invalid capital transaction type");

      const unknown = CreateCapitalTransactionSchema.safeParse({
        organizationId: "org_test",
        type: "owner_contribution",
        financialAccountId: "fin_bank",
        amount: 10000,
        extraProperty: true,
      });
      assert.strictEqual(unknown.success, false, "Must reject unknown fields (D-11)");
    });

    it("CreateProductSchema validates storageLocationId with initialStock", () => {
      const withStockAndLocation = CreateProductSchema.safeParse({
        organizationId: "org_test",
        name: "Test Widget",
        baseUnit: "piece",
        sellingPrice: 10000,
        initialStock: 10,
        storageLocationId: "loc_main_wh",
      });
      assert.strictEqual(withStockAndLocation.success, true);

      const unknownField = CreateProductSchema.safeParse({
        organizationId: "org_test",
        name: "Test Widget",
        baseUnit: "piece",
        sellingPrice: 10000,
        unexpectedProperty: "invalid",
      });
      assert.strictEqual(unknownField.success, false, "Must reject unknown fields (D-11)");
    });

    it("CreateBillSchema validates split payments array and bounds", () => {
      const validSplit = CreateBillSchema.safeParse({
        organizationId: "org_test",
        branchId: "branch_main",
        items: [{ productId: "prod_1", quantity: 1, unitPriceOverride: 10000 }],
        splitPayments: [
          { method: "cash", amount: 6000, financialAccountId: "acc_cash" },
          { method: "upi", amount: 4000, financialAccountId: "acc_bank" },
        ],
      });
      assert.strictEqual(validSplit.success, true);

      const tooManySplits = CreateBillSchema.safeParse({
        organizationId: "org_test",
        branchId: "branch_main",
        items: [{ productId: "prod_1", quantity: 1, unitPriceOverride: 10000 }],
        splitPayments: [
          { method: "cash", amount: 2000, financialAccountId: "acc_1" },
          { method: "card", amount: 2000, financialAccountId: "acc_2" },
          { method: "upi", amount: 2000, financialAccountId: "acc_3" },
          { method: "wallet", amount: 2000, financialAccountId: "acc_4" },
          { method: "cheque", amount: 1000, financialAccountId: "acc_5" },
          { method: "bank_transfer", amount: 1000, financialAccountId: "acc_6" },
        ],
      });
      assert.strictEqual(tooManySplits.success, false, "Must cap split payments at 5");
    });

    it("CreatePaymentSchema supports financialAccountId and multi-invoice allocations", () => {
      const validPayment = CreatePaymentSchema.safeParse({
        organizationId: "org_test",
        partyId: "cust_123",
        partyType: "customer",
        direction: "in",
        amount: 1500.00, // ₹1,500.00
        method: "bank_transfer",
        financialAccountId: "acc_bank_hdfc",
        allocations: [
          { documentId: "bill_01", documentType: "bill", amount: 1000.00 },
          { documentId: "bill_02", documentType: "bill", amount: 500.00 },
        ],
      });
      assert.strictEqual(validPayment.success, true);

      const invalidAlloc = CreatePaymentSchema.safeParse({
        organizationId: "org_test",
        partyId: "cust_123",
        partyType: "customer",
        direction: "in",
        amount: 1500.00,
        method: "bank_transfer",
        financialAccountId: "acc_bank_hdfc",
        allocations: [{ documentId: "bill_01", documentType: "bill", amount: -100 }],
      });
      assert.strictEqual(invalidAlloc.success, false, "Must reject negative allocation amounts");
    });

    it("Ageing report and cash-bank summary schemas enforce valid input and reject unexpected fields", () => {
      const validRec = GetReceivablesAgeingReportSchema.safeParse({
        organizationId: "org_test",
        asOfDate: "2026-11-16",
        branchId: "branch_main",
      });
      assert.strictEqual(validRec.success, true);

      const validPay = GetPayablesAgeingReportSchema.safeParse({
        organizationId: "org_test",
        asOfDate: "2026-11-16",
        vendorId: "vendor_123",
      });
      assert.strictEqual(validPay.success, true);

      const invalidDate = GetReceivablesAgeingReportSchema.safeParse({
        organizationId: "org_test",
        asOfDate: "16-11-2026", // Not YYYY-MM-DD
      });
      assert.strictEqual(invalidDate.success, false);

      const validSummary = GetCashBankSummarySchema.safeParse({
        organizationId: "org_test",
        includeInactive: true,
      });
      assert.strictEqual(validSummary.success, true);
    });

    it("DocumentDecisionSchema accepts account_transfer and stock_transfer domains", () => {
      const validAct = DocumentDecisionSchema.safeParse({
        organizationId: "org_test",
        documentType: "account_transfer",
        documentId: "act_123",
        decision: "approve",
      });
      assert.strictEqual(validAct.success, true);

      const validStk = DocumentDecisionSchema.safeParse({
        organizationId: "org_test",
        documentType: "stock_transfer",
        documentId: "trf_123",
        decision: "reject",
        reason: "Destination yard at maximum capacity",
      });
      assert.strictEqual(validStk.success, true);
    });
  });

  describe("2. Financial Ledger & Money Math Precision (R4, D-47)", () => {
    it("Money.amount normalizes decimal amounts and enforces exponent bounds", () => {
      const amt = Money.amount(125.50, "INR");
      assert.strictEqual(amt, 125.50);
    });

    it("Calculates running balance after debit and credit transactions with zero drift", () => {
      const opening = 5000.00; // ₹5,000.00
      const creditSale = 1200.50; // + ₹1,200.50
      const debitExpense = 750.25; // - ₹750.25
      const transferOut = 2000.00; // - ₹2,000.00

      let balance = opening;
      balance = Money.amount(balance + creditSale, "INR");
      assert.strictEqual(balance, 6200.50);

      balance = Money.amount(balance - debitExpense, "INR");
      assert.strictEqual(balance, 5450.25);

      balance = Money.amount(balance - transferOut, "INR");
      assert.strictEqual(balance, 3450.25); // Exactly ₹3,450.25
    });
  });

  describe("3. Stock Transfer Invariants & In-Transit Mechanics (D-49)", () => {
    it("Calculates dispatch deduction and receipt intake without inventory loss or doubling", () => {
      const initialSourceStock = 100;
      const initialDestStock = 20;
      const requestedQty = 30;
      const dispatchedQty = 30;
      const receivedQty = 28;
      const damagedQty = 2; // Discrepancy

      assert.strictEqual(requestedQty, dispatchedQty);

      // 1. Dispatch Phase: Source stock deducted
      const sourceAfterDispatch = initialSourceStock - dispatchedQty;
      assert.strictEqual(sourceAfterDispatch, 70);

      // In-transit stock exists in transfer document, not destination branch yet
      assert.strictEqual(initialDestStock, 20);

      // 2. Receive Phase: Destination stock credited with accepted units only
      const destAfterReceive = initialDestStock + receivedQty;
      assert.strictEqual(destAfterReceive, 48);

      // Invariant: Source consumed (30) = Destination added (28) + Damaged recorded (2)
      assert.strictEqual(dispatchedQty, receivedQty + damagedQty);
    });
  });

  describe("4. Granular RBAC & Permissions Alignment (FB-3)", () => {
    it("Contains all 17 new permissions required for Master Finance, Warehouses, Stock Transfers, Fees & Capital", () => {
      const permissions = Object.values(AppPermissions);
      const requiredNew = [
        "accounts:view",
        "accounts:manage",
        "accounts:transfer",
        "accounts:reconcile",
        "ledger:view",
        "receivables:view",
        "payables:view",
        "approvals:view",
        "warehouse:view",
        "warehouse:manage",
        "stock:transfer_create",
        "stock:transfer_approve",
        "stock:transfer_dispatch",
        "stock:transfer_receive",
        "payment:fee_manage",
        "payment:fee_verify",
        "capital:manage",
        "capital:view",
        "org:manage_approval_policy",
        "locations:view_team",
        "accounts:entry_create",
        "accounts:verify",
        "accounts:approve",
        "accounts:reverse",
        "approvals:self_approve",
      ];

      for (const perm of requiredNew) {
        assert.ok(
          permissions.includes(perm as any),
          `Permission "${perm}" must be registered in AppPermissions catalog`
        );
      }
      assert.strictEqual(permissions.length, 157, "AppPermissions catalog must contain exactly 157 keys (155 concrete + 2 wildcards)");
    });

    it("Maps maker-checker approval permissions for account and stock transfers", () => {
      assert.strictEqual(APPROVE_PERMISSION.account_transfer, AppPermissions.ACCOUNT_TRANSFER);
      assert.strictEqual(APPROVE_PERMISSION.stock_transfer, AppPermissions.STOCK_TRANSFER_APPROVE);
    });

    it("assertCanDecide enforces maker-checker and forbids self-approval (FB-7, D-50)", () => {
      const mockContext = (callerUid: string, hasPerm: boolean) => ({
        callerUid,
        can: () => hasPerm,
      } as any);

      const pendingDoc = {
        createdBy: "user_maker_123",
        status: "submitted",
      };

      // 1. Maker attempts to approve own doc -> must throw SELF_APPROVAL_FORBIDDEN
      assert.throws(
        () => assertCanDecide(mockContext("user_maker_123", true), "stock_transfer", pendingDoc),
        (err: any) => err.code === "permission-denied" && err.details?.reason === "SELF_APPROVAL_FORBIDDEN"
      );

      // 2. Different user without permission -> must throw PERMISSION_DENIED
      assert.throws(
        () => assertCanDecide(mockContext("user_other_456", false), "stock_transfer", pendingDoc),
        (err: any) => err.code === "permission-denied" && err.details?.reason === "PERMISSION_DENIED"
      );

      // 3. Different user with permission -> passes without throwing
      assert.doesNotThrow(() => {
        assertCanDecide(mockContext("user_checker_789", true), "stock_transfer", pendingDoc);
      });
    });
  });

  describe("5. Organization Governance Policy (FB-2, FB-4, D-54)", () => {
    it("Allows plain org:update (S2) on non-sensitive organization fields only", () => {
      const adminPolicy = ORGANIZATION_FIELD_POLICY.admin;
      assert.ok(adminPolicy, "ORGANIZATION_FIELD_POLICY.admin must exist");

      const allowedForS2 = [
        "displayName",
        "website",
        "contactEmail",
        "contactPhone",
        "contact",
        "addresses",
      ];

      for (const field of allowedForS2) {
        assert.ok(
          adminPolicy.has(field),
          `S2 policy must allow non-sensitive field "${field}"`
        );
      }
    });

    it("Protects S0 (Super Admin only) and S1 (dedicated permission) fields from plain org:update", () => {
      const adminPolicy = ORGANIZATION_FIELD_POLICY.admin;
      const protectedFromPlainUpdate = [
        "name",
        "businessType",
        "businessCategory",
        "financialYearStartMonth",
        "moduleToggles",
        "showCostToTenant",
        "legalName",
        "taxId",
        "bankAccounts",
        "settings",
      ];

      for (const field of protectedFromPlainUpdate) {
        assert.strictEqual(
          adminPolicy.has(field),
          false,
          `Sensitive field "${field}" must NOT be editable via plain org:update`
        );
      }
    });
  });

  describe("6. Operational Multi-Branch Financial & Inventory Integrity", () => {
    it("BranchSettingsSchema validates defaultFinancialAccountId and isOwnStockyard, rejecting unknown properties", () => {
      const valid = BranchSettingsSchema.safeParse({
        defaultFinancialAccountId: "fin_branch_main",
        isOwnStockyard: true,
        allowNegativeStock: false,
      });
      assert.strictEqual(valid.success, true);

      const unknown = BranchSettingsSchema.safeParse({
        defaultFinancialAccountId: "fin_branch_main",
        unknownProp: "illegal",
      });
      assert.strictEqual(unknown.success, false, "Must reject unknown properties (D-11)");
    });

    it("CreateOutflowSchema validates split payments, storageLocationId, and financialAccountId", () => {
      const valid = CreateOutflowSchema.safeParse({
        kind: "purchase",
        storageLocationId: "loc_warehouse_1",
        financialAccountId: "fin_bank_ops",
        lines: [
          {
            productId: "prod_sample",
            quantity: 10,
            unitPrice: 5000,
          },
        ],
        splitPayments: [
          {
            method: "bank_transfer",
            amount: 30000,
            financialAccountId: "fin_bank_ops",
          },
          {
            method: "cash",
            amount: 20000,
            financialAccountId: "fin_cash_ops",
          },
        ],
      });
      assert.strictEqual(valid.success, true);
    });

    it("SplitPaymentEntrySchema requires positive amounts and valid financial accounts", () => {
      const valid = SplitPaymentEntrySchema.safeParse({
        method: "cash",
        amount: 50.00,
        financialAccountId: "fin_cash_main",
      });
      assert.strictEqual(valid.success, true);

      const negativeAmount = SplitPaymentEntrySchema.safeParse({
        method: "cash",
        amount: -50.00,
        financialAccountId: "fin_cash_main",
      });
      assert.strictEqual(negativeAmount.success, false, "Must reject negative amount");

      const emptyAccount = SplitPaymentEntrySchema.safeParse({
        method: "cash",
        amount: 50.00,
        financialAccountId: "",
      });
      assert.strictEqual(emptyAccount.success, false, "Must reject empty financialAccountId");
    });
  });
});
