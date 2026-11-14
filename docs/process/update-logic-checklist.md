---
covers: [all]
verifiedAgainst: static-policy
---

# Update Logic Checklist (Appendix D: U-1 .. U-15)

Every update-capable callable and every updating trigger must satisfy:

| ID | Check | Requirement |
|---|---|---|
| **U-1** | **Patch Semantics** | Only sent fields change. Untouched fields remain byte-identical before and after the update. |
| **U-2** | **Clearing Optional Fields** | \`null\` clears an optional field; omitted preserves existing value. |
| **U-3** | **Arrays and Maps** | Replace vs merge behavior explicitly documented and tested. Maximum item counts enforced. |
| **U-4** | **Immutable Fields** | Immutable and server-owned fields (\`id\`, \`organizationId\`, \`createdAt\`, \`createdBy\`, number sequences, balances) are strictly rejected with an error. |
| **U-5** | **Field-Level Auth** | Permissions enforced per field (e.g. sensitive fields require \`...:manage_sensitive\`). |
| **U-6** | **State Machine** | Document state transitions adhere to declared state tables. Illegal transitions fail with stable reason. |
| **U-7** | **Concurrency** | Preconditions on \`updatedAt\` or explicit transactional last-write-wins with collision test. |
| **U-8** | **Idempotent Update** | Repeated call with identical idempotency key yields same result with zero second side-effect or audit event. |
| **U-9** | **Uniqueness Maintenance** | Renaming natural keys moves locks atomically in \`uniqueKeys\`, releasing prior key. |
| **U-10** | **Derived / Cache Fields** | Single writer principle maintained; derived caches reconcile cleanly. |
| **U-11** | **Referential Effects** | Historical frozen snapshots (R2) remain untouched; relational lookups (R1) resolve live references. |
| **U-12** | **Side Effects & Triggers** | Triggers execute once per change; ledger entries (R4) remain append-only. |
| **U-13** | **Unified Audit** | Exactly one audit event recorded on commit with before/after diff and sensitive field redaction. |
| **U-14** | **Cost & Operations** | Operation counts stay within budget; zero redundant master document reads. |
| **U-15** | **Coupling Verification** | Tests, documentation, and OpenAPI schemas updated together. |

