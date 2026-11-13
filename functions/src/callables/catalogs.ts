/**
 * Reference Catalog Callables
 * Exposes modules, tax regimes, and permission catalog data.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { onCall } from "../services/callable.js";
import { parseInput } from "../validation/parseInput.js";
import { ContextOnlySchema } from "../validation/schemas.js";
import { db } from "../services/firebase.js";
import { DEFAULT_MODULES, DEFAULT_TAX_REGIMES } from "../constants/catalogs.js";
import { ModuleDoc, TaxRegimeDoc, PermissionCatalogDoc } from "../types/models.js";

export const permissionCatalogList = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const snapshot = await db.collection("permissionCatalog").get();
  const permissions = snapshot.docs.map((doc) => {
    const data = doc.data() as PermissionCatalogDoc;
    return { ...data, code: doc.id };
  });

  return { permissions };
});

export const modulesList = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const snapshot = await db.collection("modules").get();
  let modules = snapshot.docs.map((doc) => {
    const data = doc.data() as ModuleDoc;
    return { ...data, code: doc.id };
  });

  if (modules.length === 0) {
    modules = DEFAULT_MODULES;
  }

  return { modules };
});

export const taxRegimesList = onCall({ region: "asia-south1" }, async (request) => {
  parseInput(ContextOnlySchema, request.data);
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const snapshot = await db.collection("taxRegimes").get();
  let taxRegimes = snapshot.docs.map((doc) => {
    const data = doc.data() as TaxRegimeDoc;
    return { ...data, code: doc.id };
  });

  if (taxRegimes.length === 0) {
    taxRegimes = DEFAULT_TAX_REGIMES;
  }

  return { taxRegimes };
});
