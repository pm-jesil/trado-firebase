# Feature Guide: Payments & Party Ledgers

---

## 1. Module Overview & Financial Ledger Architecture

The Payments & Party Ledgers module manages financial settlements, partial debt payments, payment voiding, and double-entry reconciliation for Trado:
- **Standalone Payments Ledger (`payments/{paymentId}`)**: A dedicated, immutable log of all incoming and outgoing monetary flows. Every transaction issues an atomic sequential number (`PAY-YYYY-XXXXXX`).
- **Directional Categorization**:
  - `direction: "in"`: Incoming cash, card, UPI, or wire collections from customers.
  - `direction: "out"`: Outgoing supplier disbursements, operational expense payouts, or employee reimbursements.
- **Counterparty & Document References**: Payments link directly to parent documents (`referenceId`: `billId` or `outflowId`) and counterparty masters (`partyType`: `customer`, `vendor`, `employee`, or `other`).
- **Double-Entry Ledgers**:
  - `customerLedgers/{ledgerId}`: Debits from invoices, credits from payments and sales returns.
  - `vendorLedgers/{ledgerId}`: Credits from purchases, debits from disbursements and purchase returns.
- **Payment Voiding & Reversal (`paymentsVoid`)**: Securely cancels erroneous payments, rolling back customer/vendor debt balances and marking the payment voided.

```mermaid
flowchart TD
    subgraph PaymentSources["Triggering Sources"]
        POS["POS Cash Collection (billsCreate)"]
        FollowUp["Receivable Installment (paymentsCreate)"]
        VendorPay["Vendor Disbursement (paymentsCreate)"]
        ExpensePay["Operational Expense Payout (outflowsCreate)"]
    end

    subgraph PaymentsMaster["payments/{paymentId} (PAY-YYYY-XXXXXX)"]
        InFlow["direction: 'in' (Collections)"]
        OutFlow["direction: 'out' (Disbursements)"]
    end

    subgraph DoubleEntry["Double-Entry Ledgers"]
        CustLedger["customerLedgers/{id}\n(Decrements customer debt)"]
        VendLedger["vendorLedgers/{id}\n(Decrements vendor payable)"]
        BillUpdate["bills/{id}.paidAmount / balanceAmount"]
        OutflowUpdate["outflows/{id}.paidAmount / balanceAmount"]
    end

    POS --> InFlow
    FollowUp --> InFlow
    VendorPay --> OutFlow
    ExpensePay --> OutFlow

    InFlow --> CustLedger
    InFlow --> BillUpdate
    OutFlow --> VendLedger
    OutFlow --> OutflowUpdate
```

---

## 2. End-to-End Sequence Diagrams

### 2.1 Follow-Up Customer Payment (`paymentsCreate`)

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Cashier / Accounts Clerk
    participant GW as Cloud Functions (paymentsCreate)
    participant DB as Cloud Firestore

    Cashier->>GW: Call paymentsCreate(direction: "in", partyType: "customer", partyId, referenceId: billId, amount, method)
    GW->>GW: Verify caller has payment:create permission
    GW->>GW: Validate CreatePaymentSchema & check idempotency lease
    
    Note over GW,DB: Atomic Multi-Document Firestore Transaction
    GW->>DB: Read bills/{billId} (check balanceAmount >= amount)
    GW->>DB: Read customers/{partyId} (verify exists & belongs to org)
    GW->>DB: Reserve payment number (uniqueKeys: PAY-2026-XXXXXX)
    
    GW->>DB: Update bills/{billId} (paidAmount += amount, balanceAmount -= amount, paymentStatus)
    GW->>DB: Update customers/{partyId} (outstandingBalance -= amount)
    GW->>DB: Append customerLedgers (entryType: "payment_credit", amount)
    GW->>DB: Write payments/{paymentId} (status: "completed", paymentNumber)
    GW->>DB: Append auditLogs/{auditId}
    
    GW-->>Cashier: Return CreatePaymentResponse (paymentId, paymentNumber, newBalance)
```

### 2.2 Payment Voiding & Reversal Flow (`paymentsVoid`)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Finance Controller / Admin
    participant GW as Cloud Functions (paymentsVoid)
    participant DB as Cloud Firestore

    Admin->>GW: Call paymentsVoid(paymentId, reason: "Bounced cheque")
    GW->>GW: Verify caller has payment:void or role:owner permission
    GW->>GW: Validate VoidPaymentSchema
    
    Note over GW,DB: Atomic Multi-Document Firestore Transaction
    GW->>DB: Read payments/{paymentId} (verify status === "completed")
    GW->>DB: Re-read parent document (bill or outflow)
    GW->>DB: Re-read party master (customer or vendor)
    
    GW->>DB: Reverse customer/vendor balance (re-instate debt)
    GW->>DB: Update parent document (decrease paidAmount, increase balanceAmount)
    GW->>DB: Append reversal entry in party ledger
    GW->>DB: Update payments/{paymentId}: status = "voided", voidReason = reason
    GW->>DB: Append auditLogs/{auditId}
    
    GW-->>Admin: Return VoidPaymentResponse (paymentId, status: "voided")
```

---

## 3. Supported Payment Methods & Gateways

| Payment Method | Direction | Semantics | Gateway Reference Field |
| :--- | :--- | :--- | :--- |
| **`cash`** | In / Out | Physical currency drawer collection or payout | N/A |
| **`upi`** | In | Instant QR / VPA collection (India) | `gateway.externalReference` (UPI RRN) |
| **`card`** | In | POS debit/credit card swipe | `gateway.cardBrand`, `gateway.cardLast4` |
| **`bank_transfer`**| In / Out | NEFT / RTGS / IMPS / Wire transfer | Bank UTR / Transaction reference number |
| **`cheque`** | In / Out | Bank clearance instrument | Cheque number |
| **`credit_note`** | In | Settled against approved sales return | `referenceId` links to return voucher |

> [!IMPORTANT]
> **PCI-DSS Compliance**: Sensitive payment credentials (raw card numbers, CVVs, expiry dates, or UPI PINs) are **never** accepted, transmitted, or logged. The gateway DTO stores only the last 4 digits (`cardLast4`) and provider authorization codes.

---

## 4. API Reference & Parameter Specifications

### 4.1 `paymentsCreate`
Records an incoming receipt or outgoing disbursement against an invoice, purchase, or as a standalone balance settlement.

#### Request Parameters
```typescript
interface CreatePaymentRequest {
  idempotencyKey?: string;           // 8-128 char unique lease key
  organizationId?: string;           // Optional (derived from token context)
  branchId?: string;                 // Optional (derived from token context)
  direction: "in" | "out";           // "in" (customer receipt) | "out" (vendor disbursement)
  partyType: "customer" | "vendor" | "employee" | "other";
  partyId?: string | null;           // Target party master ID
  partyName?: string;                // Free-text name for one-off / unregistered parties
  amount: number;                    // Positive transaction amount
  method: PaymentMethod;             // "cash" | "upi" | "card" | "bank_transfer" | "cheque" | "credit_note"
  referenceId?: string | null;       // Associated billId or outflowId
  referenceModel?: "bill" | "outflow" | null;
  notes?: string;                    // Max 500 characters
  gateway?: {
    externalReference?: string;      // UPI RRN, card auth code, wire UTR
    gatewayProvider?: string;        // "razorpay" | "stripe" | "pos_terminal"
    gatewayStatus?: "initiated" | "authorized" | "captured" | "failed" | "refunded";
    cardBrand?: string;              // "visa" | "mastercard" | "rupay"
    cardLast4?: string;              // Exact 4 digits regex
  };
}
```

#### Success Response (200 OK)
```json
{
  "paymentId": "pay_5a6b7c8d9e",
  "organizationId": "org_apex_sample",
  "paymentNumber": "PAY-2026-000085",
  "direction": "in",
  "amount": 3000.00,
  "method": "upi",
  "status": "completed",
  "message": "Payment recorded successfully."
}
```

#### Common Error Codes
- `invalid-argument`: Payment amount exceeds parent invoice's remaining balance.
- `not-found`: Parent bill, outflow, customer, or vendor does not exist in caller's organization.

---

### 4.2 `paymentsVoid`
Safely voids a previously completed payment and rolls back all ledgers.

#### Request Parameters
```typescript
interface VoidPaymentRequest {
  paymentId: string;                 // Target payment ID to void
  reason: string;                    // 3-500 characters, mandatory reason
  idempotencyKey?: string;           // Optional lease key
}
```

#### Success Response (200 OK)
```json
{
  "paymentId": "pay_5a6b7c8d9e",
  "status": "voided",
  "voidReason": "Customer cheque bounced due to signature mismatch",
  "message": "Payment voided and party debt balance restored successfully."
}
```

---

## 5. Manual Emulator Testing Commands

```powershell
# 1. Run Retail POS Checkout & Payment Ledgers Test
node functions/scripts/test-e2e-retail-lifecycle.cjs

# 2. Reconcile Customer and Vendor Ledgers against Master Balances
node functions/scripts/test-e2e-business-flow.cjs
```
