# Data Serialization & Type Conventions

## 1. Dates and Timestamps
- Server timestamps are serialized as ISO 8601 UTC strings: `"2026-11-14T05:30:00.000Z"`.
- Calendar dates without time are serialized as YYYY-MM-DD: `"2026-11-14"`.

## 2. Monetary Values (Minor Units / Paise)
All prices, discounts, line totals, taxes, and payments are stored and transferred as **integer minor units** (paise in INR, 100 paise = ₹1.00):
- ₹25.00 is serialized as `2500`.
- ₹0.50 is serialized as `50`.

### Flutter Conversion Utilities
```dart
class MoneyUtils {
  static double paiseToRupees(int paise) => paise / 100.0;
  static int rupeesToPaise(double rupees) => (rupees * 100.0).round();
  static String formatInr(int paise) => '₹${(paise / 100.0).toStringAsFixed(2)}';
}
```

## 3. ImageRef Storage (D-5, D-15)
- Raw image URLs are **never stored** in Firestore.
- Stored field is `image` of type ImageRef (e.g. `{ "storagePath": "orgs/123/products/prod_1.webp", "width": 800, "height": 600 }`).
- Read-time hydration provides a signed CDN download URL (`imageUrl`) valid for client display.
