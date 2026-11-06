# Feature Guide: Payments & Party Ledgers

---

## 1. Purpose & Scope
This module manages cash and cashless financial settlements, multi-method payment transactions, and party debt balances for Trado:
- **Standalone Payments Ledger**: `payments/{paymentId}` records every financial payment transaction independently from bills or outflows.
- **Reference-by-ID Architecture**: Payments reference their parent document (`referenceId`: bill ID, outflow ID, or return ID) and counterparty (`partyId`: customer or vendor ID) by bare ID.
- **Double-Entry Ledgers**: Customer debits/credits (`customerLedgers`) and vendor payables/disbursements (`vendorLedgers`) guarantee mathematical traceability for all balances.

---

## 2. Actors & Permissions
- **Cashier / Retail Staff**: Requires `payment:create`. Can record payments received at point of sale.
- **Accounts Receivable / Payable Clerk**: Requires `payment:create` and `payment:read`. Can record installment payments, bank transfers, cheque clearances, and vendor disbursements.
- **Auditor / Finance Lead**: Requires `payment:read` and `reconciliation:read`. Can inspect party ledgers and execute `reconcilePartyLedgers`.

---

## 3. Supported Payment Methods & Types

### Payment Types
- `received_customer`: Cash or electronic payment collected from a customer against an invoice or credit balance.
- `disbursed_vendor`: Disbursement made to a supplier against a purchase outflow.

### Payment Methods
- `cash`: Physical currency drawer intake or payout.
- `upi`: Instant electronic QR / VPA transfer (India).
- `card`: POS debit/credit card terminal swipe.
- `bank_transfer`: NEFT/RTGS/IMPS wire transfer.
- `credit_note`: Settlement against an approved sales return credit balance.

---

## 4. Step-by-Step Happy Path Workflows

### 4.1 Recording a Follow-Up Payment Against an Invoice
1. **User calls `paymentsCreate`**:
   - Payload:
     ```json
     {
       "organizationId": "org_demo",
       "branchId": "main-branch",
       "paymentType": "received_customer",
       "referenceId": "bill_inv_001",
       "partyId": "cust_sunrise",
       "amount": 3000,
       "paymentMethod": "upi",
       "notes": "Second installment invoice INV-2026-000001"
     }
     ```
2. **Backend Transaction Execution**:
   - Reads `bills/bill_inv_001`: retrieves `totalAmount: 7000`, `paidAmount: 0`, `balanceAmount: 7000`.
   - Validates payment amount: ₹3,000 does not exceed remaining balance ₹7,000.
   - Atomically updates `bills/bill_inv_001`:
     - `paidAmount: 3000`
     - `balanceAmount: 4000`
     - `paymentStatus: "partial"`
   - Atomically updates `customers/cust_sunrise.outstandingBalance`: credits ₹3,000 (balance drops from ₹7,000 to ₹4,000).
   - Appends credit record to `customerLedgers`.
   - Generates sequential payment number `PAY-2026-000002`.
   - Commits `payments/{paymentId}` with `status: "success"`.

### 4.2 Disbursing Payment to Vendor
1. **User calls `paymentsCreate`**:
   - Payload: `{ paymentType: "disbursed_vendor", referenceId: "outflow_pur_001", partyId: "vend_kerala", amount: 12000, paymentMethod: "bank_transfer" }`.
2. **Backend Execution**:
   - Validates remaining payable on `outflow_pur_001`.
   - Sets outflow `paidAmount = 20000`, `balanceAmount = 0`, `paymentStatus = "paid"`.
   - Decrements vendor `outstandingPayable` to 0.
   - Appends debit record in `vendorLedgers`.

---

## 5. Duplicate Payment & Overpayment Invariants
- **Overpayment Guard**: If a bill has a remaining balance of ₹4,000, attempting to record a payment of ₹4,500 is rejected with `invalid-argument: "Payment amount cannot exceed document remaining balance"`.
- **Idempotency Replay**: Submitting duplicate payment requests with the same `idempotencyKey` returns the cached payment receipt without updating customer balance twice.
- **Audit Logging**: Every payment writes an audit record with payment method and amount. Sensitive payment credentials (CVV, card numbers, UPI PINs) are never accepted or logged.

---

## 6. Party Ledger Reconciliation (`reconcilePartyLedgers`)
- The reconciliation callable iterates all active customers and vendors.
- For each party:
  $$\text{Computed Balance} = \sum \text{Debits} - \sum \text{Credits}$$
- Compares computed balance against `customers.outstandingBalance` or `vendors.outstandingPayable`.
- Flags any discrepancy with document IDs for manual accounting review.

---

## 7. Local Testing & Verification
- **Integration Tests**: `functions/scripts/test-callables-integration.js`
  - Tests verify sequential payments, partial balance calculation, and customer balance synchronization.
- **Connected Business Flow**: Steps 5 and 8 of `functions/scripts/test-e2e-business-flow.js`.

