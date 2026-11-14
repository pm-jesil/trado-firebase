---
covers: [all]
verifiedAgainst: static-policy
---

# Testing Standard (Part T & D-31)

## 1. Test Layers
1. **Generated Contract Suites:** Generated from schemas and registry: parameter validation, bounds, enums, unknown key rejection, permission matrix (4 layers × personas), tenant isolation, idempotency replay, response shapes (D-18), error reasons, and cost budgets.
2. **Hand-Written Business Scenarios:** Derived from \`docs/testing/scenario-taxonomy.md\` and \`docs/testing/flows.md\`. One test per applicable taxonomy scenario per callable.
3. **Property-Based Tests:** Pure logic with invariants (money rounding, tax calculations, stock WAC valuation, state machines).
4. **Mutation Tests:** Applied to pure-logic engines with Stryker or equivalent (target ≥ 80% mutation kill score for money and tax logic).
5. **Rules Test Matrix:** Every collection × persona × read/write tested with allow and deny assertions in \`firestoreRules.test.ts\` and \`storageRules.test.ts\`.
6. **Regression Tests:** Every defect fixed must have a regression test that fails before the fix and passes after.

## 2. Test Quality Guard Invariants
- Zero unasserted tests
- Zero tautological tests (\`expect(true)\`)
- Zero skipped or focused tests (\`.skip\`, \`.only\`, \`xit\`, \`fit\`)
- Zero swallowed errors in try/catch blocks
- Mandatory raw Firestore document assertion for mutation callables (response alone is insufficient)
- Deterministic IDs and fake clocks; zero hard-coded time bombs

