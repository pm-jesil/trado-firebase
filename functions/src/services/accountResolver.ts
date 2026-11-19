/**
 * Central Financial Account Resolver (U-8, Q-F4; D-F5..D-F7)
 *
 * Implements canonical precedence resolution for operational financial accounts:
 * 1. Explicit accountId (caller-provided) with branch access validation
 * 2. Branch default for paymentMethod
 * 3. Branch general default
 * 4. Organization default for paymentMethod
 * 5. Organization general default
 * 6. Throws [NO_DEFAULT_ACCOUNT] failed-precondition if unresolved
 */

import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { FinancialAccountDoc, FinancialAccountType } from "../types/models.js";
import { PaymentMethod } from "../constants/enums.js";

export interface ResolveAccountParams {
  organizationId: string;
  branchId?: string | null;
  paymentMethod?: PaymentMethod | string | null;
  accountType?: FinancialAccountType | string | null;
  explicitAccountId?: string | null;
}

export type ResolvedFinancialAccount = FinancialAccountDoc & { id: string };

function mapPaymentMethodToAccountTypes(method?: string | null): FinancialAccountType[] {
  switch (method) {
    case "cash":
      return ["cash"];
    case "card":
      return ["clearing", "bank", "digital"];
    case "upi":
      return ["bank", "digital", "clearing"];
    case "bank_transfer":
    case "cheque":
      return ["bank"];
    default:
      return ["cash", "bank", "clearing", "digital"];
  }
}

export async function resolveAccount(
  params: ResolveAccountParams,
  txn?: FirebaseFirestore.Transaction
): Promise<ResolvedFinancialAccount> {
  const { organizationId, branchId, paymentMethod, accountType, explicitAccountId } = params;

  // 1. Explicit Account ID provided
  if (explicitAccountId) {
    const accRef = db.collection("financialAccounts").doc(explicitAccountId);
    const snap = txn ? await txn.get(accRef) : await accRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", `Financial account "${explicitAccountId}" not found.`);
    }
    const acc = snap.data() as FinancialAccountDoc;
    if (acc.organizationId !== organizationId) {
      throw new HttpsError("permission-denied", "Cross-tenant financial account reference rejected.");
    }
    if (acc.isActive === false) {
      throw new HttpsError("failed-precondition", `Financial account "${acc.name}" is inactive.`, {
        reason: "ACCOUNT_INACTIVE",
      });
    }

    if (branchId) {
      if (acc.branchId && acc.branchId !== branchId) {
        throw new HttpsError(
          "permission-denied",
          `Financial account "${acc.name}" is restricted to branch "${acc.branchId}".`,
          { reason: "BRANCH_ACCESS_DENIED" }
        );
      }
      if (
        acc.assignedBranchIds &&
        acc.assignedBranchIds.length > 0 &&
        !acc.assignedBranchIds.includes(branchId)
      ) {
        throw new HttpsError(
          "permission-denied",
          `Financial account "${acc.name}" is not assigned to branch "${branchId}".`,
          { reason: "BRANCH_ACCESS_DENIED" }
        );
      }
    }

    return { ...acc, id: snap.id };
  }

  // 2. Resolve from available active accounts in the organization
  const query = db
    .collection("financialAccounts")
    .where("organizationId", "==", organizationId)
    .where("isActive", "==", true);

  const snaps = txn ? await txn.get(query) : await query.get();
  if (snaps.empty) {
    throw new HttpsError(
      "failed-precondition",
      `[NO_DEFAULT_ACCOUNT] No active financial accounts configured for organization "${organizationId}".`,
      { reason: "NO_DEFAULT_ACCOUNT" }
    );
  }

  const accounts: ResolvedFinancialAccount[] = snaps.docs.map((d) => ({
    id: d.id,
    ...(d.data() as FinancialAccountDoc),
  }));

  const targetTypes: FinancialAccountType[] = accountType
    ? [accountType as FinancialAccountType]
    : mapPaymentMethodToAccountTypes(paymentMethod);

  const isBranchAssigned = (acc: ResolvedFinancialAccount, bId: string) => {
    if (acc.branchId === bId) return true;
    if (Array.isArray(acc.assignedBranchIds) && acc.assignedBranchIds.includes(bId)) return true;
    return false;
  };

  // Precedence 2: Branch default for paymentMethod
  if (branchId) {
    const branchTypeMatches = accounts.filter(
      (a) => isBranchAssigned(a, branchId) && targetTypes.includes(a.accountType)
    );
    const branchTypeDefault = branchTypeMatches.find((a) => a.isDefault);
    if (branchTypeDefault) return branchTypeDefault;
    if (branchTypeMatches.length > 0) return branchTypeMatches[0];

    // Precedence 3: Branch general default
    const branchGeneralDefault = accounts.find((a) => isBranchAssigned(a, branchId) && a.isDefault);
    if (branchGeneralDefault) return branchGeneralDefault;

    const anyBranchAccount = accounts.find((a) => isBranchAssigned(a, branchId));
    if (anyBranchAccount) return anyBranchAccount;
  }

  // Precedence 4: Organization default for paymentMethod (org-shared account, branchId == null)
  const orgShared = accounts.filter((a) => !a.branchId || a.branchId === null);
  const orgTypeMatches = orgShared.filter((a) => targetTypes.includes(a.accountType));
  const orgTypeDefault = orgTypeMatches.find((a) => a.isDefault);
  if (orgTypeDefault) return orgTypeDefault;
  if (orgTypeMatches.length > 0) return orgTypeMatches[0];

  // Precedence 5: Organization general default
  const orgGeneralDefault = orgShared.find((a) => a.isDefault);
  if (orgGeneralDefault) return orgGeneralDefault;
  if (orgShared.length > 0) return orgShared[0];

  // Fallback: Any active account with default or first active
  const anyDefault = accounts.find((a) => a.isDefault);
  if (anyDefault) return anyDefault;
  if (accounts.length > 0) return accounts[0];

  throw new HttpsError(
    "failed-precondition",
    `[NO_DEFAULT_ACCOUNT] No suitable financial account found for payment method "${paymentMethod || "default"}".`,
    { reason: "NO_DEFAULT_ACCOUNT" }
  );
}
