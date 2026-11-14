# Stored field catalog

Generated 2026-11-14T07:43:37.206Z by `scripts/generate-field-catalog.js` from `functions/src/types/models.ts` (TypeScript checker) and the raw field census (`census-mwg3ltga`). Do not edit.

48 collections, 1051 typed stored leaf paths, 920 with a description, 1 collections without a document interface.

## `auditLogs` (`AuditLogDoc`)

Typed leaf paths: 54. Documents observed in the census: 1514. Stored but untyped paths: 290.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `occurredAt` | `Timestamp` | yes | public | yes | server clock |
| `occurredLocalDate` | `string` | yes | public | yes | YYYY-MM-DD in the organization timezone |
| `organizationId` | `string` | yes | public | yes | the organization the event belongs to, or "platform" (D-21) |
| `targetOrgId` | `string | null | undefined` | no | public | yes | the organization platform work was done for |
| `actorUid` | `string | null` | no | public | yes | null for triggers and scheduled jobs |
| `actor.kind` | `"system" | "user" | "trigger" | "scheduled" | "superAdminOnBehalf"` | yes | public | yes | Kind of record (values: the field's enum). |
| `actor.role` | `string | null | undefined` | no | public | yes |  |
| `actor.membershipId` | `string | null | undefined` | no | public | yes | Id of a membership: one user in one organization (`<uid>_<organizationId>`). |
| `actor.branchId` | `string | null | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `source.callable` | `string | undefined` | no | public | yes |  |
| `source.trigger` | `string | undefined` | no | public | no |  |
| `source.scheduled` | `string | undefined` | no | public | no |  |
| `source.requestId` | `string` | yes | public | yes | Id of the approval request or client request this entry belongs to. |
| `source.clientRequestId` | `string | null | undefined` | no | public | yes |  |
| `source.eventId` | `string | null | undefined` | no | public | yes |  |
| `device.deviceId` | `string | null` | no | public | yes | Id of the user's device (one per installation). |
| `device.deviceRegistered` | `boolean | null` | no | public | yes |  |
| `device.platform` | `string | null` | no | public | yes |  |
| `device.appVersion` | `string | null` | no | public | yes |  |
| `device.ipTruncated` | `string | null` | no | public | yes |  |
| `device.userAgentFamily` | `string | null` | no | public | yes |  |
| `device.appCheckVerified` | `boolean | null` | no | public | yes |  |
| `action` | `string` | yes | public | yes | "<entity>.<verb>" from constants/auditRegistry.ts |
| `category` | `"admin" | "system" | "mutation" | "read_sensitive" | "export" | "auth" | "file" | "security"` | yes | public | yes |  |
| `outcome` | `"success" | "denied" | "failed"` | yes | public | yes |  |
| `reason` | `string | null` | no | public | yes | stable details.reason of a denial or failure |
| `attemptedAction` | `string | null | undefined` | no | public | yes | the action a denied request tried |
| `entityType` | `string | null` | no | public | yes | the primary target (query key) |
| `entityId` | `string | null` | no | public | yes | Id of the record the entry refers to. |
| `targets[].type` | `string` | yes | public | yes |  |
| `targets[].id` | `string` | yes | public | yes | Id of this item, unique within its list. |
| `targets[].path` | `string | null` | no | public | yes |  |
| `targets[].op` | `string | null` | no | public | yes |  |
| `changes.fields[].path` | `string` | yes | public | yes |  |
| `changes.fields[].op` | `string` | yes | public | yes | set | unset | inc | server_time | array |
| `changes.fields[].before` | `unknown` | no | public | yes | only when the request had already read the document (no extra read) |
| `changes.fields[].after` | `unknown` | no | public | yes |  |
| `changes.truncated` | `boolean` | yes | public | yes |  |
| `changes.redacted[]` | `string` | yes | public | yes |  |
| `changes.beforeAvailable` | `boolean` | yes | public | yes |  |
| `changedFields[]` | `string` | yes | public | yes | top-level fields in "changes", for array-contains queries (price history) |
| `details` | `Record<string, unknown>` | no | public | yes | reason fields of the request (registry inputFields), redacted |
| `ops.reads` | `number` | yes | public | yes |  |
| `ops.writes` | `number` | yes | public | yes |  |
| `ops.deletes` | `number` | yes | public | yes |  |
| `suppressedSincePrevious` | `number | undefined` | no | public | yes | rate-limited security events folded into this one |
| `operation` | `"create" | "update" | "delete" | "status_change" | undefined` | no | public | yes |  |
| `statusBefore` | `string | null | undefined` | no | public | yes |  |
| `statusAfter` | `string | null | undefined` | no | public | yes |  |
| `humanLabel` | `string | null | undefined` | no | public | yes |  |
| `amount` | `number | null | undefined` | no | public | yes | Amount in the currency's major unit. |
| `currency` | `string | null | undefined` | no | public | yes | ISO 4217 currency code. |
| `branchId` | `string | null | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `expireAt` | `Timestamp` | yes | public | yes | TTL (system setting AUDIT_RETENTION_MONTHS, default 24) |

Stored but untyped:

- `changes.fields[]`
- `changes.fields[].after.admin`
- `changes.fields[].after.allowNegativeStock`
- `changes.fields[].after.altPhone`
- `changes.fields[].after.analytics`
- `changes.fields[].after.approvals.amountThreshold`
- `changes.fields[].after.approvals.enabled`
- `changes.fields[].after.approvals.modules.expense`
- `changes.fields[].after.approvals.modules.purchase`
- `changes.fields[].after.approvals.modules.return`
- `changes.fields[].after.approvals.modules.sale`
- `changes.fields[].after.approvals.modules.stock_adjustment`
- `changes.fields[].after.area`
- `changes.fields[].after.audit:read_own`
- `changes.fields[].after.audit:view`
- `changes.fields[].after.bill:create`
- `changes.fields[].after.bill:discount`
- `changes.fields[].after.bill:update`
- `changes.fields[].after.bill:view`
- `changes.fields[].after.billing`
- `changes.fields[].after.billingAddress`
- `changes.fields[].after.businessConfig.defaultUnits[]`
- `changes.fields[].after.businessConfig.productFields.alternateUnits`
- `changes.fields[].after.businessConfig.productFields.batch`
- `changes.fields[].after.businessConfig.productFields.expiry`
- `changes.fields[].after.businessConfig.productFields.jewellery`
- `changes.fields[].after.businessConfig.productFields.serial`
- `changes.fields[].after.businessConfig.productFields.variants`
- `changes.fields[].after.businessConfig.salesMode`
- `changes.fields[].after.categories`
- `changes.fields[].after.city`
- `changes.fields[].after.colour`
- `changes.fields[].after.contactName`
- `changes.fields[].after.contactPerson`
- `changes.fields[].after.contentType`
- `changes.fields[].after.country`
- `changes.fields[].after.customer:view`
- `changes.fields[].after.customers`
- `changes.fields[].after.defaultSalesMode`
- `changes.fields[].after.deliveries`
- `changes.fields[].after.email`
- `changes.fields[].after.employee:view`
- `changes.fields[].after.expense:create`
- `changes.fields[].after.expense:view`
- `changes.fields[].after.expenses`
- `changes.fields[].after.externalReference`
- `changes.fields[].after.firestoreReads.dailyLimit`
- `changes.fields[].after.firestoreReads.enabled`
- `changes.fields[].after.firestoreReads.enforcementMode`
- `changes.fields[].after.firestoreReads.hardThresholdPercent`
- `changes.fields[].after.firestoreReads.monthlyLimit`
- `changes.fields[].after.firestoreReads.warningThresholdPercent`
- `changes.fields[].after.firestoreWrites.dailyLimit`
- `changes.fields[].after.firestoreWrites.enabled`
- `changes.fields[].after.firestoreWrites.enforcementMode`
- `changes.fields[].after.firestoreWrites.hardThresholdPercent`
- `changes.fields[].after.firestoreWrites.monthlyLimit`
- `changes.fields[].after.firestoreWrites.warningThresholdPercent`
- `changes.fields[].after.firestoreWrites.weeklyLimit`
- `changes.fields[].after.functionsInvocations.dailyLimit`
- `changes.fields[].after.functionsInvocations.enabled`
- `changes.fields[].after.functionsInvocations.enforcementMode`
- `changes.fields[].after.functionsInvocations.hardThresholdPercent`
- `changes.fields[].after.functionsInvocations.monthlyLimit`
- `changes.fields[].after.functionsInvocations.warningThresholdPercent`
- `changes.fields[].after.gatewayProvider`
- `changes.fields[].after.geoPoint.latitude`
- `changes.fields[].after.geoPoint.longitude`
- `changes.fields[].after.grossWeightGrams`
- `changes.fields[].after.hallmarkId`
- `changes.fields[].after.height`
- `changes.fields[].after.id`
- `changes.fields[].after.inventory`
- `changes.fields[].after.inventory:view`
- `changes.fields[].after.isDefaultBilling`
- `changes.fields[].after.isDefaultShipping`
- `changes.fields[].after.isRegistered`
- `changes.fields[].after.k1`
- `changes.fields[].after.k1.dailyLimit`
- `changes.fields[].after.k1.enabled`
- `changes.fields[].after.k1.enforcementMode`
- `changes.fields[].after.k1.hardThresholdPercent`
- `changes.fields[].after.k1.monthlyLimit`
- `changes.fields[].after.k1.warningThresholdPercent`
- `changes.fields[].after.k1.weeklyLimit`
- `changes.fields[].after.label`
- `changes.fields[].after.labels.invoiceTitle`
- `changes.fields[].after.labels.registrationLabel`
- `changes.fields[].after.labels.taxName`
- `changes.fields[].after.length`
- `changes.fields[].after.line1`
- `changes.fields[].after.line2`
- `changes.fields[].after.liveLocation`
- `changes.fields[].after.location:ping`
- `changes.fields[].after.location:view_own`
- `changes.fields[].after.locationPings.dailyLimit`
- `changes.fields[].after.locationPings.enabled`
- `changes.fields[].after.locationPings.enforcementMode`
- `changes.fields[].after.locationPings.hardThresholdPercent`
- `changes.fields[].after.locationPings.warningThresholdPercent`
- `changes.fields[].after.makingCharge`
- `changes.fields[].after.makingChargeType`
- `changes.fields[].after.moduleOverrides`
- `changes.fields[].after.moduleOverrides.k1`
- `changes.fields[].after.name`
- `changes.fields[].after.netWeightGrams`
- `changes.fields[].after.notification:view`
- `changes.fields[].after.org:view`
- `changes.fields[].after.outflow:create`
- `changes.fields[].after.path`
- `changes.fields[].after.payment:create`
- `changes.fields[].after.payments`
- `changes.fields[].after.phone`
- `changes.fields[].after.pincode`
- `changes.fields[].after.postalCode`
- `changes.fields[].after.priceByDailyRate`
- `changes.fields[].after.product:view`
- `changes.fields[].after.product:view_cost`
- `changes.fields[].after.products`
- `changes.fields[].after.purchase:create`
- `changes.fields[].after.purchase:view`
- `changes.fields[].after.purchases`
- `changes.fields[].after.purity`
- `changes.fields[].after.regime`
- `changes.fields[].after.report:view`
- `changes.fields[].after.return:create`
- `changes.fields[].after.return:view`
- `changes.fields[].after.returns`
- `changes.fields[].after.sale:create`
- `changes.fields[].after.sales`
- `changes.fields[].after.size`
- `changes.fields[].after.sizeBytes`
- `changes.fields[].after.staff`
- `changes.fields[].after.state`
- `changes.fields[].after.stock`
- `changes.fields[].after.stock:adjust`
- `changes.fields[].after.stock:view`
- `changes.fields[].after.storage`
- `changes.fields[].after.task:update`
- `changes.fields[].after.task:view`
- `changes.fields[].after.tasks`
- `changes.fields[].after.taxAmount`
- `changes.fields[].after.taxId`
- `changes.fields[].after.taxRatePercent`
- `changes.fields[].after.taxType`
- `changes.fields[].after.unit`
- `changes.fields[].after.updatedAt`
- `changes.fields[].after.value`
- `changes.fields[].after.vendors`
- `changes.fields[].after.width`
- `changes.fields[].after[]`
- `changes.fields[].after[].accountHolderName`
- `changes.fields[].after[].accountNumber`
- `changes.fields[].after[].addToStock`
- `changes.fields[].after[].area`
- `changes.fields[].after[].bankName`
- `changes.fields[].after[].barcode`
- `changes.fields[].after[].baseQuantity`
- `changes.fields[].after[].batch`
- `changes.fields[].after[].categoryId`
- `changes.fields[].after[].city`
- `changes.fields[].after[].contactName`
- `changes.fields[].after[].conversionFactor`
- `changes.fields[].after[].costSnapshot`
- `changes.fields[].after[].country`
- `changes.fields[].after[].createdAt`
- `changes.fields[].after[].createdBy`
- `changes.fields[].after[].currency`
- `changes.fields[].after[].damageReason`
- `changes.fields[].after[].damagedQuantity`
- `changes.fields[].after[].designation`
- `changes.fields[].after[].discountAmount`
- `changes.fields[].after[].discountValue`
- `changes.fields[].after[].disposition`
- `changes.fields[].after[].email`
- `changes.fields[].after[].expiryDate`
- `changes.fields[].after[].factor`
- `changes.fields[].after[].geoPoint.latitude`
- `changes.fields[].after[].geoPoint.longitude`
- `changes.fields[].after[].grossAmount`
- `changes.fields[].after[].id`
- `changes.fields[].after[].isActive`
- `changes.fields[].after[].isDefault`
- `changes.fields[].after[].isDefaultBilling`
- `changes.fields[].after[].isDefaultShipping`
- `changes.fields[].after[].isPrimary`
- `changes.fields[].after[].isPurchaseUnit`
- `changes.fields[].after[].isReturnable`
- `changes.fields[].after[].isSaleUnit`
- `changes.fields[].after[].itemName`
- `changes.fields[].after[].label`
- `changes.fields[].after[].line1`
- `changes.fields[].after[].line2`
- `changes.fields[].after[].lineId`
- `changes.fields[].after[].lineTotal`
- `changes.fields[].after[].name`
- `changes.fields[].after[].notifyBy`
- `changes.fields[].after[].phone`
- `changes.fields[].after[].postalCode`
- `changes.fields[].after[].priceSnapshot`
- `changes.fields[].after[].productId`
- `changes.fields[].after[].quantity`
- `changes.fields[].after[].reason`
- `changes.fields[].after[].refundAmount`
- `changes.fields[].after[].routingCode`
- `changes.fields[].after[].routingType`
- `changes.fields[].after[].sellingPrice`
- `changes.fields[].after[].serialNumbers[]`
- `changes.fields[].after[].showOnInvoice`
- `changes.fields[].after[].sourceLineId`
- `changes.fields[].after[].state`
- `changes.fields[].after[].status`
- `changes.fields[].after[].subtotal`
- `changes.fields[].after[].taxAmount`
- `changes.fields[].after[].taxCodeSnapshot`
- `changes.fields[].after[].taxPercent`
- `changes.fields[].after[].trackStock`
- `changes.fields[].after[].type`
- `changes.fields[].after[].unit`
- `changes.fields[].after[].unitPrice`
- `changes.fields[].after[].updatedAt`
- `changes.fields[].after[].updatedBy`
- `changes.fields[].after[].upiId`
- `changes.fields[].after[].whatsApp`
- `changes.fields[].after[].wholesalePrice`
- `changes.fields[].before.bill:create`
- `changes.fields[].before.categories`
- `changes.fields[].before.contentType`
- `changes.fields[].before.country`
- `changes.fields[].before.customers`
- `changes.fields[].before.deliveries`
- `changes.fields[].before.expenses`
- `changes.fields[].before.firestoreWrites.dailyLimit`
- `changes.fields[].before.firestoreWrites.enabled`
- `changes.fields[].before.firestoreWrites.enforcementMode`
- `changes.fields[].before.firestoreWrites.hardThresholdPercent`
- `changes.fields[].before.firestoreWrites.monthlyLimit`
- `changes.fields[].before.firestoreWrites.warningThresholdPercent`
- `changes.fields[].before.firestoreWrites.weeklyLimit`
- `changes.fields[].before.height`
- `changes.fields[].before.isRegistered`
- `changes.fields[].before.labels.invoiceTitle`
- `changes.fields[].before.labels.registrationLabel`
- `changes.fields[].before.labels.taxName`
- `changes.fields[].before.path`
- `changes.fields[].before.phone`
- `changes.fields[].before.products`
- `changes.fields[].before.purchases`
- `changes.fields[].before.regime`
- `changes.fields[].before.sales`
- `changes.fields[].before.sizeBytes`
- `changes.fields[].before.stock`
- `changes.fields[].before.taxAmount`
- `changes.fields[].before.taxRatePercent`
- `changes.fields[].before.taxType`
- `changes.fields[].before.updatedAt`
- `changes.fields[].before.vendors`
- `changes.fields[].before.width`
- `changes.fields[].before[]`
- `changes.fields[].before[].baseQuantity`
- `changes.fields[].before[].conversionFactor`
- `changes.fields[].before[].costSnapshot`
- `changes.fields[].before[].designation`
- `changes.fields[].before[].discountValue`
- `changes.fields[].before[].email`
- `changes.fields[].before[].id`
- `changes.fields[].before[].isActive`
- `changes.fields[].before[].isPrimary`
- `changes.fields[].before[].lineId`
- `changes.fields[].before[].lineTotal`
- `changes.fields[].before[].name`
- `changes.fields[].before[].phone`
- `changes.fields[].before[].priceSnapshot`
- `changes.fields[].before[].productId`
- `changes.fields[].before[].quantity`
- `changes.fields[].before[].subtotal`
- `changes.fields[].before[].taxAmount`
- `changes.fields[].before[].taxCodeSnapshot`
- `changes.fields[].before[].trackStock`
- `changes.fields[].before[].type`
- `changes.fields[].before[].unit`
- `details.action`
- `details.decision`
- `details.duplicateOverrideReason`
- `details.notes`
- `details.planId`
- `details.reason`
- `details.reasonCode`
- `details.taxExemptionReason`
- `targets[]`

## `bills` (`BillDoc`)

Typed leaf paths: 67. Documents observed in the census: 34. Stored but untyped paths: 1.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `billNumber` | `string` | yes | public | yes | e.g. "INV-2026-000001", "POS-2026-000001", "QTN-2026-000001" |
| `salesMode` | `SalesMode` | yes | public | yes | pos or b2b |
| `documentType` | `DocumentType | undefined` | no | public | yes | invoice, quotation, sales_order, proforma |
| `salespersonMembershipId` | `string | null | undefined` | no | public | yes |  |
| `customerId` | `string | null | undefined` | no | public | yes | Reference to customers/{customerId} |
| `billToSnapshot.name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `billToSnapshot.phone` | `string | undefined` | no | PII | yes | Phone number in E.164 format. |
| `billToSnapshot.taxId` | `string | undefined` | no | PII | yes | Tax registration number (GSTIN, VAT number, …). |
| `billToSnapshot.billingAddress` | `string | undefined` | no | PII | yes |  |
| `items[].lineId` | `string` | yes | public | yes | Stable line id ("L1", "L2", …): returns, deliveries and stock movements reference it |
| `items[].productId` | `string` | yes | public | yes | Reference to products/{productId} (name/SKU are hydrated at read time) |
| `items[].priceSnapshot` | `number` | yes | public | yes | Selling price at sale time |
| `items[].costSnapshot` | `number` | yes | public | yes | Cost price at sale time |
| `items[].taxCodeSnapshot` | `string | undefined` | no | public | yes | HSN/SAC snapshot |
| `items[].quantity` | `number` | yes | public | yes | In the line unit |
| `items[].unit` | `string` | yes | public | yes | Unit of measure (piece, box, kg, …). |
| `items[].conversionFactor` | `number | undefined` | no | public | yes | Base units per line unit, frozen at sale time |
| `items[].baseQuantity` | `number | undefined` | no | public | yes | quantity * conversionFactor (stock unit) |
| `items[].trackStock` | `boolean | undefined` | no | public | yes | Product trackStock at sale time (serials sold on the line live in serials/, by soldLineId) |
| `items[].isReturnable` | `boolean | undefined` | no | public | yes | false when the product was non-returnable at sale time |
| `items[].subtotal` | `number` | yes | public | yes | Total of the lines before document-level discount and tax. |
| `items[].discountValue` | `number` | yes | public | yes |  |
| `items[].taxAmount` | `number` | yes | public | yes | Tax amount. |
| `items[].lineTotal` | `number` | yes | public | yes | Line total after discount and tax. |
| `items[].returnedQty` | `number | undefined` | no | public | yes | Quantity already returned from this line. |
| `subTotal` | `number` | yes | public | yes | Total of the lines before document-level discount and tax. |
| `discountTotal` | `number` | yes | public | yes | Total discount of the document. |
| `taxTotal` | `number` | yes | public | yes | Total tax of the document. |
| `roundOff` | `number` | yes | public | yes |  |
| `totalAmount` | `number` | yes | public | yes | Total of the document in the currency's major unit. |
| `paidAmount` | `number` | yes | public | yes | Amount paid so far. |
| `balanceAmount` | `number` | yes | public | yes | Amount still to be paid. |
| `paymentStatus` | `PaymentStatus` | yes | public | yes | Payment state of the document (unpaid, partially paid, paid). |
| `status` | `"active" | "pending_approval" | "rejected" | BillStatus | "draft" | "voided" | "cancelled" | "refunded"` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `approvalNote` | `string | null | undefined` | no | public | yes | Approval state lives in status (pending_approval / rejected) + approvedBy/rejectedBy |
| `requestedPaidAmount` | `number | undefined` | no | public | yes | Tender held until approval |
| `requestedPaymentMethod` | `PaymentMethod | undefined` | no | public | yes | Payment method asked for in the approval request. |
| `stockReserved` | `boolean | undefined` | no | public | yes |  |
| `finalizedAt` | `string | undefined` | no | public | yes | quotation / proforma converted to an invoice |
| `finalizedBy` | `string | undefined` | no | public | yes |  |
| `originalQuotationNumber` | `string | undefined` | no | public | yes | R2: number of the quotation this invoice was finalized from // Sales order holding allocatedStock |
| `createdByMembershipId` | `string | null | undefined` | no | public | yes | Membership id of the member who created the record. |
| `taxSnapshot.regime` | `string` | yes | public | yes | Tax regime applied (for example IN_GST). |
| `taxSnapshot.country` | `string` | yes | public | yes | Country whose tax rules were applied. |
| `taxSnapshot.taxRatePercent` | `number` | yes | public | yes | Tax rate in percent. |
| `taxSnapshot.taxAmount` | `number` | yes | public | yes | Tax amount. |
| `taxSnapshot.taxType` | `string` | yes | public | yes | Kind of tax applied. |
| `taxSnapshot.isRegistered` | `boolean` | yes | public | yes | Whether the seller is tax-registered. |
| `taxSnapshot.registrationNumber` | `string | undefined` | no | public | no | Seller's tax registration number. |
| `taxSnapshot.labels.taxName` | `string` | yes | public | yes | Name of the tax as printed (GST, VAT, …). |
| `taxSnapshot.labels.registrationLabel` | `string` | yes | public | yes | Label of the tax registration number as printed (GSTIN, VAT No., …). |
| `taxSnapshot.labels.invoiceTitle` | `string` | yes | public | yes | Title printed on the invoice. |
| `notes` | `string | undefined` | no | public | yes | Free-text notes. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |
| `approvedAt` | `string | undefined` | no | public | yes | Time the record was approved (ISO-8601). |
| `approvedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the approver. |
| `rejectedAt` | `string | undefined` | no | public | no | Time the record was rejected (ISO-8601). |
| `rejectedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who rejected it. |
| `approvalReason` | `string | null | undefined` | no | public | yes | Reason the approver gave. |
| `voidedAt` | `string | undefined` | no | public | yes | Time the document was voided (ISO-8601). |
| `voidedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who voided the document. |
| `voidReason` | `string | undefined` | no | public | yes | Reason the document was voided. |

Stored but untyped:

- `billToSnapshot`

## `branchUsageDaily` (`BranchUsageDailyDoc`)

Typed leaf paths: 5. Documents observed in the census: 2. Stored but untyped paths: 2.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `date` | `string` | yes | public | yes | YYYY-MM-DD |
| `clientReported` | `Partial<ServiceUsageCounts>` | no | public | no | untrusted client estimates |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |

Stored but untyped:

- `clientReported.locationPings`
- `clientReported.storageOperations`

## `branchUsageMonthly` (`BranchUsageMonthlyDoc`)

Typed leaf paths: 5. Documents observed in the census: 2. Stored but untyped paths: 2.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `month` | `string` | yes | public | yes | YYYY-MM |
| `clientReported` | `Partial<ServiceUsageCounts>` | no | public | no | untrusted client estimates |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |

Stored but untyped:

- `clientReported.locationPings`
- `clientReported.storageOperations`

## `organizations/branches` (`BranchDoc`)

Typed leaf paths: 33. Documents observed in the census: 74. Stored but untyped paths: 1.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `code` | `string` | yes | public | yes | Short code of the record, as shown in the app. |
| `isDefault` | `boolean` | yes | public | yes | Whether this is the default entry of its list. |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `taxId` | `string | undefined` | no | PII | no | Tax registration number (GSTIN, VAT number, …). |
| `address.id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `address.line1` | `string` | yes | PII | yes | First address line. |
| `address.city` | `string` | yes | PII | yes | City. |
| `address.state` | `string` | yes | PII | yes | State or province. |
| `address.postalCode` | `string` | yes | PII | yes | Postal or PIN code. |
| `address.country` | `string` | yes | PII | yes | ISO 3166-1 alpha-2 country code of the address. |
| `address.label` | `string | undefined` | no | PII | yes | Label of the address (Head office, Warehouse, …). |
| `address.line2` | `string | undefined` | no | PII | yes | Second address line. |
| `address.area` | `string | undefined` | no | PII | yes | Area or locality. |
| `address.geoPoint.latitude` | `number` | yes | PII | yes | Latitude in decimal degrees. |
| `address.geoPoint.longitude` | `number` | yes | PII | yes | Longitude in decimal degrees. |
| `address.contactName` | `string | undefined` | no | PII | yes | Person to contact at this address. |
| `address.phone` | `string | undefined` | no | PII | yes | Phone number at this address (E.164). |
| `address.isDefaultBilling` | `boolean | undefined` | no | PII | yes | Whether this address is used for billing by default. |
| `address.isDefaultShipping` | `boolean | undefined` | no | PII | yes | Whether this address is used for shipping by default. |
| `contact.phone` | `string | null | undefined` | no | PII | yes | Phone number in E.164 format. |
| `contact.email` | `string | null | undefined` | no | PII | yes | Email address. |
| `contact.managerName` | `string | null | undefined` | no | PII | no | Name of the branch manager. |
| `contact.contactPerson` | `string | null | undefined` | no | PII | yes | Name of the person to contact. |
| `settings.taxId` | `string | null | undefined` | no | PII | yes | Tax registration number (GSTIN, VAT number, …). |
| `settings.allowNegativeStock` | `boolean | undefined` | no | public | yes | Whether the branch may sell below zero stock. |
| `settings.defaultSalesMode` | `SalesMode | undefined` | no | public | yes | Sales mode the branch uses by default. |
| `settings.moduleOverrides` | `Record<string, boolean>` | no | public | yes | Per-branch module switches (module → enabled). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `settings.moduleOverrides.k1`

## `categories` (`CategoryDoc`)

Typed leaf paths: 10. Documents observed in the census: 10. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string | null` | no | public | yes | Null for global/system categories |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `nameKey` | `string` | yes | public | yes |  |
| `parentId` | `string | null | undefined` | no | public | yes | Parent category ID for hierarchical structure |
| `nature` | `string | undefined` | no | public | yes | "operational", "administrative", "cogs", etc. |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `customers` (`CustomerDoc`)

Typed leaf paths: 62. Documents observed in the census: 30. Stored but untyped paths: 4.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `customerCode` | `string` | yes | public | yes | e.g. "CUST-000001" |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `legalName` | `string | null | undefined` | no | public | yes | Registered legal name. |
| `partyType` | `"organization" | "person" | undefined` | no | public | yes | Kind of party. |
| `image.path` | `string` | yes | public | no | Storage path of the processed image. |
| `image.contentType` | `"image/jpeg" | "image/png" | "image/webp"` | yes | public | no | MIME type of the stored image. |
| `image.width` | `number` | yes | public | no | Image width in pixels. |
| `image.height` | `number` | yes | public | no | Image height in pixels. |
| `image.sizeBytes` | `number` | yes | public | no | Size of the stored image in bytes. |
| `image.updatedAt` | `string` | yes | public | no | Time the image was attached (ISO-8601). |
| `image.thumbnailPath` | `string | undefined` | no | public | no | thumbnailPath: storage path of the smaller thumbnail asset (products only). |
| `contacts[].id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `contacts[].name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `contacts[].designation` | `string | undefined` | no | PII | yes | The contact's job title. |
| `contacts[].phone` | `string | undefined` | no | PII | yes | Phone number in E.164 format. |
| `contacts[].email` | `string | undefined` | no | PII | yes | Email address. |
| `contacts[].whatsApp` | `string | undefined` | no | PII | yes | WhatsApp number in E.164 format. |
| `phone` | `string | null | undefined` | no | PII | yes | Phone number in E.164 format. |
| `additionalPhones[]` | `string` | yes | PII | yes | Further phone numbers in E.164 format. |
| `email` | `string | null | undefined` | no | PII | yes | Email address. |
| `taxId` | `string | null | undefined` | no | PII | yes | Tax registration number (GSTIN, VAT number, …). |
| `addresses[].id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `addresses[].line1` | `string` | yes | PII | yes | First address line. |
| `addresses[].city` | `string` | yes | PII | yes | City. |
| `addresses[].state` | `string` | yes | PII | yes | State or province. |
| `addresses[].postalCode` | `string` | yes | PII | yes | Postal or PIN code. |
| `addresses[].country` | `string` | yes | PII | yes | ISO 3166-1 alpha-2 country code of the address. |
| `addresses[].label` | `string | undefined` | no | PII | yes | Label of the address (Head office, Warehouse, …). |
| `addresses[].line2` | `string | undefined` | no | PII | yes | Second address line. |
| `addresses[].area` | `string | undefined` | no | PII | yes | Area or locality. |
| `addresses[].geoPoint.latitude` | `number` | yes | PII | yes | Latitude in decimal degrees. |
| `addresses[].geoPoint.longitude` | `number` | yes | PII | yes | Longitude in decimal degrees. |
| `addresses[].contactName` | `string | undefined` | no | PII | yes | Person to contact at this address. |
| `addresses[].phone` | `string | undefined` | no | PII | yes | Phone number at this address (E.164). |
| `addresses[].isDefaultBilling` | `boolean | undefined` | no | PII | yes | Whether this address is used for billing by default. |
| `addresses[].isDefaultShipping` | `boolean | undefined` | no | PII | yes | Whether this address is used for shipping by default. |
| `bankAccounts[].id` | `string` | yes | sensitive | yes | Id of this item, unique within its list. |
| `bankAccounts[].accountHolderName` | `string` | yes | sensitive | yes | Name on the bank account. |
| `bankAccounts[].bankName` | `string` | yes | sensitive | yes | Name of the bank. |
| `bankAccounts[].accountNumber` | `string` | yes | sensitive | yes | Bank account number. |
| `bankAccounts[].label` | `string | undefined` | no | sensitive | yes | Label of the bank account. |
| `bankAccounts[].routingType` | `"other" | "ifsc" | "iban" | "swift" | "us_routing" | "sg_code" | undefined` | no | sensitive | yes | Kind of routing code (IFSC, IBAN, SWIFT, US routing, other). |
| `bankAccounts[].routingCode` | `string | undefined` | no | sensitive | yes | Routing code of the bank branch, of the kind given by routingType. |
| `bankAccounts[].upiId` | `string | undefined` | no | sensitive | yes | UPI id for payments to this account. |
| `bankAccounts[].currency` | `string | undefined` | no | sensitive | yes | ISO 4217 currency of the account. |
| `bankAccounts[].isDefault` | `boolean | undefined` | no | sensitive | yes | Whether this is the default entry of its list. |
| `bankAccounts[].showOnInvoice` | `boolean | undefined` | no | sensitive | yes | Whether the account is printed on invoices. |
| `bankAccounts[].status` | `"active" | "archived" | undefined` | no | sensitive | yes | Whether the account is active or archived. |
| `priceGroup` | `string | undefined` | no | public | yes | "retail", "wholesale", "distributor" |
| `creditLimit` | `number` | yes | public | yes | Maximum outstanding balance allowed for the party. |
| `creditPeriodDays` | `number` | yes | public | yes | Days of credit given to the party. |
| `outstandingBalance` | `number` | yes | public | yes | Udhaar amount customer owes |
| `totalSpend` | `number` | yes | public | yes | Total the customer has spent. |
| `visibilityScope` | `"all_branches" | "selected_branches" | "branch_only" | undefined` | no | public | yes | Branch visibility scope (default: all_branches) |
| `sharedForBranchIds[]` | `string` | yes | public | yes | Branch IDs allowed to access this customer record |
| `isDefault` | `boolean` | yes | public | yes | Whether this is the default entry of its list. |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `addresses[]`
- `bankAccounts[]`
- `contacts[]`
- `image`

## `dailySummaries` (`DailySummaryDoc`)

Typed leaf paths: 16. Documents observed in the census: 27. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `date` | `string` | yes | public | yes | YYYY-MM-DD |
| `totalRevenue` | `number` | yes | public | yes | Gross bill total amount |
| `totalExpenses` | `number` | yes | public | yes | Outflow expenses total amount |
| `cogs` | `number` | yes | public | yes | Cost of goods sold (WAC * sold quantity) |
| `grossProfit` | `number` | yes | public | yes | totalRevenue - cogs |
| `netProfit` | `number` | yes | public | yes | grossProfit - totalExpenses |
| `billCount` | `number` | yes | public | yes | Number of bills. |
| `outflowCount` | `number` | yes | public | yes |  |
| `paymentBreakdown.cash` | `number` | yes | public | yes |  |
| `paymentBreakdown.upi` | `number` | yes | public | yes |  |
| `paymentBreakdown.card` | `number` | yes | public | yes |  |
| `paymentBreakdown.bank_transfer` | `number` | yes | sensitive | yes |  |
| `paymentBreakdown.credit` | `number` | yes | public | yes |  |
| `paymentBreakdown.other` | `number` | yes | public | yes |  |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |

## `deliveries` (`DeliveryDoc`)

Typed leaf paths: 27. Documents observed in the census: 8. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `billId` | `string` | yes | public | yes | ID reference ONLY! No embedded bill object. |
| `customerId` | `string | null | undefined` | no | public | yes | Copied reference of bills/{billId}.customerId (query index, R3) |
| `recipient.name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `recipient.phone` | `string` | yes | PII | yes | Phone number in E.164 format. |
| `address.line1` | `string` | yes | PII | yes | First address line. |
| `address.line2` | `string | undefined` | no | PII | no | Second address line. |
| `address.landmark` | `string | undefined` | no | PII | no | Nearby landmark to find the address. |
| `address.city` | `string` | yes | PII | yes | City. |
| `address.pincode` | `string` | yes | PII | yes | Postal or PIN code. |
| `lines[].lineId` | `string` | yes | public | yes | Id of a line within its document. |
| `lines[].quantity` | `number` | yes | public | yes | Quantity in the line's unit. |
| `riderMembershipId` | `string | null | undefined` | no | public | yes | Rider name is hydrated at read time (included.members) |
| `partner` | `DeliveryPartner` | yes | public | yes | internal, swiggy, zomato, dunzo, other |
| `deliveryFee` | `number` | yes | public | yes | Fee charged for the delivery. |
| `status` | `DeliveryStatus` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `cod.isCod` | `boolean` | yes | public | no | Whether payment is collected on delivery. |
| `cod.amount` | `number` | yes | public | no | Amount to collect on delivery. |
| `cod.isCollected` | `boolean` | yes | public | no | Whether the cash-on-delivery amount was collected. |
| `cod.collectedAt` | `string | null | undefined` | no | public | no | Time the cash-on-delivery amount was collected (ISO-8601). |
| `deliveredAt` | `string | undefined` | no | public | yes | Time the delivery was completed (ISO-8601). |
| `notes` | `string | undefined` | no | public | yes | Free-text notes. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

## `departments` (`DepartmentDoc`)

Typed leaf paths: 8. Documents observed in the census: 4. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string | null` | no | public | yes | Null for system catalog |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `headMembershipIds[]` | `string` | yes | public | yes | References to memberships/{membershipId} |
| `isSystem` | `boolean` | yes | public | yes | Whether the record is built in (system-defined) rather than created by an organization. |
| `createdAt` | `string | undefined` | no | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `users/devices` (`DeviceDoc`)

Typed leaf paths: 5. Documents observed in the census: 3. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `fcmToken` | `string` | yes | sensitive | yes |  |
| `platform` | `"android" | "ios" | "web"` | yes | public | yes |  |
| `lastLoginAt` | `string | undefined` | no | public | yes | written by authLogin on every sign-in from this device |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |

## `documentCounters` (`DocumentCounterDoc`)

Typed leaf paths: 5. Documents observed in the census: 85. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `type` | `string` | yes | public | yes | "INV", "POS", "PUR", "EXP", "PAY", "RET", "DEL" |
| `year` | `number` | yes | public | yes |  |
| `currentSequence` | `number` | yes | public | yes |  |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |

## `idempotencyRecords` (`IdempotencyRecordDoc`)

Typed leaf paths: 11. Documents observed in the census: 111. Stored but untyped paths: 126.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `scope` | `string` | yes | public | yes | organizationId or "platform" (lets an organization's records be found and purged) |
| `operationId` | `string` | yes | public | yes |  |
| `requestHash` | `string` | yes | sensitive | yes |  |
| `status` | `IdempotencyStatus` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `result` | `Record<string, unknown>` | no | public | no |  |
| `error.code` | `string` | yes | public | yes | Machine-readable code of the error the attempt ended with. |
| `error.message` | `string` | yes | public | yes | Message of the error the attempt ended with. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `updatedAt` | `string | undefined` | no | public | yes | set when a timed-out PROCESSING record self-heals to SUCCEEDED |
| `processingExpiresAt` | `string | undefined` | no | public | yes | ISO 8601 lease timeout for PROCESSING status |
| `expiresAt` | `string` | yes | public | yes | ISO 8601 |

Stored but untyped:

- `result.acceptedContentTypes[]`
- `result.amount`
- `result.assignedByMembershipId`
- `result.assignedToMembershipId`
- `result.balanceAmount`
- `result.billId`
- `result.billNumber`
- `result.branch.address.area`
- `result.branch.address.city`
- `result.branch.address.contactName`
- `result.branch.address.country`
- `result.branch.address.geoPoint.latitude`
- `result.branch.address.geoPoint.longitude`
- `result.branch.address.id`
- `result.branch.address.isDefaultBilling`
- `result.branch.address.isDefaultShipping`
- `result.branch.address.label`
- `result.branch.address.line1`
- `result.branch.address.line2`
- `result.branch.address.phone`
- `result.branch.address.postalCode`
- `result.branch.address.state`
- `result.branch.code`
- `result.branch.contact.contactPerson`
- `result.branch.contact.email`
- `result.branch.contact.phone`
- `result.branch.createdAt`
- `result.branch.createdBy`
- `result.branch.isActive`
- `result.branch.isDefault`
- `result.branch.name`
- `result.branch.organizationId`
- `result.branch.settings.allowNegativeStock`
- `result.branch.settings.defaultSalesMode`
- `result.branch.settings.moduleOverrides`
- `result.branch.settings.moduleOverrides.k1`
- `result.branch.settings.taxId`
- `result.branch.updatedAt`
- `result.branchId`
- `result.branchLimit`
- `result.categoryId`
- `result.code`
- `result.completedAt`
- `result.completedByMembershipId`
- `result.createdAt`
- `result.createdBy`
- `result.currency`
- `result.currentStock`
- `result.customerCode`
- `result.customerId`
- `result.deliveryId`
- `result.departmentId`
- `result.description`
- `result.direction`
- `result.documentType`
- `result.dueAt`
- `result.expiresAt`
- `result.headMembershipIds[]`
- `result.isActive`
- `result.isSystem`
- `result.jobRoleId`
- `result.kind`
- `result.leaderMembershipId`
- `result.maxBytes`
- `result.membershipId`
- `result.message`
- `result.moduleFlags.billing`
- `result.moduleFlags.deliveries`
- `result.moduleFlags.inventory`
- `result.moduleFlags.k1`
- `result.moduleFlags.purchases`
- `result.moduleFlags.tasks`
- `result.monthlyDocumentVolumeLimit`
- `result.movementId`
- `result.name`
- `result.newStock`
- `result.nextRunOn`
- `result.notified`
- `result.organizationId`
- `result.originalQuotationNumber`
- `result.outflowId`
- `result.outflowNumber`
- `result.ownerMembershipId`
- `result.ownerStatus`
- `result.ownerUserId`
- `result.paidAmount`
- `result.paymentId`
- `result.paymentNumber`
- `result.paymentStatus`
- `result.permissions[]`
- `result.planId`
- `result.previousStock`
- `result.price`
- `result.priority`
- `result.productId`
- `result.quantityAdjusted`
- `result.reasonCode`
- `result.relatedEntityId`
- `result.relatedEntityType`
- `result.returnId`
- `result.returnNumber`
- `result.reversedDocumentId`
- `result.reversedStockLines`
- `result.roleId`
- `result.salesMode`
- `result.seatLimits.admin`
- `result.seatLimits.staff`
- `result.status`
- `result.storageLimitMb`
- `result.success`
- `result.taskId`
- `result.teamId`
- `result.templateId`
- `result.title`
- `result.totalAmount`
- `result.totalRefundAmount`
- `result.unitId`
- `result.updatedAt`
- `result.updatedBy`
- `result.uploadId`
- `result.uploadPath`
- `result.userCreated`
- `result.userId`
- `result.vendorCode`
- `result.vendorId`
- `result.voidedPayments`

## `imageUploadSessions` (`ImageUploadSessionDoc`)

Typed leaf paths: 14. Documents observed in the census: 4. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `uploadId` | `string` | yes | public | yes | Id of the upload session; pass it to imagesAttach. |
| `scope` | `string` | yes | public | yes | organizationId, "platform" or "users" |
| `callerUid` | `string` | yes | public | yes |  |
| `purpose` | `string` | yes | public | yes |  |
| `entityType` | `string` | yes | public | yes | Kind of record the entry refers to (organization, product, bill, …). |
| `entityId` | `string | null` | no | public | yes | Id of the record the entry refers to. |
| `contentType` | `string` | yes | public | yes |  |
| `maxBytes` | `number` | yes | public | yes | Largest upload accepted for this session, in bytes. |
| `uploadPath` | `string` | yes | public | yes | tmp/{scope}/{uid}/{uploadId} |
| `isUsed` | `boolean` | yes | public | yes |  |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `expiresAt` | `string` | yes | public | yes | Time this stops being valid (ISO-8601). |
| `attachedAt` | `string | undefined` | no | public | yes | set by attachUploadedImage when the upload is attached |
| `finalPath` | `string | undefined` | no | public | yes | storage path of the processed image, set on attach |

## `jobRoles` (`JobRoleDoc`)

Typed leaf paths: 9. Documents observed in the census: 10. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string | null` | no | public | yes | Null for system catalog |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `code` | `string` | yes | public | yes | e.g. "warehouse_manager", "delivery_executive" |
| `isSystem` | `boolean` | yes | public | yes | Whether the record is built in (system-defined) rather than created by an organization. |
| `description` | `string | undefined` | no | public | yes | Free-text description. |
| `createdAt` | `string | undefined` | no | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `latestLocations` (`LatestLocationDoc`)

Typed leaf paths: 11. Documents observed in the census: 3. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `membershipId` | `string` | yes | public | yes | Reference to memberships/{uid}_{orgId} |
| `userId` | `string` | yes | public | yes | Firebase Auth uid of the user. |
| `latitude` | `number` | yes | public | yes | Latitude in decimal degrees. |
| `longitude` | `number` | yes | public | yes | Longitude in decimal degrees. |
| `accuracy` | `number | undefined` | no | public | yes | Accuracy in meters |
| `speed` | `number | undefined` | no | public | yes | Speed in m/s |
| `heading` | `number | undefined` | no | public | yes | Heading in degrees |
| `source` | `"foreground" | "background"` | yes | public | yes | Whether the location was recorded with the app in the foreground or the background. |
| `recordedAt` | `string` | yes | public | yes | ISO 8601 string |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |

## `locationPings` (`LocationPingDoc`)

Typed leaf paths: 13. Documents observed in the census: 3. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `membershipId` | `string` | yes | public | yes | Id of a membership: one user in one organization (`<uid>_<organizationId>`). |
| `userId` | `string` | yes | public | yes | Firebase Auth uid of the user. |
| `latitude` | `number` | yes | public | yes | Latitude in decimal degrees. |
| `longitude` | `number` | yes | public | yes | Longitude in decimal degrees. |
| `accuracy` | `number | undefined` | no | public | yes |  |
| `speed` | `number | undefined` | no | public | yes |  |
| `heading` | `number | undefined` | no | public | yes |  |
| `source` | `"foreground" | "background"` | yes | public | yes | Whether the location was recorded with the app in the foreground or the background. |
| `recordedAt` | `string` | yes | public | yes | ISO 8601 string from device |
| `createdAt` | `string` | yes | public | yes | ISO 8601 string of server ingestion time |
| `expiresAt` | `Timestamp` | yes | public | yes | Native Firestore Timestamp for Cloud Firestore TTL |

## `membershipBranches` (`MembershipBranchDoc`)

Typed leaf paths: 11. Documents observed in the census: 162. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `membershipId` | `string` | yes | public | yes | Id of a membership: one user in one organization (`<uid>_<organizationId>`). |
| `userId` | `string` | yes | public | yes | Firebase Auth uid of the user. |
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `status` | `EntityStatus` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `isDefaultForMembership` | `boolean` | yes | public | yes |  |
| `permissions` | `Record<string, boolean>` | no | public | yes |  |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `memberships` (`MembershipDoc`)

Typed leaf paths: 17. Documents observed in the census: 151. Stored but untyped paths: 38.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `userId` | `string` | yes | public | yes | Reference to users/{uid} |
| `organizationId` | `string` | yes | public | yes | Reference to organizations/{organizationId} |
| `roleId` | `string` | yes | public | yes | Reference to roles/{roleId} |
| `departmentId` | `string | null | undefined` | no | public | yes | Reference to departments/{departmentId} |
| `jobRoleIds[]` | `string` | yes | public | yes | References to jobRoles/{jobRoleId} |
| `teamId` | `string | null | undefined` | no | public | yes | Reference to teams/{teamId} |
| `reportingToIds[]` | `string` | yes | public | yes | References to memberships/{membershipId} (multi-manager graph) |
| `permissions` | `Record<string, boolean>` | yes | public | yes | Explicit user-level override grants/denies |
| `status` | `EntityStatus` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `isPrimary` | `boolean` | yes | public | yes | Whether this is the primary entry of its list. |
| `primaryBranchId` | `string | undefined` | no | public | yes | Canonical default active operating branch for this membership (assignments: membershipBranches) |
| `locationTrackingEnabled` | `boolean | undefined` | no | public | yes | Explicit consent flag for employee live-location tracking |
| `dataScopes` | `Partial<Record<"sales" | "purchases" | "expenses" | "deliveries" | "returns" | "payments" | "stock" | "tasks", "self" | "team" | "branch" | "organization">>` | no | public | no | Optional per-module data scope override (self | team | branch | organization). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `dataScopes.deliveries`
- `dataScopes.expenses`
- `dataScopes.payments`
- `dataScopes.purchases`
- `dataScopes.returns`
- `dataScopes.sales`
- `dataScopes.stock`
- `dataScopes.tasks`
- `permissions.audit:read_own`
- `permissions.audit:view`
- `permissions.bill:create`
- `permissions.bill:discount`
- `permissions.bill:update`
- `permissions.bill:view`
- `permissions.customer:view`
- `permissions.employee:view`
- `permissions.expense:create`
- `permissions.expense:view`
- `permissions.inventory:view`
- `permissions.k1`
- `permissions.location:ping`
- `permissions.location:view_own`
- `permissions.notification:view`
- `permissions.org:view`
- `permissions.outflow:create`
- `permissions.payment:create`
- `permissions.product:view`
- `permissions.product:view_cost`
- `permissions.purchase:create`
- `permissions.purchase:view`
- `permissions.report:view`
- `permissions.return:create`
- `permissions.return:view`
- `permissions.sale:create`
- `permissions.stock:adjust`
- `permissions.stock:view`
- `permissions.task:update`
- `permissions.task:view`

## `modules` (`ModuleDoc`)

Typed leaf paths: 3. Documents observed in the census: 12. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `code` | `string` | yes | public | yes | Short code of the record, as shown in the app. |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `description` | `string` | yes | public | yes | Free-text description. |

## `monthlySummaries` (`MonthlySummaryDoc`)

Typed leaf paths: 11. Documents observed in the census: 26. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `yearMonth` | `string` | yes | public | yes | YYYY-MM |
| `totalRevenue` | `number` | yes | public | yes | Total revenue in the period. |
| `totalExpenses` | `number` | yes | public | yes |  |
| `cogs` | `number` | yes | public | yes |  |
| `grossProfit` | `number` | yes | public | yes |  |
| `netProfit` | `number` | yes | public | yes |  |
| `billCount` | `number` | yes | public | yes | Number of bills. |
| `outflowCount` | `number` | yes | public | yes |  |
| `daysRecorded` | `number` | yes | public | yes |  |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |

## `notificationOutbox` (`NotificationOutboxDoc`)

Typed leaf paths: 10. Documents observed in the census: 88. Stored but untyped paths: 2.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string | undefined` | no | public | no | Id of the organization (tenant) the record belongs to. |
| `userId` | `string | undefined` | no | public | yes | Firebase Auth uid of the user. |
| `type` | `"system" | "welcome" | "usage_warning"` | yes | public | yes |  |
| `payload.title` | `string` | yes | public | yes | Short title. |
| `payload.body` | `string` | yes | public | yes |  |
| `payload.data` | `Record<string, string>` | no | public | no |  |
| `status` | `"pending" | "failed" | "dispatched"` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `retryCount` | `number` | yes | public | yes |  |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `dispatchedAt` | `string | undefined` | no | public | yes |  |

Stored but untyped:

- `payload.data.type`
- `payload.data.userId`

## `notifications` (`NotificationDoc`)

Typed leaf paths: 12. Documents observed in the census: 109. Stored but untyped paths: 1.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `userId` | `string` | yes | public | yes | Recipient user ID |
| `membershipId` | `string` | yes | public | yes | Recipient membership ID |
| `type` | `NotificationType` | yes | public | yes |  |
| `title` | `string` | yes | public | yes | Short title. |
| `body` | `string` | yes | public | yes |  |
| `relatedEntityType` | `string | null | undefined` | no | public | yes | Kind of record the task is about. |
| `relatedEntityId` | `string | null | undefined` | no | public | yes |  |
| `data` | `Record<string, string>` | no | public | yes |  |
| `isRead` | `boolean` | yes | public | yes |  |
| `readAt` | `string | null | undefined` | no | public | yes |  |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |

Stored but untyped:

- `data.key`

## `organizationUsageDaily` (`OrganizationUsageDailyDoc`)

Typed leaf paths: 25. Documents observed in the census: 75. Stored but untyped paths: 577.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `date` | `string` | yes | public | yes | YYYY-MM-DD (UTC: reconciles with the billing export) |
| `targets` | `Record<string, UsageOps & { calls: number; }>` | no | public | no |  |
| `clientReported` | `Partial<ServiceUsageCounts>` | no | public | no |  |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `calls` | `number | undefined` | no | public | yes |  |
| `errors` | `number | undefined` | no | public | yes |  |
| `denied` | `number | undefined` | no | public | yes |  |
| `durationMsSum` | `number | undefined` | no | public | yes |  |
| `bytesIn` | `number | undefined` | no | public | yes | request payload bytes |
| `bytesOut` | `number | undefined` | no | public | yes | response bytes |
| `redundantReads` | `number | undefined` | no | public | yes | a document read twice in one request with no write in between |
| `ops.reads` | `number` | yes | public | yes |  |
| `ops.writes` | `number` | yes | public | yes |  |
| `ops.deletes` | `number` | yes | public | yes |  |
| `ops.aggregationReads` | `number | undefined` | no | public | yes | reads billed for count() / aggregations (part of reads) |
| `byCategory` | `Partial<Record<"gate" | "app" | "audit" | "meter", UsageOps>>` | no | public | no | gate reads, business, audit and meter writes |
| `byCallable` | `Record<string, UsageOps & { calls: number; }>` | no | public | no |  |
| `byCollection` | `Record<string, UsageOps>` | no | public | no | collection templates ("organizations/{id}/branches"), bounded, overflow "other" |
| `hourly` | `Record<string, UsageOps & { calls: number; }>` | no | public | no | "00".."23" (UTC hour) |
| `shadowChecked` | `number | undefined` | no | public | yes | emulator only: requests whose counts the independent shadow counter checked |
| `shadowMismatch` | `number | undefined` | no | public | yes | emulator only: requests where it disagreed (must stay 0) |
| `shadowMismatchLast` | `string | undefined` | no | public | yes |  |
| `lastSeenAt` | `Timestamp` | no | public | yes | last flush (within the flush interval of the last call) |
| `expireAt` | `Timestamp` | no | public | yes | TTL (system setting METER_RETENTION_MONTHS, default 25) |

Stored but untyped:

- `byCallable.auditGetEntityHistory.calls`
- `byCallable.auditGetEntityHistory.reads`
- `byCallable.auditGetEntityHistory.writes`
- `byCallable.auditLogsList.calls`
- `byCallable.auditLogsList.reads`
- `byCallable.auditLogsList.writes`
- `byCallable.authLogin.calls`
- `byCallable.authLogin.reads`
- `byCallable.authLogin.writes`
- `byCallable.authMe.calls`
- `byCallable.authMe.reads`
- `byCallable.authMe.writes`
- `byCallable.billsCreate.calls`
- `byCallable.billsCreate.reads`
- `byCallable.billsCreate.writes`
- `byCallable.billsFinalize.calls`
- `byCallable.billsFinalize.reads`
- `byCallable.billsFinalize.writes`
- `byCallable.billsGet.calls`
- `byCallable.billsGet.reads`
- `byCallable.billsGet.writes`
- `byCallable.billsList.calls`
- `byCallable.billsList.reads`
- `byCallable.billsList.writes`
- `byCallable.billsPreview.calls`
- `byCallable.billsPreview.reads`
- `byCallable.billsPreview.writes`
- `byCallable.billsUpdateDraft.calls`
- `byCallable.billsUpdateDraft.reads`
- `byCallable.billsUpdateDraft.writes`
- `byCallable.billsVoid.calls`
- `byCallable.billsVoid.reads`
- `byCallable.billsVoid.writes`
- `byCallable.branchContextSwitch.calls`
- `byCallable.branchContextSwitch.reads`
- `byCallable.branchContextSwitch.writes`
- `byCallable.branchesCreate.calls`
- `byCallable.branchesCreate.reads`
- `byCallable.branchesCreate.writes`
- `byCallable.branchesDeactivate.calls`
- `byCallable.branchesDeactivate.reads`
- `byCallable.branchesDeactivate.writes`
- `byCallable.branchesGetDefault.calls`
- `byCallable.branchesGetDefault.reads`
- `byCallable.branchesGetDefault.writes`
- `byCallable.branchesList.calls`
- `byCallable.branchesList.reads`
- `byCallable.branchesList.writes`
- `byCallable.branchesUpdate.calls`
- `byCallable.branchesUpdate.reads`
- `byCallable.branchesUpdate.writes`
- `byCallable.categoriesCreate.calls`
- `byCallable.categoriesCreate.reads`
- `byCallable.categoriesCreate.writes`
- `byCallable.categoriesList.calls`
- `byCallable.categoriesList.reads`
- `byCallable.categoriesUpdate.calls`
- `byCallable.categoriesUpdate.deletes`
- `byCallable.categoriesUpdate.reads`
- `byCallable.categoriesUpdate.writes`
- `byCallable.customersCreate.aggregationReads`
- `byCallable.customersCreate.calls`
- `byCallable.customersCreate.reads`
- `byCallable.customersCreate.writes`
- `byCallable.customersGet.calls`
- `byCallable.customersGet.reads`
- `byCallable.customersGet.writes`
- `byCallable.customersList.calls`
- `byCallable.customersList.reads`
- `byCallable.customersList.writes`
- `byCallable.customersUpdate.calls`
- `byCallable.customersUpdate.deletes`
- `byCallable.customersUpdate.reads`
- `byCallable.customersUpdate.writes`
- `byCallable.deliveriesCreate.calls`
- `byCallable.deliveriesCreate.reads`
- `byCallable.deliveriesCreate.writes`
- `byCallable.deliveriesGet.calls`
- `byCallable.deliveriesGet.reads`
- `byCallable.deliveriesGet.writes`
- `byCallable.deliveriesList.calls`
- `byCallable.deliveriesList.reads`
- `byCallable.deliveriesList.writes`
- `byCallable.deliveriesUpdateStatus.calls`
- `byCallable.deliveriesUpdateStatus.reads`
- `byCallable.deliveriesUpdateStatus.writes`
- `byCallable.departmentsCreate.calls`
- `byCallable.departmentsCreate.reads`
- `byCallable.departmentsCreate.writes`
- `byCallable.departmentsList.calls`
- `byCallable.departmentsList.reads`
- `byCallable.departmentsUpdate.calls`
- `byCallable.departmentsUpdate.deletes`
- `byCallable.departmentsUpdate.reads`
- `byCallable.departmentsUpdate.writes`
- `byCallable.documentsDecide.calls`
- `byCallable.documentsDecide.reads`
- `byCallable.documentsDecide.writes`
- `byCallable.employeesCreate.calls`
- `byCallable.employeesCreate.reads`
- `byCallable.employeesCreate.writes`
- `byCallable.employeesDeactivate.calls`
- `byCallable.employeesDeactivate.reads`
- `byCallable.employeesDeactivate.writes`
- `byCallable.employeesGet.calls`
- `byCallable.employeesGet.reads`
- `byCallable.employeesGet.writes`
- `byCallable.employeesList.calls`
- `byCallable.employeesList.reads`
- `byCallable.employeesList.writes`
- `byCallable.employeesUpdate.calls`
- `byCallable.employeesUpdate.reads`
- `byCallable.employeesUpdate.writes`
- `byCallable.healthCheck.calls`
- `byCallable.imagesAttach.calls`
- `byCallable.imagesAttach.reads`
- `byCallable.imagesAttach.writes`
- `byCallable.imagesCreateUploadSession.calls`
- `byCallable.imagesCreateUploadSession.reads`
- `byCallable.imagesCreateUploadSession.writes`
- `byCallable.imagesRemove.calls`
- `byCallable.imagesRemove.reads`
- `byCallable.imagesRemove.writes`
- `byCallable.jobRolesCreate.calls`
- `byCallable.jobRolesCreate.reads`
- `byCallable.jobRolesCreate.writes`
- `byCallable.jobRolesList.calls`
- `byCallable.jobRolesList.reads`
- `byCallable.jobRolesUpdate.calls`
- `byCallable.jobRolesUpdate.deletes`
- `byCallable.jobRolesUpdate.reads`
- `byCallable.jobRolesUpdate.writes`
- `byCallable.locationsGetHistory.calls`
- `byCallable.locationsGetHistory.reads`
- `byCallable.locationsGetHistory.writes`
- `byCallable.locationsGetLatest.calls`
- `byCallable.locationsGetLatest.reads`
- `byCallable.locationsGetLatest.writes`
- `byCallable.locationsRecordPing.calls`
- `byCallable.locationsRecordPing.reads`
- `byCallable.locationsRecordPing.writes`
- `byCallable.modulesList.calls`
- `byCallable.modulesList.reads`
- `byCallable.modulesList.writes`
- `byCallable.notificationsList.calls`
- `byCallable.notificationsList.reads`
- `byCallable.notificationsMarkRead.calls`
- `byCallable.notificationsMarkRead.reads`
- `byCallable.notificationsMarkRead.writes`
- `byCallable.notificationsRegisterFcmToken.calls`
- `byCallable.notificationsRegisterFcmToken.reads`
- `byCallable.notificationsRegisterFcmToken.writes`
- `byCallable.onBillWritten.calls`
- `byCallable.onBillWritten.reads`
- `byCallable.onBillWritten.writes`
- `byCallable.onDeliveryWritten.calls`
- `byCallable.onDeliveryWritten.reads`
- `byCallable.onDeliveryWritten.writes`
- `byCallable.onOutflowWritten.calls`
- `byCallable.onOutflowWritten.reads`
- `byCallable.onOutflowWritten.writes`
- `byCallable.onPaymentWritten.calls`
- `byCallable.onPaymentWritten.reads`
- `byCallable.onPaymentWritten.writes`
- `byCallable.organizationsCreate.calls`
- `byCallable.organizationsCreate.reads`
- `byCallable.organizationsCreate.writes`
- `byCallable.organizationsDeactivate.calls`
- `byCallable.organizationsDeactivate.writes`
- `byCallable.organizationsGet.calls`
- `byCallable.organizationsGet.reads`
- `byCallable.organizationsGet.writes`
- `byCallable.organizationsGetSubscriptionHistory.calls`
- `byCallable.organizationsGetSubscriptionHistory.reads`
- `byCallable.organizationsGetSubscriptionHistory.writes`
- `byCallable.organizationsList.aggregationReads`
- `byCallable.organizationsList.calls`
- `byCallable.organizationsList.reads`
- `byCallable.organizationsList.writes`
- `byCallable.organizationsPreviewDeactivationImpact.calls`
- `byCallable.organizationsPreviewDeactivationImpact.reads`
- `byCallable.organizationsPreviewDeactivationImpact.writes`
- `byCallable.organizationsProvisionUser.calls`
- `byCallable.organizationsProvisionUser.reads`
- `byCallable.organizationsProvisionUser.writes`
- `byCallable.organizationsReactivate.calls`
- `byCallable.organizationsReactivate.reads`
- `byCallable.organizationsReactivate.writes`
- `byCallable.organizationsSetSubscription.calls`
- `byCallable.organizationsSetSubscription.reads`
- `byCallable.organizationsSetSubscription.writes`
- `byCallable.organizationsTransferOwnership.calls`
- `byCallable.organizationsTransferOwnership.reads`
- `byCallable.organizationsTransferOwnership.writes`
- `byCallable.organizationsUpdate.calls`
- `byCallable.organizationsUpdate.reads`
- `byCallable.organizationsUpdate.writes`
- `byCallable.outflowsCreate.calls`
- `byCallable.outflowsCreate.reads`
- `byCallable.outflowsCreate.writes`
- `byCallable.outflowsGet.calls`
- `byCallable.outflowsGet.reads`
- `byCallable.outflowsGet.writes`
- `byCallable.outflowsList.calls`
- `byCallable.outflowsList.reads`
- `byCallable.outflowsList.writes`
- `byCallable.outflowsVoid.calls`
- `byCallable.outflowsVoid.deletes`
- `byCallable.outflowsVoid.reads`
- `byCallable.outflowsVoid.writes`
- `byCallable.paymentsCreate.calls`
- `byCallable.paymentsCreate.reads`
- `byCallable.paymentsCreate.writes`
- `byCallable.paymentsList.calls`
- `byCallable.paymentsList.reads`
- `byCallable.paymentsList.writes`
- `byCallable.paymentsVoid.calls`
- `byCallable.paymentsVoid.reads`
- `byCallable.paymentsVoid.writes`
- `byCallable.permissionCatalogList.calls`
- `byCallable.permissionCatalogList.reads`
- `byCallable.permissionCatalogList.writes`
- `byCallable.plansArchive.calls`
- `byCallable.plansArchive.reads`
- `byCallable.plansArchive.writes`
- `byCallable.plansCreate.calls`
- `byCallable.plansCreate.reads`
- `byCallable.plansCreate.writes`
- `byCallable.plansDelete.calls`
- `byCallable.plansDelete.deletes`
- `byCallable.plansDelete.reads`
- `byCallable.plansDelete.writes`
- `byCallable.plansGet.calls`
- `byCallable.plansGet.reads`
- `byCallable.plansList.calls`
- `byCallable.plansList.reads`
- `byCallable.plansPreviewImpact.calls`
- `byCallable.plansPreviewImpact.reads`
- `byCallable.plansPreviewImpact.writes`
- `byCallable.plansUpdate.calls`
- `byCallable.plansUpdate.reads`
- `byCallable.plansUpdate.writes`
- `byCallable.platformUsersGet.calls`
- `byCallable.platformUsersGet.reads`
- `byCallable.platformUsersGet.writes`
- `byCallable.platformUsersList.aggregationReads`
- `byCallable.platformUsersList.calls`
- `byCallable.platformUsersList.reads`
- `byCallable.platformUsersList.writes`
- `byCallable.productsCreate.calls`
- `byCallable.productsCreate.reads`
- `byCallable.productsCreate.writes`
- `byCallable.productsGet.calls`
- `byCallable.productsGet.reads`
- `byCallable.productsGet.writes`
- `byCallable.productsGetPriceHistory.calls`
- `byCallable.productsGetPriceHistory.reads`
- `byCallable.productsGetPriceHistory.writes`
- `byCallable.productsList.calls`
- `byCallable.productsList.reads`
- `byCallable.productsList.writes`
- `byCallable.productsUpdate.calls`
- `byCallable.productsUpdate.reads`
- `byCallable.productsUpdate.writes`
- `byCallable.reconcileBranchCounts.calls`
- `byCallable.reconcileBranchCounts.reads`
- `byCallable.reconcileBranchCounts.writes`
- `byCallable.reconcilePartyLedgers.calls`
- `byCallable.reconcilePartyLedgers.reads`
- `byCallable.reconcilePartyLedgers.writes`
- `byCallable.reconcileStockBalances.calls`
- `byCallable.reconcileStockBalances.reads`
- `byCallable.reconcileStockBalances.writes`
- `byCallable.recurringExpensesCreate.calls`
- `byCallable.recurringExpensesCreate.reads`
- `byCallable.recurringExpensesCreate.writes`
- `byCallable.recurringExpensesList.calls`
- `byCallable.recurringExpensesList.reads`
- `byCallable.recurringExpensesList.writes`
- `byCallable.recurringExpensesUpdate.calls`
- `byCallable.recurringExpensesUpdate.reads`
- `byCallable.recurringExpensesUpdate.writes`
- `byCallable.reportsExportCsv.calls`
- `byCallable.reportsExportCsv.reads`
- `byCallable.reportsExportCsv.writes`
- `byCallable.reportsGetOutflowSummary.calls`
- `byCallable.reportsGetOutflowSummary.reads`
- `byCallable.reportsGetOutflowSummary.writes`
- `byCallable.reportsGetPartyStatement.calls`
- `byCallable.reportsGetPartyStatement.reads`
- `byCallable.reportsGetPartyStatement.writes`
- `byCallable.reportsGetPlatformOverview.calls`
- `byCallable.reportsGetPlatformOverview.reads`
- `byCallable.reportsGetPlatformOverview.writes`
- `byCallable.reportsGetProfitLoss.calls`
- `byCallable.reportsGetProfitLoss.reads`
- `byCallable.reportsGetProfitLoss.writes`
- `byCallable.reportsGetRevenue.calls`
- `byCallable.reportsGetRevenue.reads`
- `byCallable.reportsGetRevenue.writes`
- `byCallable.reportsGetStaffActivity.calls`
- `byCallable.reportsGetStaffActivity.reads`
- `byCallable.reportsGetStaffActivity.writes`
- `byCallable.reportsGetStockValuation.calls`
- `byCallable.reportsGetStockValuation.reads`
- `byCallable.reportsGetStockValuation.writes`
- `byCallable.reportsGetTopEntities.calls`
- `byCallable.reportsGetTopEntities.reads`
- `byCallable.reportsGetTopEntities.writes`
- `byCallable.returnsCreate.calls`
- `byCallable.returnsCreate.reads`
- `byCallable.returnsCreate.writes`
- `byCallable.returnsList.calls`
- `byCallable.returnsList.reads`
- `byCallable.returnsList.writes`
- `byCallable.rolesCreate.calls`
- `byCallable.rolesCreate.reads`
- `byCallable.rolesCreate.writes`
- `byCallable.rolesList.calls`
- `byCallable.rolesList.reads`
- `byCallable.rolesUpdate.calls`
- `byCallable.rolesUpdate.reads`
- `byCallable.rolesUpdate.writes`
- `byCallable.sharingPoliciesUpdate.calls`
- `byCallable.sharingPoliciesUpdate.reads`
- `byCallable.sharingPoliciesUpdate.writes`
- `byCallable.stockAdjust.calls`
- `byCallable.stockAdjust.reads`
- `byCallable.stockAdjust.writes`
- `byCallable.stockMovementsList.calls`
- `byCallable.stockMovementsList.reads`
- `byCallable.stockMovementsList.writes`
- `byCallable.tasksAssign.calls`
- `byCallable.tasksAssign.reads`
- `byCallable.tasksAssign.writes`
- `byCallable.tasksCreate.calls`
- `byCallable.tasksCreate.reads`
- `byCallable.tasksCreate.writes`
- `byCallable.tasksDelete.calls`
- `byCallable.tasksDelete.deletes`
- `byCallable.tasksDelete.reads`
- `byCallable.tasksDelete.writes`
- `byCallable.tasksList.calls`
- `byCallable.tasksList.reads`
- `byCallable.tasksList.writes`
- `byCallable.tasksUpdate.calls`
- `byCallable.tasksUpdate.reads`
- `byCallable.tasksUpdate.writes`
- `byCallable.tasksUpdateStatus.calls`
- `byCallable.tasksUpdateStatus.reads`
- `byCallable.tasksUpdateStatus.writes`
- `byCallable.taxRegimesList.calls`
- `byCallable.taxRegimesList.reads`
- `byCallable.teamsAssignMember.calls`
- `byCallable.teamsAssignMember.reads`
- `byCallable.teamsAssignMember.writes`
- `byCallable.teamsCreate.calls`
- `byCallable.teamsCreate.reads`
- `byCallable.teamsCreate.writes`
- `byCallable.teamsList.calls`
- `byCallable.teamsList.reads`
- `byCallable.teamsList.writes`
- `byCallable.teamsUpdate.calls`
- `byCallable.teamsUpdate.deletes`
- `byCallable.teamsUpdate.reads`
- `byCallable.teamsUpdate.writes`
- `byCallable.unitsCreate.calls`
- `byCallable.unitsCreate.reads`
- `byCallable.unitsCreate.writes`
- `byCallable.unitsList.calls`
- `byCallable.unitsList.reads`
- `byCallable.unitsUpdate.calls`
- `byCallable.unitsUpdate.deletes`
- `byCallable.unitsUpdate.reads`
- `byCallable.unitsUpdate.writes`
- `byCallable.unknown.calls`
- `byCallable.unknown.reads`
- `byCallable.unknown.writes`
- `byCallable.usageCalculateDryRunStatement.calls`
- `byCallable.usageCalculateDryRunStatement.reads`
- `byCallable.usageCalculateDryRunStatement.writes`
- `byCallable.usageGetBranches.calls`
- `byCallable.usageGetBranches.reads`
- `byCallable.usageGetBranches.writes`
- `byCallable.usageGetDetail.calls`
- `byCallable.usageGetDetail.reads`
- `byCallable.usageGetLimits.calls`
- `byCallable.usageGetLimits.reads`
- `byCallable.usageGetLimits.writes`
- `byCallable.usageGetOrganizations.calls`
- `byCallable.usageGetOrganizations.reads`
- `byCallable.usageGetOrganizations.writes`
- `byCallable.usageGetPlatformSummary.calls`
- `byCallable.usageGetPlatformSummary.reads`
- `byCallable.usageGetPlatformSummary.writes`
- `byCallable.usageRecordClientMetric.calls`
- `byCallable.usageRecordClientMetric.reads`
- `byCallable.usageRecordClientMetric.writes`
- `byCallable.usageUpdateLimits.calls`
- `byCallable.usageUpdateLimits.reads`
- `byCallable.usageUpdateLimits.writes`
- `byCallable.usersUpdateMe.calls`
- `byCallable.usersUpdateMe.reads`
- `byCallable.usersUpdateMe.writes`
- `byCallable.vendorsCreate.aggregationReads`
- `byCallable.vendorsCreate.calls`
- `byCallable.vendorsCreate.reads`
- `byCallable.vendorsCreate.writes`
- `byCallable.vendorsGet.calls`
- `byCallable.vendorsGet.reads`
- `byCallable.vendorsGet.writes`
- `byCallable.vendorsList.calls`
- `byCallable.vendorsList.reads`
- `byCallable.vendorsList.writes`
- `byCallable.vendorsUpdate.calls`
- `byCallable.vendorsUpdate.reads`
- `byCallable.vendorsUpdate.writes`
- `byCategory.app.aggregationReads`
- `byCategory.app.deletes`
- `byCategory.app.reads`
- `byCategory.app.writes`
- `byCategory.audit.writes`
- `byCategory.gate.reads`
- `byCategory.gate.writes`
- `byCategory.meter.writes`
- `byCollection.auditLogs.reads`
- `byCollection.auditLogs.writes`
- `byCollection.bills.reads`
- `byCollection.bills.writes`
- `byCollection.branchUsageDaily.reads`
- `byCollection.branchUsageDaily.writes`
- `byCollection.branchUsageMonthly.writes`
- `byCollection.categories.reads`
- `byCollection.categories.writes`
- `byCollection.customers.aggregationReads`
- `byCollection.customers.reads`
- `byCollection.customers.writes`
- `byCollection.dailySummaries.reads`
- `byCollection.dailySummaries.writes`
- `byCollection.deliveries.reads`
- `byCollection.deliveries.writes`
- `byCollection.departments.reads`
- `byCollection.departments.writes`
- `byCollection.documentCounters.reads`
- `byCollection.documentCounters.writes`
- `byCollection.idempotencyRecords.reads`
- `byCollection.idempotencyRecords.writes`
- `byCollection.imageUploadSessions.reads`
- `byCollection.imageUploadSessions.writes`
- `byCollection.jobRoles.reads`
- `byCollection.jobRoles.writes`
- `byCollection.latestLocations.reads`
- `byCollection.latestLocations.writes`
- `byCollection.locationPings.reads`
- `byCollection.locationPings.writes`
- `byCollection.membershipBranches.reads`
- `byCollection.membershipBranches.writes`
- `byCollection.memberships.reads`
- `byCollection.memberships.writes`
- `byCollection.modules.reads`
- `byCollection.monthlySummaries.reads`
- `byCollection.monthlySummaries.writes`
- `byCollection.notificationOutbox.reads`
- `byCollection.notificationOutbox.writes`
- `byCollection.notifications.deletes`
- `byCollection.notifications.reads`
- `byCollection.notifications.writes`
- `byCollection.organizationUsageDaily.reads`
- `byCollection.organizationUsageDaily.writes`
- `byCollection.organizationUsageMonthly.reads`
- `byCollection.organizationUsageMonthly.writes`
- `byCollection.organizations.aggregationReads`
- `byCollection.organizations.reads`
- `byCollection.organizations.writes`
- `byCollection.organizations/{id}/branches.reads`
- `byCollection.organizations/{id}/branches.writes`
- `byCollection.outflows.reads`
- `byCollection.outflows.writes`
- `byCollection.payments.reads`
- `byCollection.payments.writes`
- `byCollection.permissionCatalog.reads`
- `byCollection.platformCostReconciliation.reads`
- `byCollection.products.reads`
- `byCollection.products.writes`
- `byCollection.recurringExpenses.reads`
- `byCollection.recurringExpenses.writes`
- `byCollection.returns.reads`
- `byCollection.returns.writes`
- `byCollection.roles.reads`
- `byCollection.roles.writes`
- `byCollection.serials.reads`
- `byCollection.serials.writes`
- `byCollection.stockAdjustmentRequests.reads`
- `byCollection.stockAdjustmentRequests.writes`
- `byCollection.stockBalances.reads`
- `byCollection.stockBalances.writes`
- `byCollection.stockMovements.reads`
- `byCollection.stockMovements.writes`
- `byCollection.subscriptionPlans.deletes`
- `byCollection.subscriptionPlans.reads`
- `byCollection.subscriptionPlans.writes`
- `byCollection.tasks.deletes`
- `byCollection.tasks.reads`
- `byCollection.tasks.writes`
- `byCollection.taxRegimes.reads`
- `byCollection.teams.reads`
- `byCollection.teams.writes`
- `byCollection.uniqueKeys.deletes`
- `byCollection.uniqueKeys.reads`
- `byCollection.uniqueKeys.writes`
- `byCollection.units.reads`
- `byCollection.units.writes`
- `byCollection.usageCounterShards.reads`
- `byCollection.usageCounterShards.writes`
- `byCollection.usageRateCards.reads`
- `byCollection.userUsageDaily.reads`
- `byCollection.users.aggregationReads`
- `byCollection.users.reads`
- `byCollection.users.writes`
- `byCollection.users/{id}/devices.reads`
- `byCollection.users/{id}/devices.writes`
- `byCollection.vendors.aggregationReads`
- `byCollection.vendors.reads`
- `byCollection.vendors.writes`
- `clientReported.locationPings`
- `clientReported.storageOperations`
- `hourly.07.aggregationReads`
- `hourly.07.calls`
- `hourly.07.deletes`
- `hourly.07.reads`
- `hourly.07.writes`
- `targets.1yNQMJVkLYjJvAfQpqWP.calls`
- `targets.1yNQMJVkLYjJvAfQpqWP.reads`
- `targets.1yNQMJVkLYjJvAfQpqWP.writes`
- `targets.EXryzEWQz2nPYHkDMtS1.calls`
- `targets.EXryzEWQz2nPYHkDMtS1.reads`
- `targets.EXryzEWQz2nPYHkDMtS1.writes`
- `targets.LJECIl5Ddm8lyWTPODTq.calls`
- `targets.LJECIl5Ddm8lyWTPODTq.reads`
- `targets.LJECIl5Ddm8lyWTPODTq.writes`
- `targets.MjuYlEyhcUoFdhzLvHC4.calls`
- `targets.MjuYlEyhcUoFdhzLvHC4.reads`
- `targets.MjuYlEyhcUoFdhzLvHC4.writes`
- `targets.Q8BsqrspomJaAjNgWLrt.calls`
- `targets.Q8BsqrspomJaAjNgWLrt.reads`
- `targets.Q8BsqrspomJaAjNgWLrt.writes`
- `targets.R4CRAXy9wIIWNjABfEPU.calls`
- `targets.R4CRAXy9wIIWNjABfEPU.reads`
- `targets.R4CRAXy9wIIWNjABfEPU.writes`
- `targets.RkUlcKs6tl7z1uWkgCUf.calls`
- `targets.RkUlcKs6tl7z1uWkgCUf.writes`
- `targets.TDOc9e05sL6vRdNGlcZq.calls`
- `targets.TDOc9e05sL6vRdNGlcZq.reads`
- `targets.TDOc9e05sL6vRdNGlcZq.writes`
- `targets.XBQTndmFNK6izDxj7nqU.calls`
- `targets.XBQTndmFNK6izDxj7nqU.reads`
- `targets.XBQTndmFNK6izDxj7nqU.writes`
- `targets.aZIjzzPMdp6mlN0CBS9y.calls`
- `targets.aZIjzzPMdp6mlN0CBS9y.reads`
- `targets.aZIjzzPMdp6mlN0CBS9y.writes`
- `targets.i5FuACJ6WtLfIfyTm2Zf.calls`
- `targets.i5FuACJ6WtLfIfyTm2Zf.reads`
- `targets.i5FuACJ6WtLfIfyTm2Zf.writes`
- `targets.mVnhzw25axKxZIuWjbBI.calls`
- `targets.mVnhzw25axKxZIuWjbBI.reads`
- `targets.mVnhzw25axKxZIuWjbBI.writes`
- `targets.oXXoMJO7GAm9aqtf6th1.calls`
- `targets.oXXoMJO7GAm9aqtf6th1.reads`
- `targets.oXXoMJO7GAm9aqtf6th1.writes`
- `targets.platform.calls`
- `targets.platform.reads`
- `targets.platform.writes`
- `targets.xJNmXOTmKYC5Ewrr2Wwk.calls`
- `targets.xJNmXOTmKYC5Ewrr2Wwk.reads`
- `targets.xJNmXOTmKYC5Ewrr2Wwk.writes`
- `targets.zxhuba86TNGa2pI1pxyV.calls`
- `targets.zxhuba86TNGa2pI1pxyV.writes`

## `organizationUsageMonthly` (`OrganizationUsageMonthlyDoc`)

Typed leaf paths: 4. Documents observed in the census: 2. Stored but untyped paths: 2.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `month` | `string` | yes | public | yes | YYYY-MM |
| `clientReported` | `Partial<ServiceUsageCounts>` | no | public | no | untrusted client estimates |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |

Stored but untyped:

- `clientReported.locationPings`
- `clientReported.storageOperations`

## `organizations` (`OrganizationDoc`)

Typed leaf paths: 117. Documents observed in the census: 60. Stored but untyped paths: 50.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `code` | `string | undefined` | no | public | no | Short code of the record, as shown in the app. |
| `legalName` | `string | undefined` | no | public | yes | Registered legal name. |
| `legalNameKey` | `string | undefined` | no | public | yes | normalized legalName, unique-lookup key (written by organizationsCreate / Update) |
| `businessType` | `BusinessType` | yes | public | yes | Kind of business (retail, wholesale or both); sets module and sales defaults. |
| `businessCategory` | `BusinessCategory` | yes | public | yes | Business category (general, grocery, electronics, …). |
| `country` | `string` | yes | public | yes | ISO 3166-1 alpha-2 |
| `currency` | `string` | yes | public | yes | ISO 4217 code |
| `currencyDecimals` | `number | undefined` | no | public | yes | Number of decimals the currency uses for amounts (ISO 4217 exponent). |
| `taxRegimeCode` | `string` | yes | public | yes | Reference to taxRegimes/{taxRegimeCode} |
| `status` | `EntityStatus` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `planId` | `string` | yes | public | yes | Reference to subscriptionPlans/{planId} |
| `moduleToggles` | `Record<string, boolean>` | yes | public | yes | Per-tenant feature switches |
| `image.path` | `string` | yes | public | yes | Storage path of the processed image. |
| `image.contentType` | `"image/jpeg" | "image/png" | "image/webp"` | yes | public | yes | MIME type of the stored image. |
| `image.width` | `number` | yes | public | yes | Image width in pixels. |
| `image.height` | `number` | yes | public | yes | Image height in pixels. |
| `image.sizeBytes` | `number` | yes | public | yes | Size of the stored image in bytes. |
| `image.updatedAt` | `string` | yes | public | yes | Time the image was attached (ISO-8601). |
| `image.thumbnailPath` | `string | undefined` | no | public | no | thumbnailPath: storage path of the smaller thumbnail asset (products only). |
| `ownerStatus` | `"pending" | "active" | undefined` | no | public | yes | Whether the organization's Owner account is provisioned (active) or still pending. |
| `ownerUserId` | `string | null | undefined` | no | public | yes | Firebase Auth uid of the organization's Owner (null until an Owner is provisioned). |
| `financialYearStartMonth` | `number | undefined` | no | public | yes | Month (1–12) the financial year starts. |
| `defaultBranchId` | `string | undefined` | no | public | yes | Id of the branch used when a request names none. |
| `branchCount` | `number | undefined` | no | public | yes | Number of active branches. |
| `sharingPolicies.products` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether products are shared by all branches or kept per branch. |
| `sharingPolicies.categories` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether categories are shared by all branches or kept per branch. |
| `sharingPolicies.customers` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether customers are shared by all branches or kept per branch. |
| `sharingPolicies.vendors` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether vendors are shared by all branches or kept per branch. |
| `sharingPolicies.sales` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether sales are shared by all branches or kept per branch. |
| `sharingPolicies.purchases` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether purchases are shared by all branches or kept per branch. |
| `sharingPolicies.expenses` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether expenses are shared by all branches or kept per branch. |
| `sharingPolicies.stock` | `"branch_scoped" | undefined` | no | public | yes | Stock is always kept per branch. |
| `sharingPolicies.deliveries` | `"organization_shared" | "branch_scoped" | undefined` | no | public | yes | Whether deliveries are shared by all branches or kept per branch. |
| `usageLimitOverrides` | `Partial<Record<keyof ServiceUsageCounts, MetricLimitConfig>>` | no | public | no | Super Admin per-tenant usage limit overrides |
| `showCostToTenant` | `boolean | undefined` | no | public | no | D-25: tenants see the cost estimate (labelled) only when the Super Admin enables it |
| `subscriptionStatus` | `SubscriptionStatus | undefined` | no | public | yes | State of the organization's subscription. |
| `subscriptionStartsAt` | `string | undefined` | no | public | yes | Time the subscription starts (ISO-8601). |
| `subscriptionExpiresAt` | `string | undefined` | no | public | yes | End of expiry date in `timezone` |
| `graceDays` | `number | undefined` | no | public | yes | Days after expiry during which the organization keeps access. |
| `timezone` | `string | undefined` | no | public | yes | IANA zone, default "Asia/Kolkata" |
| `salesChannels[]` | `SalesChannel` | yes | public | yes | One business can be e.g. wholesale + retail |
| `activeEmployeeCount` | `number | undefined` | no | public | yes | Transactional seat counter (excludes Owner) |
| `displayName` | `string | undefined` | no | public | no | Short name shown in the app instead of the legal name. |
| `taxId` | `string | null | undefined` | no | PII | yes | Tax registration number (GSTIN, VAT number, …). |
| `website` | `string | null | undefined` | no | public | yes | R1: external reference — URL is intentional here (D-15 exception) |
| `contactEmail` | `string | null | undefined` | no | PII | yes | R3: convenience shortcut duplicating contact.email — single writer: organizationsUpdate |
| `contactPhone` | `string | null | undefined` | no | PII | yes | R3: convenience shortcut duplicating contact.phone — single writer: organizationsUpdate |
| `contact.name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `contact.email` | `string` | yes | PII | yes | Email address. |
| `contact.phone` | `string` | yes | PII | yes | Phone number in E.164 format. |
| `contact.altPhone` | `string | undefined` | no | PII | yes | Alternative phone number in E.164 format. |
| `contacts[].id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `contacts[].name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `contacts[].designation` | `string | null | undefined` | no | PII | yes | The contact's job title. |
| `contacts[].phone` | `string | null | undefined` | no | PII | yes | Phone number in E.164 format. |
| `contacts[].email` | `string | null | undefined` | no | PII | yes | Email address. |
| `contacts[].type` | `"primary" | "billing" | "technical" | "operations" | "other" | undefined` | no | PII | yes |  |
| `contacts[].isPrimary` | `boolean` | yes | PII | yes | Whether this is the primary entry of its list. |
| `contacts[].notifyBy` | `"email" | "sms" | "both" | "none" | undefined` | no | PII | yes | How this contact wants to be notified. |
| `contacts[].isActive` | `boolean` | yes | PII | yes | Whether the record is active (inactive records are kept, not deleted). |
| `contacts[].createdAt` | `string | undefined` | no | PII | yes | Time the record was created (ISO-8601). |
| `contacts[].updatedAt` | `string | undefined` | no | PII | yes | Time the record was last changed (ISO-8601). |
| `contacts[].createdBy` | `string | undefined` | no | PII | yes | Firebase Auth uid of the user who created the record. |
| `contacts[].updatedBy` | `string | undefined` | no | PII | yes | Firebase Auth uid of the user who last changed the record. |
| `address.id` | `string` | yes | PII | no | Id of this item, unique within its list. |
| `address.line1` | `string` | yes | PII | no | First address line. |
| `address.city` | `string` | yes | PII | no | City. |
| `address.state` | `string` | yes | PII | no | State or province. |
| `address.postalCode` | `string` | yes | PII | no | Postal or PIN code. |
| `address.country` | `string` | yes | PII | no | ISO 3166-1 alpha-2 country code of the address. |
| `address.label` | `string | undefined` | no | PII | no | Label of the address (Head office, Warehouse, …). |
| `address.line2` | `string | undefined` | no | PII | no | Second address line. |
| `address.area` | `string | undefined` | no | PII | no | Area or locality. |
| `address.geoPoint.latitude` | `number` | yes | PII | no | Latitude in decimal degrees. |
| `address.geoPoint.longitude` | `number` | yes | PII | no | Longitude in decimal degrees. |
| `address.contactName` | `string | undefined` | no | PII | no | Person to contact at this address. |
| `address.phone` | `string | undefined` | no | PII | no | Phone number at this address (E.164). |
| `address.isDefaultBilling` | `boolean | undefined` | no | PII | no | Whether this address is used for billing by default. |
| `address.isDefaultShipping` | `boolean | undefined` | no | PII | no | Whether this address is used for shipping by default. |
| `addresses[].id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `addresses[].line1` | `string` | yes | PII | yes | First address line. |
| `addresses[].city` | `string` | yes | PII | yes | City. |
| `addresses[].state` | `string` | yes | PII | yes | State or province. |
| `addresses[].postalCode` | `string` | yes | PII | yes | Postal or PIN code. |
| `addresses[].country` | `string` | yes | PII | yes | ISO 3166-1 alpha-2 country code of the address. |
| `addresses[].label` | `string | undefined` | no | PII | yes | Label of the address (Head office, Warehouse, …). |
| `addresses[].line2` | `string | undefined` | no | PII | yes | Second address line. |
| `addresses[].area` | `string | undefined` | no | PII | yes | Area or locality. |
| `addresses[].geoPoint.latitude` | `number` | yes | PII | yes | Latitude in decimal degrees. |
| `addresses[].geoPoint.longitude` | `number` | yes | PII | yes | Longitude in decimal degrees. |
| `addresses[].contactName` | `string | undefined` | no | PII | yes | Person to contact at this address. |
| `addresses[].phone` | `string | undefined` | no | PII | yes | Phone number at this address (E.164). |
| `addresses[].isDefaultBilling` | `boolean | undefined` | no | PII | yes | Whether this address is used for billing by default. |
| `addresses[].isDefaultShipping` | `boolean | undefined` | no | PII | yes | Whether this address is used for shipping by default. |
| `bankAccounts[].id` | `string` | yes | sensitive | yes | Id of this item, unique within its list. |
| `bankAccounts[].accountHolderName` | `string` | yes | sensitive | yes | Name on the bank account. |
| `bankAccounts[].bankName` | `string` | yes | sensitive | yes | Name of the bank. |
| `bankAccounts[].accountNumber` | `string` | yes | sensitive | yes | Bank account number. |
| `bankAccounts[].label` | `string | undefined` | no | sensitive | yes | Label of the bank account. |
| `bankAccounts[].routingType` | `"other" | "ifsc" | "iban" | "swift" | "us_routing" | "sg_code" | undefined` | no | sensitive | yes | Kind of routing code (IFSC, IBAN, SWIFT, US routing, other). |
| `bankAccounts[].routingCode` | `string | undefined` | no | sensitive | yes | Routing code of the bank branch, of the kind given by routingType. |
| `bankAccounts[].upiId` | `string | undefined` | no | sensitive | yes | UPI id for payments to this account. |
| `bankAccounts[].currency` | `string | undefined` | no | sensitive | yes | ISO 4217 currency of the account. |
| `bankAccounts[].isDefault` | `boolean | undefined` | no | sensitive | yes | Whether this is the default entry of its list. |
| `bankAccounts[].showOnInvoice` | `boolean | undefined` | no | sensitive | yes | Whether the account is printed on invoices. |
| `bankAccounts[].status` | `"active" | "archived" | undefined` | no | sensitive | yes | Whether the account is active or archived. |
| `settings.approvals.enabled` | `boolean` | yes | public | yes | Whether maker-checker approvals are on. |
| `settings.approvals.modules` | `Partial<Record<"sale" | "purchase" | "expense" | "return" | "stock_adjustment", boolean>>` | no | public | no | Which document kinds need approval. |
| `settings.approvals.amountThreshold` | `number | undefined` | no | public | yes | Only documents at/above this total need approval (0 = all) |
| `settings.businessConfig.defaultUnits[]` | `string` | yes | public | yes | Units offered by default for new products. |
| `settings.businessConfig.productFields` | `Partial<Record<"expiry" | "batch" | "serial" | "variants" | "alternateUnits" | "jewellery", boolean>>` | no | public | no | Which optional product fields the business uses. |
| `settings.businessConfig.salesMode` | `SalesMode | undefined` | no | public | yes | How sales are made by default (POS, invoice, …). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `addresses[]`
- `bankAccounts[]`
- `moduleToggles.billing`
- `moduleToggles.inventory`
- `moduleToggles.reports`
- `moduleToggles.sales`
- `moduleToggles.staff`
- `moduleToggles.tasks`
- `settings.approvals.modules.expense`
- `settings.approvals.modules.purchase`
- `settings.approvals.modules.return`
- `settings.approvals.modules.sale`
- `settings.approvals.modules.stock_adjustment`
- `settings.businessConfig.productFields.alternateUnits`
- `settings.businessConfig.productFields.batch`
- `settings.businessConfig.productFields.expiry`
- `settings.businessConfig.productFields.jewellery`
- `settings.businessConfig.productFields.serial`
- `settings.businessConfig.productFields.variants`
- `usageLimitOverrides.firestoreReads.dailyLimit`
- `usageLimitOverrides.firestoreReads.enabled`
- `usageLimitOverrides.firestoreReads.enforcementMode`
- `usageLimitOverrides.firestoreReads.hardThresholdPercent`
- `usageLimitOverrides.firestoreReads.monthlyLimit`
- `usageLimitOverrides.firestoreReads.warningThresholdPercent`
- `usageLimitOverrides.firestoreWrites.dailyLimit`
- `usageLimitOverrides.firestoreWrites.enabled`
- `usageLimitOverrides.firestoreWrites.enforcementMode`
- `usageLimitOverrides.firestoreWrites.hardThresholdPercent`
- `usageLimitOverrides.firestoreWrites.monthlyLimit`
- `usageLimitOverrides.firestoreWrites.warningThresholdPercent`
- `usageLimitOverrides.firestoreWrites.weeklyLimit`
- `usageLimitOverrides.functionsInvocations.dailyLimit`
- `usageLimitOverrides.functionsInvocations.enabled`
- `usageLimitOverrides.functionsInvocations.enforcementMode`
- `usageLimitOverrides.functionsInvocations.hardThresholdPercent`
- `usageLimitOverrides.functionsInvocations.monthlyLimit`
- `usageLimitOverrides.functionsInvocations.warningThresholdPercent`
- `usageLimitOverrides.k1.dailyLimit`
- `usageLimitOverrides.k1.enabled`
- `usageLimitOverrides.k1.enforcementMode`
- `usageLimitOverrides.k1.hardThresholdPercent`
- `usageLimitOverrides.k1.monthlyLimit`
- `usageLimitOverrides.k1.warningThresholdPercent`
- `usageLimitOverrides.k1.weeklyLimit`
- `usageLimitOverrides.locationPings.dailyLimit`
- `usageLimitOverrides.locationPings.enabled`
- `usageLimitOverrides.locationPings.enforcementMode`
- `usageLimitOverrides.locationPings.hardThresholdPercent`
- `usageLimitOverrides.locationPings.warningThresholdPercent`

## `outflows` (`OutflowDoc`)

Typed leaf paths: 70. Documents observed in the census: 34. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `outflowNumber` | `string` | yes | public | yes | e.g. "PUR-2026-000001" or "EXP-2026-000001" |
| `kind` | `OutflowKind` | yes | public | yes | purchase or expense |
| `status` | `OutflowStatus | "pending_approval" | "rejected"` | yes | public | yes | draft, confirmed, voided (approval state lives here) |
| `approvalNote` | `string | null | undefined` | no | public | no | Note recorded with the approval decision. |
| `requestedPaidAmount` | `number | undefined` | no | public | yes | Paid amount asked for in the approval request. |
| `requestedPaymentMethod` | `PaymentMethod | undefined` | no | public | yes | Payment method asked for in the approval request. |
| `docDate` | `string` | yes | public | yes | ISO 8601 date-time of the purchase/expense (not date only) |
| `payeeType` | `"other" | "vendor" | "employee" | undefined` | no | public | yes | Who is paid (vendor, employee or other). |
| `payeeMembershipId` | `string | null | undefined` | no | public | yes | Employee-linked expense (salary, advance, reimbursement) |
| `expenseCategoryId` | `string | null | undefined` | no | public | yes | Id of the expense category the outflow is booked under. |
| `billDiscountAmount` | `number | undefined` | no | public | yes | Discount applied to the whole document. |
| `attachmentPaths[]` | `string` | yes | public | no | Storage paths of files attached to the document. |
| `createdByMembershipId` | `string | null | undefined` | no | public | yes | Membership id of the member who created the record. |
| `vendorId` | `string | null | undefined` | no | public | yes | Reference to vendors/{vendorId} |
| `payee` | `string | undefined` | no | public | yes | Free-text counterparty only when there is no vendorId / payeeMembershipId |
| `recurringTemplateId` | `string | undefined` | no | public | yes | recurringExpenses/{templateId} that generated this expense |
| `invoiceNumber` | `string | undefined` | no | public | yes | External vendor invoice # |
| `dueDate` | `string | null | undefined` | no | public | yes | Date payment is due (YYYY-MM-DD). |
| `lines[].lineId` | `string` | yes | public | yes | Stable line id ("L1", …): returns, stock movements and price history reference it |
| `lines[].productId` | `string | null | undefined` | no | public | yes | Reference to products/{productId} (name/SKU hydrated at read time) |
| `lines[].itemName` | `string | undefined` | no | public | yes | Non-catalog lines only (no productId) |
| `lines[].categoryId` | `string | null | undefined` | no | public | yes | Non-catalog lines only: reference to categories/{categoryId} |
| `lines[].quantity` | `number` | yes | public | yes | Quantity in the line's unit. |
| `lines[].unit` | `string` | yes | public | yes | Unit of measure (piece, box, kg, …). |
| `lines[].unitPrice` | `number` | yes | public | yes | Price per unit. |
| `lines[].grossAmount` | `number` | yes | public | yes | Line amount before discount and tax. |
| `lines[].discountAmount` | `number` | yes | public | yes | Discount amount on the line. |
| `lines[].taxAmount` | `number` | yes | public | yes | Tax amount. |
| `lines[].lineTotal` | `number` | yes | public | yes | Line total after discount and tax. |
| `lines[].addToStock` | `boolean` | yes | public | yes | Whether the received quantity is added to stock. |
| `lines[].batch` | `string | null | undefined` | no | public | yes | Batch or lot number. |
| `lines[].expiryDate` | `string | null | undefined` | no | public | yes | Expiry date of the batch received on this line (YYYY-MM-DD). |
| `lines[].returnedQty` | `number | undefined` | no | public | yes | Quantity already returned from this line. |
| `lines[].conversionFactor` | `number | undefined` | no | public | yes | Base units per line unit, frozen at receipt |
| `lines[].baseQuantity` | `number | undefined` | no | public | yes | Good units added to stock, in base unit |
| `lines[].damagedQuantity` | `number | undefined` | no | public | yes | Damaged on receipt (line unit): billed, never stocked, written off |
| `lines[].damageReason` | `string | null | undefined` | no | public | yes | Why part of the received quantity was damaged. |
| `productIds[]` | `string` | yes | public | yes | Denormalized line product ids (array-contains queries: price history) |
| `subTotal` | `number` | yes | public | yes | Total of the lines before document-level discount and tax. |
| `discountTotal` | `number` | yes | public | yes | Total discount of the document. |
| `taxTotal` | `number` | yes | public | yes | Total tax of the document. |
| `totalAmount` | `number` | yes | public | yes | Total of the document in the currency's major unit. |
| `paidAmount` | `number` | yes | public | yes | Amount paid so far. |
| `balanceAmount` | `number` | yes | public | yes | Amount still to be paid. |
| `paymentStatus` | `PaymentStatus` | yes | public | yes | paid, pending, partial |
| `taxSnapshot.regime` | `string` | yes | public | yes | Tax regime applied (for example IN_GST). |
| `taxSnapshot.country` | `string` | yes | public | yes | Country whose tax rules were applied. |
| `taxSnapshot.taxRatePercent` | `number` | yes | public | yes | Tax rate in percent. |
| `taxSnapshot.taxAmount` | `number` | yes | public | yes | Tax amount. |
| `taxSnapshot.taxType` | `string` | yes | public | yes | Kind of tax applied. |
| `taxSnapshot.isRegistered` | `boolean` | yes | public | yes | Whether the seller is tax-registered. |
| `taxSnapshot.registrationNumber` | `string | undefined` | no | public | no | Seller's tax registration number. |
| `taxSnapshot.labels.taxName` | `string` | yes | public | yes | Name of the tax as printed (GST, VAT, …). |
| `taxSnapshot.labels.registrationLabel` | `string` | yes | public | yes | Label of the tax registration number as printed (GSTIN, VAT No., …). |
| `taxSnapshot.labels.invoiceTitle` | `string` | yes | public | yes | Title printed on the invoice. |
| `notes` | `string | undefined` | no | public | yes | Free-text notes. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |
| `approvedAt` | `string | undefined` | no | public | no | Time the record was approved (ISO-8601). |
| `approvedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the approver. |
| `rejectedAt` | `string | undefined` | no | public | yes | Time the record was rejected (ISO-8601). |
| `rejectedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who rejected it. |
| `approvalReason` | `string | null | undefined` | no | public | yes | Reason the approver gave. |
| `voidedAt` | `string | undefined` | no | public | yes | Time the document was voided (ISO-8601). |
| `voidedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who voided the document. |
| `voidReason` | `string | undefined` | no | public | yes | Reason the document was voided. |

## `payments` (`PaymentDoc`)

Typed leaf paths: 30. Documents observed in the census: 50. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `paymentNumber` | `string` | yes | public | yes | e.g. "PAY-2026-000001" |
| `direction` | `PaymentDirection` | yes | public | yes | in (collection from customer) or out (payment to vendor) |
| `partyType` | `PartyType` | yes | public | yes | customer or vendor |
| `partyId` | `string | null | undefined` | no | public | yes | ID reference to customer or vendor |
| `partyName` | `string | undefined` | no | public | yes | Only for a standalone payment with no partyId and no referenceId (owned free text) |
| `amount` | `number` | yes | public | yes | Amount in the currency's major unit. |
| `method` | `PaymentMethod` | yes | public | yes |  |
| `referenceId` | `string | null | undefined` | no | public | yes | billId or outflowId (ID reference only!) |
| `referenceModel` | `"bill" | "outflow" | null | undefined` | no | public | yes | Kind of document the entry refers to. |
| `notes` | `string | undefined` | no | public | yes | Free-text notes. |
| `gateway.externalReference` | `string | undefined` | no | public | yes |  |
| `gateway.gatewayProvider` | `string | undefined` | no | public | yes |  |
| `gateway.gatewayStatus` | `"failed" | "refunded" | "initiated" | "authorized" | "captured" | undefined` | no | public | no |  |
| `gateway.cardBrand` | `string | undefined` | no | public | no |  |
| `gateway.cardLast4` | `string | undefined` | no | public | no |  |
| `status` | `"voided" | "completed"` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |
| `approvedAt` | `string | undefined` | no | public | no | Time the record was approved (ISO-8601). |
| `approvedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the approver. |
| `rejectedAt` | `string | undefined` | no | public | no | Time the record was rejected (ISO-8601). |
| `rejectedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who rejected it. |
| `approvalReason` | `string | null | undefined` | no | public | no | Reason the approver gave. |
| `voidedAt` | `string | undefined` | no | public | yes | Time the document was voided (ISO-8601). |
| `voidedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who voided the document. |
| `voidReason` | `string | undefined` | no | public | yes | Reason the document was voided. |

## `permissionCatalog` (`PermissionCatalogDoc`)

Typed leaf paths: 4. Documents observed in the census: 115. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `code` | `string` | yes | public | yes | Short code of the record, as shown in the app. |
| `description` | `string` | yes | public | yes | Free-text description. |
| `module` | `string` | yes | public | yes |  |
| `isSystem` | `boolean` | yes | public | yes | Whether the record is built in (system-defined) rather than created by an organization. |

## `platformCostReconciliation` — no document interface

Typed leaf paths: 0. Documents observed in the census: 0. Stored but untyped paths: 0.

## `products` (`ProductDoc`)

Typed leaf paths: 68. Documents observed in the census: 67. Stored but untyped paths: 4.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Tenant reference |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `nameKey` | `string` | yes | public | yes | Lower-case trimmed for uniqueness search |
| `description` | `string | undefined` | no | public | yes | Free-text description. |
| `categoryId` | `string | null | undefined` | no | public | yes | Reference to categories/{categoryId} |
| `baseUnit` | `string` | yes | public | yes | Code e.g. "piece", "kg", "box" |
| `sellingPrice` | `number` | yes | public | yes | Default selling price per unit. |
| `costPrice` | `number` | yes | public | yes | Purchase cost per unit. |
| `weightedAverageCost` | `number | undefined` | no | public | yes | Maintained weighted-average cost for valuation & COGS |
| `mrp` | `number | null | undefined` | no | public | yes | Maximum retail price printed on the product. |
| `wholesalePrice` | `number | null | undefined` | no | public | yes | Selling price per unit for wholesale. |
| `taxInclusive` | `boolean` | yes | public | yes | Whether prices include tax. |
| `isTaxable` | `boolean | undefined` | no | public | yes | Whether tax applies to the product. |
| `taxExemptionReason` | `string | undefined` | no | public | yes | Why the product is exempt from tax. |
| `taxRatePercent` | `number | undefined` | no | public | yes | e.g. 5, 12, 18 |
| `taxCode` | `string | undefined` | no | public | yes | HSN/SAC code |
| `barcode` | `string | null | undefined` | no | public | yes | Barcode of the product. |
| `sku` | `string | null | undefined` | no | public | yes | Stock-keeping unit code. |
| `hasExpiry` | `boolean` | yes | public | yes | Confirmed canonical name |
| `trackStock` | `boolean` | yes | public | yes | Whether stock is tracked for the product. |
| `currentStock` | `number` | yes | public | yes | Maintained aggregate stock total |
| `lowStockThreshold` | `number` | yes | public | yes | Stock level at which the product counts as low on stock. |
| `trackBatch` | `boolean | undefined` | no | public | yes | Whether stock is tracked per batch. |
| `trackSerial` | `boolean | undefined` | no | public | yes | Whether every unit has its own serial number. |
| `hasVariants` | `boolean | undefined` | no | public | yes | Whether the product has variants (size, colour, …). |
| `isPurchaseOnly` | `boolean | undefined` | no | public | yes | Whether the product is only purchased, never sold. |
| `isExpenseOnly` | `boolean | undefined` | no | public | yes | Whether the item is booked only as an expense. |
| `isSaleOnly` | `boolean | undefined` | no | public | yes | Whether the product is only sold, never purchased. |
| `brand` | `string | undefined` | no | public | yes | Brand name. |
| `alternateUnits[].unit` | `string` | yes | public | yes | Unit of measure (piece, box, kg, …). |
| `alternateUnits[].factor` | `number` | yes | public | yes | base units per one of this unit |
| `alternateUnits[].sellingPrice` | `number | undefined` | no | public | yes | Default selling price per unit. |
| `alternateUnits[].wholesalePrice` | `number | undefined` | no | public | yes | Selling price per unit for wholesale. |
| `alternateUnits[].barcode` | `string | undefined` | no | public | yes | Barcode of the product. |
| `alternateUnits[].isPurchaseUnit` | `boolean | undefined` | no | public | yes | Whether the product can be purchased in this unit. |
| `alternateUnits[].isSaleUnit` | `boolean | undefined` | no | public | yes | Whether the product can be sold in this unit. |
| `isDiscountable` | `boolean | undefined` | no | public | yes | Whether discounts may be given on the product. |
| `maxDiscountPercent` | `number | undefined` | no | public | yes | Billing rejects higher line discounts without bill:approve |
| `isReturnable` | `boolean | undefined` | no | public | yes | Default true; returnsCreate rejects non-returnable lines |
| `returnWindowDays` | `number | undefined` | no | public | yes | Sales returns allowed within N days of the bill |
| `reorderLevel` | `number | undefined` | no | public | yes | Stock level at which the product should be reordered. |
| `maxStockLevel` | `number | undefined` | no | public | yes | Highest stock level to keep. |
| `weight.value` | `number` | yes | public | yes | Weight, in the weight's unit. |
| `weight.unit` | `string` | yes | public | yes | Unit of measure (piece, box, kg, …). |
| `dimensions.length` | `number | undefined` | no | public | yes | Length, in the dimensions' unit. |
| `dimensions.width` | `number | undefined` | no | public | yes | Width, in the dimensions' unit. |
| `dimensions.height` | `number | undefined` | no | public | yes | Height, in the dimensions' unit. |
| `dimensions.unit` | `string` | yes | public | yes | Unit of measure (piece, box, kg, …). |
| `size` | `string | undefined` | no | public | yes | Size label of the product. |
| `imagePaths[]` | `string` | yes | public | yes | Cloud Storage object paths (see storage.rules size/MIME limits) |
| `warrantyMonths` | `number | undefined` | no | public | yes | Warranty period in months. |
| `jewellery.grossWeightGrams` | `number | undefined` | no | public | yes | Gross weight in grams. |
| `jewellery.netWeightGrams` | `number | undefined` | no | public | yes | Net (metal) weight in grams. |
| `jewellery.purity` | `string | undefined` | no | public | yes | Metal purity (for example 22K). |
| `jewellery.makingCharge` | `number | undefined` | no | public | yes | Making charge, in the unit given by makingChargeType. |
| `jewellery.makingChargeType` | `"per_gram" | "flat" | "percent" | undefined` | no | public | yes | How the making charge is applied (flat, per gram, percent). |
| `jewellery.hallmarkId` | `string | undefined` | no | public | yes | Hallmark identification number. |
| `jewellery.priceByDailyRate` | `boolean | undefined` | no | public | yes | Whether the price follows the day's metal rate. |
| `variantGroupId` | `string | null | undefined` | no | public | yes | Variant model: each sellable variant is its own product (own SKU/stock/price) sharing a group id. |
| `variantAttributes` | `Record<string, string>` | no | public | no | Variant attribute values of this product (attribute → value). |
| `visibilityScope` | `"all_branches" | "selected_branches" | "branch_only" | undefined` | no | public | yes | Which branches can see the record. |
| `sharedForBranchIds[]` | `string` | yes | public | yes | Branches the record is shared with when visibility is limited to selected branches. |
| `ownerBranchId` | `string | undefined` | no | public | yes | Branch that created the product (used by branch_only scope) |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `variantAttributes.colour`
- `variantAttributes.k1`
- `variantAttributes.size`
- `variantAttributes.storage`

## `recurringExpenses` (`RecurringExpenseDoc`)

Typed leaf paths: 35. Documents observed in the census: 3. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `endOn` | `string | null | undefined` | no | public | yes |  |
| `nextRunOn` | `string` | yes | public | yes | calendar date (organization timezone) of the next generation |
| `lastGeneratedPeriod` | `string | undefined` | no | public | yes | YYYY-MM (monthly) or YYYY-MM-DD (weekly) |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `createdByMembershipId` | `string | null` | no | public | yes | Membership id of the member who created the record. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `vendorId` | `string | undefined` | no | public | yes | Id of the vendor (supplier). |
| `payee` | `string | undefined` | no | public | yes |  |
| `payeeType` | `"other" | "vendor" | "employee" | undefined` | no | public | yes | Who is paid (vendor, employee or other). |
| `payeeMembershipId` | `string | undefined` | no | public | yes |  |
| `expenseCategoryId` | `string | undefined` | no | public | yes | Id of the expense category the outflow is booked under. |
| `lines[].quantity` | `number` | yes | public | yes | Quantity in the line's unit. |
| `lines[].unit` | `string` | yes | public | yes | Unit of measure (piece, box, kg, …). |
| `lines[].unitPrice` | `number` | yes | public | yes | Price per unit. |
| `lines[].productId` | `string | null | undefined` | no | public | no | Id of the product. |
| `lines[].itemName` | `string | undefined` | no | public | yes |  |
| `lines[].categoryId` | `string | null | undefined` | no | public | yes | Id of the category. |
| `lines[].discountAmount` | `number | undefined` | no | public | yes | Discount amount on the line. |
| `lines[].taxPercent` | `number | undefined` | no | public | yes |  |
| `lines[].addToStock` | `boolean | undefined` | no | public | yes | Whether the received quantity is added to stock. |
| `lines[].batch` | `string | undefined` | no | public | yes | Batch or lot number. |
| `lines[].expiryDate` | `string | undefined` | no | public | yes | Expiry date of the batch received on this line (YYYY-MM-DD). |
| `lines[].damagedQuantity` | `number | undefined` | no | public | yes |  |
| `lines[].damageReason` | `string | undefined` | no | public | yes | Why part of the received quantity was damaged. |
| `lines[].serialNumbers[]` | `string` | yes | public | yes | IMEI / frame numbers |
| `frequency` | `"monthly" | "weekly"` | yes | public | yes |  |
| `dayOfMonth` | `number | undefined` | no | public | yes | monthly (1–28: exists every month) |
| `weekday` | `number | undefined` | no | public | yes | weekly, ISO 1 = Monday |
| `startOn` | `string` | yes | public | yes |  |

## `returns` (`ReturnDoc`)

Typed leaf paths: 38. Documents observed in the census: 8. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `returnNumber` | `string` | yes | public | yes | e.g. "RET-2026-000001" |
| `returnType` | `ReturnType` | yes | public | yes | sales_return or purchase_return |
| `referenceId` | `string` | yes | public | yes | billId or outflowId (ID reference only!) |
| `partyId` | `string | null | undefined` | no | public | yes | Derived from the referenced document (customerId / vendorId) for statements |
| `items[].sourceLineId` | `string` | yes | public | yes | lineId on the referenced bill/purchase: price and cost come from that line by reference |
| `items[].productId` | `string` | yes | public | yes | Reference to products/{productId} |
| `items[].quantity` | `number` | yes | public | yes | In the source line's unit |
| `items[].baseQuantity` | `number` | yes | public | yes | quantity × the source line's frozen conversionFactor (stock unit) |
| `items[].refundAmount` | `number` | yes | public | yes | Amount refunded for the line. |
| `items[].reason` | `string` | yes | public | yes | Reason code or text explaining the outcome. |
| `items[].disposition` | `ReturnDisposition` | yes | public | yes | restocked_to_inventory | wasted_discarded |
| `totalRefundAmount` | `number` | yes | public | yes | Total amount refunded for the return. |
| `refundMethod` | `string` | yes | public | yes | cash, credit_note, original_payment |
| `status` | `"pending_approval" | "rejected" | "voided" | "completed"` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `requestedItems[].productId` | `string` | yes | public | no | Id of the product. |
| `requestedItems[].sourceLineId` | `string | undefined` | no | public | no | Id of the line, in the original document, being returned. |
| `requestedItems[].quantity` | `number` | yes | public | no | Quantity in the line's unit. |
| `requestedItems[].refundAmount` | `number` | yes | public | no | Amount refunded for the line. |
| `requestedItems[].reason` | `string` | yes | public | no | Reason code or text explaining the outcome. |
| `requestedItems[].disposition` | `ReturnDisposition` | yes | public | no |  |
| `requestedItems[].serialNumbers[]` | `string` | yes | public | no |  |
| `approvalNote` | `string | null | undefined` | no | public | no | Note recorded with the approval decision. |
| `notes` | `string | undefined` | no | public | yes | Free-text notes. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `createdByMembershipId` | `string | null | undefined` | no | public | yes | Membership id of the member who created the record. |
| `updatedAt` | `string | undefined` | no | public | no | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |
| `approvedAt` | `string | undefined` | no | public | yes | Time the record was approved (ISO-8601). |
| `approvedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the approver. |
| `rejectedAt` | `string | undefined` | no | public | no | Time the record was rejected (ISO-8601). |
| `rejectedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who rejected it. |
| `approvalReason` | `string | null | undefined` | no | public | yes | Reason the approver gave. |
| `voidedAt` | `string | undefined` | no | public | no | Time the document was voided (ISO-8601). |
| `voidedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who voided the document. |
| `voidReason` | `string | undefined` | no | public | no | Reason the document was voided. |

## `roles` (`RoleDoc`)

Typed leaf paths: 10. Documents observed in the census: 10. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string | null` | no | public | yes | Null for system/platform roles |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `code` | `string` | yes | public | yes | Short code of the record, as shown in the app. |
| `permissions[]` | `string` | yes | public | yes | Canonical permission catalog codes |
| `isSystem` | `boolean` | yes | public | yes | Whether the record is built in (system-defined) rather than created by an organization. |
| `description` | `string` | yes | public | yes | Free-text description. |
| `createdAt` | `string | undefined` | no | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `serials` (`SerialDoc`)

Typed leaf paths: 15. Documents observed in the census: 11. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `serial` | `string` | yes | public | yes | normalized (upper-case, no spaces); also the document id suffix |
| `productId` | `string` | yes | public | yes | Id of the product. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `status` | `"pending_receipt" | "in_stock" | "reserved" | "sold" | "returned" | "damaged" | "vendor_returned"` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `receivedOutflowId` | `string | undefined` | no | public | yes |  |
| `receivedLineId` | `string | undefined` | no | public | yes |  |
| `holdBillId` | `string | null | undefined` | no | public | yes |  |
| `holdLineId` | `string | null | undefined` | no | public | yes |  |
| `soldBillId` | `string | null | undefined` | no | public | yes |  |
| `soldLineId` | `string | null | undefined` | no | public | yes |  |
| `returnId` | `string | undefined` | no | public | no | Id of the return. |
| `adjustmentId` | `string | undefined` | no | public | yes | correlates the units of one stock adjustment |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |

## `stockAdjustmentRequests` (`StockAdjustmentRequestDoc`)

Typed leaf paths: 23. Documents observed in the census: 2. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `productId` | `string` | yes | public | yes | Id of the product. |
| `quantity` | `number` | yes | public | yes | signed, base unit |
| `reason` | `string` | yes | public | yes | Reason code or text explaining the outcome. |
| `reasonCode` | `StockAdjustmentReason | undefined` | no | public | yes |  |
| `serialNumbers[]` | `string` | yes | public | no | owned request data for serial-tracked products |
| `status` | `"pending_approval" | "rejected" | "approved"` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `approvalNote` | `string | null | undefined` | no | public | yes | Note recorded with the approval decision. |
| `movementId` | `string | undefined` | no | public | yes |  |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `createdByMembershipId` | `string | null | undefined` | no | public | yes | Membership id of the member who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |
| `approvedAt` | `string | undefined` | no | public | yes | Time the record was approved (ISO-8601). |
| `approvedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the approver. |
| `rejectedAt` | `string | undefined` | no | public | yes | Time the record was rejected (ISO-8601). |
| `rejectedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who rejected it. |
| `approvalReason` | `string | null | undefined` | no | public | yes | Reason the approver gave. |
| `voidedAt` | `string | undefined` | no | public | no | Time the document was voided (ISO-8601). |
| `voidedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who voided the document. |
| `voidReason` | `string | undefined` | no | public | no | Reason the document was voided. |

## `stockBalances` (`StockBalanceDoc`)

Typed leaf paths: 7. Documents observed in the census: 51. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string` | yes | public | yes | Id of the branch the record belongs to or applies to. |
| `productId` | `string` | yes | public | yes | Id of the product. |
| `currentStock` | `number` | yes | public | yes | R3 cache of SUM(stockMovements.quantity) for (org, branch, product) |
| `allocatedStock` | `number | undefined` | no | public | yes | R3 cache of open sales-order reservations (available = current - allocated, computed) |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

## `stockMovements` (`StockMovementDoc`)

Typed leaf paths: 14. Documents observed in the census: 117. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `branchId` | `string | undefined` | no | public | yes | Id of the branch the record belongs to or applies to. |
| `productId` | `string` | yes | public | yes | Reference to products/{productId} |
| `type` | `StockMovementType` | yes | public | yes |  |
| `quantity` | `number` | yes | public | yes | Signed change in the product's BASE unit (+ addition, - reduction) |
| `balanceAfter` | `number` | yes | public | yes | Branch stock after this movement (R4 ledger running balance) |
| `referenceId` | `string` | yes | public | yes | ID reference to bill, outflow, return, or adjustment |
| `referenceModel` | `"return" | "bill" | "outflow" | "manual_adjustment"` | yes | public | yes | Kind of document the entry refers to. |
| `referenceLineId` | `string | undefined` | no | public | yes | Source line (bills.items[].lineId / outflows.lines[].lineId / return sourceLineId) |
| `reason` | `string | null | undefined` | no | public | yes | Reason code or text explaining the outcome. |
| `reasonCode` | `StockAdjustmentReason | null | undefined` | no | public | yes | Write-off classification for adjustments |
| `unitCostSnapshot` | `number | undefined` | no | public | yes | Cost per base unit at movement time (values write-offs) |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |

## `subscriptionPlans` (`SubscriptionPlanDoc`)

Typed leaf paths: 16. Documents observed in the census: 12. Stored but untyped paths: 16.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `price` | `number` | yes | public | yes | Plan price per billing period. |
| `currency` | `string` | yes | public | yes | ISO 4217 currency code. |
| `storageLimitMb` | `number` | yes | public | yes | Storage included in the plan, in MB. |
| `monthlyDocumentVolumeLimit` | `number` | yes | public | yes | Documents the plan allows per month. |
| `seatLimits.admin` | `number` | yes | public | yes | Number of admin seats in the plan. |
| `seatLimits.staff` | `number` | yes | public | yes | Number of staff seats in the plan. |
| `moduleFlags` | `Record<string, boolean>` | yes | public | no | Modules included in the plan (module → included). |
| `branchLimit` | `number | undefined` | no | public | yes | Number of active branches the plan allows. |
| `usageLimits` | `Partial<Record<keyof ServiceUsageCounts, MetricLimitConfig>>` | no | public | no | Plan baseline usage thresholds & limits |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `isArchived` | `boolean | undefined` | no | public | yes | set by the plan archive callable; archived plans cannot be assigned |
| `createdAt` | `string | undefined` | no | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `moduleFlags.analytics`
- `moduleFlags.billing`
- `moduleFlags.customers`
- `moduleFlags.deliveries`
- `moduleFlags.delivery`
- `moduleFlags.employee_tracking`
- `moduleFlags.expenses`
- `moduleFlags.inventory`
- `moduleFlags.k1`
- `moduleFlags.liveLocation`
- `moduleFlags.purchases`
- `moduleFlags.reports`
- `moduleFlags.returns`
- `moduleFlags.sales`
- `moduleFlags.staff`
- `moduleFlags.tasks`

## `tasks` (`TaskDoc`)

Typed leaf paths: 16. Documents observed in the census: 2. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Tenant reference |
| `title` | `string` | yes | public | yes | Short title. |
| `description` | `string | undefined` | no | public | yes | Free-text description. |
| `assignedToMembershipId` | `string` | yes | public | yes | Reference to memberships/{uid}_{orgId} |
| `assignedByMembershipId` | `string` | yes | public | yes | Reference to memberships/{uid}_{orgId} |
| `status` | `TaskStatus` | yes | public | yes | Lifecycle status of the record (values: the field's enum). |
| `priority` | `TaskPriority` | yes | public | yes | Task priority. |
| `dueAt` | `string | undefined` | no | public | yes | ISO 8601 string |
| `relatedEntityType` | `TaskRelatedEntityType | null | undefined` | no | public | yes | Kind of record the task is about. |
| `relatedEntityId` | `string | null | undefined` | no | public | yes | ID-only reference |
| `completedAt` | `string | null | undefined` | no | public | yes | Time the task was completed (ISO-8601). |
| `completedByMembershipId` | `string | null | undefined` | no | public | yes | Membership id of the member who completed the task. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `taxRegimes` (`TaxRegimeDoc`)

Typed leaf paths: 5. Documents observed in the census: 7. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `code` | `string` | yes | public | yes | Short code of the record, as shown in the app. |
| `country` | `string` | yes | public | yes | ISO 3166-1 alpha-2 country code. |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `description` | `string` | yes | public | yes | Free-text description. |
| `isDefault` | `boolean` | yes | public | yes | Whether this is the default entry of its list. |

## `teams` (`TeamDoc`)

Typed leaf paths: 9. Documents observed in the census: 6. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Reference to organizations/{organizationId} |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `description` | `string | undefined` | no | public | yes | Free-text description. |
| `leaderMembershipId` | `string | null | undefined` | no | public | yes | Team leader / manager (memberships/{id}) |
| `isActive` | `boolean | undefined` | no | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string | undefined` | no | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

## `uniqueKeys` (`UniqueKeyDoc`)

Typed leaf paths: 5. Documents observed in the census: 186. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `kind` | `string` | yes | public | yes | UniqueKeyKind (services/uniqueKeys.ts) |
| `entityType` | `string` | yes | public | yes | Kind of record the entry refers to (organization, product, bill, …). |
| `entityId` | `string` | yes | public | yes | Id of the record the entry refers to. |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |

## `units` (`UnitDoc`)

Typed leaf paths: 12. Documents observed in the census: 7. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string | null` | no | public | yes | Null for system units |
| `name` | `string` | yes | PII | yes | e.g. "Kilogram", "Piece", "Liter" |
| `code` | `string` | yes | public | yes | e.g. "kg", "pcs", "ltr" |
| `group` | `UnitGroup` | yes | public | yes | count, weight, volume, length, area, time |
| `precision` | `number` | yes | public | yes | 0-4 |
| `baseUnit` | `string | null | undefined` | no | public | yes | Reference code if derived |
| `conversionFactor` | `number | undefined` | no | public | yes | Relative to baseUnit |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | no | Firebase Auth uid of the user who last changed the record. |

## `usageCounterShards` (`UsageCounterShardDoc`)

Typed leaf paths: 6. Documents observed in the census: 271. Stored but untyped paths: 35.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `month` | `string` | yes | public | yes | YYYY-MM (organization timezone) |
| `shard` | `number` | yes | public | yes |  |
| `updatedAt` | `string` | yes | public | yes | Time the record was last changed (ISO-8601). |
| `days` | `Record<string, Partial<Record<MeteredMetric, number>>>` | yes | public | no | day (YYYY-MM-DD) → metric → count |
| `branches` | `Record<string, Record<string, Partial<Record<MeteredMetric, number>>>>` | no | public | no | branchId → day → metric → count |

Stored but untyped:

- `branches.3gHR6ErgaCDDwVzgpD86.2026-11-14.firestoreWrites`
- `branches.3gHR6ErgaCDDwVzgpD86.2026-11-14.functionsInvocations`
- `branches.5DMUBRFZa7imB9Uh5ONT.2026-11-14.firestoreWrites`
- `branches.5DMUBRFZa7imB9Uh5ONT.2026-11-14.functionsInvocations`
- `branches.MQLZTeQw5aNu24Eot3Pq.2026-11-14.firestoreReads`
- `branches.MQLZTeQw5aNu24Eot3Pq.2026-11-14.firestoreWrites`
- `branches.MQLZTeQw5aNu24Eot3Pq.2026-11-14.functionsInvocations`
- `branches.Q8RzvQYpgw4I4CpSzEJq.2026-11-14.firestoreReads`
- `branches.Q8RzvQYpgw4I4CpSzEJq.2026-11-14.firestoreWrites`
- `branches.Q8RzvQYpgw4I4CpSzEJq.2026-11-14.functionsInvocations`
- `branches.TDjFHkIWDmIz8anmxdXl.2026-11-14.firestoreWrites`
- `branches.TDjFHkIWDmIz8anmxdXl.2026-11-14.functionsInvocations`
- `branches.YKiCThG29MClKgQs8AJM.2026-11-14.firestoreWrites`
- `branches.YKiCThG29MClKgQs8AJM.2026-11-14.functionsInvocations`
- `branches.branch_warehouse.2026-11-14.firestoreWrites`
- `branches.branch_warehouse.2026-11-14.functionsInvocations`
- `branches.branchid-pr.2026-11-14.firestoreWrites`
- `branches.branchid-pr.2026-11-14.functionsInvocations`
- `branches.djrPNeqnotHu58ANK4UQ.2026-11-14.firestoreReads`
- `branches.djrPNeqnotHu58ANK4UQ.2026-11-14.firestoreWrites`
- `branches.djrPNeqnotHu58ANK4UQ.2026-11-14.functionsInvocations`
- `branches.djrPNeqnotHu58ANK4UQ.2026-11-14.locationPings`
- `branches.hkoWGO6TvpbFR4NPEWHQ.2026-11-14.firestoreReads`
- `branches.hkoWGO6TvpbFR4NPEWHQ.2026-11-14.functionsInvocations`
- `branches.main-branch.2026-11-14.firestoreReads`
- `branches.main-branch.2026-11-14.firestoreWrites`
- `branches.main-branch.2026-11-14.functionsInvocations`
- `branches.main-branch.2026-11-14.locationPings`
- `branches.nope-branch.2026-11-14.firestoreWrites`
- `branches.nope-branch.2026-11-14.functionsInvocations`
- `days.2026-11-14.firestoreReads`
- `days.2026-11-14.firestoreWrites`
- `days.2026-11-14.functionsInvocations`
- `days.2026-11-14.locationPings`
- `days.2026-11-14.storageUploadBytes`

## `usageRateCards` (`UsageRateCardDoc`)

Typed leaf paths: 22. Documents observed in the census: 0. Stored but untyped paths: 0.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `version` | `string` | yes | public | no |  |
| `effectiveDate` | `string` | yes | public | no |  |
| `currency` | `string` | yes | public | no | ISO 4217 currency code. |
| `rates.firestoreReadPer100k` | `number` | yes | public | no |  |
| `rates.firestoreWritePer100k` | `number` | yes | public | no |  |
| `rates.firestoreDeletePer100k` | `number` | yes | public | no |  |
| `rates.functionsInvocationPerMillion` | `number` | yes | public | no |  |
| `rates.functionsComputeGbSecond` | `number` | yes | public | no |  |
| `rates.storageGbMonth` | `number` | yes | public | no |  |
| `rates.fcmPerThousand` | `number` | yes | public | no |  |
| `rates.locationPingPer100k` | `number` | yes | public | no |  |
| `status` | `"active" | "draft" | "deprecated"` | yes | public | no | Lifecycle status of the record (values: the field's enum). |
| `createdAt` | `string` | yes | public | no | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | no | Firebase Auth uid of the user who created the record. |
| `verification` | `Partial<Record<"firestoreReadPer100k" | "firestoreWritePer100k" | "firestoreDeletePer100k" | "functionsInvocationPerMillion" | "functionsComputeGbSecond" | "storageGbMonth" | "fcmPerThousand" | "locationPingPer100k", { verified: boolean; source: string; verifiedAt: string | null; region?: string | undefined; }>>` | no | public | no | Per rate: where the price comes from and whether it was checked against the official pricing (prompt 66 §2.3). |
| `freeTier.firestoreReadsPerDay` | `number` | yes | public | no |  |
| `freeTier.firestoreWritesPerDay` | `number` | yes | public | no |  |
| `freeTier.firestoreDeletesPerDay` | `number` | yes | public | no |  |
| `freeTier.firestoreStoredGiB` | `number` | yes | public | no |  |
| `freeTier.egressGiBPerMonth` | `number` | yes | public | no |  |
| `freeTier.source` | `string` | yes | public | no | Whether the location was recorded with the app in the foreground or the background. |
| `freeTier.verifiedAt` | `string` | yes | public | no |  |

## `users` (`UserDoc`)

Typed leaf paths: 20. Documents observed in the census: 159. Stored but untyped paths: 1.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `nameParts.first` | `string` | yes | PII | no | First name. |
| `nameParts.last` | `string` | yes | PII | no | Last name. |
| `email` | `string` | yes | PII | yes | Email address. |
| `phone` | `string | null | undefined` | no | PII | yes | Phone number in E.164 format. |
| `accountType` | `"standard" | "admin" | "system"` | yes | public | yes | Kind of user account. |
| `image.path` | `string` | yes | public | no | Storage path of the processed image. |
| `image.contentType` | `"image/jpeg" | "image/png" | "image/webp"` | yes | public | no | MIME type of the stored image. |
| `image.width` | `number` | yes | public | no | Image width in pixels. |
| `image.height` | `number` | yes | public | no | Image height in pixels. |
| `image.sizeBytes` | `number` | yes | public | no | Size of the stored image in bytes. |
| `image.updatedAt` | `string` | yes | public | no | Time the image was attached (ISO-8601). |
| `image.thumbnailPath` | `string | undefined` | no | public | no | thumbnailPath: storage path of the smaller thumbnail asset (products only). |
| `primaryOrganizationId` | `string | undefined` | no | public | no | Id of the organization the user opens by default. |
| `mustChangePassword` | `boolean | undefined` | no | sensitive | yes | Whether the user must set a new password at next sign-in. |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string` | yes | public | yes | ISO 8601 |
| `createdBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `image`

## `vendors` (`VendorDoc`)

Typed leaf paths: 61. Documents observed in the census: 22. Stored but untyped paths: 4.

| Path | Type | Required | Sensitivity | Observed | Description |
|---|---|---|---|---|---|
| `organizationId` | `string` | yes | public | yes | Id of the organization (tenant) the record belongs to. |
| `vendorCode` | `string` | yes | public | yes | e.g. "VEND-000001" |
| `name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `legalName` | `string | null | undefined` | no | public | yes | Registered legal name. |
| `partyType` | `"organization" | "person" | undefined` | no | public | yes | Kind of party. |
| `image.path` | `string` | yes | public | no | Storage path of the processed image. |
| `image.contentType` | `"image/jpeg" | "image/png" | "image/webp"` | yes | public | no | MIME type of the stored image. |
| `image.width` | `number` | yes | public | no | Image width in pixels. |
| `image.height` | `number` | yes | public | no | Image height in pixels. |
| `image.sizeBytes` | `number` | yes | public | no | Size of the stored image in bytes. |
| `image.updatedAt` | `string` | yes | public | no | Time the image was attached (ISO-8601). |
| `image.thumbnailPath` | `string | undefined` | no | public | no | thumbnailPath: storage path of the smaller thumbnail asset (products only). |
| `phone` | `string | null | undefined` | no | PII | yes | Phone number in E.164 format. |
| `additionalPhones[]` | `string` | yes | PII | yes | Further phone numbers in E.164 format. |
| `email` | `string | null | undefined` | no | PII | yes | Email address. |
| `taxId` | `string | null | undefined` | no | PII | yes | Tax registration number (GSTIN, VAT number, …). |
| `addresses[].id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `addresses[].line1` | `string` | yes | PII | yes | First address line. |
| `addresses[].city` | `string` | yes | PII | yes | City. |
| `addresses[].state` | `string` | yes | PII | yes | State or province. |
| `addresses[].postalCode` | `string` | yes | PII | yes | Postal or PIN code. |
| `addresses[].country` | `string` | yes | PII | yes | ISO 3166-1 alpha-2 country code of the address. |
| `addresses[].label` | `string | undefined` | no | PII | yes | Label of the address (Head office, Warehouse, …). |
| `addresses[].line2` | `string | undefined` | no | PII | yes | Second address line. |
| `addresses[].area` | `string | undefined` | no | PII | yes | Area or locality. |
| `addresses[].geoPoint.latitude` | `number` | yes | PII | yes | Latitude in decimal degrees. |
| `addresses[].geoPoint.longitude` | `number` | yes | PII | yes | Longitude in decimal degrees. |
| `addresses[].contactName` | `string | undefined` | no | PII | yes | Person to contact at this address. |
| `addresses[].phone` | `string | undefined` | no | PII | yes | Phone number at this address (E.164). |
| `addresses[].isDefaultBilling` | `boolean | undefined` | no | PII | yes | Whether this address is used for billing by default. |
| `addresses[].isDefaultShipping` | `boolean | undefined` | no | PII | yes | Whether this address is used for shipping by default. |
| `bankAccounts[].id` | `string` | yes | sensitive | yes | Id of this item, unique within its list. |
| `bankAccounts[].accountHolderName` | `string` | yes | sensitive | yes | Name on the bank account. |
| `bankAccounts[].bankName` | `string` | yes | sensitive | yes | Name of the bank. |
| `bankAccounts[].accountNumber` | `string` | yes | sensitive | yes | Bank account number. |
| `bankAccounts[].label` | `string | undefined` | no | sensitive | yes | Label of the bank account. |
| `bankAccounts[].routingType` | `"other" | "ifsc" | "iban" | "swift" | "us_routing" | "sg_code" | undefined` | no | sensitive | yes | Kind of routing code (IFSC, IBAN, SWIFT, US routing, other). |
| `bankAccounts[].routingCode` | `string | undefined` | no | sensitive | yes | Routing code of the bank branch, of the kind given by routingType. |
| `bankAccounts[].upiId` | `string | undefined` | no | sensitive | yes | UPI id for payments to this account. |
| `bankAccounts[].currency` | `string | undefined` | no | sensitive | yes | ISO 4217 currency of the account. |
| `bankAccounts[].isDefault` | `boolean | undefined` | no | sensitive | yes | Whether this is the default entry of its list. |
| `bankAccounts[].showOnInvoice` | `boolean | undefined` | no | sensitive | yes | Whether the account is printed on invoices. |
| `bankAccounts[].status` | `"active" | "archived" | undefined` | no | sensitive | yes | Whether the account is active or archived. |
| `contacts[].id` | `string` | yes | PII | yes | Id of this item, unique within its list. |
| `contacts[].name` | `string` | yes | PII | yes | Human-readable name of this record. |
| `contacts[].designation` | `string | undefined` | no | PII | yes | The contact's job title. |
| `contacts[].phone` | `string | undefined` | no | PII | yes | Phone number in E.164 format. |
| `contacts[].email` | `string | undefined` | no | PII | yes | Email address. |
| `contacts[].whatsApp` | `string | undefined` | no | PII | yes | WhatsApp number in E.164 format. |
| `paymentTermsDays` | `number | undefined` | no | public | yes | Payment terms in days. |
| `creditLimit` | `number | undefined` | no | public | yes | Maximum outstanding balance allowed for the party. |
| `outstandingPayable` | `number` | yes | public | yes | Amount owed to vendor |
| `totalPurchase` | `number` | yes | public | yes | Total purchased from the vendor. |
| `visibilityScope` | `"all_branches" | "selected_branches" | "branch_only" | undefined` | no | public | yes | Branch visibility scope (default: all_branches) |
| `sharedForBranchIds[]` | `string` | yes | public | yes | Branch IDs allowed to access this vendor record |
| `isDefault` | `boolean` | yes | public | yes | Whether this is the default entry of its list. |
| `isActive` | `boolean` | yes | public | yes | Whether the record is active (inactive records are kept, not deleted). |
| `createdAt` | `string` | yes | public | yes | Time the record was created (ISO-8601). |
| `createdBy` | `string` | yes | public | yes | Firebase Auth uid of the user who created the record. |
| `updatedAt` | `string | undefined` | no | public | yes | Time the record was last changed (ISO-8601). |
| `updatedBy` | `string | undefined` | no | public | yes | Firebase Auth uid of the user who last changed the record. |

Stored but untyped:

- `addresses[]`
- `bankAccounts[]`
- `contacts[]`
- `image`

