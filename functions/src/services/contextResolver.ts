/**
 * Centralized Request Context Resolver — the single tenant gate.
 *
 * Every tenant callable resolves its context here. Checks run in this fixed order and fail
 * with a distinct, stable reason (HttpsError.details.reason, also prefixed to the message):
 *
 *   authenticated → user active → membership active → organization active
 *   → subscription valid (server time) → plan includes module → org/branch module toggle
 *   → role/override permission (deny wins) → branch assignment → business logic
 *
 * Reads on the hot path: one batched getAll (user, organization, membership, branch,
 * membershipBranch) + one batched getAll (role, plan when not cached). Plans change rarely and
 * are cached per instance for PLAN_CACHE_TTL_MS; user/membership/org/role status is always
 * read live so revocation is immediate.
 *
 * Super Admin is a platform operator only: it may run `platform:*` operations and read-only
 * tenant views (support), but never tenant mutations.
 */

import { HttpsError, type CallableRequest, type FunctionsErrorCode } from "firebase-functions/v2/https";
import { db } from "./firebase.js";
import { effectiveBusinessConfig } from "../constants/businessDefaults.js";
import {
  OrganizationDoc,
  BranchDoc,
  MembershipDoc,
  MembershipBranchDoc,
  SubscriptionPlanDoc,
  RoleDoc,
  UserDoc,
  TeamDoc,
} from "../types/models.js";
import { EntityStatus, GateReason } from "../constants/enums.js";
import {
  resolvePermission,
  resolveAllEffectivePermissions,
  getModuleForPermission,
  type PermissionResolutionContext,
} from "./permissionResolver.js";
import { evaluateSubscription, DEFAULT_ORG_TIMEZONE, type SubscriptionEvaluation } from "./subscription.js";
import {
  incrementServerUsage,
  getServerUsageSnapshot,
  evaluateUsageLimits,
  mergeUsageLimits,
  type MeteredMetric,
} from "./usageMetering.js";
import { withCategory, currentContext } from "./requestContext.js";
import { AppPermissions } from "../constants/permissions.js";

/**
 * Operations never blocked by usage limits, so a tenant at its limit can still settle money,
 * finish in-flight documents, complete deliveries and see its own usage/subscription.
 */
const USAGE_EXEMPT_PERMISSIONS = new Set<string>([
  AppPermissions.PAYMENT_CREATE, AppPermissions.PAYMENT_VIEW,
  AppPermissions.BILL_VOID, AppPermissions.PURCHASE_VOID, AppPermissions.EXPENSE_VOID, AppPermissions.OUTFLOW_VOID,
  AppPermissions.BILL_APPROVE, AppPermissions.PURCHASE_APPROVE, AppPermissions.EXPENSE_APPROVE, AppPermissions.OUTFLOW_APPROVE,
  AppPermissions.DELIVERY_UPDATE, AppPermissions.ORG_VIEW, AppPermissions.NOTIFICATION_VIEW,
]);

/** Which operation classes a breached metric blocks. */
function metricBlocks(metric: string, isMutation: boolean, required: string[]): boolean {
  switch (metric) {
    case "functionsInvocations": return true;
    case "firestoreWrites": return isMutation;
    case "firestoreReads": return !isMutation;
    case "locationPings": return required.includes(AppPermissions.LOCATION_PING);
    default: return false;
  }
}

export interface RequestContextOptions {
  /** Permission code, or a list where holding ANY one grants access. */
  requiredPermission?: string | string[];
  allowPlatformSuperAdmin?: boolean;
  allowInactiveBranch?: boolean;
  allowTeamLeader?: boolean;
  /** Server-derived branch override (e.g. the branch of a referenced document). */
  branchId?: string;
  /** Server-derived organization (e.g. the organization of an existing record being updated). */
  organizationId?: string;
  /**
   * Declares the operation class when the permission list alone is ambiguous (e.g. catalog reads
   * granted to holders of bill:create). Default: "read" iff every required permission is read-only.
   */
  operation?: "read" | "write";
}

export interface RequestContext {
  callerUid: string;
  isSuperAdmin: boolean;
  organizationId: string;
  branchId: string;
  membershipId: string | null;
  organization: OrganizationDoc;
  branch: BranchDoc;
  membership?: MembershipDoc;
  membershipBranch?: MembershipBranchDoc;
  plan: SubscriptionPlanDoc;
  role?: RoleDoc;
  isOwner: boolean;
  subscription: SubscriptionEvaluation;
  effectivePermissions: string[];
  /** Evaluates any permission code against the same layered context (deny wins). */
  can: (permissionCode: string) => boolean;
}

/** Builds an HttpsError carrying a stable machine-readable reason. */
export function gateError(code: FunctionsErrorCode, reason: GateReason, message: string): HttpsError {
  return new HttpsError(code, `[${reason}] ${message}`, { reason });
}

const READ_ONLY_PERMISSION = /:(view|view_all|view_own|view_cost|profit|export|dashboard)$/;

/** True when a tenant permission only reads data (Super Admin support access is allowed). */
export function isReadOnlyPermission(code: string): boolean {
  return READ_ONLY_PERMISSION.test(code);
}

// ---------------------------------------------------------------------------
// Plan cache (bounded staleness; plans change rarely)
// ---------------------------------------------------------------------------
const PLAN_CACHE_TTL_MS = Number(process.env.PLAN_CACHE_TTL_MS || 30_000);
const planCache = new Map<string, { plan: SubscriptionPlanDoc | null; expiresAt: number }>();

export function invalidatePlanCache(planId?: string): void {
  if (planId) planCache.delete(planId);
  else planCache.clear();
}

function cachedPlan(planId: string): SubscriptionPlanDoc | null | undefined {
  const hit = planCache.get(planId);
  if (hit && hit.expiresAt > Date.now()) return hit.plan;
  return undefined;
}

const FALLBACK_PLAN: SubscriptionPlanDoc = {
  name: "Standard Plan",
  price: 0,
  currency: "INR",
  storageLimitMb: 1024,
  monthlyDocumentVolumeLimit: 5000,
  seatLimits: { admin: 5, staff: 20 },
  branchLimit: 1,
  moduleFlags: {},
  isActive: true,
};

const PLATFORM_ORG: OrganizationDoc = {
  name: "Trado Platform Admin",
  businessType: "retail_only" as OrganizationDoc["businessType"],
  businessCategory: "general" as OrganizationDoc["businessCategory"],
  country: "IN",
  currency: "INR",
  taxRegimeCode: "IN_GST",
  status: EntityStatus.ACTIVE,
  planId: "plan_enterprise",
  moduleToggles: {},
  defaultBranchId: "main-branch",
  branchCount: 1,
  createdAt: "1970-01-01T00:00:00.000Z",
  createdBy: "system",
};

const PLATFORM_BRANCH: BranchDoc = {
  organizationId: "platform",
  name: "Platform Management",
  code: "MAIN",
  isDefault: true,
  isActive: true,
  createdAt: "1970-01-01T00:00:00.000Z",
  createdBy: "system",
};

function toList(p?: string | string[]): string[] {
  if (!p) return [];
  return Array.isArray(p) ? p : [p];
}

export async function resolveRequestContext(
  request: CallableRequest,
  options: RequestContextOptions = {}
): Promise<RequestContext> {
  const meter: MeterHandle = {};
  try {
    // The gate's reads are counted as category "gate"; what it resolved becomes the request's
    // attribution (prompt 66 §3.1): no read is added for it. Super Admin work is platform work (D-21).
    const gate = await withCategory("gate", () => resolveGate(request, options, meter));
    const exec = currentContext();
    if (exec) {
      exec.organizationId = gate.isSuperAdmin ? "platform" : gate.organizationId;
      exec.targetOrgId = gate.isSuperAdmin ? gate.organizationId : null;
      exec.timeZone = gate.organization.timezone || DEFAULT_ORG_TIMEZONE;
      exec.actor = {
        uid: gate.callerUid,
        kind: gate.isSuperAdmin ? "superAdminOnBehalf" : "user",
        role: gate.role?.code ?? null,
        membershipId: gate.membershipId,
        branchId: gate.branchId,
      };
    }
    return gate;
  } catch (err) {
    // A call denied after metering performed no operation: give the operation unit back
    // (the invocation itself stays counted), so denials never consume a tenant's quota.
    if (meter.refund) await meter.refund().catch((e) => console.error("[usage] refund failed", e));
    throw err;
  }
}

interface MeterHandle {
  refund?: () => Promise<void>;
}

async function resolveGate(
  request: CallableRequest,
  options: RequestContextOptions,
  meter: MeterHandle
): Promise<RequestContext> {
  // 1. Authentication
  if (!request.auth) {
    throw gateError("unauthenticated", GateReason.UNAUTHENTICATED, "Authentication required.");
  }

  const callerUid = request.auth.uid;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true;
  const clientData = (request.data || {}) as Record<string, unknown>;
  const required = toList(options.requiredPermission);

  const clientOrgId = options.organizationId ||
    (typeof clientData.organizationId === "string" ? clientData.organizationId.trim() || undefined : undefined);
  const clientBranchId = options.branchId ||
    (typeof clientData.branchId === "string" ? clientData.branchId.trim() || undefined : undefined);
  const tokenOrgId = typeof request.auth.token.primaryOrganizationId === "string"
    ? request.auth.token.primaryOrganizationId.trim() || undefined
    : undefined;
  const tokenBranchId = typeof request.auth.token.primaryBranchId === "string"
    ? request.auth.token.primaryBranchId.trim() || undefined
    : undefined;

  // 2. Super Admin: platform operator only
  if (isSuperAdmin) {
    const tenantPerms = required.filter((p) => !p.startsWith("platform:"));
    if (tenantPerms.length > 0 && options.operation !== "read" && !tenantPerms.every(isReadOnlyPermission)) {
      throw gateError(
        "permission-denied",
        GateReason.SUPER_ADMIN_TENANT_FORBIDDEN,
        "Super Admin is a platform operator and cannot perform tenant operations. Sign in as an organization member."
      );
    }
    if (!clientOrgId && options.allowPlatformSuperAdmin) {
      if (tenantPerms.length > 0) {
        throw gateError("invalid-argument", GateReason.TENANT_MISMATCH,
          "Super Admin business operations require an explicit target organizationId.");
      }
      return {
        callerUid,
        isSuperAdmin: true,
        organizationId: "platform",
        branchId: "main-branch",
        membershipId: null,
        organization: PLATFORM_ORG,
        branch: PLATFORM_BRANCH,
        plan: { ...FALLBACK_PLAN, name: "Platform Unlimited", branchLimit: 999 },
        isOwner: false,
        subscription: { allowed: true, state: "legacy_unset" },
        effectivePermissions: ["platform:*"],
        can: (code) => code.startsWith("platform:"),
      };
    }
    if (!clientOrgId) {
      throw gateError("invalid-argument", GateReason.TENANT_MISMATCH,
        "Super Admin operations require an explicit target organizationId.");
    }
  }

  // 3. Target organization (token claim is authoritative for tenant users)
  if (!isSuperAdmin && clientOrgId && tokenOrgId && clientOrgId !== tokenOrgId) {
    throw gateError("permission-denied", GateReason.TENANT_MISMATCH,
      "Client-supplied organizationId does not match caller's active organization context.");
  }
  let targetOrgId = isSuperAdmin ? clientOrgId : (tokenOrgId || clientOrgId);

  if (!targetOrgId) {
    const memQuery = await db.collection("memberships")
      .where("userId", "==", callerUid)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (memQuery.empty) {
      throw gateError("permission-denied", GateReason.NO_MEMBERSHIP, "No active organization membership found.");
    }
    targetOrgId = (memQuery.docs[0].data() as MembershipDoc).organizationId;
  }

  // 4. Batched read #1
  const membershipId = `${callerUid}_${targetOrgId}`;
  const orgRef = db.collection("organizations").doc(targetOrgId);
  let candidateBranchId = clientBranchId || tokenBranchId || "main-branch";
  const branchRef = (id: string) => orgRef.collection("branches").doc(id);
  const mbRef = (id: string) => db.collection("membershipBranches").doc(`${membershipId}_${id}`);

  const [userSnap, orgSnap, memSnap, branchSnap0, mbSnap0] = await db.getAll(
    db.collection("users").doc(callerUid),
    orgRef,
    db.collection("memberships").doc(membershipId),
    branchRef(candidateBranchId),
    mbRef(candidateBranchId),
  );

  if (!isSuperAdmin) {
    const user = userSnap.exists ? (userSnap.data() as UserDoc) : null;
    if (!user || !user.isActive) {
      throw gateError("permission-denied", GateReason.USER_INACTIVE, "User account is inactive or suspended.");
    }
    if (!memSnap.exists) {
      throw gateError("permission-denied", GateReason.NO_MEMBERSHIP, "Caller is not a member of this organization.");
    }
    if ((memSnap.data() as MembershipDoc).status !== EntityStatus.ACTIVE) {
      throw gateError("permission-denied", GateReason.MEMBERSHIP_INACTIVE, "Caller membership in this organization is not active.");
    }
  }

  if (!orgSnap.exists) {
    throw gateError("not-found", GateReason.ORG_NOT_FOUND, `Organization "${targetOrgId}" not found.`);
  }
  const orgData = orgSnap.data() as OrganizationDoc;
  if (orgData.status !== EntityStatus.ACTIVE) {
    throw gateError("failed-precondition", GateReason.ORG_INACTIVE, `Organization "${targetOrgId}" is not active.`);
  }

  // 5. Subscription (Super Admin may still operate on expired organizations)
  const subscription = evaluateSubscription(orgData);
  if (!isSuperAdmin && !subscription.allowed) {
    throw gateError("failed-precondition", subscription.reason || GateReason.SUBSCRIPTION_EXPIRED,
      `Organization subscription is ${subscription.state}. Contact the platform administrator to renew.`);
  }

  // 5b. Server-side metering: one sharded write, issued in parallel with read #2 (no extra round trip)
  const isMutation = options.operation ? options.operation === "write" : required.length > 0 && !required.every(isReadOnlyPermission);
  const timeZone = orgData.timezone || DEFAULT_ORG_TIMEZONE;
  const meterMetrics: Partial<Record<MeteredMetric, number>> = {
    functionsInvocations: 1,
    [isMutation ? "firestoreWrites" : "firestoreReads"]: 1,
  };
  if (required.includes(AppPermissions.LOCATION_PING)) meterMetrics.locationPings = 1;
  const meterBranchId = candidateBranchId;
  const metering = isSuperAdmin
    ? Promise.resolve()
    : incrementServerUsage({ organizationId: targetOrgId, branchId: meterBranchId, timeZone, metrics: meterMetrics })
      .then((shard) => {
        const operation = { ...meterMetrics };
        delete operation.functionsInvocations; // the invocation happened; only the operation unit is refunded
        meter.refund = () => incrementServerUsage({ organizationId: targetOrgId, branchId: meterBranchId, timeZone, metrics: operation, shard, sign: -1 }).then(() => undefined);
      })
      .catch((err) => console.error("[usage] metering write failed", err));

  // 6. Batched read #2 (role, plan if not cached, corrected default branch)
  const membershipData = memSnap.exists ? (memSnap.data() as MembershipDoc) : undefined;
  let branchSnap = branchSnap0;
  let mbSnap = mbSnap0;
  const needsDefaultBranch = !clientBranchId && !tokenBranchId &&
    !!orgData.defaultBranchId && orgData.defaultBranchId !== candidateBranchId;
  if (needsDefaultBranch) candidateBranchId = orgData.defaultBranchId as string;

  const planId = orgData.planId;
  let planData = planId ? cachedPlan(planId) : null;
  const second: FirebaseFirestore.DocumentReference[] = [];
  const roleIdx = membershipData?.roleId ? second.push(db.collection("roles").doc(membershipData.roleId)) - 1 : -1;
  const planIdx = planId && planData === undefined ? second.push(db.collection("subscriptionPlans").doc(planId)) - 1 : -1;
  const branchIdx = needsDefaultBranch ? second.push(branchRef(candidateBranchId)) - 1 : -1;
  const mbIdx = needsDefaultBranch ? second.push(mbRef(candidateBranchId)) - 1 : -1;
  const [secondSnaps] = await Promise.all([second.length ? db.getAll(...second) : Promise.resolve([]), metering]);

  const roleData = roleIdx >= 0 && secondSnaps[roleIdx].exists ? (secondSnaps[roleIdx].data() as RoleDoc) : undefined;
  if (planIdx >= 0) {
    planData = secondSnaps[planIdx].exists ? (secondSnaps[planIdx].data() as SubscriptionPlanDoc) : null;
    planCache.set(planId, { plan: planData, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
  }
  const plan = planData || { ...FALLBACK_PLAN, currency: orgData.currency || "INR" };
  if (branchIdx >= 0) branchSnap = secondSnaps[branchIdx];
  if (mbIdx >= 0) mbSnap = secondSnaps[mbIdx];

  // 6b. Usage limits (hard_block): cached snapshot, read fresh when near a limit
  const exempt = required.some((p) => USAGE_EXEMPT_PERMISSIONS.has(p));
  const limits = mergeUsageLimits(plan.usageLimits, orgData.usageLimitOverrides);
  const hasHardLimits = Object.values(limits).some((c) => c && c.enabled !== false && c.enforcementMode === "hard_block");
  if (!isSuperAdmin && !exempt && hasHardLimits) {
    // The snapshot already contains this call's own increment, so a call that brings usage to
    // exactly the limit is allowed (includesCurrentCall) and the (limit + 1)-th is refused.
    let verdict = evaluateUsageLimits(limits, await getServerUsageSnapshot(targetOrgId, timeZone), true);
    if (verdict.nearLimit) verdict = evaluateUsageLimits(limits, await getServerUsageSnapshot(targetOrgId, timeZone, true), true);
    const breach = verdict.breaches.find((b) => metricBlocks(b.metric, isMutation, required));
    if (breach) {
      throw new HttpsError("resource-exhausted",
        `[${GateReason.USAGE_LIMIT_EXCEEDED}] ${breach.period} ${breach.metric} limit reached (${breach.usage}/${breach.limit}). Contact the organization owner or platform administrator.`,
        { reason: GateReason.USAGE_LIMIT_EXCEEDED, ...breach });
    }
  }

  // 7. Branch document (existence is enforced after the permission check, per gate order)
  const branchData = (branchSnap.exists ? branchSnap.data() : { settings: {} }) as BranchDoc;
  const membershipBranchData = mbSnap.exists ? (mbSnap.data() as MembershipBranchDoc) : undefined;
  const isOwner = roleData?.code === "org_owner" || membershipData?.roleId === "role_org_owner";

  const resolutionContext: PermissionResolutionContext = {
    isSuperAdmin: false,
    roleCode: roleData?.code,
    rolePermissions: roleData?.permissions || [],
    membershipOverrides: membershipData?.permissions || {},
    branchMembershipOverrides: membershipBranchData?.permissions,
    planModuleFlags: plan.moduleFlags || {},
    orgModuleToggles: effectiveBusinessConfig(orgData).modules,
    branchModuleOverrides: branchData.settings?.moduleOverrides,
  };

  const can = isSuperAdmin
    ? (code: string) => code.startsWith("platform:") || isReadOnlyPermission(code)
    : (code: string) => resolvePermission(code, resolutionContext);

  // 8. Plan entitlement → module toggle → permission (distinct reasons)
  if (required.length > 0) {
    const modules = Array.from(new Set(required.map(getModuleForPermission)));
    const inPlan = modules.filter((m) => m === "platform" || m === "system" || (plan.moduleFlags || {})[m] !== false);
    if (inPlan.length === 0) {
      throw gateError("permission-denied", GateReason.MODULE_NOT_IN_PLAN,
        `Module "${modules.join(", ")}" is not included in the organization's subscription plan.`);
    }
    const orgModules = effectiveBusinessConfig(orgData).modules; // override ?? business-type default
    const enabled = inPlan.filter((m) => orgModules[m] !== false &&
      (branchData.settings?.moduleOverrides || {})[m] !== false);
    if (enabled.length === 0) {
      throw gateError("permission-denied", GateReason.MODULE_DISABLED,
        `Module "${inPlan.join(", ")}" is disabled for this organization or branch.`);
    }
    if (!isSuperAdmin && !required.some(can)) {
      let isAuthorizedLeader = false;
      if (options.allowTeamLeader && request.data?.teamId && membershipId) {
        const teamSnap = await db.collection("teams").doc(request.data.teamId).get();
        if (teamSnap.exists) {
          const team = teamSnap.data() as TeamDoc;
          if (team.organizationId === targetOrgId && team.leaderMembershipId === membershipId) {
            isAuthorizedLeader = true;
          }
        }
      }
      if (!isAuthorizedLeader) {
        throw gateError("permission-denied", GateReason.PERMISSION_DENIED,
          `Insufficient permissions: "${required.join("\" or \"")}" is required.`);
      }
    }
  }

  // 9. Branch existence, status & assignment
  if (!branchSnap.exists) {
    throw gateError("not-found", GateReason.BRANCH_NOT_FOUND,
      `Branch "${candidateBranchId}" not found in organization "${targetOrgId}".`);
  }
  if (!branchData.isActive && !options.allowInactiveBranch) {
    throw gateError("failed-precondition", GateReason.BRANCH_INACTIVE, `Branch "${candidateBranchId}" is inactive.`);
  }
  if (!isSuperAdmin && !isOwner) {
    if (!membershipBranchData ||
      (membershipBranchData.status !== EntityStatus.ACTIVE && !options.allowInactiveBranch)) {
      throw gateError("permission-denied", GateReason.BRANCH_NOT_ASSIGNED,
        `Caller is not assigned to branch "${candidateBranchId}".`);
    }
  }

  return {
    callerUid,
    isSuperAdmin,
    organizationId: targetOrgId,
    branchId: candidateBranchId,
    membershipId: isSuperAdmin ? null : membershipId,
    organization: orgData,
    branch: branchData,
    membership: membershipData,
    membershipBranch: membershipBranchData,
    plan,
    role: roleData,
    isOwner,
    subscription,
    effectivePermissions: isSuperAdmin
      ? ["platform:*"]
      : resolveAllEffectivePermissions(roleData?.permissions || [], resolutionContext),
    can,
  };
}

// ---------------------------------------------------------------------------
// Data scope: WHOSE data a caller may see (permissions say WHAT they may do)
// ---------------------------------------------------------------------------

export type DataScopeLevel = "self" | "team" | "branch" | "organization";
export type DataScopeModule = "sales" | "purchases" | "expenses" | "deliveries" | "returns" | "payments" | "stock" | "tasks";

export interface DataScope {
  level: DataScopeLevel;
  /** Restrict to this branch (null = all branches). */
  branchId: string | null;
  /** Restrict to documents created by these users (null = anyone). */
  userIds: string[] | null;
}

const MAX_TEAM_DEPTH = 5;
const MAX_TEAM_SIZE = 300;

/** Recursively collects the user ids of a membership's reportees (reportingToIds graph, cycle-safe). */
export async function collectReporteeUserIds(organizationId: string, membershipId: string): Promise<string[]> {
  const seen = new Set<string>([membershipId]);
  const userIds: string[] = [];
  let frontier = [membershipId];
  for (let depth = 0; depth < MAX_TEAM_DEPTH && frontier.length && seen.size < MAX_TEAM_SIZE; depth++) {
    const next: string[] = [];
    for (const managerId of frontier) {
      const snap = await db.collection("memberships")
        .where("organizationId", "==", organizationId)
        .where("reportingToIds", "array-contains", managerId)
        .limit(MAX_TEAM_SIZE)
        .get();
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        userIds.push((d.data() as MembershipDoc).userId);
        next.push(d.id);
      }
    }
    frontier = next;
  }
  return userIds;
}

/**
 * Resolves the caller's data scope for a module. Precedence:
 *   explicit membership.dataScopes[module] → Owner/Admin: organization →
 *   holds `viewAllPermission`: branch → has reportees: team → self.
 * Organization scope honours a requested branch filter; narrower scopes are pinned to the
 * gate-validated branch.
 */
export async function resolveDataScope(
  ctx: RequestContext,
  module: DataScopeModule,
  viewAllPermission?: string,
  requestedBranchId?: string
): Promise<DataScope> {
  if (ctx.isSuperAdmin) return { level: "organization", branchId: requestedBranchId || null, userIds: null };

  let level: DataScopeLevel | undefined = ctx.membership?.dataScopes?.[module];
  if (!level) {
    if (ctx.isOwner || ctx.role?.code === "admin") level = "organization";
    else if (viewAllPermission && ctx.can(viewAllPermission)) level = "branch";
  }

  if (level === "organization") return { level, branchId: requestedBranchId || null, userIds: null };
  if (level === "branch") return { level, branchId: ctx.branchId, userIds: null };

  const reportees = ctx.membershipId ? await collectReporteeUserIds(ctx.organizationId, ctx.membershipId) : [];
  if (level === "team" || (!level && reportees.length > 0)) {
    return { level: "team", branchId: ctx.branchId, userIds: [ctx.callerUid, ...reportees] };
  }
  return { level: "self", branchId: ctx.branchId, userIds: [ctx.callerUid] };
}

/** Applies a data scope to a Firestore query; returns a post-filter for scopes too large for `in`. */
export function applyDataScope(
  query: FirebaseFirestore.Query,
  scope: DataScope,
  actorField = "createdBy"
): { query: FirebaseFirestore.Query; keep: (doc: Record<string, unknown>) => boolean } {
  let q = query;
  if (scope.branchId) q = q.where("branchId", "==", scope.branchId);
  if (scope.userIds && scope.userIds.length <= 30) {
    q = q.where(actorField, "in", scope.userIds);
    return { query: q, keep: () => true };
  }
  return { query: q, keep: (doc) => isInDataScope(doc, scope, actorField) };
}

/** True when a single document falls inside the caller's data scope. */
export function isInDataScope(doc: Record<string, unknown>, scope: DataScope, actorField = "createdBy"): boolean {
  if (scope.branchId && doc.branchId && doc.branchId !== scope.branchId) return false;
  if (scope.userIds && !scope.userIds.includes(String(doc[actorField]))) return false;
  return true;
}

/**
 * Gate for reference records that are either global (organizationId null: platform data,
 * Super Admin only) or organization-scoped (tenant gate with `permission`).
 * Returns the tenant context for org-scoped records, or null for global ones.
 */
export async function resolveCatalogWriteAccess(
  request: CallableRequest,
  organizationId: string | null | undefined,
  permission: string | string[]
): Promise<RequestContext | null> {
  if (!request.auth) {
    throw gateError("unauthenticated", GateReason.UNAUTHENTICATED, "Authentication required.");
  }
  if (!organizationId) {
    if (request.auth.token.isSuperAdmin !== true) {
      throw gateError("permission-denied", GateReason.PERMISSION_DENIED, "Super Admin privileges required to manage global reference data.");
    }
    return null;
  }
  return resolveRequestContext(request, { requiredPermission: permission, organizationId });
}
