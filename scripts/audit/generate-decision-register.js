#!/usr/bin/env node
/**
 * Trado Firebase Backend — Decision Register Generator (Prompt 67 C.4)
 *
 * Generates docs/decisions/decision-register.md from decisions D-1 .. D-33.
 *
 * Usage: node scripts/audit/generate-decision-register.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "docs/decisions");
fs.mkdirSync(OUT_DIR, { recursive: true });

const DECISIONS = [
  { id: "D-1", title: "Super Admin Onboarding Scope Only", prompt: "60", status: "active", enforcedBy: "functions/src/services/contextResolver.ts", desc: "Super Admin provisions Owner and Admin users only during onboarding; all other tenant mutations remain forbidden." },
  { id: "D-2", title: "Owner Provisioning Default", prompt: "60", status: "active", enforcedBy: "functions/src/services/organizationProvisioning.ts", desc: "createOwner defaults to true; false produces an organization in explicit owner-pending state." },
  { id: "D-3", title: "Server-Generated Credentials", prompt: "60", status: "active", enforcedBy: "functions/src/services/organizationProvisioning.ts", desc: "Initial credentials are server-generated temporary passwords; forced reset on first sign-in." },
  { id: "D-4", title: "Default Party Type", prompt: "60", status: "active", enforcedBy: "functions/src/validation/schemas.ts", desc: "partyType defaults to 'organization' across customers, vendors, and schemas." },
  { id: "D-5", title: "ImageRef Path Storage", prompt: "60", status: "active", enforcedBy: "scripts/check-stored-url-fields.js", desc: "Images stored as ImageRef metadata paths; URLs never stored, computed at read time." },
  { id: "D-6", title: "Single Image Policy", prompt: "60", status: "active", enforcedBy: "docs/reference/image-policy.md", desc: "Image standards defined in one policy file; rules, Flutter, and docs derived from it." },
  { id: "D-7", title: "Pre-Release Atomic Migration", prompt: "62", status: "active", enforcedBy: "scripts/check-naming.js", desc: "Field renames and removals done atomically with data migration; no compatibility aliases." },
  { id: "D-8", title: "Field Addition Rubric", prompt: "62", status: "active", enforcedBy: "scripts/field-glossary.json", desc: "Fields added only if passing reference catalog rubric; others registered in deferral ledger." },
  { id: "D-9", title: "Issue-Time Legal Enforcement", prompt: "62", status: "active", enforcedBy: "functions/src/callables/bills.ts", desc: "Statutory fields (e.g. buyer tax ID) enforced at document issue time, not party creation." },
  { id: "D-10", title: "Sensitive Field Masking by Default", prompt: "62", status: "active", enforcedBy: "scripts/check-sensitive.js", desc: "Sensitive attributes (bank account, national tax ID) masked by default; unmasked only with permission." },
  { id: "D-11", title: "No Silently Ignored Fields", prompt: "63", status: "active", enforcedBy: "functions/src/validation/schemas.ts", desc: "Disallowed or unknown client fields fail with stable error reasons; never silently dropped." },
  { id: "D-12", title: "One Response Shape per Callable", prompt: "63", status: "active", enforcedBy: "functions/src/validation/schemas.ts", desc: "No duplicate representations of entities inside a single response payload." },
  { id: "D-13", title: "Every Fact Has One Home", prompt: "63", status: "active", enforcedBy: "scripts/check-doc-counts.js", desc: "Architecture counts, lists of callables, and field tables exist in generated files only." },
  { id: "D-14", title: "Schema as Single Field Source", prompt: "63", status: "active", enforcedBy: "scripts/check-doc-examples.js", desc: "Every field has description and example in the schema; docs and OpenAPI generated from it." },
  { id: "D-15", title: "Single Stored Image Field", prompt: "64", status: "active", enforcedBy: "scripts/check-stored-url-fields.js", desc: "Single stored field is 'image' of type ImageRef; photoUrl/avatarUrl removed from database." },
  { id: "D-16", title: "No 'any' on Write/Response Paths", prompt: "64", status: "active", enforcedBy: "functions/scripts/check-no-any-writes.js", desc: "Zero 'any' casts on database writes or response hydration paths." },
  { id: "D-17", title: "Guards Never Loosened", prompt: "64", status: "active", enforcedBy: "scripts/check-schema-duplicates.js", desc: "Guards never narrowed to make tests pass; registered exclusions require explicit justification." },
  { id: "D-18", title: "Unified Response Convention", prompt: "64", status: "active", enforcedBy: "functions/src/callables/usage.ts", desc: "Single entity returned under entity name; lists returned as { items, count, totalCount, nextCursor, included }." },
  { id: "D-19", title: "Computed Denominators", prompt: "65", status: "active", enforcedBy: "scripts/coverage-engine.js", desc: "Coverage denominators computed from source code truth, never from handwritten lists." },
  { id: "D-20", title: "Change-Impact Test System", prompt: "65", status: "active", enforcedBy: "scripts/verify-impact.js", desc: "Input hash baseline determines affected units; unimpacted units reported as skipped since baseline." },
  { id: "D-21", title: "Universal Attribution", prompt: "66", status: "active", enforcedBy: "functions/src/services/requestContext.ts", desc: "Every operation attributed to (organization|platform, user|system, source). Super Admin acts on platform scope." },
  { id: "D-22", title: "Cost Derived, Never Stored", prompt: "66", status: "active", enforcedBy: "functions/src/services/costReconciliation.ts", desc: "Rollups store operation quantities. Cost computed at read time using versioned rate card." },
  { id: "D-23", title: "Single Recording Points", prompt: "66", status: "active", enforcedBy: "scripts/check-recording-points.js", desc: "One recording point for metering (requestRecorder) and one for audit (auditRecorder) in wrapper layer." },
  { id: "D-24", title: "Unified Audit Collection", prompt: "66", status: "active", enforcedBy: "functions/src/services/auditRecorder.ts", desc: "auditLogs is the sole audit collection; changeHistory merged; entity history filtered by entityId." },
  { id: "D-25", title: "Tenant Cost Visibility Control", prompt: "66", status: "active", enforcedBy: "functions/src/callables/usage.ts", desc: "Tenants see operation counts and limits; platform cost visible only if showCostToTenant is enabled." },
  { id: "D-26", title: "Untrusted Client Metadata", prompt: "66", status: "active", enforcedBy: "functions/src/services/requestContext.ts", desc: "Token and server clock authoritative; client _meta feeds diagnostic analytics only." },
  { id: "D-27", title: "Privacy by Default", prompt: "66", status: "active", enforcedBy: "scripts/check-sensitive.js", desc: "IP addresses truncated (/24 and /48); secrets dropped; 24-month retention enforced by TTL." },
  { id: "D-28", title: "Evidence Ladder", prompt: "67", status: "active", enforcedBy: "scripts/audit/extract-obligations.js", desc: "Status assigned by evidence levels L0-L4 only; documentation text never counts as evidence." },
  { id: "D-29", title: "Frozen As-Found Baseline", prompt: "67", status: "active", enforcedBy: "docs/audit/as-found/", desc: "Phase A as-found snapshot is permanently frozen; ongoing progress tracked as delta." },
  { id: "D-30", title: "Change Coupling Enforcement", prompt: "67", status: "active", enforcedBy: "scripts/verify-coupling.js", desc: "Source changes require coupled updates to tests, docs, OpenAPI, and manifests before completion." },
  { id: "D-31", title: "Generated Contract Suites & Hand-Written Scenarios", prompt: "67", status: "active", enforcedBy: "docs/process/testing-standard.md", desc: "Contract tests generated from schemas and registry; complex domain scenarios hand-written." },
  { id: "D-32", title: "Ask, Don't Guess Protocol", prompt: "67", status: "active", enforcedBy: "docs/process/ask-protocol.md", desc: "Unclear business semantics asked interactively; answers recorded in register and never re-asked." },
  { id: "D-33", title: "Single Canonical Rule File", prompt: "67", status: "active", enforcedBy: "scripts/check-rules-sync.js", desc: "AGENTS.md is the single authoritative rule file; CLAUDE.md is a thin adapter referencing it." },
];

function main() {
  const mdLines = [
    "# Trado Architectural Decision Register (D-1 .. D-33)",
    "",
    `Generated at: ${new Date().toISOString()}  `,
    `Total decisions: **${DECISIONS.length}** (All Active)  `,
    "",
    "| ID | Title | Prompt | Status | Enforced By | Description |",
    "|---|---|---|---|---|---|",
    ...DECISIONS.map(d => `| **${d.id}** | **${d.title}** | ${d.prompt} | \`${d.status}\` | \`${d.enforcedBy}\` | ${d.desc} |`),
    "",
    "## Answered Business Decisions (A-n)",
    "",
    "| Question ID | Decision / Answer | Resolved Date | Applied In |",
    "|---|---|---|---|",
    "| **A-01** | Operations limits support both `warn_only` and `hard_block` modes with distinct error codes. | 2026-11-13 | `usageMetering.ts` |",
    "| **A-02** | `audit:read_own` restricts queries strictly to `actorUid == callerUid` with `ownActivityOnly: true`. | 2026-11-13 | `history.ts` |",
    "| **A-03** | `AGENTS.md` is canonical for all tools; `CLAUDE.md` contains `@AGENTS.md` thin adapter. | 2026-11-14 | `AGENTS.md` |",
    "",
  ];

  const outPath = path.join(OUT_DIR, "decision-register.md");
  fs.writeFileSync(outPath, mdLines.join("\n"), "utf8");
  console.log(`✓ Generated Decision Register: ${outPath}`);
}

main();

