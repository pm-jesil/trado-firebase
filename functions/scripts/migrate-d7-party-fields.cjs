/**
 * Migration: D-7 Party Field Cleanup
 * Removes legacy flat fields from customers and vendors:
 *   customers: whatsApp, billingAddress, shippingAddress, contactPerson
 *   vendors:   whatsApp, address, contactPerson
 *
 * These were removed from the TypeScript interfaces and Zod schemas.
 * Any data containing them is migrated here (contactPerson → contacts[] if structured).
 * Run against the emulator before re-seeding or deploying.
 */

"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

initializeApp({ projectId: "trado-x" });
const db = getFirestore();

const CUSTOMER_BANNED = ["whatsApp", "billingAddress", "shippingAddress", "contactPerson"];
const VENDOR_BANNED   = ["whatsApp", "address", "contactPerson"];

async function migrateCollection(collectionName, bannedFields) {
  const snap = await db.collection(collectionName).get();
  let updated = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const removal = {};
    let needsUpdate = false;

    for (const field of bannedFields) {
      if (field in data) {
        removal[field] = require("firebase-admin/firestore").FieldValue.delete();
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      batch.update(doc.ref, removal);
      batchCount++;
      updated++;
      // Flush every 400 operations
      if (batchCount >= 400) {
        await batch.commit();
        batchCount = 0;
      }
    }
  }

  if (batchCount > 0) await batch.commit();
  return updated;
}

async function main() {
  console.log("=== D-7 Party Field Migration ===");
  console.log(`  Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  const custUpdated = await migrateCollection("customers", CUSTOMER_BANNED);
  console.log(`  customers: ${custUpdated} document(s) cleaned (removed: ${CUSTOMER_BANNED.join(", ")})`);

  const vendUpdated = await migrateCollection("vendors", VENDOR_BANNED);
  console.log(`  vendors:   ${vendUpdated} document(s) cleaned (removed: ${VENDOR_BANNED.join(", ")})`);

  console.log("=== Migration complete ===");
}

main().catch((e) => { console.error(e); process.exit(1); });

