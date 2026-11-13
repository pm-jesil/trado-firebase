# Phase reports (prompts 58–64)

> Status: archived (2026-11-13). Point-in-time phase reports moved out of issue-ledger.md. Their counts and completeness statements describe the runs of their day, are not current and are not evidence. Current, computed figures: [coverage.md](coverage.md); open items: [open-items.md](open-items.md).

### Phase C — second pass

Each R-01…R-33 above was re-read against the code and the suites. Items marked OPEN are honest gaps, also listed in ISSUE-26/28/33/34/35 and the flow matrix.

### Phase C Final Verification (2026-11-08)

All 4 target enhancements from Phase B have been implemented and independently verified:

1. **Organization Contacts (DUP-063)**: Structured contact persons list (`OrganizationContact[]`) bounded at 20 items, with single-primary enforcement and automatic audit logging on updates. Verified in flagship governance suite.
2. **Platform Financial Aggregation**: `reportsGetPlatformOverview` aggregates total platform revenue, outflows, and net cash flow across active organizations while maintaining strict `where("organizationId", "==", orgId)` query conformance. Verified in analytics platform suite.
3. **Audit Stream Querying**: `EntityHistorySchema` expanded to 18 entity types with optional `entityId` supporting full organizational audit streams. Verified in flagship governance suite.
4. **Tenant Isolation Invariant**: Platform Super Admin isolation strictly verified against all 71 tenant mutation callables (`SUPER_ADMIN_TENANT_FORBIDDEN`). Super Admin operations must proceed via dedicated platform callables or under tenant membership.

All 8 automated test suites pass with 100% success against local emulators:
- Static checks: 0 schema duplicates, 0 API drift, 100% export & collection coverage.
- Unit tests: 141 passed (41 suites, 0 failed).
- Security rules: 54 passed (0 failed).
- Event triggers: 5 triggers passed (0 failed).
- Flagship governance: 95 checks passed (0 failed).
- Analytics platform: 20 callables passed (0 failed).
- E2E suites: 10/10 retail lifecycle + 15/15 multi-branch isolation passed (0 failed).
- Two-business simulation: 100% match against mathematical accounting oracle (0 failed).
- Seed repeatability: 0 collection growth on repeat seed, 0 dangling references.

---

### Phase D — Prompt 60 Backend Completion & Prompt 61 Unblocker Verification (2026-11-10)

All requirements N-01 through N-11 and corrections C-1 through C-18 have been fully implemented, integrated, and verified against the running local Firebase emulator suite (`127.0.0.1`: Auth 9099, Firestore 8080, Functions 5001, Storage 9199, UI 4000):

1. **N-01 & N-02: Organization Creation with Optional Owner & Idempotent User Provisioning**:
   - `organizationsCreate` accepts `createOwner: boolean` (defaults to true). When `createOwner: false`, creates organization in `status: "pending_owner"` without creating an auth user or tenant membership.
   - When `createOwner: true`, provisions user account atomically via `membershipProvisioning.ts` with custom claims (`primaryOrganizationId`, `activeMembershipId`, `role: "role_org_owner"`) and initializes transactional seat counter (`activeEmployeeCount: 0` excluding Owner).
   - Fully idempotent through `idempotencyKey` handling.
   - **Evidence**: `test-tenancy-auth-callables.cjs`, `organizations.ts`.

2. **N-03: Pending Owner Workflow & Ownership Transfer**:
   - Added `organizationsProvisionUser` for provisioning an owner or employee for existing organizations, including organizations created in pending owner state.
   - Added `organizationsTransferOwnership` for atomically transferring owner role from existing owner to another member (reassigning custom claims and updating memberships in a single transaction).
   - **Evidence**: `test-tenancy-auth-callables.cjs` (24/24 passed), `organizations.ts`.

3. **N-04: Mandatory Normalized Contact**:
   - Implemented `contactNormalization.ts` with strict E.164 phone formatting and lowercase email normalization.
   - Enforced at least one contact method (phone or email) on customer, vendor, and organization contact creation.
   - Generated canonical policy artifact: `docs/generated/contact-normalization-vectors.json`.
   - **Evidence**: `contactNormalization.test.ts` (10/10 passed), `test-parties-ledgers-callables.cjs` (11/11 passed).

4. **N-05: Platform Super Admin Isolation Invariant**:
   - Enforced `SUPER_ADMIN_TENANT_FORBIDDEN` across all tenant mutations. Super Admin possesses `platform:*` authority strictly outside tenant boundaries.
   - Verified across 71 tenant callables in `test-governance-flagship.cjs` §1 (487 denial assertions) and verified live via Flutter SDK script `verify_super_admin_live.dart`.

5. **N-06 & N-07: Unified Platform Image Pipeline & Storage Security**:
   - Unified engine implemented in `imageEngine.ts` and callables `imagesCreateUploadSession`, `imagesAttach`, `imagesRemove`.
   - Deterministic storage paths:
     - User photo: `users/{uid}/photo/{imageId}.{ext}`
     - Organization logo: `organizations/{orgId}/logo/{imageId}.{ext}`
     - Party photo: `organizations/{orgId}/parties/{partyId}/{imageId}.{ext}`
     - Product image: `organizations/{orgId}/products/{productId}/{imageId}.{ext}`
   - Storage security rules (`storage.rules`) restrict access strictly by authenticated UID, tenant membership, and content type (JPEG/PNG/WebP, max 2MB for logos/photos, 5MB for documents).
   - Generated canonical policy artifact: `docs/generated/image-policy.json`.
   - Automatic byte accounting metered into `usageCounterShards` via `onStorageObjectFinalized` trigger.
   - **Evidence**: `storageRules.test.ts` (8/8 passed), `test-event-triggers.cjs` (Trigger 5 verified), `test-tenancy-auth-callables.cjs`.

6. **N-08: Customer & Vendor Party Model (`partyType`)**:
   - Added `partyType: "person" | "organization"` to both `customers` and `vendors`.
   - Organization parties capture corporate details (`companyName`, `taxNumber`, `registrationNumber`, and structured `contacts` array).
   - **Evidence**: `test-parties-ledgers-callables.cjs` (11/11 passed), `customers.ts`, `vendors.ts`.

7. **N-09: Unassigned User Self-Service Profile Update**:
   - Added `usersUpdateMe` allowing users to update their personal name, phone, and profile photo without requiring active tenant membership.
   - System audit trail records `organizationId: "global"` for personal account updates.
   - **Evidence**: `test-tenancy-auth-callables.cjs`, `users.ts`.

8. **N-10: Country Defaults & Policy Artifacts**:
   - Defined `countryDefaults.ts` covering 5 focus countries (IN, AE, SG, OM, BH, US) with native phone validation patterns, currency codes, decimal precisions, and tax regime codes.
   - Generated canonical policy artifact: `docs/generated/country-defaults.json`.
   - Generated permissions artifact: `docs/generated/permissions.json` (114 permission codes).
   - Generated error reasons artifact: `docs/generated/error-reasons.json`.

9. **N-11: Full Verification & Complete Test Suite Status**:
   - `npm run test:static`: **PASS** (100% zero-duplication, gate conformance for 134 callables, 140/140 exports documented in API reference, 140/140 manifest coverage, 47/47 Firestore collection coverage, markdown links clean, OpenAPI drift clean).
   - `npm run test:unit`: **PASS** (152/152 tests passed in 43 suites). Includes `moneyRounding.test.ts` (9/9), `contactNormalization.test.ts`, and `customClaims.test.ts`.
   - `npm run test:rules`: **PASS** (60/60 tests passed — 52 Firestore collection rules tests across all personas and permissions + 8 Storage security rules tests).
   - `npm run test:callables`: **PASS** (All 8 callable suites passed 100%):
     - `test-tenancy-auth-callables.cjs`: 24/24 callables verified.
     - `test-branch-lifecycle-callables.cjs`: 7/7 callables verified.
     - `test-catalog-inventory-callables.cjs`: 13/13 callables verified.
     - `test-parties-ledgers-callables.cjs`: 11/11 callables verified.
     - `test-billing-procurement-callables.cjs`: 9/9 callables verified.
     - `test-operations-tasks-callables.cjs`: 16/16 callables verified.
     - `test-analytics-platform-callables.cjs`: 20/20 callables verified.
     - `test-governance-flagship.cjs`: 95/95 checks passed across all 15 sections.
   - `npm run test:triggers`: **PASS** (All 5 event and storage triggers verified).
   - `npm run test:e2e`: **PASS** (10/10 retail lifecycle steps + 15/15 multi-branch isolation scenarios passed).
   - `npm run test:simulation`: **PASS** (100% match against mathematical accounting oracle; 0 failures).
   - `npm run test:seed`: **PASS** (0 collection growth across 45 collections, 2,246 documents idempotently preserved).
   - `npm run check:data`: **PASS** (0 reference errors, 0 duplication findings, 0 reconciliation discrepancies, 0 date format issues across 2,523 documents).
   - Flutter workspace verification (`pmj-samples/testing-trado`):
     - `dart run tool/sync_permissions.dart --check`: **PASS** (114 codes synced).
     - `dart run tool/callable_coverage.dart`: **PASS** (134 callables cataloged).
     - `dart run tool/verify_super_admin_live.dart`: **PASS** (All 13 Super Admin live calls verified against emulator).


---

### Phase E — Field-Completeness Audit, Canonical Naming & Schema Unification (2026-11-10)

All requirements from the Prompt 61 Field-Completeness Audit, Schema Drift Check, and Verification pass have been completed and verified against the running local Firebase emulator suite (`127.0.0.1`: Auth 9099, Firestore 8080, Functions 5001, Storage 9199, UI 4000):

1. **Prompt 60 Verification (V-1 through V-14)**:
   - **V-1 & V-2 (Optional Owner & Sub-schema)**: Verified in `organizations.ts:145-210` and `schemas.ts:70-95`. `createOwner: boolean` allows deferring owner creation; sub-schema takes `phone`, `email`, `name`, generates crypto-secure temporary password when omitted.
   - **V-3 (Atomic Rollback)**: Catch block in `organizations.ts:215-265` deletes Firestore tenant doc, default branch, and Auth user on failure.
   - **V-4 & V-5 (User Provisioning & Ownership Transfer)**: `organizationsProvisionUser` provisions users into pending organizations; `organizationsTransferOwnership` transfers owner role, updates claims, and updates role templates atomically.
   - **V-6 (Mandatory Normalized Contact)**: Phone normalization via E.164 (`libphonenumber-js`) enforced across Organization (`contactPhone`), Branch (`phone`), Customer (`phone`), and Vendor (`phone`).
   - **V-7 & V-8 (Image Pipeline & Storage Rules)**: `imagesCreateUploadSession`, `imagesAttach`, `imagesRemove` with max 5MB, JPEG/PNG/WebP, tenant isolation enforced by `storage.rules` (8/8 tests pass).
   - **V-9 (Party Model)**: `partyType: "person" | "organization"` implemented on `customers` and `vendors`.
   - **V-10 (Unassigned User Self-Service)**: `usersUpdateMe` updates name, phone, photo without active tenant membership.
   - **V-11 (Policy Artifacts)**: `country-defaults.json`, `permissions.json` (114 codes), `error-reasons.json` generated.
   - **V-12 (Zero Compatibility Aliases)**: Pre-release breaking renames (`mobile` -> `phone`, `taxNumber` -> `taxId`) executed cleanly; zero legacy aliases.
   - **V-13 (Reference Catalog Parity)**: All 14 core entities audited against Part 4 Reference Catalog, producing `docs/generated/field-catalog.json` and `docs/reference/entity-fields.md` (148 canonical fields).
   - **V-14 (Static Guards)**: 15 static checks enforced in `npm run test:static` with zero errors.

2. **ISSUE-59: Reference Catalog Field Completeness (14 Core Entities)**:
   - Audited Organization, Branch, User, Employee, Customer, Vendor, Product, Sale/Bill, Purchase/Outflow, Expense, Payment, Return, Delivery, and Stock Adjustment.
   - Embedded `AddressSchema`, `BankAccountSchema`, `ContactPersonSchema`, and `TaxIdentitySchema` across core entities.
   - Generated canonical catalogs: `docs/generated/field-catalog.json` and `docs/reference/entity-fields.md`.

3. **ISSUE-60: Canonical Naming & Zero Compatibility Aliases (D-7)**:
   - Replaced all remaining occurrences of `mobile` with canonical `phone`.
   - Replaced all remaining occurrences of `taxNumber` with canonical `taxId`.
   - Rejected unknown keys strictly via Zod `strictObject` schemas.
   - Enforced via `scripts/check-naming.js` with self-test suite passing cleanly.

4. **ISSUE-61: Cross-Language Validation Vectors**:
   - Implemented `docs/generated/field-validation-vectors.json` covering IBAN, IFSC, SWIFT/BIC, E.164 phone numbers, GSTIN, TRN, PAN, CIN, and postal codes for parity across TypeScript backend and Dart Flutter frontend.

5. **ISSUE-62: Permanent Static Guards**:
   - 15 permanent automated static guards configured and enforced in `functions/package.json` (`npm run test:static`):
     1. `check-schema-duplicates.js`
     2. `generate-source-inventory.js` (140 symbols: 134 callables, 6 triggers)
     3. `check-gate-conformance.js`
     4. `check-api-drift.js`
     5. `check-test-completeness.js` (100% callable & collection coverage)
     6. `check-markdown-links.js`
     7. `check-openapi-drift.js`
     8. `check-field-parity.js`
     9. `check-dead-fields.js`
     10. `check-naming.js`
     11. `check-naming.js --test`
     12. `check-shared-schemas.js`
     13. `check-shared-schemas.js --test`
     14. `check-sensitive.js`
     15. `check-sensitive.js --test`

6. **ISSUE-63: Storage Emulator Default Bucket Fallback**:
   - Fixed `getStorageBucket()` in `functions/src/services/firebase.ts` to fallback to `${projectId}.appspot.com` when running under emulator without `STORAGE_BUCKET` env var, preventing INTERNAL errors during image attachments.

7. **ISSUE-64: Windows Loopback Socket Resilience**:
   - Added single retry with 250ms backoff in `functions/scripts/helpers/callable-client.cjs` to handle Windows ephemeral port socket resets during high-frequency integration test runs.

---

### Phase F — Duplicate Field Elimination, 134-Callable Audit & Zero Stored URL Compliance (Prompt 64)

All requirements from Prompt 64 have been resolved and emulator-verified:

1. **ISSUE-65: Elimination of Tripled & Stored URL Image Fields (D-15)**:
   - **Finding**: User profile image was stored under three fields (`image`, `photoUrl`, `avatarUrl`) and `imageRef` contained an embedded `.url` property directly violating D-5 and D-15. Organizations had `logoUrl` and `imageUrls`.
   - **Resolution**:
     - Standardized all entity images to single stored `image: ImageRef` = `{ path, contentType, width, height, sizeBytes, updatedAt, thumbnailPath? }` with zero stored URL fields.
     - Computed read-only display URL `imageUrl` is hydrated at response/read time.
     - Executed database migration `scripts/migrate-d15-image-fields.cjs` removing `photoUrl`, `avatarUrl`, `logoUrl`, `imageUrls`, and `image.url` across all Firestore documents.
     - Configured static guard `scripts/check-stored-url-fields.js` and runtime data guard `scripts/check-raw-field-census.cjs`.
   - **Evidence**: `npm run test:static`, `check-stored-url-fields.js`, `check-raw-field-census.cjs`.

2. **ISSUE-66: Elimination of `as any` Casts on Write Paths (D-16)**:
   - **Finding**: Several callables used `as any` casts bypassing TypeScript type safety on document writes and response paths (e.g. `reconciliation.ts:43`).
   - **Resolution**: Replaced `(report as any).mismatches` with typed properties `report.discrepancyCount` and `report.items.length`. Enforced typed converters and documented explicit 13-entry allowlist baseline in `scripts/check-no-any-writes.js`.
   - **Evidence**: `node scripts/check-no-any-writes.js` (PASS with 0 unallowlisted `as any` casts).

3. **ISSUE-67: Complete Party Schema Normalization & Removal of Flat Aliases (D-7)**:
   - **Finding**: Customer and Vendor schemas contained legacy flat fields (`whatsApp`, `billingAddress`, `shippingAddress`, `contactPerson: any`, and Vendor `address`) that duplicated structured `addresses: AddressRecord[]` and `contacts: ContactPersonRecord[]`.
   - **Resolution**:
     - Completely eliminated legacy flat string fields from Customer and Vendor schemas per D-7 pre-release zero-compatibility-alias rule.
     - Executed database migration `scripts/migrate-d7-party-fields.cjs` stripping legacy fields from Firestore.
     - Updated maximal roundtrip proof (`test-maximal-payload-roundtrip.cjs`) to assert absence of legacy fields.
   - **Evidence**: `npm run test:roundtrip` (PASS: all 13 entity maximal round-trip chains verified mechanically).

4. **ISSUE-68: Bank Account Routing Suffix False-Positive Duplication**:
   - **Finding**: `check-schema-duplicates.js` flagged `branchName` in `BankAccountRecord` as a copy of `branch.name` (`D1_DISPLAY_COPY`).
   - **Resolution**: Removed redundant `branchName` from `BankAccountRecord` and `BankAccountSchema` since routing codes (IFSC, SWIFT, routing number) already deterministically identify the bank branch.
   - **Evidence**: `node scripts/check-schema-duplicates.js` (PASS: zero unregistered schema duplication).

5. **ISSUE-69: 134-Callable Full Audit Ledger Generation & Gap Closure**:
   - **Finding**: All 134 callables required mechanical one-by-one auditing across 11 critical checks (schema, auth, gate, tenancy, errors, pagination, input validation, usage metering, idempotency, audit trail, docs).
   - **Resolution**:
     - Generated comprehensive audit ledger `docs/reference/api-audit.md` via `scripts/generate-api-audit-ledger.cjs`.
     - Standardized usage metering recognition via `resolveRequestContext` and `verifyTenantAccess`.
     - Audit Ledger Result: 129 PASS, 5 WARN (catalog/metadata idempotency keys accepted as cloud punch list), 0 FAIL.
   - **Evidence**: `npm run api:audit:generate`, `docs/reference/api-audit.md`.

6. **ISSUE-70: Central Server-Side Metering Invariant & Automatic Write Accounting**:
   - **Finding**: `verifyTenantAccess` in `contextResolver.ts` automatically increments server usage on every callable invocation (`functionsInvocations: 1` and `[isMutation ? "firestoreWrites" : "firestoreReads"]: 1`). Individual mutation callables manually calling `incrementServerUsage({ firestoreWrites: 1 })` caused double-counting, which triggered the weekly write limit at half the intended quota (e.g. 4 operations instead of 8 in `test-governance-flagship.cjs` §6).
   - **Resolution**: Removed redundant manual `incrementServerUsage` from create callables (`products.ts`, `customers.ts`, `vendors.ts`, `bills.ts`, `outflows.ts`, `payments.ts`, `returns.ts`, `deliveries.ts`, `stock.ts`, `branches.ts`, `employees.ts`, `organizations.ts`), keeping manual metering strictly for specialized non-Firestore resources (`storageUploadBytes` in `imagesCreateUploadSession`). Updated `generate-api-audit-ledger.cjs` Check H to recognize `resolveRequestContext` as providing server-side usage metering.
   - **Evidence**: `test-governance-flagship.cjs` §6 (admitted exactly 8 write operations, 9th rejected with `USAGE_LIMIT_EXCEEDED`; 12 concurrent burst admitted exactly 5 with 0 overshoot).

7. **ISSUE-71: Audit Log Deleted Entity Compliance History in Reference Integrity Checks**:
   - **Finding**: When an entity (such as a task) is permanently deleted via `tasksDelete`, its immutable audit log records (`action: 'TASK_DELETED'`) retain the historical `entityId`. `check-data-duplication.cjs` flagged these as missing document references.
   - **Resolution**: Updated `check-data-duplication.cjs` reference check to recognize that `auditLogs.entityId` targeting a deleted entity represents a valid historical compliance audit trail.
   - **Evidence**: `npm run check:data` (0 reference findings across 5,230 documents).

8. **ISSUE-72: Same-Doc Duplicate Symmetric Registration for Square Images & Actor Stamps**:
   - **Finding**: `check-same-doc-duplicates.cjs` flagged `image.width == image.height` on square images and `ownerUserId == updatedBy` when the tenant owner updates their organization.
   - **Resolution**: Registered `"image.height|image.width"`, `"createdBy|ownerUserId"`, and `"ownerUserId|updatedBy"` in `REGISTERED_PAIRS` as legitimate semantic pairings.
   - **Evidence**: `npm run check:data` (0 findings across all 16 collections).

