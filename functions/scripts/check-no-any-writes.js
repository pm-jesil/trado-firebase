/**
 * check:no-any-writes — D-16 / C-8: zero `any` in production source (functions/src without tests).
 * @guard-scope: files functions/src/**\/*.ts excluding functions/src/test/**
 *
 * Counts every `any` type node (annotation, cast, catch variable, generic argument) with the
 * TypeScript parser, the same count as Coverage Engine C-8. There is no allowlist: any hit fails.
 * Stored URL fields are checked by check-stored-url-fields.js.
 * Usage: node scripts/check-no-any-writes.js
 */
const { getAnyUsages, productionSourceFiles } = require("../../scripts/lib/source-truth.js");

const usages = getAnyUsages();
console.log(`check:no-any-writes — ${productionSourceFiles().length} production source files scanned`);
if (usages.length) {
  for (const u of usages) console.error(`  ${u.file}:${u.line} [${u.form}] ${u.text}`);
  console.error(`[FAIL] ${usages.length} \`any\` usage(s).`);
  process.exit(1);
}
console.log("PASS — 0 `any` in production source.");
