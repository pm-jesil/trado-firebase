# Client `_meta` contract

What the app may send with every callable so the backend can record the device and app version of a request. This is the contract the Flutter app implements.

## Shape

An optional top-level `_meta` object next to the callable's own fields:

```json
{
  "organizationId": "org_123",
  "name": "Fresh Mart",
  "_meta": {
    "deviceId": "3f9c2a7e-6b1d-4c8e-9a2f-5d7e1b0c4a99",
    "appVersion": "1.4.2+57",
    "platform": "android",
    "clientRequestId": "req-20261113-000042",
    "clientTime": "2026-11-13T09:07:08.138Z",
    "locale": "en-IN"
  }
}
```

| Field | Rule |
|---|---|
| `deviceId` | a random UUID the app generates once per installation and keeps in secure storage; 8–128 characters, letters, digits and `. _ : -`. **Never** a hardware identifier (IMEI, MAC, advertising id). |
| `appVersion` | the app version string, up to 40 characters |
| `platform` | `android`, `ios` or `web` |
| `clientRequestId` | the app's own id for the request, up to 128 characters |
| `clientTime` | the device clock as an ISO-8601 instant with offset |
| `locale` | a BCP-47 tag, up to 35 characters |

Every field is optional; unknown fields inside `_meta` are rejected with `META_INVALID`.

## What the backend does with it

- The callable wrapper (`functions/src/services/callable.ts`) removes `_meta` **before** the callable's strict schema runs, so `UNKNOWN_FIELD` keeps working for the real payload.
- `_meta` is **untrusted** (D-26). It is used for analytics and flags only and never for authorization. The organization, the user and the time always come from the verified ID token, the gate and the server clock.
- `deviceId` is compared with the user's registered devices (`users/{uid}/devices`, written by `authLogin` and `notificationsRegisterFcmToken`). An unknown device is **flagged** (`deviceRegistered: false` on the audit event and in the usage rollups), not rejected. The check reads the device document once per user and device per server instance every 10 minutes, and only when `deviceId` is sent.
- `clientTime` is recorded, never used for ordering.

## Requiring it later

The server setting `REQUIRE_META=true` rejects a call without `_meta` with the stable reason `META_REQUIRED`. It is off until the app sends `_meta` on every call.

## Errors

| Reason | When |
|---|---|
| `META_INVALID` | `_meta` is not an object, has an unknown field, or a field breaks its rule; `details.fields` names the paths |
| `META_REQUIRED` | `REQUIRE_META` is on and the call has no `_meta` |
