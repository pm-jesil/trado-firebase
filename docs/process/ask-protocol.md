---
covers: [all]
verifiedAgainst: static-policy
---

# Ask-Don't-Guess Protocol (D-32)

## When to Ask
1. Two reasonable readings would alter stored data, API contracts, money, stock, or permission semantics.
2. An action is irreversible (permanent document deletions, dropping schema fields).
3. Documentation and code contradict each other on a critical business rule.
4. Two architectural rules or prompt requirements conflict.

## When NOT to Ask
1. The code, data model, or existing decision register already provides an unambiguous answer.
2. Stylistic choices covered by existing repo conventions.

## Question Block Format
\`\`\`markdown
### Q-017 · <short title> · blocks: <items> | affects: <area>
Found:        <evidence — file:line, what the code does, what the docs say>
Question:     <one sentence>
Options:      A) … B) … C) …
Recommended:  A, because …
If wrong:     <what breaks, how reversible>
Meanwhile:    <what continues; items marked BLOCKED-ON Q-017>
\`\`\`

## Handling in Agents
- **Interactive Mode:** Surface question block in chat, ask interactively, wait for owner's response before executing irreversible branches.
- **Unattended Mode:** Record question into \`docs/audit/open-questions.md\`, choose the safest reversible default marked \`ASSUMED\`, and halt any irreversible action until confirmed.
- Once answered, record decision in \`docs/decisions/decision-register.md\` (\`A-n\` or \`D-n\`) so it is never asked again.

