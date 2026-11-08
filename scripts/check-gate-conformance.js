#!/usr/bin/env node
/**
 * Trado Gate Conformance Checker (static)
 *
 * Fails when:
 *   1. An exported callable neither goes through the central gate (resolveRequestContext with a
 *      requiredPermission, or resolveCatalogWriteAccess) nor is a Super-Admin-only platform
 *      callable, nor is in the documented SELF_SERVICE_ALLOWLIST.
 *   2. A query on a tenant collection inside callables lacks an organizationId filter.
 *   3. A gated callable uses a client-supplied organizationId other than to compare it with the
 *      gate-resolved context (outside the documented allowlist).
 *
 * Also (re)generates the "Gate & Permission Matrix" section of
 * docs/audit/callable-and-trigger-inventory.md from source, so the matrix cannot drift.
 * Requires a prior `npm run build` (reads functions/lib for the canonical module mapping).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CALLABLES_DIR = path.join(ROOT, "functions/src/callables");
const INVENTORY_MD = path.join(ROOT, "docs/audit/callable-and-trigger-inventory.md");
const { getModuleForPermission } = require(path.join(ROOT, "functions/lib/services/permissionResolver.js"));
const { AppPermissions } = require(path.join(ROOT, "functions/lib/constants/permissions.js"));

/** Callables that legitimately do not use the tenant gate, with the reason. */
const SELF_SERVICE_ALLOWLIST = {
  healthCheck: "public liveness probe",
  authLogin: "emulator auth adapter (credentials -> token)",
  authMe: "session bootstrap; reports contextStatus incl. subscription_expired",
  notificationsRegisterFcmToken: "caller registers own device token",
  notificationsList: "caller reads own notifications (userId == caller)",
  notificationsMarkRead: "caller marks own notification (ownership checked)",
  permissionCatalogList: "platform reference catalog",
  modulesList: "platform reference catalog",
  taxRegimesList: "platform reference catalog",
  plansList: "platform reference catalog",
  branchesGetDefault: "member reads default branch (gate without permission: any active member)",
  branchesList: "member lists own branches (gate without permission: any active member)",
  branchContextSwitch: "member switches own working branch (assignment checked)",
  usageRecordClientMetric: "client_estimate telemetry (validated, non-negative); gated without permission",
  organizationsUpdate: "field-policy matrix (ORGANIZATION_FIELD_POLICY) + subscription check, hand-rolled tiers",
  rolesCreate: "Owner-only custom roles (role_org_owner check) / Super Admin system roles",
  rolesUpdate: "Owner-only custom roles / Super Admin system roles",
  rolesList: "role catalog visible to members",
  departmentsList: "reference list visible to members",
  jobRolesList: "reference list visible to members",
  unitsList: "reference list visible to members",
  categoriesList: "reference list visible to members",
};

/** Files allowed to read input.organizationId directly (platform or explicit-target callables). */
const CLIENT_ORG_ID_ALLOWLIST = new Set([
  "organizations.ts", "plans.ts", "roles.ts", "departments.ts", "jobRoles.ts", "units.ts",
  "categories.ts", "usage.ts", "catalogs.ts", "notifications.ts",
]);

const TENANT_COLLECTIONS = [
  "products", "customers", "vendors", "outflows", "bills", "stockMovements", "deliveries", "returns",
  "payments", "tasks", "dailySummaries", "monthlySummaries", "latestLocations", "locationPings",
  "stockBalances", "teams", "auditLogs",
];

function codeOf(token) {
  const m = token.match(/AppPermissions\.([A-Z_]+)/);
  if (m) return AppPermissions[m[1]] || token;
  const s = token.match(/"([^"]+)"/);
  return s ? s[1] : token;
}

function splitCallables(src) {
  const re = /export const (\w+) = onCall\(/g;
  const starts = [];
  let m;
  while ((m = re.exec(src)) !== null) starts.push({ name: m[1], index: m.index });
  return starts.map((s, i) => ({ name: s.name, body: src.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : src.length) }));
}

function resolvePermissionExpr(expr, fileSrc) {
  expr = expr.trim();
  if (expr.startsWith("[")) return expr.slice(1, -1).split(",").map((t) => t.trim()).filter(Boolean).map(codeOf);
  if (expr.startsWith("AppPermissions.") || expr.startsWith("\"")) return [codeOf(expr)];
  // identifier or call: resolve a module-level const array, else mark dynamic
  const ident = expr.match(/^(\w+)/)?.[1];
  const decl = ident && fileSrc.match(new RegExp(`const ${ident} = (\\[[^\\]]*\\])`));
  if (decl) return resolvePermissionExpr(decl[1], fileSrc);
  const fn = ident && fileSrc.match(new RegExp(`function ${ident}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`));
  if (fn) {
    const arrays = fn[1].match(/\[[^\]]*AppPermissions[^\]]*\]/g) || [];
    return Array.from(new Set(arrays.flatMap((a) => resolvePermissionExpr(a, fileSrc)))).concat(["(by input)"]);
  }
  return [`(dynamic: ${expr})`];
}

/** Returns the source text of the requiredPermission value in the first gate call, or null. */
function extractRequiredPermission(body) {
  const at = body.indexOf("resolveRequestContext(request, {");
  if (at < 0) return null;
  const key = body.indexOf("requiredPermission:", at);
  const close = body.indexOf("});", at);
  if (key < 0 || (close >= 0 && key > close)) return null;
  let i = key + "requiredPermission:".length;
  while (body[i] === " ") i++;
  let depth = 0;
  let out = "";
  for (; i < body.length; i++) {
    const c = body[i];
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (depth < 0) break;
    if (depth === 0 && (c === "," || c === "\n" || c === "}")) break;
    out += c;
  }
  return out.trim();
}

function analyse() {
  const failures = [];
  const rows = [];
  const files = fs.readdirSync(CALLABLES_DIR).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const src = fs.readFileSync(path.join(CALLABLES_DIR, file), "utf8");
    for (const { name, body } of splitCallables(src)) {
      let gate = "NONE";
      let perms = [];
      const raw = extractRequiredPermission(body);
      if (raw) {
        gate = "tenant-gate";
        perms = raw.includes("?") ? raw.split(/[?:]/).slice(1).flatMap((x) => resolvePermissionExpr(x, src)) : resolvePermissionExpr(raw, src);
      } else if (/resolveCatalogWriteAccess\(|verifyTenantOrSuperAdmin\(/.test(body)) {
        gate = "catalog-gate";
        const m = body.match(/resolveCatalogWriteAccess\(request,[^,]+,\s*([^)]+)\)/) || src.match(/resolveCatalogWriteAccess\(request, organizationId, ([^)]+)\)/);
        perms = m ? resolvePermissionExpr(m[1], src) : [];
      } else if (/isSuperAdmin !== true/.test(body) || /if \(!isSuperAdmin\) \{\s*throw/.test(body)) {
        gate = "platform-only";
      } else if (/resolveRequestContext\(request\)/.test(body) || /resolveRequestContext\(request,\s*\{\s*allowPlatformSuperAdmin/.test(body)) {
        gate = "member-gate";
      }
      if ((gate === "NONE" || gate === "member-gate") && !SELF_SERVICE_ALLOWLIST[name]) {
        failures.push(`${file}:${name} does not declare a requiredPermission on the central gate`);
      }

      // Tenant query filter check
      const queryRe = /db\s*\.collection\("(\w+)"\)\s*((?:\.(?:where|limit|orderBy|startAfter)\([^;]*?\)\s*)+)\.get\(\)/g;
      let q;
      while ((q = queryRe.exec(body)) !== null) {
        if (TENANT_COLLECTIONS.includes(q[1]) && !/organizationId/.test(q[2])) {
          failures.push(`${file}:${name} queries "${q[1]}" without an organizationId filter`);
        }
      }

      // Client-supplied tenant id usage
      if (!CLIENT_ORG_ID_ALLOWLIST.has(file)) {
        const lines = body.split("\n").filter((l) => /input\.organizationId|request\.data\??\.organizationId/.test(l));
        for (const l of lines) {
          if (!/!==\s*ctx\.organizationId|ctx\.organizationId\s*!==/.test(l)) {
            failures.push(`${file}:${name} uses a client-supplied organizationId: ${l.trim()}`);
          }
        }
      }

      const modules = Array.from(new Set(perms.filter((p) => !p.startsWith("(")).map(getModuleForPermission)));
      perms = Array.from(new Set(perms));
      rows.push({ name, file, gate, perms, modules, allow: SELF_SERVICE_ALLOWLIST[name] || "" });
    }
  }
  return { failures, rows };
}

function writeMatrix(rows) {
  if (!fs.existsSync(INVENTORY_MD)) return;
  const START = "<!-- GATE-MATRIX:START -->";
  const END = "<!-- GATE-MATRIX:END -->";
  rows.sort((a, b) => a.name.localeCompare(b.name));
  let md = `${START}\n## Gate & Permission Matrix (generated by scripts/check-gate-conformance.js)\n\n`;
  md += "Gate order for `tenant-gate`: authenticated → user active → membership active → organization active → subscription valid → plan includes module → org/branch module toggle → permission (deny wins) → branch assignment → usage limit → business logic. Super Admin passes only when every required permission is read-only.\n\n";
  md += "| Callable | Source | Gate | Permission (any of) | Plan module(s) | Allowlist reason |\n|---|---|---|---|---|---|\n";
  for (const r of rows) {
    md += `| \`${r.name}\` | ${r.file} | ${r.gate} | ${r.perms.map((p) => `\`${p}\``).join(", ") || "—"} | ${r.modules.join(", ") || "—"} | ${r.allow} |\n`;
  }
  md += `\n${END}\n`;
  let doc = fs.readFileSync(INVENTORY_MD, "utf8");
  if (doc.includes(START)) doc = doc.slice(0, doc.indexOf(START)) + md + doc.slice(doc.indexOf(END) + END.length + 1);
  else doc += `\n${md}`;
  fs.writeFileSync(INVENTORY_MD, doc);
}

function main() {
  const { failures, rows } = analyse();
  writeMatrix(rows);
  const byGate = rows.reduce((acc, r) => ((acc[r.gate] = (acc[r.gate] || 0) + 1), acc), {});
  console.log(`Gate conformance: ${rows.length} callables analysed`, byGate);
  if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} gate conformance violation(s):`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log("✓ Every callable is gated, platform-only, or documented self-service; tenant queries filter by organizationId.");
}

if (require.main === module) main();
module.exports = { analyse };
