/**
 * Generates Executable Finance & Stock Flow Guides FL-01..FL-19 (U-11; D-F20)
 */

const fs = require("node:fs");
const path = require("node:path");

const FLOWS_DIR = path.resolve(__dirname, "..", "docs", "flows");
if (!fs.existsSync(FLOWS_DIR)) {
  fs.mkdirSync(FLOWS_DIR, { recursive: true });
}

const FLOW_DEFS = [
  {
    id: "FL-01",
    title: "Cash Sale & Immediate Ledger Posting",
    personas: ["cashier", "branch_manager"],
    callables: ["billsCreate", "billsFinalize", "accountEntriesList"],
    invariants: ["INV-1", "INV-2", "INV-3", "INV-4"],
    description: "Retail walk-in customer makes a cash purchase. Bill is finalized, stock decremented, and cash drawer account entry posted immediately.",
    steps: [
      { step: 1, action: "Create retail walk-in bill", callable: "billsCreate", payload: { salesMode: "retail", paymentMethod: "cash", paidAmount: 25000, items: [{ productId: "prod_1", quantity: 2, unitPrice: 12500 }] } },
      { step: 2, action: "Finalize bill and commit stock/account ledger", callable: "billsFinalize", payload: { billId: "bill_001" } },
      { step: 3, action: "Verify financial account running balance updated", callable: "accountEntriesList", payload: { sourceDocumentType: "bill", sourceDocumentId: "bill_001" } }
    ]
  },
  {
    id: "FL-02",
    title: "Split-Tender Sale (Cash + Card + UPI)",
    personas: ["cashier", "store_owner"],
    callables: ["billsCreate", "billsFinalize", "accountEntriesList"],
    invariants: ["INV-1", "INV-3", "INV-4", "INV-18"],
    description: "Customer splits total bill across cash drawer and card/UPI clearing accounts. Multiple account transactions are created atomically.",
    steps: [
      { step: 1, action: "Create bill with split payments", callable: "billsCreate", payload: { totalAmount: 100000, splitPayments: [{ method: "cash", amount: 40000 }, { method: "card", amount: 60000 }] } },
      { step: 2, action: "Finalize bill", callable: "billsFinalize", payload: { billId: "bill_002" } },
      { step: 3, action: "Verify multiple ledger entries created across both accounts", callable: "accountEntriesList", payload: { sourceDocumentId: "bill_002" } }
    ]
  },
  {
    id: "FL-03",
    title: "Credit Sale & Subsequent Customer Collection",
    personas: ["salesperson", "accountant"],
    callables: ["billsCreate", "billsFinalize", "paymentsCreate", "accountEntriesList"],
    invariants: ["INV-1", "INV-3", "INV-4"],
    description: "B2B sale on credit (paidAmount: 0). Customer outstanding receivable increases. Later, customer payment voucher settles the bill.",
    steps: [
      { step: 1, action: "Create credit invoice", callable: "billsCreate", payload: { customerId: "cust_1", paidAmount: 0, totalAmount: 500000 } },
      { step: 2, action: "Finalize credit invoice", callable: "billsFinalize", payload: { billId: "inv_003" } },
      { step: 3, action: "Record customer payment voucher", callable: "paymentsCreate", payload: { customerId: "cust_1", amount: 500000, paymentMethod: "bank_transfer", referenceDocumentId: "inv_003" } }
    ]
  },
  {
    id: "FL-04",
    title: "Direct Vendor Purchase & Payment Voucher",
    personas: ["purchaser", "finance_manager"],
    callables: ["outflowsCreate", "accountEntriesList"],
    invariants: ["INV-1", "INV-2", "INV-3", "INV-4"],
    description: "Purchasing stock with immediate cash or bank payment. Stock increments and operating account is debited.",
    steps: [
      { step: 1, action: "Create purchase outflow with immediate payment", callable: "outflowsCreate", payload: { kind: "purchase", vendorId: "vend_1", totalAmount: 150000, paidAmount: 150000, paymentMethod: "bank_transfer" } },
      { step: 2, action: "Verify vendor purchase total and bank balance reduction", callable: "accountEntriesList", payload: { sourceDocumentType: "outflow" } }
    ]
  },
  {
    id: "FL-05",
    title: "Vendor Credit Purchase & Subsequent Settlement",
    personas: ["purchaser", "accountant"],
    callables: ["outflowsCreate", "paymentsCreate", "accountEntriesList"],
    invariants: ["INV-1", "INV-3", "INV-4"],
    description: "Purchasing raw materials on vendor credit terms. Vendor payable increases; settlement payment zeroes out the liability.",
    steps: [
      { step: 1, action: "Create vendor credit purchase", callable: "outflowsCreate", payload: { kind: "purchase", vendorId: "vend_1", totalAmount: 200000, paidAmount: 0 } },
      { step: 2, action: "Issue vendor payout voucher", callable: "paymentsCreate", payload: { vendorId: "vend_1", amount: 200000, paymentMethod: "bank_transfer", direction: "out" } }
    ]
  },
  {
    id: "FL-06",
    title: "Operational Expense Posting (Cash & Bank)",
    personas: ["branch_manager", "finance_manager"],
    callables: ["outflowsCreate", "accountEntriesList"],
    invariants: ["INV-1", "INV-3", "INV-4"],
    description: "Recording daily branch operating expenses (e.g. utilities, store cleaning, packaging supplies) against cash drawer.",
    steps: [
      { step: 1, action: "Post expense outflow", callable: "outflowsCreate", payload: { kind: "expense", totalAmount: 12000, paidAmount: 12000, paymentMethod: "cash", notes: "Store cleaning supplies" } },
      { step: 2, action: "Verify expense recorded in cash drawer ledger", callable: "accountEntriesList", payload: { sourceDocumentType: "outflow" } }
    ]
  },
  {
    id: "FL-07",
    title: "Sales Return with Cash Refund",
    personas: ["cashier", "branch_manager"],
    callables: ["returnsCreate", "returnsApprove", "accountEntriesList"],
    invariants: ["INV-1", "INV-2", "INV-3", "INV-5"],
    description: "Customer returns defective item and receives cash refund. Stock is re-credited and cash drawer balance reduced.",
    steps: [
      { step: 1, action: "Create sales return", callable: "returnsCreate", payload: { referenceBillId: "bill_001", refundMethod: "cash", items: [{ productId: "prod_1", returnQty: 1 }] } },
      { step: 2, action: "Approve sales return", callable: "documentsDecide", payload: { documentType: "return", documentId: "ret_001", decision: "approve" } }
    ]
  },
  {
    id: "FL-08",
    title: "Sales Return with Customer Store Credit",
    personas: ["cashier", "branch_manager"],
    callables: ["returnsCreate", "accountEntriesList"],
    invariants: ["INV-1", "INV-5"],
    description: "Customer returns merchandise and elects store credit. No immediate cash leaves drawer; customer advanceBalance is incremented.",
    steps: [
      { step: 1, action: "Create return with credit_note refund", callable: "returnsCreate", payload: { referenceBillId: "bill_001", refundMethod: "credit_note", items: [{ productId: "prod_1", returnQty: 1 }] } },
      { step: 2, action: "Verify customer advance balance updated", callable: "accountEntriesList", payload: { sourceDocumentType: "return" } }
    ]
  },
  {
    id: "FL-09",
    title: "Purchase Return with Debit Note / Bank Refund",
    personas: ["inventory_manager", "accountant"],
    callables: ["returnsCreate", "accountEntriesList"],
    invariants: ["INV-1", "INV-5"],
    description: "Returning damaged vendor items. Inventory decrements and vendor debit note or refund voucher is recorded.",
    steps: [
      { step: 1, action: "Create purchase return", callable: "returnsCreate", payload: { referenceOutflowId: "out_001", returnType: "purchase_return", items: [{ productId: "prod_1", returnQty: 5 }] } }
    ]
  },
  {
    id: "FL-10",
    title: "Inter-Branch Stock Transfer (Dispatch -> Transit -> Receipt)",
    personas: ["warehouse_dispatcher", "branch_receiver"],
    callables: ["stockTransfersCreate", "stockTransfersSubmit", "documentsDecide", "stockTransfersDispatch", "stockTransfersReceive"],
    invariants: ["INV-11", "INV-12", "INV-13"],
    description: "Transferring finished stock between warehouses. Source decrements physical and increments in_transit; destination increments on receipt.",
    steps: [
      { step: 1, action: "Create transfer draft", callable: "stockTransfersCreate", payload: { sourceBranchId: "branch_w1", destinationBranchId: "branch_s1", items: [{ productId: "prod_1", requestedQty: 50 }] } },
      { step: 2, action: "Submit and approve transfer", callable: "documentsDecide", payload: { documentType: "stock_transfer", documentId: "trf_001", decision: "approve" } },
      { step: 3, action: "Dispatch from warehouse", callable: "stockTransfersDispatch", payload: { transferId: "trf_001" } },
      { step: 4, action: "Receive at retail branch", callable: "stockTransfersReceive", payload: { transferId: "trf_001", items: [{ productId: "prod_1", receivedQty: 50 }] } }
    ]
  },
  {
    id: "FL-11",
    title: "Inter-Branch Transfer Discrepancy & Damage Write-Off",
    personas: ["branch_receiver", "operations_manager"],
    callables: ["stockTransfersReceive", "stockTransfersResolveDiscrepancy"],
    invariants: ["INV-11", "INV-12"],
    description: "Goods arrive damaged at destination. Damaged units are rejected, and an inventory write-off expense is charged to source branch.",
    steps: [
      { step: 1, action: "Receive with shortage and rejection", callable: "stockTransfersReceive", payload: { transferId: "trf_002", items: [{ productId: "prod_1", receivedQty: 45, rejectedQty: 5, discrepancyReason: "transit_breakage" }] } },
      { step: 2, action: "Resolve discrepancy as write_off", callable: "stockTransfersResolveDiscrepancy", payload: { transferId: "trf_002", productId: "prod_1", resolution: "write_off", notes: "Breakage during highway transport" } }
    ]
  },
  {
    id: "FL-12",
    title: "Intra-Branch Location Move (Internal Stock Transfer)",
    personas: ["storekeeper", "branch_manager"],
    callables: ["stockTransfersCreate", "stockTransfersDispatch", "stockTransfersReceive"],
    invariants: ["INV-11", "INV-12"],
    description: "Moving items between different storage racks or rooms within the same branch. Marked internal: true with no in-transit ledger charge.",
    steps: [
      { step: 1, action: "Create internal transfer", callable: "stockTransfersCreate", payload: { sourceBranchId: "branch_main", destinationBranchId: "branch_main", sourceLocationId: "rack_a", destinationLocationId: "rack_b", internal: true, items: [{ productId: "prod_1", requestedQty: 20 }] } }
    ]
  },
  {
    id: "FL-13",
    title: "Stock Transfer Cancel-After-Dispatch (In-Transit Reversal)",
    personas: ["dispatcher", "branch_manager"],
    callables: ["stockTransfersDispatch", "stockTransfersCancel"],
    invariants: ["INV-11", "INV-13"],
    description: "Transfer vehicle recalled due to road closure. Dispatched items in transit are safely credited back to source warehouse.",
    steps: [
      { step: 1, action: "Dispatch transfer", callable: "stockTransfersDispatch", payload: { transferId: "trf_003" } },
      { step: 2, action: "Cancel dispatched transfer", callable: "stockTransfersCancel", payload: { transferId: "trf_003", reason: "Vehicle recall / aborted trip" } }
    ]
  },
  {
    id: "FL-14",
    title: "Cashier Shift Handover & Receiver Confirmation",
    personas: ["cashier_shift1", "cashier_shift2"],
    callables: ["accountTransfersCreate", "accountTransfersConfirm"],
    invariants: ["INV-1", "INV-3", "INV-4"],
    description: "Morning cashier transfers physical cash drawer to evening cashier. Receiver must confirm receipt before transfer completes.",
    steps: [
      { step: 1, action: "Create handover transfer", callable: "accountTransfersCreate", payload: { sourceAccountId: "acc_drawer_1", destinationAccountId: "acc_drawer_2", amount: 150000, transferType: "shift_handover" } },
      { step: 2, action: "Incoming cashier confirms handover", callable: "accountTransfersConfirm", payload: { transferId: "trf_h1" } }
    ]
  },
  {
    id: "FL-15",
    title: "Day-End Physical Cash Count & Variance Adjustment",
    personas: ["cashier", "branch_manager"],
    callables: ["cashCountsCreate", "cashCountsGet"],
    invariants: ["INV-15"],
    description: "End of day denomination counting. Discrepancy between counted cash and system running balance generates an adjustment entry.",
    steps: [
      { step: 1, action: "Submit physical cash count", callable: "cashCountsCreate", payload: { financialAccountId: "acc_cash_1", denominations: { "500": 20, "200": 10, "100": 30 }, notes: "Day end register tally" } },
      { step: 2, action: "Retrieve recorded count with variance transaction", callable: "cashCountsGet", payload: { countId: "cnt_001" } }
    ]
  },
  {
    id: "FL-16",
    title: "Card Gateway Interchange Fee Recording & Settlement",
    personas: ["accountant", "finance_manager"],
    callables: ["accountEntriesRecordFee", "accountEntriesList"],
    invariants: ["INV-7", "INV-8"],
    description: "Recording merchant acquiring discount rate (MDR) on card transaction. Automatic sub-entry created under root sale transaction.",
    steps: [
      { step: 1, action: "Record gateway MDR fee", callable: "accountEntriesRecordFee", payload: { entryId: "txn_card_sale_1", feeAmount: 1850, notes: "1.85% MDR deduction" } }
    ]
  },
  {
    id: "FL-17",
    title: "Cash Bank Deposit & Inter-Account Transfers",
    personas: ["accountant", "finance_manager"],
    callables: ["accountTransfersCreate", "accountTransfersConfirm"],
    invariants: ["INV-1", "INV-3", "INV-4"],
    description: "Transferring excess physical cash to bank operating current account. Both accounts reflect synchronized running balances.",
    steps: [
      { step: 1, action: "Initiate cash deposit to bank", callable: "accountTransfersCreate", payload: { sourceAccountId: "acc_cash_main", destinationAccountId: "acc_bank_hdfc", amount: 2000000, transferType: "cash_deposit" } },
      { step: 2, action: "Confirm bank credit", callable: "accountTransfersConfirm", payload: { transferId: "act_001" } }
    ]
  },
  {
    id: "FL-18",
    title: "Maker-Checker Document & Entry Approval Workflow",
    personas: ["employee_maker", "manager_checker"],
    callables: ["accountEntriesVerify", "documentsDecide"],
    invariants: ["INV-16", "INV-17"],
    description: "High-value ledger entry or document submitted by employee routes to supervisor. Maker cannot verify or approve own entry.",
    steps: [
      { step: 1, action: "Checker verifies entry", callable: "accountEntriesVerify", payload: { entryId: "txn_manual_1", note: "Voucher supporting documentation checked" } },
      { step: 2, action: "Approver gives final approval", callable: "documentsDecide", payload: { documentType: "account_entry", documentId: "txn_manual_1", decision: "approve" } }
    ]
  },
  {
    id: "FL-19",
    title: "Cross-Branch Comparative Performance & Liquidity Summary",
    personas: ["org_owner", "platform_admin"],
    callables: ["reportsGetBranchSummary"],
    invariants: ["INV-1", "INV-4"],
    description: "Organization-wide consolidated view comparing sales, outflows, liquidity, and inventory valuation across all branches.",
    steps: [
      { step: 1, action: "Generate cross-branch summary report", callable: "reportsGetBranchSummary", payload: { scope: "organization" } }
    ]
  }
];

function generateMarkdown(flow) {
  return `# ${flow.id}: ${flow.title}

> **Domain:** Finance, Stock & Account Integrity (Prompt 77)  
> **Personas:** ${flow.personas.map((p) => `\`${p}\``).join(", ")}  
> **Key Invariants:** ${flow.invariants.map((i) => `\`${i}\``).join(", ")}  
> **Callables:** ${flow.callables.map((c) => `\`${c}\``).join(", ")}  

---

## 1. Overview
${flow.description}

## 2. Executable Steps & Request Payloads

${flow.steps.map((s) => `### Step ${s.step}: ${s.action}
- **Callable:** \`${s.callable}\`
- **Request Payload:**
\`\`\`json
${JSON.stringify(s.payload, null, 2)}
\`\`\`
`).join("\n")}

## 3. Invariant Assertions & Expected State
${flow.invariants.map((inv) => `- **${inv}:** Must hold before and after each transaction in this flow.`).join("\n")}
- Balance updates must be atomic and synchronized across running balance fields.
`;
}

for (const flow of FLOW_DEFS) {
  const filePath = path.join(FLOWS_DIR, `${flow.id}.md`);
  fs.writeFileSync(filePath, generateMarkdown(flow), "utf8");
  console.log(`Generated: ${filePath}`);
}

console.log(`[PASS] Successfully generated ${FLOW_DEFS.length} flow guides in ${FLOWS_DIR}`);
