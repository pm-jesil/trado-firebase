---
covers: [all]
verifiedAgainst: static-policy
---

# Engineering Rules (Binding: R1–R4 & Evidence Standards)

## Core Architectural Invariants (R1–R4)
- **R1 (One Fact, One Home):** Every business attribute is stored in exactly one authoritative collection. Other documents hold foreign keys (\`*Id\`) only, never inline copies of descriptive attributes.
- **R2 (Frozen Snapshots):** Transactional documents (bills, outflows, payments, returns) freeze entity snapshots (prices, tax rates, party names) at the moment of issue. Lines are never modified post-issue.
- **R3 (Single-Writer Cache):** Derived counters and rollups have exactly one designated writer (triggers or services) and an automated reconciliation test (\`check-data-duplication.cjs\`).
- **R4 (Ledger Entry):** Inventory movements, financial transactions, and audit events are strictly append-only. No deletion or in-place modification of historical events.

## Evidence Standards & Evidence Ladder (D-28)
No assertion of completeness or correctness is valid without reproducible evidence citing \`file:line\` + test name + raw command output:
- **L0 (Claim only):** Text in a document or report. Never counts as proof.
- **L1 (Code exists):** Verified source line in TypeScript/JavaScript.
- **L2 (Behavioral proof):** Automated test passes in a fresh test runner run.
- **L3 (Guard proof):** Static or dynamic guard exists and demonstrates failure on a seeded defect.
- **L4 (End-to-End proof):** Integration flow verified in the local Firebase emulator with raw Firestore document inspections.

## Banned Words & Claims
- **"Production Ready"** is strictly forbidden. Use "emulator-verified" with open checklist items.
- **"All / Every / Complete"** is forbidden unless substantiated by a computed mathematical ratio.
- Forbidden claim terms (banned): \`production ready\`, \`production-ready\`, \`100% complete\` (without ratio).
