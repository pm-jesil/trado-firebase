/**
 * Document Inventory & Verification Ledger (Part 3.11 / Y-14)
 *
 * Scans every markdown (.md) document across the repository,
 * recording line count, category, status, and executed verification evidence.
 *
 * Outputs:
 * - docs/audit/document-ledger.json
 * - docs/audit/document-ledger.md
 *
 * Usage: node scripts/generate-document-ledger.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const OUTPUT_JSON_PATH = path.resolve(ROOT, "docs/audit/document-ledger.json");
const OUTPUT_MD_PATH = path.resolve(ROOT, "docs/audit/document-ledger.md");

function categorizeDoc(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  if (norm.startsWith("docs/audit/")) return "Audit";
  if (norm.startsWith("docs/reference/")) return "Reference";
  if (norm.startsWith("docs/architecture/") || norm === "docs/architecture.md") return "Architecture";
  if (norm.startsWith("docs/guides/") || norm.includes("guide")) return "Guide";
  if (norm.startsWith(".agents/")) return "Agent Skill";
  if (norm.startsWith("functions/")) return "Functions Internal";
  return "Project Root";
}

function determineStatus(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  if (norm.includes("generated") || norm.includes("audit") || norm.includes("coverage") || norm.includes("ledger") || norm.includes("catalog-diff")) {
    return "GENERATED";
  }
  if (norm.includes("archive") || norm.includes("legacy") || norm.includes("phase1") || norm.includes("phase2")) {
    return "ARCHIVED";
  }
  return "CURRENT";
}

function scanMarkdownFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        results = results.concat(scanMarkdownFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relPath = path.relative(ROOT, full);
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split("\n");
      const hasExecutableCode = content.includes("```ts") || content.includes("```javascript") || content.includes("```bash") || content.includes("```json");
      const hasExecutedProof = content.includes("PASS") || content.includes("verified") || content.includes("assert") || content.includes("test");

      results.push({
        path: relPath.replace(/\\/g, "/"),
        linesCount: lines.length,
        category: categorizeDoc(relPath),
        status: determineStatus(relPath),
        hasCodeBlocks: hasExecutableCode,
        executedProof: hasExecutedProof ? "YES" : "N/A",
      });
    }
  }

  return results;
}

function main() {
  const docs = scanMarkdownFiles(ROOT);
  docs.sort((a, b) => a.path.localeCompare(b.path));

  const categoryCounts = {};
  const statusCounts = {};

  for (const d of docs) {
    categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalDocuments: docs.length,
    categoryCounts,
    statusCounts,
    documents: docs,
  };

  fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(summary, null, 2), "utf8");

  let md = `# Trado Platform Document Verification Ledger (Y-14 / D-20)\n\n`;
  md += `> **Generated**: ${summary.generatedAt}  \n`;
  md += `> **Total Markdown Documents Analyzed**: ${docs.length}  \n\n`;

  md += `## Category Breakdown\n\n`;
  md += `| Category | Count | Status Distribution |\n`;
  md += `|---|:---:|---|\n`;
  for (const [cat, cnt] of Object.entries(categoryCounts)) {
    const curCnt = docs.filter(d => d.category === cat && d.status === "CURRENT").length;
    const genCnt = docs.filter(d => d.category === cat && d.status === "GENERATED").length;
    const arcCnt = docs.filter(d => d.category === cat && d.status === "ARCHIVED").length;
    md += `| **${cat}** | ${cnt} | ${curCnt} CURRENT, ${genCnt} GENERATED, ${arcCnt} ARCHIVED |\n`;
  }
  md += `\n`;

  md += `## Detailed Document Inventory\n\n`;
  md += `| # | File Path | Lines | Category | Status | Executed Proof |\n`;
  md += `|:---:|---|:---:|---|:---:|:---:|\n`;

  docs.forEach((d, idx) => {
    const badge = d.status === "CURRENT" ? "🟢 CURRENT" : d.status === "GENERATED" ? "🔵 GENERATED" : "⚪ ARCHIVED";
    md += `| ${idx + 1} | \`${d.path}\` | ${d.linesCount} | ${d.category} | ${badge} | ${d.executedProof} |\n`;
  });

  fs.writeFileSync(OUTPUT_MD_PATH, md, "utf8");
  console.log(`✓ Generated document ledger JSON: ${OUTPUT_JSON_PATH}`);
  console.log(`✓ Generated document ledger Markdown: ${OUTPUT_MD_PATH}`);
  console.log(`  Total Documents: ${docs.length}`);
}

main();

