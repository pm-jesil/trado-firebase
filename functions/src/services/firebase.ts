/**
 * Firebase Admin SDK Initialization
 */

import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";

let app: App;
if (getApps().length === 0) {
  app = initializeApp();
} else {
  app = getApps()[0]!;
}

export const adminApp = app;
export const db: Firestore = getFirestore(app);
try {
  db.settings({ ignoreUndefinedProperties: true });
} catch {
  // Ignore if already configured
}
export const auth: Auth = getAuth(app);
