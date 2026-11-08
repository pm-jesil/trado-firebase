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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../services/firebase.js";
import { parseInput } from "../validation/parseInput.js";
import { ContextFields, OutflowLineSchema } from "../validation/schemas.js";
import { resolveRequestContext } from "../services/contextResolver.js";
import { AppPermissions } from "../constants/permissions.js";
import { createAuditLog, diffChanges } from "../services/audit.js";
import { fetchPage } from "../services/pagination.js";
import { DEFAULT_ORG_TIMEZONE, localDateInTimezone, addDaysYmd } from "../services/subscription.js";
import { OrganizationDoc } from "../types/models.js";

const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const CreateRecurringExpenseSchema = z.strictObject({
  ...ContextFields,
  name: z.string().trim().min(2).max(120),
  vendorId: z.string().trim().min(2).optional(),
  payee: z.string().trim().min(1).max(200).optional(),
  payeeType: z.enum(["vendor", "employee", "other"]).optional(),
  payeeMembershipId: z.string().trim().min(2).optional(),
  expenseCategoryId: z.string().trim().max(60).optional(),
  lines: z.array(OutflowLineSchema).min(1).max(20),
  frequency: z.enum(["monthly", "weekly"]),
  dayOfMonth: z.number().int().min(1).max(28).optional(), // monthly (1–28: exists every month)
  weekday: z.number().int().min(1).max(7).optional(), // weekly, ISO 1 = Monday
  startOn: CalendarDate,
  endOn: CalendarDate.optional(),
});

export const UpdateRecurringExpenseSchema = z.strictObject({
  ...ContextFields,
  templateId: z.string().trim().min(2),
  name: z.string().trim().min(2).max(120).optional(),
  lines: z.array(OutflowLineSchema).min(1).max(20).optional(),
  endOn: CalendarDate.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const ListRecurringExpensesSchema = z.strictObject({
  ...ContextFields,
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  startAfterId: z.string().trim().optional(),
});

type Template = z.infer<typeof CreateRecurringExpenseSchema> & {
  organizationId: string; nextRunOn: string; lastGeneratedPeriod?: string; isActive: boolean; createdBy: string; createdByMembershipId: string | null;
};

/** First run date on/after `from` for the template's schedule. */
export function nextRunOn(t: Pick<Template, "frequency" | "dayOfMonth" | "weekday">, from: string): string {
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
export function periodKey(t: Pick<Template, "frequency">, runOn: string): string {
  return t.frequency === "monthly" ? runOn.slice(0, 7) : runOn;
}

export const recurringExpensesCreate = onCall({ region: "asia-south1" }, async (request) => {
  const input = parseInput(CreateRecurringExpenseSchema, request.data);
  const ctx = await resolveRequestContext(request, { requiredPermission: AppPermissions.EXPENSE_CREATE });
  if (input.frequency === "monthly" && !input.dayOfMonth) throw new HttpsError("invalid-argument", "dayOfMonth is required for monthly templates.");
  if (input.frequency === "weekly" && !input.weekday) throw new HttpsError("invalid-argument", "weekday is required for weekly templates.");
  if (input.lines.some((l) => l.productId)) throw new HttpsError("invalid-argument", "Recurring expenses use non-catalog lines (itemName), not products.");
  const now = new Date().toISOString();
  const ref = db.collection("recurringExpenses").doc();
  const doc: Template = {
    ...input,
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    nextRunOn: nextRunOn(input, input.startOn),
    isActive: true,
    createdBy: ctx.callerUid,
    createdByMembershipId: ctx.membershipId,
  };
  await ref.set({ ...doc, createdAt: now, updatedAt: now });
  await createAuditLog({ organizationId: ctx.organizationId, branchId: ctx.branchId, actorUid: ctx.callerUid, actorMembershipId: ctx.membershipId, action: "RECURRING_EXPENSE_CREATED", entityType: "recurring_expense", entityId: ref.id });
  return { templateId: ref.id, nextRunOn: doc.nextRunOn };
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
  await createAuditLog({ organizationId: ctx.organizationId, branchId: ctx.branchId, actorUid: ctx.callerUid, actorMembershipId: ctx.membershipId, action: "RECURRING_EXPENSE_UPDATED", entityType: "recurring_expense", entityId: ref.id, changes: diffChanges(snap.data(), updates) });
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
    const t = tSnap.data() as Template;
    const org = (await db.collection("organizations").doc(t.organizationId).get()).data() as OrganizationDoc | undefined;
    if (!org) continue;
    const today = localDateInTimezone(nowMs, org.timezone || DEFAULT_ORG_TIMEZONE);
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
