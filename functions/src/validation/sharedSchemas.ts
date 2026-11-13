/**
 * Trado Shared Validation Building Blocks
 * 
 * Reusable, canonical Zod schemas across all Trado entities:
 * - AddressSchema & Addresses array (bounded <= 20)
 * - ContactPersonSchema & Contacts array (bounded <= 20)
 * - BankAccountSchema & Accounts array (bounded <= 10)
 * - TaxIdentitySchema
 * - NotesSchema (canonical notes & customerNotes)
 * - PartyCoreSchema (Customer & Vendor single truth)
 */

import { z } from "zod";
import { normalizeEmail, normalizeOptionalPhone } from "../services/contactNormalization.js";
import {
  validateIBAN,
  validateIFSC,
  validateSWIFT,
  validatePAN,
} from "./validators.js";

// 1. Single Address Schema
export const AddressSchema = z.strictObject({
  id: z.string().trim().min(1).default(() => `addr_${Math.random().toString(36).substring(2, 9)}`),
  label: z.string().trim().max(100).optional(),
  line1: z.string().trim().min(1, "Address line 1 is required").max(200),
  line2: z.string().trim().max(200).optional(),
  area: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().min(1, "State / Region is required").max(100),
  postalCode: z.string().trim().min(2, "Postal code is required").max(20),
  country: z.string().trim().length(2, "Country code must be 2 uppercase letters").default("IN"),
  geoPoint: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
  contactName: z.string().trim().max(100).optional(),
  phone: z.string().trim().transform((val) => normalizeOptionalPhone(val)).optional(),
  isDefaultBilling: z.boolean().default(false).optional(),
  isDefaultShipping: z.boolean().default(false).optional(),
});

export type AddressInput = z.infer<typeof AddressSchema>;

export const AddressArraySchema = z.array(AddressSchema).max(20);

// 2. Contact Person Schema
export const ContactPersonSchema = z.strictObject({
  id: z.string().trim().min(1).default(() => `cnt_${Math.random().toString(36).substring(2, 9)}`),
  name: z.string().trim().min(1, "Contact person name is required").max(100),
  designation: z.string().trim().max(100).optional(),
  phone: z.string().trim().transform((val) => normalizeOptionalPhone(val)).optional(),
  email: z.string().trim().transform((val) => val ? normalizeEmail(val) : val).optional(),
  whatsApp: z.string().trim().transform((val) => normalizeOptionalPhone(val)).optional(),
}).refine(
  (data) => !!(data.phone || data.email),
  { message: "At least one contact method (phone or email) is required for a contact person.", path: ["phone"] }
);

export type ContactPersonInput = z.infer<typeof ContactPersonSchema>;

export const ContactPersonArraySchema = z.array(ContactPersonSchema).max(20);

// 3. Bank Account Schema (Sensitive accountNumber)
export const BankAccountSchema = z.strictObject({
  id: z.string().trim().min(1).default(() => `bank_${Math.random().toString(36).substring(2, 9)}`),
  label: z.string().trim().max(100).optional(),
  accountHolderName: z.string().trim().min(1, "Account holder name is required").max(150),
  bankName: z.string().trim().min(1, "Bank name is required").max(100),
  accountNumber: z.string().trim().min(4, "Account number must be at least 4 chars").max(50),
  routingType: z.enum(["ifsc", "iban", "swift", "us_routing", "sg_code", "other"]).default("other").optional(),
  routingCode: z.string().trim().max(50).optional(),
  upiId: z.string().trim().max(100).optional(),
  currency: z.string().trim().length(3).default("INR").optional(),
  isDefault: z.boolean().default(false).optional(),
  showOnInvoice: z.boolean().default(true).optional(),
  status: z.enum(["active", "archived"]).default("active").optional(),
}).refine(
  (data) => {
    if (data.routingType === "ifsc" && data.routingCode) return validateIFSC(data.routingCode);
    if (data.routingType === "iban" && data.routingCode) return validateIBAN(data.routingCode);
    if (data.routingType === "swift" && data.routingCode) return validateSWIFT(data.routingCode);
    return true;
  },
  { message: "Invalid routing code format for specified routing type", path: ["routingCode"] }
);

export type BankAccountInput = z.infer<typeof BankAccountSchema>;

export const BankAccountArraySchema = z.array(BankAccountSchema).max(10);

// 4. Tax Identity Schema
export const TaxIdentitySchema = z.strictObject({
  taxId: z.string().trim().max(50).optional(),
  pan: z.string().trim().max(20).optional(),
  registrationType: z.enum(["regular", "composition", "unregistered", "consumer", "overseas", "sez"]).default("unregistered").optional(),
  registrationDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  isExempt: z.boolean().default(false).optional(),
  exemptionReason: z.string().trim().max(200).optional(),
  exemptionCertificateNumber: z.string().trim().max(100).optional(),
}).refine(
  (data) => {
    if (data.pan && !validatePAN(data.pan)) return false;
    return true;
  },
  { message: "Invalid PAN format (expected 5 uppercase letters, 4 digits, 1 uppercase letter)", path: ["pan"] }
);

export type TaxIdentityInput = z.infer<typeof TaxIdentitySchema>;

// 5. Canonical Notes Schema
export const NotesSchema = z.strictObject({
  notes: z.string().trim().max(2000).optional(),
  customerNotes: z.string().trim().max(2000).optional(),
});

export type NotesInput = z.infer<typeof NotesSchema>;

// 6. Party Core Schema (Shared Customer & Vendor base)
export const PartyCoreSchema = z.strictObject({
  partyType: z.enum(["organization", "person"]).default("organization").optional(),
  name: z.string().trim().min(1, "Name is required").max(150),
  tradeName: z.string().trim().max(150).optional(),
  phone: z.string().trim().transform((val) => normalizeOptionalPhone(val)).optional(),
  email: z.string().trim().transform((val) => val ? normalizeEmail(val) : val).optional(),
  contacts: ContactPersonArraySchema.optional(),
  addresses: AddressArraySchema.optional(),
  taxIdentity: TaxIdentitySchema.optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0).optional(),
  creditLimit: z.number().finite().nonnegative().default(0).optional(),
  bankAccounts: BankAccountArraySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  customerNotes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().max(50)).max(20).optional(),
}).refine(
  (data) => !!(data.phone || data.email),
  { message: "At least one contact method (phone or email) is required.", path: ["phone"] }
);

export type PartyCoreInput = z.infer<typeof PartyCoreSchema>;
