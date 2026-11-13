/**
 * Field catalog generator (C-1). Paths are never typed here:
 *   - one entity per collection derived from source (scripts/lib/source-truth.js)
 *   - fields = stored leaf paths of the collection's document interface (TypeScript checker)
 *   - census-only paths (stored in emulator data but in no document type) are listed separately
 *     under `untypedStoredPaths`; they are findings, not catalog entries
 *   - descriptions: the JSDoc / trailing comment of the property that declares the leaf (types/models.ts
 *     or the type it uses), else scripts/field-glossary.json (scripts/lib/field-descriptions.js), else
 *     empty (reported)
 *
 * Outputs docs/generated/field-catalog.json and docs/reference/entity-fields.md.
 * Usage: node scripts/generate-field-catalog.js
 */

const fs = require("node:fs");
const path = require("node:path");
const truth = require("./lib/source-truth.js");
const { describe } = require("./lib/field-descriptions.js");

const ROOT = truth.ROOT;
const OUTPUT_JSON_PATH = path.join(ROOT, "docs/generated/field-catalog.json");
const OUTPUT_MD_PATH = path.join(ROOT, "docs/reference/entity-fields.md");
const readJson = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) : null);

function inferSensitivity(fieldPath) {
  const lower = fieldPath.toLowerCase();
  if (/secret|token|hash|password|bank|accountnumber|ifsc|iban/.test(lower)) return "sensitive";
  if (/email|phone|mobile|contact|address|taxid|(^|\.)name$|nameparts/.test(lower)) return "PII";
  return "public";
}

function main() {
  const docTypes = truth.getDocTypes();
  const { mapped } = truth.mapCollectionsToDocTypes();
  const census = readJson("docs/generated/raw-field-census.json");
  const prefixes = new Map();
  for (const exp of truth.getExports().filter((e) => e.type === "callable")) {
    const prefix = exp.name.replace(/[A-Z].*$/, "");
    for (const col of exp.collections.slice(0, 1)) if (!prefixes.has(col)) prefixes.set(col, prefix);
  }

  const entities = mapped.map(({ collection, docType }) => {
    const type = docType ? docTypes[docType] : null;
    const name = collection.split("/").pop();
    const typedPaths = new Set(type ? type.leaves.map((l) => l.path) : []);
    const observed = census && census.collections[collection] ? census.collections[collection].paths : {};
    const fields = (type ? type.leaves : []).map((leaf) => {
      return {
        path: leaf.path,
        type: leaf.type,
        requiredOnCreate: !leaf.optional,
        sensitivity: inferSensitivity(leaf.path),
        validator: leaf.type,
        verdict: observed[leaf.path] ? "PRESENT" : "TYPED_NOT_OBSERVED",
        description: describe(leaf),
      };
    });
    return {
      entity: docType ? docType.replace(/Doc$/, "").replace(/^./, (c) => c.toLowerCase()) : name,
      docName: docType,
      displayName: (docType ? docType.replace(/Doc$/, "") : name).replace(/([a-z])([A-Z])/g, "$1 $2"),
      callablePrefix: prefixes.get(name) || null,
      collection,
      documentsObserved: census && census.collections[collection] ? census.collections[collection].docCount : null,
      fields,
      untypedStoredPaths: Object.keys(observed).filter((p) => !typedPaths.has(p)).sort(),
    };
  });

  const totalFields = entities.reduce((n, e) => n + e.fields.length, 0);
  const described = entities.reduce((n, e) => n + e.fields.filter((f) => f.description).length, 0);
  const catalog = { version: "3.0.0", generatedAt: new Date().toISOString(), censusRun: census ? census.runId : "not run", totalEntities: entities.length, totalFields, describedFields: described, entities };
  fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(catalog, null, 2)}\n`);

  const md = [
    "# Stored field catalog", "",
    `Generated ${catalog.generatedAt} by \`scripts/generate-field-catalog.js\` from \`functions/src/types/models.ts\` (TypeScript checker) and the raw field census (\`${catalog.censusRun}\`). Do not edit.`, "",
    `${entities.length} collections, ${totalFields} typed stored leaf paths, ${described} with a description, ${entities.filter((e) => !e.docName).length} collections without a document interface.`, "",
  ];
  for (const e of entities) {
    md.push(`## \`${e.collection}\`${e.docName ? ` (\`${e.docName}\`)` : " — no document interface"}`, "", `Typed leaf paths: ${e.fields.length}. Documents observed in the census: ${e.documentsObserved === null ? "census not run" : e.documentsObserved}. Stored but untyped paths: ${e.untypedStoredPaths.length}.`, "");
    if (e.fields.length) {
      md.push("| Path | Type | Required | Sensitivity | Observed | Description |", "|---|---|---|---|---|---|");
      for (const f of e.fields) md.push(`| \`${f.path}\` | \`${f.type.replace(/\|/g, "\|")}\` | ${f.requiredOnCreate ? "yes" : "no"} | ${f.sensitivity} | ${f.verdict === "PRESENT" ? "yes" : "no"} | ${f.description.replace(/\|/g, "\|")} |`);
      md.push("");
    }
    if (e.untypedStoredPaths.length) md.push("Stored but untyped:", "", ...e.untypedStoredPaths.map((p) => `- \`${p}\``), "");
  }
  fs.mkdirSync(path.dirname(OUTPUT_MD_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_MD_PATH, `${md.join("\n")}\n`);
  console.log(`Catalog: ${entities.length} collections, ${totalFields} typed leaf paths, ${described} described, ${entities.reduce((n, e) => n + e.untypedStoredPaths.length, 0)} stored-but-untyped paths.`);
}

main();
