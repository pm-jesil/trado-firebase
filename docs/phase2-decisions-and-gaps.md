# Trado Firebase Backend — Phase 2 Decisions, Architectural Rationale & Gap Verification

## 1. Architectural Decisions & Domain Baseline

### 1.1 Stock-Read Strategy Decision: Option (a) Maintained `currentStock` Field
* **Chosen Approach**: Option (a) — Maintain a real-time `currentStock` balance directly on each product document (`products/{productId}`), updated within atomic Firestore transactions alongside an immutable ledger record in `stockMovements`.
* **Rationale**:
  1. *POS Checkout Latency*: Point-of-Sale terminals and mobile sales apps require sub-100ms item lookups. Reading a single product document provides price, tax code, and current stock in a single document read without aggregating thousands of historical movement documents.
  2. *Deterministic Precondition Checks*: Enforcing `trackStock && newStock >= 0` requires a guaranteed atomic lock on the current balance during cart checkout.
* **Concurrency & Race Condition Handling**:
  - All stock modifications (intakes, sales, returns, adjustments) execute within `db.runTransaction()`.
  - Transaction architecture strictly follows two-phase execution: `prepareStockChangesInTxn` executes all `txn.get()` reads first, validates stock sufficiency, and precomputes updates. `commitStockChangesInTxn` executes all `txn.update()` and `txn.set()` mutations second.
  - Transactions auto-retry up to 5 times under concurrent contention.
* **Upgrade Path to Option (b) Distributed Counters**:
  - Firestore document writes are limited to ~1 write per second per document. For high-volume retail locations where a single SKU experiences hundreds of transactions per minute, a distributed counter subcollection (`products/{productId}/stockShards/{shardId}`) or Redis/MemoryStore cache will serve as the future upgrade path in Phase 3.

---

### 1.2 Canonical Expiry Field Resolution: `hasExpiry`
* **Finding**: Direct inspection of the legacy NestJS source repository (`testing-trado-api/src/database/schemas/item.schema.ts`) confirmed that the canonical property name is **`hasExpiry: boolean`** (default `false`).
* **Resolution**: Standardized on `hasExpiry` across all Zod validation schemas, TypeScript interfaces (`ProductDoc`), callable handlers, test fixtures, and documentation. The speculative name `isExpiry` was rejected.

---

### 1.3 Delivery Address Snapshot vs Foreign Reference
* **Decision**: Deliveries reference `billId` strictly by ID (`billId: string`) and store a lean destination delivery `address` value object directly on the delivery document.
* **Anti-Embedding Discipline**:
  - The delivery document NEVER embeds the parent `bill` document or its line `items`.
  - The destination address is snapshotted as a value object `{ line1, line2, city, pincode, landmark }` rather than querying a mutable customer address. This guarantees historical delivery integrity even if the customer updates their profile address in the future.

---

### 1.4 Unified Outflow Model Rationale
* **Decision**: Single collection `outflows` handling both inventory purchases (`kind: "purchase"`) and operational expenses (`kind: "expense"`).
* **Rationale**:
  1. *Unified Cash Flow & AP Reporting*: Both purchases and expenses represent money leaving the business, reducing accounts payable and cash balances. Consolidating them enables single-query cash-flow aggregation and vendor ledger reconciliation.
  2. *Shared Financial Subsystems*: Both require payment vouchers (`payments`), frozen tax snapshots (`TaxSnapshot`), sequential voucher numbering (`PUR-` vs `EXP-`), and payment status tracking (`paid`, `partial`, `pending`).
  3. *Operational Distinction*: Purchases require linked catalog items with `addToStock: true` to trigger automatic inventory intake; operational expenses have no inventory side-effects.

---

### 1.5 Shared Sales/Billing Engine (POS vs B2B Wholesale)
* **Decision**: Single collection `bills` powering both retail POS transactions and wholesale B2B invoices, differentiated by `salesMode: "pos" | "b2b_wholesale"`.
* **Rationale**:
  - Eliminates code duplication across line-item calculation, round-off rounding, multi-regime tax calculation, stock decrementing, and payment recording.
  - POS sales default to instant settlement (`paymentStatus: "paid"`) with cashier context; B2B sales support credit terms (`dueDate`, `balanceAmount`, `paymentStatus: "pending"`).

---

## 2. Targeted Gap Verification & Remediation Report (8-Part Gate)

### Part 1 — The Branch-Support Gate: Architectural Analysis & Open Business Decision
* **Status**: **OPEN — USER CONFIRMATION REQUIRED**
* **Comprehensive Investigation Across All Legacy Sources**:
  1. *NestJS Backend (`testing-trado-api`)*:
     - `src/database/schemas/item.schema.ts` (lines 58-62):
       ```ts
       @Prop({ required: true, default: 0 })
       currentStock: number;
       @Prop({ required: true, default: false })
       trackStock: boolean;
       ```
       *(Confirmed: zero `branchId`, `branch`, or `locationId` properties on Item/Product documents).*
     - `src/database/schemas/stock-movement.schema.ts` (lines 14-22):
       ```ts
       @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
       organization: Types.ObjectId;
       @Prop({ type: Types.ObjectId, ref: 'Item', required: true, index: true })
       item: Types.ObjectId;
       ```
       *(Confirmed: movements link strictly to `organization` and `item`).*
     - `src/modules/reports/reports.controller.ts` (lines 347-365):
       ```ts
       @ApiOperation({
         summary: 'Global cross-organization revenue analytics (super_admin only)',
         description: 'Comparative revenue performance across all chain branches and outlets.',
       })
       // Example response:
       // [{ orgId: '...', orgName: 'The Shawarma Spot - Kochi', revenue: 45000 },
       //  { orgId: '...', orgName: 'The Shawarma Spot - Calicut', revenue: 38000 }]
       ```
       *(Confirmed: chain branches and outlets are modeled as distinct `Organization` records).*
     - `src/modules/users/users.integration.spec.ts` (lines 554-580):
       ```ts
       const orgB = await orgsService.create({ name: 'Secondary Branch Org', code: 'BRANCH-ORG-002' }, SUPER_ADMIN_ID);
       const multiAdmin = await usersService.createAdmin({
         name: 'Regional Manager Admin',
         organizations: [testOrg._id.toString(), orgB._id.toString()],
         primaryOrganization: testOrg._id.toString(),
       }, SUPER_ADMIN_ID);
       ```
       *(Confirmed: 'Secondary Branch Org' exercises multi-tenant organization creation where one user has multiple memberships across independent orgs; it does NOT exercise shared stock or sub-branch inventories).*
  2. *Flutter Mobile Client (`testing-trado-mob`)*:
     - `lib/features/super_admin/screens/organizations_list_screen.dart` (line 518):
       `'Are you sure you want to deactivate "$organizationName"? Local billing staff will no longer be able to access this outlet.'`
     - `lib/features/dashboard/presentation/screens/employee_dashboard_screen.dart` (line 579):
       `'${user?.jobRoleTitle ?? 'Staff'} • ${user?.organizationName ?? 'Branch Outlet'}'`
     - `lib/core/network/api_client.dart` (lines 196-198):
       `return 'Access restricted: You do not have access to this organization. Please switch to your assigned outlet.';`
  3. *Flutter Desktop/Web Client (`testing-trado`)*:
     - `lib/features/organization/widgets/organization_detail_sheet.dart` (line 706):
       `'Enterprise plan provides unlimited outlets, kitchen display tickets (KOT), custom tax regimes, and dedicated SLA.'`
     - `lib/features/dashboard/screens/org_owner_dashboard_content.dart` (line 788):
       `valueText: '$branchesCount / $maxBranches Locs'`

* **Answers to Core Architectural Questions**:
  1. *What positive evidence supports or contradicts branch support?*  
     Positive evidence proves that every physical retail store/outlet is represented as an independent `Organization` entity. Contradicting evidence shows there is NO sub-branch entity (`branches` collection or `branchId` field) in either backend schemas or client models.
  2. *Does the 'Secondary Branch Org' fixture exercise branch-specific behavior?*  
     No. It exercises multi-tenant organization provisioning and multi-organization user assignment (`users.organizations = [orgA, orgB]`). There is no shared stock ledger, no cross-branch transfer, and no shared document sequence.
  3. *Does the legacy model clearly define a physical branch as a separate Organization, or is branch behavior simply absent/undecided?*  
     The legacy implementation strictly treated each outlet as an Organization. However, advanced enterprise chain features (e.g. centralized purchasing with inter-branch transfers, shared customer loyalty, and consolidated multi-outlet subscriptions) were left **absent / undecided** in legacy NestJS schemas.
  4. *What are the consequences for employee pools, subscriptions, stock, billing, permissions, reporting, and cross-location transfers?*
     - **Option A (Current Implementation: 1 Physical Location = 1 Organization Tenant)**:
       - *Stock*: Isolated per organization document (`currentStock` on `ProductDoc`). Zero cross-outlet stock contention.
       - *Employees*: Assigned to specific outlets via `memberships`. Roaming managers hold memberships in multiple orgs.
       - *Billing & Sequences*: Clean per-outlet sequence numbers (`INV-2026-000001`).
       - *Transfers*: Treated as inter-organization B2B transactions.
     - **Option B (Alternative: 1 Organization contains multiple Sub-Branches)**:
       - *Stock*: Requires composite `stockBalances/{orgId_branchId_productId}` sub-records and required `branchId` on all movements.
       - *Employees*: Requires branch-level scoping inside membership records.
       - *Billing*: Requires branch-prefixed sequences (`INV-BR1-2026-000001`).
       - *Impact*: Requires broad schema migrations across Phase 1 and Phase 2.

* **Decision Status**: **OPEN — USER CONFIRMATION REQUIRED**  
  The implementation currently maintains the clean, working single-organization stock assumption (Option A). The user must explicitly confirm whether Option A is accepted as final, or whether Option B should be designed. Architecture-dependent changes are paused pending user confirmation.

---

### Part 2 — Money & Quantity Decimal-Safe Arithmetic
* **Status**: **Fixed & Verified (Canonical `Money` service implemented)**
* **Finding**:
  - The legacy backend possessed a centralized financial precision library at `testing-trado-api/src/common/money/money.util.ts` providing commercial half-away-from-zero rounding with `Number.EPSILON`, unit rate rounding to 4 decimals (`round4`), quantity precision rounding (`roundQty`), and ISO 4217 minor-unit exponent handling for 3-decimal currencies (`BHD`, `KWD`, `OMR`, `JOD`, `TND`, `IQD`, `LYD`), 0-decimal currencies (`JPY`, `KRW`, `VND`), and 2-decimal default (`INR`, `USD`, `EUR`, `AED`).
  - The initial Phase 2 implementation used naive JavaScript float multiplication and `Math.round(x * 100) / 100`.
* **Fix Applied**:
  - Ported canonical utility to `functions/src/services/money.ts`.
  - Integrated `Money` across `outflows.ts`, `bills.ts`, and `stockEngine.ts`.
  - Added unit test suite `functions/src/test/unit/phase2Services.test.ts` verifying:
    1. 2-decimal currencies (`INR`, `USD`, `AED`) with exact commercial rounding.
    2. 3-decimal currencies (`BHD`, `KWD`, `OMR`) preserving the 3rd decimal place (fils) and minor unit conversion.
    3. 0-decimal currencies (`JPY`, `KRW`).
    4. Fractional quantity accumulation test: 1,000 sequential additions of `0.001 kg` yielding exactly `1.0 kg` with zero float drift.
    5. `extractTax` and `addTax` producing exact matching sums.

---

### Part 3 — Purchase Orders Workflow Resolution
* **Status**: **Confirmed Correct (Documented Legacy Finding)**
* **Investigation & Evidence**:
  - Searched legacy codebase for `purchaseOrder`, `purchase_order`, `PurchaseOrder`.
  - Inspected `testing-trado-api/src/modules/purchases/purchases.service.ts`:
    Line 327: `assertTenantEntity(this.expenseModel, id, orgId, 'Purchase order')`.
  - Purchases in the legacy system were stored directly in the `Expense` collection (`expense.schema.ts`), categorized with `kind: OutflowKind.PURCHASE`.
  - There was NO multi-stage Purchase Order lifecycle entity (`draft -> submitted -> approved -> received -> invoiced`). Procurement was recorded directly as purchase invoices/receipts that immediately triggered inward stock movement (`StockMovementType.PURCHASE`) and Accounts Payable records.
* **Conclusion**:
  - Our Firebase unified `outflows` collection (`kind: "purchase"` vs `kind: "expense"`) exactly mirrors the legacy system's production behavior. Formal multi-stage PO approvals are documented as a potential enterprise addition for Phase 3.

---

### Part 4 — Bill Lifecycle, Status & Quotation Stock Isolation
* **Status**: **Fixed & Verified (Quotation isolation & `billsFinalize` implemented)**
* **Finding**:
  - Quotations (`documentType: "quotation"`) and Draft bills (`status: "draft"`) must NOT decrement inventory stock or record tender payments upon creation.
  - Previously, `billsCreate` deducted stock regardless of document type.
* **Fix Applied**:
  - Updated `CreateBillSchema` to accept `documentType` (`DocumentType.INVOICE`, `QUOTATION`, `PROFORMA`, `SALES_ORDER`) and `status` (`draft` vs `active`).
  - In `billsCreate`: If `status === "draft"` or `documentType === "quotation"` or `"proforma"`, sequence prefix formats as `QTN-...` or `PRO-...`, physical stock is NOT decremented (`stockChangeItems = []`), and tender payments are suppressed.
  - Implemented `billsFinalize` callable (`functions/src/callables/bills.ts`): Transitions a quotation/draft to active invoice status, validates stock sufficiency, transactionally decrements inventory stock, and emits `stockMovements` records.
  - Added Integration Test #25 proving that creating a quotation generates `QTN-...` with 0 stock deductions, and finalizing via `billsFinalize` deducts stock and records the movement.

---

### Part 5 — Stock Movement Type Directional Ambiguity
* **Status**: **Fixed & Verified (Canonical enum aliases & signed validation)**
* **Finding**:
  - `RETURN_IN` and `RETURN_OUT` lacked explicit directional distinction between sales returns (stock returning to warehouse) and purchase returns (stock leaving warehouse back to vendor).
* **Fix Applied**:
  - Updated `StockMovementType` enum in `functions/src/constants/enums.ts`:
    - Added `SALE_RETURN_IN = "sale_return_in"`
    - Added `PURCHASE_RETURN_OUT = "purchase_return_out"`
    - Retained `RETURN_IN` and `RETURN_OUT` as backward-compatible aliases.
  - Updated `returns.ts` to explicitly assign `SALE_RETURN_IN` for sales returns and `PURCHASE_RETURN_OUT` for purchase returns.
  - In `stockEngine.ts`: Added runtime directional validation:
    - Inward types (`PURCHASE_IN`, `SALE_RETURN_IN`, `RETURN_IN`, `ADJUSTMENT_IN`) throw `invalid-argument` if quantity is not positive (`> 0`).
    - Outward types (`SALE_OUT`, `PURCHASE_RETURN_OUT`, `RETURN_OUT`, `DAMAGE_OUT`, `ADJUSTMENT_OUT`) throw `invalid-argument` if quantity is not negative (`< 0`).

---

### Part 6 — Ledger & Stock Reconciliation Tooling
* **Status**: **Fixed & Verified (Automated reconciliation service & callables)**
* **Implementation**:
  - Created `functions/src/services/reconciliation.ts`:
    1. `reconcileStock(orgId, productId?, repair?)`: Sums all historical `stockMovements.quantity` for each product and verifies exact equality against `product.currentStock`. Reports any discrepancies and supports automatic transactional repair.
    2. `reconcilePartyBalances(orgId, partyType, partyId?)`: Aggregates all bills, outflows, and payments for customers and vendors, verifying `outstandingBalance`, `outstandingPayable`, `totalSpend`, and `totalPurchase`.
  - Created callables `reconcileStockBalances` and `reconcilePartyLedgers` in `functions/src/callables/reconciliation.ts`.
  - Added Integration Test #26 verifying that running the reconciliation tooling against the active test tenant reports `discrepancyCount: 0` across all products and party ledgers.

---

### Part 7 — Phase 1 & 2 Regression Suite Rerun
* **Status**: **Confirmed Correct (All tests passing cleanly)**
* **Test Verification Summary**:
  - **Unit Tests**: `npm run test:unit --prefix functions`
    - **43/43 tests passing** across 11 suites (Claims, Compensation, Multi-Org Deactivation, Idempotency, Permissions, Tax, Counters, Stock, Money & Precision, Seed Safety).
  - **Security Rules**: `firebase emulators:exec --only firestore,storage "npm run test:rules --prefix functions"`
    - **14/14 tests passing** across 2 suites (8 Firestore + 6 Storage).
  - **Integration Suite**: `firebase emulators:exec --only auth,firestore,functions "node functions/scripts/test-callables-integration.js"`
    - **32/32 tests passing** (Phase 1 tests #1-15: unauthenticated rejection, permission denial, claim provisioning, atomic write batches, idempotency replays, multi-tenant deactivation; Phase 2 tests #16-32: role_employee default, lease expiry recovery, products, customers, vendors, outflows, bills, deliveries anti-embedding, returns, adjustments, barcode uniqueness, quotation isolation & finalization, stock and ledger reconciliations).
  - **Anti-Embedding Check**: `node scripts/check-duplicate-embedding.js`
    - **0 violations**, all 5 Phase 2 confirmations verified, self-test PASS.

---

### Part 8 — Negative-Stock Policy & Barcode Uniqueness
* **Status**: **Fixed & Verified (Atomic barcode lock & negative stock precondition)**
* **Negative Stock Policy**:
  - Confirmed enforced in `functions/src/services/stockEngine.ts`: Line 116 checks `if (prodData.trackStock && newStock < 0 && !params.allowNegativeStock)` and throws `failed-precondition` error code with available vs requested quantities. Default tenant behavior strictly forbids negative stock.
* **Barcode Uniqueness**:
  - In `testing-trado-api`, `items.service.ts` enforced per-tenant barcode uniqueness and indexed `{ organization: 1, barcode: 1 }`.
  - In Firebase Firestore, implemented concurrent race-safe barcode locking via internal `barcodeLocks/${organizationId}_${barcode}` documents within `productsCreate` and `productsUpdate` transactions.
  - Secured `match /barcodeLocks/{lockId} { allow read, write: if false; }` in `firestore.rules`.
  - Added Integration Test #24:
    1. Sequential duplicate barcode creation is rejected with HTTP 409 `ALREADY_EXISTS`.
    2. Concurrent race condition test using `Promise.all` creating two products with identical barcodes simultaneously: exactly 1 product is created, and the other is atomically rejected with `ALREADY_EXISTS`.

---

## 3. Gaps and Known Warnings

> [!WARNING]
> ### Tax Calculation Fixtures and Accounting Authority Verification
> The tax calculation algorithms implemented in `functions/src/services/taxCalculation.ts` cover India GST (`IN_GST`), UAE VAT (`AE_VAT`), US State Sales Tax (`US_SALES_TAX`), and Tax-Exempt (`NONE`).
> While mathematically accurate for the provided test cases, production deployment requires:
> 1. Formal audit and sign-off by a certified tax accountant or chartered accountant for each target jurisdiction.
> 2. Integration with official jurisdictional tax tables (e.g., India HSN/SAC rate schedules, state-specific cess, US county/city nexus rules).
> 3. E-invoicing and digital signature compliance (e.g., ZATCA in KSA, GSTN in India) which are out of scope for Phase 2.

> [!NOTE]
> ### Phase 3 Deferred Operational Scope
> The following capabilities are explicitly documented as future requirements for Phase 3:
> 1. Aggregate Financial Reporting & P&L statements (`reporting:*`).
> 2. Operational task assignment and employee scheduling (`task:*`).
> 3. Real-time GPS location tracking for delivery riders (`rider:*`).
> 4. Offline sync Conflict-Free Replicated Data Types (CRDTs) or queue replay hardening for network drops.
> 5. Production push notification triggers (APNs/FCM) replacing the mock adapter.
