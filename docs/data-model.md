# Trado Data Model & Schema Specification

This document is the authoritative, permanent reference for all Cloud Firestore collections, subcollections, and fields in the Trado backend. Every field adheres to the standing reference-by-ID architectural discipline.

## Field Classification Discipline

- **identity**: Primary document identifier or top-level partition boundary key.
- **reference-by-ID**: Bare string identifier referencing a foreign entity document. Never embeds foreign fields.
- **justified snapshot**: Immutable point-in-time snapshot explicitly named `...Snapshot` required for offline rendering or immutable tax/billing compliance.
- **stable-code**: System-wide or ISO standard stable lookup string (currency, country, tax regime code, unit code).
- **owned attribute/state**: Direct domain attribute or lifecycle state belonging to this entity.
- **system-audit metadata**: System tracking timestamp or actor identifier (`createdAt`, `createdBy`, `updatedAt`, `updatedBy`).
- **derived value**: Computed, aggregate, or balance counter maintained across operations.

## Collection Inventory Overview

Total Collections & Subcollections: **42**

| # | Collection Path | Primary Interface | Domain |
|---|---|---|---|
| 1 | `user` | `UserDoc` | Tenant & RBAC |
| 2 | `membership` | `MembershipDoc` | Tenant & RBAC |
| 3 | `organization` | `OrganizationDoc` | Tenant & RBAC |
| 4 | `role` | `RoleDoc` | Tenant & RBAC |
| 5 | `department` | `DepartmentDoc` | Tenant & RBAC |
| 6 | `jobrole` | `JobRoleDoc` | Tenant & RBAC |
| 7 | `team` | `TeamDoc` | Tenant & RBAC |
| 8 | `subscriptionplan` | `SubscriptionPlanDoc` | Tenant & RBAC |
| 9 | `permissioncatalog` | `PermissionCatalogDoc` | Tenant & RBAC |
| 10 | `module` | `ModuleDoc` | Tenant & RBAC |
| 11 | `taxregime` | `TaxRegimeDoc` | Tenant & RBAC |
| 12 | `idempotencyrecord` | `IdempotencyRecordDoc` | System Infrastructure |
| 13 | `auditlog` | `AuditLogDoc` | System Infrastructure |
| 14 | `device` | `DeviceDoc` | System Infrastructure |
| 15 | `notificationoutbox` | `NotificationOutboxDoc` | Tenant & RBAC |
| 16 | `product` | `ProductDoc` | Catalog & Inventory |
| 17 | `category` | `CategoryDoc` | Catalog & Inventory |
| 18 | `unit` | `UnitDoc` | Catalog & Inventory |
| 19 | `customer` | `CustomerDoc` | Parties & Ledgers |
| 20 | `vendor` | `VendorDoc` | Parties & Ledgers |
| 21 | `outflow` | `OutflowDoc` | Operations & Transactions |
| 22 | `bill` | `BillDoc` | Operations & Transactions |
| 23 | `stockmovement` | `StockMovementDoc` | Catalog & Inventory |
| 24 | `delivery` | `DeliveryDoc` | Operations & Transactions |
| 25 | `return` | `ReturnDoc` | Operations & Transactions |
| 26 | `payment` | `PaymentDoc` | Operations & Transactions |
| 27 | `documentcounter` | `DocumentCounterDoc` | System Infrastructure |
| 28 | `task` | `TaskDoc` | Tasks, Location & Notifications |
| 29 | `dailysummary` | `DailySummaryDoc` | Analytics & Usage Metering |
| 30 | `monthlysummary` | `MonthlySummaryDoc` | Analytics & Usage Metering |
| 31 | `latestlocation` | `LatestLocationDoc` | Tasks, Location & Notifications |
| 32 | `locationping` | `LocationPingDoc` | Tasks, Location & Notifications |
| 33 | `notification` | `NotificationDoc` | Tasks, Location & Notifications |
| 34 | `branch` | `BranchDoc` | Multi-Branch Architecture |
| 35 | `branchcodelock` | `BranchCodeLockDoc` | Multi-Branch Architecture |
| 36 | `membershipbranch` | `MembershipBranchDoc` | Multi-Branch Architecture |
| 37 | `stockbalance` | `StockBalanceDoc` | Catalog & Inventory |
| 38 | `organizationusagedaily` | `OrganizationUsageDailyDoc` | Analytics & Usage Metering |
| 39 | `branchusagedaily` | `BranchUsageDailyDoc` | Analytics & Usage Metering |
| 40 | `platformusagesnapshot` | `PlatformUsageSnapshotDoc` | Analytics & Usage Metering |
| 41 | `usageratecard` | `UsageRateCardDoc` | Analytics & Usage Metering |
| 42 | `usageallocationrun` | `UsageAllocationRunDoc` | Analytics & Usage Metering |

---

## Detailed Collection Schemas

### 1. `user` (`UserDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `email` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `phone` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `accountType` | `"standard" \| "admin" \| "system"` | No | **owned attribute/state** | Direct entity state attribute |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | ISO 8601 |
| `createdBy` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 2. `membership` (`MembershipDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `userId` | `string` | No | **reference-by-ID** | Reference to users/{uid} |
| `organizationId` | `string` | No | **identity** | Reference to organizations/{organizationId} |
| `roleId` | `string` | No | **reference-by-ID** | Reference to roles/{roleId} |
| `departmentId` | `string \| null` | Yes | **reference-by-ID** | Reference to departments/{departmentId} |
| `jobRoleIds` | `string[]` | No | **reference-by-ID** | References to jobRoles/{jobRoleId} |
| `teamId` | `string \| null` | Yes | **reference-by-ID** | Reference to teams/{teamId} |
| `reportingToIds` | `string[]` | No | **reference-by-ID** | References to memberships/{membershipId} (multi-manager graph) |
| `permissions` | `Record<string, boolean>` | No | **owned attribute/state** | Explicit user-level override grants/denies |
| `status` | `EntityStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `isPrimary` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `primaryBranchId` | `string` | Yes | **reference-by-ID** | Canonical default active operating branch for this membership |
| `assignedBranchIds` | `string[]` | Yes | **reference-by-ID** | Materialized projection of active membershipBranches IDs |
| `locationTrackingEnabled` | `boolean` | Yes | **owned attribute/state** | Phase 3: Explicit consent flag for employee live-location tracking |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 3. `organization` (`OrganizationDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `businessType` | `BusinessType` | No | **owned attribute/state** | Direct entity state attribute |
| `businessCategory` | `BusinessCategory` | No | **owned attribute/state** | Direct entity state attribute |
| `country` | `string` | No | **stable-code** | ISO 3166-1 alpha-2 |
| `currency` | `string` | No | **stable-code** | ISO 4217 code |
| `taxRegimeCode` | `string` | No | **stable-code** | Reference to taxRegimes/{taxRegimeCode} |
| `status` | `EntityStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `planId` | `string` | No | **reference-by-ID** | Reference to subscriptionPlans/{planId} |
| `moduleToggles` | `Record<string, boolean>` | No | **owned attribute/state** | Per-tenant feature switches |
| `logoUrl` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `defaultBranchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `branchCount` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `sharingPolicies` | `OrganizationSharingPolicies` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 4. `role` (`RoleDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string \| null` | No | **identity** | Null for system/platform roles |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `code` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `permissions` | `string[]` | No | **owned attribute/state** | Canonical permission catalog codes |
| `isSystem` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `description` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 5. `department` (`DepartmentDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string \| null` | No | **identity** | Null for system catalog |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `headMembershipIds` | `string[]` | Yes | **reference-by-ID** | References to memberships/{membershipId} |
| `isSystem` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 6. `jobrole` (`JobRoleDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string \| null` | No | **identity** | Null for system catalog |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `isSystem` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 7. `team` (`TeamDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Reference to organizations/{organizationId} |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 8. `subscriptionplan` (`SubscriptionPlanDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `price` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `currency` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `storageLimitMb` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `monthlyDocumentVolumeLimit` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `seatLimits` | `{` | No | **owned attribute/state** | Direct entity state attribute |
| `admin` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `staff` | `number` | No | **owned attribute/state** | Direct entity state attribute |

### 9. `permissioncatalog` (`PermissionCatalogDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `code` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `description` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `module` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `isSystem` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |

### 10. `module` (`ModuleDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `code` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `description` | `string` | No | **owned attribute/state** | Direct entity state attribute |

### 11. `taxregime` (`TaxRegimeDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `code` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `country` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `description` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `isDefault` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |

### 12. `idempotencyrecord` (`IdempotencyRecordDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `operationId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `requestHash` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `status` | `IdempotencyStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `result` | `Record<string, unknown>` | Yes | **owned attribute/state** | Direct entity state attribute |
| `error` | `{` | Yes | **owned attribute/state** | Direct entity state attribute |
| `code` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `message` | `string` | No | **owned attribute/state** | Direct entity state attribute |

### 13. `auditlog` (`AuditLogDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string \| null` | Yes | **identity** | Tenant ID or "platform" |
| `branchId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `actorUid` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `actorMembershipId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `action` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `entityType` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `entityId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `timestamp` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `requestId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `details` | `Record<string, unknown>` | Yes | **owned attribute/state** | Direct entity state attribute |

### 14. `device` (`DeviceDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `deviceId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `fcmToken` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `platform` | `"android" \| "ios" \| "web"` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 15. `notificationoutbox` (`NotificationOutboxDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `userId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `type` | `"welcome" \| "system"` | No | **owned attribute/state** | Direct entity state attribute |
| `payload` | `{` | No | **owned attribute/state** | Direct entity state attribute |
| `title` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `body` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `data` | `Record<string, string>` | Yes | **owned attribute/state** | Direct entity state attribute |

### 16. `product` (`ProductDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Tenant reference |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `nameKey` | `string` | No | **owned attribute/state** | Lower-case trimmed for uniqueness search |
| `description` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `categoryId` | `string \| null` | Yes | **reference-by-ID** | Reference to categories/{categoryId} |
| `baseUnit` | `string` | No | **stable-code** | Code e.g. "piece", "kg", "box" |
| `sellingPrice` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `costPrice` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `weightedAverageCost` | `number` | Yes | **owned attribute/state** | Phase 3: Maintained weighted-average cost for valuation & COGS |
| `mrp` | `number \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `wholesalePrice` | `number \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `taxInclusive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `taxRatePercent` | `number` | Yes | **owned attribute/state** | e.g. 5, 12, 18 |
| `taxCode` | `string` | Yes | **stable-code** | HSN/SAC code |
| `barcode` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `sku` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `hasExpiry` | `boolean` | No | **owned attribute/state** | Confirmed canonical name |
| `trackStock` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `currentStock` | `number` | No | **derived value** | Maintained stock total (Stock read strategy option a) |
| `lowStockThreshold` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `trackBatch` | `boolean` | Yes | **owned attribute/state** | Direct entity state attribute |
| `trackSerial` | `boolean` | Yes | **owned attribute/state** | Direct entity state attribute |
| `hasVariants` | `boolean` | Yes | **owned attribute/state** | Direct entity state attribute |
| `isPurchaseOnly` | `boolean` | Yes | **owned attribute/state** | Direct entity state attribute |
| `isExpenseOnly` | `boolean` | Yes | **owned attribute/state** | Direct entity state attribute |
| `isSaleOnly` | `boolean` | Yes | **owned attribute/state** | Direct entity state attribute |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 17. `category` (`CategoryDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string \| null` | No | **identity** | Null for global/system categories |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `nameKey` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `parentId` | `string \| null` | Yes | **reference-by-ID** | Parent category ID for hierarchical structure |
| `nature` | `string` | Yes | **owned attribute/state** | "operational", "administrative", "cogs", etc. |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 18. `unit` (`UnitDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string \| null` | No | **identity** | Null for system units |
| `name` | `string` | No | **owned attribute/state** | e.g. "Kilogram", "Piece", "Liter" |
| `code` | `string` | No | **owned attribute/state** | e.g. "kg", "pcs", "ltr" |
| `group` | `UnitGroup` | No | **owned attribute/state** | count, weight, volume, length, area, time |
| `precision` | `number` | No | **owned attribute/state** | 0-4 |
| `baseUnit` | `string \| null` | Yes | **stable-code** | Reference code if derived |
| `conversionFactor` | `number` | Yes | **owned attribute/state** | Relative to baseUnit |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 19. `customer` (`CustomerDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `customerCode` | `string` | No | **stable-code** | e.g. "CUST-000001" |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `mobile` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `email` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `taxNumber` | `string \| null` | Yes | **owned attribute/state** | GSTIN / VAT registration |
| `billingAddress` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `shippingAddress` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `priceGroup` | `string` | Yes | **owned attribute/state** | "retail", "wholesale", "distributor" |
| `creditLimit` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `creditPeriodDays` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `outstandingBalance` | `number` | No | **owned attribute/state** | Udhaar amount customer owes |
| `totalSpend` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `visibilityScope` | `"all_branches" \| "selected_branches" \| "branch_only"` | Yes | **owned attribute/state** | Branch visibility scope (default: all_branches) |
| `sharedForBranchIds` | `string[]` | Yes | **reference-by-ID** | Branch IDs allowed to access this customer record |
| `isDefault` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 20. `vendor` (`VendorDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `vendorCode` | `string` | No | **stable-code** | e.g. "VEND-000001" |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `mobile` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `email` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `taxNumber` | `string \| null` | Yes | **owned attribute/state** | GSTIN / TRN |
| `address` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `contactPerson` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `paymentTermsDays` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `creditLimit` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `outstandingPayable` | `number` | No | **owned attribute/state** | Amount owed to vendor |
| `totalPurchase` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `visibilityScope` | `"all_branches" \| "selected_branches" \| "branch_only"` | Yes | **owned attribute/state** | Branch visibility scope (default: all_branches) |
| `sharedForBranchIds` | `string[]` | Yes | **reference-by-ID** | Branch IDs allowed to access this vendor record |
| `isDefault` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 21. `outflow` (`OutflowDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `outflowNumber` | `string` | No | **owned attribute/state** | e.g. "PUR-2026-000001" or "EXP-2026-000001" |
| `kind` | `OutflowKind` | No | **owned attribute/state** | purchase or expense |
| `status` | `OutflowStatus` | No | **owned attribute/state** | draft, confirmed, voided |
| `docDate` | `string` | No | **system-audit metadata** | ISO 8601 |
| `vendorId` | `string \| null` | Yes | **reference-by-ID** | Reference to vendors/{vendorId} |
| `vendorName` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `payee` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `invoiceNumber` | `string` | Yes | **owned attribute/state** | External vendor invoice # |
| `dueDate` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `lines` | `OutflowLine[]` | No | **owned attribute/state** | Direct entity state attribute |
| `subTotal` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `discountTotal` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `taxTotal` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `totalAmount` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `paidAmount` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `balanceAmount` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `paymentStatus` | `PaymentStatus` | No | **owned attribute/state** | paid, pending, partial |
| `taxSnapshot` | `TaxSnapshot \| null` | Yes | **justified snapshot** | Explicitly named immutable point-in-time snapshot for billing/audit display |
| `notes` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 22. `bill` (`BillDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `billNumber` | `string` | No | **owned attribute/state** | e.g. "INV-2026-000001", "POS-2026-000001", "QTN-2026-000001" |
| `salesMode` | `SalesMode` | No | **owned attribute/state** | pos or b2b |
| `documentType` | `DocumentType` | Yes | **owned attribute/state** | invoice, quotation, sales_order, proforma |
| `salespersonMembershipId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `customerId` | `string \| null` | Yes | **reference-by-ID** | Reference to customers/{customerId} |
| `customerSnapshot` | `BillCustomerSnapshot \| null` | Yes | **justified snapshot** | Explicitly named immutable point-in-time snapshot for billing/audit display |
| `items` | `BillItem[]` | No | **owned attribute/state** | Direct entity state attribute |
| `subTotal` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `discountTotal` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `taxTotal` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `roundOff` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `totalAmount` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `paidAmount` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `balanceAmount` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `paymentStatus` | `PaymentStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `status` | `BillStatus \| "draft" \| "active" \| "voided" \| "cancelled" \| "refunded"` | No | **owned attribute/state** | Direct entity state attribute |
| `taxSnapshot` | `TaxSnapshot \| null` | Yes | **justified snapshot** | Explicitly named immutable point-in-time snapshot for billing/audit display |
| `notes` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 23. `stockmovement` (`StockMovementDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `productId` | `string` | No | **reference-by-ID** | Reference to products/{productId} |
| `type` | `StockMovementType` | No | **owned attribute/state** | Direct entity state attribute |
| `quantity` | `number` | No | **owned attribute/state** | Signed change (+ addition, - reduction) |
| `balanceAfter` | `number` | No | **derived value** | Maintained product stock after this movement |
| `unit` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `referenceId` | `string` | No | **reference-by-ID** | ID reference to bill, outflow, return, or adjustment |
| `referenceModel` | `"bill" \| "outflow" \| "return" \| "manual_adjustment"` | No | **owned attribute/state** | Direct entity state attribute |
| `reason` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 24. `delivery` (`DeliveryDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `billId` | `string` | No | **reference-by-ID** | ID reference ONLY! No embedded bill object. |
| `customerId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `customerName` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `customerPhone` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `address` | `DeliveryAddress` | No | **owned attribute/state** | Destination delivery address |
| `riderMembershipId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `riderName` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `partner` | `DeliveryPartner` | No | **owned attribute/state** | internal, swiggy, zomato, dunzo, other |
| `deliveryFee` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `status` | `DeliveryStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `cod` | `DeliveryCod` | Yes | **owned attribute/state** | Direct entity state attribute |
| `notes` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 25. `return` (`ReturnDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `returnNumber` | `string` | No | **owned attribute/state** | e.g. "RET-2026-000001" |
| `returnType` | `ReturnType` | No | **owned attribute/state** | sales_return or purchase_return |
| `referenceId` | `string` | No | **reference-by-ID** | billId or outflowId (ID reference only!) |
| `referenceNumber` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `partyId` | `string \| null` | Yes | **reference-by-ID** | customerId or vendorId |
| `partyName` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `items` | `ReturnItem[]` | No | **owned attribute/state** | Direct entity state attribute |
| `totalRefundAmount` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `refundMethod` | `string` | No | **owned attribute/state** | cash, credit_note, original_payment |
| `status` | `"completed" \| "voided"` | No | **owned attribute/state** | Direct entity state attribute |
| `notes` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 26. `payment` (`PaymentDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `paymentNumber` | `string` | No | **owned attribute/state** | e.g. "PAY-2026-000001" |
| `direction` | `PaymentDirection` | No | **owned attribute/state** | in (collection from customer) or out (payment to vendor) |
| `partyType` | `PartyType` | No | **owned attribute/state** | customer or vendor |
| `partyId` | `string \| null` | Yes | **reference-by-ID** | ID reference to customer or vendor |
| `partyName` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `amount` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `method` | `PaymentMethod` | No | **owned attribute/state** | Direct entity state attribute |
| `referenceId` | `string \| null` | Yes | **reference-by-ID** | billId or outflowId (ID reference only!) |
| `referenceModel` | `"bill" \| "outflow" \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `referenceNumber` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `notes` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `status` | `"completed" \| "voided"` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 27. `documentcounter` (`DocumentCounterDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `type` | `string` | No | **owned attribute/state** | "INV", "POS", "PUR", "EXP", "PAY", "RET", "DEL" |
| `year` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `currentSequence` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 28. `task` (`TaskDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Tenant reference |
| `title` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `description` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `assignedToMembershipId` | `string` | No | **reference-by-ID** | Reference to memberships/{uid}_{orgId} |
| `assignedByMembershipId` | `string` | No | **reference-by-ID** | Reference to memberships/{uid}_{orgId} |
| `status` | `TaskStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `priority` | `TaskPriority` | No | **owned attribute/state** | Direct entity state attribute |
| `dueAt` | `string` | Yes | **owned attribute/state** | ISO 8601 string |
| `relatedEntityType` | `TaskRelatedEntityType \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `relatedEntityId` | `string \| null` | Yes | **reference-by-ID** | ID-only reference |
| `completedAt` | `string \| null` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `completedByMembershipId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 29. `dailysummary` (`DailySummaryDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `date` | `string` | No | **owned attribute/state** | YYYY-MM-DD |
| `totalRevenue` | `number` | No | **derived value** | Gross bill total amount |
| `totalExpenses` | `number` | No | **derived value** | Outflow expenses total amount |
| `cogs` | `number` | No | **derived value** | Cost of goods sold (WAC * sold quantity) |
| `grossProfit` | `number` | No | **derived value** | totalRevenue - cogs |
| `netProfit` | `number` | No | **derived value** | grossProfit - totalExpenses |
| `billCount` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `outflowCount` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `paymentBreakdown` | `{` | No | **owned attribute/state** | Direct entity state attribute |
| `cash` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `upi` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `card` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `bank_transfer` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `credit` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `other` | `number` | No | **owned attribute/state** | Direct entity state attribute |

### 30. `monthlysummary` (`MonthlySummaryDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `yearMonth` | `string` | No | **owned attribute/state** | YYYY-MM |
| `totalRevenue` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `totalExpenses` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `cogs` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `grossProfit` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `netProfit` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `billCount` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `outflowCount` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `daysRecorded` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 31. `latestlocation` (`LatestLocationDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `membershipId` | `string` | No | **reference-by-ID** | Reference to memberships/{uid}_{orgId} |
| `userId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `latitude` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `longitude` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `accuracy` | `number` | Yes | **owned attribute/state** | Accuracy in meters |
| `speed` | `number` | Yes | **owned attribute/state** | Speed in m/s |
| `heading` | `number` | Yes | **owned attribute/state** | Heading in degrees |
| `source` | `"foreground" \| "background"` | No | **owned attribute/state** | Direct entity state attribute |
| `recordedAt` | `string` | No | **owned attribute/state** | ISO 8601 string |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 32. `locationping` (`LocationPingDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `membershipId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `userId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `latitude` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `longitude` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `accuracy` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `speed` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `heading` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `source` | `"foreground" \| "background"` | No | **owned attribute/state** | Direct entity state attribute |
| `recordedAt` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 33. `notification` (`NotificationDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `userId` | `string` | No | **reference-by-ID** | Recipient user ID |
| `membershipId` | `string` | No | **reference-by-ID** | Recipient membership ID |
| `type` | `NotificationType` | No | **owned attribute/state** | Direct entity state attribute |
| `title` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `body` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `relatedEntityType` | `string \| null` | Yes | **owned attribute/state** | Direct entity state attribute |
| `relatedEntityId` | `string \| null` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `data` | `Record<string, string>` | Yes | **owned attribute/state** | Direct entity state attribute |
| `isRead` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `readAt` | `string \| null` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 34. `branch` (`BranchDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `name` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `code` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `isDefault` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `isActive` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `status` | `EntityStatus` | Yes | **owned attribute/state** | Direct entity state attribute |
| `gstin` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `address` | `BranchAddress` | Yes | **owned attribute/state** | Direct entity state attribute |
| `contact` | `BranchContact` | Yes | **owned attribute/state** | Direct entity state attribute |
| `settings` | `BranchSettings` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 35. `branchcodelock` (`BranchCodeLockDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `code` | `string` | Yes | **owned attribute/state** | Direct entity state attribute |
| `branchId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `branchCode` | `string` | Yes | **stable-code** | Standardized or system-wide immutable lookup code |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 36. `membershipbranch` (`MembershipBranchDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `membershipId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `userId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `status` | `EntityStatus` | No | **owned attribute/state** | Direct entity state attribute |
| `isDefaultForMembership` | `boolean` | No | **owned attribute/state** | Direct entity state attribute |
| `permissions` | `Record<string, boolean>` | Yes | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedAt` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 37. `stockbalance` (`StockBalanceDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `productId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `currentStock` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `allocatedStock` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `availableStock` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `reorderPoint` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `lowStockThreshold` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `lastMovementId` | `string` | Yes | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `updatedBy` | `string` | Yes | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 38. `organizationusagedaily` (`OrganizationUsageDailyDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `date` | `string` | No | **owned attribute/state** | YYYY-MM-DD |
| `counts` | `ServiceUsageCounts` | No | **owned attribute/state** | Direct entity state attribute |
| `estimatedCost` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `currency` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `rateCardVersion` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `completenessPercent` | `number` | No | **owned attribute/state** | Indicates confidence/coverage (e.g., 90) |
| `measurementClass` | `MeasurementClass` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 39. `branchusagedaily` (`BranchUsageDailyDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `branchId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `date` | `string` | No | **owned attribute/state** | YYYY-MM-DD |
| `counts` | `ServiceUsageCounts` | No | **owned attribute/state** | Direct entity state attribute |
| `estimatedCost` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `currency` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `rateCardVersion` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `completenessPercent` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `measurementClass` | `MeasurementClass` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `updatedAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

### 40. `platformusagesnapshot` (`PlatformUsageSnapshotDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `date` | `string` | No | **owned attribute/state** | YYYY-MM-DD |
| `source` | `"cloud_monitoring" \| "emulator_mock" \| "app_aggregation"` | No | **owned attribute/state** | Direct entity state attribute |
| `platformTotals` | `ServiceUsageCounts` | No | **owned attribute/state** | Direct entity state attribute |
| `platformActualCost` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `currency` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `asOf` | `string` | No | **owned attribute/state** | Direct entity state attribute |

### 41. `usageratecard` (`UsageRateCardDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `version` | `string` | No | **identity** | Primary identity / tenant partition key |
| `effectiveDate` | `string` | No | **owned attribute/state** | Direct entity state attribute |
| `currency` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `rates` | `{` | No | **owned attribute/state** | Direct entity state attribute |
| `firestoreReadPer100k` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `firestoreWritePer100k` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `firestoreDeletePer100k` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `functionsInvocationPerMillion` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `functionsComputeGbSecond` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `storageGbMonth` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `fcmPerThousand` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `locationPingPer100k` | `number` | No | **owned attribute/state** | Direct entity state attribute |

### 42. `usageallocationrun` (`UsageAllocationRunDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `runId` | `string` | No | **identity** | Primary identity / tenant partition key |
| `billingPeriod` | `string` | No | **owned attribute/state** | YYYY-MM |
| `rateCardVersion` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `totalPlatformCost` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `allocatedTenantCost` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `unallocatedPlatformOverhead` | `number` | No | **derived value** | Computed financial or inventory running balance / summary |
| `currency` | `string` | No | **stable-code** | Standardized or system-wide immutable lookup code |
| `status` | `"draft_estimate" \| "audited"` | No | **owned attribute/state** | Direct entity state attribute |
| `createdAt` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |
| `createdBy` | `string` | No | **system-audit metadata** | System lifecycle timestamp or actor metadata |

