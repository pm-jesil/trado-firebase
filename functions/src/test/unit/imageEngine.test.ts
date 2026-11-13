import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sniffImageMagicBytes, processImageBuffer } from "../../services/imageEngine.js";

describe("Image Engine Unit Tests", () => {
  describe("Magic-Byte Sniffing & Injection Guards", () => {
    it("identifies authentic JPEG magic bytes (FF D8 FF)", () => {
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      const mime = sniffImageMagicBytes(jpegHeader);
      assert.strictEqual(mime, "image/jpeg");
    });

    it("identifies authentic PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)", () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const mime = sniffImageMagicBytes(pngHeader);
      assert.strictEqual(mime, "image/png");
    });

    it("identifies authentic WebP magic bytes (RIFF....WEBP)", () => {
      const webpHeader = Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from("WEBP"),
      ]);
      const mime = sniffImageMagicBytes(webpHeader);
      assert.strictEqual(mime, "image/webp");
    });

    it("rejects SVG XML script injection attempts with IMAGE_TYPE_UNSUPPORTED", () => {
      const svgPayload = Buffer.from("<svg onload='alert(\"XSS\")' xmlns='http://www.w3.org/2000/svg'></svg>");
      assert.throws(
        () => sniffImageMagicBytes(svgPayload),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TYPE_UNSUPPORTED"
      );
    });

    it("rejects HTML script injection attempts with IMAGE_TYPE_UNSUPPORTED", () => {
      const htmlPayload = Buffer.from("<html><script>document.location='http://evil.com'</script></html>");
      assert.throws(
        () => sniffImageMagicBytes(htmlPayload),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TYPE_UNSUPPORTED"
      );
    });

    it("rejects XML payloads with IMAGE_TYPE_UNSUPPORTED", () => {
      const xmlPayload = Buffer.from("<?xml version=\"1.0\" encoding=\"UTF-8\"?><root></root>");
      assert.throws(
        () => sniffImageMagicBytes(xmlPayload),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TYPE_UNSUPPORTED"
      );
    });

    it("rejects PDF documents masquerading as images with IMAGE_TYPE_UNSUPPORTED", () => {
      const pdfPayload = Buffer.from("%PDF-1.7 payload fake image content here");
      assert.throws(
        () => sniffImageMagicBytes(pdfPayload),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TYPE_UNSUPPORTED"
      );
    });

    it("rejects animated GIF files with IMAGE_TYPE_UNSUPPORTED", () => {
      const gifPayload = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00");
      assert.throws(
        () => sniffImageMagicBytes(gifPayload),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TYPE_UNSUPPORTED"
      );
    });

    it("rejects empty or truncated buffer (< 12 bytes) with IMAGE_CORRUPT", () => {
      const smallBuf = Buffer.from("tiny");
      assert.throws(
        () => sniffImageMagicBytes(smallBuf),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_CORRUPT"
      );
    });

    it("rejects arbitrary binary noise with IMAGE_TYPE_UNSUPPORTED", () => {
      const randomBuf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]);
      assert.throws(
        () => sniffImageMagicBytes(randomBuf),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TYPE_UNSUPPORTED"
      );
    });
  });

  describe("Sharp Processing Pipeline & Dimension Guard", () => {
    it("converts a valid PNG into optimized WebP and strips metadata", async () => {
      const sharp = (await import("sharp")).default;
      const validPng = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 50, g: 100, b: 150, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await processImageBuffer(validPng, "org_logo", "organizations/org-test/branding");
      assert.ok(result.buffer);
      assert.ok(result.contentHash);
      assert.strictEqual(result.imageRef.contentType, "image/webp");
      assert.ok(result.imageRef.path.endsWith(".webp"));

      // Verify output buffer is genuine WebP and matches dimensions
      const processedMeta = await sharp(result.buffer).metadata();
      assert.strictEqual(processedMeta.format, "webp");
      assert.strictEqual(processedMeta.width, 200);
      assert.strictEqual(processedMeta.height, 200);
    });

    it("rejects image smaller than required minimum dimensions", async () => {
      const sharp = (await import("sharp")).default;
      const tinyPng = await sharp({
        create: {
          width: 10,
          height: 10,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      await assert.rejects(
        async () => processImageBuffer(tinyPng, "org_logo", "organizations/org-test/branding"),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_DIMENSIONS_INVALID"
      );
    });

    it("rejects image exceeding raw upload size limit", async () => {
      const fakeBigBuffer = Buffer.alloc(3 * 1024 * 1024); // 3 MB > 2 MB max for logo
      await assert.rejects(
        async () => processImageBuffer(fakeBigBuffer, "org_logo", "organizations/org-test/branding"),
        (err: any) => err.code === "invalid-argument" && err.details?.reason === "IMAGE_TOO_LARGE"
      );
    });
  });
});
