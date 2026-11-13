import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { parseInput } from "../validation/parseInput.js";
import { reconcileStock, reconcilePartyBalances, reconcileBranchCounts as reconcileBranchCountsService } from "../services/reconciliation.js";
import { ReconcileBranchCountsSchema, ReconcilePartySchema, ReconcileStockSchema } from "../validation/schemas.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";

/** Ledger/stock maintenance is an Owner/Admin-level operation (may repair balances). */
const RECONCILE_PERMISSION = [AppPermissions.ORG_SETTINGS, AppPermissions.INVENTORY_MANAGE];

export const reconcileStockBalances = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReconcileStockSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: RECONCILE_PERMISSION });
  const orgId = ctx.organizationId;

  const report = await reconcileStock(orgId, input.productId, input.repair);


  return report;
});

export const reconcilePartyLedgers = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReconcilePartySchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: RECONCILE_PERMISSION });
  const orgId = ctx.organizationId;

  const report = await reconcilePartyBalances(orgId, input.partyType, input.partyId);


  return report;
});

export const reconcileBranchCounts = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReconcileBranchCountsSchema, request.data);

  const ctx = await resolveRequestContext(request, { requiredPermission: RECONCILE_PERMISSION });
  const orgId = ctx.organizationId;

  const report = await reconcileBranchCountsService(orgId, input.repair);


  return report;
});


