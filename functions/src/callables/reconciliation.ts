/**
 * Reconciliation Callables
 * - reconcileStockBalances: Verifies product.currentStock against immutable stockMovements
 * - reconcilePartyLedgers: Verifies customer / vendor account balances against bills, outflows, payments
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { reconcileStock, reconcilePartyBalances, reconcileBranchCounts as reconcileBranchCountsService } from "../services/reconciliation.js";
import { z } from "zod";
import { ReconcileBranchCountsSchema } from "../validation/schemas.js";
import { verifyTenantAccess } from "../services/tenantContext.js";

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

  const parsed = ReconcileStockSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }

  const orgId = await verifyTenantAccess(request.auth, parsed.data.organizationId);

  const report = await reconcileStock(
    orgId,
    parsed.data.productId,
    parsed.data.repair
  );

  return report;
});

export const reconcilePartyLedgers = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ReconcilePartySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }

  const orgId = await verifyTenantAccess(request.auth, parsed.data.organizationId);

  const report = await reconcilePartyBalances(
    orgId,
    parsed.data.partyType,
    parsed.data.partyId
  );

  return report;
});

export const reconcileBranchCounts = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parsed = ReconcileBranchCountsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `Validation failed: ${parsed.error.message}`);
  }

  const orgId = await verifyTenantAccess(request.auth, parsed.data.organizationId);

  const report = await reconcileBranchCountsService(
    orgId,
    parsed.data.repair
  );

  return report;
});


