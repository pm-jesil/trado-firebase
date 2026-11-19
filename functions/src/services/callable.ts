/**
 * The one callable wrapper (prompt 66, design DD-1). Callables import `onCall` from here instead of
 * `firebase-functions/v2/https`; the signature is the SDK's.
 *
 * Per request it: removes and validates the client's `_meta` (before the handler's strict schema sees
 * the payload), opens the RequestContext (request id, server time, truncated IP, user-agent family,
 * App Check, device), runs the handler, and hands the finished context to `finishRequest` (meter and
 * audit, services/requestRecorder.ts). The organization never comes from `_meta` (D-26).
 */
import { onCall as sdkOnCall, CallableOptions, CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { ClientMetaSchema } from "../validation/schemas.js";
import { createContext, runInContext, truncateIp, userAgentFamily, withCategory, ClientMeta } from "./requestContext.js";
import { db } from "./firebase.js";
import { GateReason } from "../constants/enums.js";
import { finishRequest } from "./requestRecorder.js";

/** `requireMeta` (D-26): off until the Flutter app sends `_meta` (docs/guides/client-meta.md). */
const REQUIRE_META = process.env.REQUIRE_META === "true";

function callableName(request: CallableRequest): string {
  const header = (request.rawRequest?.headers?.["x-callable-name"] as string | undefined)?.trim();
  if (header) return header;
  const url = (request.rawRequest && (request.rawRequest.originalUrl || request.rawRequest.url)) || "";
  const last = url.split("?")[0].split("/").filter(Boolean).pop();
  return (last && last !== "triggers" && last !== "functions") ? last : process.env.FUNCTION_TARGET || process.env.K_SERVICE || "unknown";
}

function takeMeta(request: CallableRequest): ClientMeta | null {
  const data = request.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== "object" || Array.isArray(data) || !("_meta" in data)) {
    if (REQUIRE_META) throw new HttpsError("invalid-argument", "[META_REQUIRED] Every call must carry `_meta` (docs/guides/client-meta.md).", { reason: "META_REQUIRED" });
    return null;
  }
  const raw = data._meta;
  delete data._meta;
  const parsed = ClientMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", `[META_INVALID] \`_meta\` is malformed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, { reason: "META_INVALID", fields: parsed.error.issues.map((i) => ["_meta", ...i.path].join(".")) });
  }
  return parsed.data;
}

/**
 * Is `deviceId` one of the user's registered devices (users/{uid}/devices, written by authLogin and
 * notificationsRegisterFcmToken)? Flag only, never a rejection (D-26). One read per user and device per
 * instance every 10 minutes, counted as a gate read; nothing when `_meta.deviceId` is absent.
 */
const DEVICE_CACHE_MS = 10 * 60 * 1000;
const deviceCache = new Map<string, { registered: boolean; at: number }>();
async function isRegisteredDevice(uid: string, deviceId: string): Promise<boolean> {
  const key = `${uid}/${deviceId}`;
  const hit = deviceCache.get(key);
  if (hit && Date.now() - hit.at < DEVICE_CACHE_MS) return hit.registered;
  const registered = await withCategory("gate", async () => (await db.collection("users").doc(uid).collection("devices").doc(deviceId).get()).exists);
  deviceCache.set(key, { registered, at: Date.now() });
  return registered;
}

/** Gate refusals are denials whatever their HTTP code (a lapsed subscription is failed-precondition). */
const DENIAL_REASONS = new Set<string>(Object.values(GateReason).filter((r) => !["ORG_NOT_FOUND", "BRANCH_NOT_FOUND", "PLAN_LIMIT_REACHED", "USAGE_LIMIT_EXCEEDED"].includes(r)));

const reasonOf = (e: unknown): string | null => {
  const details = (e as { details?: { reason?: string } })?.details;
  return (details && details.reason) || (e instanceof HttpsError ? e.code : "INTERNAL");
};

export function onCall<T = unknown>(
  options: CallableOptions,
  handler: (request: CallableRequest<T>) => unknown,
) {
  return sdkOnCall<T, Promise<unknown>>(options, async (request): Promise<unknown> => {
    const name = callableName(request as CallableRequest);
    const headers = (request.rawRequest && request.rawRequest.headers) || {};
    // Attribution before the gate runs (callables without the gate keep it): the token's organization
    // claim; a Super Admin's work is platform work (D-21). The gate refines it from what it resolves.
    const token = (request.auth?.token || {}) as { isSuperAdmin?: boolean; primaryOrganizationId?: string };
    const ctx = createContext({ kind: "callable", name }, {
      organizationId: token.isSuperAdmin === true ? "platform" : token.primaryOrganizationId ?? null,
      // A Super Admin names the organization worked on; the gate confirms it when it runs.
      targetOrgId: token.isSuperAdmin === true && typeof (request.data as { organizationId?: unknown } | null)?.organizationId === "string" ? (request.data as { organizationId: string }).organizationId : null,
      actor: { uid: request.auth?.uid ?? null, kind: token.isSuperAdmin === true ? "superAdminOnBehalf" : "user" },
      device: {
        deviceId: null,
        deviceRegistered: null,
        platform: null,
        appVersion: null,
        ipTruncated: truncateIp(request.rawRequest?.ip),
        userAgentFamily: userAgentFamily(String(headers["user-agent"] || "")),
        appCheckVerified: request.app ? true : null,
      },
    });
    try { ctx.bytesIn = request.data === undefined ? 0 : Buffer.byteLength(JSON.stringify(request.data)); } catch { ctx.bytesIn = 0; }
    return runInContext(ctx, async () => {
      let meta: ClientMeta | null = null;
      try {
        meta = takeMeta(request as CallableRequest);
        ctx.meta = meta;
        if (meta) Object.assign(ctx.device, { deviceId: meta.deviceId ?? null, platform: meta.platform ?? null, appVersion: meta.appVersion ?? null });
        ctx.input = request.data && typeof request.data === "object" && !Array.isArray(request.data) ? (request.data as Record<string, unknown>) : null;
        if (meta?.deviceId && request.auth) ctx.device.deviceRegistered = await isRegisteredDevice(request.auth.uid, meta.deviceId);
        const result: unknown = await handler(request);
        await finishRequest(ctx, { outcome: "success", reason: null, result });
        return result;
      } catch (e) {
        const reason = reasonOf(e);
        const denied = (e instanceof HttpsError && ["permission-denied", "unauthenticated"].includes(e.code)) || (reason !== null && DENIAL_REASONS.has(reason));
        await finishRequest(ctx, { outcome: denied ? "denied" : "failed", reason, result: undefined });
        throw e;
      }
    });
  });
}
