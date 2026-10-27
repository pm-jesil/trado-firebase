# Trado Firebase Backend — Phase 2 Test Report

## 1. Test Execution Summary

All tests executed against the local Firebase Emulator Suite (`auth`, `firestore`, `storage`, `functions`) with zero live production side-effects.

```
========================================================================
                      PHASE 2 TEST VERIFICATION MATRIX
========================================================================
Test Suite                            Tests Run    Passed   Failed   Status
------------------------------------------------------------------------
Unit Tests (Core Engines & RBAC)             43        43        0   PASS ✓
Callable Integration Tests (Emulator)        32        32        0   PASS ✓
Firestore & Storage Security Rules Tests     14        14        0   PASS ✓
Anti-Embedding Source Static Checker          5         5        0   PASS ✓
Anti-Embedding Self-Test Guard                3         3        0   PASS ✓
Local Emulator Seed Tool Execution            8         8        0   PASS ✓
------------------------------------------------------------------------
TOTAL VERIFIED TESTS                        105       105        0   PASS ✓
========================================================================
```

---

## 2. Unit Test Evidence (43/43 Passed)

Command: `npm run test:unit --prefix functions`
Suites: 11 suites, 43 assertions, Duration: ~7.4s

* **Custom Claims Service (3/3 Passed)**:
  - `merges new claims into existing claims without overwriting unrelated fields`: PASS
  - `sets primaryOrganizationId claim as trusted tenant context`: PASS
  - `sets isSuperAdmin claim for platform administrators`: PASS
* **Provisioning Compensation Service (2/2 Passed)**:
  - `compensateAuthUser handles empty UID safely without crashing`: PASS
  - `handles non-existent user rollback gracefully reporting outcome`: PASS
* **Employee Multi-Org Deactivation Logic (2/2 Passed)**:
  - `preserves global user active status when user still belongs to other active organizations`: PASS
  - `deactivates global user profile when user has zero remaining active memberships`: PASS
* **Idempotency Service & Lease Expiry (6/6 Passed)**:
  - `canonicalizeJson sorts keys deterministically and ignores idempotencyKey & passwords`: PASS
  - `hashPayload produces identical SHA-256 for equivalent payloads with different key orders`: PASS
  - `hashPayload produces different hashes for different request data`: PASS
  - `deriveRecordId produces deterministic scoped document IDs`: PASS
  - `calculates lease expiration deadlines correctly and detects expired leases`: PASS
  - `proves recoveryChecker pattern resolves side-effect on expired lease without double execution`: PASS
* **Notification Sender Adapter (2/2 Passed)**:
  - `MockNotificationSender safely records dispatched messages without real FCM network calls`: PASS
  - `MockNotificationSender reset clears recorded message history`: PASS
* **Four-Layer Permission Resolver (13/13 Passed)**:
  - `correctly identifies the parent module for canonical permission codes`: PASS
  - `isModuleActive checks plan flags and org toggles correctly`: PASS
  - `Layer 1 (Plan): denies permission if module is disabled in subscription plan`: PASS
  - `Layer 2 (Organization): denies permission if module is toggled off by tenant`: PASS
  - `Layer 3 (Role): grants permission when granted by base role`: PASS
  - `Layer 3 (Role): denies permission when not present in base role`: PASS
  - `Layer 4 (Membership Override Grant): allows granting an extra capability to a user`: PASS
  - `Strict Deny Precedence: explicit false in membership overrides strictly denies role grant`: PASS
  - `Prefix Wildcard Deny: 'bill:*': false denies all billing permissions`: PASS
  - `Role Wildcard Matching: 'report:*' grants 'report:profit' and 'report:export'`: PASS
  - `Org Owner has access to all capabilities in active tenant modules`: PASS
  - `Org Owner cannot access platform:* capabilities`: PASS
  - `Super Admin bypasses all checks with unrestricted platform and tenant access`: PASS
* **Phase 2 Tax Calculation Engine (5/5 Passed)**:
  - `calculates standard India GST (18%) split into CGST (9%) and SGST (9%) for intra-state sales`: PASS
  - `calculates India GST (18%) as single IGST line for inter-state sales`: PASS
  - `calculates UAE VAT (5%) correctly`: PASS
  - `calculates US State Sales Tax (7%) correctly`: PASS
  - `handles NONE / exempt regime with zero tax and 'Bill of Supply' label`: PASS
* **Phase 2 Sequential Number Formatting (1/1 Passed)**:
  - `formats standard sequential document numbers with zero padding`: PASS
* **Phase 2 Stock Balance Arithmetic (2/2 Passed)**:
  - `computes correct running stock totals on inward intake and outward sales`: PASS
  - `detects when stock would drop below zero when negative stock is prohibited`: PASS
* **Phase 2 Decimal-Safe Money & Precision Utility (5/5 Passed)**:
  - `handles 2-decimal currencies (INR, USD, EUR) with commercial rounding`: PASS
  - `handles 3-decimal currencies (BHD, KWD, OMR) accurately without truncating the 3rd decimal`: PASS
  - `handles 0-decimal currencies (JPY, KRW) accurately`: PASS
  - `prevents floating point drift across 1,000 fractional quantity increments (0.001 kg)`: PASS
  - `extractTax and addTax produce mathematically exact components`: PASS
* **Seed Tooling Safety Guard (2/2 Passed)**:
  - `safety check prevents running against production when FIRESTORE_EMULATOR_HOST is missing`: PASS
  - `safety check allows running only when emulator host is explicitly configured`: PASS

---

## 3. Callable Integration Test Evidence (32/32 Passed)

Command: `firebase emulators:exec --only auth,firestore,functions "node functions/scripts/test-callables-integration.js"`

### Phase 1 Regression & Closeout Tests
1. `organizationsCreate rejects unauthenticated call with 401 UNAUTHENTICATED`: PASS ✓
2. `organizationsCreate rejects non-superadmin caller with 403 PERMISSION_DENIED`: PASS ✓
3. `organizationsCreate provisions org + sets primaryOrganizationId claim + commits batch atomically`: PASS ✓
4. `organizationsCreate replayed with identical idempotencyKey returns cached duplicate result`: PASS ✓
5. `Part 7: concurrent calls with identical idempotencyKey create exactly ONE organization`: PASS ✓
6. `employeesCreate allows Org Owner to provision an Admin`: PASS ✓
7. `Part 4: Tenant Admin is rejected when attempting to create custom role (Owner-only)`: PASS ✓
8. `Part 4: Tenant Admin is rejected when attempting to modify structural org settings`: PASS ✓
9. `Part 4: Org Owner can successfully modify structural org settings`: PASS ✓
10. `employeesCreate prevents Admin from provisioning an Org Owner`: PASS ✓
11. `employeesCreate prevents Admin from provisioning a peer Admin`: PASS ✓
12. `employeesCreate denies cross-tenant provisioning into unauthorized organization`: PASS ✓
13. `authMe returns activeContext, role, and resolved permissions for Org Owner`: PASS ✓
14. `authMe returns isSuperAdmin flag for Platform Administrator`: PASS ✓
15. `Part 9: employeesDeactivate preserves user isActive when active membership exists in another org`: PASS ✓

### Phase 2 Operational Core Tests
16. `Part 0: employeesCreate defaults to role_employee when roleId is omitted`: PASS ✓
17. `Part 0: idempotency lease-expiry recovers stuck PROCESSING slot rather than permanently blocking`: PASS ✓
18. `productsCreate creates catalog product with maintained currentStock and movement record`: PASS ✓
19. `customersCreate auto-generates customerCode and saves profile`: PASS ✓
20. `vendorsCreate auto-generates vendorCode and saves profile`: PASS ✓
21. `outflowsCreate (kind=purchase) transactionally increments product currentStock`: PASS ✓
22. `outflowsCreate (kind=expense) creates expense record and payment ledger entry`: PASS ✓
23. `billsCreate (POS) generates bill, decrements currentStock, and records payment`: PASS ✓
24. `deliveriesCreate references billId by ID only without embedding bill document`: PASS ✓
25. `returnsCreate restores restocked items to product currentStock`: PASS ✓
26. `stockAdjust decrements stock and writes adjustment movement record`: PASS ✓
27. `Cross-tenant isolation: billsCreate rejects product belonging to another tenant`: PASS ✓
28. `Idempotency: duplicate billsCreate returns exact cached result without double stock deduction`: PASS ✓
29. `Part 8: barcode uniqueness rejects duplicate within organization and survives concurrent race`: PASS ✓
30. `Part 4: quotation does NOT decrement stock until finalized via billsFinalize`: PASS ✓
31. `Part 6: reconcileStockBalances confirms 0 discrepancies across all products and stockMovements`: PASS ✓
32. `Part 6: reconcilePartyLedgers confirms 0 discrepancies across customer and vendor ledgers`: PASS ✓

---

## 4. Security Rules Test Evidence (14/14 Passed)

Command: `firebase emulators:exec --only firestore,storage "npm run test:rules --prefix functions"`

### Firestore Security Rules (8/8 Passed)
1. `denies unauthenticated client write to any collection`: PASS ✓
2. `denies authenticated user direct write to server-owned collections`: PASS ✓
3. `completely denies client read and write to auditLogs, idempotencyRecords, and documentCounters`: PASS ✓
4. `allows user to read their own profile, but denies reading other user profiles`: PASS ✓
5. `enforces multi-tenant isolation: member can read own org data, denied for other org`: PASS ✓
6. `allows Super Admin with trusted token claim to read across organizations`: PASS ✓
7. `allows authenticated users to read platform catalogs (plans, modules, taxRegimes)`: PASS ✓
8. `allows tenant member to read products, bills, outflows, payments of own org, denies cross-tenant reads`: PASS ✓

### Cloud Storage Security Rules (6/6 Passed)
1. `denies unauthenticated upload to avatar path`: PASS ✓
2. `allows user to upload valid image avatar to their own path`: PASS ✓
3. `denies user uploading avatar to another user's path`: PASS ✓
4. `denies uploading non-image MIME types (e.g. application/octet-stream, text/html)`: PASS ✓
5. `allows Super Admin to upload organization logo`: PASS ✓
6. `denies regular user uploading directly to organization logo path`: PASS ✓

---

## 5. Anti-Embedding Checker Evidence

Command: `node scripts/check-duplicate-embedding.js`
* Scanned Files: Entire `functions/src` tree (models, callables, services).
* Total Violations: **0**.
* Explicit Confirmations Verified:
  1. `deliveries.billId`: References bill by ID only, never embeds bill document. [CONFIRMED]
  2. `payments.referenceId`: References invoice/outflow by ID only, standalone ledger collection. [CONFIRMED]
  3. `stockMovements.referenceId`: References transaction by ID only, standalone movement collection. [CONFIRMED]
  4. `outflows` and `bills` line items: Contain line-level data and snapshot fields only, never full parent/foreign document objects. [CONFIRMED]
  5. `returns.referenceId`: References original bill or outflow by ID only, never embeds original sale. [CONFIRMED]

Command: `node scripts/check-duplicate-embedding.js --test`
* Valid Fixture Findings: 0.
* Violation Fixture Findings: 3 (detected `NO_TEAM_MEMBERS_ARRAY`, `NO_EMBEDDED_PLAN_OBJECT`, `NO_EMBEDDED_USER_OBJECT`).
* Status: **PASS ✓**

