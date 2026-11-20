/**
 * Migration: Remove duplicate integer-minor fields and enforce single decimal-major convention.
 *
 * Implements Prompt 77D S5 / S5b:
 *   - Removes `openingBalanceMinor` and `currentBalanceMinor` from `financialAccounts`
 *   - Removes `amountMinor` and `balanceAfterMinor` from `accountTransactions`
 *   - Removes `totalDebitMinor`, `totalCreditMinor`, and line-level `debitMinor`/`creditMinor` from `journalEntries`
 *     (NOTE: line items are rewritten by replacing the whole `lines` array, NEVER using FieldValue.delete inside arrays)
 *   - Renames `settings.accountingPolicy.cashCountVarianceThresholdMinor` to `cashCountVarianceThreshold` (major units) in `organizations`
 *   - Converts `minorUnitsThresholds` and `selfApprovalLimits` in `organizations` to decimal major units
 *   - Doc currency resolution: comes from document, or derived from parent organization doc. Docs without currency are skipped and listed.
 *   - Walks both root and nested paths via collection groups (e.g. `organizations/{orgId}/...`).
 *   - Safety guard: `--apply` refuses to run unless `FIRESTORE_EMULATOR_HOST` is set or `--project <id>` is explicitly passed.
 *   - Idempotent: safe to run multiple times.
 *
 * Usage:
 *   node functions/scripts/migrate-money-single-convention.cjs                            # Dry-run
 *   node functions/scripts/migrate-money-single-convention.cjs --apply                    # Live apply against emulator
 *   node functions/scripts/migrate-money-single-convention.cjs --apply --project trado-x  # Live apply with explicit project
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";

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

/**
 * Transforms financialAccounts document.
 */
function transformFinancialAccountDoc(data, orgCurrency) {
  const currency = data.currency || orgCurrency;
  if (!currency) {
    return { updates: {}, isChanged: false, noCurrency: true };
  }

  const updates = {};
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
    noCurrency: false,
  };
}

/**
 * Transforms accountTransactions document.
 */
function transformAccountTransactionDoc(data, orgCurrency) {
  const currency = data.currency || orgCurrency;
  if (!currency) {
    return { updates: {}, isChanged: false, noCurrency: true };
  }

  const updates = {};
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
    noCurrency: false,
  };
}

/**
 * Transforms journalEntries document.
 * (a) Rewrites the whole lines array to remove debitMinor/creditMinor; never uses FieldValue.delete in arrays.
 */
function transformJournalEntryDoc(data, orgCurrency) {
  const currency = data.currency || orgCurrency;
  if (!currency) {
    return { updates: {}, isChanged: false, noCurrency: true };
  }

  const updates = {};
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

  // Rewrite whole lines array
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
      updates.lines = cleanedLines; // Rewrites whole array
    }
  }

  return {
    updates,
    isChanged: Object.keys(updates).length > 0,
    noCurrency: false,
  };
}

/**
 * Transforms organization document.
 */
function transformOrganizationDoc(data) {
  const updates = {};
  const policy = data.settings?.accountingPolicy;
  if (!policy) {
    return { updates, isChanged: false, noCurrency: false };
  }

  if (policy.moneyConvention === "major") {
    return { updates, isChanged: false, noCurrency: false };
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
    noCurrency: false,
  };
}

/**
 * Migrates a collection (supports collection groups for organizations/{orgId}/... paths).
 */
async function migrateCollection(db, colName, transformFn, orgCurrencyMap, isApply) {
  console.log(`\n--- Migrating collection group: ${colName} ---`);
  // Use collectionGroup so that nested collections like organizations/{orgId}/... are found
  const snap = await db.collectionGroup(colName).get();
  let examined = 0;
  let updated = 0;
  let skipped = 0;
  let noCurrencyCount = 0;
  const noCurrencyDocs = [];

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    examined++;
    const data = doc.data();

    // Resolve organizationId: either doc.organizationId or parent path organizations/{orgId}/...
    let orgId = data.organizationId;
    if (!orgId && doc.ref.parent && doc.ref.parent.parent && doc.ref.parent.parent.parent?.id === "organizations") {
      orgId = doc.ref.parent.parent.id;
    }
    const orgCurrency = orgId ? orgCurrencyMap.get(orgId) : undefined;

    const { updates, isChanged, noCurrency } = transformFn(data, orgCurrency);

    if (noCurrency) {
      noCurrencyCount++;
      noCurrencyDocs.push({ collection: colName, path: doc.ref.path, id: doc.id });
      skipped++;
      continue;
    }

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

  console.log(`${colName} summary: examined=${examined}, wouldChange=${updated}, skipped=${skipped}, noCurrency=${noCurrencyCount}`);
  if (noCurrencyDocs.length > 0) {
    console.log(`  Skipped documents with no currency (${noCurrencyDocs.length}):`, noCurrencyDocs);
  }

  return { examined, updated, skipped, noCurrencyCount, noCurrencyDocs };
}

async function runMigration(options = {}) {
  const isApply = options.apply || process.argv.includes("--apply");
  const projectArgIndex = process.argv.indexOf("--project");
  const explicitProject = options.projectId || (projectArgIndex !== -1 ? process.argv[projectArgIndex + 1] : null);

  // Safety check for live apply (D3-c)
  if (isApply) {
    const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (!hasEmulator && !explicitProject) {
      throw new Error("FATAL: --apply refuses to run unless FIRESTORE_EMULATOR_HOST is set or an explicit --project <id> is passed.");
    }
  }

  const projectId = explicitProject || process.env.GCLOUD_PROJECT || "trado-x";
  if (!getApps().length) {
    initializeApp({ projectId });
  }
  const db = getFirestore();

  console.log("=================================================================");
  console.log(`   Prompt 77D S5/S5b Migration: Single Money Convention (${isApply ? "LIVE APPLY" : "DRY RUN"})`);
  console.log(`   Target Project: ${projectId}`);
  console.log(`   Firestore Host: ${process.env.FIRESTORE_EMULATOR_HOST || "production/live"}`);
  console.log("=================================================================");

  // Pre-load all organizations for currency resolution (D3-b)
  console.log("\n--- Pre-loading organizations map ---");
  const orgsSnap = await db.collection("organizations").get();
  const orgCurrencyMap = new Map();
  orgsSnap.docs.forEach((d) => {
    const data = d.data();
    orgCurrencyMap.set(d.id, data.currency || "INR");
  });
  console.log(`Loaded ${orgCurrencyMap.size} organizations for currency lookup.`);

  // 1. Migrate financialAccounts (walks root & organizations/{orgId}/financialAccounts)
  const r1 = await migrateCollection(db, "financialAccounts", transformFinancialAccountDoc, orgCurrencyMap, isApply);

  // 2. Migrate accountTransactions (walks root & nested)
  const r2 = await migrateCollection(db, "accountTransactions", transformAccountTransactionDoc, orgCurrencyMap, isApply);

  // 3. Migrate journalEntries (walks root & nested)
  const r3 = await migrateCollection(db, "journalEntries", transformJournalEntryDoc, orgCurrencyMap, isApply);

  // 4. Migrate organizations
  console.log("\n--- Migrating collection: organizations ---");
  let orgExamined = 0;
  let orgUpdated = 0;
  let orgSkipped = 0;
  let orgBatch = db.batch();
  let orgBatchCount = 0;

  for (const doc of orgsSnap.docs) {
    orgExamined++;
    const { updates, isChanged } = transformOrganizationDoc(doc.data());
    if (isChanged) {
      orgUpdated++;
      if (isApply) {
        orgBatch.update(doc.ref, updates);
        orgBatchCount++;
        if (orgBatchCount >= 400) {
          await orgBatch.commit();
          orgBatch = db.batch();
          orgBatchCount = 0;
        }
      }
    } else {
      orgSkipped++;
    }
  }
  if (isApply && orgBatchCount > 0) {
    await orgBatch.commit();
  }
  console.log(`organizations summary: examined=${orgExamined}, wouldChange=${orgUpdated}, skipped=${orgSkipped}, noCurrency=0`);

  const totalExamined = r1.examined + r2.examined + r3.examined + orgExamined;
  const totalWouldChange = r1.updated + r2.updated + r3.updated + orgUpdated;
  const totalSkipped = r1.skipped + r2.skipped + r3.skipped + orgSkipped;
  const totalNoCurrency = r1.noCurrencyCount + r2.noCurrencyCount + r3.noCurrencyCount;

  console.log("\n=================================================================");
  console.log(`TOTALS: examined=${totalExamined}, wouldChange=${totalWouldChange}, skipped=${totalSkipped}, noCurrency=${totalNoCurrency} (mode: ${isApply ? "APPLIED" : "DRY-RUN"})`);
  console.log("=================================================================");

  return {
    financialAccounts: r1,
    accountTransactions: r2,
    journalEntries: r3,
    organizations: { examined: orgExamined, updated: orgUpdated, skipped: orgSkipped, noCurrencyCount: 0 },
    totals: { examined: totalExamined, wouldChange: totalWouldChange, skipped: totalSkipped, noCurrency: totalNoCurrency },
  };
}

if (require.main === module) {
  runMigration().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  });
}

module.exports = {
  getExponent,
  transformFinancialAccountDoc,
  transformAccountTransactionDoc,
  transformJournalEntryDoc,
  transformOrganizationDoc,
  runMigration,
};
