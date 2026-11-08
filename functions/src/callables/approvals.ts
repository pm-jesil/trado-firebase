/**
 * documentsDecide — the ONE maker–checker decision entry point (Part 4.2 / 8.2).
 *
 * Bills, purchases/expenses, returns and stock adjustments share: the gate (the module's approve
 * permission), the pending-state check and the no-self-approval rule (assertCanDecide), and the
 * reject path. Only "apply the effects" is type-specific and lives next to each document's engine
 * (decideBill, decideOutflow, decideReturn, decideStockAdjustment). Replaces billsApprove and
 * outflowsApprove.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { DocumentDecisionSchema } from "../validation/schemas.js";
import { parseInput } from "../validation/parseInput.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { APPROVE_PERMISSION } from "../services/approvals.js";
import { AppPermissions } from "../constants/permissions.js";
import { decideBill } from "./bills.js";
import { decideOutflow } from "./outflows.js";
import { decideReturn } from "./returns.js";
import { decideStockAdjustment } from "./stock.js";

const PERMISSIONS = {
  bill: [APPROVE_PERMISSION.sale],
  outflow: [APPROVE_PERMISSION.purchase, APPROVE_PERMISSION.expense, AppPermissions.OUTFLOW_APPROVE],
  return: [APPROVE_PERMISSION.return],
  stock_adjustment: [APPROVE_PERMISSION.stock_adjustment],
} as const;

export const documentsDecide = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const input = parseInput(DocumentDecisionSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: [...PERMISSIONS[input.documentType]] });
  switch (input.documentType) {
    case "bill": return decideBill(ctx, input);
    case "outflow": return decideOutflow(ctx, input);
    case "return": return decideReturn(ctx, input);
    case "stock_adjustment": return decideStockAdjustment(ctx, input);
  }
});
