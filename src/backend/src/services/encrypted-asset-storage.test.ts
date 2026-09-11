import { PassThrough, Readable } from "stream";
import { describe, expect, it } from "vitest";
import { HttpError } from "../errors/http-error.js";
import { createEncryptedAssetStorageService } from "./encrypted-asset-storage.js";

type StoredFile = {
  _id: string;
  filename: string;
  data: Buffer;
  metadata: {
    storageId: string;
    byteLength: number;
    originalFilename?: string;
  };
};

class FakeGridFsBucket {
  readonly files = new Map<string, StoredFile>();
  private nextId = 1;

  find(filter: Record<string, unknown>) {
    const storageId = filter["metadata.storageId"];
    const matches = [...this.files.values()].filter((file) => file.metadata.storageId === storageId);

    return {
      async toArray() {
        return matches;
      }
    };
  }

  openUploadStream(filename: string, options?: Record<string, unknown>) {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    const _id = `gridfs-${this.nextId++}`;

    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    stream.on("finish", () => {
      const metadata = options?.metadata as StoredFile["metadata"];
      this.files.set(_id, {
        _id,
        filename,
        data: Buffer.concat(chunks),
        metadata
      });
    });

    return Object.assign(stream, { id: _id });
  }

  openDownloadStream(id: unknown) {
    const file = this.files.get(String(id));
    if (!file) {
      throw new Error("missing fake GridFS file");
    }

    return Readable.from(file.data);
  }

  async delete(id: unknown) {
    this.files.delete(String(id));
  }
}

describe("encrypted asset storage service", () => {
  it("stores encrypted bytes as opaque data behind a server-generated storage id", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 64 });
    const encryptedBytes = Buffer.from([0, 255, 10, 20, 30]);

    const stored = await service.storeEncryptedAsset({
      encryptedBytes,
      originalFilename: "report.pdf.enc"
    });

    expect(stored.storageId).toMatch(/^enc_asset_/);
    expect(stored.storageId).not.toContain("report.pdf.enc");
    expect(stored.byteLength).toBe(encryptedBytes.byteLength);
    expect(stored.originalFilename).toBe("report.pdf.enc");

    const [gridFsFile] = [...bucket.files.values()];
    expect(gridFsFile.filename).toBe(stored.storageId);
    expect(gridFsFile.metadata).toEqual({
      storageId: stored.storageId,
      byteLength: encryptedBytes.byteLength,
      originalFilename: "report.pdf.enc"
    });
    expect(gridFsFile.data).toEqual(encryptedBytes);
  });

  it("retrieves encrypted bytes without exposing GridFS internals", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 64 });
    const encryptedBytes = Buffer.from("ciphertext-only");
    const stored = await service.storeEncryptedAsset({ encryptedBytes });

    const retrieved = await service.getEncryptedAsset(stored.storageId);

    expect(retrieved).toEqual({
      storageId: stored.storageId,
      byteLength: encryptedBytes.byteLength,
      encryptedBytes
    });
    expect(retrieved).not.toHaveProperty("_id");
    expect(retrieved).not.toHaveProperty("filename");
  });

  it("deletes encrypted bytes by opaque storage id", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 64 });
    const stored = await service.storeEncryptedAsset({ encryptedBytes: Buffer.from("encrypted") });

    await expect(service.deleteEncryptedAsset(stored.storageId)).resolves.toBe(true);
    await expect(service.getEncryptedAsset(stored.storageId)).resolves.toBeNull();
    await expect(service.deleteEncryptedAsset(stored.storageId)).resolves.toBe(false);
  });

  it("enforces configurable size limits before storing", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 4 });

    await expect(
      service.storeEncryptedAsset({
        encryptedBytes: Buffer.from("12345")
      })
    ).rejects.toMatchObject({
      statusCode: 413,
      code: "ENCRYPTED_ASSET_TOO_LARGE"
    });
    expect(bucket.files.size).toBe(0);
  });

  it("rejects empty encrypted content", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 4 });

    await expect(service.storeEncryptedAsset({ encryptedBytes: Buffer.alloc(0) })).rejects.toMatchObject({
      statusCode: 400,
      code: "EMPTY_ENCRYPTED_ASSET"
    });
  });

  it("rejects original filenames with path segments", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 64 });

    await expect(
      service.storeEncryptedAsset({
        encryptedBytes: Buffer.from("encrypted"),
        originalFilename: "../secret.txt"
      })
    ).rejects.toBeInstanceOf(HttpError);

    await expect(
      service.storeEncryptedAsset({
        encryptedBytes: Buffer.from("encrypted"),
        originalFilename: "nested\\secret.txt"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_ORIGINAL_FILENAME"
    });
  });

  it("rejects malformed storage identifiers", async () => {
    const bucket = new FakeGridFsBucket();
    const service = createEncryptedAssetStorageService({ bucket, maxBytes: 64 });

    await expect(service.getEncryptedAsset("../../../gridfs-id")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_STORAGE_ID"
    });
    await expect(service.deleteEncryptedAsset("gridfs-1")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_STORAGE_ID"
    });
  });
});
