/**
 * Remove legacy `taxNumber` field (D-7 policy) from customers and vendors.
 * Also removes legacy flat `billingAddress`/`shippingAddress` string fields
 * (canonical: `addresses[]` array).
 * Also removes `whatsApp` field (D-15 sibling sweep — `phone` is canonical).
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp({ projectId: "trado-x" });
const db = getFirestore();

async function cleanCollection(col, fieldsToRemove) {
  const snap = await db.collection(col).get();
  let count = 0;
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const updates = {};
    for (const field of fieldsToRemove) {
      if (field in data) {
        updates[field] = FieldValue.delete();
      }
    }
    if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
      count++;
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }
  if (batchCount > 0) await batch.commit();
  console.log(`  ${col}: removed legacy fields from ${count} documents`);
  return count;
}

async function main() {
  console.log("=================================================================");
  console.log("   D-7 / Sibling Sweep Migration: Remove Legacy Fields");
  console.log("=================================================================");

  // D-7: Remove taxNumber (banned alias for taxId)
  const c1 = await cleanCollection("customers", ["taxNumber", "whatsApp", "billingAddress", "shippingAddress"]);
  const c2 = await cleanCollection("vendors", ["taxNumber", "whatsApp"]);

  console.log(`\nTotal documents cleaned: ${c1 + c2}`);
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });

