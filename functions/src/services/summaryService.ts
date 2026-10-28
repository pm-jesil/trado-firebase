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
import { round2 } from "./money.js";
import { DailySummaryDoc, MonthlySummaryDoc, BillDoc, OutflowDoc } from "../types/models.js";

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
        topProducts: [],
        updatedAt: new Date().toISOString(),
      };

    const newDailyRevenue = round2(existingDaily.totalRevenue + (bill.totalAmount || 0));
    const newDailyCogs = round2(existingDaily.cogs + cogsAmount);
    const newDailyGrossProfit = round2(newDailyRevenue - newDailyCogs);
    const newDailyNetProfit = round2(newDailyGrossProfit - existingDaily.totalExpenses);

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

    const newMonthlyRevenue = round2(existingMonthly.totalRevenue + (bill.totalAmount || 0));
    const newMonthlyCogs = round2(existingMonthly.cogs + cogsAmount);
    const newMonthlyGrossProfit = round2(newMonthlyRevenue - newMonthlyCogs);
    const newMonthlyNetProfit = round2(newMonthlyGrossProfit - existingMonthly.totalExpenses);

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
        topProducts: [],
        updatedAt: new Date().toISOString(),
      };

    const newDailyExpenses = round2(existingDaily.totalExpenses + (outflow.totalAmount || 0));
    const newDailyNetProfit = round2(existingDaily.grossProfit - newDailyExpenses);

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

    const newMonthlyExpenses = round2(existingMonthly.totalExpenses + (outflow.totalAmount || 0));
    const newMonthlyNetProfit = round2(existingMonthly.grossProfit - newMonthlyExpenses);

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
