# Feature Guide: Sales, Billing & Quotations Engine

---

## 1. Purpose & Scope
This module provides Point-of-Sale (POS) and B2B wholesale billing workflows for Trado:
- **Shared Bills Collection**: `bills/{billId}` unifies retail POS receipts, B2B quotations, pro-forma invoices, and finalized Tax Invoices.
- **Quotation Workflow**: Quotations hold pricing and item quantities without locking physical inventory or creating financial receivable obligations.
- **Atomic Finalization**: `billsFinalize` transitions quotations/drafts into Tax Invoices, commits stock deductions, issues sequential document numbering, and updates customer ledgers atomically.
- **Idempotency & Concurrency**: 24-hour request deduplication leases prevent accidental double-billing or multiple stock decrements on network retries.

---

## 2. Actors & Permissions
- **Cashier / Floor Staff**: Requires `bill:create`. Can issue POS bills and generate quotations.
- **Sales Executive / Billing Admin**: Requires `bill:finalize`. Can finalize draft quotations into active Tax Invoices and apply manual bill-level discounts.
- **Finance Manager**: Requires `bill:delete` or `bill:cancel`. Can cancel or void draft documents.

---

## 3. Document Types & Lifecycle States

### Document Types
- `DocumentType.POS`: Retail cash/card receipt. Created directly in active/paid status. Stock decremented immediately.
- `DocumentType.QUOTATION`: Price estimate provided to prospective customer. Preserves stock. Status is `draft`.
- `DocumentType.PROFORMA`: Advance payment invoice. Preserves stock until finalized.
- `DocumentType.INVOICE`: Final legal Tax Invoice with tax snapshot and sequential invoice numbering.

### Sequential Number Prefixes
Numbering is managed by atomic counters in `documentCounters/{orgId}_{prefix}_{year}`:
- POS: `POS-YYYY-XXXXXX` (e.g. `POS-2026-000001`)
- Quotation: `QTN-YYYY-XXXXXX` (e.g. `QTN-2026-000001`)
- Tax Invoice: `INV-YYYY-XXXXXX` (e.g. `INV-2026-000001`)

---

## 4. Step-by-Step Workflows

### 4.1 Retail POS Sale
1. **Cashier calls `billsCreate`**:
   - Payload specifies `salesMode: "pos"`, line items, and payment method (`cash`, `upi`, `card`).
2. **Backend Execution**:
   - Validates products belong to caller's organization.
   - Verifies sufficient stock exists in `stockBalances/{orgId}_{branchId}_{productId}`.
   - Atomically:
     - Decrements branch stock in `stockBalances` and aggregate in `products.currentStock`.
     - Appends `stockMovements` (`sale_out`).
     - Issues sequential number `POS-2026-XXXXXX`.
     - Records payment entry in `payments` if fully or partially paid.
     - Commits `bills/{billId}` with `status: "active"`, `paymentStatus: "paid"`.

### 4.2 B2B Quotation to Finalized Tax Invoice
1. **Sales Executive creates Quotation**:
   - Calls `billsCreate` with `documentType: "quotation"`, `customerId: "cust_sunrise"`.
   - Backend issues `QTN-2026-000001` with `status: "draft"`.
   - **Verification**: Current physical stock remains unchanged. Zero stock movements are recorded.
2. **Customer Approves Quotation**:
   - Executive calls `billsFinalize` with `{ organizationId, billId: "bill_qtn_001" }`.
3. **Backend Finalization Transaction**:
   - Checks that bill is currently `draft` and documentType is `quotation`.
   - Validates that physical stock is still available at the operating branch.
   - Generates final Tax Invoice number (`INV-2026-000001`).
   - Atomically decrements branch stock in `stockBalances`.
   - Records customer ledger debit in `customerLedgers`.
   - Updates `bills/{billId}`: `status: "active"`, `billNumber: "INV-2026-000001"`, `originalQuotationNumber: "QTN-2026-000001"`.

---

## 5. Concurrency & Idempotency Safeguards

### Concurrent Finalization Race
- If two users or two client retry threads call `billsFinalize` on the same quotation simultaneously using `Promise.all`:
  - Firestore's atomic transaction checks `status === "draft"`.
  - Exactly **one request succeeds** and converts the bill to an invoice.
  - The second request encounters `status !== "draft"` and is rejected with `failed-precondition: "Bill is already finalized"`.
  - Stock is decremented **exactly once**.

### 24-Hour Idempotency Leases
- Every write callable accepts an `idempotencyKey`.
- If a client resubmits an identical `idempotencyKey` after a network timeout:
  - The backend returns the cached result without repeating stock deductions or counter increments.
  - If a duplicate request arrives while the first is still processing, it receives `already-exists: "Operation in progress"`.

---

## 6. Snapshots & Anti-Embedding Compliance
To ensure auditability, bills capture historical snapshots:
- `customerSnapshot`: Stores `{ name, phone, address, taxIdentifier }` at the time of sale.
- `taxSnapshot`: Stores `{ regimeCode, totalTaxRate, components }` at the time of sale.
- `productSnapshot` on line items: Stores `{ name, productCode, unit, priceSnapshot }`.
Parent documents (full customer or product records) are never embedded.

---

## 7. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify quotation stock preservation, POS stock deduction, concurrent finalization race with 1 winner, duplicate idempotency replay, and cross-tenant product isolation.
- **E2E Business Flow**: Steps 6–8 of `functions/scripts/test-e2e-business-flow.js`.

