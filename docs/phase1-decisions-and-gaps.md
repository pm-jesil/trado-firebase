# Phase 1 Decisions, Source Mappings, and Gaps

This document records the architectural decisions, source-of-truth mappings from accessible legacy and Flutter codebases, safe explicit assumptions, and gap verifications made for Phase 1.

---

## 1. Source Mappings & Decisions

### 1.1 Tenant Entity: "Brand" vs "Organization"
- **Legacy Context**: The legacy NestJS codebase used the term `Brand` (e.g., `brandId`, `PatchUserBrandDto`).
- **Phase 1 Decision**: Standardize canonically on `Organization` (`organizationId`). The Flutter client (`testing-trado`) and updated specifications already use `organization` and `OrganizationModel`.
- **Status**: Verified and adopted.

### 1.2 User Identity vs Membership
- **Decision**: Strict separation of global profile and tenant membership.
  - Global profile is stored at `users/{uid}` with fields: `name`, `email`, `phone`, `accountType`, `isActive`, `createdAt`, `createdBy`, `updatedAt`.
  - Organization tenancy is stored at `memberships/{membershipId}` with deterministic ID `${userId}_${organizationId}`.
- **Rationale**: Enables multi-tenancy where a single user can belong to multiple organizations without role collisions or permission leaks. The deterministic ID `${userId}_${organizationId}` enables direct document `get()` lookups in Firestore Security Rules without needing non-existent collection queries in rules.
- **Status**: Verified and adopted.

### 1.3 Four-Layer Permission Model
- **Source**: Verified against `testing-trado/lib/features/auth/data/models/current_user.dart`, `testing-trado/lib/features/employee/data/models/permission_model.dart`, and `sample-trado-web/src/utils/capabilities.ts`.
- **Precedence Order**:
  1. **Layer 1: Subscription Plan Modules (`subscriptionPlans/{planId}.moduleFlags`)**: If a module is false/omitted, no permissions under that module code are available to the organization.
  2. **Layer 2: Organization Module Toggles (`organizations/{orgId}.moduleToggles`)**: A tenant admin cannot enable a module disabled by their plan. If disabled in toggles, the module is inactive.
  3. **Layer 3: Base Role Permissions (`roles/{roleId}.permissions`)**: Array of canonical permission codes.
  4. **Layer 4: Membership Overrides (`memberships/{membershipId}.permissions`)**: Object `{ [permissionCode: string]: boolean }`. An explicit `false` takes strict precedence over role grants.
- **Super Admin Exception**: `token.isSuperAdmin === true` bypasses tenant module and role checks for platform administration.
- **Org Owner Exception**: `role.code === 'org_owner'` grants all capabilities within active tenant modules.
- **Status**: Formally specified, tested, and verified.

### 1.4 Business Catalogs & Reference Enums
- **Source**: Directly ported from `C:\Users\jesil.p\Project\Flutter\pmj-samples\testing-trado\lib\core\constants\enums.dart`.
- **Business Types**:
  - `retail_only` (Retail Store)
  - `wholesale_only` (Wholesale / Distribution)
  - `wholesale_retail` (Wholesale & Retail Hybrid)
  - `distributor` (Distributor)
  - `restaurant` (Restaurant / Dining)
  - `cafe_bakery` (Cafe & Bakery)
  - `service` (Service & Repair)
  - `general_trading` (General Trading)
- **Business Categories** (14 canonical categories):
  - `bicycle`, `motorcycle`, `car_automobile`, `auto_spare_parts`, `mobile_electronics`, `grocery_fmcg`, `pharmacy_medical`, `textile_garments`, `hardware_building`, `furniture_home`, `stationery_books`, `food_beverage`, `agri_products`, `general`.
- **Sales Modes**:
  - `pos`, `b2b`, `both`.

### 1.5 Tax Regimes Minimal Registry
- **Context**: The Organization schema references `taxRegimeCode`. Phase 2 houses the full tax calculation engine.
- **Phase 1 Decision & Source**: Minimal catalog collection `taxRegimes/{taxRegimeCode}` (`IN_GST`, `AE_VAT`, `US_SALES_TAX`, `NONE`).
- **Gap Recording**: These 4 entries are **unverified platform placeholders** created to ensure foreign-key relational integrity on Organization documents. Neither the legacy `swagger.json` nor Flutter `enums.dart` contained a formal country tax code registry. Detailed multi-slab rules, HSN/SAC codes, and tax calculation engines are deferred to Phase 2.
- **Status**: Documented as placeholder reference only.

### 1.6 Idempotency Strategy
- **Key Format**: Hashed SHA-256 of `"${scope}:${actorUid}:${operation}:${clientProvidedKey}"`.
  - For platform operations like `organizations.create`: `scope = "platform"`.
  - For tenant operations like `employees.create`: `scope = organizationId`.
- **Storage**: `idempotencyRecords/{recordId}`.
- **Concurrency & Replay**:
  - First request reserves slot with `status: PROCESSING` and sets `processingExpiresAt` (lease timeout, default 30s).
  - Concurrent requests within the active lease receive `ALREADY_EXISTS` ("Operation is currently in progress").
  - Subsequent requests after completion receive cached HTTP 200 result.
  - If a worker crashes while in `PROCESSING`, retries after `processingExpiresAt` recover the slot, check if side-effects completed, and self-heal or retry without permanent lockouts.
- **Payload Verification**: Request body is normalized and hashed (`requestHash`). Reusing the same key with a different body returns `409 Conflict`.
- **Retention**: Document includes `expiresAt` (24-hour default TTL).

### 1.7 Provisioning Compensation (Two-Phase Safety)
- **Context**: Firebase Auth user creation and Cloud Firestore document creation cannot share a single atomic transaction.
- **Strategy**:
  1. Create Firebase Auth user account.
  2. Attempt Firestore writes in a batched write / transaction.
  3. If Firestore write fails, invoke `admin.auth().deleteUser(uid)` to roll back the Auth user.
  4. If Auth rollback fails, log a critical compensation audit record with state `COMPENSATION_FAILED` and alert telemetry.

### 1.8 Permission Catalog Scope: 56 vs ~140 Codes
- **Context**: Flutter's `permission_model.dart` contains ~140 granular capabilities spanning the entire ERP surface (billing receipt variants, voiding, kitchen KOT displays, delivery rider dispatch, warehouse stock ledgers, vendor POs, customer credit terms, and financial P&L statements).
- **Phase 1 Deliberate Scope Reduction**: Phase 1 is strictly scoped to identity, tenancy, and access control infrastructure. The seeded 56 permissions represent a strict, clean subset covering:
  - Staff & Roles: `employee:create`, `employee:update`, `employee:view`, `employee:delete`, `role:view`, `role:assign`, `department:manage`, `job_role:manage`, `team:manage`
  - Organization & Settings: `org:view`, `org:update`, `org:settings`, `audit:view`
  - Platform Administration: `platform:*`, `plan:manage`, `module:manage`
  - Baseline Operational Capabilities: `bill:create`, `bill:view`, `bill:print`, `bill:discount`, `sale:create`, `sale:view`, `inventory:view`, `inventory:adjust`, `inventory:manage`, `expense:create`, `expense:view`, `expense:approve`, `purchase:create`, `purchase:view`, `purchase:approve`, `customer:create`, `customer:view`, `report:view`, `report:profit`, `report:export`
- **Naming Rule**: All 56 codes strictly preserve the canonical `domain:action` syntax matching Flutter's master catalog, allowing Phase 2 and Phase 3 to append future domain capabilities without renaming existing keys.

### 1.9 System Roles vs Job Roles Distinction
- **System Roles (`roles` collection)**: Exactly 3 seeded system roles govern permission tiers:
  1. `role_org_owner` (Organization Owner) — full tenant control, `*` permission within active modules
  2. `role_admin` (Administrator) — operational administration
  3. `role_employee` (Standard Employee) — baseline tenant access (`org:view`, `employee:view`); default assignment when `roleId` is omitted in `employeesCreate`.
  *(Super Admin is governed at the platform level via `isSuperAdmin: true` token claim).*
- **Operational Roles & Starter Templates**: `cashier` and `inventory_clerk` are reclassified as starter custom-role templates (`STARTER_CUSTOM_ROLE_TEMPLATES`) and default job roles (`DEFAULT_JOB_ROLES`), strictly preserving the boundary between permission tiers and job titles.
- **Job Roles (`jobRoles` collection)**: Descriptive designations (e.g., "Store Operations Manager", "Assistant Store Manager", "Head Cashier", "Inventory Specialist", "Sales Associate", "Staff Accountant") are seeded into `jobRoles` and assigned via `Membership.jobRoleIds`. They do not grant raw permissions directly; permissions are governed exclusively by `Membership.roleId` and explicit overrides.

### 1.10 Role-Management and Org-Settings Privilege Escalation Restrictions
- **Role Creation & Update**: `roles.create` and `roles.update` are strictly restricted to `role_org_owner` (and Super Admin). Tenant Admins cannot create or modify roles, preventing privilege escalation where an Admin could grant themselves or colleagues unapproved capabilities.
- **Organization Settings**: `organizations.update` enforces field-level access control:
  - Structural Settings (`businessType`, `businessCategory`, `moduleToggles`): strictly restricted to `role_org_owner` and Super Admin.
  - Operational Settings (`name`, `logoUrl`): permitted for Tenant Admins and Org Owners.

### 1.11 Custom Claims & Client-Side Token Refresh
- **Custom Claims**: Set server-side via `functions/src/services/claims.ts`:
  - `isSuperAdmin: boolean` (platform administrator)
  - `primaryOrganizationId: string` (active tenant context for security rules and callable context)
- **Client-Side Refresh Requirement**: Firebase Auth ID tokens cache custom claims in the signed JWT. When claims are modified on the backend (e.g. initial organization provisioning, or switching primary organizations), the client must force token refresh before claims take effect in Firestore security rules:
  - Flutter: `await FirebaseAuth.instance.currentUser?.getIdToken(true);`
  - Web: `await auth.currentUser?.getIdToken(true);`

### 1.12 Coordinated Firestore Batch Atomicity
- In `organizationsCreate` and `employeesCreate`, the Firestore write coordination groups the organization, user, membership, audit log, and idempotency status update (`status: SUCCEEDED`) into a **single atomic Firestore batch commit** (`batch.commit()`).
- Guarantee: Either all 5 documents are written and the operation is marked succeeded, or none are written and compensation deletes the orphaned Auth user.

### 1.13 Multi-Tenant Employee Deactivation Safety
- When `employeesDeactivate` runs, it deactivates the specific `memberships/{membershipId}` record (`status = "inactive"`).
- It queries remaining active memberships for that user across the entire platform. Only if 0 active memberships remain is the global `users/{uid}.isActive` set to `false`. If the user is active in another organization, their global account remains active.

---

## 2. Gaps & Safe Assumptions

| Area | Missing Legacy Document | Safe Phase 1 Assumption | Blocking? |
| :--- | :--- | :--- | :--- |
| **`testing-trado-api` NestJS repo** | Repo folder was not present in the workspace or user home directory. | Extracted contracts and schemas from `swagger.json` in `sample-trado-web` and client models/tests in `testing-trado`. | **NO** (Fully covered by Swagger & Flutter repos). |
| **Tax Regimes Registry** | No tax regime codes in legacy schemas. | Created 4 placeholder country catalog entries (`IN_GST`, `AE_VAT`, `US_SALES_TAX`, `NONE`) awaiting Phase 2 tax calculation engine. | **NO** (Documented placeholder). |
| **Default Subscription Plans** | No formal billing tiers schema found in legacy files. | Created 3 standard plans: `starter` (5 seats, 500MB storage), `growth` (25 seats, 5000MB storage), and `enterprise` (unlimited). | **NO** (Seed data only; plans are Super Admin managed). |
| **FCM Push Delivery in Emulator** | Firebase Local Emulator Suite does not emulate real APNs/FCM delivery. | Built abstract `NotificationSender` with a test fake sender verifying outbox queuing and token handling. Documented live FCM testing as a separate checklist. | **NO** (Standard Firebase platform behavior). |
| **Storage Uploads** | No binary upload contract for Flutter web/mobile was in legacy code. | Implemented path-based `storage.rules` under `organizations/{orgId}/logo/...` and `users/{uid}/avatar/...` with 5MB limit and image MIME restrictions. | **NO** (Storage emulator configured at port 9199). |
