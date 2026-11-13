/**
 * Canonical Naming Registry Generator
 * 
 * Defines canonical concepts, canonical field names, and forbidden synonyms
 * across all Trado backend schemas, models, and API contracts.
 * 
 * Outputs: docs/generated/naming-registry.json
 */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.resolve(ROOT_DIR, "docs/generated/naming-registry.json");

const namingRegistry = {
  version: "1.0.0",
  description: "Trado Canonical Field Naming Registry & Forbidden Synonym Rules (D-7)",
  rules: [
    {
      concept: "Phone Number",
      canonicalName: "phone",
      forbiddenSynonyms: ["mobile", "contactNo", "telephone", "cell", "phoneNo", "mobileNo"],
      rule: "Must be named 'phone'. Value must be E.164 normalized (+CC...).",
    },
    {
      concept: "Email Address",
      canonicalName: "email",
      forbiddenSynonyms: ["emailAddress", "mail", "e_mail", "email_id"],
      rule: "Must be named 'email'. Value must be trimmed and lowercased.",
    },
    {
      concept: "Party / Entity Name",
      canonicalName: "name",
      forbiddenSynonyms: ["fullName", "entityName"],
      rule: "Root name field is always 'name'. Specific business roles use 'legalName' or 'tradeName'.",
    },
    {
      concept: "Statutory Tax Identifier",
      canonicalName: "taxId",
      forbiddenSynonyms: ["gstin", "vatNumber", "trn", "tin", "taxRegistrationNo"],
      rule: "Generic tax registration is 'taxId'. Country-specific PAN is 'pan'.",
    },
    {
      concept: "Lifecycle Status",
      canonicalName: "status",
      forbiddenSynonyms: ["active", "docStatus", "lifecycleState"],
      rule: "Document and entity lifecycle is represented by 'status' enum (EntityStatus). Avoid parallel boolean isActive on business documents.",
    },
    {
      concept: "Internal Notes",
      canonicalName: "notes",
      forbiddenSynonyms: ["remarks", "comment", "description_notes", "internalNotes"],
      rule: "Private or internal tenant notes are always 'notes'.",
    },
    {
      concept: "Customer-Facing Printed Notes",
      canonicalName: "customerNotes",
      forbiddenSynonyms: ["printNotes", "publicNotes", "invoiceNotes", "termsNotes"],
      rule: "Notes printed on customer documents are always 'customerNotes'.",
    },
    {
      concept: "Total Financial Amount",
      canonicalName: "totalAmount",
      forbiddenSynonyms: ["grandTotal", "totalPrice", "finalTotal", "netPayable"],
      rule: "Overall document monetary figure is 'totalAmount'.",
    },
    {
      concept: "Audit Creator",
      canonicalName: "createdBy",
      forbiddenSynonyms: ["createdByUserId", "created_by", "creator", "authorUid"],
      rule: "Audit actor UID is 'createdBy'.",
    },
    {
      concept: "Audit Updater",
      canonicalName: "updatedBy",
      forbiddenSynonyms: ["updatedByUserId", "updated_by", "updater"],
      rule: "Audit actor UID is 'updatedBy'.",
    },
  ],
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(namingRegistry, null, 2), "utf8");
console.log(`✓ Generated canonical naming registry: ${OUTPUT_PATH}`);
