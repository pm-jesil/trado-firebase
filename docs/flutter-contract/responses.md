# Response Conventions (D-18)

All Cloud Function callables return JSON objects adhering to standard response envelopes.

## 1. Single Entity Envelope
Single entity creation, retrieval, or mutation callables return the entity wrapped under its singular domain name:
```json
{
  "customer": {
    "customerId": "cust_12345",
    "name": "Acme Retail Ltd",
    "phone": "+919876543210",
    "createdAt": "2026-11-14T05:30:00.000Z"
  }
}
```

## 2. List Envelope
List callables return a paginated collection under `items`:
```json
{
  "items": [
    { "productId": "prod_1", "name": "Standard Widget", "sellingPrice": 2500 }
  ],
  "count": 1,
  "totalCount": 42,
  "nextCursor": "prod_1",
  "hasMore": true,
  "included": {
    "categories": {
      "cat_1": { "categoryId": "cat_1", "name": "Hardware" }
    }
  }
}
```
- `items`: List of documents matching filter.
- `count`: Number of items in current page.
- `totalCount`: Total items matching query (only computed when client passes `includeTotal: true`).
- `nextCursor`: Opaque string passed as `cursor` / `startAfterId` to fetch the next page. Null when no more items.
