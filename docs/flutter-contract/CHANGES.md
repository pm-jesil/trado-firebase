# Backend Contract Changes (Prompts 60–69)

1. **Unified Response Convention (D-18):**
   - Single entities returned under entity key (`customer`, `bill`, etc.).
   - Lists returned under `items: [...]` with `count`, `nextCursor`, and `included`.
2. **Purchase vs Expense Entity Distinction (Prompt 69 A-3):**
   - `outflows` collection now cleanly distinguishes `purchase` vs `expense` in activity logs and audit trails.
3. **ImageRef Migration (D-5, D-15):**
   - `photoUrl` and `avatarUrl` removed; replaced by `image` (`ImageRef`).
4. **Operation & Status Tracking in Audit Logs (Prompt 69 A-2, A-4, A-5):**
   - Activity log rows now return explicit `operation` (`create`, `update`, `delete`, `status_change`), `humanLabel`, `statusBefore`, and `statusAfter`.
5. **Subscription Limits & Quota Warnings (Prompt 69 G3):**
   - Support for `hard_block` and `warn_only` policies with `USAGE_LIMIT_EXCEEDED` stable reason.
6. **Requests & Support Desk Module (Prompt 74, D-36..D-45):**
   - 15 request categories across 7 groups with designated approval/work state machines.
   - 16 new Cloud Function callables across requester operations and platform Super Admin inbox.
   - Atomic state transitions (`requestsTransition`) with compare-and-set on `expectedStatus`.
   - Internal notes strictly stripped for tenant audience (`visibility: "internal"`).
   - Automated plan change apply engine with usage/branch/user blocker evaluation.
   - Event trigger `onRequestActivityWritten` with idempotent notification dispatch.
   - Scheduled SLA and lifecycle sweep (`requestsSlaAndLifecycleSweep`).
