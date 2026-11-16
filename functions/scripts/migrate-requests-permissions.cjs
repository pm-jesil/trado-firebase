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
const { getFirestore } = require("firebase-admin/firestore");

if (!process.env.FIREBASE_CONFIG && !process.env.GCLOUD_PROJECT) {
  try {
    initializeApp({ projectId: "trado-x" });
  } catch {
    // Already initialized
  }
}

const db = getFirestore();

const isExecute = process.argv.includes("--execute");

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

async function runMigration() {
  console.log(`=== Requests Permissions Migration (${isExecute ? "EXECUTE" : "DRY-RUN"}) ===\n`);

  const rolesSnap = await db.collection("roles").get();
  console.log(`Examining ${rolesSnap.size} roles in Firestore...`);

  let examined = 0;
  let updated = 0;
  let unchanged = 0;

  const batch = db.batch();

  for (const doc of rolesSnap.docs) {
    examined++;
    const role = doc.data();
    const roleId = doc.id;
    const existingPerms = new Set(Array.isArray(role.permissions) ? role.permissions : []);

    let targetAdditions = [];
    if (roleId === "role_admin" || roleId === "role_store_manager") {
      targetAdditions = ADMIN_REQUEST_PERMISSIONS;
    } else if (roleId === "role_org_owner") {
      targetAdditions = []; // Owner holds '*'
    } else if (role.isSystem || roleId.startsWith("role_")) {
      targetAdditions = STAFF_REQUEST_PERMISSIONS;
    }

    const missing = targetAdditions.filter((p) => !existingPerms.has(p) && !existingPerms.has("*"));

    if (missing.length > 0) {
      const newPerms = [...existingPerms, ...missing];
      if (isExecute) {
        batch.update(doc.ref, {
          permissions: newPerms,
          updatedAt: new Date().toISOString(),
          migration: "prompt74-requests-permissions",
        });
        console.log(`[EXECUTE] Updating ${roleId} (${role.name}): added [${missing.join(", ")}]`);
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
    console.log(`\n✓ Successfully committed updates to ${updated} role(s).`);
  } else if (!isExecute) {
    console.log(`\n[DRY-RUN COMPLETE] ${updated} role(s) need updates, ${unchanged} already up to date.`);
    console.log("Run with `--execute` to apply changes.");
  } else {
    console.log(`\nAll ${examined} roles already have up-to-date permissions.`);
  }

  return { examined, updated, unchanged, isExecute };
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
