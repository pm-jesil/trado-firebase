/**
 * Core Image Processing Engine
 * 
 * Implements magic-byte sniffing, decompression bomb guards, metadata stripping,
 * EXIF orientation, WebP conversion, dimension/aspect validation, and Storage lifecycle.
 */

// Lazy-loaded sharp for faster cold-starts and zero startup latency on non-image callables
let _sharp: typeof import("sharp") | null = null;
async function getSharp(): Promise<typeof import("sharp")> {
  if (!_sharp) {
    const sharpModule = await import("sharp");
    _sharp = sharpModule.default;
  }
  return _sharp;
}
import crypto from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { db, getStorageBucket } from "./firebase.js";
import { getImagePolicy, ImagePurpose } from "../config/imagePolicy.js";
import { ImageRef } from "../types/models.js";

/** Sniff magic bytes to verify genuine image content independently of extension or MIME claim */
export function sniffImageMagicBytes(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" {
  if (!buffer || buffer.length < 12) {
    throw new HttpsError("invalid-argument", "[IMAGE_CORRUPT] Image file is too small or empty.", { reason: "IMAGE_CORRUPT" });
  }

  // Reject SVG / XML scripts
  const headStr = buffer.subarray(0, 100).toString("utf8").toLowerCase();
  if (headStr.includes("<svg") || headStr.includes("<?xml") || headStr.includes("<html") || headStr.includes("<script")) {
    throw new HttpsError("invalid-argument", "[IMAGE_TYPE_UNSUPPORTED] SVG and HTML files are strictly disallowed for security.", { reason: "IMAGE_TYPE_UNSUPPORTED" });
  }

  // Reject PDF
  if (buffer.subarray(0, 4).toString("utf8") === "%PDF") {
    throw new HttpsError("invalid-argument", "[IMAGE_TYPE_UNSUPPORTED] PDF files are not allowed as images.", { reason: "IMAGE_TYPE_UNSUPPORTED" });
  }

  // Reject GIF
  const gifHead = buffer.subarray(0, 4).toString("utf8");
  if (gifHead === "GIF8") {
    throw new HttpsError("invalid-argument", "[IMAGE_TYPE_UNSUPPORTED] Animated or GIF images are not supported.", { reason: "IMAGE_TYPE_UNSUPPORTED" });
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: RIFF ... WEBP
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") {
    return "image/webp";
  }

  throw new HttpsError("invalid-argument", "[IMAGE_TYPE_UNSUPPORTED] Unsupported image format. Only JPEG, PNG, and WebP are accepted.", { reason: "IMAGE_TYPE_UNSUPPORTED" });
}

export interface ProcessedImageResult {
  imageRef: ImageRef;
  contentHash: string;
  buffer: Buffer;
  thumbnailBuffer?: Buffer;
  thumbnailPath?: string;
}

/**
 * Validates, strips metadata, crops/resizes, and re-encodes image buffer to WebP.
 */
export async function processImageBuffer(
  inputBuffer: Buffer,
  purpose: ImagePurpose,
  targetFinalPathPrefix: string
): Promise<ProcessedImageResult> {
  const policy = getImagePolicy(purpose);

  if (inputBuffer.length > policy.rawUploadMaxBytes) {
    throw new HttpsError("invalid-argument", `[IMAGE_TOO_LARGE] Image size exceeds maximum allowed of ${policy.rawUploadMaxBytes / (1024 * 1024)} MB.`, { reason: "IMAGE_TOO_LARGE" });
  }

  // 1. Magic byte sniffing
  sniffImageMagicBytes(inputBuffer);

  // 2. Decode with Sharp with decompression bomb guard
  const sharp = await getSharp();
  const pipeline = sharp(inputBuffer, {
    limitInputPixels: 36_000_000, // 36 MP guard (e.g. 6000x6000)
    animated: false,              // Reject multi-frame
  });

  const metadata = await pipeline.metadata();

  if (!metadata.width || !metadata.height) {
    throw new HttpsError("invalid-argument", "[IMAGE_CORRUPT] Unable to determine image dimensions.", { reason: "IMAGE_CORRUPT" });
  }

  // Reject multi-page / multi-frame
  if (metadata.pages && metadata.pages > 1) {
    throw new HttpsError("invalid-argument", "[IMAGE_TYPE_UNSUPPORTED] Multi-frame animated images are not allowed.", { reason: "IMAGE_TYPE_UNSUPPORTED" });
  }

  // 3. Dimension checks
  if (metadata.width < policy.minWidth || metadata.height < policy.minHeight) {
    throw new HttpsError(
      "invalid-argument",
      `[IMAGE_DIMENSIONS_INVALID] Dimensions (${metadata.width}x${metadata.height}) are below required minimum (${policy.minWidth}x${policy.minHeight}).`,
      { reason: "IMAGE_DIMENSIONS_INVALID" }
    );
  }

  if (metadata.width > policy.maxWidth || metadata.height > policy.maxHeight) {
    throw new HttpsError(
      "invalid-argument",
      `[IMAGE_DIMENSIONS_INVALID] Dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed (${policy.maxWidth}x${policy.maxHeight}).`,
      { reason: "IMAGE_DIMENSIONS_INVALID" }
    );
  }

  const aspectRatio = metadata.width / metadata.height;
  if (policy.minAspectRatio && aspectRatio < policy.minAspectRatio) {
    throw new HttpsError("invalid-argument", `[IMAGE_DIMENSIONS_INVALID] Image aspect ratio too narrow (minimum is ${policy.minAspectRatio}).`, { reason: "IMAGE_DIMENSIONS_INVALID" });
  }
  if (policy.maxAspectRatio && aspectRatio > policy.maxAspectRatio) {
    throw new HttpsError("invalid-argument", `[IMAGE_DIMENSIONS_INVALID] Image aspect ratio too wide (maximum is ${policy.maxAspectRatio}).`, { reason: "IMAGE_DIMENSIONS_INVALID" });
  }

  // 4. Processing pipeline:
  // - Auto-rotate based on EXIF orientation
  // - Strip all metadata (default behavior for WebP re-encoding without withMetadata)
  // - Resize to standard
  // - Convert to WebP
  let transform = sharp(inputBuffer, { limitInputPixels: 36_000_000 })
    .rotate(); // Handles EXIF orientation before stripping

  if (policy.requireSquare) {
    transform = transform.resize(policy.outputMaxWidth, policy.outputMaxHeight, {
      fit: "cover",
      position: "centre",
    });
  } else {
    transform = transform.resize(policy.outputMaxWidth, policy.outputMaxHeight, {
      fit: policy.targetFit,
      withoutEnlargement: true,
    });
  }

  const processedBuffer = await transform.webp({ quality: 85 }).toBuffer();
  const processedMeta = await sharp(processedBuffer).metadata();

  const contentHash = crypto.createHash("sha256").update(processedBuffer).digest("hex").slice(0, 16);
  const finalPath = `${targetFinalPathPrefix}/${contentHash}.webp`;

  let thumbnailBuffer: Buffer | undefined;
  let thumbnailPath: string | undefined;

  if (policy.thumbnailMaxWidth && policy.thumbnailMaxHeight) {
    thumbnailBuffer = await sharp(inputBuffer, { limitInputPixels: 36_000_000 })
      .rotate()
      .resize(policy.thumbnailMaxWidth, policy.thumbnailMaxHeight, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    thumbnailPath = `${targetFinalPathPrefix}/${contentHash}_thumb.webp`;
  }

  const imageRef: ImageRef = {
    path: finalPath,
    contentType: "image/webp",
    width: processedMeta.width || policy.outputMaxWidth,
    height: processedMeta.height || policy.outputMaxHeight,
    sizeBytes: processedBuffer.length,
    updatedAt: new Date().toISOString(),
    /** D-15: thumbnailPath stored alongside main path (products only). No URL stored. */
    ...(thumbnailPath ? { thumbnailPath } : {}),
  };

  return {
    imageRef,
    contentHash,
    buffer: processedBuffer,
    thumbnailBuffer,
    thumbnailPath,
  };
}

export interface AttachImageParams {
  uploadId: string;
  purpose: ImagePurpose;
  entityType: "organization" | "user" | "customer" | "vendor" | "product";
  entityId: string;
  callerUid: string;
  scope: string; // orgId or "platform"
}

/**
 * Attaches a temporary upload to an entity, storing final WebP asset in Storage.
 */
export async function attachUploadedImage(params: AttachImageParams): Promise<ImageRef> {
  const sessionRef = db.collection("imageUploadSessions").doc(params.uploadId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "[UPLOAD_SESSION_EXPIRED] Upload session not found or expired.", { reason: "UPLOAD_SESSION_EXPIRED" });
  }

  const session = sessionSnap.data()!;
  if (session.isUsed) {
    throw new HttpsError("failed-precondition", "[UPLOAD_ALREADY_USED] This upload session has already been attached.", { reason: "UPLOAD_ALREADY_USED" });
  }

  if (session.callerUid !== params.callerUid) {
    throw new HttpsError("permission-denied", "[PERMISSION_DENIED] Upload session was created by another user.", { reason: "PERMISSION_DENIED" });
  }

  const now = new Date().toISOString();
  if (session.expiresAt && session.expiresAt < now) {
    throw new HttpsError("failed-precondition", "[UPLOAD_SESSION_EXPIRED] Upload session has expired. Please re-upload.", { reason: "UPLOAD_SESSION_EXPIRED" });
  }

  const bucket = getStorageBucket();
  const tmpFile = bucket.file(session.uploadPath);

  const [exists] = await tmpFile.exists();
  if (!exists) {
    throw new HttpsError("not-found", "[IMAGE_CORRUPT] Uploaded image not found in storage. Please upload again.", { reason: "IMAGE_CORRUPT" });
  }

  const [downloadedBytes] = await tmpFile.download();

  let prefix: string;
  if (params.entityType === "user") {
    prefix = `users/${params.entityId}/photo`;
  } else if (params.entityType === "organization") {
    prefix = `organizations/${params.entityId}/logo`;
  } else if (params.entityType === "customer" || params.entityType === "vendor") {
    prefix = `organizations/${params.scope}/parties/${params.entityId}`;
  } else if (params.entityType === "product") {
    prefix = `organizations/${params.scope}/products/${params.entityId}`;
  } else {
    prefix = params.scope === "platform"
      ? `platform/${params.purpose}/${params.entityId}`
      : `organizations/${params.scope}/${params.purpose}/${params.entityId}`;
  }

  const processed = await processImageBuffer(downloadedBytes, params.purpose, prefix);

  // Write final WebP asset
  const finalFile = bucket.file(processed.imageRef.path);
  await finalFile.save(processed.buffer, {
    contentType: "image/webp",
    metadata: {
      cacheControl: "public, max-age=86400",
      customMetadata: {
        entityType: params.entityType,
        entityId: params.entityId,
        purpose: params.purpose,
        scope: params.scope,
      },
    },
  });

  // Write thumbnail if present
  if (processed.thumbnailPath && processed.thumbnailBuffer) {
    const thumbFile = bucket.file(processed.thumbnailPath);
    await thumbFile.save(processed.thumbnailBuffer, {
      contentType: "image/webp",
      metadata: {
        cacheControl: "public, max-age=86400",
      },
    });
  }

  // Mark session used and delete temp file
  await sessionRef.update({
    isUsed: true,
    attachedAt: now,
    entityId: params.entityId,
    finalPath: processed.imageRef.path,
  });

  await tmpFile.delete({ ignoreNotFound: true });

  return processed.imageRef;
}

/**
 * D-15 / D-18: Single canonical hydration function for image display URLs across Trado.
 * Converts a stored ImageRef into a computed, read-only URL at read/response time.
 * In emulator, uses the local Storage emulator endpoint.
 * In cloud, returns standard Google Cloud Storage / CDN download URL.
 */
export function hydrateImageUrl(imageRef?: ImageRef | null): string | null {
  if (!imageRef?.path) return null;
  const bucket = process.env.STORAGE_BUCKET || "trado-x.appspot.com";
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (emulatorHost) {
    return `http://${emulatorHost}/v0/b/${bucket}/o/${encodeURIComponent(imageRef.path)}?alt=media`;
  }
  return `https://storage.googleapis.com/${bucket}/${imageRef.path}`;
}

