/**
 * Recurring expenses (Part 8.9): ONE stored template per recurring cost (rent, salary, utilities).
 *
 *   recurringExpenses/{templateId}
 *     { organizationId, branchId, payee | vendorId | payeeType+payeeMembershipId, expenseCategoryId,
 *       lines (non-catalog), frequency: monthly|weekly, dayOfMonth | weekday, startOn, endOn?,
 *       nextRunOn (calendar date, org timezone), lastGeneratedPeriod?, isActive, createdBy … }
 *
 * The daily sweep (triggers/scheduled.ts) generates each due period through the real outflowsCreate
 * (gate, plan, usage, approvals all apply, as the template's creator) with the idempotency key
 * `recurring-{templateId}-{period}`: a period can never be generated twice. Generated expenses
 * reference the template (outflows.recurringTemplateId); the template is never copied into them.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { db } from "../services/firebase.js";
import { parseInput } from "../validation/parseInput.js";
import { CreateRecurringExpenseSchema, UpdateRecurringExpenseSchema, ListRecurringExpensesSchema } from "../validation/schemas.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { fetchPage } from "../services/pagination.js";
import { localDateInTimezone, addDaysYmd } from "../services/subscription.js";
import { requireTimezone } from "../services/money.js";
import { reserveIdempotency, finalizeIdempotencySuccess, finalizeIdempotencyFailure } from "../services/idempotency.js";
import { OrganizationDoc, RecurringExpenseDoc } from "../types/models.js";

/** First run date on/after `from` for the template's schedule. */
export function nextRunOn(t: Pick<RecurringExpenseDoc, "frequency" | "dayOfMonth" | "weekday">, from: string): string {
  if (t.frequency === "monthly") {
    const day = String(t.dayOfMonth || 1).padStart(2, "0");
    const candidate = `${from.slice(0, 7)}-${day}`;
    if (candidate >= from) return candidate;
    const [y, m] = from.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    return `${next}-${day}`;
  }
  const d = new Date(`${from}T00:00:00Z`);
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDaysYmd(from, ((t.weekday || 1) - iso + 7) % 7);
}

/** Period key of a run date: YYYY-MM (monthly) or the run date itself (weekly). */
export function periodKey(t: Pick<RecurringExpenseDoc, "frequency">, runOn: string): string {
  return t.frequency === "monthly" ? runOn.slice(0, 7) : runOn;
}

export const recurringExpensesCreate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(CreateRecurringExpenseSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EXPENSE_CREATE });
  if (input.frequency === "monthly" && !input.dayOfMonth) throw new HttpsError("invalid-argument", "dayOfMonth is required for monthly templates.");
  if (input.frequency === "weekly" && !input.weekday) throw new HttpsError("invalid-argument", "weekday is required for weekly templates.");
  if (input.lines.some((l) => l.productId)) throw new HttpsError("invalid-argument", "Recurring expenses use non-catalog lines (itemName), not products.");

  const idempotency = await reserveIdempotency({
    scope: ctx.organizationId,
    actorUid: ctx.callerUid,
    operation: "recurringExpenses.create",
    clientKey: input.idempotencyKey,
    payload: request.data,
  });
  if (idempotency.isDuplicate) {
    if (idempotency.isProcessing) throw new HttpsError("already-exists", "Operation in progress. Please retry shortly.");
    return idempotency.cachedResult;
  }

  try {
    const now = new Date().toISOString();
    const ref = db.collection("recurringExpenses").doc();
    const { idempotencyKey: _key, organizationId: _org, branchId: _branch, ...fields } = input;
    const doc: RecurringExpenseDoc = {
      ...fields,
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      nextRunOn: nextRunOn(input, input.startOn),
      isActive: true,
      createdBy: ctx.callerUid,
      createdByMembershipId: ctx.membershipId,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    const result = { templateId: ref.id, nextRunOn: doc.nextRunOn };
    await finalizeIdempotencySuccess(idempotency.recordId, result);
    return result;
  } catch (err) {
    await finalizeIdempotencyFailure(idempotency.recordId, "CREATE_RECURRING_EXPENSE_FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
});

export const recurringExpensesUpdate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(UpdateRecurringExpenseSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EXPENSE_CREATE });
  const ref = db.collection("recurringExpenses").doc(input.templateId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.organizationId !== ctx.organizationId) throw new HttpsError("not-found", "Recurring expense not found.");
  const updates: Record<string, unknown> = {};
  for (const k of ["name", "lines", "endOn", "isActive"] as const) if (input[k] !== undefined) updates[k] = input[k];
  if (!Object.keys(updates).length) throw new HttpsError("invalid-argument", "No updatable fields provided.");
  await ref.update({ ...updates, updatedAt: new Date().toISOString(), updatedBy: ctx.callerUid });
  return { templateId: ref.id, updated: Object.keys(updates) };
});

export const recurringExpensesList = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(ListRecurringExpensesSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EXPENSE_VIEW, operation: "read" });
  let q: FirebaseFirestore.Query = db.collection("recurringExpenses").where("organizationId", "==", ctx.organizationId);
  if (input.isActive !== undefined) q = q.where("isActive", "==", input.isActive);
  const { snapshot, nextCursor } = await fetchPage(q, "recurringExpenses", input.startAfterId, input.limit || 50);
  const items = snapshot.docs.map((d) => ({ templateId: d.id, ...d.data() }));
  return { items, count: items.length, nextCursor };
});

/**
 * Generates every due period of every active template (called by the daily sweep). Each period
 * goes through outflowsCreate with a per-period idempotency key, so re-running never duplicates.
 */
export async function generateDueRecurringExpenses(nowMs: number = Date.now()): Promise<{ generated: number; skipped: number }> {
  const { outflowsCreate } = await import("./outflows.js");
  const run = outflowsCreate as unknown as { run: (req: unknown) => Promise<{ outflowId: string }> };
  const templates = await db.collection("recurringExpenses").where("isActive", "==", true).get();
  let generated = 0;
  let skipped = 0;
  for (const tSnap of templates.docs) {
    const t = tSnap.data() as RecurringExpenseDoc;
    const org = (await db.collection("organizations").doc(t.organizationId).get()).data() as OrganizationDoc | undefined;
    if (!org) continue;
    const today = localDateInTimezone(nowMs, requireTimezone(org.timezone, `organization "${t.organizationId}"`));
    let runOn = t.nextRunOn;
    while (runOn <= today && (!t.endOn || runOn <= t.endOn)) {
      const period = periodKey(t, runOn);
      try {
        await run.run({
          auth: { uid: t.createdBy, token: { primaryOrganizationId: t.organizationId, primaryBranchId: t.branchId } },
          data: {
            kind: "expense", docDate: `${runOn}T00:00:00.000Z`, recurringTemplateId: tSnap.id,
            ...(t.vendorId ? { vendorId: t.vendorId } : {}), ...(t.payee ? { payee: t.payee } : {}),
            ...(t.payeeType ? { payeeType: t.payeeType } : {}), ...(t.payeeMembershipId ? { payeeMembershipId: t.payeeMembershipId } : {}),
            ...(t.expenseCategoryId ? { expenseCategoryId: t.expenseCategoryId } : {}),
            lines: t.lines, idempotencyKey: `recurring-${tSnap.id}-${period}`,
          },
        });
        generated++;
      } catch (err) {
        skipped++;
        console.error(`[recurring] ${tSnap.id} ${period} not generated:`, (err as Error).message);
        break; // retried by the next sweep (same idempotency key)
      }
      runOn = nextRunOn(t, addDaysYmd(runOn, 1));
      await tSnap.ref.update({ nextRunOn: runOn, lastGeneratedPeriod: period, updatedAt: new Date().toISOString() });
    }
  }
  return { generated, skipped };
}
