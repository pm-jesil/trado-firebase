/**
 * Migration: Add requests permissions to existing system roles. (Prompt 74, D-46, A-16)
 *
 * Updates top-level `roles` documents to include new `requests:*` permission codes:
 *   - role_admin & role_store_manager: requests:create, requests:create_sensitive, requests:read_own, requests:read_org, requests:comment, requests:manage_org
 *   - role_employee, role_cashier, role_rider, role_purchase_staff: requests:create, requests:read_own, requests:comment
 *   - role_org_owner: '*' (unchanged)
 *
 * Default mode: DRY-RUN. To execute changes, pass `--execute`.
 *
 * Usage:
 *   node functions/scripts/migrate-requests-permissions.cjs            # Dry-run
 *   node functions/scripts/migrate-requests-permissions.cjs --execute  # Applies changes
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

if (!process.env.FIREBASE_CONFIG && !process.env.GCLOUD_PROJECT) {
  try {
    initializeApp({ projectId: "trado-x" });
  } catch {
    // Already initialized
  }
}

const db = getFirestore();

const isExecuteDefault = process.argv.includes("--apply") || process.argv.includes("--execute");

const ADMIN_REQUEST_PERMISSIONS = [
  "requests:create",
  "requests:create_sensitive",
  "requests:read_own",
  "requests:read_org",
  "requests:comment",
  "requests:manage_org",
];

const STAFF_REQUEST_PERMISSIONS = [
  "requests:create",
  "requests:read_own",
  "requests:comment",
];

async function runMigration(options = {}) {
  const isExecute = options.apply !== undefined ? !!options.apply : isExecuteDefault;
  console.log(`=== Requests Permissions Migration (${isExecute ? "APPLY" : "DRY-RUN"}) ===\n`);

  const rolesSnap = await db.collection("roles").get();
  console.log(`Examining ${rolesSnap.size} roles in Firestore...`);

  let examined = 0;
  let updated = 0;
  let unchanged = 0;
  let auditEntriesWritten = 0;

  const batch = db.batch();

  for (const doc of rolesSnap.docs) {
    examined++;
    const role = doc.data();
    const roleId = doc.id;
    // RH-8: system roles only — custom roles are never mutated
    if (role.isSystem === false) {
      unchanged++;
      continue;
    }
    const existingPerms = new Set(Array.isArray(role.permissions) ? role.permissions : []);

    let targetAdditions = [];
    if (roleId === "role_admin" || roleId === "role_store_manager") {
      targetAdditions = ADMIN_REQUEST_PERMISSIONS;
    } else if (roleId === "role_org_owner") {
      targetAdditions = []; // Owner holds '*'
    } else if (role.isSystem === true || roleId.startsWith("role_")) {
      targetAdditions = STAFF_REQUEST_PERMISSIONS;
    }

    const missing = targetAdditions.filter((p) => !existingPerms.has(p) && !existingPerms.has("*"));

    if (missing.length > 0) {
      const newPerms = [...existingPerms, ...missing];
      if (isExecute) {
        const now = new Date();
        const nowIso = now.toISOString();
        batch.update(doc.ref, {
          permissions: newPerms,
          updatedAt: nowIso,
          migration: "prompt74-requests-permissions",
        });
        const auditRef = db.collection("auditLogs").doc();
        batch.set(auditRef, {
          logId: auditRef.id,
          organizationId: role.organizationId || "platform",
          scope: role.organizationId ? "organization" : "platform",
          action: "role.migrate_requests_permissions",
          operation: "update",
          category: "admin",
          entityType: "role",
          entityId: roleId,
          actorUid: "system",
          actorRole: "system",
          status: "succeeded",
          changedFields: ["permissions"],
          details: { addedPermissions: missing, migration: "prompt74-requests-permissions" },
          occurredAt: Timestamp.fromDate(now),
          createdAt: nowIso,
        });
        auditEntriesWritten++;
        console.log(`[APPLY] Updating ${roleId} (${role.name}): added [${missing.join(", ")}]`);
      } else {
        console.log(`[DRY-RUN] Would update ${roleId} (${role.name}): add [${missing.join(", ")}]`);
      }
      updated++;
    } else {
      unchanged++;
    }
  }

  if (isExecute && updated > 0) {
    await batch.commit();
    console.log(`\n✓ Successfully committed updates to ${updated} role(s) (${auditEntriesWritten} audit log entries).`);
  } else if (!isExecute) {
    console.log(`\n[DRY-RUN COMPLETE] ${updated} role(s) need updates, ${unchanged} already up to date.`);
    console.log("Run with `--apply` to apply changes.");
  } else {
    console.log(`\nAll ${examined} roles already have up-to-date permissions.`);
  }

  return { examined, updated, unchanged, auditEntriesWritten, isExecute };
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { runMigration };
