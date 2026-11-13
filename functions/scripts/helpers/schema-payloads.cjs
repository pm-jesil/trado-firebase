/**
 * Valid payloads generated from a compiled Zod request schema (nothing typed by hand).
 * Used by the schema contract sweep (bounds, enums) and by the maximal round-trip proof (C-2).
 *
 *   gen(schema)        value for every key the schema declares (optional keys included)
 *   validBase(schema)  that value, with optional keys dropped until it parses → { value, ok, issue }
 *   setAt / removeAt / subSchema   edit a payload by schema path ("a.b[].c", "m.*")
 */
// ---------------------------------------------------------------------------
// Value generation from a Zod definition
// ---------------------------------------------------------------------------

const STRING_SAMPLES = ["2026-01-15", "2026-01", "10:30", "IN", "INR", "ABCDE1234F", "29ABCDE1234F1Z5", "HDFC0001234", "+919876543210", "https://example.com/a", "probe@example.com", "a1b2c3d4", "ok"];

function checks(def) {
  const out = {};
  for (const c of def.checks || []) {
    const d = c && c._zod && c._zod.def;
    if (!d) continue;
    if (d.check === "min_length") out.minLength = d.minimum;
    if (d.check === "max_length") out.maxLength = d.maximum;
    if (d.check === "length_equals") out.minLength = out.maxLength = d.length;
    if (d.check === "greater_than") { out.min = d.value; out.minInclusive = d.inclusive; }
    if (d.check === "less_than") { out.max = d.value; out.maxInclusive = d.inclusive; }
    if (d.check === "string_format") { out.format = d.format; out.pattern = d.pattern; }
    if (d.check === "number_format") out.int = /int/.test(d.format);
  }
  return out;
}

function genString(def, at) {
  const c = checks(def);
  const fits = (s) => (c.minLength === undefined || s.length >= c.minLength) && (c.maxLength === undefined || s.length <= c.maxLength) && (!c.pattern || c.pattern.test(s));
  // Phone numbers and emails differ per field path, so one payload never stores one value under two fields.
  const tag = [...at].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 10000, 7);
  const email = `probe${tag}@example.com`;
  if (c.format === "email") return email;
  if (c.format === "url") return `https://example.com/p${tag}`;
  if (c.format === "uuid") return "123e4567-e89b-42d3-a456-426614174000";
  if (/phone|mobile|whatsapp/i.test(at)) return `+91987654${String(tag).padStart(4, "0")}`;
  if (/email/i.test(at)) return email;
  if (/country/i.test(at) && c.maxLength === 2) return "IN";
  if (/currency/i.test(at) && c.maxLength === 3) return "INR";
  // Dates: a real date only for date fields (a code like "2026-01-15" is a stored-data finding), and a
  // different day per field path, so two date fields of one payload do not coincide.
  const last = at.split(".").pop().replace(/\[\]/g, "");
  const day = String(10 + (tag % 18)).padStart(2, "0");
  if (c.format === "datetime") return `2026-01-${day}T08:00:00.000Z`;
  if (c.format === "date") return `2026-01-${day}`;
  const isDate = (v) => /^\d{4}-\d{2}/.test(v);
  // camelCase, case-sensitive: dueDate, startOn, createdAt, period — not reason, description or updatedBy.
  const wantsDate = /^(date|period)$|Date$|[a-z]On$|[a-z]At$|Period$/.test(last);
  if (wantsDate) {
    const date = /At$/.test(last) ? `2026-01-${day}T08:00:00.000Z` : `2026-01-${day}`;
    if (fits(date)) return date;
  }
  // Free text: derived from the parent and field name (digits kept: line1 ≠ line2, weight.unit ≠
  // dimensions.unit), so two fields of one payload never hold the same value — a coincidence the
  // same-document duplicate guard would rightly report in stored data.
  const word = at.split(".").map((s) => s.replace(/\[\]/g, "")).filter((s) => s && s !== "*").slice(-2).join("-").replace(/[^A-Za-z0-9-]/g, "").toLowerCase() || "value";
  const n = Math.min(Math.max(c.minLength || 0, Math.min(word.length + 3, 40)), c.maxLength === undefined ? 40 : c.maxLength);
  const free = `${word}-probe-${"x".repeat(40)}`.slice(0, Math.max(n, 1)).padEnd(n, "x");
  if (c.pattern && fits(free)) return free;
  const sample = STRING_SAMPLES.filter(fits).sort((a, b) => (isDate(a) === wantsDate ? -1 : 1) - (isDate(b) === wantsDate ? -1 : 1))[0];
  if (sample && c.pattern) return sample;
  return free;
}

function genNumber(def) {
  const c = checks(def);
  let v = c.min !== undefined ? c.min + (c.minInclusive === false ? 1 : 0) : 1;
  if (c.max !== undefined && v > c.max) v = c.max;
  return v;
}

function gen(node, at = "", depth = 0) {
  const def = node && node.def;
  if (!def || depth > 12) return undefined;
  switch (def.type) {
    case "optional": case "nullable": case "readonly": case "nonoptional": case "catch": case "prefault": case "default": return gen(def.innerType, at, depth + 1);
    case "pipe": return gen(def.in && def.in.def && def.in.def.type === "transform" ? def.out : def.in, at, depth + 1);
    case "lazy": return gen(def.getter(), at, depth + 1);
    case "object": return Object.fromEntries(Object.entries(def.shape).map(([k, v]) => [k, gen(v, at ? `${at}.${k}` : k, depth + 1)]).filter(([, v]) => v !== undefined));
    case "array": { const c = checks(def); return Array.from({ length: Math.max(1, c.minLength || 0) }, () => gen(def.element, `${at}[]`, depth + 1)); }
    case "record": {
      const keys = def.keyType && def.keyType.def && def.keyType.def.type === "enum" ? Object.values(def.keyType.def.entries) : ["k1"];
      return Object.fromEntries(keys.map((k) => [k, gen(def.valueType, `${at}.*`, depth + 1)]));
    }
    case "union": {
      for (const o of def.options) { const v = gen(o, at, depth + 1); if (safe(o, v).success) return v; }
      return gen(def.options[0], at, depth + 1);
    }
    case "intersection": return { ...gen(def.left, at, depth + 1), ...gen(def.right, at, depth + 1) };
    case "enum": return Object.values(def.entries)[0];
    case "literal": return def.values[0];
    case "string": return genString(def, at);
    case "number": case "int": return genNumber(def);
    case "bigint": return 1n;
    case "boolean": return true;
    case "date": return new Date("2026-01-15T00:00:00Z");
    case "null": return null;
    default: return undefined;
  }
}

function safe(schema, value) {
  try { return schema.safeParse(value); } catch (e) { return { success: false, error: { issues: [{ path: [], message: e.message }] } }; }
}

/** Generate a valid maximal payload; drop optional keys named by issues until it parses (or give up). */
function validBase(schema) {
  let value = gen(schema);
  for (let i = 0; i < 25; i++) {
    const r = safe(schema, value);
    if (r.success) return { value, ok: true };
    const issue = r.error.issues[0];
    if (issue && issue.path.length && removeAt(value, issue.path)) continue;
    if (issue && dropKeyFixing(schema, value, issue)) continue;
    return { value, ok: false, issue: issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown" };
  }
  return { value, ok: false, issue: "did not converge" };
}

/** An object-level refinement (e.g. "productId or itemName, not both"): drop the key whose removal clears it. */
function dropKeyFixing(schema, value, issue) {
  let target = value;
  for (const k of issue.path) target = target && target[k];
  if (!target || typeof target !== "object" || Array.isArray(target)) return false;
  for (const key of Object.keys(target).reverse()) {
    const field = subSchema(schema, [...issue.path, key]);
    if (!field || !field.def || !["optional", "default", "prefault"].includes(field.def.type)) continue; // only optional keys may go
    const saved = target[key];
    delete target[key];
    const r = safe(schema, value);
    const still = !r.success && r.error.issues.some((i) => i.message === issue.message && i.path.join(".") === issue.path.join("."));
    if (!still && (r.success || r.error.issues.length <= 25)) return true;
    target[key] = saved;
  }
  return false;
}

function removeAt(obj, p) {
  let cur = obj;
  for (let i = 0; i < p.length - 1; i++) { cur = cur && cur[p[i]]; if (cur === undefined) return false; }
  if (!cur || !(p[p.length - 1] in cur)) return false;
  if (Array.isArray(cur)) return false;
  delete cur[p[p.length - 1]];
  return true;
}

/** Schema path ("a.b[].c", "m.*") → concrete path segments into `value`, creating containers. */
function setAt(value, schemaPath, leafValue, schema) {
  const segs = schemaPath.split(".").flatMap((s) => (s.endsWith("[]") ? [s.slice(0, -2), 0] : [s]));
  let cur = value;
  const concrete = [];
  for (let i = 0; i < segs.length; i++) {
    let key = segs[i] === "*" ? (cur && typeof cur === "object" ? Object.keys(cur)[0] || "k1" : "k1") : segs[i];
    if (key === "") continue;
    concrete.push(key);
    if (i === segs.length - 1) { cur[key] = leafValue; break; }
    if (cur[key] === undefined || cur[key] === null) {
      const filler = gen(subSchema(schema, segs.slice(0, i + 1)));
      cur[key] = filler !== undefined ? filler : typeof segs[i + 1] === "number" ? [] : {};
      if (typeof segs[i + 1] === "number" && !Array.isArray(cur[key])) cur[key] = [];
      if (typeof segs[i + 1] === "number" && cur[key].length === 0) cur[key].push({});
    }
    cur = cur[key];
  }
  return concrete;
}

function subSchema(schema, segs) {
  let node = schema;
  const unwrap = (n) => { while (n && n.def && ["optional", "nullable", "default", "readonly", "nonoptional", "catch", "prefault"].includes(n.def.type)) n = n.def.innerType; if (n && n.def && n.def.type === "pipe") n = n.def.in; return n; };
  for (const s of segs) {
    node = unwrap(node);
    if (!node || !node.def) return null;
    if (typeof s === "number") node = node.def.element;
    else if (node.def.type === "object") node = node.def.shape[s];
    else if (node.def.type === "record") node = node.def.valueType;
    else return null;
  }
  return node;
}

module.exports = { checks, gen, safe, validBase, removeAt, setAt, subSchema };
