# Trado Firebase Backend — Schema & Source-of-Truth Audit

> **Audit Date**: October 29, 2026  
> **Target Environment**: Cloud Firestore / Node.js 22 TypeScript Backend  
> **Collections Audited**: 42 Concrete Collections & Subcollections  
> **Total Persisted Fields**: 480 Fields Classified

---

## 1. Executive Summary & Source-of-Truth Architectural Rules

In Trado's backend architecture, data integrity is governed by explicit classification of every persisted field. To prevent stale caches, phantom reads, and denormalization anomalies, the system adheres to strict source-of-truth principles:

1. **Foreign References Are Stored by ID Only**: Cross-collection references store bare ID strings (`customerId`, `billId`, `vendorId`, `assignedToMembershipId`). Embedded parent documents are prohibited.
2. **Justified Snapshots**: When a financial or legal transaction requires an immutable point-in-time record (e.g. customer name/tax ID at the time an invoice was issued, or product price when a bill was generated), a minimal snapshot is captured in a designated field ending in `...Snapshot`.
3. **Physical Stock Is Branch-Scoped**: Physical stock is maintained strictly in `stockBalances/{orgId}_{branchId}_{productId}` with an immutable audit trail in `stockMovements`. The field `products.currentStock` is an intentional organization-level aggregate mirror audited by `reconcileStockBalances`.
4. **Subscription Entitlements vs. Tenant Caches**: The subscription tier definition in `subscriptionPlans` is authoritative. Tenant-level limits on `organizations` are cached operational snapshots audited by `reconcileBranchCounts`.

---

## 2. Analysis of Apparent Duplication Conflicts & Resolutions

| Candidate Conflict | Candidate Fields / Collections | Architectural Source of Truth | Operational Disposition & Justification |
|---|---|---|---|
| **User Claims vs. Firestore Profile** | `users.isSuperAdmin`, `users.primaryOrganizationId` vs. Token Claims | Live Firestore Profile & Memberships | **Claims are session routing hints; Firestore is authoritative.** `resolveRequestContext` verifies token claims against live Firestore documents before granting access, preventing privileges from surviving revocation. |
| **FCM Device Registration** | `users.fcmTokens` vs. `users/{uid}/devices/{deviceId}` | `users/{uid}/devices/{deviceId}` | **Subcollection is authoritative.** The dedicated subcollection captures device model, platform, appVersion, and lastSeenAt. `users.fcmTokens` is an optional read cache retained for backward compatibility. |
| **Branch Staff Assignments** | `memberships.assignedBranchIds` vs. `membershipBranches` | `membershipBranches/{membershipId_branchId}` | **`membershipBranches` is the normalized relational table.** It supports indexed queries (e.g., list all active staff at branch X). `assignedBranchIds` on `MembershipDoc` is an intentional denormalized array cache allowing `authMe` to resolve user branch access without an extra collection scan. |
| **Current Operating Branch Context** | `primaryBranchId` on Claims vs. Membership | Auth Custom Claim `primaryBranchId` | **Token claim holds runtime session pointer.** Memberships store all allowed branches (`assignedBranchIds`). When switching context via `branchContextSwitch`, the backend validates that the requested branch is in `assignedBranchIds` before updating the token claim. |
| **Branch Limit & Capacity** | `plans.branchLimit` vs. `organizations.branchLimit` / `organizations.branchCount` | `subscriptionPlans/{planId}.branchLimit` | **Plan is authoritative contract.** `org.branchLimit` is an inherited snapshot; `org.branchCount` is an operational counter of active branches. Both are verified during `branchesCreate` and audited by `reconcileBranchCounts`. |
| **Inventory Stock Balances** | `products.currentStock` vs. `stockBalances` & `stockMovements` | `stockBalances` (State) + `stockMovements` (Ledger) | **`stockBalances` is authoritative for physical stock.** `products.currentStock` is an aggregate mirror (sum of all branch stock) used for rapid catalog browsing. The tool `reconcileStockBalances` verifies that branch balances equal the movement ledger sum and match `currentStock`. |
| **Party Balances vs. Ledgers** | `customers.outstandingBalance` vs. `customerLedgers` | `customerLedgers` | **Ledger is authoritative double-entry record.** Customer document stores running balance for instantaneous checkout validation against credit limit. Audited by `reconcilePartyLedgers`. |
| **Document Balance vs. Payment Ledger** | `bills.paidAmount` / `balanceAmount` vs. `payments` | `payments` collection | **Payments ledger is authoritative financial record.** Bill and outflow balance fields are transactional mirrors updated atomically during payment recording to allow fast status queries. |
| **Reporting Aggregates vs. Source Documents** | `dailySummaries` vs. `bills`, `outflows`, `payments` | `bills`, `outflows`, `payments` | **Transactions are authoritative source.** `dailySummaries` are pre-aggregated daily buckets for fast high-level dashboard queries. When branch filtering is requested, `reportsGetRevenue` falls back directly to source transactions. |
| **Predefined Roles vs. Custom Roles** | System Roles (`role_owner`, `role_admin`) vs. `roles/{roleId}` | `roles` collection | **`roles` collection holds all roles.** Predefined roles have `isSystem: true` and `isPredefined: true` to prevent modification or deletion by tenant administrators. |
| **Transaction Snapshots** | `customerSnapshot`, `vendorSnapshot`, `taxSnapshot` | Transaction Document Field | **Legally justified immutable snapshots.** Captured at the moment of invoice issuance to preserve customer GSTIN, address, and legal tax rates even if the customer profile is subsequently updated. |
| **Role Permissions vs. Membership Overrides** | `roles.capabilities` vs. `memberships.permissions` | Four-Layer Resolver (`permissionResolver.ts`) | **Separate policy layers, not duplicate data.** Role capabilities define base role entitlements. Membership overrides allow tenant owners to grant or strictly deny specific capabilities to an individual staff member. Strict deny precedence applies. |

---

## 3. Comprehensive Collection & Field Classification Matrix

### 3.1 Identity, Users & Devices
- **`users/{userId}`**:
  - `id`: identity (Firebase Auth UID)
  - `phoneNumber`, `email`, `fullName`, `displayName`: owned profile attributes
  - `avatarUrl`: owned storage path
  - `isActive`: owned state
  - `isSuperAdmin`: system role flag (Super Admin platform bypass)
  - `primaryOrganizationId`: reference-by-ID (default tenant context)
  - `createdAt`, `updatedAt`, `lastLoginAt`: system-audit metadata
  - `fcmTokens`: reference-by-ID (legacy/backward-compatible cache)
- **`users/{userId}/devices/{deviceId}`**:
  - `id`: identity (device installation UUID)
  - `fcmToken`: owned delivery token
  - `platform`: owned enum (`android`, `ios`, `web`)
  - `deviceModel`, `appVersion`: owned telemetry
  - `createdAt`, `lastSeenAt`: system-audit metadata
  - `isActive`: owned state

### 3.2 Organizations & Multi-Branch Hierarchy
- **`organizations/{orgId}`**:
  - `id`: identity (auto-generated)
  - `name`, `legalName`, `taxIdentifier`, `currency`, `timezone`, `address`: owned tenant profile
  - `planId`: reference-by-ID (`subscriptionPlans/{planId}`)
  - `planStatus`: owned enum (`active`, `past_due`, `cancelled`)
  - `branchLimit`: derived/cached plan limit snapshot
  - `branchCount`: derived operational active branch counter
  - `defaultBranchId`: reference-by-ID (`main-branch`)
  - `sharingPolicies`: owned tenant configuration map
  - `modules`, `moduleOverrides`: owned module activation map
  - `isActive`: owned state
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata
- **`organizations/{orgId}/branches/{branchId}`**:
  - `id`: identity (`main-branch` or auto-generated)
  - `organizationId`: reference-by-ID
  - `branchCode`: stable-code (e.g. `MAIN`, `KCH-01`)
  - `name`, `phone`, `email`, `address`: owned branch attributes
  - `isDefault`: owned boolean flag
  - `isActive`: owned state
  - `sharingPolicies`, `moduleOverrides`: owned branch-level override maps
  - `createdAt`, `updatedAt`, `createdBy`, `deactivatedAt`, `reactivatedAt`: system-audit metadata
- **`branchCodeLocks/{orgId_code}`**:
  - `id`: identity composite key (`${orgId}_${branchCode}`)
  - `organizationId`, `branchId`: reference-by-ID
  - `branchCode`: stable-code
  - `createdAt`: system-audit metadata

### 3.3 Staff, Memberships & Permissions
- **`memberships/{membershipId}`**:
  - `id`: identity composite key (`${userId}_${organizationId}`)
  - `organizationId`, `userId`, `roleId`: reference-by-ID
  - `departmentId`, `jobRoleId`, `teamId`: reference-by-ID (optional organizational tags)
  - `status`: owned enum (`active`, `inactive`, `suspended`)
  - `isActive`: owned boolean mirror
  - `assignedBranchIds`: reference-by-ID array (denormalized fast read cache)
  - `locationTrackingEnabled`: owned consent flag
  - `permissions`: owned capability override map (`code: boolean`)
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata
- **`membershipBranches/{membershipId_branchId}`**:
  - `id`: identity composite key (`${membershipId}_${branchId}`)
  - `membershipId`, `branchId`, `organizationId`, `userId`: reference-by-ID
  - `status`: owned enum (`active`, `inactive`)
  - `assignedAt`, `assignedBy`: system-audit metadata
- **`roles/{roleId}`**:
  - `id`: identity
  - `organizationId`: reference-by-ID (empty/system for predefined roles)
  - `roleKey`: stable-code (`role_owner`, `role_admin`, `role_employee`, or custom)
  - `name`, `description`: owned attributes
  - `isPredefined`, `isSystem`: owned system guard flags
  - `capabilities`: owned string array of permission codes
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata

### 3.4 Catalog & Inventory
- **`products/{productId}`**:
  - `id`: identity
  - `organizationId`, `categoryId`, `brandId`, `taxRateId`: reference-by-ID
  - `productCode`, `barcode`: stable-code
  - `name`, `nameKey`, `description`, `baseUnit`: owned catalog attributes
  - `sellingPrice`, `costPrice`: owned monetary fields
  - `weightedAvgCost`: owned 4-decimal precision valuation
  - `currentStock`: derived organization-wide aggregate mirror
  - `reorderLevel`, `trackStock`, `hasExpiry`, `isActive`: owned inventory flags
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata
- **`barcodeLocks/{orgId_barcode}`**:
  - `id`: identity composite key (`${orgId}_${barcode}`)
  - `organizationId`, `productId`: reference-by-ID
  - `barcode`: stable-code
  - `createdAt`: system-audit metadata
- **`stockBalances/{orgId_branchId_productId}`**:
  - `id`: identity composite key (`${orgId}_${branchId}_${productId}`)
  - `organizationId`, `branchId`, `productId`: reference-by-ID
  - `currentStock`: derived authoritative branch physical stock
  - `reservedStock`, `availableStock`: derived allocations
  - `lastMovementId`: reference-by-ID
  - `updatedAt`: system-audit metadata
- **`stockMovements/{movementId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `productId`, `referenceId`: reference-by-ID
  - `movementType`: stable-code (`purchase_in`, `sale_out`, `sale_return_in`, `adjustment_in`, `adjustment_out`, `waste_out`, `damage_out`)
  - `quantity`: owned numeric delta
  - `balanceBefore`, `balanceAfter`: derived ledger balances
  - `notes`: owned string
  - `createdAt`, `createdBy`: system-audit metadata

### 3.5 Parties & Ledgers
- **`customers/{customerId}`**:
  - `id`: identity
  - `organizationId`, `branchId`: reference-by-ID (originating branch)
  - `customerCode`: stable-code
  - `name`, `phone`, `email`, `address`, `taxIdentifier`: owned attributes
  - `creditLimit`: owned monetary limit
  - `outstandingBalance`: derived customer balance mirror
  - `visibilityScope`: owned enum (`all_branches`, `selected_branches`, `branch_only`)
  - `sharedForBranchIds`: reference-by-ID array of active branch IDs
  - `isActive`: owned state
  - `createdAt`, `createdBy`: system-audit metadata
- **`customerLedgers/{ledgerId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `customerId`, `referenceId`: reference-by-ID
  - `entryType`: stable-code (`invoice_debit`, `payment_credit`, `return_credit`)
  - `amount`, `balanceBefore`, `balanceAfter`: derived ledger balances
  - `createdAt`, `createdBy`: system-audit metadata
- **`vendors/{vendorId}`**:
  - `id`: identity
  - `organizationId`, `branchId`: reference-by-ID
  - `vendorCode`: stable-code
  - `name`, `phone`, `email`, `address`, `taxIdentifier`: owned attributes
  - `outstandingPayable`: derived vendor payable mirror
  - `visibilityScope`, `sharedForBranchIds`: owned sharing configuration
  - `isActive`: owned state
  - `createdAt`, `createdBy`: system-audit metadata
- **`vendorLedgers/{ledgerId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `vendorId`, `referenceId`: reference-by-ID
  - `entryType`: stable-code (`purchase_payable`, `disbursement_credit`)
  - `amount`, `balanceBefore`, `balanceAfter`: derived ledger balances
  - `createdAt`, `createdBy`: system-audit metadata

### 3.6 Operational Transactions
- **`bills/{billId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `customerId`, `salespersonMembershipId`: reference-by-ID
  - `billNumber`: stable-code (`POS-YYYY-XXXXXX`, `INV-YYYY-XXXXXX`, `QTN-YYYY-XXXXXX`)
  - `salesMode`: owned enum (`pos`, `b2b`)
  - `documentType`: owned enum (`invoice`, `quotation`, `proforma`)
  - `customerSnapshot`: justified snapshot (name, phone, address, taxId at sale time)
  - `taxSnapshot`: justified snapshot (tax regime, breakdown rates)
  - `items`: owned array of line items with `productSnapshot` (code, name, unit)
  - `subTotal`, `discountTotal`, `taxTotal`, `roundOff`, `totalAmount`: owned monetary fields
  - `paidAmount`, `balanceAmount`: derived payment mirrors
  - `paymentStatus`: owned enum (`unpaid`, `partial`, `paid`)
  - `status`: owned enum (`draft`, `active`, `cancelled`)
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata
- **`outflows/{outflowId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `vendorId`: reference-by-ID
  - `outflowNumber`: stable-code (`PUR-YYYY-XXXXXX`, `EXP-YYYY-XXXXXX`)
  - `kind`: owned enum (`purchase`, `expense`)
  - `vendorSnapshot`: justified snapshot
  - `items`: owned array of line items
  - `totalAmount`, `paidAmount`, `balanceAmount`, `paymentStatus`, `status`: owned financial fields
  - `docDate`: owned date string
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata
- **`payments/{paymentId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `partyId`, `referenceId`: reference-by-ID
  - `paymentNumber`: stable-code (`PAY-YYYY-XXXXXX`)
  - `paymentType`: owned enum (`received_customer`, `disbursed_vendor`)
  - `paymentMethod`: owned enum (`cash`, `upi`, `card`, `bank_transfer`, `credit_note`)
  - `amount`: owned monetary value
  - `status`: owned enum (`success`, `failed`, `cancelled`)
  - `createdAt`, `createdBy`: system-audit metadata
- **`deliveries/{deliveryId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `billId`, `riderMembershipId`: reference-by-ID
  - `deliveryNumber`: stable-code (`DEL-YYYY-XXXXXX`)
  - `recipientName`, `recipientPhone`, `deliveryAddress`: owned attributes
  - `status`: owned enum (`pending`, `dispatched`, `delivered`, `failed`)
  - `trackingUrl`: owned string
  - `createdAt`, `updatedAt`, `createdBy`: system-audit metadata
- **`returns/{returnId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `referenceId`, `partyId`: reference-by-ID
  - `returnNumber`: stable-code (`RET-YYYY-XXXXXX`)
  - `returnType`: owned enum (`sale_return`, `purchase_return`)
  - `items`: owned array of returned items
  - `subTotal`, `taxTotal`, `refundAmount`: owned monetary fields
  - `status`, `reason`: owned attributes
  - `createdAt`, `createdBy`: system-audit metadata

### 3.7 Tasks, Live Location & Notifications
- **`tasks/{taskId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `assignedToMembershipId`, `relatedEntityId`, `billId`: reference-by-ID
  - `title`, `description`, `priority`, `status`, `dueDate`, `completedAt`: owned task attributes
  - `createdAt`, `createdBy`: system-audit metadata
- **`locations/{locationId}`**:
  - `id`: identity
  - `organizationId`, `branchId`, `membershipId`, `userId`: reference-by-ID
  - `latitude`, `longitude`, `accuracy`, `heading`, `speed`: owned telemetry
  - `recordedAt`: system-audit metadata
- **`activeLocations/{membershipId}`**:
  - `id`: identity composite key (staff `membershipId`)
  - `organizationId`, `branchId`, `membershipId`, `userId`: reference-by-ID
  - `latitude`, `longitude`, `accuracy`, `heading`, `speed`: owned telemetry
  - `updatedAt`: system-audit metadata
- **`notifications/{notificationId}`**:
  - `id`: identity
  - `organizationId`, `recipientMembershipId`, `recipientUserId`, `relatedEntityId`: reference-by-ID
  - `type`: stable-code (`task_assigned`, `bill_created`, `outflow_recorded`, `payment_received`, `delivery_assigned`, `stock_alert`)
  - `title`, `body`: owned display strings
  - `data`: owned metadata payload
  - `isRead`, `readAt`: owned read status
  - `createdAt`: system-audit metadata

### 3.8 Platform Configuration & Usage Metering
- **`dailySummaries/{orgId_date}`**:
  - `id`: identity composite key (`${orgId}_${date}`)
  - `organizationId`: reference-by-ID
  - `date`: stable-code (`YYYY-MM-DD`)
  - `totalRevenue`, `totalExpenses`, `cogs`, `grossProfit`, `netProfit`, `billCount`: derived daily aggregates
  - `updatedAt`: system-audit metadata
- **`organizationUsageDaily/{orgId_date}`**:
  - `id`: identity composite key (`${orgId}_${date}`)
  - `organizationId`: reference-by-ID
  - `date`: stable-code
  - `activeUsers`, `activeBranches`, `firestoreReads`, `firestoreWrites`, `functionsInvocations`, `storageBytes`: derived usage metrics
- **`branchUsageDaily/{orgId_branchId_date}`**:
  - `id`: identity composite key (`${orgId}_${branchId}_${date}`)
  - `organizationId`, `branchId`: reference-by-ID
  - `date`: stable-code
  - `activeStaff`, `firestoreReads`, `firestoreWrites`, `transactionsProcessed`: derived usage metrics
- **`platformUsageSnapshots/{date}`**:
  - `id`: identity (`YYYY-MM-DD`)
  - `totalOrganizations`, `totalActiveBranches`, `totalUsers`, `totalFirestoreOps`, `totalFunctionsInvocations`: derived platform aggregates
- **`usageRateCards/{rateCardId}`**:
  - `id`: identity (`ratecard_v1`)
  - `version`: stable-code
  - `name`, `effectiveFrom`: owned metadata
  - `firestoreRates`, `functionRates`, `storageRates`: owned pricing configuration
  - `isActive`: owned boolean
- **`usageAllocationRuns/{runId}`**:
  - `id`: identity
  - `period`: stable-code (`YYYY-MM`)
  - `calculatedAt`, `rateCardVersion`, `totalPlatformCost`, `isDryRun`, `recordsEvaluated`, `runBy`: system-audit metadata
- **`plans/{planId}`**:
  - `id`: identity (`plan_standard`, `plan_pro`, `plan_enterprise`)
  - `planKey`: stable-code
  - `name`, `description`: owned attributes
  - `branchLimit`, `userLimit`: owned capacity entitlements
  - `modules`, `features`: owned feature flags
  - `priceMonthly`, `currency`: owned pricing
  - `isActive`: owned state
- **`modules/{moduleId}`**:
  - `id`: identity (`billing`, `inventory`, `purchases`, `reports`, `staff`, etc.)
  - `moduleKey`: stable-code
  - `name`, `description`: owned attributes
  - `dependencies`: owned string array of module keys
  - `isCore`, `isActive`: owned flags
- **`taxRegimes/{regimeId}`**:
  - `id`: identity (`regime_in_gst`, `regime_ae_vat`, `regime_us_sales`)
  - `regimeKey`: stable-code
  - `countryCode`, `name`, `defaultRates`, `splitComponents`: owned tax configuration
  - `isActive`: owned state
- **`documentCounters/{orgId_type_year}`**:
  - `id`: identity composite key (`${orgId}_${type}_${year}`)
  - `organizationId`: reference-by-ID
  - `type`, `year`: stable-code
  - `lastSequence`: derived atomic sequence counter
  - `updatedAt`: system-audit metadata
- **`idempotencyRecords/{idempotencyKey}`**:
  - `id`: identity (UUID/hash supplied by caller)
  - `organizationId`: reference-by-ID
  - `status`: owned enum (`PROCESSING`, `COMPLETED`, `FAILED`)
  - `cachedResult`: owned cached response payload
  - `error`: owned failure description
  - `lockedAt`, `expiresAt`: system-audit metadata (24-hour TTL)
- **`auditLogs/{logId}`**:
  - `id`: identity
  - `organizationId`, `userId`: reference-by-ID
  - `action`, `entityType`, `entityId`: stable-code
  - `metadata`: owned lean audit payload (no secrets or full dumps)
  - `clientIp`, `userAgent`, `timestamp`: system-audit metadata

