/**
 * Unit Test for Seed Tooling Safety Guard
 * 
 * Verifies that seed-emulator script refuses to run without emulator host variables,
 * or when targeting a project ID other than the local emulator project ("trado-x").
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyEmulatorSafety } from "../../scripts/seed-emulator.js";

describe("Seed Tooling Safety Guard", () => {
  it("safety check prevents running against production when FIRESTORE_EMULATOR_HOST is missing", () => {
    const res = verifyEmulatorSafety(
      {
        FIRESTORE_EMULATOR_HOST: undefined,
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      },
      "trado-x"
    );
    assert.equal(res.safe, false, "Seed tool must strictly refuse execution when FIRESTORE_EMULATOR_HOST is missing.");
    assert.match(res.error || "", /Missing emulator host/);
  });

  it("safety check prevents running against production when FIREBASE_AUTH_EMULATOR_HOST is missing", () => {
    const res = verifyEmulatorSafety(
      {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_AUTH_EMULATOR_HOST: undefined,
      },
      "trado-x"
    );
    assert.equal(res.safe, false, "Seed tool must strictly refuse execution when FIREBASE_AUTH_EMULATOR_HOST is missing.");
    assert.match(res.error || "", /Missing emulator host/);
  });

  it("safety check prevents running when target project is not the local emulator project trado-x", () => {
    const res = verifyEmulatorSafety(
      {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        GCLOUD_PROJECT: "production-live-trado",
      },
      "production-live-trado"
    );
    assert.equal(res.safe, false, "Seed tool must strictly refuse execution against live or non-emulator project ID.");
    assert.match(res.error || "", /Refusing execution: Project ID/);
  });

  it("safety check allows running only when emulator hosts are present and project is trado-x", () => {
    const res = verifyEmulatorSafety(
      {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        GCLOUD_PROJECT: "trado-x",
      },
      "trado-x"
    );
    assert.equal(res.safe, true, "Seed tool executes when emulator hosts are present and project ID is trado-x.");
    assert.equal(res.error, undefined);
  });
});
