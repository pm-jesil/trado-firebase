# Prompt-62 Reference Catalog (§4) Diff Ledger (Y-8)

> **Generated**: 2026-11-12T21:10:05.686Z  
> **Reference Total**: 148 fields across 14 entities  
> **Summary**: **85 PRESENT**, **3 DEFERRED**, **12 REMOVED**  

| Entity | Field Path | Status | Verdict / Decision Reason |
|---|---|:---:|---|
| `organization` | `name` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `legalName` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `businessType` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `businessCategory` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `country` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `currency` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `taxRegimeCode` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `taxId` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `pan` | 🟡 DEFERRED | Country-specific PAN handled under taxId / statutory identifiers (DEF-01). |
| `organization` | `registrationNumber` | 🟡 DEFERRED | Corporate registration (CIN/CR/UEN) deferred to enterprise compliance suite (DEF-02). |
| `organization` | `website` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `email` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `organization` | `phone` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `organization` | `contactPerson` | 🟡 DEFERRED | Consolidated into contacts: OrganizationContact[] directory (DEF-03). |
| `organization` | `contacts` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `addresses` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `bankAccounts` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `logo` | 🔴 REMOVED | D-15: Stored field name is 'image' of type ImageRef (no URL inside). |
| `organization` | `status` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `ownerStatus` | 🟢 PRESENT | Active in models and verified by tests. |
| `organization` | `planId` | 🟢 PRESENT | Active in models and verified by tests. |
| `branch` | `name` | 🟢 PRESENT | Active in models and verified by tests. |
| `branch` | `code` | 🟢 PRESENT | Active in models and verified by tests. |
| `branch` | `type` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `branch` | `address` | 🟢 PRESENT | Active in models and verified by tests. |
| `branch` | `phone` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `branch` | `email` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `branch` | `managerId` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `branch` | `taxId` | 🟢 PRESENT | Active in models and verified by tests. |
| `branch` | `isMain` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `branch` | `status` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `uid` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `email` | 🟢 PRESENT | Active in models and verified by tests. |
| `user` | `phone` | 🟢 PRESENT | Active in models and verified by tests. |
| `user` | `displayName` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `photoUrl` | 🔴 REMOVED | D-15: URLs are never stored. Computed display URL imageUrl used at read time. |
| `user` | `avatarUrl` | 🔴 REMOVED | D-15: Duplicate avatarUrl removed. Stored field is image: ImageRef. |
| `user` | `role` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `jobTitle` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `department` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `branchId` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `status` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `permissions` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `user` | `joinedAt` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `customer` | `name` | 🟢 PRESENT | Active in models and verified by tests. |
| `customer` | `phone` | 🟢 PRESENT | Active in models and verified by tests. |
| `customer` | `whatsApp` | 🔴 REMOVED | D-7: Canonical field naming registry enforces single 'phone' field. Duplicate channel alias eliminated. |
| `customer` | `email` | 🟢 PRESENT | Active in models and verified by tests. |
| `customer` | `taxNumber` | 🔴 REMOVED | D-7: Canonical naming registry enforces 'taxId'. Duplicate taxNumber alias eliminated. |
| `customer` | `taxId` | 🟢 PRESENT | Active in models and verified by tests. |
| `customer` | `billingAddress` | 🔴 REMOVED | D-7: Consolidated into typed 'addresses: Address[]' array. |
| `customer` | `shippingAddress` | 🔴 REMOVED | D-7: Consolidated into typed 'addresses: Address[]' array. |
| `customer` | `creditLimit` | 🟢 PRESENT | Active in models and verified by tests. |
| `customer` | `paymentTerms` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `customer` | `outstandingBalance` | 🟢 PRESENT | Active in models and verified by tests. |
| `customer` | `status` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `vendor` | `name` | 🟢 PRESENT | Active in models and verified by tests. |
| `vendor` | `phone` | 🟢 PRESENT | Active in models and verified by tests. |
| `vendor` | `whatsApp` | 🔴 REMOVED | D-7: Canonical field naming registry enforces single 'phone' field. Duplicate channel alias eliminated. |
| `vendor` | `email` | 🟢 PRESENT | Active in models and verified by tests. |
| `vendor` | `taxNumber` | 🔴 REMOVED | D-7: Canonical naming registry enforces 'taxId'. Duplicate taxNumber alias eliminated. |
| `vendor` | `taxId` | 🟢 PRESENT | Active in models and verified by tests. |
| `vendor` | `billingAddress` | 🔴 REMOVED | D-7: Consolidated into typed 'addresses: Address[]' array. |
| `vendor` | `shippingAddress` | 🔴 REMOVED | D-7: Consolidated into typed 'addresses: Address[]' array. |
| `vendor` | `creditLimit` | 🟢 PRESENT | Active in models and verified by tests. |
| `vendor` | `paymentTerms` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `vendor` | `outstandingPayable` | 🟢 PRESENT | Active in models and verified by tests. |
| `vendor` | `status` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `product` | `name` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `sku` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `barcode` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `sellingPrice` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `costPrice` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `mrp` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `wholesalePrice` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `baseUnit` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `categoryId` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `taxRatePercent` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `taxInclusive` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `trackStock` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `lowStockThreshold` | 🟢 PRESENT | Active in models and verified by tests. |
| `product` | `image` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `product` | `status` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `bill` | `billNumber` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `billDate` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `bill` | `customerId` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `customerSnapshot` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `bill` | `lines` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `bill` | `subTotal` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `discountAmount` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `bill` | `taxAmount` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `bill` | `totalAmount` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `paidAmount` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `balanceAmount` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `paymentStatus` | 🟢 PRESENT | Active in models and verified by tests. |
| `bill` | `status` | 🟢 PRESENT | Active in models and verified by tests. |
| `outflow` | `voucherNumber` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `outflow` | `kind` | 🟢 PRESENT | Active in models and verified by tests. |
| `outflow` | `category` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `outflow` | `partyId` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `outflow` | `partyType` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `outflow` | `partySnapshot` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `outflow` | `amount` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `outflow` | `paidAmount` | 🟢 PRESENT | Active in models and verified by tests. |
| `outflow` | `paymentStatus` | 🟢 PRESENT | Active in models and verified by tests. |
| `outflow` | `docDate` | 🟢 PRESENT | Active in models and verified by tests. |
| `outflow` | `status` | 🟢 PRESENT | Active in models and verified by tests. |
| `payment` | `receiptNumber` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `payment` | `direction` | 🟢 PRESENT | Active in models and verified by tests. |
| `payment` | `partyId` | 🟢 PRESENT | Active in models and verified by tests. |
| `payment` | `partyType` | 🟢 PRESENT | Active in models and verified by tests. |
| `payment` | `amount` | 🟢 PRESENT | Active in models and verified by tests. |
| `payment` | `paymentMode` | 🔴 REMOVED | D-7: Canonical enum is PaymentMethod. Duplicate mode alias eliminated. |
| `payment` | `paymentMethod` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `payment` | `referenceNumber` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `payment` | `allocations` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `payment` | `status` | 🟢 PRESENT | Active in models and verified by tests. |
| `return` | `returnNumber` | 🟢 PRESENT | Active in models and verified by tests. |
| `return` | `type` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `return` | `sourceBillId` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `return` | `partyId` | 🟢 PRESENT | Active in models and verified by tests. |
| `return` | `lines` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `return` | `refundAmount` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `return` | `disposition` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `return` | `status` | 🟢 PRESENT | Active in models and verified by tests. |
| `delivery` | `deliveryNumber` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `delivery` | `billId` | 🟢 PRESENT | Active in models and verified by tests. |
| `delivery` | `partner` | 🟢 PRESENT | Active in models and verified by tests. |
| `delivery` | `trackingNumber` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `delivery` | `destinationAddress` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `delivery` | `lines` | 🟢 PRESENT | Active in models and verified by tests. |
| `delivery` | `status` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockBalance` | `productId` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockBalance` | `branchId` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockBalance` | `currentStock` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockBalance` | `allocatedStock` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockMovement` | `productId` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockMovement` | `branchId` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockMovement` | `type` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockMovement` | `quantity` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockMovement` | `balanceAfter` | 🟢 PRESENT | Active in models and verified by tests. |
| `stockMovement` | `referenceId` | 🟢 PRESENT | Active in models and verified by tests. |
| `subscriptionPlan` | `name` | 🟢 PRESENT | Active in models and verified by tests. |
| `subscriptionPlan` | `code` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
| `subscriptionPlan` | `price` | 🟢 PRESENT | Active in models and verified by tests. |
| `subscriptionPlan` | `branchLimit` | 🟢 PRESENT | Active in models and verified by tests. |
| `subscriptionPlan` | `seatLimits` | 🟢 PRESENT | Active in models and verified by tests. |
| `subscriptionPlan` | `modules` | 🔴 REMOVED | Not in the current catalog and no deferral or contract-change record exists. |
