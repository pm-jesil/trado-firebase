# Open Questions & Business Decision Register (Appendix B)

Questions raised when business semantics require owner clarification. Answered questions move to `docs/decisions/decision-register.md`.

| Q-ID | Title | Status | Blocks | Affects | Recommended Default |
|---|---|---|---|---|---|
| **Q-1** | Update concurrency precondition policy | `OPEN` | U-7, R-03 | Mutation Callables | Option A: version / `updatedAt` precondition on all shared docs |
| **Q-2** | Status state machines and allowed transitions | `OPEN` | U-6, R-06 | State Transitions | Confirm derived status transition matrix |
| **Q-3** | Closed financial periods & backdating locks | `OPEN` | R-20, R-21 | Invoicing & Reporting | Option A now (unlocked), Option B later (lock date) |
| **Q-4** | Money storage minor units & tax regimes | `OPEN` | R-22, B.7 | Money Engine | Integer paise/cents, single-currency per org, India GST |
| **Q-5** | Mutation testing score threshold | `OPEN` | T.1, Z5 | Pure-Logic Testing | Threshold ≥ 80% on pure-logic modules |
| **Q-6** | Verification enforcement outside agent turns | `OPEN` | Z4 | Tooling & CI | Both Claude hook and pre-commit step |
| **Q-7** | External rules consolidation | `OPEN` | C.1 | Rules Sync | Request owner to paste any external instructions |
| **Q-8** | End-to-end user flow catalog confirmation | `OPEN` | T.2, Z-14 | User Flow Testing | Confirm 12 core flows in `docs/testing/flows.md` |
| **Q-RQ1** | Request audiences (platform vs organization) | `RESOLVED` | RB2, RB3 | Requests Data Model | ACCEPT (both platform and organization audiences) (A-06) |
| **Q-RQ2** | 15-category taxonomy | `RESOLVED` | RB2, RB3 | Requests Schemas | ACCEPT (15 categories in 7 groups per Appendix A) (A-07) |
| **Q-RQ3** | Two-step apply for approved changes | `RESOLVED` | RB4 | Requests Apply Logic | ACCEPT (approved -> applied 2nd step) (A-08) |
| **Q-RQ4** | Tenant plan prices visibility | `RESOLVED` | RB3, RB6 | Plan Catalog | ACCEPT (show prices only if `showPriceToTenants` true) (A-09) |
| **Q-RQ5** | SLA targets & pause states | `RESOLVED` | RB4, RB5 | SLA Engine | ACCEPT (calendar hours IST, paused in needs_info/on_hold) (A-10) |
| **Q-RQ6** | Attachment types and limits | `RESOLVED` | RB2, RB3 | Storage & Attachments | ACCEPT (images + PDF, max 5 per request, 5MB each) (A-11) |
| **Q-RQ8** | Request retention policy | `RESOLVED` | RB5 | Lifecycle & Retention | ACCEPT (5 years post-closure) (A-12) |
| **Q-RQ9** | Platform request handling roles | `RESOLVED` | RB4 | Platform Inbox & RBAC | ACCEPT (Super Admin only now, support agent designed) (A-13) |
| **Q-RQ10** | Request rate and volume limits | `RESOLVED` | RB3 | Abuse Prevention | ACCEPT (10 open/user, 50/org, 10/hr, 1 plan_change/org) (A-14) |
| **Q-RQ11** | Bug report diagnostics opt-in | `RESOLVED` | RB3 | Bug Reports | ACCEPT (diagnostics require explicit user opt-in) (A-15) |
| **Q-RQ12** | Existing orgs permission migration | `RESOLVED` | RB6 | Database Migration | ACCEPT (idempotent migration to system roles) (A-16) |
| **Q-RQ13** | Dark launch feature flag | `RESOLVED` | RB3, RB4 | Feature Gate | ACCEPT (`requestsEnabled = false` default) (A-17) |

---

### Q-1 · Update Concurrency Precondition · blocks: U-7, R-03 | affects: Mutation Callables
- **Found:** `functions/src/callables/` handlers currently perform writes without an explicit version check or precondition on all entities.
- **Question:** When two users edit the same document, what concurrency model is required?
- **Options:**
  - **A)** Enforce a version / `updatedAt` precondition on **all** updates of shared business documents (stale write → stable reason `STALE_WRITE`), with last-write-wins permitted only for a user's own profile preferences.
  - **B)** Precondition only for money, stock, and permission documents; last-write-wins for master data.
  - **C)** Last-write-wins everywhere.
- **Recommended:** **A**, because silent lost updates in multi-tenant collaborative billing and inventory lead to data corruption.
- **If wrong:** Stale writes could fail unexpectedly if client lacks optimistic concurrency handling; reversible by adjusting middleware.
- **Meanwhile:** U-7 marked `BLOCKED-ON Q-1`; continuing other unblocked units.

---

### Q-2 · Status State Machine Transitions · blocks: U-6, R-06 | affects: Lifecycle Callables
- **Found:** Multiple entities have implicit or semi-explicit transitions across handlers.
- **Question:** Confirm the derived lifecycle status state machine:
  - `bills`: `draft` → `issued` / `finalized` → `paid` / `voided`
  - `outflows`: `pending` → `confirmed` → `voided`
  - `payments`: `pending` → `completed` → `voided` / `failed` (cheques: `cleared` / `bounced`)
  - `deliveries`: `pending` → `assigned` → `in_transit` → `delivered` / `failed` / `cancelled`
  - `returns`: `pending` → `completed` / `rejected`
  - `tasks`: `todo` → `in_progress` → `completed` / `cancelled`
  - `memberships`: `active` → `deactivated`
  - `organizations`: `active` → `deactivated` → `reactivated` / `suspended`
- **Options:** Confirm derived table, or specify corrections for terminal / intermediate states.
- **Recommended:** Confirm derived transitions; terminal states (`voided`, `completed`, `cancelled`) are strictly immutable.
- **If wrong:** Reversible by updating transition tables in schemas and handlers.
- **Meanwhile:** U-6 marked `BLOCKED-ON Q-2`.

---

### Q-3 · Closed Financial Periods · blocks: R-20, R-21 | affects: Invoicing & Reporting
- **Found:** Backdated transactions are permitted if within current schema date ranges; no fiscal period locking is enforced.
- **Question:** Must edits or backdating be blocked after a fiscal period or financial-year close?
- **Options:**
  - **A)** Not needed yet for early release.
  - **B)** Enforce a lock date per organization (`lockDate`: transactions before this date rejected with `PERIOD_CLOSED`).
- **Recommended:** **A now, B later** (record lockDate support in schema for future activation).
- **If wrong:** Organizations might record historical transactions in closed books.
- **Meanwhile:** Backdated tests verify timestamp boundaries without hard block.

---

### Q-4 · Money Storage Precision & Tax Regimes · blocks: R-22, B.7 | affects: Pricing & Tax
- **Found:** The codebase stores monetary values in integer paise / cents (minor units, D-19). Tax calculations in `reportsGetTax` and `billsCreate` support Indian GST (CGST, SGST, IGST).
- **Question:** Confirm that money is strictly stored as integer minor units (paise/cents), single-currency per organization, with India GST regime as primary in scope.
- **Options:**
  - **A)** Confirm: Integer paise, single-currency per org, India GST in scope.
  - **B)** Multi-currency support required immediately.
- **Recommended:** **A**, consistent with D-19 and existing models.
- **If wrong:** Migration needed if decimal floats are desired (highly discouraged for billing).
- **Meanwhile:** All tests and assertions use integer paise.

---

### Q-5 · Mutation Testing Threshold · blocks: T.1, Z5 | affects: Logic Verification
- **Found:** Test suite contains unit and behavioral tests; mutation testing is required on pure-logic modules (`money.ts`, `tax.ts`, `costing.ts`, `permissions.ts`).
- **Question:** What mutation-testing score threshold should be enforced?
- **Options:** ≥ 70%, ≥ 80%, ≥ 90%.
- **Recommended:** **≥ 80%**, balancing verification rigor with execution speed.
- **Meanwhile:** Running mutation tests on pure-logic modules against 80% target.

---

### Q-6 · Verification Enforcement Outside Agent · blocks: Z4 | affects: CI & Tooling
- **Found:** Antigravity and Claude Code can enforce standing rules during agent sessions, but external human/CLI edits could bypass checks.
- **Question:** How should verification guards be enforced outside agent turns?
- **Options:**
  - **A)** Claude Code hook that runs `verify:plan` + `verify:coupling` after edits.
  - **B)** Git pre-commit hook script prepared for the owner to install.
  - **Both** Claude hook and Git pre-commit script.
- **Recommended:** **Both**.
- **Meanwhile:** Preparing tracked pre-commit hook and Claude hook configs without altering git state.

---

### Q-7 · External Standing Rules Consolidation · blocks: C.1 | affects: Rules Sync
- **Found:** Repository root contains `AGENTS.md` and `CLAUDE.md`.
- **Question:** Are there standing rules or instructions maintained in external agent configurations (e.g., `claude.ai` project instructions, Antigravity global instructions, personal notes) that must be merged?
- **Options:** Owner to paste or indicate none.
- **Recommended:** Consolidate any external instructions into `AGENTS.md`.
- **Meanwhile:** Repository `AGENTS.md` remains canonical.

---

### Q-8 · Flow Catalog Scope Confirmation · blocks: T.2, Z-14 | affects: End-to-End Testing
- **Found:** `docs/testing/flows.md` defines 12 core end-to-end commercial flows covering 100% of HTTPS callables (134/134).
- **Question:** Does the 12-flow catalog cover all intended commercial journeys, or should additional flows (consignment, loyalty points, branch inventory transfer) be added?
- **Options:**
  - **A)** Confirm the 12 flows as the canonical set for core ERP/POS.
  - **B)** Extend with secondary flows now.
- **Recommended:** **A** (confirm the 12 core flows; secondary extensions tracked for subsequent release).
- **Meanwhile:** 12 core flows are mapped to verified behavioral test suites.
