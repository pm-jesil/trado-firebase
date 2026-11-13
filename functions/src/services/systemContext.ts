/**
 * RequestContext for executions that are not callables (prompt 66 §3.3): Firestore and Storage
 * triggers and the scheduled job. Operations are counted and recorded like a callable's, with
 * `actor.kind` trigger / scheduled and no user. A trigger is attributed to the organization of the
 * document it reacts to; the scheduled job to the platform, with `targetOrgId` per organization (D-21).
 */
import { runAsSystem, currentContext } from "./requestContext.js";
import { finishRequest } from "./requestRecorder.js";

async function recorded(outcomeOf: () => Promise<void>): Promise<void> {
  const ctx = currentContext();
  try {
    await outcomeOf();
    if (ctx) await finishRequest(ctx, { outcome: "success", reason: null, result: undefined });
  } catch (e) {
    if (ctx) await finishRequest(ctx, { outcome: "failed", reason: (e as { details?: { reason?: string } })?.details?.reason || "INTERNAL", result: undefined });
    throw e;
  }
}

/** Wraps a trigger handler: `onDocumentWritten(opts, withTriggerContext("onBillWritten", orgOf, async (event) => …))`. */
export function withTriggerContext<E extends { id?: string }>(name: string, organizationOf: (event: NoInfer<E>) => string | null | undefined, handler: (event: E) => Promise<void>) {
  return (event: E): Promise<void> => runAsSystem({ kind: "trigger", name, eventId: event.id }, organizationOf(event) ?? null, () => recorded(() => handler(event)));
}

/** Wraps the scheduled job; set the organization being processed with `forTargetOrg`. */
export function withScheduledContext(name: string, handler: () => Promise<void>) {
  return (): Promise<void> => runAsSystem({ kind: "scheduled", name }, null, () => recorded(handler));
}

/** Inside the scheduled job: work done for `organizationId` is platform work tagged with the target (D-21). */
export function forTargetOrg(organizationId: string): void {
  const ctx = currentContext();
  if (ctx) ctx.targetOrgId = organizationId;
}

/** Organization of a Firestore document event (after, else before). */
export function organizationOfDocumentEvent<E>(event: E): string | null {
  const change = (event as unknown as { data?: { after?: { data: () => { organizationId?: string } | undefined }; before?: { data: () => { organizationId?: string } | undefined } } }).data;
  return change?.after?.data()?.organizationId || change?.before?.data()?.organizationId || null;
}
