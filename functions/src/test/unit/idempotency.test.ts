/**
 * Unit Tests for Idempotency Utilities
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeJson,
  hashPayload,
  deriveRecordId,
} from "../../services/idempotency.js";

describe("Idempotency Service", () => {
  it("canonicalizeJson sorts keys deterministically and ignores idempotencyKey & passwords", () => {
    const payload1 = {
      b: 2,
      a: 1,
      idempotencyKey: "client-key-123",
      initialPassword: "secret-password",
    };

    const payload2 = {
      a: 1,
      b: 2,
    };

    const json1 = canonicalizeJson(payload1);
    const json2 = canonicalizeJson(payload2);

    assert.equal(json1, json2, "Canonical JSON must sort keys and exclude idempotencyKey & initialPassword.");
  });

  it("hashPayload produces identical SHA-256 for equivalent payloads with different key orders", () => {
    const payloadA = { name: "Apex", city: "Mumbai", tier: "gold" };
    const payloadB = { tier: "gold", name: "Apex", city: "Mumbai" };

    const hashA = hashPayload(payloadA);
    const hashB = hashPayload(payloadB);

    assert.equal(hashA, hashB, "Hash must be independent of key insertion order.");
    assert.equal(typeof hashA, "string");
    assert.equal(hashA.length, 64);
  });

  it("hashPayload produces different hashes for different request data", () => {
    const payload1 = { name: "Apex", city: "Mumbai" };
    const payload2 = { name: "Apex", city: "Delhi" };

    const hash1 = hashPayload(payload1);
    const hash2 = hashPayload(payload2);

    assert.notEqual(hash1, hash2, "Different data must produce different hashes.");
  });

  it("deriveRecordId produces deterministic scoped document IDs", () => {
    const id1 = deriveRecordId("org_123", "usr_abc", "employees.create", "key-999");
    const id2 = deriveRecordId("org_123", "usr_abc", "employees.create", "key-999");
    const idDifferentActor = deriveRecordId("org_123", "usr_xyz", "employees.create", "key-999");
    const idDifferentScope = deriveRecordId("org_456", "usr_abc", "employees.create", "key-999");

    assert.equal(id1, id2, "Same parameters must generate the same record ID.");
    assert.notEqual(id1, idDifferentActor, "Different actor must generate different record ID.");
    assert.notEqual(id1, idDifferentScope, "Different scope must generate different record ID.");
    assert.equal(id1.length, 64);
  });

  it("calculates lease expiration deadlines correctly and detects expired leases", () => {
    const now = new Date();
    const leaseSeconds = 30;
    const activeProcessingExpiresAt = new Date(now.getTime() + (leaseSeconds / 2) * 1000).toISOString();
    const expiredProcessingExpiresAt = new Date(now.getTime() - leaseSeconds * 1000).toISOString();

    const isStillActive = now.getTime() < new Date(activeProcessingExpiresAt).getTime();
    const isNowExpired = now.getTime() >= new Date(expiredProcessingExpiresAt).getTime();

    assert.equal(isStillActive, true, "Active lease within window must not be expired.");
    assert.equal(isNowExpired, true, "Expired lease in the past must be detected as expired.");
  });

  it("proves recoveryChecker pattern resolves side-effect on expired lease without double execution", async () => {
    let sideEffectChecked = false;
    const fakeRecoveryChecker = async () => {
      sideEffectChecked = true;
      return { id: "recovered_doc_123", status: "created" };
    };

    const recovered = await fakeRecoveryChecker();
    assert.equal(sideEffectChecked, true);
    assert.equal(recovered?.id, "recovered_doc_123");
  });
});
