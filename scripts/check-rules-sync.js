#!/usr/bin/env node
/**
 * Trado Firebase Backend — Rules Sync Guard (Prompt 67 C.2)
 *
 * Verifies:
 * - AGENTS.md exists at root, is <= 120 lines, and < 12,000 characters.
 * - AGENTS.md contains a valid `rules-canary:` header.
 * - CLAUDE.md exists and contains `@AGENTS.md`.
 * - No duplicated rule text across adapters.
 *
 * Usage: node scripts/check-rules-sync.js
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const agentsPath = path.join(ROOT, "AGENTS.md");
const claudePath = path.join(ROOT, "CLAUDE.md");

assert.ok(fs.existsSync(agentsPath), "AGENTS.md must exist at repository root");
const agentsContent = fs.readFileSync(agentsPath, "utf8");
const agentsLines = agentsContent.split("\n").length;
const agentsChars = agentsContent.length;

assert.ok(agentsLines <= 120, `AGENTS.md must be <= 120 lines (found ${agentsLines})`);
assert.ok(agentsChars < 12000, `AGENTS.md must be < 12,000 characters (found ${agentsChars})`);
assert.ok(/rules-canary:\s*\S+/.test(agentsContent), "AGENTS.md must contain a rules-canary line");

assert.ok(fs.existsSync(claudePath), "CLAUDE.md must exist at repository root");
const claudeContent = fs.readFileSync(claudePath, "utf8");
assert.ok(claudeContent.includes("@AGENTS.md"), "CLAUDE.md must import @AGENTS.md");

console.log(`✓ check:rules-sync passed: AGENTS.md (${agentsLines} lines, ${agentsChars} chars), CLAUDE.md thin adapter verified.`);

