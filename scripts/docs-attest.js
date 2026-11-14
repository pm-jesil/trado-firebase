#!/usr/bin/env node
/**
 * Trado Documentation Attestation Engine (Prompt 67 C.5 / Prompt 68 Z-10)
 *
 * Attests a documentation file by verifying that:
 * 1. Its JSON examples parse and validate against schemas
 * 2. Its callable symbols exist in the canonical inventory
 * 3. Its links resolve cleanly
 *
 * Updates YAML front matter with:
 *   verifiedAgainst: <sha256 of code state>
 *   lastAttestedAt: <ISO timestamp>
 *
 * Usage: node scripts/docs-attest.js <doc-path>
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const targetArg = process.argv[2];

if (!targetArg) {
  console.log("Usage: node scripts/docs-attest.js <path/to/doc.md>");
  process.exit(1);
}

const targetPath = path.isAbsolute(targetArg) ? targetArg : path.join(ROOT, targetArg);

if (!fs.existsSync(targetPath)) {
  console.error(`[FAIL] File does not exist: ${targetPath}`);
  process.exit(1);
}

console.log(`Attesting ${path.relative(ROOT, targetPath)}...`);

// 1. Verify markdown examples and truth
try {
  execSync("node scripts/check-doc-examples.js", { cwd: ROOT, stdio: "pipe" });
  execSync("node scripts/check-doc-truth.js", { cwd: ROOT, stdio: "pipe" });
  execSync("node scripts/check-markdown-links.js", { cwd: ROOT, stdio: "pipe" });
} catch (e) {
  console.error(`[FAIL] Attestation verification checks failed: ${e.message}`);
  process.exit(1);
}

// 2. Compute code state hash
const modelsPath = path.join(ROOT, "functions/src/types/models.ts");
const schemasPath = path.join(ROOT, "functions/src/validation/schemas.ts");
const codeContent = fs.readFileSync(modelsPath, "utf8") + fs.readFileSync(schemasPath, "utf8");
const codeHash = crypto.createHash("sha256").update(codeContent).digest("hex").slice(0, 16);

// 3. Update front matter
let content = fs.readFileSync(targetPath, "utf8");
const timestamp = new Date().toISOString();

if (content.startsWith("---")) {
  // Update existing front matter
  const endIdx = content.indexOf("---", 3);
  if (endIdx !== -1) {
    const fmMatter = content.slice(3, endIdx);
    let newFm = fmMatter;
    if (newFm.includes("verifiedAgainst:")) {
      newFm = newFm.replace(/verifiedAgainst:.*\n/, `verifiedAgainst: "${codeHash}"\n`);
    } else {
      newFm += `verifiedAgainst: "${codeHash}"\n`;
    }
    if (newFm.includes("lastAttestedAt:")) {
      newFm = newFm.replace(/lastAttestedAt:.*\n/, `lastAttestedAt: "${timestamp}"\n`);
    } else {
      newFm += `lastAttestedAt: "${timestamp}"\n`;
    }
    content = `---${newFm}---${content.slice(endIdx + 3)}`;
  }
} else {
  // Prepend front matter
  const fm = `---\ncovers: "${path.basename(targetPath)}"\nverifiedAgainst: "${codeHash}"\nlastAttestedAt: "${timestamp}"\n---\n\n`;
  content = fm + content;
}

fs.writeFileSync(targetPath, content, "utf8");
console.log(`✓ Attested ${path.relative(ROOT, targetPath)} against code hash ${codeHash} at ${timestamp}`);

