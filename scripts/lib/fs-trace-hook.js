/**
 * Preload hook for the Change-Impact Test System (Part 4.2, items 2 and 3).
 *
 * Loaded through NODE_OPTIONS=--require by scripts/verify-impact.js, so every Node process a unit
 * starts (including `node --test` workers and npm scripts) records each repository file it reads
 * or loads. `require` reads through fs too, so built modules under functions/lib are captured; the
 * impact system maps them back to functions/src. One file per process under
 * .local/fs-traces/<unit>/<pid>.txt, written at exit.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const UNIT = process.env.VERIFY_UNIT;
if (UNIT) {
  const seen = new Set();
  const skip = /[\\/](node_modules|\.git|\.local)[\\/]/;
  const note = (p) => {
    try {
      if (typeof p !== "string" && !(p instanceof URL)) return;
      const abs = path.resolve(String(p instanceof URL ? p.pathname.replace(/^\/([A-Za-z]:)/, "$1") : p));
      if (!abs.toLowerCase().startsWith(ROOT.toLowerCase()) || skip.test(abs)) return;
      seen.add(path.relative(ROOT, abs).replace(/\\/g, "/"));
    } catch (e) {
      // never let tracing break the unit
    }
  };
  for (const name of ["readFileSync", "readFile", "existsSync", "statSync", "readdirSync", "createReadStream", "openSync"]) {
    const original = fs[name];
    if (typeof original !== "function") continue;
    fs[name] = function traced(p, ...rest) {
      note(p);
      return original.call(this, p, ...rest);
    };
  }
  for (const name of ["readFile", "readdir", "stat", "access", "open"]) {
    const original = fs.promises && fs.promises[name];
    if (typeof original !== "function") continue;
    fs.promises[name] = function traced(p, ...rest) {
      note(p);
      return original.call(this, p, ...rest);
    };
  }
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function tracedLoad(request, parent, ...rest) {
    try {
      if (request.startsWith(".") || path.isAbsolute(request)) note(Module._resolveFilename(request, parent));
    } catch (e) {
      // resolution errors surface in the real load below
    }
    return originalLoad.call(this, request, parent, ...rest);
  };
  if (process.argv[1]) note(process.argv[1]);
  process.on("exit", () => {
    try {
      const dir = path.join(process.env.VERIFY_EVIDENCE_DIR || path.join(ROOT, ".local"), "fs-traces", UNIT.replace(/[^A-Za-z0-9._-]/g, "_"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${process.pid}.txt`), [...seen].sort().join("\n"));
    } catch (e) {
      // ignore
    }
  });
}
