# Phase 1 Data Model & Field Classification Specification

**Document Version**: 1.0.0  
**Target Database**: Cloud Firestore (Native Mode)  
**Location**: `asia-south1` (Mumbai)  
**Project**: `trado-x`

---

## 1. Architectural Principles & Anti-Embedding Rules

1. **Top-Level Tenant Collections**:
   - Collections are partitioned at the top level with an explicit `organizationId` foreign key.
   - This facilitates efficient tenant isolation via Firestore Security Rules and direct single-document `get()` lookups without relying on complex cross-collection queries in security rules.
2. **Reference-by-ID Strict Rule**:
   - Foreign entity references are strictly stored as document ID strings (e.g., `userId`, `organizationId`, `roleId`, `planId`).
   - Embedding full foreign documents (such as embedding entire user objects in memberships or entire plan objects in organizations) is strictly prohibited.
3. **No Embedded Members in Teams**:
   - `teams/{teamId}` documents contain only `{ organizationId, name }`.
   - Team membership is canonically represented by `Membership.teamId`. Querying members of a team is performed via `memberships.where("teamId", "==", teamId)`.
4. **Deterministic Membership Keying**:
   - Document ID for `memberships/{membershipId}` is `${userId}_${organizationId}`.
   - Enables O(1) security rule verification: `exists(/databases/$(database)/documents/memberships/$(request.auth.uid + '_' + orgId))`.
5. **Snapshots**:
   - Display snapshots are permitted only when explicitly named `...Snapshot`, accompanied by read-amplification justification and staleness behavior documentation. No mutable financial or transaction statuses are snapshotted in Phase 1.

---

## 2. Field Classification Tables

### 2.1 `users/{uid}`
*Document ID: Firebase Auth UID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `name` | string | Owned attribute/state | Full display name of the user. |
| `email` | string | Identity | Normalized lowercase email address. Unique across platform. |
| `phone` | string (optional) | Owned attribute/state | E.164 formatted contact telephone number. |
| `accountType` | enum string | Stable/immutable code | `"standard"` \| `"admin"` \| `"system"`. |
| `isActive` | boolean | Owned attribute/state | Global user account status flag. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Immutable creation timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Actor UID who provisioned the account. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Timestamp of last profile update. |

---

### 2.2 `memberships/{membershipId}`
*Document ID: `${userId}_${organizationId}`*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `userId` | string | Reference-by-ID | Foreign key to `users/{uid}`. |
| `organizationId` | string | Reference-by-ID | Foreign key to `organizations/{organizationId}`. |
| `roleId` | string | Reference-by-ID | Foreign key to `roles/{roleId}`. |
| `departmentId` | string (optional) | Reference-by-ID | Foreign key to `departments/{departmentId}`. |
| `jobRoleIds` | string[] | Reference-by-ID | Array of foreign keys to `jobRoles/{jobRoleId}`. |
| `teamId` | string (optional) | Reference-by-ID | Foreign key to `teams/{teamId}`. Canonical team relationship. |
| `reportingToIds` | string[] | Reference-by-ID | Array of `memberships/{membershipId}` references (manager graph). |
| `permissions` | map<string, bool> | Owned attribute/state | Layer 4 explicit grant/deny override map. |
| `status` | enum string | Owned attribute/state | `"active"` \| `"inactive"` \| `"suspended"`. |
| `isPrimary` | boolean | Owned attribute/state | Flag indicating primary organization for multi-tenant sessions. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Creation timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Actor UID who provisioned the membership. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Last membership modification timestamp. |

---

### 2.3 `organizations/{organizationId}`
*Document ID: Auto-generated Firestore ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `name` | string | Owned attribute/state | Legal / operational trade name of tenant. |
| `businessType` | enum string | Stable/immutable code | Ported from `enums.dart` (e.g. `wholesale_retail`, `retail_only`). |
| `businessCategory` | enum string | Stable/immutable code | Ported from `enums.dart` (14 canonical categories). |
| `country` | string (ISO 3166-1) | Stable/immutable code | 2-letter uppercase country code (e.g. `IN`, `AE`, `US`). |
| `currency` | string (ISO 4217) | Stable/immutable code | 3-letter currency code (e.g. `INR`, `AED`, `USD`). |
| `taxRegimeCode` | string | Reference-by-ID | Foreign key to `taxRegimes/{taxRegimeCode}` catalog. |
| `status` | enum string | Owned attribute/state | `"active"` \| `"inactive"` \| `"suspended"`. |
| `planId` | string | Reference-by-ID | Foreign key to `subscriptionPlans/{planId}`. |
| `moduleToggles` | map<string, bool> | Owned attribute/state | Layer 2 per-tenant module activation switches. |
| `logoUrl` | string (URL) | Owned attribute/state | Storage URL pointing to `organizations/{orgId}/logo/...`. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Provisioning timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Super Admin actor UID who provisioned tenant. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Last modification timestamp. |

---

### 2.4 `roles/{roleId}`
*Document ID: System ID or Auto-generated ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `organizationId` | string \| null | Reference-by-ID | Tenant ID for custom roles; `null` for platform system roles. |
| `name` | string | Owned attribute/state | Human-friendly title (e.g. `"Counter Cashier"`). |
| `code` | string | Stable/immutable code | Canonical role slug (`"org_owner"`, `"admin"`, `"cashier"`). |
| `permissions` | string[] | Reference-by-ID | Array of canonical permission catalog codes (Layer 3). |
| `isSystem` | boolean | Owned attribute/state | `true` for immutable system roles (Super Admin managed). |
| `description` | string | Owned attribute/state | Explanation of role operational remit. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Creation timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Actor UID who created role. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Modification timestamp. |

---

### 2.5 `departments/{departmentId}`
*Document ID: Auto-generated ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `organizationId` | string \| null | Reference-by-ID | Tenant ID or `null` for platform catalog. |
| `name` | string | Owned attribute/state | Department name (e.g. `"Procurement"`). |
| `headMembershipIds` | string[] | Reference-by-ID | Array of `memberships/{id}` references heading department. |
| `isSystem` | boolean | Owned attribute/state | System catalog flag. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Actor UID. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Modification timestamp. |

---

### 2.6 `jobRoles/{jobRoleId}`
*Document ID: Auto-generated ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `organizationId` | string \| null | Reference-by-ID | Tenant ID or `null` for platform catalog. |
| `name` | string | Owned attribute/state | Designation title (e.g. `"Senior Cashier"`). |
| `isSystem` | boolean | Owned attribute/state | System catalog flag. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Actor UID. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Modification timestamp. |

---

### 2.7 `teams/{teamId}`
*Document ID: Auto-generated ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `organizationId` | string | Reference-by-ID | Foreign key to `organizations/{organizationId}`. |
| `name` | string | Owned attribute/state | Team label (e.g. `"North Route Sales Team"`). |
| `createdAt` | string (ISO 8601) | System/audit metadata | Creation timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Actor UID. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Modification timestamp. |

*Crucial Architecture Invariant: No `members` array is stored on Team documents.*

---

### 2.8 `subscriptionPlans/{planId}`
*Document ID: Stable plan key (e.g. `plan_starter`, `plan_growth`, `plan_enterprise`)*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `name` | string | Owned attribute/state | Tier name (`"Starter"`, `"Growth"`, `"Enterprise"`). |
| `price` | number | Owned attribute/state | Plan recurring price in minor units or whole currency. |
| `currency` | string (ISO 4217) | Stable/immutable code | Billing currency (e.g. `"INR"`). |
| `storageLimitMb` | number | Owned attribute/state | Maximum cloud asset storage in MB. |
| `monthlyDocumentVolumeLimit` | number | Owned attribute/state | Allowed transactions per month. |
| `seatLimits` | map<string, number>| Owned attribute/state | Maximum seats `{ admin: n, staff: m }`. |
| `moduleFlags` | map<string, bool> | Owned attribute/state | Layer 1 Platform module gating flags. |
| `isActive` | boolean | Owned attribute/state | Availability flag for new organizations. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Creation timestamp. |
| `createdBy` | string (UID) | Reference-by-ID | Super Admin actor UID. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Modification timestamp. |

---

### 2.9 `permissionCatalog/{permissionCode}`
*Document ID: Stable canonical permission code (e.g. `bill:create`)*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `code` | string | Identity | Identical to document ID. |
| `description` | string | Owned attribute/state | Human explanation of permission capability. |
| `module` | string | Reference-by-ID | Foreign key to `modules/{moduleCode}`. |
| `isSystem` | boolean | Owned attribute/state | System flag. |

---

### 2.10 `modules/{moduleCode}`
*Document ID: Stable module slug (e.g. `billing`, `sales`, `inventory`)*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `code` | string | Identity | Identical to document ID. |
| `name` | string | Owned attribute/state | Module display name. |
| `description` | string | Owned attribute/state | Module functional scope. |

---

### 2.11 `taxRegimes/{taxRegimeCode}`
*Document ID: Stable regime code (e.g. `IN_GST`, `AE_VAT`, `US_SALES_TAX`, `NONE`)*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `code` | string | Identity | Identical to document ID. |
| `country` | string (ISO 3166-1) | Stable/immutable code | Country jurisdiction. |
| `name` | string | Owned attribute/state | Name of tax regime. |
| `description` | string | Owned attribute/state | Tax regime scope description. |
| `isDefault` | boolean | Owned attribute/state | Country default flag. |

---

### 2.12 `idempotencyRecords/{recordId}`
*Document ID: SHA-256 of `scope::actorUid::operation::clientKey`*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `operationId` | string | Identity | Operation trace identifier. |
| `requestHash` | string (SHA-256) | Derived value | Deterministic hash of canonical request body. |
| `status` | enum string | Owned attribute/state | `"processing"` \| `"succeeded"` \| `"failed"`. |
| `result` | map<string, any> | Derived value | Cached safe response payload (no passwords/secrets). |
| `error` | map<string, any> | Owned attribute/state | Error details if operation failed. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Slot reservation timestamp. |
| `expiresAt` | string (ISO 8601) | System/audit metadata | Cache expiration time (24h default TTL). |

---

### 2.13 `auditLogs/{logId}`
*Document ID: Auto-generated Firestore ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `organizationId` | string \| null | Reference-by-ID | Tenant ID or `"platform"`. |
| `actorUid` | string | Reference-by-ID | Firebase Auth UID of actor. |
| `actorMembershipId` | string \| null | Reference-by-ID | Membership ID of actor if tenant-scoped. |
| `action` | string | Stable/immutable code | Standard audit action code (`ORGANIZATION_CREATED`, etc.). |
| `entityType` | string | Stable/immutable code | Affected entity type (`"organization"`, `"membership"`). |
| `entityId` | string | Reference-by-ID | Document ID of affected entity. |
| `timestamp` | string (ISO 8601) | System/audit metadata | Precise timestamp of operation. |
| `requestId` | string (optional) | System/audit metadata | Correlation / trace ID. |
| `details` | map<string, any> | Owned attribute/state | Sanitized summary metadata (passwords & tokens redacted). |

---

### 2.14 `users/{uid}/devices/{deviceId}`
*Document ID: Client device UUID / Hardware ID*

| Field Name | Type | Classification | Description / Invariant |
| :--- | :--- | :--- | :--- |
| `deviceId` | string | Identity | Unique identifier of physical hardware. |
| `fcmToken` | string | Owned attribute/state | FCM registration push token for device. |
| `platform` | enum string | Stable/immutable code | `"android"` \| `"ios"` \| `"web"`. |
| `createdAt` | string (ISO 8601) | System/audit metadata | Registration timestamp. |
| `updatedAt` | string (ISO 8601) | System/audit metadata | Last active token refresh timestamp. |

