---
covers: [all]
verifiedAgainst: "a53b1cb110dd3955"
lastAttestedAt: "2026-11-15T12:22:28.029Z"
---

# Requests & Support Desk Module — As-Found Inventory (RB0)

Generated on 2026-11-15 during Prompt 74 execution. Cites file paths and line numbers across the codebase.

## 1. Summary of Findings (A-1 through A-10)

| ID | Area | As-Found State & Code Evidence | Gaps / Action for Requests Module |
|---|---|---|---|
| **A-1** | **Repository State** | `git status -sb` clean tracking `main...origin/main`. `verify:status` clean against baseline `base-d8c4563b` (trusted: true, 89 units, 0 untraced). 4 uncommitted files pre-existed (`docs/generated/error-reasons.json`, `docs/generated/guard-scopes/check-data-duplication.json`, `docs/generated/permissions.json`, `docs/openapi.json`). | Preserved untouched. Appended start line to `docs/audit/run-ledger.md`. |
| **A-2** | **Subscription & Plan Code** | `SubscriptionPlanDoc` (`functions/src/types/models.ts:286-306`) has 13 contract fields. `organizationsSetSubscription` (`functions/src/callables/organizations.ts:591-677`) is Super Admin only (`isSuperAdmin === true`). Updates `subscriptionStatus`, `subscriptionStartsAt`, `subscriptionExpiresAt`, `graceDays`, `planId` directly in transaction. Audited in `AUDIT_REGISTRY.organizationsSetSubscription`. | Plans lack `isPublic` and `showPriceToTenants` fields. No tenant-safe plan catalog callable exists (`plansList` in `callables/plans.ts:105` exposes raw plan docs without tenant filtering). No internal service function for subscription mutation exists (currently inline in callable). Need to extract `setSubscriptionInternal` service. |
| **A-3** | **Usage Limits & Modules** | `usageUpdateLimits` (`functions/src/callables/usage.ts:496-518`) is Super Admin only, updating `usageLimitOverrides` in `organizations/{orgId}` via `updateOrganizationUsageLimits` (`services/usageMetering.ts:429-443`). Metric registry: `ServiceUsageCounts` (`models.ts:1270-1283`, 12 metric keys). Periods: `daily` and `monthly`. Module registry: `catalogs.ts:63-140` (12 modules: `billing`, `sales`, `inventory`, `expenses`, `purchases`, `customers`, `reports`, `staff`, `returns`, `delivery`, `tasks`, `employee_tracking`). Module toggles stored on organization; plan-to-module map defined per plan in `catalogs.ts`. | Need internal service functions `updateUsageLimitsInternal` and `setModuleToggleInternal` so `requestsApply` can call them directly in-process without callable-calling-callable. |
| **A-4** | **Gate & Context** | `SUPER_ADMIN_TENANT_FORBIDDEN` enforced in `functions/src/services/contextResolver.ts:245-251` for non-read tenant operations. Platform callables declared via `options.allowPlatformSuperAdmin: true` (`contextResolver.ts:252-271`), yielding `organizationId: "platform"`, `effectivePermissions: ["platform:*"]`. `RequestContext` carries `callerUid`, `isSuperAdmin`, `organizationId`, `branchId`, `isOwner`, `plan`, `subscription`. | Per D-36, requests module callables for Super Admin are declared with `allowPlatformSuperAdmin: true` and permissions starting with `platform:requests_`, avoiding `SUPER_ADMIN_TENANT_FORBIDDEN`. |
| **A-5** | **Permissions** | Canonical registry `functions/src/constants/permissions.ts` exports `AppPermissions` (115 keys). Naming: `<module>:<action>` for tenant, `platform:<domain>:<action>` for platform. System roles seeded in `functions/src/constants/catalogs.ts:150-350` (`DEFAULT_SYSTEM_ROLES`). Org Owner receives `AppPermissions.ALL` (`*`) via `role_org_owner` (`catalogs.ts:157`). Roles stored in top-level `roles` collection (`models.ts:310`). | Add new tenant and platform permission keys for requests. Write idempotent migration adding permissions to existing system roles. |
| **A-6** | **Existing Relatives** | `approval_request` had 0 contract fields in `docs/flutter-contract/SUMMARY.md` because `approvalsDecide` was only a stub in `generate-flutter-contract.js:51` without schema or implementation. In-app notifications exist via `createAndDispatchNotification` (`services/notificationService.ts:29-70`) writing to `notifications` collection and dispatching push via `notificationSender.ts`. No external e-mail provider exists. Document counters: `functions/src/services/documentCounter.ts:47-70` provides sequential numbering in `documentCounters`. Scheduled functions: `functions/src/triggers/scheduled.ts`. Event triggers: `functions/src/triggers/eventTriggers.ts`. | Requests module uses top-level `requests` collection, `counters/requests` for sequence (`REQ-2026-000123`), in-app activity timeline & counts, and idempotent notification trigger. |
| **A-7** | **Storage & Files** | Image policy in `functions/src/config/imagePolicy.ts` and `docs/generated/image-policy.json`. Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`. Raw size: 2 MB (org/user/party), 5 MB (product). Storage rules (`storage.rules:24-27`) restrict client uploads to `/tmp/{scope}/{uid}/{uploadId}` with `isValidImage(5 * 1024 * 1024)`. Permanent assets written exclusively by Cloud Functions. | Request attachments allow images + PDF up to 5 MB per file, max 5 attachments. `storage.rules` must allow `application/pdf` under `/tmp/`. Server-side validation verifies upload ownership, MIME type, size, and copies to permanent path. |
| **A-8** | **Audit** | Unified recording point (`auditRecorder.ts:4-13`) hooks commits via `meteredFirestore.ts:recordCommitEvent`. Events written to `auditLogs/{requestId}_{seq}`. 140 actions registered in `constants/auditRegistry.ts`. Non-business collections excluded in `AUDIT_EXCLUDED_COLLECTIONS`. | Add `pData.requestNumber || bData.requestNumber` to `humanLabel` derivation in `auditRecorder.ts:203`. Add request actions to `auditRegistry.ts`. Exclude `counters` from business audit. |
| **A-9** | **Contract Pack** | Generated via `scripts/generate-flutter-contract.js` (`npm --prefix functions run contract:generate`). 23 entity forms in `docs/flutter-contract/forms/`. `state-machines.md` currently covers only 7 entities. `errors.md` and `client-meta-and-idempotency.md` exist. | Extend contract generator to generate `request-create.json` with discriminated details per category, form schemas, `state-machines.md` with `request-approval` and `request-work`, `errors.md` reasons, and permissions. |
| **A-10** | **Verification System** | `scripts/verify-impact.js` manages 89 units. Invariants C-1..C-10 enforced in coverage engine (`scripts/coverage-engine.js`). Coupling guard (`scripts/verify-coupling.js`) enforces coupled updates to code, tests, docs, openapi. Current `verify:plan` estimates 258s across 13 stale units. Attestation engine in `scripts/docs-attest.js`. | Add unit tests for request schemas, state-machine transitions, callables, emulator integration flows, and map them to verification units. |

## 2. Super-Admin-Only Organization Fields (Q-A2 Resolution)

Per `functions/src/callables/organizations.ts:65-76` (`ORGANIZATION_FIELD_POLICY`):
- `superAdmin` set: `name`, `legalName`, `businessType`, `businessCategory`, `financialYearStartMonth`, `moduleToggles`, `salesChannels`, `timezone`, `image`, `uploadId`, `taxId`, `website`, `contactEmail`, `contactPhone`, `contact`, `contacts`, `addresses`, `bankAccounts`, `settings`, `showCostToTenant`.
- `owner` set: `legalName`, `image`, `uploadId`, `taxId`, `website`, `contactEmail`, `contactPhone`, `contact`, `contacts`, `addresses`, `bankAccounts`, `settings`.

**Super-Admin-Only Fields (for `org_profile_change` category):**
1. `name` (Organization / Display Name)
2. `businessType`
3. `businessCategory`
4. `financialYearStartMonth`
5. `moduleToggles`
6. `salesChannels`
7. `timezone`
8. `showCostToTenant`

## 3. Existing Notification Infrastructure (Q-RQ7 Resolution)

1. **In-App Notifications:** `notifications` collection storing `NotificationDoc` (`types/models.ts:326-340`). Created via `createAndDispatchNotification` (`services/notificationService.ts`).
2. **Push Notifications (FCM):** `services/notificationSender.ts` uses pluggable `NotificationSender` interface with `MockNotificationSender` (active by default in emulator/tests). Real FCM calls are mocked locally.
3. **Outbox:** `notificationOutbox` collection used for queued welcome emails/notifications.
4. **Email:** **Zero** external email providers configured in the repository (no SendGrid, AWS SES, Mailgun, SMTP).
5. **Conclusion:** Notifications in Requests v1 use in-app timeline (`requests/{id}/activity`), unread activity indicators, in-app notification records (`notifications` collection), and FCM push via existing `notificationService`. No external email integration without explicit owner request.
