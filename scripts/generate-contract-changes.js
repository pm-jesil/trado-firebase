/**
 * Generate Contract Changes Documentation
 * 
 * Records all atomic field renames, removals, and schema consolidations (D-7),
 * providing the exact mapping for Flutter frontend alignment.
 * 
 * Outputs: docs/generated/contract-changes.md
 */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.resolve(ROOT_DIR, "docs/generated/contract-changes.md");

const changes = [
  {
    entity: "Customer",
    oldField: "mobile",
    newField: "phone",
    callablesAffected: ["customersCreate", "customersUpdate", "customersGet", "customersList"],
    type: "string (E.164)",
    migrationApplied: "Firestore customer documents migrated: phone = doc.phone || doc.mobile",
    flutterGuidance: "Update CustomerModel JSON serialization: change json['mobile'] to json['phone'].",
  },
  {
    entity: "Vendor",
    oldField: "mobile",
    newField: "phone",
    callablesAffected: ["vendorsCreate", "vendorsUpdate", "vendorsGet", "vendorsList"],
    type: "string (E.164)",
    migrationApplied: "Firestore vendor documents migrated: phone = doc.phone || doc.mobile",
    flutterGuidance: "Update VendorModel JSON serialization: change json['mobile'] to json['phone'].",
  },
  {
    entity: "Vendor",
    oldField: "taxNumber",
    newField: "taxId",
    callablesAffected: ["vendorsCreate", "vendorsUpdate", "vendorsGet", "vendorsList"],
    type: "string",
    migrationApplied: "Firestore vendor documents migrated: taxId = doc.taxId || doc.taxNumber",
    flutterGuidance: "Update VendorModel: change json['taxNumber'] to json['taxId'].",
  },
  {
    entity: "Branch",
    oldField: "contact.mobile",
    newField: "contact.phone",
    callablesAffected: ["branchesCreate", "branchesUpdate", "branchesGet", "branchesList"],
    type: "string (E.164)",
    migrationApplied: "Firestore branch documents migrated: contact.phone = contact.phone || contact.mobile",
    flutterGuidance: "Update BranchContact model: change json['mobile'] to json['phone'].",
  },
  {
    entity: "Customer & Vendor",
    oldField: "billingAddress / shippingAddress (flat string)",
    newField: "addresses: AddressSchema[]",
    callablesAffected: ["customersCreate", "customersUpdate", "vendorsCreate", "vendorsUpdate"],
    type: "AddressSchema array (bounded <= 20)",
    migrationApplied: "Structured AddressSchema array with isDefaultBilling and isDefaultShipping flags.",
    flutterGuidance: "Use shared AddressInput / AddressModel component.",
  },
  {
    entity: "Organization",
    oldField: "bankDetails (single inline object)",
    newField: "bankAccounts: BankAccountSchema[]",
    callablesAffected: ["organizationsCreate", "organizationsUpdate", "organizationsGet"],
    type: "BankAccountSchema array (bounded <= 10)",
    migrationApplied: "Supports multiple bank accounts with default and showOnInvoice flags.",
    flutterGuidance: "Use shared BankAccountModel and BankAccountList form widget.",
  },
];

let md = `# Trado API Contract Changes & Naming Consolidations (D-7)\n\n`;
md += `**Generated**: ${new Date().toISOString()}  \n`;
md += `**Pre-Release Policy (D-7)**: In accordance with standing architectural decision D-7, renames and removals are applied **atomically with backend data migrations — zero compatibility aliases**. The Flutter mobile and web workspace adheres directly to these canonical names.\n\n`;
md += `| Entity | Old Field Name | Canonical New Field | Callables Affected | Type | Data Migration & Flutter Guidance |\n`;
md += `|---|---|---|---|---|---|\n`;

for (const c of changes) {
  md += `| **${c.entity}** | \`${c.oldField}\` | \`${c.newField}\` | \`${c.callablesAffected.join("`, `")}\` | \`${c.type}\` | ${c.flutterGuidance} |\n`;
}

md += `\n---\n\n`;
md += `### Migration Verification\n\n`;
md += `All data migrations run atomically during emulator seeding and test preparation. No legacy alias fields (\`mobile\`, \`taxNumber\`) are emitted in new API responses or accepted in \`.strict()\` Zod input schemas.\n`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, md, "utf8");
console.log(`✓ Generated contract changes documentation: ${OUTPUT_PATH}`);

