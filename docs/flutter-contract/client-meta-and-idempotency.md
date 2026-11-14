# Client Metadata & Idempotency

## 1. Request Telemetry (`_meta`)
Clients should supply the `_meta` header in callable data:
```json
{
  "_meta": {
    "clientRequestId": "req_uuid_1234",
    "deviceId": "dev_device_hardware_id",
    "platform": "android",
    "appVersion": "1.2.0"
  }
}
```

## 2. Idempotency Key (`idempotencyKey`)
All critical mutation callables (`billsCreate`, `outflowsCreate`, `paymentsCreate`, `unitsCreate`, etc.) accept an optional `idempotencyKey`:
- Providing a unique UUID ensures network retries return the original cached response.
- Submitting an identical key with a different payload triggers an `already-exists` conflict.

## 3. Image Upload Sequence
1. Client calls `imagesCreateUploadSession` with `purpose: "product_photo"`.
2. Backend returns signed upload URL and `storagePath`.
3. Client PUTs image binary to signed URL.
4. Client passes `ImageRef: { "storagePath": storagePath }` in `productsCreate` or `productsUpdate`.
