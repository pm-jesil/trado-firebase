/**
 * Migration: Remove duplicate integer-minor fields and enforce single decimal-major convention.
 *
 * Implements Prompt 77D S5:
 *   - Removes `openingBalanceMinor` and `currentBalanceMinor` from `financialAccounts`
 *   - Removes `amountMinor` and `balanceAfterMinor` from `accountTransactions`
 *   - Removes `totalDebitMinor`, `totalCreditMinor`, and line-level `debitMinor`/`creditMinor` from `journalEntries`
 *   - Renames `settings.accountingPolicy.cashCountVarianceThresholdMinor` to `cashCountVarianceThreshold` (major units) in `organizations`
 *   - Converts `minorUnitsThresholds` and `selfApprovalLimits` in `organizations` to decimal major units
 *   - Idempotent: safe to run multiple times.
 *   - Dry-run by default; pass `--apply` to commit updates.
 *
 * Usage:
 *   node functions/scripts/migrate-money-single-convention.cjs          # Dry-run
 *   node functions/scripts/migrate-money-single-convention.cjs --apply  # Live apply
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const CURRENCY_EXPONENTS = {
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3,
  JPY: 0, KRW: 0, VND: 0, CLP: 0, PYG: 0, UGX: 0, RWF: 0,
  INR: 2, AED: 2, USD: 2, EUR: 2, GBP: 2, SAR: 2, QAR: 2,
};

function getExponent(currency) {
  if (!currency) return 2;
  const upper = String(currency).toUpperCase().trim();
  return CURRENCY_EXPONENTS[upper] !== undefined ? CURRENCY_EXPONENTS[upper] : 2;
}

function transformFinancialAccountDoc(data) {
  const updates = {};
  const currency = data.currency || "INR";
  const exp = getExponent(currency);

  if (data.openingBalance === undefined && data.openingBalanceMinor !== undefined) {
    updates.openingBalance = Number((data.openingBalanceMinor / (10 ** exp)).toFixed(exp));
  }
  if (data.currentBalance === undefined && data.currentBalanceMinor !== undefined) {
    updates.currentBalance = Number((data.currentBalanceMinor / (10 ** exp)).toFixed(exp));
  }

  if (data.openingBalanceMinor !== undefined) {
    updates.openingBalanceMinor = FieldValue.delete();
  }
  if (data.currentBalanceMinor !== undefined) {
    updates.currentBalanceMinor = FieldValue.delete();
  }

  return {
    updates,
    isChanged: Object.keys(updates).length > 0,
  };
}

function transformAccountTransactionDoc(data) {
  const updates = {};
  const currency = data.currency || "INR";
  const exp = getExponent(currency);

  if (data.amount === undefined && data.amountMinor !== undefined) {
    updates.amount = Number((data.amountMinor / (10 ** exp)).toFixed(exp));
  }
  if (data.balanceAfter === undefined && data.balanceAfterMinor !== undefined) {
    updates.balanceAfter = Number((data.balanceAfterMinor / (10 ** exp)).toFixed(exp));
  }

  if (data.amountMinor !== undefined) {
    updates.amountMinor = FieldValue.delete();
  }
  if (data.balanceAfterMinor !== undefined) {
    updates.balanceAfterMinor = FieldValue.delete();
  }

  return {
    updates,
    isChanged: Object.keys(updates).length > 0,
  };
}

function transformJournalEntryDoc(data) {
  const updates = {};
  const currency = data.currency || "INR";
  const exp = getExponent(currency);

  if (data.totalDebit === undefined && data.totalDebitMinor !== undefined) {
    updates.totalDebit = Number((data.totalDebitMinor / (10 ** exp)).toFixed(exp));
  }
  if (data.totalCredit === undefined && data.totalCreditMinor !== undefined) {
    updates.totalCredit = Number((data.totalCreditMinor / (10 ** exp)).toFixed(exp));
  }

  if (data.totalDebitMinor !== undefined) {
    updates.totalDebitMinor = FieldValue.delete();
  }
  if (data.totalCreditMinor !== undefined) {
    updates.totalCreditMinor = FieldValue.delete();
  }

  if (Array.isArray(data.lines)) {
    let linesModified = false;
    const cleanedLines = data.lines.map((l) => {
      if (l.debitMinor !== undefined || l.creditMinor !== undefined) {
        linesModified = true;
        const cleanLine = { ...l };
        if (cleanLine.debit === undefined && cleanLine.debitMinor !== undefined) {
          cleanLine.debit = Number((cleanLine.debitMinor / (10 ** exp)).toFixed(exp));
        }
        if (cleanLine.credit === undefined && cleanLine.creditMinor !== undefined) {
          cleanLine.credit = Number((cleanLine.creditMinor / (10 ** exp)).toFixed(exp));
        }
        delete cleanLine.debitMinor;
        delete cleanLine.creditMinor;
        return cleanLine;
      }
      return l;
    });
    if (linesModified) {
      updates.lines = cleanedLines;
    }
  }

  return {
    updates,
    isChanged: Object.keys(updates).length > 0,
  };
}

function transformOrganizationDoc(data) {
  const updates = {};
  const policy = data.settings?.accountingPolicy;
  if (!policy) {
    return { updates, isChanged: false };
  }

  // Already migrated
  if (policy.moneyConvention === "major") {
    return { updates, isChanged: false };
  }

  const currency = data.currency || "INR";
  const exp = getExponent(currency);
  let changed = false;

  // 1. Rename cashCountVarianceThresholdMinor -> cashCountVarianceThreshold
  if (policy.cashCountVarianceThresholdMinor !== undefined) {
    if (policy.cashCountVarianceThreshold === undefined) {
      updates["settings.accountingPolicy.cashCountVarianceThreshold"] =
        Number((policy.cashCountVarianceThresholdMinor / (10 ** exp)).toFixed(exp));
    }
    updates["settings.accountingPolicy.cashCountVarianceThresholdMinor"] = FieldValue.delete();
    changed = true;
  }

  // 2. Convert minorUnitsThresholds values from minor to major
  if (policy.minorUnitsThresholds && typeof policy.minorUnitsThresholds === "object") {
    const converted = { ...policy.minorUnitsThresholds };
    let thresholdsChanged = false;
    for (const [currKey, val] of Object.entries(converted)) {
      if (typeof val === "number" && val >= 10000) {
        const cExp = getExponent(currKey);
        converted[currKey] = Number((val / (10 ** cExp)).toFixed(cExp));
        thresholdsChanged = true;
      }
    }
    if (thresholdsChanged) {
      updates["settings.accountingPolicy.minorUnitsThresholds"] = converted;
      changed = true;
    }
  }

  // 3. Convert selfApprovalLimits values from minor to major
  if (policy.selfApprovalLimits && typeof policy.selfApprovalLimits === "object") {
    const converted = { ...policy.selfApprovalLimits };
    let limitsChanged = false;
    for (const [currKey, val] of Object.entries(converted)) {
      if (typeof val === "number" && val >= 10000) {
        const cExp = getExponent(currKey);
        converted[currKey] = Number((val / (10 ** cExp)).toFixed(cExp));
        limitsChanged = true;
      }
    }
    if (limitsChanged) {
      updates["settings.accountingPolicy.selfApprovalLimits"] = converted;
      changed = true;
    }
  }

  if (changed) {
    updates["settings.accountingPolicy.moneyConvention"] = "major";
  }

  return {
    updates,
    isChanged: Object.keys(updates).length > 0,
  };
}

async function migrateCollection(db, colName, transformFn, isApply) {
  console.log(`\n--- Migrating collection: ${colName} ---`);
  const snap = await db.collection(colName).get();
  let examined = 0;
  let updated = 0;
  let skipped = 0;

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    examined++;
    const { updates, isChanged } = transformFn(doc.data());
    if (isChanged) {
      updated++;
      if (isApply) {
        batch.update(doc.ref, updates);
        batchCount++;
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    } else {
      skipped++;
    }
  }

  if (isApply && batchCount > 0) {
    await batch.commit();
  }

  console.log(`${colName} summary: examined=${examined}, updated=${updated}, skipped=${skipped}`);
  return { examined, updated, skipped };
}

async function main() {
  const isApply = process.argv.includes("--apply");
  if (!getApps().length) {
    initializeApp({ projectId: "trado-x" });
  }
  const db = getFirestore();

  console.log("=================================================================");
  console.log(`   Prompt 77D S5 Migration: Single Money Convention (${isApply ? "LIVE APPLY" : "DRY RUN"})`);
  console.log("=================================================================");

  const r1 = await migrateCollection(db, "financialAccounts", transformFinancialAccountDoc, isApply);
  const r2 = await migrateCollection(db, "accountTransactions", transformAccountTransactionDoc, isApply);
  const r3 = await migrateCollection(db, "journalEntries", transformJournalEntryDoc, isApply);
  const r4 = await migrateCollection(db, "organizations", transformOrganizationDoc, isApply);

  const totalExamined = r1.examined + r2.examined + r3.examined + r4.examined;
  const totalUpdated = r1.updated + r2.updated + r3.updated + r4.updated;
  const totalSkipped = r1.skipped + r2.skipped + r3.skipped + r4.skipped;

  console.log("\n=================================================================");
  console.log(`TOTALS: examined=${totalExamined}, updated=${totalUpdated}, skipped=${totalSkipped} (mode: ${isApply ? "APPLIED" : "DRY-RUN"})`);
  console.log("=================================================================");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

module.exports = {
  getExponent,
  transformFinancialAccountDoc,
  transformAccountTransactionDoc,
  transformJournalEntryDoc,
  transformOrganizationDoc,
  migrateCollection,
};
