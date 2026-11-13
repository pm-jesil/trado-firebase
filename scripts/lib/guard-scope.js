/**
 * Per-collection guards record what they scanned (D-17): docs/generated/guard-scopes/<guard>.json.
 * The Coverage Engine (C-7) compares it with the collections derived from source.
 */
const fs = require("node:fs");
const path = require("node:path");

function writeGuardScope(guardFile, scanned, excluded) {
  const name = path.basename(guardFile).replace(/\.c?js$/, "");
  const out = path.resolve(__dirname, "..", "..", "docs", "generated", "guard-scopes", `${name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ guard: name, runId: `${name}-${Date.now().toString(36)}`, generatedAt: new Date().toISOString(), scanned: [...scanned].sort(), excluded }, null, 2)}\n`);
  console.log(`Scope: ${scanned.length} collections scanned, ${excluded.length} excluded${excluded.length ? ` (${excluded.map((e) => `${e.collection}: ${e.reason}`).join("; ")})` : ""}`);
}

module.exports = { writeGuardScope };
