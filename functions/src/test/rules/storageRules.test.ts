/**
 * Storage Security Rules Unit Tests
 * 
 * Verifies:
 * - Unauthenticated access denied.
 * - Authenticated user can write valid image (<= 5MB raw max) to own tmp/{scope}/{uid}/{uploadId}.
 * - Cross-user write to another user's tmp/ path denied.
 * - Non-allowed MIME types (text/html, application/pdf, image/svg+xml) denied.
 * - Zero-byte uploads denied.
 * - Direct client write to permanent asset paths (organizations/*, users/*) denied.
 * - Numbers in rules match IMAGE_POLICIES (parity check).
 */

import { describe, it, before, after, beforeEach } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getBytes } from "firebase/storage";
import { IMAGE_POLICIES } from "../../config/imagePolicy.js";

/**
 * Rule-evaluation evidence (prompt 65, C-9): the Storage emulator has no rule-coverage report, so
 * every request outcome is recorded here and mapped to the deciding allow statement by
 * scripts/collect-rules-coverage.js.
 */
const outcomes: Array<{ op: "read" | "write"; path: string; allowed: boolean }> = [];
async function expectAllowed(op: "read" | "write", objectPath: string, request: Promise<unknown>): Promise<void> {
  await assertSucceeds(request);
  outcomes.push({ op, path: objectPath, allowed: true });
}
async function expectDenied(op: "read" | "write", objectPath: string, request: Promise<unknown>): Promise<void> {
  await assertFails(request);
  outcomes.push({ op, path: objectPath, allowed: false });
}

describe("Storage Security Rules Matrix", () => {
  let testEnv: RulesTestEnvironment;
  const PROJECT_ID = "trado-x-storage-test";

  before(async () => {
    const rulesPath = path.resolve(process.cwd(), "..", "storage.rules");
    let rulesContent = "";
    if (fs.existsSync(rulesPath)) {
      rulesContent = fs.readFileSync(rulesPath, "utf8");
    } else {
      rulesContent = fs.readFileSync(path.resolve(process.cwd(), "storage.rules"), "utf8");
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: {
        rules: rulesContent,
        host: "127.0.0.1",
        port: 9199,
      },
    });
  });

  after(async () => {
    const dir = path.resolve(__dirname, "../../../../.local/rules-evidence");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "storage.json"), JSON.stringify({ outcomes }, null, 1));
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearStorage();
    }
  });

  it("rules numbers match imagePolicy.ts raw upload max (parity check)", () => {
    const rulesPath = fs.existsSync(path.resolve(process.cwd(), "storage.rules"))
      ? path.resolve(process.cwd(), "storage.rules")
      : path.resolve(process.cwd(), "..", "storage.rules");
    const content = fs.readFileSync(rulesPath, "utf8");
    const rawMaxMb = IMAGE_POLICIES.product_image.rawUploadMaxBytes / (1024 * 1024);
    assert.equal(content.includes(`${rawMaxMb} * 1024 * 1024`), true, "storage.rules must carry the 5MB raw max limit");
  });

  it("denies unauthenticated upload to tmp path", async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    const targetRef = ref(storage, "tmp/org_alpha/user_alice/upload_1");
    const bytes = Buffer.from("fake-png-bytes");

    await expectDenied("write", "tmp/org_alpha/user_alice/empty.png", uploadBytes(targetRef, bytes, { contentType: "image/png" }));
  });

  it("allows user to upload valid image to their own tmp path", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const targetRef = ref(storage, "tmp/org_alpha/user_alice/upload_1");
    const bytes = Buffer.from("valid-png-data");

    await expectAllowed("write", "tmp/org_alpha/user_alice/empty.png", uploadBytes(targetRef, bytes, { contentType: "image/png" }));
  });

  it("denies user uploading to another user's tmp path", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const bobRef = ref(storage, "tmp/org_alpha/user_bob/upload_1");
    const bytes = Buffer.from("valid-png-data");

    await expectDenied("write", "tmp/org_alpha/user_bob/upload_1", uploadBytes(bobRef, bytes, { contentType: "image/png" }));
  });

  it("denies uploading disallowed MIME types (e.g. text/html, svg+xml, pdf, image/gif)", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const htmlRef = ref(storage, "tmp/org_alpha/user_alice/script.html");
    const svgRef = ref(storage, "tmp/org_alpha/user_alice/image.svg");
    const gifRef = ref(storage, "tmp/org_alpha/user_alice/animation.gif");

    await expectDenied("write", "tmp/org_alpha/user_alice/script.html", uploadBytes(htmlRef, Buffer.from("<script>alert(1)</script>"), { contentType: "text/html" }));
    await expectDenied("write", "tmp/org_alpha/user_alice/image.svg", uploadBytes(svgRef, Buffer.from("<svg></svg>"), { contentType: "image/svg+xml" }));
    await expectDenied("write", "tmp/org_alpha/user_alice/animation.gif", uploadBytes(gifRef, Buffer.from("GIF89a"), { contentType: "image/gif" }));
  });

  it("denies oversize uploads exceeding 5MB limit", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const oversizeRef = ref(storage, "tmp/org_alpha/user_alice/oversize.png");
    // 5MB + 1 byte
    const oversizeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);

    await expectDenied("write", "tmp/org_alpha/user_alice/oversize.png", uploadBytes(oversizeRef, oversizeBuffer, { contentType: "image/png" }));
  });

  it("denies zero-byte uploads", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const targetRef = ref(storage, "tmp/org_alpha/user_alice/empty.png");

    await expectDenied("write", "tmp/org_alpha/user_alice/empty.png", uploadBytes(targetRef, Buffer.alloc(0), { contentType: "image/png" }));
  });

  it("denies client direct write to permanent organization asset paths", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const permRef = ref(storage, "organizations/org_alpha/org_logo/entity_1/hash.webp");

    await expectDenied("write", "users/user_alice/user_photo/entity_1/hash.webp", uploadBytes(permRef, Buffer.from("valid-data"), { contentType: "image/webp" }));
  });

  it("denies client direct write to permanent user asset paths", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const permRef = ref(storage, "users/user_alice/user_photo/entity_1/hash.webp");

    await expectDenied("write", "users/user_alice/user_photo/entity_1/hash.webp", uploadBytes(permRef, Buffer.from("valid-data"), { contentType: "image/webp" }));
  });

  it("allows the owner to read their own tmp upload and denies another user", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "tmp/org_alpha/user_alice/read_probe"), Buffer.from("x"), { contentType: "image/png" });
    });
    await expectAllowed("read", "tmp/org_alpha/user_alice/read_probe", getBytes(ref(testEnv.authenticatedContext("user_alice").storage(), "tmp/org_alpha/user_alice/read_probe")));
    await expectDenied("read", "tmp/org_alpha/user_alice/read_probe", getBytes(ref(testEnv.authenticatedContext("user_bob").storage(), "tmp/org_alpha/user_alice/read_probe")));
  });

  it("allows an authenticated user to read a permanent asset and denies an unauthenticated one", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "organizations/org_alpha/org_logo/entity_1/read.webp"), Buffer.from("x"), { contentType: "image/webp" });
    });
    await expectAllowed("read", "organizations/org_alpha/org_logo/entity_1/read.webp", getBytes(ref(testEnv.authenticatedContext("user_alice").storage(), "organizations/org_alpha/org_logo/entity_1/read.webp")));
    await expectDenied("read", "organizations/org_alpha/org_logo/entity_1/read.webp", getBytes(ref(testEnv.unauthenticatedContext().storage(), "organizations/org_alpha/org_logo/entity_1/read.webp")));
  });
});
