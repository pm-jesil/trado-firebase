# Trado Architecture Overview

This document defines the permanent technical architecture of the Trado Firebase backend. Trado is a multi-tenant SaaS ERP, point-of-sale (POS), inventory, and business management platform designed for wholesale and retail merchants. It features a Flutter mobile/desktop/web client and a Google Cloud Functions (Gen 2) serverless backend powered by Cloud Firestore, Firebase Authentication, and Cloud Storage.

---

## 1. Multi-Tenant & Multi-Branch Hierarchy

Trado models businesses using a hierarchical two-tier tenancy and location architecture:

```
Tenant Boundary: organizations/{organizationId}
   │
   ├── Subcollection: branches/{branchId}
   │     ├── main-branch (Default location)
   │     └── branch-north, branch-south, etc. (Secondary locations)
   │
   └── Tenant Collections:
         ├── memberships/{membershipId} (Staff profiles)
         ├── roles/{roleId} (Tenant RBAC roles)
         ├── products/{productId} (Shared catalog definition)
         ├── bills/{billId} (Sales invoices, quotations, orders)
         ├── outflows/{outflowId} (Purchases and expenses)
         └── tasks/{taskId} (Operational staff assignments)
```

### Hierarchy Rules & Constraints

1. **Organization as Tenant Boundary (`organizations/{organizationId}`)**:
   - The Organization is the top-level tenant account and legal business entity.
   - All billing subscription plans, tenant-level module toggles, and legal tax configurations attach to the Organization.
   - Cross-organization data access is strictly forbidden at both Cloud Functions callable authorization and Firestore Security Rules.

2. **Branch as Operating Location (`organizations/{organizationId}/branches/{branchId}`)**:
   - Branches represent physical operating locations (stores, warehouses, depots).
   - Every Organization initializes with exactly one canonical default branch whose ID is `main-branch`.
   - Secondary branches are provisioned under the same Organization subject to subscription plan branch capacity limits (`branchLimit`).
   - Branch codes are unique within the tenant via distributed unique lock documents (`branchCodeLocks/{organizationId}_{branchCode}`).

3. **Staff Branch Assignment (`membershipBranches/{membershipId}_{branchId}`)**:
   - Staff members belong to the Organization via `memberships/{membershipId}`.
   - Staff access to operating branches is managed via the normalized join collection `membershipBranches`.
   - Staff can have a canonical `primaryBranchId` and optional branch-specific role/capability overrides.
   - Branch context switching is performed via `branchContextSwitch` callable, updating the user's active session without duplicating profile data.

4. **Catalog Sharing vs. Physical Stock Isolation**:
   - **Product Definitions (`products`)**: Shared across all branches within the tenant. A single master SKU, barcode, category, name, and base unit price is maintained per tenant.
   - **Physical Inventory (`stockBalances`)**: Strictly isolated per branch. Stock balances are partitioned by document ID: `${organizationId}_${branchId}_${productId}`.
   - Intake or sales at Branch A increment or decrement Branch A's stock balance only. Secondary branches initialize at 0 stock, preventing accidental aggregate stock inheritance.
   - Product aggregate `currentStock` maintains the tenant-wide sum of physical branch balances.

5. **Customer & Vendor Visibility Policies**:
   - Customers and vendors support granular branch sharing via `visibilityScope`:
     - `all_branches`: Accessible by all branches across the tenant.
     - `selected_branches`: Accessible only by branches enumerated in `sharedForBranchIds`.
     - `branch_only`: Strictly restricted to the originating branch.

---

## 2. Four-Layer Permission Model (RBAC + ABAC)

Access control is resolved dynamically via a deterministic 4-layer evaluation engine (`permissionResolver.ts`):

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Subscription Plan Feature Flags                   │
│  (subscriptionPlans.moduleFlags)                            │
│  → If module disabled by plan, access is DENIED             │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Tenant Module Toggles                             │
│  (organizations.moduleToggles)                              │
│  → If module disabled by merchant, access is DENIED         │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Base Role Permissions                             │
│  (roles.permissions - e.g. "bill:create", "stock:adjust")   │
│  → Wildcards supported: "*", "bill:*", "report:*"          │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Membership Capability Overrides                   │
│  (memberships.permissions)                                  │
│  → Explicit true grants extra permission                    │
│  → Explicit false STRICTLY DENIES permission (precedence)   │
└─────────────────────────────────────────────────────────────┘
```

### Precedence Rules

- **Platform Super Admin (`isSuperAdmin: true`)**: Bypasses tenant rules for cross-tenant system maintenance and platform-level usage metering. Cannot perform merchant business actions unless explicitly impersonating.
- **Tenant Owner (`isPrimary: true` or `role: "owner"`)**: Possesses all permissions across all active modules within their organization.
- **Strict Deny Precedence**: An explicit `false` in Layer 4 overrides any grant from Layer 3 or wildcards.
- **Branch-Specific Overrides**: When operating in a branch context, `membershipBranches.permissions` can apply further restrictions specific to that physical branch.

---

## 3. Standing Architectural Principle: Reference-by-ID

To prevent data drift, stale caches, and inconsistent state across collections, Trado strictly enforces the **Anti-Embedding / Reference-by-ID Principle**:

1. **Bare IDs for Relationships**:
   - Foreign document references must store the document ID string only.
   - Example: A delivery stores `billId` and `riderMembershipId`, never the bill document or rider user profile.
   - Example: A stock movement stores `productId` and `referenceId`, never product details.
   - Example: A team stores `organizationId` and `name`, never a `members: []` array. Staff membership in a team is queried canonically via `memberships.where("teamId", "==", teamId)`.

2. **Justified Display Snapshots (`...Snapshot`)**:
   - Embedded sub-objects are strictly prohibited unless they represent an immutable point-in-time snapshot required for legal billing, tax audit, or offline optimistic display.
   - Every snapshot field must explicitly end with the suffix `Snapshot`:
     - `BillDoc.customerSnapshot`: Captures customer name and phone at the exact moment of invoice generation for tax compliance and immutable PDF printing.
     - `BillDoc.taxSnapshot` / `OutflowDoc.taxSnapshot`: Freezes applied tax rates (CGST, SGST, IGST, VAT) so subsequent tax rate changes never alter historical invoices.
   - Full entity document dumps are strictly forbidden in snapshots.

3. **Automated Structural Enforcement**:
   - Static analysis tool `scripts/check-duplicate-embedding.js` parses AST/type definitions and source code to reject forbidden embeds in CI/CD before code can merge.

---

## 4. Decimal-Safe Precision & Costing Engine

### Money & Precision Standards (`services/money.ts`)

JavaScript floating-point arithmetic (`0.1 + 0.2 !== 0.3`) is strictly mitigated across all financial calculations:
- **Financial Amounts (Totals, Payments, Taxes, Discounts)**: Standard 2 decimal places (or ISO 4217 minor unit exponent for 3-decimal currencies like BHD/KWD/OMR, 0-decimal currencies like JPY/KRW).
- **Unit Rates & Cost Prices**: Maintained to 4 decimal places to prevent rounding drift on fractional items (e.g. bulk grain by kg or fabric by meter).
- **Commercial Rounding**: Half-away-from-zero rounding using `Number.EPSILON` (`Math.round((value + Number.EPSILON) * factor) / factor`).

### Weighted-Average Costing (WAC) Engine (`services/costingEngine.ts`)

Trado uses perpetual Weighted-Average Costing for inventory valuation and Cost of Goods Sold (COGS) reporting:

$$\text{New WAC} = \frac{(\text{Current Stock} \times \text{Current WAC}) + (\text{Incoming Qty} \times \text{Purchase Rate})}{\text{Current Stock} + \text{Incoming Qty}}$$

- Updated automatically on confirmed purchase outflows (`onOutflowWritten`).
- Cost of Goods Sold (COGS) is computed at bill generation using the product's effective WAC.
- Profit & Loss reports compute Gross Profit as $\text{Total Revenue} - \text{COGS}$.

---

## 5. Idempotency & Concurrency Design

All state-mutating HTTPS Callables implement robust idempotency and concurrency guards:

1. **Idempotency Leases (`services/idempotency.ts`)**:
   - Clients supply an optional or mandatory `idempotencyKey` UUID with write requests.
   - Keys are recorded in `idempotencyRecords` with a 120-second lease window.
   - Duplicate concurrent requests fail-closed with `ALREADY_PROCESSING`.
   - Completed operations store response hashes and cached responses for identical replay without re-executing transactions.

2. **Document Numbering Counters (`documentCounters`)**:
   - Sequential human-readable numbers (e.g. `INV-2026-000001`, `PUR-2026-000001`) are reserved inside Firestore transactions.
   - Number reservation occurs during the transactional read phase; commits occur in the write phase.

3. **Distributed Uniqueness Locks**:
   - `branchCodeLocks/{organizationId}_{branchCode}`: Guarantees unique branch codes within a tenant under high-concurrency creation.
   - `barcodeLocks/{organizationId}_{barcode}`: Guarantees global uniqueness for product barcodes within a tenant catalog.

---

## 6. Offline-First Client Sync Contract

Trado's backend is designed to support Flutter mobile and desktop clients operating in intermittent connectivity:
- **Client Queue**: The Flutter app records transactions into a local SQLite queue and assigns client-generated UUID `idempotencyKey` values.
- **Backend Idempotency Replay**: When the network reconnects, retried submissions reuse the same `idempotencyKey`. The backend detects already-processed transactions and returns the saved result without double-deducting stock or double-booking ledger entries.
- **Optimistic Display**: Document list responses return lean payloads with display snapshots (`customerSnapshot`, `nameSnapshot`), allowing the client to render complete invoices without foreign entity round-trips.
- **Client Responsibility**: The client application is responsible for local caching, background sync daemon management, and conflict retry logic. The backend provides the idempotent API contract.

