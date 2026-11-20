/**
 * Summary Service — Incremental Daily & Monthly Aggregations
 * 
 * Provides maintained summary aggregations over source-of-truth collections:
 * - `dailySummaries/{organizationId}_{date}`
 * - `monthlySummaries/{organizationId}_{yearMonth}`
 * 
 * Avoids expensive full-collection scans on every dashboard load.
 */

import { db } from "./firebase.js";
import { Money } from "./money.js";
import { DailySummaryDoc, MonthlySummaryDoc, BillDoc, OutflowDoc, OrganizationDoc } from "../types/models.js";

/**
 * Incrementally records a finalized bill into daily and monthly summaries.
 */
export async function recordBillSummary(
  bill: BillDoc,
  cogsAmount: number = 0
): Promise<void> {
  const dateStr = (bill.createdAt || new Date().toISOString()).slice(0, 10);
  const yearMonth = dateStr.slice(0, 7);
  const orgId = bill.organizationId;

  const dailyDocId = `${orgId}_${dateStr}`;
  const monthlyDocId = `${orgId}_${yearMonth}`;

  const dailyRef = db.collection("dailySummaries").doc(dailyDocId);
  const monthlyRef = db.collection("monthlySummaries").doc(monthlyDocId);

  await db.runTransaction(async (tx) => {
    // 1. Execute ALL reads first
    const dailySnap = await tx.get(dailyRef);
    const monthlySnap = await tx.get(monthlyRef);
    const orgSnap = await tx.get(db.collection("organizations").doc(orgId));
    const currency = (bill as any).currency || (orgSnap.data() as OrganizationDoc | undefined)?.currency || "INR";

    // 2. Prepare daily summary
    const existingDaily: DailySummaryDoc = dailySnap.exists
      ? (dailySnap.data() as DailySummaryDoc)
      : {
        organizationId: orgId,
        date: dateStr,
        totalRevenue: 0,
        totalExpenses: 0,
        cogs: 0,
        grossProfit: 0,
        netProfit: 0,
        billCount: 0,
        outflowCount: 0,
        paymentBreakdown: { cash: 0, upi: 0, card: 0, bank_transfer: 0, credit: 0, other: 0 },
        updatedAt: new Date().toISOString(),
      };

    const newDailyRevenue = Money.amount(existingDaily.totalRevenue + (bill.totalAmount || 0), currency);
    const newDailyCogs = Money.amount(existingDaily.cogs + cogsAmount, currency);
    const newDailyGrossProfit = Money.amount(newDailyRevenue - newDailyCogs, currency);
    const newDailyNetProfit = Money.amount(newDailyGrossProfit - existingDaily.totalExpenses, currency);

    // 3. Prepare monthly summary
    const existingMonthly: MonthlySummaryDoc = monthlySnap.exists
      ? (monthlySnap.data() as MonthlySummaryDoc)
      : {
        organizationId: orgId,
        yearMonth,
        totalRevenue: 0,
        totalExpenses: 0,
        cogs: 0,
        grossProfit: 0,
        netProfit: 0,
        billCount: 0,
        outflowCount: 0,
        daysRecorded: 0,
        updatedAt: new Date().toISOString(),
      };

    const newMonthlyRevenue = Money.amount(existingMonthly.totalRevenue + (bill.totalAmount || 0), currency);
    const newMonthlyCogs = Money.amount(existingMonthly.cogs + cogsAmount, currency);
    const newMonthlyGrossProfit = Money.amount(newMonthlyRevenue - newMonthlyCogs, currency);
    const newMonthlyNetProfit = Money.amount(newMonthlyGrossProfit - existingMonthly.totalExpenses, currency);

    // 4. Execute ALL writes after reads
    tx.set(
      dailyRef,
      {
        ...existingDaily,
        totalRevenue: newDailyRevenue,
        cogs: newDailyCogs,
        grossProfit: newDailyGrossProfit,
        netProfit: newDailyNetProfit,
        billCount: existingDaily.billCount + 1,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    tx.set(
      monthlyRef,
      {
        ...existingMonthly,
        totalRevenue: newMonthlyRevenue,
        cogs: newMonthlyCogs,
        grossProfit: newMonthlyGrossProfit,
        netProfit: newMonthlyNetProfit,
        billCount: existingMonthly.billCount + 1,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  });
}

/**
 * Incrementally records an outflow (expense/purchase) into daily and monthly summaries.
 */
export async function recordOutflowSummary(outflow: OutflowDoc): Promise<void> {
  const dateStr = (outflow.docDate || outflow.createdAt || new Date().toISOString()).slice(0, 10);
  const yearMonth = dateStr.slice(0, 7);
  const orgId = outflow.organizationId;

  const dailyDocId = `${orgId}_${dateStr}`;
  const monthlyDocId = `${orgId}_${yearMonth}`;

  const dailyRef = db.collection("dailySummaries").doc(dailyDocId);
  const monthlyRef = db.collection("monthlySummaries").doc(monthlyDocId);

  await db.runTransaction(async (tx) => {
    // 1. Execute ALL reads first
    const dailySnap = await tx.get(dailyRef);
    const monthlySnap = await tx.get(monthlyRef);
    const orgSnap = await tx.get(db.collection("organizations").doc(orgId));
    const currency = (outflow as any).currency || (orgSnap.data() as OrganizationDoc | undefined)?.currency || "INR";

    // 2. Prepare daily summary
    const existingDaily: DailySummaryDoc = dailySnap.exists
      ? (dailySnap.data() as DailySummaryDoc)
      : {
        organizationId: orgId,
        date: dateStr,
        totalRevenue: 0,
        totalExpenses: 0,
        cogs: 0,
        grossProfit: 0,
        netProfit: 0,
        billCount: 0,
        outflowCount: 0,
        paymentBreakdown: { cash: 0, upi: 0, card: 0, bank_transfer: 0, credit: 0, other: 0 },
        updatedAt: new Date().toISOString(),
      };

    const newDailyExpenses = Money.amount(existingDaily.totalExpenses + (outflow.totalAmount || 0), currency);
    const newDailyNetProfit = Money.amount(existingDaily.grossProfit - newDailyExpenses, currency);

    // 3. Prepare monthly summary
    const existingMonthly: MonthlySummaryDoc = monthlySnap.exists
      ? (monthlySnap.data() as MonthlySummaryDoc)
      : {
        organizationId: orgId,
        yearMonth,
        totalRevenue: 0,
        totalExpenses: 0,
        cogs: 0,
        grossProfit: 0,
        netProfit: 0,
        billCount: 0,
        outflowCount: 0,
        daysRecorded: 0,
        updatedAt: new Date().toISOString(),
      };

    const newMonthlyExpenses = Money.amount(existingMonthly.totalExpenses + (outflow.totalAmount || 0), currency);
    const newMonthlyNetProfit = Money.amount(existingMonthly.grossProfit - newMonthlyExpenses, currency);

    // 4. Execute ALL writes after reads
    tx.set(
      dailyRef,
      {
        ...existingDaily,
        totalExpenses: newDailyExpenses,
        netProfit: newDailyNetProfit,
        outflowCount: existingDaily.outflowCount + 1,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    tx.set(
      monthlyRef,
      {
        ...existingMonthly,
        totalExpenses: newMonthlyExpenses,
        netProfit: newMonthlyNetProfit,
        outflowCount: existingMonthly.outflowCount + 1,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  });
}
