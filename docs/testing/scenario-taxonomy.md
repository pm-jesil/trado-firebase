---
covers: [all]
verifiedAgainst: static-policy
---

# Real-World Scenario Taxonomy (Appendix C: R-01 .. R-40)

Every business callable and flow is mapped against applicable items from this taxonomy. \`N-A\` designations require an explicit reason from a standardized list.

| Group | Scenario ID & Description |
|---|---|
| **Concurrency & Delivery** | **R-01** Double submit / concurrent duplicate submission.<br>**R-02** Client retry after timeout with identical request ID (idempotent replay vs payload drift).<br>**R-03** Concurrent updates by two users on same document (lost update protection).<br>**R-04** Concurrent creates sharing same natural key (atomic unique lock).<br>**R-05** Concurrent stock decrement (prevent oversell and negative stock balance).<br>**R-06** Trigger executed twice or delivered out of order.<br>**R-07** Offline sync queue replaying stale payloads across schema/permission upgrades. |
| **Failure & Atomicity** | **R-08** Intermediate failure in multi-document transactions (zero partial commits).<br>**R-09** Async side-effect failure and poison event quarantine.<br>**R-10** Emulator vs cloud parity: composite index constraints, 1 MiB doc limit, 500 ops per batch.<br>**R-11** Abandoned upload sessions, orphan storage objects, upload timeout recovery.<br>**R-12** Cloud Function runtime timeout mid-operation. |
| **Data Boundaries** | **R-13** Null, empty string, single character, maximum length, and over-maximum bounds.<br>**R-14** Multilingual & Unicode text: Indic scripts, RTL, emoji, NFC normalization, case-insensitive uniqueness.<br>**R-15** Phone, email, tax IDs: duplicate detection across formatting variants.<br>**R-16** Cursor pagination: 0 items, 1 item, exact page size, deletion during paging, deterministic sort ties.<br>**R-17** Large payloads: maximal line items, batch catalog processing.<br>**R-18** Legacy data backward compatibility and migration fallbacks. |
| **Time & Calendar** | **R-19** Tenant timezone conversion vs UTC server time; midnight boundary transitions.<br>**R-20** Month-end, leap year, financial year start (April for India), 31st recurrences.<br>**R-21** Backdated and future-dated transaction entries; closed accounting periods. |
| **Money & Inventory** | **R-22** Half-up money rounding, tax-inclusive vs exclusive calculation order, discount precedence.<br>**R-23** Zero, negative, and fractional inventory quantities, base unit conversions.<br>**R-24** Partial payments, overpayments, credit notes, split tenders, advances.<br>**R-25** Multi-stage returns, discounted item returns, tax refund reversals.<br>**R-26** Landed cost distribution and Weighted Average Cost (WAC) recalculation.<br>**R-27** Currency decimal precision (e.g. 2 for INR/USD, 3 for OMR/BHD). |
| **Permissions & Auth** | **R-28** Real-time role/permission revocation, token invalidation, deactivated employee lockouts.<br>**R-29** Subscription plan limits reached, downgrade restrictions, tenant suspension.<br>**R-30** Organization ownership transfer, last owner preservation, Super Admin tenant prohibition.<br>**R-31** Branch-level access isolation (cross-branch operational fences).<br>**R-32** Deletion with relational dependents, soft delete vs hard purge. |
| **Security & Privacy** | **R-33** Cross-tenant injection, unauthorized ID tampering, collection-group leakage.<br>**R-34** Path traversal (\`..\`), prototype pollution (\`__proto__\`), server field mass-assignment.<br>**R-35** Rate limiting and denial-of-service query floods.<br>**R-36** Sensitive field leakage (passwords, tokens, PAN, bank accounts) in responses or logs. |
| **Platform & Media** | **R-37** App Check verification, untrusted \`_meta\`, device fingerprint binding.<br>**R-38** Stale mobile client against upgraded backend API.<br>**R-39** Image security: magic-byte validation, EXIF stripping, dimension limits, decomp bomb guard.<br>**R-40** Report generation: empty datasets, boundary alignment, cached summary reconciliation. |

