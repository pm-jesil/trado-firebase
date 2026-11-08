/**
 * Field-level READ control.
 *
 * List/get callables return documents redacted by the caller's permissions. Sensitive fields
 * are removed (not nulled) so clients cannot mistake "hidden" for "zero".
 *
 *   products   costPrice, weightedAverageCost           product:view_cost | inventory:manage | report:profit
 *   bills      items[].costSnapshot                     product:view_cost | report:profit
 *   customers  outstandingBalance, totalSpend, creditLimit   customer:view_balance | payment:view
 *   vendors    outstandingPayable, totalPurchase, creditLimit vendor:view_balance | payment:view
 *   outflows   employee-linked (payeeMembershipId) expenses expense:view_sensitive (else excluded)
 */

import { AppPermissions } from "../constants/permissions.js";
import type { RequestContext } from "./contextResolver.js";

type Doc = Record<string, unknown>;

function canAny(ctx: Pick<RequestContext, "can">, codes: string[]): boolean {
  return codes.some((c) => ctx.can(c));
}

function omit<T extends Doc>(doc: T, fields: string[]): T {
  const copy = { ...doc };
  for (const f of fields) delete copy[f];
  return copy;
}

export function canViewCost(ctx: Pick<RequestContext, "can">): boolean {
  return canAny(ctx, [AppPermissions.PRODUCT_VIEW_COST, AppPermissions.INVENTORY_MANAGE, AppPermissions.REPORT_PROFIT]);
}

export function redactProduct<T extends Doc>(doc: T, ctx: Pick<RequestContext, "can">): T {
  return canViewCost(ctx) ? doc : omit(doc, ["costPrice", "weightedAverageCost"]);
}

export function redactBill<T extends Doc>(doc: T, ctx: Pick<RequestContext, "can">): T {
  if (canViewCost(ctx) || !Array.isArray(doc.items)) return doc;
  return { ...doc, items: (doc.items as Doc[]).map((i) => omit(i, ["costSnapshot"])) };
}

export function redactCustomer<T extends Doc>(doc: T, ctx: Pick<RequestContext, "can">): T {
  return canAny(ctx, [AppPermissions.CUSTOMER_VIEW_BALANCE, AppPermissions.PAYMENT_VIEW])
    ? doc
    : omit(doc, ["outstandingBalance", "totalSpend", "creditLimit"]);
}

export function redactVendor<T extends Doc>(doc: T, ctx: Pick<RequestContext, "can">): T {
  return canAny(ctx, [AppPermissions.VENDOR_VIEW_BALANCE, AppPermissions.PAYMENT_VIEW])
    ? doc
    : omit(doc, ["outstandingPayable", "totalPurchase", "creditLimit"]);
}

/** Employee-linked expenses (salary, advance, reimbursement) are sensitive. */
export function canViewOutflow(doc: Doc, ctx: Pick<RequestContext, "can">): boolean {
  if (!doc.payeeMembershipId) return true;
  return ctx.can(AppPermissions.EXPENSE_VIEW_SENSITIVE);
}
