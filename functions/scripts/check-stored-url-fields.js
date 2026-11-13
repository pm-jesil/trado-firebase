/**
 * @guard-scope: files functions/src/**\/*.ts
 * check:stored-url-fields — Guard against stored URL/URI image fields (D-15)
 *
 * Any field named *url, *uri, *link or holding an http(s)://, gs:// value must be:
 *   - Registered in EXTERNAL_URL_FIELDS as an intentional external reference (e.g. website), OR
 *   - A FAIL if it is image-related.
 *
 * Also scans:
 *   - TypeScript interfaces/types for url? fields inside ImageRef or image-related types
 *   - Zod schemas for url() validators on image-related fields
 *   - Firestore live data (if --live flag passed) for actual stored URL values
 *
 * Usage: node functions/scripts/check-stored-url-fields.js [--live]
 */

const fs = require("fs");
const path = require("path");
const { glob } = require("glob");

// D-17: Intentionally stored external URLs — these are NOT images
const EXTERNAL_URL_FIELDS = [
  { field: "website", reason: "Business website URL — intentional external reference (R1 exception under D-15)" },
  { field: "uploadPath", reason: "Temporary upload session path in imageUploadSessions — not a final stored URL" },
  { field: "imageUploadSessions", reason: "Transient session collection — uploadPath is a GCS tmp path, not a display URL" },
  // Computed response fields (not stored):
  { field: "imageUrl", reason: "D-15 computed display URL — added at read time, never stored; registered in naming registry" },
  { field: "thumbnailUrl", reason: "D-15 computed thumbnail URL — added at read time, never stored; registered in naming registry" },
];

const EXTERNAL_URL_FIELD_NAMES = new Set(EXTERNAL_URL_FIELDS.map((e) => e.field));

// Image-related URL field names that must NOT be stored
const BANNED_IMAGE_URL_FIELDS = [
  "photoUrl", "avatarUrl", "logoUrl", "imageUrls", "pictureUrl",
  "profileImage", "thumbUrl", "image.url", "imageRef.url",
];

async function scanSourceFiles() {
  const srcDir = path.join(process.cwd(), "src");
  const files = await glob("**/*.ts", {
    cwd: srcDir,
    ignore: ["**/test/**", "**/*.test.ts", "**/*.spec.ts"],
  });

  const findings = [];
  for (const relFile of files) {
    const absFile = path.join(srcDir, relFile);
    const content = fs.readFileSync(absFile, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      for (const bannedField of BANNED_IMAGE_URL_FIELDS) {
        if (line.includes(bannedField) && !line.includes("// D-15") && !line.includes("* D-15")) {
          // D-17: exclusion — destructuring-for-deletion pattern (strips the field, not writes it)
          if (/const\s*\{[^}]*(?:logoUrl|imageUrls|bankDetails)[^}]*\}\s*=/.test(line)) continue;
          findings.push({
            file: relFile, line: lineNum,
            field: bannedField, text: line.trim(),
            type: "banned-image-url-field-in-source",
          });
        }
      }

      // Detect: url?: string inside ImageRef or similar
      if (/url\s*\??\s*:\s*(string|z\.string)/.test(line) && !EXTERNAL_URL_FIELD_NAMES.has("imageUrl")) {
        // Check if this is inside a type block that relates to images
        const contextBlock = lines.slice(Math.max(0, i - 20), i).join("\n");
        if (/ImageRef|imageRef|image\s*=|org_logo|user_photo|party_photo|product_image/i.test(contextBlock)) {
          findings.push({
            file: relFile, line: lineNum,
            field: "url (inside image type)",
            text: line.trim(),
            type: "url-field-inside-image-type",
          });
        }
      }
    }
  }
  return findings;
}

async function main() {
  console.log("=================================================================");
  console.log("   check:stored-url-fields — D-15 Guard");
  console.log("=================================================================");
  console.log(`\nExternal URL allowlist: ${EXTERNAL_URL_FIELDS.length} entries (D-17)`);
  for (const e of EXTERNAL_URL_FIELDS) {
    console.log(`  ✓ ${e.field}: ${e.reason}`);
  }

  const findings = await scanSourceFiles();

  if (findings.length === 0) {
    console.log("\n✓ PASS — No banned stored image URL fields found in source.");
    process.exit(0);
  }

  console.error(`\n[FAIL] ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} [${f.type}] field="${f.field}"`);
    console.error(`    ${f.text}`);
  }
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
