/**
 * Storage Security Rules Unit Tests
 * 
 * Verifies:
 * - Unauthenticated access denied.
 * - Allowed avatar upload to own path with valid image MIME type (< 5MB).
 * - Denied avatar upload to another user's path.
 * - Denied non-image MIME types (executable/html).
 * - Organization logo write restricted to Super Admin.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes } from "firebase/storage";

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
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearStorage();
    }
  });

  it("denies unauthenticated upload to avatar path", async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    const avatarRef = ref(storage, "users/user_alice/avatar/photo.png");
    const bytes = Buffer.from("fake-png-bytes");

    await assertFails(uploadBytes(avatarRef, bytes, { contentType: "image/png" }));
  });

  it("allows user to upload valid image avatar to their own path", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const avatarRef = ref(storage, "users/user_alice/avatar/photo.png");
    const bytes = Buffer.from("valid-png-data");

    await assertSucceeds(uploadBytes(avatarRef, bytes, { contentType: "image/png" }));
  });

  it("denies user uploading avatar to another user's path", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const bobAvatarRef = ref(storage, "users/user_bob/avatar/photo.png");
    const bytes = Buffer.from("valid-png-data");

    await assertFails(uploadBytes(bobAvatarRef, bytes, { contentType: "image/png" }));
  });

  it("denies uploading non-image MIME types (e.g. application/octet-stream, text/html)", async () => {
    const storage = testEnv.authenticatedContext("user_alice").storage();
    const avatarRef = ref(storage, "users/user_alice/avatar/script.html");
    const bytes = Buffer.from("<script>alert(1)</script>");

    await assertFails(uploadBytes(avatarRef, bytes, { contentType: "text/html" }));
  });

  it("allows Super Admin to upload organization logo", async () => {
    const superStorage = testEnv
      .authenticatedContext("user_super", { isSuperAdmin: true })
      .storage();
    const logoRef = ref(superStorage, "organizations/org_alpha/logo/logo.png");
    const bytes = Buffer.from("logo-image-data");

    await assertSucceeds(uploadBytes(logoRef, bytes, { contentType: "image/png" }));
  });

  it("denies regular user uploading directly to organization logo path", async () => {
    const userStorage = testEnv.authenticatedContext("user_alice").storage();
    const logoRef = ref(userStorage, "organizations/org_alpha/logo/logo.png");
    const bytes = Buffer.from("logo-image-data");

    await assertFails(uploadBytes(logoRef, bytes, { contentType: "image/png" }));
  });
});
