/**
 * Trado State-Diff Recorder & Live Event Investigator (Prompt 77 — BF0 A-1, BF10 K-1)
 *
 * Captures transactional state diffs across key business collections around one callable execution.
 */

const assert = require("node:assert/strict");

const CORE_COLLECTIONS = [
  "bills",
  "outflows",
  "payments",
  "returns",
  "financialAccounts",
  "accountTransactions",
  "stockMovements",
  "stockBalances",
  "customers",
  "vendors",
  "auditLogs",
  "documentCounters",
];

function createStateDiffTracker(db) {
  async function captureState(organizationId, collections = CORE_COLLECTIONS) {
    const state = {};
    for (const col of collections) {
      let query = db.collection(col);
      if (organizationId) {
        query = query.where("organizationId", "==", organizationId);
      }
      const snap = await query.get();
      state[col] = new Map();
      snap.forEach((doc) => {
        state[col].set(doc.id, { id: doc.id, ...doc.data() });
      });
    }
    return state;
  }

  function computeDiff(before, after) {
    const diff = {
      created: [],
      updated: [],
      deleted: [],
      stockMovements: [],
      accountTransactions: [],
      auditLogs: [],
      balanceChanges: [],
    };

    const allCols = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const col of allCols) {
      const bMap = before[col] || new Map();
      const aMap = after[col] || new Map();

      for (const [id, aDoc] of aMap.entries()) {
        if (!bMap.has(id)) {
          diff.created.push({ collection: col, id, doc: aDoc });
          if (col === "stockMovements") diff.stockMovements.push(aDoc);
          if (col === "accountTransactions") diff.accountTransactions.push(aDoc);
          if (col === "auditLogs") diff.auditLogs.push(aDoc);
        } else {
          const bDoc = bMap.get(id);
          const changedFields = [];
          for (const key of new Set([...Object.keys(bDoc), ...Object.keys(aDoc)])) {
            if (JSON.stringify(bDoc[key]) !== JSON.stringify(aDoc[key])) {
              changedFields.push(key);
            }
          }
          if (changedFields.length > 0) {
            diff.updated.push({ collection: col, id, before: bDoc, after: aDoc, changedFields });
            if (col === "financialAccounts" && changedFields.includes("currentBalance")) {
              diff.balanceChanges.push({
                accountId: id,
                accountName: aDoc.name,
                before: bDoc.currentBalance,
                after: aDoc.currentBalance,
                delta: (aDoc.currentBalance || 0) - (bDoc.currentBalance || 0),
              });
            }
          }
        }
      }

      for (const [id, bDoc] of bMap.entries()) {
        if (!aMap.has(id)) {
          diff.deleted.push({ collection: col, id, doc: bDoc });
        }
      }
    }

    return diff;
  }

  function formatDiffSummary(diff) {
    const lines = [];
    lines.push(`Created: ${diff.created.length} [${diff.created.map((c) => `${c.collection}/${c.id}`).slice(0, 5).join(", ")}${diff.created.length > 5 ? "..." : ""}]`);
    lines.push(`Updated: ${diff.updated.length} [${diff.updated.map((u) => `${u.collection}/${u.id} (${u.changedFields.join(",")})`).slice(0, 5).join(", ")}${diff.updated.length > 5 ? "..." : ""}]`);
    if (diff.accountTransactions.length > 0) {
      lines.push(`AccountTransactions (${diff.accountTransactions.length}):`);
      for (const tx of diff.accountTransactions) {
        lines.push(`  - [${tx.direction || "in"}] ${tx.type || "entry"}: amount=${tx.amount || 0}, accountId=${tx.financialAccountId || "none"}, branchId=${tx.branchId || "none"}, balanceAfter=${tx.balanceAfter !== undefined ? tx.balanceAfter : "none"}`);
      }
    }
    if (diff.stockMovements.length > 0) {
      lines.push(`StockMovements (${diff.stockMovements.length}):`);
      for (const m of diff.stockMovements) {
        lines.push(`  - [${m.type}] qty=${m.quantitySigned || m.quantity || 0}, prod=${m.productId}, branch=${m.branchId}, loc=${m.storageLocationId || "none"}`);
      }
    }
    if (diff.balanceChanges.length > 0) {
      lines.push(`BalanceChanges (${diff.balanceChanges.length}):`);
      for (const b of diff.balanceChanges) {
        lines.push(`  - account ${b.accountId} (${b.accountName}): ${b.before} -> ${b.after} (delta: ${b.delta})`);
      }
    }
    return lines.join("\n");
  }

  return {
    captureState,
    computeDiff,
    formatDiffSummary,
  };
}

module.exports = {
  createStateDiffTracker,
  CORE_COLLECTIONS,
};
