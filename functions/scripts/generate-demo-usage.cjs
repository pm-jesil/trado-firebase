#!/usr/bin/env node
/**
 * Demo Usage History Generator (prompt 66 §9).
 *
 * Populates 30 days of realistic daily rollups (organizationUsageDaily and userUsageDaily)
 * for demo tenants and users, providing immediate rich data for Flutter analytics dashboards,
 * Super Admin consumption ranking, time-of-day charts, and user activity drill-downs.
 *
 * Test and demo project IDs stay separate.
 *
 * Usage:
 *   node functions/scripts/generate-demo-usage.cjs [--days 30]
 */

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "trado-x" });
}

const db = getFirestore();

const DEMO_ORGS = [
  { id: "demo-org-fresh-mart", name: "Fresh Mart Retail", baseCalls: 350, users: ["usr-fm-owner", "usr-fm-cashier", "usr-fm-inventory"] },
  { id: "demo-org-quick-bites", name: "Quick Bites Cafe", baseCalls: 180, users: ["usr-qb-owner", "usr-qb-manager"] },
  { id: "demo-org-apex-logistics", name: "Apex Logistics", baseCalls: 520, users: ["usr-apex-owner", "usr-apex-dispatcher", "usr-apex-driver-1", "usr-apex-driver-2"] },
];

const CALLABLES = [
  { name: "billsCreate", reads: 6, writes: 3, deletes: 0, weight: 0.25 },
  { name: "billsList", reads: 15, writes: 0, deletes: 0, weight: 0.20 },
  { name: "productsList", reads: 20, writes: 0, deletes: 0, weight: 0.18 },
  { name: "customersList", reads: 10, writes: 0, deletes: 0, weight: 0.12 },
  { name: "paymentsCreate", reads: 4, writes: 2, deletes: 0, weight: 0.10 },
  { name: "stockAdjust", reads: 3, writes: 2, deletes: 0, weight: 0.08 },
  { name: "outflowsCreate", reads: 4, writes: 2, deletes: 0, weight: 0.07 },
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const numDays = daysIndex !== -1 && args[daysIndex + 1] ? Number(args[daysIndex + 1]) : 30;

  console.log(`\n================================================================`);
  console.log(`   TRADO: DEMO USAGE HISTORY GENERATOR (30 Days)`);
  console.log(`================================================================\n`);
  console.log(`Generating ${numDays} days of usage history for ${DEMO_ORGS.length} demo organizations...`);

  const now = new Date();
  let totalOrgDocs = 0;
  let totalUserDocs = 0;

  for (let d = numDays - 1; d >= 0; d--) {
    const targetDate = new Date(now);
    targetDate.setUTCDate(now.getUTCDate() - d);
    const dateStr = targetDate.toISOString().slice(0, 10);
    const dayOfWeek = targetDate.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekendMultiplier = isWeekend ? 1.35 : 1.0; // retail peaks on weekends

    const expireDate = new Date(targetDate);
    expireDate.setUTCMonth(expireDate.getUTCMonth() + 25);
    const expireAt = Timestamp.fromDate(expireDate);

    const batch = db.batch();

    for (const org of DEMO_ORGS) {
      const dailyCalls = Math.round(org.baseCalls * weekendMultiplier * (0.85 + Math.random() * 0.3));
      let totalReads = 0;
      let totalWrites = 0;
      let totalDeletes = 0;
      let durationMsSum = 0;
      const byCallable = {};
      const byCollection = {
        "organizations/{id}/bills": { reads: 0, writes: 0, deletes: 0 },
        "organizations/{id}/products": { reads: 0, writes: 0, deletes: 0 },
        "organizations/{id}/customers": { reads: 0, writes: 0, deletes: 0 },
        "organizations/{id}/payments": { reads: 0, writes: 0, deletes: 0 },
      };
      const hourly = {};
      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, "0");
        hourly[hh] = { calls: 0, reads: 0, writes: 0, deletes: 0 };
      }

      // Per-user buckets
      const userBuckets = {};
      for (const uid of org.users) {
        userBuckets[uid] = {
          calls: 0,
          reads: 0,
          writes: 0,
          deletes: 0,
          durationMsSum: 0,
          byCallable: {},
          devices: { [`device-${uid}-primary`]: { calls: 0 } },
        };
      }

      for (let c = 0; c < dailyCalls; c++) {
        // pick hour (weighted business hours: 9am - 9pm)
        const hour = Math.random() < 0.85 ? randomBetween(9, 21) : randomBetween(0, 23);
        const hh = String(hour).padStart(2, "0");

        // pick callable
        const rand = Math.random();
        let cum = 0;
        let selectedCallable = CALLABLES[0];
        for (const call of CALLABLES) {
          cum += call.weight;
          if (rand <= cum) {
            selectedCallable = call;
            break;
          }
        }

        const callReads = selectedCallable.reads + randomBetween(0, 2);
        const callWrites = selectedCallable.writes;
        const callDeletes = selectedCallable.deletes;
        const duration = randomBetween(25, 75);

        totalReads += callReads;
        totalWrites += callWrites;
        totalDeletes += callDeletes;
        durationMsSum += duration;

        // rollups
        hourly[hh].calls++;
        hourly[hh].reads += callReads;
        hourly[hh].writes += callWrites;
        hourly[hh].deletes += callDeletes;

        byCallable[selectedCallable.name] = byCallable[selectedCallable.name] || { calls: 0, reads: 0, writes: 0, deletes: 0 };
        byCallable[selectedCallable.name].calls++;
        byCallable[selectedCallable.name].reads += callReads;
        byCallable[selectedCallable.name].writes += callWrites;

        // user distribution
        const user = org.users[c % org.users.length];
        const uBucket = userBuckets[user];
        uBucket.calls++;
        uBucket.reads += callReads;
        uBucket.writes += callWrites;
        uBucket.durationMsSum += duration;
        uBucket.byCallable[selectedCallable.name] = uBucket.byCallable[selectedCallable.name] || { calls: 0, reads: 0, writes: 0, deletes: 0 };
        uBucket.byCallable[selectedCallable.name].calls++;
        uBucket.byCallable[selectedCallable.name].reads += callReads;
        uBucket.devices[`device-${user}-primary`].calls++;
      }

      const gateReads = dailyCalls * 5; // 5 docs per gate read
      const auditWrites = totalWrites > 0 ? Math.round(totalWrites * 0.9) : 0;
      const meterWrites = dailyCalls * 2;

      // 1. Organization Day Document
      const orgDocRef = db.collection("organizationUsageDaily").doc(`${org.id}_${dateStr}`);
      batch.set(orgDocRef, {
        organizationId: org.id,
        date: dateStr,
        calls: dailyCalls,
        errors: Math.floor(dailyCalls * 0.005),
        denied: Math.floor(dailyCalls * 0.002),
        durationMsSum,
        bytesIn: dailyCalls * randomBetween(120, 350),
        bytesOut: dailyCalls * randomBetween(450, 1200),
        ops: {
          reads: totalReads + gateReads,
          writes: totalWrites + auditWrites + meterWrites,
          deletes: totalDeletes,
          aggregationReads: 0,
        },
        byCategory: {
          gate: { reads: gateReads, writes: 0, deletes: 0 },
          app: { reads: totalReads, writes: totalWrites, deletes: totalDeletes },
          audit: { reads: 0, writes: auditWrites, deletes: 0 },
          meter: { reads: 0, writes: meterWrites, deletes: 0 },
        },
        byCallable,
        byCollection,
        hourly,
        redundantReads: Math.floor(dailyCalls * 0.01),
        expireAt,
      });
      totalOrgDocs++;

      // 2. User Day Documents
      for (const [uid, uData] of Object.entries(userBuckets)) {
        if (uData.calls === 0) continue;
        const userDocRef = db.collection("userUsageDaily").doc(`${org.id}_${uid}_${dateStr}`);
        const userGateReads = uData.calls * 5;
        const userAuditWrites = uData.writes > 0 ? Math.round(uData.writes * 0.9) : 0;
        const userMeterWrites = uData.calls * 2;

        batch.set(userDocRef, {
          organizationId: org.id,
          uid,
          date: dateStr,
          calls: uData.calls,
          errors: 0,
          denied: 0,
          durationMsSum: uData.durationMsSum,
          bytesIn: uData.calls * 200,
          bytesOut: uData.calls * 800,
          ops: {
            reads: uData.reads + userGateReads,
            writes: uData.writes + userAuditWrites + userMeterWrites,
            deletes: uData.deletes,
            aggregationReads: 0,
          },
          byCategory: {
            gate: { reads: userGateReads, writes: 0, deletes: 0 },
            app: { reads: uData.reads, writes: uData.writes, deletes: uData.deletes },
            audit: { reads: 0, writes: userAuditWrites, deletes: 0 },
            meter: { reads: 0, writes: userMeterWrites, deletes: 0 },
          },
          byCallable: uData.byCallable,
          devices: uData.devices,
          firstSeenAt: Timestamp.fromDate(new Date(`${dateStr}T09:00:00.000Z`)),
          lastSeenAt: Timestamp.fromDate(new Date(`${dateStr}T21:30:00.000Z`)),
          expireAt,
        });
        totalUserDocs++;
      }
    }

    await batch.commit();
  }

  console.log(`✓ Generated ${totalOrgDocs} organizationUsageDaily documents.`);
  console.log(`✓ Generated ${totalUserDocs} userUsageDaily documents.`);
  console.log(`✓ 30-day realistic usage history successfully populated!`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Demo usage generator failed:", err);
    process.exit(1);
  });
}

module.exports = { main };

