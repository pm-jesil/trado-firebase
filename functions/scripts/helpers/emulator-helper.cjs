/**
 * Trado Firebase Backend — Reusable Emulator Lifecycle & Safety Helper
 * 
 * Verifies that the local emulator suite is reachable and operating locally.
 * Strictly aborts if remote/cloud hosts are detected to prevent accidental cloud mutations.
 */

const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const FUNCTIONS_HOST = process.env.FIREBASE_FUNCTIONS_HOST || "http://127.0.0.1:5001";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "trado-x";

// Automatically guarantee local loopback emulator environment variables for Admin SDK
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

function enforceLocalEmulatorSafety() {
  const isLocalFirestore = FIRESTORE_EMULATOR_HOST.includes("127.0.0.1") || FIRESTORE_EMULATOR_HOST.includes("localhost");
  const isLocalAuth = AUTH_EMULATOR_HOST.includes("127.0.0.1") || AUTH_EMULATOR_HOST.includes("localhost");

  if (!isLocalFirestore || !isLocalAuth) {
    console.error("[CRITICAL SAFETY ERROR] Test suite aborted. Emulators must point to local loopback (127.0.0.1).");
    console.error(`Observed Firestore: ${FIRESTORE_EMULATOR_HOST}, Auth: ${AUTH_EMULATOR_HOST}`);
    process.exit(1);
  }

  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
}

const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

async function verifyEmulatorHealth() {
  enforceLocalEmulatorSafety();
  try {
    const authRes = await fetch(`http://${AUTH_EMULATOR_HOST}/`);
    if (!authRes.ok && authRes.status !== 200 && authRes.status !== 404) {
      throw new Error(`Auth emulator responded with HTTP ${authRes.status}`);
    }

    const firestoreRes = await fetch(`http://${FIRESTORE_EMULATOR_HOST}/`);
    if (!firestoreRes.ok && firestoreRes.status !== 200 && firestoreRes.status !== 404) {
      throw new Error(`Firestore emulator responded with HTTP ${firestoreRes.status}`);
    }

    // Ensure platform reference catalogs are seeded if database is fresh
    const planSnap = await db.collection("subscriptionPlans").doc("plan_starter").get();
    if (!planSnap.exists) {
      try {
        const seedModule = require("../../lib/scripts/seed-emulator.js");
        await seedModule.seedReferenceData(db);
      } catch (_) {}
    }

    // Ensure Super Admin exists in Auth and Firestore
    try {
      const { getSuperAdminPersona } = require("./auth-personas.cjs");
      await getSuperAdminPersona();
    } catch (_) {}

    return true;
  } catch (err) {
    console.error("[EMULATOR HEALTH CHECK FAILED] Ensure Firebase Emulators are running (firebase emulators:start):", err.message);
    throw err;
  }
}

module.exports = {
  PROJECT_ID,
  AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST,
  FUNCTIONS_HOST,
  admin,
  db,
  enforceLocalEmulatorSafety,
  verifyEmulatorHealth,
};
