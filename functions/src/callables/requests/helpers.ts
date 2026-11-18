/**
 * Requests & Support Desk - Shared Helpers
 */

import { RequestCategory } from "../../constants/enums.js";

export function getCallerName(request: { auth?: { token?: Record<string, unknown> } }, context: { callerUid: string }): string {
  return (request.auth?.token?.name as string) || (request.auth?.token?.email as string) || context.callerUid || "Requester";
}

export const SENSITIVE_CATEGORIES = new Set([
  RequestCategory.PLAN_CHANGE,
  RequestCategory.LIMIT_INCREASE,
  RequestCategory.MODULE_REQUEST,
  RequestCategory.ORG_PROFILE_CHANGE,
  RequestCategory.OWNERSHIP_TRANSFER,
  RequestCategory.DATA_REQUEST,
]);
