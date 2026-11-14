---
covers: [all]
verifiedAgainst: static-policy
---

# Handoff and Session Lifecycle Protocol (Appendix E)

To ensure seamless coordination between Claude Code and Antigravity, every session follows strict lifecycle protocols:

## Start of Session Protocol
1. Perform capability self-check (shell, emulator, network, file writes).
2. Read standing rules: \`AGENTS.md\`, \`docs/decisions/decision-register.md\`, \`docs/audit/handoff.md\`, \`docs/audit/open-questions.md\`.
3. Check verification status: \`npm run verify:status\`.
4. Append session start entry to \`docs/audit/run-ledger.md\`.

## End of Session Protocol
1. Overwrite \`docs/audit/handoff.md\` with:
   - Current state in five lines
   - Half-done files and exact reason
   - Completed slices and remaining slices
   - Open questions (\`Q-ids\`) and blocked items
   - Exact next shell command to execute in the other tool
   - Explicit list of items the next agent must NOT redo
2. Complete entry in \`docs/audit/run-ledger.md\`.
3. Ensure no uncommitted generated file is left half-written.

