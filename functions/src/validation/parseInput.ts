/**
 * The single callable-input parser (Part 7.5: strict inputs everywhere).
 *
 * Every schema in schemas.ts is a strict object, so unknown keys are rejected instead of being
 * silently dropped. Errors carry stable reason codes:
 *   UNKNOWN_FIELD     a key the callable does not accept (typo, removed field, copied attribute)
 *   INVALID_ARGUMENT  any other validation failure
 * scripts/check-gate-conformance.js fails if a callable reads request.data without this parser.
 */

import { HttpsError } from "firebase-functions/v2/https";
import type { z } from "zod";

export function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (parsed.success) return parsed.data;
  const unknown = parsed.error.issues.filter((i) => i.code === "unrecognized_keys");
  if (unknown.length) {
    const keys = unknown.flatMap((i) => ((i as { keys?: string[] }).keys || []).map((k) => [...i.path, k].join(".")));
    throw new HttpsError("invalid-argument", `[UNKNOWN_FIELD] Unknown field(s): ${keys.join(", ")}.`, { reason: "UNKNOWN_FIELD", fields: keys });
  }
  throw new HttpsError("invalid-argument", `[INVALID_ARGUMENT] Validation failed: ${parsed.error.message}`, { reason: "INVALID_ARGUMENT" });
}
