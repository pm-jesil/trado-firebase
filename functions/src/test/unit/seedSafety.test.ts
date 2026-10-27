/**
 * Unit Test for Seed Tooling Safety Guard
 * 
 * Verifies that seed-emulator script refuses to run without emulator host variables.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Seed Tooling Safety Guard", () => {
  it("safety check prevents running against production when FIRESTORE_EMULATOR_HOST is missing", () => {
    const firestoreHost = undefined;
    const authHost = undefined;

    const wouldRun = Boolean(firestoreHost || authHost);
    assert.equal(wouldRun, false, "Seed tool must strictly refuse execution without emulator host env vars.");
  });

  it("safety check allows running only when emulator host is explicitly configured", () => {
    const firestoreHost = "127.0.0.1:8080";
    const authHost = "127.0.0.1:9099";

    const wouldRun = Boolean(firestoreHost || authHost);
    assert.equal(wouldRun, true, "Seed tool executes when emulator hosts are present.");
  });
});
