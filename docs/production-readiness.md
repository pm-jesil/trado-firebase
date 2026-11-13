# Trado — cloud readiness and the cloud-only checklist

What the emulator can prove is stated by computed files, not by this page:

- coverage ratios: [audit/coverage.md](audit/coverage.md) (`npm run coverage:compute`, prompt 65 D-20);
- the last verification run and what it skipped: `npm run verify:status` and the scope block in
  `.local/verification-runs/<runId>.json` (see [process/verification.md](process/verification.md)).

This page lists what **cannot** be proven in the emulator and must be done in the Google Cloud /
Firebase consoles before real users. Owners are roles; assign a person to each before the first deploy.

## 1. Cloud-only checklist

| # | Item | Owner (role) | When | How / why |
|---|---|---|---|---|
| 1 | **Billing export to BigQuery** (standard + detailed usage cost) | Platform owner | now: there is no backfill, and cost tracking (prompt 66) depends on it | Billing → Billing export → dataset in `asia-south1` |
| 2 | **Budget alerts** (50 / 80 / 100 / 120 % of a monthly budget) | Platform owner | before first deploy | Billing → Budgets & alerts |
| 3 | Point-in-time recovery and a scheduled Firestore backup (daily, 30-day retention) | Platform owner | before real data | `gcloud firestore databases update --enable-pitr`; `gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=30d` |
| 4 | Cloud Monitoring alerts: function error rate, p95 latency, auth failures | Platform owner | before launch | Monitoring → Alerting, on Cloud Run / Functions metrics and Identity Platform logs |
| 5 | TTL policies on the `Timestamp` fields the code writes: `locationPings.expiresAt`, `auditLogs.expireAt` (24 months), `organizationUsageDaily.expireAt` and `userUsageDaily.expireAt` (25 months) | Backend lead | before real data | `gcloud firestore fields ttls update <field> --collection-group=<collection> --enable-ttl` per pair; TTL deletes are billed as deletes |
| 6 | Storage lifecycle rule deleting `tmp/` objects after 1 day | Backend lead | before image upload is enabled | bucket lifecycle: `age: 1`, `matchesPrefix: ["tmp/"]`; abandoned upload sessions otherwise keep their bytes |
| 7 | App Check enforcement (Play Integrity, App Attest / DeviceCheck, reCAPTCHA Enterprise for web) | Mobile lead | monitor mode first, enforce once the app build ships | Firebase console → App Check; callables do not yet set `enforceAppCheck` |
| 8 | FCM / APNs keys | Mobile lead | before push notifications | **Note:** no push is sent today; `services/notificationSender.ts` is an in-memory adapter. Keys are useless until a real sender is implemented (open item). |
| 9 | A staging project (separate from `trado-x`) | Platform owner | before first production deploy | deploy and smoke-test there first; test and demo emulator project ids are separate already |
| 10 | Email provider for invites, its API key in Secret Manager | Backend lead | before invites by email | no email sending exists in code today; when it is added, read the key with `defineSecret` and grant Secret Manager Secret Accessor to the runtime service account only |
| 11 | Auth settings: password policy, MFA for Super Admin accounts, authorized domains | Security owner | before launch | Firebase console → Authentication → Settings |
| 12 | Bucket CORS | Backend lead | **only if** a web client fetches image bytes with `fetch`/XHR | `GET`, `HEAD` from the web app origins only; see [decisions-log.md](decisions-log.md) Decision 15 (Y-10) |
| 13 | Least-privilege IAM for the functions' runtime service account (derivation below) | Security owner | before first deploy | replace the default Editor / `roles/storage.admin` grants |
| 14 | Image display URL decision (signed URL or download token) | Product owner | before image upload is enabled | [decisions-log.md](decisions-log.md) Decision 15: today's public `storage.googleapis.com` URLs return 403 unless objects are public |
| 15 | **Verify the rate card** against the official Firestore, Cloud Run functions and Cloud Storage pricing pages (asia-south1) or the Cloud Billing Catalog API, and publish a new `usageRateCards` version with `verified: true` per price | Platform owner | before any cost estimate is shown | [rate-card.md](reference/rate-card.md): 0 prices are verified today; until then every estimate says "prices not verified" |
| 16 | Cloud Monitoring access to the Firestore document read / write / delete metrics, for daily quantity reconciliation | Platform owner | with item 1 | the comparison against the measured rollups is cloud-only (not implemented here; prompt 66 §2.4) |
| 17 | IAM for a reconciliation job, if one is added: `roles/bigquery.jobUser` and BigQuery Data Viewer on the billing export dataset only | Security owner | when reconciliation is implemented | nothing broader |
| 18 | Deploy the field index exemptions and composite indexes in `firestore.indexes.json`; run `node scripts/check-firestore-indexes.js` after the suites first | Backend lead | every deploy | the emulator never enforces composite indexes: a missing one fails only in production |
| 19 | Functions memory and concurrency as used in the compute estimate (`FUNCTIONS_MEMORY_GIB`, default 0.25) | Backend lead | before cost estimates are shown | the compute line is an upper bound; set the variable to the configured memory |
| 20 | `METER_FLUSH_MODE` stays `batched` (default outside the emulator); `REQUIRE_META=true` only after the Flutter app sends `_meta` | Backend lead | at deploy / after the app ships | [client-meta.md](guides/client-meta.md); batched mode loses at most one flush interval of counts per instance on a hard kill |
| 21 | Optional analytics tier: a log sink of one structured line per request to BigQuery | Platform owner | only if per-request analytics are wanted | not implemented; Cloud Logging ingestion is billed per GiB |

**Scheduled functions need no manual Cloud Scheduler step.** `subscriptionAndUsageSweep` is declared with
`onSchedule` (`functions/src/triggers/scheduled.ts`); `firebase deploy --only functions` creates its Cloud
Scheduler job. The deploying account needs permission to create Scheduler jobs, and the Cloud Scheduler API must
be enabled in the project; nothing is bound by hand.

## 2. IAM derived from what the code calls

Derived from the Admin SDK and functions-framework calls in `functions/src` (search `from "firebase-admin/…"`,
`auth.*`, `.file(…).*`). Nothing else is called.

| Code calls | Where | Role for the runtime service account |
|---|---|---|
| Firestore reads, writes, transactions (Admin SDK) | every callable, trigger and the sweep | `roles/datastore.user` |
| Auth admin: `createUser`, `updateUser`, `deleteUser`, `getUser`, `getUserByEmail`, `getUserByPhoneNumber`, `setCustomUserClaims` | `services/membershipProvisioning.ts`, `services/claims.ts`, auth callables | `roles/firebaseauth.admin` |
| Storage object delete / read metadata on the one default bucket | `services/imageEngine.ts`, `triggers/storageTriggers.ts` | `roles/storage.objectAdmin` **on that bucket only** (not `roles/storage.admin` at project level) |
| Signed URLs (only if Decision 15 picks option A) | `hydrateImageUrl` | `roles/iam.serviceAccountTokenCreator` on itself |
| Secrets (none today) | — | Secret Manager Secret Accessor per secret, when one exists |

Eventarc / Pub/Sub roles for triggers and the scheduler are granted by the Firebase deploy to the service agents.

## 3. Deploy order (when the owner authorises a deploy)

1. `firebase use <staging project>`; then the same against `trado-x`.
2. `firebase deploy --only firestore:indexes` and wait until every index is built.
3. `firebase deploy --only firestore:rules,storage:rules`.
4. `firebase deploy --only functions`.
5. Call `healthCheck`; seed the platform catalogs (roles, plans, tax regimes) with the seed script's catalog profile.

## 4. Local-only developer tools (never deployed)

| Tool | Path | Purpose |
|------|------|---------|
| API Explorer (Swagger UI) | [`tools/api-explorer/server.js`](../tools/api-explorer/server.js) | browser-based manual API testing via a local proxy |
| OpenAPI spec | [`docs/openapi.json`](openapi.json) | machine-readable contract |
| CLI workbench | [`functions/scripts/test-api-workbench.js`](../functions/scripts/test-api-workbench.js) | terminal-based callable testing |
| .http collection | [`scripts/manual-tests/trado-api.http`](../scripts/manual-tests/trado-api.http) | VS Code REST Client requests |

> [!IMPORTANT]
> The API Explorer binds to `127.0.0.1` only, rejects `--target=live` and production host variables, and shows a
> "NOT PRODUCTION" banner.
