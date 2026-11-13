# Trado API Contract Changes & Naming Consolidations (D-7)

**Generated**: 2026-11-10T19:05:56.477Z  
**Pre-Release Policy (D-7)**: In accordance with standing architectural decision D-7, renames and removals are applied **atomically with backend data migrations — zero compatibility aliases**. The Flutter mobile and web workspace adheres directly to these canonical names.

| Entity | Old Field Name | Canonical New Field | Callables Affected | Type | Data Migration & Flutter Guidance |
|---|---|---|---|---|---|
| **Customer** | `mobile` | `phone` | `customersCreate`, `customersUpdate`, `customersGet`, `customersList` | `string (E.164)` | Update CustomerModel JSON serialization: change json['mobile'] to json['phone']. |
| **Vendor** | `mobile` | `phone` | `vendorsCreate`, `vendorsUpdate`, `vendorsGet`, `vendorsList` | `string (E.164)` | Update VendorModel JSON serialization: change json['mobile'] to json['phone']. |
| **Vendor** | `taxNumber` | `taxId` | `vendorsCreate`, `vendorsUpdate`, `vendorsGet`, `vendorsList` | `string` | Update VendorModel: change json['taxNumber'] to json['taxId']. |
| **Branch** | `contact.mobile` | `contact.phone` | `branchesCreate`, `branchesUpdate`, `branchesGet`, `branchesList` | `string (E.164)` | Update BranchContact model: change json['mobile'] to json['phone']. |
| **Customer & Vendor** | `billingAddress / shippingAddress (flat string)` | `addresses: AddressSchema[]` | `customersCreate`, `customersUpdate`, `vendorsCreate`, `vendorsUpdate` | `AddressSchema array (bounded <= 20)` | Use shared AddressInput / AddressModel component. |
| **Organization** | `bankDetails (single inline object)` | `bankAccounts: BankAccountSchema[]` | `organizationsCreate`, `organizationsUpdate`, `organizationsGet` | `BankAccountSchema array (bounded <= 10)` | Use shared BankAccountModel and BankAccountList form widget. |

---

### Migration Verification

All data migrations run atomically during emulator seeding and test preparation. No legacy alias fields (`mobile`, `taxNumber`) are emitted in new API responses or accepted in `.strict()` Zod input schemas.
