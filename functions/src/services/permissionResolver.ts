/**
 * Four-Layer Permission Resolution Engine
 * 
 * Ported from Trado legacy contracts and Flutter RBAC definitions:
 * - Layer 1: Subscription Plan moduleFlags
 * - Layer 2: Organization moduleToggles
 * - Layer 3: Base Role permissions
 * - Layer 4: Membership overrides (Explicit deny overrides grant)
 * 
 * Super Admin bypasses tenant limits for platform capabilities.
 * Org Owner has all capabilities within active tenant modules.
 */

import { AppPermissions } from "../constants/permissions.js";

export interface PermissionResolutionContext {
  isSuperAdmin: boolean;
  roleCode?: string;
  rolePermissions: string[];
  membershipOverrides: Record<string, boolean>; // explicit true (grant) or false (deny)
  planModuleFlags: Record<string, boolean>;
  orgModuleToggles: Record<string, boolean>;
}

/**
 * Maps a permission code to its parent module code.
 */
export function getModuleForPermission(permissionCode: string): string {
  if (permissionCode.startsWith("platform:")) return "platform";

  const prefix = permissionCode.split(":")[0]?.toLowerCase() ?? "";

  switch (prefix) {
    case "bill":
    case "pos":
    case "payment":
    case "payments":
      return "billing";
    case "sale":
    case "sales":
    case "order":
    case "orders":
    case "delivery":
    case "return":
    case "returns":
      return "sales";
    case "inventory":
    case "stock":
    case "item":
    case "product":
    case "category":
    case "unit":
      return "inventory";
    case "expense":
    case "expenses":
    case "outflow":
      return "expenses";
    case "purchase":
    case "purchases":
    case "vendor":
    case "vendors":
      return "purchases";
    case "customer":
    case "customers":
      return "customers";
    case "report":
    case "reports":
      return "reports";
    case "employee":
    case "role":
    case "department":
    case "job_role":
    case "team":
    case "audit":
    case "org":
      return "staff";
    default:
      return "system";
  }
}

/**
 * Checks if a module is active across Layer 1 (Plan) and Layer 2 (Organization).
 */
export function isModuleActive(
  moduleCode: string,
  planFlags: Record<string, boolean>,
  orgToggles: Record<string, boolean>
): boolean {
  if (moduleCode === "platform" || moduleCode === "system") {
    return true;
  }

  // Layer 1: Plan must allow the module
  // If planFlags has the key and it is false, module is disabled
  if (planFlags[moduleCode] === false) {
    return false;
  }

  // Layer 2: Organization must not have disabled the module
  // If orgToggles has the key and it is false, module is disabled
  if (orgToggles[moduleCode] === false) {
    return false;
  }

  return true;
}

/**
 * Resolves whether a single permission is granted in the given context.
 */
export function resolvePermission(
  requiredPermission: string,
  context: PermissionResolutionContext
): boolean {
  // 1. Super Admin bypass
  if (context.isSuperAdmin) {
    return true;
  }

  // Deny platform permissions to non-super-admins
  if (requiredPermission.startsWith("platform:")) {
    return false;
  }

  // Check Module Activation (Layers 1 & 2)
  const moduleCode = getModuleForPermission(requiredPermission);
  if (!isModuleActive(moduleCode, context.planModuleFlags, context.orgModuleToggles)) {
    return false;
  }

  // Layer 4: Explicit Membership Overrides (DENY takes strict precedence!)
  if (context.membershipOverrides[requiredPermission] === false) {
    return false;
  }

  // Check prefix wildcard denys (e.g. "bill:*": false)
  const parts = requiredPermission.split(":");
  for (let i = 1; i < parts.length; i++) {
    const prefixWildcard = `${parts.slice(0, i).join(":")}:*`;
    if (context.membershipOverrides[prefixWildcard] === false) {
      return false;
    }
  }

  // If explicitly granted in Layer 4 overrides:
  if (context.membershipOverrides[requiredPermission] === true) {
    return true;
  }

  // Org Owner has all capabilities within active tenant modules
  if (context.roleCode === "org_owner") {
    return true;
  }

  // Layer 3: Base Role Permissions & Wildcards
  if (context.rolePermissions.includes(AppPermissions.ALL)) {
    return true;
  }

  if (context.rolePermissions.includes(requiredPermission)) {
    return true;
  }

  // Check wildcard matching from role (e.g., "bill:*", "report:*")
  for (let i = 1; i < parts.length; i++) {
    const prefixWildcard = `${parts.slice(0, i).join(":")}:*`;
    if (context.rolePermissions.includes(prefixWildcard)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes all effective permission codes for an active membership session.
 */
export function resolveAllEffectivePermissions(
  allCatalogCodes: string[],
  context: PermissionResolutionContext
): string[] {
  if (context.isSuperAdmin) {
    return [AppPermissions.ALL, AppPermissions.PLATFORM_ALL, ...allCatalogCodes];
  }

  const effective: string[] = [];

  for (const code of allCatalogCodes) {
    if (resolvePermission(code, context)) {
      effective.push(code);
    }
  }

  return effective;
}
