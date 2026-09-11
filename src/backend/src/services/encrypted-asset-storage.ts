import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { HttpError } from "../errors/http-error.js";

const storageIdPattern = /^enc_asset_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxOriginalFilenameLength = 255;

type GridFsFile = {
  _id: unknown;
  length?: number;
  metadata?: {
    storageId?: string;
    originalFilename?: string;
    byteLength?: number;
  };
};

type GridFsCursor = {
  toArray(): Promise<GridFsFile[]>;
};

type GridFsUploadStream = NodeJS.WritableStream & {
  id?: unknown;
};

type GridFsBucketLike = {
  find(filter: Record<string, unknown>, options?: Record<string, unknown>): GridFsCursor;
  openUploadStream(filename: string, options?: Record<string, unknown>): GridFsUploadStream;
  openDownloadStream(id: unknown): NodeJS.ReadableStream;
  delete(id: unknown): Promise<void>;
};

export type StoreEncryptedAssetInput = {
  encryptedBytes: Buffer | Uint8Array;
  originalFilename?: string;
};

export type StoredEncryptedAsset = {
  storageId: string;
  byteLength: number;
  originalFilename?: string;
};

export type RetrievedEncryptedAsset = StoredEncryptedAsset & {
  encryptedBytes: Buffer;
};

export type EncryptedAssetStorageOptions = {
  bucket?: GridFsBucketLike;
  maxBytes?: number;
};

export type EncryptedAssetStorageService = {
  storeEncryptedAsset(input: StoreEncryptedAssetInput): Promise<StoredEncryptedAsset>;
  getEncryptedAsset(storageId: string): Promise<RetrievedEncryptedAsset | null>;
  deleteEncryptedAsset(storageId: string): Promise<boolean>;
};

function createStorageId() {
  return `enc_asset_${randomUUID()}`;
}

function normalizeOriginalFilename(originalFilename: string | undefined) {
  if (originalFilename === undefined) {
    return undefined;
  }

  const trimmed = originalFilename.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.length > maxOriginalFilenameLength) {
    throw new HttpError(400, "INVALID_ORIGINAL_FILENAME", "Original filename is too long");
  }

  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    /[\x00-\x1F\x7F<>:"|?*]/.test(trimmed)
  ) {
    throw new HttpError(400, "INVALID_ORIGINAL_FILENAME", "Original filename must not contain path segments");
  }

  return trimmed;
}

function assertValidStorageId(storageId: string) {
  if (!storageIdPattern.test(storageId)) {
    throw new HttpError(400, "INVALID_STORAGE_ID", "Storage identifier is invalid");
  }
}

function assertEncryptedBytesWithinLimit(encryptedBytes: Buffer | Uint8Array, maxBytes: number) {
  if (encryptedBytes.byteLength === 0) {
    throw new HttpError(400, "EMPTY_ENCRYPTED_ASSET", "Encrypted asset content is required");
  }

  if (encryptedBytes.byteLength > maxBytes) {
    throw new HttpError(413, "ENCRYPTED_ASSET_TOO_LARGE", "Encrypted asset exceeds the configured size limit");
  }
}

async function readEncryptedBytes(stream: NodeJS.ReadableStream, maxBytes: number) {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;

    if (byteLength > maxBytes) {
      throw new HttpError(413, "ENCRYPTED_ASSET_TOO_LARGE", "Stored encrypted asset exceeds the configured size limit");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks, byteLength);
}

function createDefaultBucket(): GridFsBucketLike {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  return new mongoose.mongo.GridFSBucket(db, {
    bucketName: env.GRIDFS_BUCKET_NAME
  });
}

export function createEncryptedAssetStorageService(
  options: EncryptedAssetStorageOptions = {}
): EncryptedAssetStorageService {
  const bucket = options.bucket ?? createDefaultBucket();
  const maxBytes = options.maxBytes ?? env.ENCRYPTED_ASSET_MAX_BYTES;

  return {
    async storeEncryptedAsset(input) {
      assertEncryptedBytesWithinLimit(input.encryptedBytes, maxBytes);

      const storageId = createStorageId();
      const byteLength = input.encryptedBytes.byteLength;
      const originalFilename = normalizeOriginalFilename(input.originalFilename);
      const uploadStream = bucket.openUploadStream(storageId, {
        metadata: {
          storageId,
          byteLength,
          ...(originalFilename ? { originalFilename } : {})
        }
      });

      await pipeline(Readable.from(Buffer.from(input.encryptedBytes)), uploadStream);

      return {
        storageId,
        byteLength,
        ...(originalFilename ? { originalFilename } : {})
      };
    },

    async getEncryptedAsset(storageId) {
      assertValidStorageId(storageId);

      const [file] = await bucket.find({ "metadata.storageId": storageId }, { limit: 1 }).toArray();
      if (!file) {
        return null;
      }

      const encryptedBytes = await readEncryptedBytes(bucket.openDownloadStream(file._id), maxBytes);
      const byteLength = file.metadata?.byteLength ?? file.length ?? encryptedBytes.byteLength;
      const originalFilename = file.metadata?.originalFilename;

      return {
        storageId,
        byteLength,
        encryptedBytes,
        ...(originalFilename ? { originalFilename } : {})
      };
    },

    async deleteEncryptedAsset(storageId) {
      assertValidStorageId(storageId);

      const [file] = await bucket.find({ "metadata.storageId": storageId }, { limit: 1 }).toArray();
      if (!file) {
        return false;
      }

      await bucket.delete(file._id);
      return true;
    }
  };
}

export async function storeEncryptedAsset(input: StoreEncryptedAssetInput) {
  return createEncryptedAssetStorageService().storeEncryptedAsset(input);
}

export async function getEncryptedAsset(storageId: string) {
  return createEncryptedAssetStorageService().getEncryptedAsset(storageId);
}

export async function deleteEncryptedAsset(storageId: string) {
  return createEncryptedAssetStorageService().deleteEncryptedAsset(storageId);
}
