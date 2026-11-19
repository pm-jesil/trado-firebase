import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("BC4.4: Node 22 Environment Guard", () => {
  it("accepts Node v22.x.x runtime versions", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { assertNodeVersion } = require("../../../../scripts/verify-impact.js");
    assert.doesNotThrow(() => assertNodeVersion("22.17.0"));
    assert.doesNotThrow(() => assertNodeVersion("22.0.0"));
    assert.doesNotThrow(() => assertNodeVersion("22.11.0"));
  });

  it("fails loudly when non-Node-22 version is supplied", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { assertNodeVersion } = require("../../../../scripts/verify-impact.js");
    assert.throws(() => assertNodeVersion("24.16.0"), /Node 22 required/);
    assert.throws(() => assertNodeVersion("20.10.0"), /Node 22 required/);
    assert.throws(() => assertNodeVersion("18.19.0"), /Node 22 required/);
    assert.throws(() => assertNodeVersion(""), /Node 22 required/);
  });
});
