# Trado Architectural Decisions Log

This document records the foundational product and technical architecture decisions made during the design and implementation of the Trado Firebase backend. It provides permanent context for why specific patterns were chosen.

---

## Decision 1: Branch Architecture — Option B (Subcollection Model)

- **Date**: Confirmed Final Architecture
- **Decision**: Organizations contain physical branches as a Firestore subcollection: `organizations/{organizationId}/branches/{branchId}`. The default canonical branch is always `main-branch`.
- **Alternatives Considered**: Option A (each branch as a separate Organization document).
- **Rationale**:
  - A merchant operates as one legal corporate entity with unified billing, one subscription plan, and unified tax registration.
  - Multi-location merchants need shared catalog definitions, centralized employee directories, and cross-branch sales analytics without managing multiple independent tenant accounts.
  - Option B provides clean Firestore path hierarchy (`organizations/{orgId}/branches/{branchId}`) while maintaining physical inventory isolation.

---

## Decision 2: Inventory Architecture — Catalog Sharing vs. Physical Stock Isolation

- **Date**: Confirmed Final Architecture
- **Decision**: Product definitions (`products`) are shared tenant-wide, while physical stock balances (`stockBalances`) are strictly isolated per branch.
- **Data Model**:
  - Master product: `products/{productId}` (name, SKU, barcode, unit, sellingPrice, aggregate `currentStock`).
  - Branch physical stock: `stockBalances/{orgId}_{branchId}_{productId}` (`currentStock`, `lowStockThreshold`).
- **Rationale**:
  - A retailer selling "Basmati Rice 10kg" across 5 stores has one catalog entry, but store A may have 20 bags while store B has 0.
  - Secondary branches initialize at 0 stock on creation, preventing accidental aggregate stock inheritance.
  - Stock movements (`stockMovements`) audit every physical stock increment or decrement with branch attribution.

---

## Decision 3: Staff Branch Assignment — Normalized Join Collection (`membershipBranches`)

- **Date**: Confirmed Final Architecture
- **Decision**: Staff access to branches is modeled via a standalone join collection: `membershipBranches/{membershipId}_{branchId}`.
- **Alternatives Considered**: Storing an array of branch IDs on `memberships` or storing an array of member IDs on `branches`.
- **Rationale**:
  - Embedding arrays violates the standing anti-embedding principle and creates race conditions when multiple managers assign staff concurrently.
  - `membershipBranches` allows storing branch-specific metadata (e.g. branch-specific roles, temporary assignments, branch permission overrides) without mutating the core membership profile.

---

## Decision 4: Financial Costing Engine — Perpetual Weighted-Average Cost (WAC)

- **Date**: Confirmed Final Architecture
- **Decision**: Inventory valuation and Cost of Goods Sold (COGS) are calculated using perpetual Weighted-Average Costing.
- **Alternatives Considered**: First-In-First-Out (FIFO) or standard fixed cost price.
- **Rationale**:
  - In wholesale and grocery environments, stock batches arrive at varying purchase prices throughout the month.
  - WAC automatically smooths price fluctuations and provides accurate, continuous margin tracking without requiring complex FIFO lot-queue tracking in Firestore transactions.

---

## Decision 5: Decimal Precision & Float Drift Mitigation

- **Date**: Confirmed Final Architecture
- **Decision**: All financial operations use commercial rounding with `Number.EPSILON` (`services/money.ts`). Monetary amounts are stored to 2 decimals; unit rates and WAC costing are stored to 4 decimals.
- **Rationale**:
  - JavaScript IEEE 754 floating-point numbers produce fractional inaccuracies (e.g. `0.1 + 0.2 = 0.30000000000000004`).
  - Enforcing 2-decimal financial values with 4-decimal rate precision prevents rounding accumulation errors across large invoices or high-volume item orders.

---

## Decision 6: Standing Anti-Embedding Principle

- **Date**: Confirmed Final Architecture
- **Decision**: No document embeds another foreign entity document. Every relationship is modeled as a bare ID reference.
- **Exception**: Display snapshots ending with `...Snapshot` (e.g. `customerSnapshot`, `taxSnapshot`) are permitted solely for immutable invoice rendering and legal tax audit.
- **Rationale**:
  - Embedding full user or customer records leads to stale data drift (e.g. customer updates phone number, but old bills show old phone or duplicate writes fail halfway).
  - Referenced entities remain single sources of truth.

---

## Decision 7: Live Location Tracking — Dual-Collection & 7-Day TTL

- **Date**: Confirmed Final Architecture
- **Decision**: Location tracking uses a dual-collection design:
  - `latestLocations/{orgId}_{membershipId}`: Current real-time position for dispatch dashboards (overwritten on each ping).
  - `locationPings/{orgId}_{membershipId}_{timestamp}`: Ephemeral breadcrumb trail with 7-day retention.
- **Rationale**:
  - Dispatch operators query single documents for staff positions without scanning historical trails.
  - Historical trail pings expire automatically after 7 days via Firestore TTL, eliminating database bloat and operational storage costs.
  - Mandatory consent flag (`locationTrackingEnabled`) and 5-second rate-limiting prevent unauthorized battery and quota consumption.

---

## Decision 8: Subscription Capacity — Branch Limit Enforcement (`branchLimit`)

- **Date**: Confirmed Final Architecture
- **Decision**: Subscription plans enforce strict branch quotas via `branchLimit`. Creation, reactivation, and deactivation run inside transactional capacity checks.
- **Downgrade Policy**: If an organization downgrades to a plan with fewer branches than currently active, existing branches are grandfathered into read-only access (no automated deletion), and new branch provisioning is blocked until capacity is freed.

---

## Decision 9: Usage Metering — Internal Diagnostic Telemetry (Never Automated Billing)

- **Date**: Confirmed Final Architecture
- **Decision**: Usage metering (`usageRecordMetric`, `usageCalculateDryRunStatement`) is strictly an internal diagnostic telemetry system for Super Admins to monitor tenant resource consumption.
- **Legal Guarantee**: Generated dry-run usage statements are non-binding diagnostic estimates of infrastructure utilization. Every generated statement includes an explicit legal disclaimer confirming it is NOT an invoice and no automated charge has occurred.

