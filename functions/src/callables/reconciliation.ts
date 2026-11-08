/**
 * Reconciliation Callables
 * - reconcileStockBalances: Verifies product.currentStock against immutable stockMovements
 * - reconcilePartyLedgers: Verifies customer / vendor account balances against bills, outflows, payments
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { parseInput } from "../validation/parseInput.js";
import { reconcileStock, reconcilePartyBalances, reconcileBranchCounts as reconcileBranchCountsService } from "../services/reconciliation.js";
import { z } from "zod";
import { ReconcileBranchCountsSchema } from "../validation/schemas.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";

/** Ledger/stock maintenance is an Owner/Admin-level operation (may repair balances). */
const RECONCILE_PERMISSION = [AppPermissions.ORG_SETTINGS, AppPermissions.INVENTORY_MANAGE];

const ReconcileStockSchema = z.object({
  organizationId: z.string().trim().min(2).optional(),
  productId: z.string().trim().optional(),
  repair: z.boolean().default(false).optional(),
});

const ReconcilePartySchema = z.object({
  organizationId: z.string().trim().min(2).optional(),
  partyType: z.enum(["customer", "vendor"]),
  partyId: z.string().trim().optional(),
});

export const reconcileStockBalances = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReconcileStockSchema, request.data);

  const orgId = (await resolveRequestContext(request, { requiredPermission: RECONCILE_PERMISSION })).organizationId;

  const report = await reconcileStock(
    orgId,
    input.productId,
    input.repair
  );

  return report;
});

export const reconcilePartyLedgers = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReconcilePartySchema, request.data);

  const orgId = (await resolveRequestContext(request, { requiredPermission: RECONCILE_PERMISSION })).organizationId;

  const report = await reconcilePartyBalances(
    orgId,
    input.partyType,
    input.partyId
  );

  return report;
});

export const reconcileBranchCounts = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = parseInput(ReconcileBranchCountsSchema, request.data);

  const orgId = (await resolveRequestContext(request, { requiredPermission: RECONCILE_PERMISSION })).organizationId;

  const report = await reconcileBranchCountsService(
    orgId,
    input.repair
  );

  return report;
});


