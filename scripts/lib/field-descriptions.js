/**
 * Field descriptions for generated documentation (OpenAPI responses, the field catalog).
 *
 * Order: the comment written on the declaring property in source (scripts/lib/source-truth.js reads
 * it), else scripts/field-glossary.json — one reviewed meaning per field name, or per `parent.field`
 * where a name means different things in different places. A name in neither has no description.
 */
const fs = require("node:fs");
const path = require("node:path");

const GLOSSARY = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "field-glossary.json"), "utf8")).fields;

/** "addresses[].line1" → glossary "addresses.line1", else "line1". */
function glossaryDescription(leafPath) {
  const segs = leafPath.split(".").map((s) => s.replace(/\[\]$/g, "")).filter((s) => s && s !== "*");
  const name = segs[segs.length - 1];
  const parent = segs[segs.length - 2];
  return (parent && GLOSSARY[`${parent}.${name}`]) || GLOSSARY[name] || "";
}

function describe(leaf) {
  return leaf.description || glossaryDescription(leaf.path);
}

module.exports = { describe, glossaryDescription, GLOSSARY };
