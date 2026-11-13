# Trado Firebase Backend — Cloud Functions & Domain Engine

This directory contains the Cloud Functions for Firebase backend serving the Trado multi-tenant ERP and POS platform. All code is written in TypeScript, strictly validated with Zod, and tested against local Firebase emulators.

---

## 1. System Inventory & Runtime Architecture

- **Runtime Target**: Node.js 22 (LTS)
- **Deployment Region**: `asia-south1` (Mumbai)
- **Framework**: Firebase Functions v2, Firebase Admin SDK v13, Zod v4, Sharp v0.35
- **Exports Total**: 140 exports
  - **134 HTTPS Callables** (authenticated multi-tenant RPCs and testing adapters)
  - **6 Document Event Triggers & Schedulers** (`onBillWritten`, `onOutflowWritten`, `onPaymentWritten`, `onDeliveryWritten`, `onStorageObjectFinalized`, `subscriptionAndUsageSweep`)
  - **47 Concrete Firestore Collections**
  - **8 Supported Countries**: AE, IN, US, SG, OM, BH, SA, QA

---

## 2. Architectural Principles

1. **Reference-by-ID**: Foreign relationships reference parent or counterparty entity IDs (`organizationId`, `branchId`, `customerId`, `vendorId`). Embedded duplicates are forbidden.
2. **Frozen Historical Snapshots**: Transaction documents (`bills`, `outflows`) take frozen point-in-time snapshots of legal facts (`billToSnapshot`, `priceSnapshot`, `costSnapshot`, `taxSnapshot`) that remain immutable after issue.
3. **Single Canonical Response Shapes (D-12)**: Every callable returns a single canonical response object without duplicate top-level keys.
4. **Zero Backward-Compatibility Aliases (D-7)**: In this pre-release codebase, legacy aliases like `taxNumber` are completely purged in favor of canonical `taxId`.
5. **Field-Level Authorization (D-11)**: Updates reject unauthorized field mutations with stable `FIELD_NOT_EDITABLE` error reasons rather than silently ignoring submitted data.

---

## 3. Local Development & Emulator Configuration

The backend is developed and tested strictly against the local Firebase Emulator Suite:

| Service | Local Host / Port | Environment Variable |
|---|---|---|
| **Firebase Auth** | `127.0.0.1:9099` | `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` |
| **Cloud Firestore** | `127.0.0.1:8080` | `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` |
| **Cloud Functions** | `127.0.0.1:5001` | `FIREBASE_FUNCTIONS_HOST=http://127.0.0.1:5001` |
| **Cloud Storage** | `127.0.0.1:9199` | `STORAGE_EMULATOR_HOST=http://127.0.0.1:9199` |
| **Emulator UI** | `127.0.0.1:4000` | — |

---

## 4. Test Suites & Verification Commands

All test suites run in the `functions/` directory:

```bash
# Build TypeScript
npm run build

# Unit test suite (Money math, permission resolver, inventory FIFO/WAC)
npm run test:unit

# Security rules suite (Firestore rules & Storage rules)
npm run test:rules

# Complete callable contract verification
npm run test:callables

# Event-driven triggers & side-effect verification
npm run test:triggers

# End-to-end multi-tenant lifecycle flows
npm run test:e2e

# Mechanical 13-entity maximal-payload API <-> Database round-trip proof
npm run test:roundtrip

# Two-business 30-day realistic trade simulation
npm run test:simulation

# Multi-pass seed repeatability and idempotency check
npm run test:seed

# Data duplication & foreign attribute sweep
npm run check:data

# Static gate conformance, drift, duplicate, and documentation truth guards
npm run test:static

# Run full comprehensive regression suite
npm run test:all
```

---

## 5. Verification Status

- **Status**: Emulator-verified against local Firebase Emulator Suite.
- **Prerequisites for Production**: See [`../docs/production-readiness.md`](../docs/production-readiness.md) for Cloud Console provisioning punch list.

