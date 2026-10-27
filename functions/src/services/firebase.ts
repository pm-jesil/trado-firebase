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
db.settings({ ignoreUndefinedProperties: true });
export const auth: Auth = getAuth(app);
