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

Total Concrete Collections & Subcollections: **44** (42 Root Collections + 2 Subcollections, mapping to 43 TypeScript `Doc` interfaces in `models.ts` + `barcodeLocks` concurrency lock)

| # | Collection Path | Primary Interface | Storage Type | Domain |
|---|---|---|---|---|
| 1 | `users/{uid}` | `UserDoc` | Root Collection | Tenant & RBAC |
| 2 | `memberships/{membershipId}` | `MembershipDoc` | Root Collection | Tenant & RBAC |
| 3 | `organizations/{organizationId}` | `OrganizationDoc` | Root Collection | Tenant & RBAC |
| 4 | `organizations/{organizationId}/branches/{branchId}` | `BranchDoc` | Subcollection | Multi-Branch Architecture |
| 5 | `users/{uid}/devices/{deviceId}` | `DeviceDoc` | Subcollection | System Infrastructure |
| 6 | `roles/{roleId}` | `RoleDoc` | Root Collection | Tenant & RBAC |
| 7 | `departments/{departmentId}` | `DepartmentDoc` | Root Collection | Tenant & RBAC |
| 8 | `jobRoles/{jobRoleId}` | `JobRoleDoc` | Root Collection | Tenant & RBAC |
| 9 | `teams/{teamId}` | `TeamDoc` | Root Collection | Tenant & RBAC |
| 10 | `subscriptionPlans/{planId}` | `SubscriptionPlanDoc` | Root Collection | Tenant & RBAC |
| 11 | `permissionCatalog/{permissionCode}` | `PermissionCatalogDoc` | Root Collection | Tenant & RBAC |
| 12 | `modules/{moduleCode}` | `ModuleDoc` | Root Collection | Tenant & RBAC |
| 13 | `taxRegimes/{taxRegimeCode}` | `TaxRegimeDoc` | Root Collection | Tenant & RBAC |
| 14 | `idempotencyRecords/{recordId}` | `IdempotencyRecordDoc` | Root Collection | System Infrastructure |
| 15 | `auditLogs/{logId}` | `AuditLogDoc` | Root Collection | System Infrastructure |
| 16 | `notificationOutbox/{outboxId}` | `NotificationOutboxDoc` | Root Collection | Tenant & RBAC |
| 17 | `products/{productId}` | `ProductDoc` | Root Collection | Catalog & Inventory |
| 18 | `categories/{categoryId}` | `CategoryDoc` | Root Collection | Catalog & Inventory |
| 19 | `units/{unitId}` | `UnitDoc` | Root Collection | Catalog & Inventory |
| 20 | `customers/{customerId}` | `CustomerDoc` | Root Collection | Parties & Ledgers |
| 21 | `vendors/{vendorId}` | `VendorDoc` | Root Collection | Parties & Ledgers |
| 22 | `outflows/{outflowId}` | `OutflowDoc` | Root Collection | Operations & Transactions |
| 23 | `bills/{billId}` | `BillDoc` | Root Collection | Operations & Transactions |
| 24 | `stockMovements/{movementId}` | `StockMovementDoc` | Root Collection | Catalog & Inventory |
| 25 | `deliveries/{deliveryId}` | `DeliveryDoc` | Root Collection | Operations & Transactions |
| 26 | `returns/{returnId}` | `ReturnDoc` | Root Collection | Operations & Transactions |
| 27 | `payments/{paymentId}` | `PaymentDoc` | Root Collection | Operations & Transactions |
| 28 | `documentCounters/{counterId}` | `DocumentCounterDoc` | Root Collection | System Infrastructure |
| 29 | `tasks/{taskId}` | `TaskDoc` | Root Collection | Tasks, Location & Notifications |
| 30 | `dailySummaries/{summaryId}` | `DailySummaryDoc` | Root Collection | Analytics & Usage Metering |
| 31 | `monthlySummaries/{summaryId}` | `MonthlySummaryDoc` | Root Collection | Analytics & Usage Metering |
| 32 | `latestLocations/{locationId}` | `LatestLocationDoc` | Root Collection | Tasks, Location & Notifications |
| 33 | `locationPings/{pingId}` | `LocationPingDoc` | Root Collection | Tasks, Location & Notifications |
| 34 | `notifications/{notificationId}` | `NotificationDoc` | Root Collection | Tasks, Location & Notifications |
| 35 | `branchCodeLocks/{lockId}` | `BranchCodeLockDoc` | Root Collection | Multi-Branch Architecture |
| 36 | `membershipBranches/{membershipBranchId}` | `MembershipBranchDoc` | Root Collection | Multi-Branch Architecture |
| 37 | `stockBalances/{stockBalanceId}` | `StockBalanceDoc` | Root Collection | Catalog & Inventory |
| 38 | `organizationUsageDaily/{docId}` | `OrganizationUsageDailyDoc` | Root Collection | Analytics & Usage Metering |
| 39 | `organizationUsageMonthly/{docId}` | `OrganizationUsageMonthlyDoc` | Root Collection | Analytics & Usage Metering |
| 40 | `branchUsageDaily/{docId}` | `BranchUsageDailyDoc` | Root Collection | Analytics & Usage Metering |
| 41 | `branchUsageMonthly/{docId}` | `BranchUsageMonthlyDoc` | Root Collection | Analytics & Usage Metering |
| 42 | `platformUsageSnapshots/{docId}` | `PlatformUsageSnapshotDoc` | Root Collection | Analytics & Usage Metering |
| 43 | `usageRateCards/{docId}` | `UsageRateCardDoc` | Root Collection | Analytics & Usage Metering |
| 44 | `usageAllocationRuns/{docId}` | `UsageAllocationRunDoc` | Root Collection | Analytics & Usage Metering |
| * | `barcodeLocks/{lockId}` | Concurrency Lock | Root Collection | Catalog & Inventory |

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

`auditLogs/{requestId}_{seq}`, written only by `services/auditRecorder.ts`: mutation events in the same commit as the mutation, denied / failed / export / auth / file events at the end of the request. Field-level detail is generated in [entity-fields.md](reference/entity-fields.md); what is recorded, redacted and retained is in [the audit guide](guides/audit-trail.md). `occurredAt` and `expireAt` are Firestore Timestamps (TTL).

### 14. `device` (`DeviceDoc` — Subcollection at `users/{uid}/devices/{deviceId}`)

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
| `taxId` | `string \| null` | Yes | **owned attribute/state** | GSTIN / VAT registration |
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
| `taxId` | `string \| null` | Yes | **owned attribute/state** | GSTIN / TRN |
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
| `branchId` | `string` | Yes | **reference-by-ID** | Foreign key reference to operating branch |
| `membershipId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `userId` | `string` | No | **reference-by-ID** | Foreign key reference by bare ID to related entity |
| `latitude` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `longitude` | `number` | No | **owned attribute/state** | Direct entity state attribute |
| `accuracy` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `speed` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `heading` | `number` | Yes | **owned attribute/state** | Direct entity state attribute |
| `source` | `"foreground" \| "background"` | No | **owned attribute/state** | Direct entity state attribute |
| `recordedAt` | `string` | No | **owned attribute/state** | Client device recorded timestamp (sanitized to [-7 days, +5 mins] window) |
| `createdAt` | `string` | No | **system-audit metadata** | Trusted server ingestion timestamp (ISO 8601) |
| `expiresAt` | `Timestamp` | No | **owned attribute/state** | Native Firestore Timestamp for Cloud Firestore TTL (precomputed `createdAt + 7 days`) |

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

### 38–43. Usage and cost (prompt 66)

Field-level detail is generated from the document types in [entity-fields.md](reference/entity-fields.md); the design is in [the cost-tracking guide](guides/cost-tracking.md).

| Collection | Type | Written by | Holds |
|---|---|---|---|
| `organizationUsageDaily/{organizationId}_{utcDate}` | `OrganizationUsageDailyDoc` | `services/requestRecorder.ts` (cost rollup) and `usageRecordClientMetric` (`clientReported` only) | organization × day quantities measured by the counting layer; `platform_{utcDate}` holds platform work with `targets` per organization; no cost (D-22) |
| `userUsageDaily/{organizationId}_{uid}_{utcDate}` | `UserUsageDailyDoc` | `services/requestRecorder.ts` | organization × user × day quantities and devices |
| `organizationUsageMonthly`, `branchUsageDaily`, `branchUsageMonthly` | `OrganizationUsageMonthlyDoc`, `BranchUsageDailyDoc`, `BranchUsageMonthlyDoc` | `usageRecordClientMetric` | client-reported numbers only (`clientReported`), untrusted |
| `usageRateCards/{version}` | `UsageRateCardDoc` | Super Admin | versioned prices with their verification state ([rate card](reference/rate-card.md)) |

Rules: no client access. Retention: `expireAt` on the rollups (TTL policy is a cloud setting).

### 44. `barcodeLocks` (`BarcodeLockDoc`)

| Field Name | Type | Optional | Classification | Description / Justification |
|---|---|:---:|---|---|
| `organizationId` | `string` | No | **identity** | Organization owning this barcode allocation |
| `barcode` | `string` | No | **owned attribute/state** | Scanned or assigned physical barcode string |
| `lockedAt` | `string` | No | **system-audit metadata** | ISO 8601 acquisition timestamp for transaction lock |

---

### 45. `usageCounterShards` (server-observed usage)

Doc id `{organizationId}_{YYYY-MM}_{shard 0..7}`. Fields: `organizationId`, `month`, `shard`, `days.{YYYY-MM-DD}.{functionsInvocations|firestoreReads|firestoreWrites|locationPings}`, `branches.{branchId}.{YYYY-MM-DD}.{metric}`, `updatedAt`. One increment per gated call on a random shard; daily/weekly (ISO, Monday start, org timezone)/monthly totals are sums across shards. Rules: Super Admin read only.

### 46. `vendorInvoiceLocks` (purchase invoice uniqueness)

Doc id `{organizationId}_{vendorId}_{invoiceNumber lower-case}`. Fields: `organizationId`, `vendorId`, `outflowId`, `createdAt` (the invoice number is the id; nothing is copied). Created in the purchase transaction; deleted when the purchase is voided/cancelled. Rules: no client access.

### Field additions (2026-11-07)

| Collection | New fields |
|---|---|
| `organizations` | `subscriptionStatus`, `subscriptionStartsAt`, `subscriptionExpiresAt` (end of day in `timezone`), `graceDays`, `timezone`, `salesChannels[]`, `activeEmployeeCount`, `displayName`, `taxId`, `website`, `contact`, `contacts`, `addresses`, `image`, `bankAccounts`, `settings.approvals`, `updatedBy` |
| `memberships` | `dataScopes{module: self|team|branch|organization}`, `updatedBy` |
| `teams` | `description`, `leaderMembershipId`, `isActive`, `updatedBy` |
| `products` | `brand`, `alternateUnits[{unit,factor,sellingPrice,wholesalePrice,barcode,isPurchaseUnit,isSaleUnit}]`, `maxDiscountPercent`, `isReturnable`, `returnWindowDays`, `reorderLevel`, `maxStockLevel`, `weight`, `dimensions`, `size`, `imagePaths[]`, `warrantyMonths`, `jewellery{grossWeightGrams,netWeightGrams,purity,makingCharge,makingChargeType,hallmarkId,priceByDailyRate}`, `variantGroupId`, `variantAttributes`, `visibilityScope`, `sharedForBranchIds`, `ownerBranchId`, `updatedBy` |
| `bills` | `approvalStatus`, `approvalNote`, `requestedPaidAmount`, `requestedPaymentMethod`, `stockReserved`, `createdByMembershipId`, `voidReason/voidedAt/voidedBy`, `approvedAt/By`, `rejectedAt/By`; items: `conversionFactor`, `baseQuantity`, `trackStock`, `serialNumbers[]`, `isReturnable` |
| `outflows` | `approvalStatus`, `approvalNote`, `requestedPaidAmount`, `requestedPaymentMethod`, `payeeType`, `payeeMembershipId`, `expenseCategoryId`, `billDiscountAmount`, `attachmentPaths[]`, `productIds[]`, `createdByMembershipId`, void/approval actor fields; lines: `conversionFactor`, `baseQuantity`, `damagedQuantity`, `damageReason`, `serialNumbers[]` |
| `stockMovements` | `reasonCode` (damaged, expired, lost_theft, sample, internal_use, damaged_on_receipt, count_correction, opening_stock, other), `unitCostSnapshot` |
| `stockBalances` | `allocatedStock` (sales-order reservations; available = current − allocated) |
| `payments` | `gateway{externalReference,gatewayProvider,gatewayStatus,cardBrand,cardLast4}` (never card numbers); `partyType` adds `employee`, `other` |
| `deliveries` | `deliveredAt`, `updatedBy` |
| `returns` | `createdByMembershipId` |
| `auditLogs` | unified event (prompt 66): `occurredAt`, `actor`, `source`, `device`, `category`, `outcome`, `targets`, `changes{fields[{path,op,before,after}]}`, `changedFields[]` |

## Whole-System Schema Matrix (2026-11-07)

Dates: every business date is a server-set ISO-8601 UTC string; native Timestamps are used only for TTL (`locationPings.expiresAt`). "Rules read" is the direct client SDK path; "callable" means denied in rules and served by callables.

| Collection | organizationId | branchId | created actor+time | updated actor+time | Rules read |
|---|---|---|---|---|---|
| users | — | — | createdAt/By | updatedAt | own |
| users/{uid}/devices | — | — | createdAt | updatedAt | own |
| memberships | ✓ | primaryBranchId | createdAt/By | updatedAt/By | own / active org member |
| organizations | (id) | defaultBranchId | createdAt/By | updatedAt/By | active member |
| organizations/{id}/branches | ✓ | (id) | createdAt/By | updatedAt/By | active member |
| membershipBranches | ✓ | ✓ | createdAt/By | updatedAt | own / active member |
| roles, departments, jobRoles | ✓ or null | — | createdAt/By | updatedAt/By | active member / global |
| teams | ✓ | — | createdAt/By | updatedAt/By | active member |
| subscriptionPlans, permissionCatalog, modules, taxRegimes | — | — | createdAt/By (plans) | updatedAt/By | authenticated |
| products | ✓ | ownerBranchId | createdAt/By | updatedAt/By | **callable** |
| categories, units | ✓ or null | — | createdAt/By | updatedAt/By | active member / global |
| customers, vendors | ✓ | sharedForBranchIds | createdAt/By | updatedAt/By | **callable** |
| outflows, bills | ✓ | ✓ | createdAt/By (+MembershipId) | updatedAt/By | **callable** |
| stockMovements | ✓ | ✓ | createdAt/By | immutable | **callable** |
| stockBalances | ✓ | ✓ | — | updatedAt/By | active member |
| deliveries, returns, payments | ✓ | ✓ | createdAt/By | updatedAt/By | **callable** |
| tasks | ✓ | — | createdAt/By | updatedAt | own (assignee/creator) |
| dailySummaries, monthlySummaries | ✓ | — | — | updatedAt (trigger) | **callable** |
| latestLocations, locationPings | ✓ | ✓ (pings) | recordedAt, createdAt | updatedAt | own only |
| notifications | ✓ | — | createdAt | readAt | own |
| documentCounters, idempotencyRecords, auditLogs, notificationOutbox, barcodeLocks, branchCodeLocks, vendorInvoiceLocks | ✓ (most) | — | createdAt / timestamp | updatedAt | none |
| organizationUsageDaily/Monthly, branchUsageDaily/Monthly, usageCounterShards, platformUsageSnapshots, usageRateCards, usageAllocationRuns | ✓ (tenant ones) | ✓ (branch ones) | createdAt (rate cards/runs) | updatedAt | Super Admin |

Gaps still open: `departments`/`jobRoles` documents have no `isActive`; `notificationOutbox` has no `updatedBy`; `organizationUsageMonthly` has no explicit rule (falls to catch-all deny, so even Super Admin cannot read it directly).

## Conditional Data Invariants & Cross-Field Rules

To guarantee strict transactional integrity across financial, inventory, and multi-tenant domain boundaries, the backend enforces the following mandatory conditional invariants:

### 1. Quotation & Draft Lifecycle Invariant (`isQuotationOrDraft`)
- **Condition**: A bill document where `isQuotationOrDraft == true` (e.g. `docType == "quotation"` or draft invoice).
- **Rule**:
  - Does **NOT** deduct physical inventory from `products/{productId}` or `stockBalances/{stockBalanceId}`.
  - Does **NOT** create `stockMovements` ledger entries.
  - Does **NOT** increment customer outstanding debt or accounts receivable (`currentBalance`).
  - Does **NOT** consume sequential fiscal document numbers (`documentCounters`).
  - Does **NOT** lock authoritative COGS snapshots until finalization.
- **Finalization**: When `billsFinalize` is invoked:
  - Validates pre-condition: document must still be in draft/quotation state. Sequential duplicate calls are immediately rejected with `FAILED_PRECONDITION`.
  - Atomically allocates the next sequential invoice number (e.g. `INV-2026-000001`).
  - Reads active product records inside the transaction and locks immutable `costSnapshot` (`pData.weightedAverageCost ?? pData.costPrice ?? 0`) on each bill line item. Zero cost ($0.00) is strictly treated as valid and preserved.
  - Decrements physical stock from `products` and `stockBalances` inside the same Firestore transaction.
  - Creates the audit `stockMovement` record and mutates customer ledger.

### 2. Weighted Average Costing (WAC) Synchronous Atomic Intake Invariant
- **Condition**: Purchase intake execution via `outflowsCreate`.
- **Rule**:
  - In `outflowsCreate`, WAC recalculation is executed **synchronously inside the atomic transaction** (`prepareStockChangesInTxn` / `commitStockChangesInTxn`), rather than relying asynchronously on `onOutflowWritten`.
  - Base stock prior to intake is captured from the transactional read:
    $$\text{previousStock} = \text{productRef.currentStock}$$
  - The new weighted average cost is computed and written atomically with stock update:
    $$\text{WAC}_{\text{new}} = \frac{(\text{previousStock} \times \text{WAC}_{\text{old}}) + (\text{intakeQuantity} \times \text{costPrice})}{\text{previousStock} + \text{intakeQuantity}}$$
  - The `onOutflowWritten` background trigger acts solely as an idempotent safety fallback if uninitialized, completely preventing race conditions between subsequent rapid sales and background triggers.

### 3. Sales Mode & Party Compatibility Invariant
- **Condition**: Bill generation (`billsCreate`).
- **Rule**:
  - The organization/branch `salesMode` (`"pos" | "b2b" | "both"`) governs permissible party and payment configurations.
  - POS retail transactions require immediate cash/card/UPI tender or an authenticated customer profile.
  - B2B transactions require a valid `customerId` with `businessType == "business"` and credit limit validation before allowing payment terms.

### 4. Customer & Vendor Visibility Scope Invariant
- **Condition**: Party lookups, customer selection in POS/B2B, and vendor allocation in purchase outflows.
- **Rule**:
  - `visibilityScope == "all_branches"`: Party is visible, selectable, and debt-bearing across all operating branches within the organization.
  - `visibilityScope == "branch_only"`: Party operations are strictly constrained to branches listed in `restrictedToBranchIds`. Attempting to record a bill or purchase at an unlisted branch is rejected with `INVALID_ARGUMENT`.

### 5. Return Ceiling & COGS Restocking Invariant
- **Condition**: Customer sales return creation (`returnsCreate`).
- **Rule**:
  - For each line item being returned, `returnQuantity` must satisfy:
    $$\text{returnQuantity} \le \text{originalSoldQuantity} - \text{previouslyReturnedQuantity}$$
  - Any over-return attempt is rejected with `INVALID_ARGUMENT`.
  - Valid returns preserve the line item's original `costSnapshot` from the source bill.
  - When line item disposition is `restocked_to_inventory`, physical stock is replenished and COGS is reversed in P&L reporting. If disposition is `waste_damaged` or `returned_to_vendor`, physical inventory is not restocked into saleable inventory and COGS is retained as recognized loss.

### 6. Branch Limit Quota Invariant
- **Condition**: Branch creation (`branchesCreate`) and reactivation (`branchesUpdate`).
- **Rule**:
  - The count of active branches in `organizations/{orgId}/branches` must be strictly less than `subscriptionPlans/{planId}.branchLimit`.
  - If $\text{activeBranchCount} \ge \text{branchLimit}$, the operation is rejected with `FAILED_PRECONDITION: Branch limit reached`.
  - Deactivating a branch decrements the active count, allowing capacity reuse.

### 7. Ephemeral Location Retention & Cloud Firestore TTL Invariant
- **Condition**: Staff live GPS coordinate logging (`locationsRecordPing`).
- **Rule**:
  - Cloud Firestore TTL enforces document deletion based on a native Firestore `Timestamp` pointing to a timestamp in the past.
  - `LocationPingDoc.expiresAt` is stored as a **native Firestore `Timestamp`** precomputed at trusted server ingestion time:
    $$\text{expiresAt} = \text{Timestamp.fromDate}(\text{serverCreatedAt} + 7\text{ days})$$
  - Client device timestamps (`recordedAt`) are strictly validated against a permitted $[-7\text{ days}, +5\text{ mins}]$ clock skew window, falling back to server time if outside boundaries.
  - Deactivated or inactive employees are strictly rejected (`failed-precondition` / `permission-denied`), ensuring GDPR/privacy compliance.

### 8. Usage Metering, Quota Threshold Warnings & Non-Blocking Resilience
- **Condition**: Metered operations across Firestore reads/writes, Functions invocations, and telemetry.
- **Rule**:
  - Multi-tenant usage aggregates into `organizationUsageDaily`, `organizationUsageMonthly`, `branchUsageDaily`, and `branchUsageMonthly` via `FieldValue.increment`.
  - Effective limits are evaluated by layering plan defaults (`subscriptionPlans/{planId}.usageLimits`) with Super-Admin organization overrides (`organizations/{orgId}.usageLimitOverrides`).
  - When usage crosses warning (80%) or hard (100%) thresholds in `warn_only` mode, warnings are dispatched to tenant owners and recorded in `notificationOutbox` with deterministic deduplication keys (`outbox_usage_${organizationId}_${metric}_${period}_${severity}`).
  - Core business transactions (`billsCreate`, `outflowsCreate`, `paymentsCreate`) remain strictly non-blocking even when warnings trigger.



### 9. Units, Write-offs, Reservations & Reversal Invariants (2026-11-07)

- **Base-unit stock**: stock and WAC are always in `product.baseUnit`. A line in an alternate unit freezes `conversionFactor` and `baseQuantity`; `costSnapshot` is per line unit (base cost × factor) so COGS = quantity × costSnapshot. Several lines of one product in one document chain correctly in the stock engine.
- **Untracked items** (`trackStock: false`) never create stock movements or balances.
- **Write-offs**: outward manual adjustments (`adjustment_out`, `damage_out`) and damaged-on-receipt units are valued at `unitCostSnapshot` and reported as `inventoryWriteOff` in the P&L. Sales returns marked `wasted_discarded` keep their COGS (no reversal), so they are not double counted.
- **Sales orders** reserve `allocatedStock`; finalization (`billsFinalize` or delivery `delivered`) releases the reservation and deducts stock; cancellation releases it.
- **Pending approval** documents have no stock, ledger, payment or reservation effect.
- **Void** never deletes: it posts reversal movements, reverses party balances and voids linked payments; documents with live returns must have the returns voided first.
- **Total outflow** (purchases + expenses) is a spend view; the P&L uses COGS for purchased goods.

## Allowed duplication register

The zero-duplication rule: a value lives in exactly one place and everything else stores the owner's **id**. The only permitted exceptions are listed below. **R2** is a frozen fact of the transaction date and is never descriptive, except the GST bill-to block. **R3** is an aggregate cache with one writer path and a reconcile check run by `npm run check:data`. **R4** is a ledger entry. **OWNED** marks a value that has no source record. **BOUNDED_ARRAY** marks a list with a cap the input enforces. The table is generated from `functions/scripts/duplication-allowlist.json` by `node scripts/check-schema-duplicates.js --write` and checked for drift by `npm run test:static`. Do not edit it by hand.

<!-- DUPLICATION-REGISTER:START (generated by scripts/check-schema-duplicates.js --write; do not edit) -->

| ID | Kind | Collection | Field | Reason | Single writer | Reconcile / cap |
|---|---|---|---|---|---|---|
| DUP-085 | BOUNDED_ARRAY | `accountReconciliations` | `reconciledTransactionIds` | Array of reconciled ledger transaction IDs bounded per statement period. | — | cap 500 |
| DUP-083 | R4 | `accountTransactions` | `balanceAfter` | Running account balance snapshot at the exact time of the transaction for point-in-time statements and audit. | — | — |
| DUP-101 | BOUNDED_ARRAY | `accountTransactions` | `reviewReasons` | Flagged review reasons array on ledger transactions bounded by prepareEntriesInTxn. | `prepareEntriesInTxn` | cap 10 |
| DUP-104 | BOUNDED_ARRAY | `accountTransactions` | `workflow.approvedBy` | Audit list of approval actors and timestamps for multi-level approval, bounded to at most 10 approvers. | `updateEntryWorkflowInTxn` | cap 10 |
| DUP-102 | BOUNDED_ARRAY | `accountTransactions` | `workflow.updatedByUids` | Audit trail of actor UIDs who updated the entry note, bounded to at most 20 actors. | `updateEntryWorkflowInTxn` | cap 20 |
| DUP-103 | BOUNDED_ARRAY | `accountTransactions` | `workflow.verifiedBy` | Audit list of verification actors and timestamps for maker-checker review, bounded to at most 10 verifiers. | `updateEntryWorkflowInTxn` | cap 10 |
| DUP-080 | BOUNDED_ARRAY | `activity` | `attachments` | Activity comment attachments array capped at 5 in RequestAttachmentSchema. | — | cap 5 |
| DUP-079 | OWNED | `activity` | `author.roleLabel` | Snapshot of author role label at activity creation time for timeline rendering without role hydration. | — | — |
| DUP-020 | R3 | `auditLogs` | `changedFields` | Top-level field names of the event's changes, stored for array-contains queries. Bounded by the entity's field count; written only by the audit recorder. | `recordCommitEvent` | reconcile:auditChangedFields |
| DUP-028 | R3 | `bills` | `balanceAmount` | totalAmount − paidAmount, stored so statements and receivables can query open documents. | `paymentsCreate` | reconcile:documentPayments |
| DUP-017 | R2 | `bills` | `billToSnapshot` | GST Rule 46 (CGST Rules 2017): a tax invoice must show the recipient's name, address and GSTIN as at issue. Frozen only on finalized invoices of a registered customer; for walk-in sales it is the typed counter data (no customer record exists). | `billToFromCustomer` | — |
| DUP-002 | R2 | `bills` | `discountTotal` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-055 | BOUNDED_ARRAY | `bills` | `items` | Owned list capped at 200 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 200 |
| DUP-011 | R2 | `bills` | `items.baseQuantity` | quantity × the conversionFactor frozen at sale time; the product's unit factors may change later. | — | — |
| DUP-010 | R2 | `bills` | `items.lineTotal` | Line net amount after discount and tax as issued; the refund ceiling for returns reads it by reference. | — | — |
| DUP-034 | R3 | `bills` | `items.returnedQty` | SUM(return items for this line) so concurrent returns cannot exceed the sold quantity (checked in the return transaction). | `returnsCreate` | reconcile:returnedQty |
| DUP-009 | R2 | `bills` | `items.subtotal` | Line amount at the frozen price snapshot (price × quantity at sale time). | — | — |
| DUP-027 | R3 | `bills` | `paidAmount` | Settled amount = SUM(non-void payments referencing the document); kept for open-balance queries and overpayment checks. | `paymentsCreate` | reconcile:documentPayments |
| DUP-029 | R3 | `bills` | `paymentStatus` | Derived from paidAmount vs totalAmount; stored for list filters (paid / partial / pending). | `paymentStatusFor` | reconcile:documentPayments |
| DUP-090 | BOUNDED_ARRAY | `bills` | `splitPayments` | Split payment tenders array on bills capped at 5 in CreateBillSchema. | — | cap 5 |
| DUP-001 | R2 | `bills` | `subTotal` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-099 | BOUNDED_ARRAY | `bills` | `taxSnapshot.breakdown` | Tax snapshot breakdown line items array computed deterministically by taxCalculation engine. | — | cap 20 |
| DUP-003 | R2 | `bills` | `taxTotal` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-004 | R2 | `bills` | `totalAmount` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-064 | BOUNDED_ARRAY | `customers` | `additionalPhones` | Structured additional phone numbers list capped at 5 by Zod input, keeping the document far below the 1 MiB limit. | — | cap 5 |
| DUP-068 | BOUNDED_ARRAY | `customers` | `addresses` | Customer delivery/billing addresses array capped at 20 by AddressArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-070 | BOUNDED_ARRAY | `customers` | `bankAccounts` | Customer bank accounts array capped at 10 by BankAccountArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 10 |
| DUP-072 | BOUNDED_ARRAY | `customers` | `contacts` | Structured contact persons list capped at 20 by ContactPersonArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-023 | R3 | `customers` | `outstandingBalance` | Party ledger balance used for credit-limit checks and statements; equals the open documents minus payments/returns. | `reconcilePartyBalances` | reconcile:partyBalances |
| DUP-050 | BOUNDED_ARRAY | `customers` | `sharedForBranchIds` | Owned list capped at 100 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 100 |
| DUP-024 | R3 | `customers` | `totalSpend` | Party ledger balance used for credit-limit checks and statements; equals the open documents minus payments/returns. | `reconcilePartyBalances` | reconcile:partyBalances |
| DUP-060 | BOUNDED_ARRAY | `deliveries` | `lines` | Owned list capped at 200 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 200 |
| DUP-046 | BOUNDED_ARRAY | `departments` | `headMembershipIds` | Owned list capped at 20 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-092 | BOUNDED_ARRAY | `financialAccounts` | `assignedBranchIds` | Branch authorization allowlist for branch-scoped operational account transactions, capped at 100 in CreateFinancialAccountSchema. | — | cap 100 |
| DUP-093 | BOUNDED_ARRAY | `journalEntries` | `lines` | Double-entry journal line items bounded per balanced journal entry. | — | cap 20 |
| DUP-041 | BOUNDED_ARRAY | `memberships` | `jobRoleIds` | Owned list capped at 20 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-042 | BOUNDED_ARRAY | `memberships` | `reportingToIds` | Owned list capped at 10 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 10 |
| DUP-019 | R3 | `organizations` | `activeEmployeeCount` | Transactional seat counter so concurrent employee creation cannot exceed the plan (a count query cannot be locked). | `assertSeatAvailable` | reconcile:activeEmployeeCount |
| DUP-066 | BOUNDED_ARRAY | `organizations` | `addresses` | Structured addresses array capped at 20 by AddressArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-067 | BOUNDED_ARRAY | `organizations` | `bankAccounts` | Settlement bank accounts array capped at 10 by BankAccountArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 10 |
| DUP-018 | R3 | `organizations` | `branchCount` | Plan branchLimit check inside the branch-create transaction (counting branches there would need a collection read per create). | `branchesCreate` | reconcile:branchCount |
| DUP-063 | BOUNDED_ARRAY | `organizations` | `contacts` | Structured contact persons list capped at 20 by Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-043 | BOUNDED_ARRAY | `organizations` | `salesChannels` | Owned list capped at 4 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 4 |
| DUP-059 | BOUNDED_ARRAY | `organizations` | `settings.businessConfig.defaultUnits` | Owned list of default unit codes capped at 20 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-052 | BOUNDED_ARRAY | `outflows` | `attachmentPaths` | Owned list capped at 10 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 10 |
| DUP-031 | R3 | `outflows` | `balanceAmount` | totalAmount − paidAmount, stored so statements and receivables can query open documents. | `paymentsCreate` | reconcile:documentPayments |
| DUP-006 | R2 | `outflows` | `discountTotal` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-053 | BOUNDED_ARRAY | `outflows` | `lines` | Owned list capped at 200 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 200 |
| DUP-014 | R2 | `outflows` | `lines.baseQuantity` | Good units received in the base unit with the conversionFactor frozen at receipt. | — | — |
| DUP-012 | R2 | `outflows` | `lines.grossAmount` | Line amount at the vendor's invoiced price. | — | — |
| DUP-039 | OWNED | `outflows` | `lines.itemName` | Only on non-catalog lines (no productId): an expense or unlisted item has no record to reference. OutflowLineSchema rejects itemName beside productId. | — | — |
| DUP-013 | R2 | `outflows` | `lines.lineTotal` | Line net amount after discount and tax as invoiced by the vendor. | — | — |
| DUP-035 | R3 | `outflows` | `lines.returnedQty` | SUM(purchase-return items for this line), same rule as bills. | `returnsCreate` | reconcile:returnedQty |
| DUP-030 | R3 | `outflows` | `paidAmount` | Settled amount = SUM(non-void payments referencing the document); kept for open-balance queries and overpayment checks. | `paymentsCreate` | reconcile:documentPayments |
| DUP-032 | R3 | `outflows` | `paymentStatus` | Derived from paidAmount vs totalAmount; stored for list filters (paid / partial / pending). | `paymentStatusFor` | reconcile:documentPayments |
| DUP-033 | R3 | `outflows` | `productIds` | Line productIds for array-contains queries (price history by product); capped by the line limit. | `outflowsCreate` | reconcile:outflowProductIds |
| DUP-091 | BOUNDED_ARRAY | `outflows` | `splitPayments` | Split payment tenders array on outflows capped at 5 in CreateOutflowSchema. | — | cap 5 |
| DUP-005 | R2 | `outflows` | `subTotal` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-100 | BOUNDED_ARRAY | `outflows` | `taxSnapshot.breakdown` | Tax snapshot breakdown line items array computed deterministically by taxCalculation engine. | — | cap 20 |
| DUP-007 | R2 | `outflows` | `taxTotal` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-008 | R2 | `outflows` | `totalAmount` | Issued document total with the rounding, round-off and tax rates of the issue date; recomputing from current product data would change a legal document. | — | — |
| DUP-089 | R2 | `paymentProcessingFees` | `grossAmount` | Frozen snapshot of the source payment transaction gross amount at fee recording time. | — | — |
| DUP-088 | BOUNDED_ARRAY | `payments` | `allocations` | Payment document allocation breakdown array capped at 200 in CreatePaymentSchema. | — | cap 200 |
| DUP-040 | OWNED | `payments` | `partyName` | Only on a standalone payment with neither partyId nor referenceId (e.g. a one-off payee). paymentsCreate rejects it otherwise (REFERENCE_ATTRIBUTE_COPY). | — | — |
| DUP-047 | BOUNDED_ARRAY | `products` | `alternateUnits` | Owned list capped at 10 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 10 |
| DUP-021 | R3 | `products` | `currentStock` | Organization-wide stock shown on product lists = SUM(stockBalances.currentStock) for the product. | `commitStockChangesInTxn` | reconcile:productStock |
| DUP-048 | BOUNDED_ARRAY | `products` | `imagePaths` | Owned list capped at 8 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 8 |
| DUP-049 | BOUNDED_ARRAY | `products` | `sharedForBranchIds` | Owned list capped at 100 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 100 |
| DUP-022 | R3 | `products` | `weightedAverageCost` | Moving-average cost per base unit; path dependent, re-derived by replaying PURCHASE_IN movements in order. | `prepareStockChangesInTxn` | reconcile:productWac |
| DUP-075 | BOUNDED_ARRAY | `requests` | `attachments` | Request attachments array capped at 5 in RequestAttachmentSchema, keeping ticket document small. | — | cap 5 |
| DUP-076 | BOUNDED_ARRAY | `requests` | `labels` | Request categorization labels array capped at 10 in CreateRequestSchema. | — | cap 10 |
| DUP-074 | OWNED | `requests` | `requester.roleLabel` | Snapshot of requester role label at creation time for display in ticket header without role hydration. | — | — |
| DUP-057 | BOUNDED_ARRAY | `returns` | `items` | Owned list capped at 200 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 200 |
| DUP-015 | R2 | `returns` | `items.baseQuantity` | Returned quantity × the source line's frozen conversionFactor; the stock movement uses it. | — | — |
| DUP-061 | BOUNDED_ARRAY | `returns` | `requestedItems` | Pending return request lines bounded by the 200-item create limit, written only by returnsCreate. | `returnsCreate` | cap 200 |
| DUP-016 | R2 | `returns` | `totalRefundAmount` | Sum of the refunds as issued on the credit note / refund voucher. | — | — |
| DUP-045 | BOUNDED_ARRAY | `roles` | `permissions` | Owned list capped at 300 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 300 |
| DUP-062 | BOUNDED_ARRAY | `stockAdjustmentRequests` | `serialNumbers` | Owned list of serial numbers capped at 500 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 500 |
| DUP-037 | R3 | `stockBalances` | `allocatedStock` | SUM(base quantity of open sales orders) per (organization, branch, product); available = current − allocated is computed. | `commitReservationInTxn` | reconcile:allocatedStock |
| DUP-036 | R3 | `stockBalances` | `currentStock` | SUM(stockMovements.quantity) per (organization, branch, product); read on every sale for the negative-stock rule. For serial-tracked products it also equals the units in hand in serials/ (reconcile:serialStock). | `commitStockChangesInTxn` | reconcile:stockBalances |
| DUP-038 | R4 | `stockMovements` | `balanceAfter` | Running branch balance at the moment of the movement: an immutable audit fact of the stock ledger (the movement is the source of truth for itself). | — | — |
| DUP-084 | BOUNDED_ARRAY | `stockTransfers` | `items` | Inter-branch stock transfer line items array capped at 200 in CreateStockTransferSchema. | — | cap 200 |
| DUP-094 | R2 | `stockTransfers` | `items.baseQuantity` | Quantity multiplied by the frozen conversionFactor at transfer creation time; product unit conversion factors may change later. | — | — |
| DUP-095 | BOUNDED_ARRAY | `stockTransfers` | `items.serialNumbers` | Serial numbers tracked during inter-branch transfer, capped at 500 in schemas. | — | cap 500 |
| DUP-096 | BOUNDED_ARRAY | `taxRegimes` | `rates` | Tax rates array in canonical tax regime definition bounded per regime. | — | cap 20 |
| DUP-097 | BOUNDED_ARRAY | `taxRegimes` | `slabs` | Tax slabs array in canonical tax regime definition bounded per regime. | — | cap 20 |
| DUP-098 | BOUNDED_ARRAY | `taxRegimes` | `slabs.hsnPrefixes` | HSN code prefixes array bounded per tax slab definition. | — | cap 50 |
| DUP-065 | BOUNDED_ARRAY | `vendors` | `additionalPhones` | Structured additional phone numbers list capped at 5 by Zod input, keeping the document far below the 1 MiB limit. | — | cap 5 |
| DUP-069 | BOUNDED_ARRAY | `vendors` | `addresses` | Vendor pickup/office addresses array capped at 20 by AddressArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-071 | BOUNDED_ARRAY | `vendors` | `bankAccounts` | Vendor settlement bank accounts array capped at 10 by BankAccountArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 10 |
| DUP-073 | BOUNDED_ARRAY | `vendors` | `contacts` | Structured contact persons list capped at 20 by ContactPersonArraySchema in Zod input, keeping the document far below the 1 MiB limit. | — | cap 20 |
| DUP-025 | R3 | `vendors` | `outstandingPayable` | Party ledger balance used for credit-limit checks and statements; equals the open documents minus payments/returns. | `reconcilePartyBalances` | reconcile:partyBalances |
| DUP-051 | BOUNDED_ARRAY | `vendors` | `sharedForBranchIds` | Owned list capped at 100 by the Zod input, keeping the document far below the 1 MiB limit. | — | cap 100 |
| DUP-026 | R3 | `vendors` | `totalPurchase` | Party ledger balance used for credit-limit checks and statements; equals the open documents minus payments/returns. | `reconcilePartyBalances` | reconcile:partyBalances |

<!-- DUPLICATION-REGISTER:END -->
