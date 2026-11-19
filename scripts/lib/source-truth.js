/**
 * Source-of-truth derivations shared by the Coverage Engine, the field-catalog generator and the
 * Change-Impact Test System (D-20: denominators are derived, never typed).
 *
 *   getExports()          every export of functions/src/index.ts, resolved to its declaration:
 *                         callable or trigger, kind, request schemas, idempotency, collections touched
 *   getRequestSchemas()   every compiled Zod request schema flattened to leaf paths
 *                         (type, required, bounds, enum values) plus the strictness of each object node
 *   getDocTypes()         every `*Doc` interface of types/models.ts flattened to stored leaf paths
 *   getCollections()      collection paths used in source, and the match paths of firestore.rules
 *   getRules()            match blocks and allow statements of both rules files
 *   getAnyUsages()        every `any` type node in non-test source (explicit annotation or cast)
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const FUNCTIONS_DIR = path.join(ROOT, "functions");
const SRC_DIR = path.join(FUNCTIONS_DIR, "src");
const ts = require(path.join(FUNCTIONS_DIR, "node_modules", "typescript"));

const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, "/");

function walkFiles(dir, accept, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

const isTestFile = (abs) => /[\\/]test[\\/]/.test(abs) || /\.test\.ts$/.test(abs);
const sourceFiles = () => walkFiles(SRC_DIR, (f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort();
const productionSourceFiles = () => sourceFiles().filter((f) => !isTestFile(f));

function parseFile(abs) {
  return ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

// ---------------------------------------------------------------------------
// Exports: callables and triggers
// ---------------------------------------------------------------------------

const KIND_RULES = [
  [/Create($|[A-Z])/, "create"],
  [/(Update|Set|Switch|Mark|Assign|Add|Record|Attach|Transfer|Adjust|Approve|Reject|Convert|Register|Reactivate|Reset|Run|Reconcile|Apply|Complete|Start|Dispatch|Deliver|Confirm|Provision)($|[A-Z])/, "update"],
  [/(Delete|Deactivate|Remove|Cancel|Void|Revoke|Archive)($|[A-Z])/, "delete"],
  [/List($|[A-Z])/, "list"],
  [/(Get|Preview|Search|Lookup|Export|Me|Check|Summary|Report|Dashboard|Statement|History)($|[A-Z])/, "read"],
];

/** Kind from the export name; `kindRule` records which rule matched so a wrong guess is visible. */
function deriveKind(name) {
  for (const [pattern, kind] of KIND_RULES) if (pattern.test(name)) return { kind, kindRule: String(pattern) };
  return { kind: "action", kindRule: "no name rule matched" };
}

function localFunctions(sf) {
  const map = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) map.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          map.set(d.name.text, d.initializer);
        }
      }
    }
  }
  return map;
}

/** Facts reachable from a handler through functions declared in the same file. */
function analyseHandler(sf, handler, locals) {
  const facts = { schemas: [], collections: [], calls: new Set() };
  const visited = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (name) facts.calls.add(name);
      if (name === "resolveRequestContext" && node.arguments[1] && /requiredPermission/.test(node.arguments[1].getText(sf))) facts.permissioned = true;
      if (name === "parseInput" && node.arguments[0]) {
        const text = node.arguments[0].getText(sf);
        if (!facts.schemas.includes(text)) facts.schemas.push(text);
      }
      if ((name === "collection" || name === "collectionGroup") && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const col = node.arguments[0].text;
        if (!facts.collections.includes(col)) facts.collections.push(col);
      }
      if (ts.isIdentifier(callee) && locals.has(callee.text) && !visited.has(callee.text)) {
        visited.add(callee.text);
        visit(locals.get(callee.text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler);
  return facts;
}

/** A top-level statement of the handler body throws unless the caller is a Super Admin. */
function superAdminGuarded(sf, factoryCall) {
  const fn = factoryCall.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  if (!fn || !fn.body || !ts.isBlock(fn.body)) return false;
  const negation = /^(?:!request\.auth\s*\|\|\s*)?(?:![\w.]*isSuperAdmin|[\w.]*isSuperAdmin\s*!==\s*true)$/;
  return fn.body.statements.some((st) => {
    if (!ts.isIfStatement(st) || !negation.test(st.expression.getText(sf).replace(/\s+/g, " ").trim())) return false;
    const first = ts.isBlock(st.thenStatement) ? st.thenStatement.statements[0] : st.thenStatement;
    return !!first && ts.isThrowStatement(first);
  });
}

let exportsCache = null;
function getExports() {
  if (exportsCache) return exportsCache;
  const indexAbs = path.join(SRC_DIR, "index.ts");
  const indexSf = parseFile(indexAbs);
  const out = [];
  const parsed = new Map();
  for (const st of indexSf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    const spec = st.moduleSpecifier.text;
    const abs = path.resolve(SRC_DIR, spec.replace(/\.js$/, ".ts"));
    if (!parsed.has(abs)) {
      const sf = parseFile(abs);
      parsed.set(abs, { sf, locals: localFunctions(sf) });
    }
    const { sf, locals } = parsed.get(abs);
    for (const el of st.exportClause.elements) {
      const name = el.name.text;
      let decl = null;
      let targetSf = sf;
      let targetLocals = locals;
      let targetAbs = abs;

      for (const s of sf.statements) {
        if (!ts.isVariableStatement(s)) continue;
        for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) decl = d;
      }

      if (!decl) {
        for (const s of sf.statements) {
          if (ts.isExportDeclaration(s) && !s.exportClause && s.moduleSpecifier) {
            const subSpec = s.moduleSpecifier.text;
            const subAbs = path.resolve(path.dirname(abs), subSpec.replace(/\.js$/, ".ts"));
            if (fs.existsSync(subAbs)) {
              if (!parsed.has(subAbs)) {
                const subSf = parseFile(subAbs);
                parsed.set(subAbs, { sf: subSf, locals: localFunctions(subSf) });
              }
              const subParsed = parsed.get(subAbs);
              for (const subS of subParsed.sf.statements) {
                if (!ts.isVariableStatement(subS)) continue;
                for (const d of subS.declarationList.declarations) {
                  if (ts.isIdentifier(d.name) && d.name.text === name) {
                    decl = d;
                    targetSf = subParsed.sf;
                    targetLocals = subParsed.locals;
                    targetAbs = subAbs;
                    break;
                  }
                }
                if (decl) break;
              }
            }
          }
          if (decl) break;
        }
      }

      const record = { name, file: rel(targetAbs), line: decl ? lineOf(targetSf, decl) : null, factory: null, type: "unknown", schemas: [], collections: [], idempotent: false };
      if (decl && decl.initializer && ts.isCallExpression(decl.initializer)) {
        record.factory = decl.initializer.expression.getText(targetSf);
        record.type = record.factory === "onCall" ? "callable" : "trigger";
        const facts = analyseHandler(targetSf, decl.initializer, targetLocals);
        record.schemas = facts.schemas;
        record.collections = facts.collections;
        record.idempotent = facts.calls.has("reserveIdempotency");
        // Per handler, not per file: a platform handler next to tenant handlers is not tenant-gated.
        record.gated = facts.calls.has("resolveRequestContext");
        record.permissioned = !!facts.permissioned; // the gate is asked for a permission, so a role can be denied
        // Super Admin only: the handler throws unless the caller is a Super Admin (no tenant, no plan).
        record.superAdminOnly = superAdminGuarded(targetSf, decl.initializer);
      }
      Object.assign(record, record.type === "trigger" ? { kind: "trigger", kindRule: `factory ${record.factory}` } : deriveKind(name));
      out.push(record);
    }
  }
  exportsCache = out;
  return out;
}

// ---------------------------------------------------------------------------
// Request schemas (compiled Zod)
// ---------------------------------------------------------------------------

function newestMtime(files) {
  return Math.max(0, ...files.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)));
}

/** The compiled schemas must be at least as new as their sources, otherwise the ratios describe old code. */
function assertBuildFresh() {
  const src = walkFiles(path.join(SRC_DIR, "validation"), (f) => f.endsWith(".ts")).concat(walkFiles(path.join(SRC_DIR, "constants"), (f) => f.endsWith(".ts")));
  const lib = src.map((f) => f.replace(SRC_DIR, path.join(FUNCTIONS_DIR, "lib")).replace(/\.ts$/, ".js"));
  const missing = lib.filter((f) => !fs.existsSync(f));
  if (missing.length || newestMtime(src) > newestMtime(lib)) {
    throw new Error("functions/lib is older than functions/src (validation or constants). Run `npm run build` in functions/ first.");
  }
}

function checkBounds(def) {
  const bounds = {};
  for (const check of def.checks || []) {
    const c = check && check._zod && check._zod.def;
    if (!c) continue;
    if (c.check === "min_length") bounds.minLength = c.minimum;
    else if (c.check === "max_length") bounds.maxLength = c.maximum;
    else if (c.check === "length_equals") bounds.minLength = bounds.maxLength = c.length;
    else if (c.check === "greater_than") { bounds.min = c.value; bounds.minInclusive = !!c.inclusive; }
    else if (c.check === "less_than") { bounds.max = c.value; bounds.maxInclusive = !!c.inclusive; }
    else if (c.check === "string_format") bounds.format = c.format;
    else if (c.check === "number_format") bounds.format = c.format;
  }
  return bounds;
}

function flattenZod(schema) {
  const leaves = new Map();
  const objects = [];
  const arrays = [];
  const addLeaf = (leaf) => {
    const prev = leaves.get(leaf.path);
    if (!prev) leaves.set(leaf.path, leaf);
    else if (prev.type !== leaf.type) prev.type = `${prev.type} | ${leaf.type}`;
  };
  const walk = (node, at, ctx) => {
    const def = node && node.def;
    if (!def) return;
    switch (def.type) {
      case "optional":
      case "default":
      case "prefault":
      case "catch":
        return walk(def.innerType, at, { ...ctx, required: false });
      case "nullable":
        return walk(def.innerType, at, { ...ctx, nullable: true });
      case "readonly":
      case "nonoptional":
        return walk(def.innerType, at, ctx);
      case "pipe":
        return walk(def.in && def.in.def && def.in.def.type === "transform" ? def.out : def.in, at, ctx);
      case "lazy":
        return ctx.depth > 6 ? addLeaf({ path: at, type: "lazy", required: ctx.required }) : walk(def.getter(), at, { ...ctx, depth: ctx.depth + 1 });
      case "object": {
        objects.push({ path: at, strict: !!def.catchall && def.catchall.def.type === "never" });
        for (const [key, child] of Object.entries(def.shape)) walk(child, at ? `${at}.${key}` : key, { ...ctx, required: ctx.required });
        return;
      }
      case "array": {
        arrays.push({ path: at, required: ctx.required, bounds: checkBounds(def) });
        return walk(def.element, `${at}[]`, { ...ctx, required: true });
      }
      case "record":
        return walk(def.valueType, `${at}.*`, { ...ctx, required: true });
      case "union":
        for (const option of def.options) walk(option, at, ctx);
        return;
      case "intersection":
        walk(def.left, at, ctx);
        return walk(def.right, at, ctx);
      case "enum":
        return addLeaf({ path: at, type: "enum", required: ctx.required, nullable: !!ctx.nullable, enumValues: Object.values(def.entries) });
      case "literal":
        return addLeaf({ path: at, type: "literal", required: ctx.required, nullable: !!ctx.nullable, enumValues: [...def.values] });
      default:
        return addLeaf({ path: at, type: def.type, required: ctx.required, nullable: !!ctx.nullable, bounds: checkBounds(def) });
    }
  };
  walk(schema, "", { required: true, depth: 0 });
  return { leaves: [...leaves.values()], objects, arrays };
}

let schemaCache = null;
function getRequestSchemas() {
  if (schemaCache) return schemaCache;
  assertBuildFresh();
  const mod = require(path.join(FUNCTIONS_DIR, "lib", "validation", "schemas.js"));
  const out = {};
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value === "object" && value.def && typeof value.safeParse === "function") out[name] = { name, ...flattenZod(value) };
  }
  schemaCache = out;
  return out;
}

// ---------------------------------------------------------------------------
// Document types (TypeScript checker)
// ---------------------------------------------------------------------------

let programCache = null;
function getProgram() {
  if (programCache) return programCache;
  const configPath = path.join(FUNCTIONS_DIR, "tsconfig.json");
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, FUNCTIONS_DIR);
  programCache = ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
  return programCache;
}

function flattenType(checker, rootType) {
  const leaves = new Map();
  const inSrc = (type) => {
    const symbol = type.aliasSymbol || type.symbol;
    const decls = (symbol && symbol.declarations) || [];
    // Anonymous object types (inferred from Zod via z.output) are declared inside zod's .d.ts but are ours.
    const anonymous = symbol && (symbol.name === "__type" || symbol.name === "__object");
    return anonymous || decls.length === 0 || decls.some((d) => path.resolve(d.getSourceFile().fileName).startsWith(SRC_DIR));
  };
  // `description`: the hand-written comment of the property that declares this leaf (memberComment).
  const add = (at, type, optional, note, description) => {
    const text = note || checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
    const prev = leaves.get(at);
    if (!prev) leaves.set(at, { path: at, type: text, optional, ...(description ? { description } : {}) });
    else {
      if (!prev.type.split(" | ").includes(text)) prev.type = `${prev.type} | ${text}`;
      if (!prev.description && description) prev.description = description;
    }
  };
  const walk = (type, at, optional, stack, description) => {
    if (type.isUnion()) {
      const parts = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
      const nullable = parts.length !== type.types.length;
      const objectParts = parts.filter((t) => t.flags & ts.TypeFlags.Object);
      if (objectParts.length === 0) return add(at, type, optional || nullable, undefined, description);
      for (const part of parts) walk(part, at, optional || nullable, stack, description);
      return;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return add(at, type, optional, undefined, description);
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const element = checker.getTypeArguments(type)[0];
      return element ? walk(element, `${at}[]`, false, stack, description) : add(`${at}[]`, type, false, undefined, description);
    }
    if (!inSrc(type)) return add(at, type, optional, undefined, description);
    if (stack.includes(type) || stack.length > 8) return add(at, type, optional, "(recursive)", description);
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    const props = checker.getPropertiesOfType(type);
    if (index) walk(index, `${at}.*`, false, [...stack, type], description);
    if (!index && props.length === 0) return add(at, type, optional, undefined, description);
    for (const prop of props) {
      const propType = checker.getTypeOfSymbol(prop);
      const decl = (prop.declarations || [])[0];
      walk(propType, at ? `${at}.${prop.name}` : prop.name, !!(prop.flags & ts.SymbolFlags.Optional), [...stack, type], decl ? memberComment(decl) : "");
    }
  };
  walk(rootType, "", false, []);
  return [...leaves.values()];
}

/** Hand-written description next to a field: its JSDoc, else its trailing `//` comment. */
/** The comment a declaration carries: its JSDoc, else a trailing comment on the same line. */
function memberComment(member) {
  const sf = member.getSourceFile();
  const text = sf.getFullText();
  const jsDoc = (ts.getJSDocCommentsAndTags(member) || []).map((d) => (typeof d.comment === "string" ? d.comment : ts.getTextOfJSDocComment(d.comment) || "")).join(" ").trim();
  // The trailing comment after the member, or after its separating comma / semicolon.
  const end = /[,;]/.test(text[member.end] || "") ? member.end + 1 : member.end;
  const trailing = (ts.getTrailingCommentRanges(text, end) || []).map((r) => text.slice(r.pos, r.end).replace(/^\/\/\s*|^\/\*+|\*+\/$/g, "").trim()).join(" ");
  return (jsDoc || trailing).replace(/\s+/g, " ").trim();
}

function propertyComments(sf, iface) {
  const out = {};
  for (const member of iface.members) {
    if (!member.name) continue;
    const comment = memberComment(member);
    if (comment) out[member.name.getText(sf)] = comment;
  }
  return out;
}

/**
 * Response types: per callable, the leaves of its handler's awaited return type (TypeScript checker),
 * each with the comment of the property that declares it. The source of the OpenAPI response schemas.
 */
let responseCache = null;
function getResponseTypes() {
  if (responseCache) return responseCache;
  const program = getProgram();
  const checker = program.getTypeChecker();
  const out = {};
  for (const exp of getExports().filter((e) => e.type === "callable")) {
    const abs = path.join(ROOT, exp.file);
    const sf = program.getSourceFiles().find((f) => path.resolve(f.fileName) === abs);
    let fn = null;
    for (const st of (sf && sf.statements) || []) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === exp.name && d.initializer && ts.isCallExpression(d.initializer)) {
          fn = d.initializer.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        }
      }
    }
    if (!fn) continue;
    const signature = checker.getSignatureFromDeclaration(fn);
    const returned = signature && checker.getReturnTypeOfSignature(signature);
    const awaited = returned && (checker.getAwaitedType(returned) || returned);
    const text = awaited ? checker.typeToString(awaited) : "unknown";
    out[exp.name] = { type: text, opaque: !awaited || /^(any|unknown|void)$/.test(text), leaves: awaited ? flattenType(checker, awaited) : [] };
  }
  responseCache = out;
  return out;
}

let docTypeCache = null;
function getDocTypes() {
  if (docTypeCache) return docTypeCache;
  const program = getProgram();
  const checker = program.getTypeChecker();
  const modelsAbs = path.join(SRC_DIR, "types", "models.ts");
  const sf = program.getSourceFiles().find((f) => path.resolve(f.fileName) === modelsAbs);
  const out = {};
  for (const st of sf.statements) {
    if (!ts.isInterfaceDeclaration(st) || !/Doc$/.test(st.name.text)) continue;
    const type = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(st.name));
    out[st.name.text] = { name: st.name.text, file: rel(modelsAbs), line: lineOf(sf, st), leaves: flattenType(checker, type), comments: propertyComments(sf, st) };
  }
  docTypeCache = out;
  return out;
}

// ---------------------------------------------------------------------------
// Collections and rules
// ---------------------------------------------------------------------------

/** Parent of a collection that is only ever reached through a parent document (subcollection). */
function subcollectionParents() {
  const parents = {};
  for (const abs of productionSourceFiles()) {
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/\.collection\(\s*"([A-Za-z]+)"\s*\)\s*\.doc\([^)]*\)\s*\.collection\(\s*"([A-Za-z]+)"\s*\)/g)) parents[m[2]] = m[1];
  }
  return parents;
}

function parseRulesFile(relPath) {
  const abs = path.join(ROOT, relPath);
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const matches = [];
  const allows = [];
  const stack = [];
  let depth = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "");
    const m = line.match(/match\s+(\/\S+)\s*\{/);
    if (m) {
      const full = stack.map((s) => s.path).join("") + m[1];
      stack.push({ path: m[1], depth });
      matches.push({ file: relPath, line: i + 1, path: full });
    }
    const a = line.match(/allow\s+([a-z,\s]+):/);
    if (a) {
      const matchPath = stack.map((s) => s.path).join("");
      for (const op of a[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        allows.push({ file: relPath, line: i + 1, matchPath, operation: op, unconditionalDeny: /:\s*if\s+false\s*;/.test(line) });
      }
    }
    for (const ch of line.replace(/{[^{}]*}/g, "")) {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (stack.length && stack[stack.length - 1].depth === depth) stack.pop();
      }
    }
  });
  return { matches, allows };
}

function getRules() {
  return { firestore: parseRulesFile("firestore.rules"), storage: parseRulesFile("storage.rules") };
}

/** `/databases/{database}/documents/users/{uid}/devices/{deviceId}` → `users/devices`; wildcards → null. */
function rulesCollectionKey(matchPath) {
  const segments = matchPath.replace(/^\/databases\/\{[^}]+\}\/documents/, "").split("/").filter(Boolean);
  const names = segments.filter((_, i) => i % 2 === 0);
  if (!names.length || names.some((n) => n.startsWith("{"))) return null;
  return names.join("/");
}

function getCollections(options = {}) {
  const parents = subcollectionParents();
  const names = new Set();
  const usedIn = {};
  for (const abs of productionSourceFiles()) {
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/\.collection(?:Group)?\(\s*"([A-Za-z]+)"\s*\)/g)) {
      names.add(m[1]);
      (usedIn[m[1]] = usedIn[m[1]] || new Set()).add(rel(abs));
    }
  }
  const collections = [...names].sort().map((name) => {
    const parent = parents[name];
    return { key: parent ? `${parent}/${name}` : name, name, parent: parent || null, type: parent ? "subcollection" : "root", usedIn: [...usedIn[name]].sort() };
  });
  if (options.skipRules) {
    return { collections, explicitRules: [], rulesNotInRegistry: [], defaultDeny: [] };
  }
  const keys = new Set(collections.map((c) => c.key));
  const rules = getRules().firestore;
  const explicitRules = rules.matches.map((m) => ({ ...m, key: rulesCollectionKey(m.path) })).filter((m) => m.key);
  const rulesNotInRegistry = explicitRules.filter((m) => !keys.has(m.key));
  const ruleKeys = new Set(explicitRules.map((m) => m.key));
  return { collections, explicitRules, rulesNotInRegistry, defaultDeny: collections.filter((c) => !ruleKeys.has(c.key)).map((c) => c.key) };
}

/** Collection name → document interface, by naming convention; unmatched on either side is reported. */
function mapCollectionsToDocTypes() {
  const docTypes = getDocTypes();
  const { collections } = getCollections();
  const candidates = (name) => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    const stems = [cap.replace(/ies$/, "y"), cap.replace(/s$/, ""), cap.replace(/es$/, ""), cap];
    return [...new Set(stems)].map((stem) => `${stem}Doc`);
  };
  const mapped = [];
  const used = new Set();
  for (const col of collections) {
    const docName = candidates(col.name).find((c) => docTypes[c]) || null;
    if (docName) used.add(docName);
    mapped.push({ collection: col.key, docType: docName });
  }
  return { mapped, collectionsWithoutType: mapped.filter((m) => !m.docType).map((m) => m.collection), typesWithoutCollection: Object.keys(docTypes).filter((d) => !used.has(d)) };
}

// ---------------------------------------------------------------------------
// `any`
// ---------------------------------------------------------------------------

function getAnyUsages() {
  const out = [];
  for (const abs of productionSourceFiles()) {
    const sf = parseFile(abs);
    const lines = sf.getFullText().split(/\r?\n/);
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const parent = node.parent;
        const form = ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) ? "cast"
          : ts.isCatchClause(parent.parent || parent) || (ts.isVariableDeclaration(parent) && ts.isCatchClause(parent.parent)) ? "catch-variable" : "annotation";
        const line = lineOf(sf, node);
        out.push({ file: rel(abs), line, form, text: lines[line - 1].trim().slice(0, 160) });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

module.exports = {
  ROOT, FUNCTIONS_DIR, SRC_DIR, ts, rel, walkFiles, sourceFiles, productionSourceFiles, isTestFile,
  getExports, getRequestSchemas, getDocTypes, getResponseTypes, getCollections, getRules, mapCollectionsToDocTypes, getAnyUsages, flattenZod,
};
