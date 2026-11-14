# Permanent As-Found Snapshot: as-found-after-S1-S3 (D-29)

> Status: archived. Frozen on 2026-11-14T01:30:00.000Z. Do not edit.

This document represents the frozen baseline state of the Trado Firebase backend immediately following the completion of Prompt 67 Phase A, B, C, and Phase D Slices S1–S3. In accordance with decision **D-29**, this snapshot is permanently frozen; all subsequent progress is tracked as a delta.

---

## 1. Obligation Layer Breakdown

- **Total Extracted Obligations Across All Layers:** **555**
  - **Layer 1 (ID Rows from Prompt Tables):** **139**
  - **Layer 2 (Architectural Decisions D-1..D-34):** **52** mentions
  - **Layer 3 (Part & Sub-Part Headings):** **219**
  - **Layer 4 (Mandatory Sentence Obligations):** **141**
  - **Layer 5 (Named Scripts and Artifacts):** **4**

---

## 2. Core Architectural Inventory

- **Exported Symbols in `functions/src/index.ts`:** 140
  - HTTPS Callables: **134**
  - Cloud Functions Event Triggers: **6**
- **Concrete Firestore Collections:** **48** (46 root collections + 2 subcollections)
- **Field Catalog Census (C-1 Ratio):** **1,044 / 1,052** leaf paths catalogued
- **Verification Units in Impact Test System:** **86**
- **Last Verified Full Baseline Run ID:** `run-166add49` (86 units run, 0 failures, trusted: true)

---

## 3. Standing Rules and Coupling State

- **Canonical Rules File:** `AGENTS.md` (57 lines, 3,586 characters, ≤ 120 lines / < 12k chars)
- **Rules Canary:** `rules-canary: trado-sovereign-canary-2026`
- **Adapter File:** `CLAUDE.md` (thin `@AGENTS.md` reference)
- **Coupling Guard:** `scripts/verify-coupling.js` verifying 134 callables, 6 triggers, 48 collections across manifests, OpenAPI, budgets, and tests.
- **Test Quality Guard:** `scripts/check-test-quality.js` enforcing zero unasserted tests, zero tautologies, zero `.only`/`.skip`, zero swallowed catches, and raw Firestore doc checks.
- **Flow Catalog:** `docs/testing/flows.md` mapping 12 commercial flows to 134 callables (100.0% coverage).
- **Scenario Matrix:** `docs/testing/scenario-matrix.md` evaluating callables against scenario taxonomy R-01..R-40.

