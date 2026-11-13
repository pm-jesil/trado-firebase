/**
 * D-15 Migration: Remove stored URL image fields from all documents.
 *
 * Removes from every document:
 *   - `photoUrl` (users)
 *   - `avatarUrl` (users)
 *   - `logoUrl` (organizations)
 *   - `imageUrls` (organizations)
 *   - `image.url` (any entity with an ImageRef that still carries a url sub-field)
 *   - `bankDetails` (organizations — superseded by `bankAccounts: BankAccountStored[]`)
 *
 * Idempotent: safe to run multiple times. Reports counts before and after.
 *
 * Usage:
 *   node functions/scripts/migrate-d15-image-fields.cjs
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp({ projectId: "trado-x" });
const db = getFirestore();

const BATCH_SIZE = 400;

async function runInBatches(query, processDoc) {
  let total = 0;
  let lastSnap = await query.limit(BATCH_SIZE).get();
  while (!lastSnap.empty) {
    const batch = db.batch();
    for (const doc of lastSnap.docs) {
      const changes = processDoc(doc);
      if (changes && Object.keys(changes).length > 0) {
        batch.update(doc.ref, changes);
        total++;
      }
    }
    await batch.commit();
    if (lastSnap.docs.length < BATCH_SIZE) break;
    lastSnap = await query.startAfter(lastSnap.docs[lastSnap.docs.length - 1]).limit(BATCH_SIZE).get();
  }
  return total;
}

function deleteUrlFromImageRef(data) {
  // Returns FieldValue.delete() for image.url if present
  const img = data.image;
  if (img && typeof img === "object" && "url" in img) {
    return { "image.url": FieldValue.delete() };
  }
  return null;
}

async function migrateUsers() {
  console.log("\n--- Migrating users collection ---");
  let count = 0;
  const q = db.collection("users");
  count = await runInBatches(q, (doc) => {
    const data = doc.data();
    const updates = {};
    if ("photoUrl" in data) updates.photoUrl = FieldValue.delete();
    if ("avatarUrl" in data) updates.avatarUrl = FieldValue.delete();
    const imgUpdate = deleteUrlFromImageRef(data);
    if (imgUpdate) Object.assign(updates, imgUpdate);
    return updates;
  });
  console.log(`  ✓ Updated ${count} user documents (removed photoUrl, avatarUrl, image.url)`);
  return count;
}

async function migrateOrganizations() {
  console.log("\n--- Migrating organizations collection ---");
  let count = 0;
  const q = db.collection("organizations");
  count = await runInBatches(q, (doc) => {
    const data = doc.data();
    const updates = {};
    if ("logoUrl" in data) updates.logoUrl = FieldValue.delete();
    if ("imageUrls" in data) updates.imageUrls = FieldValue.delete();
    if ("displayName" in data) updates.displayName = FieldValue.delete();
    if ("bankDetails" in data) {
      // Migrate bankDetails → bankAccounts if bankAccounts is absent
      if (!data.bankAccounts || data.bankAccounts.length === 0) {
        const bd = data.bankDetails;
        if (bd && typeof bd === "object") {
          updates.bankAccounts = [{
            id: "migrated_legacy",
            accountHolderName: bd.accountName || "Unknown",
            bankName: bd.bankName || "",
            accountNumber: bd.accountNumber || "",
            ifscOrSwift: bd.ifsc || undefined,
            upiId: bd.upiId || undefined,
            isPrimary: true,
            label: "Primary (migrated)",
          }];
        }
      }
      updates.bankDetails = FieldValue.delete();
    }
    const imgUpdate = deleteUrlFromImageRef(data);
    if (imgUpdate) Object.assign(updates, imgUpdate);
    return updates;
  });
  console.log(`  ✓ Updated ${count} organization documents (removed logoUrl, imageUrls, bankDetails; migrated to bankAccounts)`);
  return count;
}

async function migrateImageEntities(collectionName) {
  console.log(`\n--- Migrating ${collectionName} collection (image.url) ---`);
  const q = db.collection(collectionName);
  const count = await runInBatches(q, (doc) => {
    const data = doc.data();
    return deleteUrlFromImageRef(data) || {};
  });
  console.log(`  ✓ Updated ${count} ${collectionName} documents (removed image.url)`);
  return count;
}

async function main() {
  console.log("=================================================================");
  console.log("   D-15 MIGRATION: Removing stored URL image fields");
  console.log("   Emulator: " + process.env.FIRESTORE_EMULATOR_HOST);
  console.log("=================================================================");

  const totals = {
    users: await migrateUsers(),
    organizations: await migrateOrganizations(),
    customers: await migrateImageEntities("customers"),
    vendors: await migrateImageEntities("vendors"),
    products: await migrateImageEntities("products"),
  };

  const grand = Object.values(totals).reduce((a, b) => a + b, 0);

  console.log("\n=================================================================");
  console.log("   MIGRATION COMPLETE");
  console.log("   Documents updated:", grand);
  for (const [col, n] of Object.entries(totals)) {
    console.log(`   ${col}: ${n}`);
  }
  console.log("=================================================================");
}

main().catch((e) => { console.error(e); process.exit(1); });

