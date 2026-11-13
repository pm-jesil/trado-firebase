/**
 * Firebase Admin SDK Initialization
 */

import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";
import { getStorage, Storage } from "firebase-admin/storage";
import { instrument } from "./meteredFirestore.js";
import { installShadowCounter } from "./shadowCounter.js";
import { setCommitHook } from "./meteredFirestore.js";
import { recordCommitEvent } from "./auditRecorder.js";

let app: App;
const defaultProjectId = process.env.GCLOUD_PROJECT || "trado-x";
const defaultBucketName = process.env.STORAGE_BUCKET_NAME || `${defaultProjectId}.appspot.com`;

if (getApps().length === 0) {
  process.env.GCLOUD_PROJECT = defaultProjectId;
  app = initializeApp({
    projectId: defaultProjectId,
    storageBucket: defaultBucketName,
  });
} else {
  app = getApps()[0]!;
  if (!app.options.storageBucket) {
    (app.options as { storageBucket?: string }).storageBucket = defaultBucketName;
  }
}

export const adminApp = app;
const rawFirestore: Firestore = getFirestore(app);
try {
  rawFirestore.settings({ ignoreUndefinedProperties: true });
} catch {
  // Ignore if already configured
}
/** The only Firestore production code uses: every operation is counted (services/meteredFirestore.ts). */
export const db: Firestore = instrument(rawFirestore);
// The one audit recording point: every business commit gets its event in the same commit (D-23).
setCommitHook(recordCommitEvent);
// Emulator only: an independent second count, compared per request (services/shadowCounter.ts).
if (process.env.FUNCTIONS_EMULATOR === "true") installShadowCounter(rawFirestore);
export const auth: Auth = getAuth(app);
export const storage: Storage = getStorage(app);
export function getStorageBucket(name?: string) {
  const bucketName = name || process.env.STORAGE_BUCKET_NAME || app.options.storageBucket || `${process.env.GCLOUD_PROJECT || "trado-x"}.appspot.com`;
  return storage.bucket(bucketName);
}
