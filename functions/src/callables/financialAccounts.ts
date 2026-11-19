/**
 * Financial Accounts & Transfers Callables
 * 
 * Provides:
 * - CRUD management for operational financial accounts (cash desks, banks, digital wallets)
 * - Append-only financial account ledger retrieval
 * - Account-to-account transfer creation and listing with optional maker-checker support
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import {
  CreateFinancialAccountSchema,
  UpdateFinancialAccountSchema,
  ListFinancialAccountsSchema,
  GetFinancialAccountSchema,
  GetAccountLedgerSchema,
  CreateAccountTransferSchema,
  ListAccountTransfersSchema,
  GetAccountTransferSchema,
  CreateCapitalTransactionSchema,
  ListCapitalTransactionsSchema,
} from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import {
  FinancialAccountDoc,
  AccountTransferDoc,
  CapitalTransactionDoc,
  OrganizationDoc,
} from "../types/models.js";
import { Money } from "../services/money.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { fetchPage } from "../services/pagination.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import {
  prepareAccountTransactionInTxn,
  applyAccountTransactionInTxn,
} from "../services/ledgerService.js";
import {
  readNextDocumentNumberInTxn,
  commitDocumentNumberInTxn,
} from "../services/documentCounter.js";

export const financialAccountsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateFinancialAccountSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_MANAGE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "financialAccounts.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  const accountRef = db.collection("financialAccounts").doc();
  const accountId = accountRef.id;
  const currency = input.currency || "INR";
  const openingBalance = Money.amount(input.openingBalance || 0, currency);

  const accountDoc: FinancialAccountDoc = {
    organizationId: orgId,
    branchId: input.branchId || null,
    name: input.name,
    code: input.code,
    accountType: input.accountType,
    currency,
    ...(input.assignedBranchIds ? { assignedBranchIds: input.assignedBranchIds } : {}),
    ...(input.bankDetails ? { bankDetails: input.bankDetails } : {}),
    openingBalance,
    currentBalance: 0,
    isDefault: input.isDefault ?? false,
    isActive: true,
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: now,
    createdBy: callerUid,
    updatedAt: now,
    updatedBy: callerUid,
  };

  await accountRef.set(accountDoc);

  // If opening balance > 0, record initial ledger transaction
  if (openingBalance > 0) {
    await db.runTransaction(async (txn) => {
      const prep = await prepareAccountTransactionInTxn(txn, {
        organizationId: orgId,
        financialAccountId: accountId,
        branchId: input.branchId || null,
        type: "opening_balance",
        direction: "in",
        amount: openingBalance,
        sourceDocumentType: "manual",
        sourceDocumentId: accountId,
        description: "Initial account opening balance",
        actorUid: callerUid,
        now,
      });

      applyAccountTransactionInTxn(txn, prep, {
        organizationId: orgId,
        financialAccountId: accountId,
        branchId: input.branchId || null,
        type: "opening_balance",
        direction: "in",
        amount: openingBalance,
        sourceDocumentType: "manual",
        sourceDocumentId: accountId,
        description: "Initial account opening balance",
        actorUid: callerUid,
        now,
      });
    });
  }

  const result = {
    financialAccountId: accountId,
    account: {
      financialAccountId: accountId,
      ...accountDoc,
      currentBalance: openingBalance,
    },
    message: "Financial account created successfully.",
  };

  return result;
});

export const financialAccountsUpdate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(UpdateFinancialAccountSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_MANAGE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const accountRef = db.collection("financialAccounts").doc(input.financialAccountId);
  const snap = await accountRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Financial account not found.");
  }

  const existing = snap.data() as FinancialAccountDoc;
  if (existing.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant financial account modification rejected.");
  }

  const updates: Partial<FinancialAccountDoc> = {
    updatedAt: new Date().toISOString(),
    updatedBy: callerUid,
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.assignedBranchIds !== undefined) updates.assignedBranchIds = input.assignedBranchIds;
  if (input.bankDetails !== undefined) updates.bankDetails = input.bankDetails;
  if (input.isDefault !== undefined) updates.isDefault = input.isDefault;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.notes !== undefined) updates.notes = input.notes;

  await accountRef.update(updates);

  return {
    success: true,
    message: "Financial account updated successfully.",
  };
});

export const financialAccountsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListFinancialAccountsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  let query: FirebaseFirestore.Query = db
    .collection("financialAccounts")
    .where("organizationId", "==", orgId);

  if (input.branchId) {
    query = query.where("branchId", "in", [input.branchId, null]);
  }
  if (input.accountType) {
    query = query.where("accountType", "==", input.accountType);
  }
  if (input.isActive !== undefined) {
    query = query.where("isActive", "==", input.isActive);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("name");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "financialAccounts",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    financialAccountId: doc.id,
    ...(doc.data() as FinancialAccountDoc),
  }));

  return {
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

export const financialAccountsGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetFinancialAccountSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const accountRef = db.collection("financialAccounts").doc(input.financialAccountId);
  const snap = await accountRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Financial account not found.");
  }

  const data = snap.data() as FinancialAccountDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return {
    financialAccount: {
      financialAccountId: snap.id,
      ...data,
    },
  };
});

export const financialAccountsGetLedger = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetAccountLedgerSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.LEDGER_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const accountRef = db.collection("financialAccounts").doc(input.financialAccountId);
  const accountSnap = await accountRef.get();

  if (!accountSnap.exists) {
    throw new HttpsError("not-found", "Financial account not found.");
  }

  const accountData = accountSnap.data() as FinancialAccountDoc;
  if (accountData.organizationId !== orgId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  let query: FirebaseFirestore.Query = db
    .collection("accountTransactions")
    .where("organizationId", "==", orgId)
    .where("financialAccountId", "==", input.financialAccountId);

  if (input.type) {
    query = query.where("type", "==", input.type);
  }
  if (input.from) {
    query = query.where("createdAt", ">=", `${input.from}T00:00:00.000Z`);
  }
  if (input.to) {
    query = query.where("createdAt", "<=", `${input.to}T23:59:59.999Z`);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "accountTransactions",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    transactionId: doc.id,
    ...doc.data(),
  }));

  return {
    account: {
      financialAccountId: accountSnap.id,
      name: accountData.name,
      code: accountData.code,
      currency: accountData.currency,
      currentBalance: accountData.currentBalance,
    },
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

export const accountTransfersCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateAccountTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_TRANSFER,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  if (input.sourceAccountId === input.destinationAccountId) {
    throw new HttpsError("invalid-argument", "Source and destination financial accounts must be different.");
  }

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "accountTransfers.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  // Check maker-checker approval policy
  const orgDoc = (await db.collection("organizations").doc(orgId).get()).data() as OrganizationDoc | undefined;
  const approvalsPolicy = orgDoc?.settings?.approvals;
  const needsApproval =
    approvalsPolicy?.enabled === true &&
    (approvalsPolicy.modules as Record<string, boolean> | undefined)?.account_transfer === true;

  const transferRef = db.collection("accountTransfers").doc();
  const transferId = transferRef.id;

  const result = await db.runTransaction(async (txn) => {
    // 1. Transactional reads first
    const transferReservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "ACT",
    });

    const sourcePrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: input.sourceAccountId,
      type: "transfer_out",
      direction: "out",
      amount: input.amount,
      sourceDocumentType: "account_transfer",
      sourceDocumentId: transferId,
      actorUid: callerUid,
      now,
    });

    const destPrep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: input.destinationAccountId,
      type: "transfer_in",
      direction: "in",
      amount: input.amount,
      sourceDocumentType: "account_transfer",
      sourceDocumentId: transferId,
      actorUid: callerUid,
      now,
    });

    const transferAmount = Money.amount(input.amount, sourcePrep.accountData.currency || "INR");

    // Check balance for immediate transfers
    if (!needsApproval && (sourcePrep.accountData.currentBalance || 0) < transferAmount) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient funds in source account "${sourcePrep.accountData.name}". Available: ${sourcePrep.accountData.currentBalance}, Required: ${transferAmount}.`
      );
    }

    commitDocumentNumberInTxn(txn, transferReservation);
    const transferNumber = transferReservation.formattedNumber;

    let sourceTxnResult = null;
    let destTxnResult = null;

    const transferType = input.transferType || "transfer";
    const typeLabel =
      transferType === "cash_deposit"
        ? "[Cash Deposit] "
        : transferType === "cash_withdrawal"
          ? "[Cash Withdrawal] "
          : transferType === "inter_bank"
            ? "[Inter-Bank Transfer] "
            : transferType === "petty_cash"
              ? "[Petty Cash Replenishment] "
              : transferType === "cashier_handover"
                ? "[Cashier Shift Handover] "
                : "";

    const isTransit = input.mode === "in_transit";

    if (!needsApproval) {
      sourceTxnResult = applyAccountTransactionInTxn(txn, sourcePrep, {
        organizationId: orgId,
        financialAccountId: input.sourceAccountId,
        type: "transfer_out",
        direction: "out",
        amount: transferAmount,
        sourceDocumentType: "account_transfer",
        sourceDocumentId: transferId,
        description: `${typeLabel}Transfer to ${destPrep.accountData.name} (${transferNumber})`,
        actorUid: callerUid,
        now,
      });

      if (!isTransit) {
        destTxnResult = applyAccountTransactionInTxn(txn, destPrep, {
          organizationId: orgId,
          financialAccountId: input.destinationAccountId,
          type: "transfer_in",
          direction: "in",
          amount: transferAmount,
          sourceDocumentType: "account_transfer",
          sourceDocumentId: transferId,
          description: `${typeLabel}Transfer from ${sourcePrep.accountData.name} (${transferNumber})`,
          actorUid: callerUid,
          now,
        });
      }
    }

    const transferDoc: AccountTransferDoc = {
      organizationId: orgId,
      transferNumber,
      transferType,
      mode: input.mode || "instant",
      ...(input.reference ? { reference: input.reference } : {}),
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      sourceBranchId: sourcePrep.accountData.branchId || null,
      destinationBranchId: destPrep.accountData.branchId || null,
      amount: transferAmount,
      status: needsApproval ? "pending_approval" : (isTransit ? "in_transit" : "completed"),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(sourceTxnResult ? { sourceTransactionId: sourceTxnResult.transactionId } : {}),
      ...(destTxnResult ? { destinationTransactionId: destTxnResult.transactionId } : {}),
      requiresApproval: needsApproval,
      createdAt: now,
      createdBy: callerUid,
      createdByMembershipId: ctx.membershipId || null,
      updatedAt: now,
      updatedBy: callerUid,
    };

    txn.set(transferRef, transferDoc);

    return {
      transferId,
      transfer: {
        transferId,
        ...transferDoc,
      },
      message: needsApproval
        ? "Transfer submitted for approval."
        : "Transfer completed successfully.",
    };
  });

  return result;
});

export const accountTransfersList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListAccountTransfersSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  let query: FirebaseFirestore.Query = db
    .collection("accountTransfers")
    .where("organizationId", "==", orgId);

  if (input.sourceAccountId) {
    query = query.where("sourceAccountId", "==", input.sourceAccountId);
  }
  if (input.destinationAccountId) {
    query = query.where("destinationAccountId", "==", input.destinationAccountId);
  }
  if (input.status) {
    query = query.where("status", "==", input.status);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "accountTransfers",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    transferId: doc.id,
    ...(doc.data() as AccountTransferDoc),
  }));

  return {
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

export const accountTransfersGet = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(GetAccountTransferSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.ACCOUNT_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const transferRef = db.collection("accountTransfers").doc(input.transferId);
  const snap = await transferRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Account transfer not found.");
  }

  const data = snap.data() as AccountTransferDoc;
  if (data.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  return {
    transfer: {
      transferId: snap.id,
      ...data,
    },
  };
});

export const capitalTransactionsCreate = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(CreateCapitalTransactionSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.CAPITAL_MANAGE,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  const callerUid = ctx.callerUid;
  const now = new Date().toISOString();

  const idempotency = await reserveIdempotency({
    scope: orgId,
    actorUid: callerUid,
    operation: "capital.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });

  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) {
      throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    }
    return idempotency.cachedResult;
  }

  const capitalRef = db.collection("capitalTransactions").doc();
  const capitalId = capitalRef.id;

  const result = await db.runTransaction(async (txn) => {
    const reservation = await readNextDocumentNumberInTxn(txn, {
      organizationId: orgId,
      type: "CAP",
    });

    const isDrawings = input.type === "drawings";
    const direction: "in" | "out" = isDrawings ? "out" : "in";
    const txnType = isDrawings ? "capital_drawings" : "capital_contribution";
    const normalizedAmount = Money.amount(input.amount, input.currency || "INR");

    const prep = await prepareAccountTransactionInTxn(txn, {
      organizationId: orgId,
      financialAccountId: input.financialAccountId,
      branchId: input.branchId || null,
      type: txnType,
      direction,
      amount: normalizedAmount,
      sourceDocumentType: "capital",
      sourceDocumentId: capitalId,
      description: `${isDrawings ? "Capital withdrawal / drawings" : "Capital contribution"} (${reservation.formattedNumber})`,
      actorUid: callerUid,
      now,
    });

    if (isDrawings && (prep.accountData.currentBalance || 0) < normalizedAmount) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient funds for capital withdrawal. Available: ${prep.accountData.currentBalance}, Requested: ${normalizedAmount}.`
      );
    }

    commitDocumentNumberInTxn(txn, reservation);
    const transactionNumber = reservation.formattedNumber;

    const ledgerResult = applyAccountTransactionInTxn(txn, prep, {
      organizationId: orgId,
      financialAccountId: input.financialAccountId,
      branchId: input.branchId || null,
      type: txnType,
      direction,
      amount: normalizedAmount,
      sourceDocumentType: "capital",
      sourceDocumentId: capitalId,
      description: `${isDrawings ? "Capital withdrawal / drawings" : "Capital contribution"} (${transactionNumber})`,
      actorUid: callerUid,
      now,
    });

    const capitalDoc: CapitalTransactionDoc = {
      organizationId: orgId,
      branchId: input.branchId || null,
      transactionNumber,
      type: input.type,
      financialAccountId: input.financialAccountId,
      amount: normalizedAmount,
      currency: input.currency || "INR",
      sourceReference: input.sourceReference || undefined,
      description: input.description || undefined,
      supportingDocumentPath: input.supportingDocumentPath || undefined,
      accountTransactionId: ledgerResult.transactionId,
      createdAt: now,
      createdBy: callerUid,
    };

    txn.set(capitalRef, capitalDoc);

    return {
      capitalTransactionId: capitalId,
      transactionNumber,
      amount: normalizedAmount,
      type: input.type,
      accountTransactionId: ledgerResult.transactionId,
      balanceAfter: ledgerResult.balanceAfter,
      message: isDrawings ? "Capital withdrawal recorded." : "Capital contribution recorded.",
    };
  });

  return result;
});

export const capitalTransactionsList = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ListCapitalTransactionsSchema, request.data);
  const ctx = await resolveRequestContext(request, {
    branchId: input.branchId,
    requiredPermission: AppPermissions.CAPITAL_VIEW,
  });
  if (input.organizationId && input.organizationId !== ctx.organizationId) {
    throw new HttpsError("permission-denied", "Cross-tenant access rejected.");
  }

  const orgId = ctx.organizationId;
  let query: FirebaseFirestore.Query = db
    .collection("capitalTransactions")
    .where("organizationId", "==", orgId);

  if (input.branchId) {
    query = query.where("branchId", "==", input.branchId);
  }
  if (input.type) {
    query = query.where("type", "==", input.type);
  }

  const countSnap = await query.count().get();
  const totalCount = countSnap.data().count;

  query = query.orderBy("createdAt", "desc");
  const { snapshot, nextCursor } = await fetchPage(
    query,
    "capitalTransactions",
    input.startAfterId,
    input.limit || 50
  );

  const items = snapshot.docs.map((doc) => ({
    capitalTransactionId: doc.id,
    ...(doc.data() as CapitalTransactionDoc),
  }));

  return {
    items,
    count: items.length,
    totalCount,
    nextCursor,
    hasMore: items.length === (input.limit || 50),
  };
});

