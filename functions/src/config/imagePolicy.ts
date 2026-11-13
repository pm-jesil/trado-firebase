/**
 * Platform Image Policy
 * 
 * Single source of truth for allowed image types, size limits, dimensions,
 * aspect ratios, and processing outputs across Trado.
 * 
 * Generated to docs/generated/image-policy.json.
 */

export type ImagePurpose = "org_logo" | "user_photo" | "party_photo" | "product_image";

export interface ImageProcessingSpec {
  purpose: ImagePurpose;
  entityFields: string[];
  acceptedMimeTypes: string[];
  rawUploadMaxBytes: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  minAspectRatio?: number; // width / height
  maxAspectRatio?: number;
  requireSquare?: boolean;
  outputFormat: "webp";
  targetFit: "inside" | "cover";
  outputMaxWidth: number;
  outputMaxHeight: number;
  targetMaxBytes?: number;
  thumbnailMaxWidth?: number;
  thumbnailMaxHeight?: number;
}

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const IMAGE_POLICIES: Record<ImagePurpose, ImageProcessingSpec> = {
  org_logo: {
    purpose: "org_logo",
    entityFields: ["organizations.image"],
    acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    rawUploadMaxBytes: 2 * 1024 * 1024, // 2 MB
    minWidth: 128,
    minHeight: 128,
    maxWidth: 4096,
    maxHeight: 4096,
    minAspectRatio: 0.25, // 1:4
    maxAspectRatio: 4.0,  // 4:1
    outputFormat: "webp",
    targetFit: "inside",
    outputMaxWidth: 512,
    outputMaxHeight: 512,
    targetMaxBytes: 200 * 1024, // ~200 KB
  },
  user_photo: {
    purpose: "user_photo",
    entityFields: ["users.image"],
    acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    rawUploadMaxBytes: 2 * 1024 * 1024, // 2 MB
    minWidth: 128,
    minHeight: 128,
    maxWidth: 4096,
    maxHeight: 4096,
    requireSquare: true,
    outputFormat: "webp",
    targetFit: "cover",
    outputMaxWidth: 512,
    outputMaxHeight: 512,
    targetMaxBytes: 150 * 1024,
  },
  party_photo: {
    purpose: "party_photo",
    entityFields: ["customers.image", "vendors.image"],
    acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    rawUploadMaxBytes: 2 * 1024 * 1024, // 2 MB
    minWidth: 128,
    minHeight: 128,
    maxWidth: 4096,
    maxHeight: 4096,
    requireSquare: true,
    outputFormat: "webp",
    targetFit: "cover",
    outputMaxWidth: 512,
    outputMaxHeight: 512,
    targetMaxBytes: 150 * 1024,
  },
  product_image: {
    purpose: "product_image",
    entityFields: ["products.image", "products.images"],
    acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    rawUploadMaxBytes: 5 * 1024 * 1024, // 5 MB
    minWidth: 200,
    minHeight: 200,
    maxWidth: 6000,
    maxHeight: 6000,
    outputFormat: "webp",
    targetFit: "inside",
    outputMaxWidth: 1600,
    outputMaxHeight: 1600,
    thumbnailMaxWidth: 320,
    thumbnailMaxHeight: 320,
    targetMaxBytes: 800 * 1024,
  },
};

export function getImagePolicy(purpose: ImagePurpose): ImageProcessingSpec {
  const policy = IMAGE_POLICIES[purpose];
  if (!policy) {
    throw new Error(`Unknown image purpose: ${purpose}`);
  }
  return policy;
}
