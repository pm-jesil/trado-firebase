#!/usr/bin/env node
/**
 * Migration: Ensure existing Owner roles hold org:view, org:update, org:manage_legal_profile,
 * and org:manage_bank_details (BX2 C-2 #3 / BS-15, D-54).
 *
 * Default mode: DRY-RUN (changes 0 documents). Pass `--apply` to write changes.
 * Idempotent: running `--apply` a second time changes 0 documents.
 * Writes one `auditLogs` entry per modified organization/role.
 * Emulator-safe: aborts if pointed at production without local loopback emulator.
 *
 * Usage:
 *   node functions/scripts/migrate-org-owner-permissions.cjs            # Dry-run
 *   node functions/scripts/migrate-org-owner-permissions.cjs --apply    # Apply changes
 */

const { enforceLocalEmulatorSafety, db } = require("./helpers/emulator-helper.cjs");
const { Timestamp } = require("firebase-admin/firestore");

enforceLocalEmulatorSafety();

const REQUIRED_OWNER_PERMISSIONS = [
  "org:view",
  "org:update",
  "org:manage_legal_profile",
  "org:manage_bank_details",
];

async function runOrgOwnerPermissionsMigration(options = {}) {
  const apply = options.apply !== undefined ? !!options.apply : process.argv.includes("--apply");
  const rolesSnap = await db.collection("roles").get();

  let examined = 0;
  let updated = 0;
  let unchanged = 0;
  let auditEntriesWritten = 0;

  for (const doc of rolesSnap.docs) {
    const role = doc.data();
    const isOwnerRole = doc.id === "role_org_owner" || role.code === "org_owner";
    if (!isOwnerRole) continue;
    examined++;

    const perms = Array.isArray(role.permissions) ? role.permissions : [];
    const permSet = new Set(perms);
    if (permSet.has("*")) {
      unchanged++;
      continue;
    }

    const missing = REQUIRED_OWNER_PERMISSIONS.filter((p) => !permSet.has(p));
    if (missing.length === 0) {
      unchanged++;
      continue;
    }

    const updatedPerms = [...perms, ...missing];
    if (apply) {
      const now = new Date();
      const nowIso = now.toISOString();
      const batch = db.batch();
      batch.update(doc.ref, {
        permissions: updatedPerms,
        updatedAt: nowIso,
        migration: "bx2-org-owner-permissions",
      });
      const auditRef = db.collection("auditLogs").doc();
      batch.set(auditRef, {
        logId: auditRef.id,
        organizationId: role.organizationId || "platform",
        scope: role.organizationId ? "organization" : "platform",
        action: "role.migrate_owner_permissions",
        operation: "update",
        category: "admin",
        entityType: "role",
        entityId: doc.id,
        actorUid: "system",
        actorRole: "system",
        status: "succeeded",
        changedFields: ["permissions"],
        details: { addedPermissions: missing, migration: "bx2-org-owner-permissions" },
        occurredAt: Timestamp.fromDate(now),
        createdAt: nowIso,
      });
      await batch.commit();
      auditEntriesWritten++;
    }
    updated++;
  }

  console.log(`[migrate-org-owner-permissions] mode=${apply ? "APPLY" : "DRY-RUN"} examined=${examined} updated=${updated} unchanged=${unchanged} auditEntriesWritten=${auditEntriesWritten}`);
  return { apply, examined, updated, unchanged, auditEntriesWritten };
}

if (require.main === module) {
  runOrgOwnerPermissionsMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { runOrgOwnerPermissionsMigration, REQUIRED_OWNER_PERMISSIONS };
