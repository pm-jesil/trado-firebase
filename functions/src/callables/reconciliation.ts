/**
 * Reconciliation Callables
 * - reconcileStockBalances: Verifies product.currentStock against immutable stockMovements
 * - reconcilePartyLedgers: Verifies customer / vendor account balances against bills, outflows, payments
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebase.js";
import { MembershipDoc } from "../types/models.js";
import { reconcileStock, reconcilePartyBalances, reconcileBranchCounts as reconcileBranchCountsService } from "../services/reconciliation.js";
import { z } from "zod";
import { ReconcileBranchCountsSchema } from "../validation/schemas.js";

async function verifyTenantAccess(auth: any, organizationId: string): Promise<void> {
  if (auth.token.isSuperAdmin === true) return;

  const memRef = db.collection("memberships").doc(`${auth.uid}_${organizationId}`);
  const memDoc = await memRef.get();
  if (!memDoc.exists || (memDoc.data() as MembershipDoc).status !== "active") {
    throw new HttpsError("permission-denied", "Caller is not an active member of this organization.");
  }
}

const ReconcileStockSchema = z.object({
  organizationId: z.string().trim().min(2),
  productId: z.string().trim().optional(),
  repair: z.boolean().default(false).optional(),
});

const ReconcilePartySchema = z.object({
  organizationId: z.string().trim().min(2),
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

  await verifyTenantAccess(request.auth, parsed.data.organizationId);

  const report = await reconcileStock(
    parsed.data.organizationId,
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

  await verifyTenantAccess(request.auth, parsed.data.organizationId);

  const report = await reconcilePartyBalances(
    parsed.data.organizationId,
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

  await verifyTenantAccess(request.auth, parsed.data.organizationId);

  const report = await reconcileBranchCountsService(
    parsed.data.organizationId,
    parsed.data.repair
  );

  return report;
});


