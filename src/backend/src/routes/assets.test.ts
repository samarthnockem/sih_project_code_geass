import mongoose from "mongoose";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { createApp } from "../app.js";
import { AccessGrantModel } from "../models/access-grant.js";
import { AssetAuditEventModel } from "../models/asset-audit-event.js";
import { AssetModel } from "../models/asset.js";
import { AuditEventModel } from "../models/audit-event.js";
import { AssetVersionModel } from "../models/asset-version.js";
import { FolderModel } from "../models/folder.js";
import { UserModel } from "../models/user.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import * as blockchainRead from "../services/blockchain-read.js";
import * as encryptedAssetStorage from "../services/encrypted-asset-storage.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const spoofedWallet = "0x2222222222222222222222222222222222222222";
const aliceWallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bobWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const validSha256 = "a".repeat(64);
const currentHash = `0x${"b".repeat(64)}`;
const storageId = "enc_asset_11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);
});

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

function authenticatedCookie(walletAddress = ownerWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function validUploadRequest() {
  return request(createApp())
    .post("/api/assets")
    .set("Cookie", authenticatedCookie())
    .field("filename", "vault-document.pdf.enc")
    .field("mimeType", "application/pdf")
    .field("originalSize", "428000")
    .field("sha256", validSha256)
    .field("wrappedAESKey", "wrapped-key-for-owner")
    .field(
      "encryptionMetadata",
      JSON.stringify({
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      })
    )
    .field(
      "wrappingMetadata",
      JSON.stringify({
        algorithm: "RSA-OAEP",
        keyId: "owner-key-1"
      })
    )
    .attach("encryptedFile", Buffer.from("encrypted-bytes"), {
      filename: "vault-document.pdf.enc",
      contentType: "application/octet-stream"
    });
}

function validUploadRequestWithWrapping(wrappingMetadata: unknown, passwordProtectionEnabled: "true" | "false") {
  return request(createApp())
    .post("/api/assets")
    .set("Cookie", authenticatedCookie())
    .field("filename", "vault-document.pdf.enc")
    .field("mimeType", "application/pdf")
    .field("originalSize", "428000")
    .field("sha256", validSha256)
    .field("wrappedAESKey", "wrapped-key-for-owner")
    .field("encryptionMetadata", JSON.stringify({
      algorithm: "AES-256-GCM",
      iv: "base64-iv",
      tag: "base64-tag"
    }))
    .field("wrappingMetadata", JSON.stringify(wrappingMetadata))
    .field("passwordProtectionEnabled", passwordProtectionEnabled)
    .attach("encryptedFile", Buffer.from("encrypted-bytes"), {
      filename: "vault-document.pdf.enc",
      contentType: "application/octet-stream"
    });
}

function mockSuccessfulPersistence() {
  const assetId = new mongoose.Types.ObjectId();

  const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset").mockResolvedValue({
    storageId: "enc_asset_11111111-1111-4111-8111-111111111111",
    byteLength: 15,
    originalFilename: "vault-document.pdf.enc"
  });
  const assetCreateSpy = vi.spyOn(AssetModel, "create").mockResolvedValue({
    _id: assetId,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z")
  } as never);
  const versionCreateSpy = vi.spyOn(AssetVersionModel, "create").mockResolvedValue({} as never);
  const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create").mockResolvedValue({} as never);
  const auditCreateSpy = vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);
  const productAuditCreateSpy = vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);

  return {
    assetId,
    storeSpy,
    assetCreateSpy,
    versionCreateSpy,
    wrappedKeyCreateSpy,
    auditCreateSpy,
    productAuditCreateSpy
  };
}

function queryResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value)
    })
  };
}

function updatedQueryResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value)
    })
  };
}

function sortedQueryResult<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(value)
      })
    })
  };
}

function eventQueryResult<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(value)
        })
      })
    })
  };
}

function sortedSingleQueryResult<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(value)
      })
    })
  };
}

function mockBlockchainPermission(permission: "NONE" | "READ" | "WRITE", currentVersion = 2) {
  return vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
    getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
    getPermission: vi.fn().mockResolvedValue(permission),
    getCurrentHash: vi.fn().mockResolvedValue(currentHash),
    getCurrentVersion: vi.fn().mockResolvedValue(currentVersion),
    verifyAssetRegistration: vi.fn(),
    verifyAccessGrant: vi.fn(),
    verifyAccessRevoke: vi.fn()
  });
}

function mockOpenRoutePersistence(options: {
  wallet?: string;
  currentVersion?: number;
  wrappedKey?: string | null;
  assetId?: mongoose.Types.ObjectId;
} = {}) {
  const assetId = options.assetId ?? new mongoose.Types.ObjectId();
  const currentVersion = options.currentVersion ?? 2;
  const wallet = options.wallet ?? aliceWallet;
  const wrappedKey = options.wrappedKey === undefined ? "wrapped-key-for-current-user" : options.wrappedKey;

  const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(
    queryResult({
      _id: assetId,
      ownerWallet,
      filename: "vault-document.pdf.enc",
      size: 2048,
      mimeType: "application/pdf",
      blockchainAssetId: "123",
      blockchainVerificationStatus: "verified",
      status: "ACTIVE"
    }) as never
  );
  const versionFindSpy = vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(
    queryResult({
      encryptedStorageReference: storageId,
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      sha256: "b".repeat(64),
      version: currentVersion
    }) as never
  );
  const wrappedKeyFindSpy = vi.spyOn(WrappedKeyModel, "findOne").mockReturnValue(
    queryResult(
      wrappedKey
        ? {
            userWallet: wallet,
            wrappedAESKey: wrappedKey,
            wrappingMetadata: {
              algorithm: "RSA-OAEP",
              keyId: "user-key-1"
            }
          }
        : null
    ) as never
  );
  const encryptedAssetSpy = vi.spyOn(encryptedAssetStorage, "getEncryptedAsset").mockResolvedValue({
    storageId,
    byteLength: Buffer.from("encrypted-bytes").byteLength,
    encryptedBytes: Buffer.from("encrypted-bytes")
  });
  const productAuditCreateSpy = vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);

  return {
    assetId,
    assetFindSpy,
    versionFindSpy,
    wrappedKeyFindSpy,
    encryptedAssetSpy,
    productAuditCreateSpy
  };
}

describe("encrypted asset upload route", () => {
  it("requires authentication", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await request(createApp())
      .post("/api/assets")
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("creates asset metadata, version storage reference, and owner wrapped key", async () => {
    const { assetId, storeSpy, assetCreateSpy, versionCreateSpy, wrappedKeyCreateSpy, auditCreateSpy } =
      mockSuccessfulPersistence();

    const response = await validUploadRequest().expect(201);

    expect(response.body).toEqual({
      asset: {
        id: assetId.toString(),
        ownerWallet,
        filename: "vault-document.pdf.enc",
        size: 428000,
        mimeType: "application/pdf",
        sha256: validSha256,
        currentVersion: 1,
        status: "PENDING_BLOCKCHAIN",
        blockchainVerificationStatus: "pending",
        passwordProtectionEnabled: false,
        folderId: null,
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z"
      }
    });
    expect(response.body.asset).not.toHaveProperty("encryptedStorageReference");
    expect(response.body.asset).not.toHaveProperty("wrappedAESKey");

    expect(storeSpy).toHaveBeenCalledWith({
      encryptedBytes: Buffer.from("encrypted-bytes"),
      originalFilename: "vault-document.pdf.enc"
    });
    expect(assetCreateSpy).toHaveBeenCalledWith({
      ownerWallet,
      filename: "vault-document.pdf.enc",
      size: 428000,
      mimeType: "application/pdf",
      currentVersion: 1,
      sha256: validSha256,
      status: "PENDING_BLOCKCHAIN",
      blockchainVerificationStatus: "pending",
      passwordProtectionEnabled: false,
      folderId: null
    });
    expect(versionCreateSpy).toHaveBeenCalledWith({
      assetId,
      version: 1,
      encryptedStorageReference: "enc_asset_11111111-1111-4111-8111-111111111111",
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      sha256: validSha256,
      createdBy: ownerWallet,
      commitMessage: "Initial encrypted upload"
    });
    expect(wrappedKeyCreateSpy).toHaveBeenCalledWith({
      assetId,
      userWallet: ownerWallet,
      wrappedAESKey: "wrapped-key-for-owner",
      version: 1,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "owner-key-1"
      },
      active: true
    });
    expect(auditCreateSpy).toHaveBeenCalledWith({
      assetId,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_UPLOADED",
      fromFolderId: null,
      toFolderId: null
    });
  });

  it("stores only ciphertext and safe metadata during encrypted upload", async () => {
    const plaintextSentinel = "plain-secret-document-body";
    const rawAesKeySentinel = "raw-aes-key-material";
    const ciphertext = Buffer.from("ciphertext");
    const { storeSpy, assetCreateSpy, versionCreateSpy, wrappedKeyCreateSpy, auditCreateSpy } = mockSuccessfulPersistence();

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("mimeType", "application/pdf")
      .field("originalSize", String(plaintextSentinel.length))
      .field("sha256", validSha256)
      .field("wrappedAESKey", "owner-or-password-wrapped-key")
      .field(
        "encryptionMetadata",
        JSON.stringify({
          algorithm: "AES-256-GCM",
          iv: "base64-iv",
          tag: "base64-tag"
        })
      )
      .field(
        "wrappingMetadata",
        JSON.stringify({
          algorithm: "RSA-OAEP",
          keyId: "owner-key-1"
        })
      )
      .field("passwordProtectionEnabled", "false")
      .attach("encryptedFile", ciphertext, {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(201);

    expect(storeSpy).toHaveBeenCalledWith({
      encryptedBytes: ciphertext,
      originalFilename: "vault-document.pdf.enc"
    });

    const persistedValues = JSON.stringify([
      assetCreateSpy.mock.calls,
      versionCreateSpy.mock.calls,
      wrappedKeyCreateSpy.mock.calls,
      auditCreateSpy.mock.calls
    ]);
    expect(persistedValues).not.toContain(plaintextSentinel);
    expect(persistedValues).not.toContain(rawAesKeySentinel);
    expect(persistedValues).not.toContain("plaintextFile");
    expect(persistedValues).not.toContain("rawAESKey");
  });

  it("rejects plaintext and raw AES key fields before storing encrypted upload data", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const assetCreateSpy = vi.spyOn(AssetModel, "create");
    const versionCreateSpy = vi.spyOn(AssetVersionModel, "create");
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create");
    const auditCreateSpy = vi.spyOn(AssetAuditEventModel, "create");

    const response = await validUploadRequest()
      .field("plaintextFile", "plain-secret-document-body")
      .field("rawAESKey", "raw-aes-key-material")
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
    expect(assetCreateSpy).not.toHaveBeenCalled();
    expect(versionCreateSpy).not.toHaveBeenCalled();
    expect(wrappedKeyCreateSpy).not.toHaveBeenCalled();
    expect(auditCreateSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads before storage", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("x".repeat(17)), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(413);

    expect(response.body.error.code).toBe("ENCRYPTED_ASSET_TOO_LARGE");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects malicious filenames", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "../secret.txt")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "safe-name.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects forbidden secret fields", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const topLevelSecret = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("rawAESKey", "must-not-be-accepted")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    const nestedSecret = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", aesKey: "raw-secret" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(topLevelSecret.body.error.code).toBe("VALIDATION_ERROR");
    expect(nestedSecret.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects forbidden secret field aliases in upload metadata", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag", private_key: "x" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag" }))
      .field("wrappingMetadata", JSON.stringify({ algorithm: "RSA-OAEP", keyId: "owner-key-1", secret_key: "x" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects wrapped AES key uploads without owner key-wrapping metadata", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "candidate-raw-or-wrapped-key")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
    expect(wrappedKeyCreateSpy).not.toHaveBeenCalled();
  });

  it("requires declared AES-256-GCM metadata and opaque encrypted bytes", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-128-CBC", iv: "iv", tag: "tag" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag" }))
      .attach("encryptedFile", Buffer.from("plaintext"), {
        filename: "vault-document.pdf.enc",
        contentType: "text/plain"
      })
      .expect(400);

    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects owner spoofing and uses the authenticated wallet as owner", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const assetCreateSpy = vi.spyOn(AssetModel, "create");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie(ownerWallet))
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("ownerWallet", spoofedWallet)
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
    expect(assetCreateSpy).not.toHaveBeenCalled();
  });

  it("allows initial upload into an owned folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const { assetCreateSpy } = mockSuccessfulPersistence();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: folderId }) as never);

    const response = await validUploadRequest().field("folderId", folderId).expect(201);

    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet });
    expect(assetCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerWallet,
        folderId
      })
    );
    expect(response.body.asset.folderId).toBe(folderId);
  });

  it("accepts password-wrapped owner keys only when password protection is enabled", async () => {
    const { wrappedKeyCreateSpy } = mockSuccessfulPersistence();
    const wrappingMetadata = {
      algorithm: "PBKDF2-SHA-256+A256GCM",
      kdf: {
        algorithm: "PBKDF2-SHA-256",
        iterations: 310000,
        salt: "base64-random-salt"
      },
      keyEncryption: {
        algorithm: "AES-256-GCM",
        iv: "base64-wrapping-iv"
      }
    };

    const response = await validUploadRequestWithWrapping(wrappingMetadata, "true").expect(201);

    expect(response.body.asset.passwordProtectionEnabled).toBe(true);
    expect(wrappedKeyCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userWallet: ownerWallet,
        wrappedAESKey: "wrapped-key-for-owner",
        wrappingMetadata
      })
    );
  });

  it("rejects wrapping metadata that bypasses the selected password protection mode", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const passwordWrappingMetadata = {
      algorithm: "PBKDF2-SHA-256+A256GCM",
      kdf: {
        algorithm: "PBKDF2-SHA-256",
        iterations: 310000,
        salt: "base64-random-salt"
      },
      keyEncryption: {
        algorithm: "AES-256-GCM",
        iv: "base64-wrapping-iv"
      }
    };

    const passwordEnabledWithRsa = await validUploadRequest()
      .field("passwordProtectionEnabled", "true")
      .expect(400);
    const passwordDisabledWithPasswordWrapping = await validUploadRequestWithWrapping(
      passwordWrappingMetadata,
      "false"
    ).expect(400);

    expect(passwordEnabledWithRsa.body.error.code).toBe("VALIDATION_ERROR");
    expect(passwordDisabledWithPasswordWrapping.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects initial upload into another user's folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const assetCreateSpy = vi.spyOn(AssetModel, "create");
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);

    const response = await validUploadRequest().field("folderId", folderId).expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet });
    expect(storeSpy).not.toHaveBeenCalled();
    expect(assetCreateSpy).not.toHaveBeenCalled();
  });
});

describe("asset blockchain sync route", () => {
  const transactionHash = `0x${"c".repeat(64)}`;

  function pendingAsset(assetId = new mongoose.Types.ObjectId()) {
    return {
      _id: assetId,
      ownerWallet,
      filename: "vault-document.pdf.enc",
      size: 428000,
      mimeType: "application/pdf",
      sha256: validSha256,
      currentVersion: 1,
      status: "PENDING_BLOCKCHAIN",
      passwordProtectionEnabled: false,
      folderId: null,
      blockchainAssetId: null,
      registrationTransactionHash: null,
      registrationBlockNumber: null,
      blockchainVerificationStatus: "pending",
      createdAt: new Date("2026-09-08T00:00:00.000Z"),
      updatedAt: new Date("2026-09-08T00:00:00.000Z")
    };
  }

  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp())
      .post(`/api/assets/${new mongoose.Types.ObjectId().toString()}/blockchain-sync`)
      .send({ transactionHash })
      .expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("verifies the registration transaction before activating the pending asset", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const asset = pendingAsset(assetId);
    const blockchainAssetId = "106255228680254284463304465034750468134373778696928162154853679069113142702707";
    const blockchainVerifySpy = vi.fn().mockResolvedValue({
      blockchainAssetId,
      transactionHash,
      blockNumber: 12345,
      ownerWallet,
      sha256: validSha256
    });
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn(),
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: blockchainVerifySpy
    });
    const assetFindSpy = vi
      .spyOn(AssetModel, "findOne")
      .mockReturnValueOnce(queryResult(asset) as never)
      .mockReturnValueOnce(queryResult(null) as never);
    const updateSpy = vi.spyOn(AssetModel, "findOneAndUpdate").mockReturnValue(
      updatedQueryResult({
        ...asset,
        status: "ACTIVE",
        blockchainVerificationStatus: "verified",
        blockchainAssetId,
        registrationTransactionHash: transactionHash,
        registrationBlockNumber: 12345
      }) as never
    );

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/blockchain-sync`)
      .set("Cookie", authenticatedCookie())
      .send({ transactionHash })
      .expect(200);

    expect(assetFindSpy).toHaveBeenNthCalledWith(1, { _id: assetId.toString(), ownerWallet });
    expect(blockchainVerifySpy).toHaveBeenCalledWith({
      transactionHash,
      applicationAssetId: assetId.toString(),
      expectedOwnerWallet: ownerWallet,
      expectedSha256: validSha256
    });
    expect(updateSpy).toHaveBeenCalledWith(
      {
        _id: assetId.toString(),
        ownerWallet,
        registrationTransactionHash: { $in: [null, transactionHash] }
      },
      {
        $set: {
          blockchainAssetId,
          registrationTransactionHash: transactionHash,
          registrationBlockNumber: 12345,
          status: "ACTIVE",
          blockchainVerificationStatus: "verified"
        }
      },
      {
        new: true,
        runValidators: true
      }
    );
    expect(response.body.asset).toMatchObject({
      id: assetId.toString(),
      status: "ACTIVE",
      blockchainVerificationStatus: "verified",
      blockchainAssetId,
      registrationTransactionHash: transactionHash,
      registrationBlockNumber: 12345
    });
  });

  it.each([
    ["wrong owner"],
    ["wrong asset reference"],
    ["wrong SHA-256 hash"],
    ["failed transaction"]
  ])("rejects a registration transaction with %s", async (reason) => {
    const assetId = new mongoose.Types.ObjectId();
    const asset = pendingAsset(assetId);
    const blockchainVerifySpy = vi.fn().mockRejectedValue(new blockchainRead.BlockchainVerificationError(reason));
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn(),
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: blockchainVerifySpy
    });
    vi.spyOn(AssetModel, "findOne")
      .mockReturnValueOnce(queryResult(asset) as never)
      .mockReturnValueOnce(queryResult(null) as never);
    const updateSpy = vi.spyOn(AssetModel, "findOneAndUpdate");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/blockchain-sync`)
      .set("Cookie", authenticatedCookie())
      .send({ transactionHash })
      .expect(400);

    expect(response.body.error.code).toBe("BLOCKCHAIN_VERIFICATION_FAILED");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects a transaction already linked to another asset", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const otherAssetId = new mongoose.Types.ObjectId();
    const asset = pendingAsset(assetId);
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");
    vi.spyOn(AssetModel, "findOne")
      .mockReturnValueOnce(queryResult(asset) as never)
      .mockReturnValueOnce(queryResult({ _id: otherAssetId }) as never);
    const updateSpy = vi.spyOn(AssetModel, "findOneAndUpdate");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/blockchain-sync`)
      .set("Cookie", authenticatedCookie())
      .send({ transactionHash })
      .expect(409);

    expect(response.body.error.code).toBe("BLOCKCHAIN_TRANSACTION_ALREADY_USED");
    expect(blockchainSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("asset access grant sync route", () => {
  const grantTxHash = `0x${"e".repeat(64)}`;
  const blockchainAssetId = "100";
  const granteeWallet = aliceWallet;

  function registeredAsset(assetId = new mongoose.Types.ObjectId(), overrides: Record<string, unknown> = {}) {
    return {
      _id: assetId,
      ownerWallet,
      filename: "vault-document.pdf.enc",
      currentVersion: 2,
      status: "ACTIVE",
      blockchainAssetId,
      blockchainVerificationStatus: "verified",
      ...overrides
    };
  }

  function validGrantBody(overrides: Record<string, unknown> = {}) {
    return {
      granteeWallet,
      wrappedAESKey: "wrapped-key-for-grantee",
      accessType: "READ",
      validFrom: 0,
      validUntil: 0,
      reason: "Review",
      granteeDisplayName: "Alice",
      blockchainTransactionHash: grantTxHash,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "alice-key-1"
      },
      ...overrides
    };
  }

  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp())
      .post(`/api/assets/${new mongoose.Types.ObjectId().toString()}/access/grant-sync`)
      .send(validGrantBody())
      .expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("verifies blockchain owner and AccessGranted event before storing grant metadata and wrapped key", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const grantId = new mongoose.Types.ObjectId();
    const asset = registeredAsset(assetId);
    const verifiedGrant = {
      blockchainAssetId,
      transactionHash: grantTxHash,
      blockNumber: 44,
      ownerWallet,
      granteeWallet,
      accessType: "READ" as const,
      validFrom: 0,
      validUntil: 0
    };
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(asset) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult(null) as never);
    const accessGrantCreateSpy = vi.spyOn(AccessGrantModel, "create").mockResolvedValue({ _id: grantId } as never);
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create").mockResolvedValue({} as never);
    const auditCreateSpy = vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);
    const verifyAccessGrantSpy = vi.fn().mockResolvedValue(verifiedGrant);
    const getAssetOwnerSpy = vi.fn().mockResolvedValue(ownerWallet);
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: getAssetOwnerSpy,
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: verifyAccessGrantSpy
    });

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody())
      .expect(201);

    expect(getAssetOwnerSpy).toHaveBeenCalledWith(blockchainAssetId);
    expect(verifyAccessGrantSpy).toHaveBeenCalledWith({
      transactionHash: grantTxHash,
      blockchainAssetId,
      expectedOwnerWallet: ownerWallet,
      expectedGranteeWallet: granteeWallet,
      expectedAccessType: "READ",
      expectedValidFrom: 0,
      expectedValidUntil: 0
    });
    expect(accessGrantCreateSpy).toHaveBeenCalledWith({
      assetId,
      ownerWallet,
      granteeWallet,
      granteeDisplayName: "Alice",
      accessType: "READ",
      validFrom: undefined,
      validUntil: undefined,
      reason: "Review",
      blockchainTxHash: grantTxHash,
      status: "ACTIVE"
    });
    expect(wrappedKeyCreateSpy).toHaveBeenCalledWith({
      assetId,
      userWallet: granteeWallet,
      wrappedAESKey: "wrapped-key-for-grantee",
      version: 2,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "alice-key-1"
      },
      active: true
    });
    expect(auditCreateSpy).toHaveBeenCalledWith({
      assetId,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_ACCESS_GRANTED",
      fromFolderId: null,
      toFolderId: null
    });
    expect(response.body.accessGrant).toMatchObject({
      id: grantId.toString(),
      assetId: assetId.toString(),
      ownerWallet,
      granteeWallet,
      granteeDisplayName: "Alice",
      accessType: "READ",
      validFrom: null,
      validUntil: null,
      reason: "Review",
      blockchainTxHash: grantTxHash,
      blockNumber: 44,
      status: "ACTIVE"
    });
  });

  it("stores explicit validity windows as metadata after event verification", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const validFrom = 1788971000;
    const validUntil = 1789057400;
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult(null) as never);
    const accessGrantCreateSpy = vi.spyOn(AccessGrantModel, "create").mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as never);
    vi.spyOn(WrappedKeyModel, "create").mockResolvedValue({} as never);
    vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn().mockResolvedValue({
        blockchainAssetId,
        transactionHash: grantTxHash,
        blockNumber: 44,
        ownerWallet,
        granteeWallet,
        accessType: "WRITE",
        validFrom,
        validUntil
      })
    });

    await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody({ accessType: "WRITE", validFrom, validUntil }))
      .expect(201);

    expect(accessGrantCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accessType: "WRITE",
        validFrom: new Date(validFrom * 1000),
        validUntil: new Date(validUntil * 1000)
      })
    );
  });

  it("does not allow a non-owner to sync an access grant", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(null) as never);
    const grantCreateSpy = vi.spyOn(AccessGrantModel, "create");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .send(validGrantBody())
      .expect(404);

    expect(response.body.error.code).toBe("ASSET_NOT_FOUND");
    expect(assetFindSpy).toHaveBeenCalledWith({ _id: assetId.toString(), ownerWallet: aliceWallet });
    expect(grantCreateSpy).not.toHaveBeenCalled();
  });

  it("requires the asset to be registered and verified before syncing a grant", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult(
        registeredAsset(assetId, {
          blockchainAssetId: null,
          blockchainVerificationStatus: "pending"
        })
      ) as never
    );
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody())
      .expect(409);

    expect(response.body.error.code).toBe("ASSET_NOT_REGISTERED_ON_CHAIN");
    expect(blockchainSpy).not.toHaveBeenCalled();
  });

  it("rejects transaction replay before storing metadata or wrapped keys", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult({ _id: new mongoose.Types.ObjectId() }) as never);
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody())
      .expect(409);

    expect(response.body.error.code).toBe("BLOCKCHAIN_TRANSACTION_ALREADY_USED");
    expect(blockchainSpy).not.toHaveBeenCalled();
    expect(wrappedKeyCreateSpy).not.toHaveBeenCalled();
  });

  it("rejects when blockchain owner does not match authenticated owner", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(bobWallet),
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn()
    });
    const grantCreateSpy = vi.spyOn(AccessGrantModel, "create");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody())
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(grantCreateSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong grantee"],
    ["wrong permission"],
    ["wrong validity window"],
    ["failed transaction"]
  ])("rejects a grant transaction with %s", async (reason) => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn().mockRejectedValue(new blockchainRead.BlockchainVerificationError(reason))
    });
    const accessGrantCreateSpy = vi.spyOn(AccessGrantModel, "create");
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody())
      .expect(400);

    expect(response.body.error.code).toBe("BLOCKCHAIN_VERIFICATION_FAILED");
    expect(accessGrantCreateSpy).not.toHaveBeenCalled();
    expect(wrappedKeyCreateSpy).not.toHaveBeenCalled();
  });

  it("rejects raw key fields and unsafe wrapping metadata before touching persistence", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");
    const accessGrantCreateSpy = vi.spyOn(AccessGrantModel, "create");

    await request(createApp())
      .post(`/api/assets/${new mongoose.Types.ObjectId().toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validGrantBody({ rawAESKey: "must-not-be-accepted" }))
      .expect(400);

    await request(createApp())
      .post(`/api/assets/${new mongoose.Types.ObjectId().toString()}/access/grant-sync`)
      .set("Cookie", authenticatedCookie())
      .send(
        validGrantBody({
          wrappingMetadata: {
            algorithm: "RSA-OAEP",
            keyId: "alice-key-1",
            secretKey: "must-not-be-stored"
          }
        })
      )
      .expect(400);

    expect(assetFindSpy).not.toHaveBeenCalled();
    expect(accessGrantCreateSpy).not.toHaveBeenCalled();
  });
});

describe("asset access revoke sync route", () => {
  const blockchainAssetId = "100";
  const revokeTxHash = `0x${"d".repeat(64)}`;
  const grantTxHash = `0x${"e".repeat(64)}`;
  const granteeWallet = aliceWallet;

  function registeredAsset(assetId = new mongoose.Types.ObjectId(), overrides: Record<string, unknown> = {}) {
    return {
      _id: assetId,
      ownerWallet,
      filename: "vault-document.pdf.enc",
      status: "ACTIVE",
      blockchainAssetId,
      blockchainVerificationStatus: "verified",
      ...overrides
    };
  }

  function validRevokeBody(overrides: Record<string, unknown> = {}) {
    return {
      granteeWallet,
      blockchainTransactionHash: revokeTxHash,
      ...overrides
    };
  }

  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp())
      .post(`/api/assets/${new mongoose.Types.ObjectId().toString()}/access/revoke-sync`)
      .send(validRevokeBody())
      .expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("verifies owner, AccessRevoked event, NONE permission, then revokes grants and deactivates wrapped keys", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(queryResult(null) as never);
    const grantUpdateSpy = vi.spyOn(AccessGrantModel, "updateMany").mockResolvedValue({ modifiedCount: 1 } as never);
    const wrappedKeyUpdateSpy = vi.spyOn(WrappedKeyModel, "updateMany").mockResolvedValue({ modifiedCount: 1 } as never);
    const assetAuditCreateSpy = vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);
    const verifyAccessRevokeSpy = vi.fn().mockResolvedValue({
      blockchainAssetId,
      transactionHash: revokeTxHash,
      blockNumber: 45,
      ownerWallet,
      granteeWallet
    });
    const getPermissionSpy = vi.fn().mockResolvedValue("NONE");
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: getPermissionSpy,
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn(),
      verifyAccessRevoke: verifyAccessRevokeSpy
    });

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/revoke-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validRevokeBody())
      .expect(200);

    expect(verifyAccessRevokeSpy).toHaveBeenCalledWith({
      transactionHash: revokeTxHash,
      blockchainAssetId,
      expectedOwnerWallet: ownerWallet,
      expectedGranteeWallet: granteeWallet
    });
    expect(getPermissionSpy).toHaveBeenCalledWith(blockchainAssetId, granteeWallet);
    expect(grantUpdateSpy).toHaveBeenCalledWith(
      {
        assetId,
        ownerWallet,
        granteeWallet,
        status: "ACTIVE"
      },
      {
        $set: {
          status: "REVOKED",
          revokedAt: expect.any(Date)
        }
      }
    );
    expect(wrappedKeyUpdateSpy).toHaveBeenCalledWith(
      {
        assetId,
        userWallet: granteeWallet,
        active: true
      },
      {
        $set: {
          active: false
        }
      }
    );
    expect(assetAuditCreateSpy).toHaveBeenCalledWith({
      assetId,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_ACCESS_REVOKED",
      fromFolderId: null,
      toFolderId: null
    });
    expect(AuditEventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: ownerWallet,
        assetId,
        action: "ACCESS_REVOKED",
        blockchainTxHash: revokeTxHash
      })
    );
    expect(response.body.revokedAccess).toMatchObject({
      assetId: assetId.toString(),
      ownerWallet,
      granteeWallet,
      blockchainTxHash: revokeTxHash,
      blockNumber: 45,
      status: "REVOKED"
    });
  });

  it("rejects revoke transaction replay before blockchain verification or persistence updates", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValueOnce(queryResult(null) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(queryResult({ _id: new mongoose.Types.ObjectId() }) as never);
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");
    const wrappedKeyUpdateSpy = vi.spyOn(WrappedKeyModel, "updateMany");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/revoke-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validRevokeBody())
      .expect(409);

    expect(response.body.error.code).toBe("BLOCKCHAIN_TRANSACTION_ALREADY_USED");
    expect(blockchainSpy).not.toHaveBeenCalled();
    expect(wrappedKeyUpdateSpy).not.toHaveBeenCalled();
  });

  it("rejects if the grantee permission is not NONE after the revoke transaction", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: vi.fn().mockResolvedValue("READ"),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn(),
      verifyAccessRevoke: vi.fn().mockResolvedValue({
        blockchainAssetId,
        transactionHash: revokeTxHash,
        blockNumber: 45,
        ownerWallet,
        granteeWallet
      })
    });
    const grantUpdateSpy = vi.spyOn(AccessGrantModel, "updateMany");
    const wrappedKeyUpdateSpy = vi.spyOn(WrappedKeyModel, "updateMany");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/revoke-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validRevokeBody())
      .expect(400);

    expect(response.body.error.code).toBe("BLOCKCHAIN_VERIFICATION_FAILED");
    expect(grantUpdateSpy).not.toHaveBeenCalled();
    expect(wrappedKeyUpdateSpy).not.toHaveBeenCalled();
  });

  it("rejects grant transaction hashes as revoke replay", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "findOne").mockReturnValue(queryResult({ _id: new mongoose.Types.ObjectId(), blockchainTxHash: grantTxHash }) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(queryResult(null) as never);
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/revoke-sync`)
      .set("Cookie", authenticatedCookie())
      .send(validRevokeBody({ blockchainTransactionHash: grantTxHash }))
      .expect(409);

    expect(response.body.error.code).toBe("BLOCKCHAIN_TRANSACTION_ALREADY_USED");
    expect(blockchainSpy).not.toHaveBeenCalled();
  });
});

describe("asset strong revoke current-version rotation routes", () => {
  const blockchainAssetId = "100";
  const revokedWallet = aliceWallet;
  const remainingWallet = bobWallet;
  const versionTxHash = `0x${"9".repeat(64)}`;
  const nextSha256 = "c".repeat(64);

  function registeredAsset(assetId = new mongoose.Types.ObjectId(), overrides: Record<string, unknown> = {}) {
    return {
      _id: assetId,
      ownerWallet,
      filename: "vault-document.pdf.enc",
      size: 2048,
      mimeType: "application/pdf",
      sha256: "b".repeat(64),
      currentVersion: 2,
      status: "ACTIVE",
      blockchainAssetId,
      blockchainVerificationStatus: "verified",
      passwordProtectionEnabled: false,
      ...overrides
    };
  }

  function activeGrant(wallet: string, accessType: "READ" | "WRITE" = "READ") {
    return {
      granteeWallet: wallet,
      accessType,
      status: "ACTIVE",
      validUntil: null
    };
  }

  function strongFinalizeRequest(assetId: mongoose.Types.ObjectId, wrappedKeys: unknown[]) {
    return request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/strong-revoke/finalize`)
      .set("Cookie", authenticatedCookie())
      .field("expectedPreviousVersion", "2")
      .field("newVersion", "3")
      .field("sha256", nextSha256)
      .field(
        "encryptionMetadata",
        JSON.stringify({
          algorithm: "AES-256-GCM",
          iv: "rotated-iv",
          tag: "included-in-ciphertext"
        })
      )
      .field("wrappedKeys", JSON.stringify(wrappedKeys))
      .field("blockchainTransactionHash", versionTxHash)
      .attach("encryptedFile", Buffer.from("x"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      });
  }

  it("prepares recipients from currently authorized wallets and excludes the revoked grantee", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(queryResult([activeGrant(remainingWallet)]) as never);
    vi.spyOn(UserModel, "find").mockReturnValue(
      queryResult([
        {
          walletAddress: ownerWallet,
          publicEncryptionKey: "owner-public-key"
        },
        {
          walletAddress: remainingWallet,
          publicEncryptionKey: "remaining-public-key"
        }
      ]) as never
    );
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: vi.fn((_: string, wallet: string) =>
        wallet.toLowerCase() === revokedWallet ? Promise.resolve("NONE") : Promise.resolve("READ")
      ),
      getCurrentHash: vi.fn().mockResolvedValue(`0x${"b".repeat(64)}`),
      getCurrentVersion: vi.fn().mockResolvedValue(2),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn(),
      verifyAccessRevoke: vi.fn(),
      verifyVersionCommit: vi.fn()
    });

    const response = await request(createApp())
      .post(`/api/assets/${assetId.toString()}/access/strong-revoke/prepare`)
      .set("Cookie", authenticatedCookie())
      .send({ granteeWallet: revokedWallet })
      .expect(200);

    expect(response.body.strongRevoke).toMatchObject({
      assetId: assetId.toString(),
      currentVersion: 2,
      nextVersion: 3,
      expectedSha256: "b".repeat(64),
      revokedGranteeWallet: revokedWallet
    });
    expect(response.body.strongRevoke.recipients).toEqual([
      {
        walletAddress: ownerWallet,
        publicEncryptionKey: "owner-public-key",
        requiresPasswordWrapping: false
      },
      {
        walletAddress: remainingWallet,
        publicEncryptionKey: "remaining-public-key",
        requiresPasswordWrapping: false
      }
    ]);
  });

  it("finalizes strong revoke by preserving old history, creating current version, and issuing K2 only to authorized users", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(queryResult([activeGrant(remainingWallet)]) as never);
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset").mockResolvedValue({
      storageId,
      byteLength: 18,
      originalFilename: "vault-document.pdf.enc"
    });
    const versionCreateSpy = vi.spyOn(AssetVersionModel, "create").mockResolvedValue({} as never);
    const wrappedKeyUpdateSpy = vi.spyOn(WrappedKeyModel, "updateMany").mockResolvedValue({ modifiedCount: 2 } as never);
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create").mockResolvedValue([] as never);
    const assetUpdateSpy = vi.spyOn(AssetModel, "findOneAndUpdate").mockResolvedValue({} as never);
    vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);
    const verifyVersionCommitSpy = vi.fn().mockResolvedValue({
      blockchainAssetId,
      transactionHash: versionTxHash,
      blockNumber: 99,
      committerWallet: ownerWallet,
      sha256: nextSha256,
      version: 3
    });
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: vi.fn((_: string, wallet: string) =>
        wallet.toLowerCase() === remainingWallet ? Promise.resolve("READ") : Promise.resolve("NONE")
      ),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn(),
      verifyAccessRevoke: vi.fn(),
      verifyVersionCommit: verifyVersionCommitSpy
    });

    const response = await strongFinalizeRequest(assetId, [
      {
        walletAddress: ownerWallet,
        wrappedAESKey: "wrapped-k2-owner",
        wrappingMetadata: {
          algorithm: "RSA-OAEP",
          keyId: "owner-key"
        }
      },
      {
        walletAddress: remainingWallet,
        wrappedAESKey: "wrapped-k2-remaining",
        wrappingMetadata: {
          algorithm: "RSA-OAEP",
          keyId: "remaining-key"
        }
      }
    ]).expect(200);

    expect(verifyVersionCommitSpy).toHaveBeenCalledWith({
      transactionHash: versionTxHash,
      blockchainAssetId,
      expectedCommitterWallet: ownerWallet,
      expectedSha256: nextSha256,
      expectedVersion: 3
    });
    expect(storeSpy).toHaveBeenCalledWith({
      encryptedBytes: Buffer.from("x"),
      originalFilename: "vault-document.pdf.enc"
    });
    expect(versionCreateSpy).toHaveBeenCalledWith({
      assetId,
      version: 3,
      encryptedStorageReference: storageId,
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "rotated-iv",
        tag: "included-in-ciphertext"
      },
      sha256: nextSha256,
      createdBy: ownerWallet,
      commitMessage: "Strong revocation key rotation",
      blockchainTransactionHash: versionTxHash
    });
    expect(wrappedKeyUpdateSpy).toHaveBeenCalledWith(
      {
        assetId,
        version: 2,
        active: true
      },
      {
        $set: {
          active: false
        }
      },
      undefined
    );
    expect(wrappedKeyCreateSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        userWallet: ownerWallet,
        wrappedAESKey: "wrapped-k2-owner",
        version: 3,
        active: true
      }),
      expect.objectContaining({
        userWallet: remainingWallet,
        wrappedAESKey: "wrapped-k2-remaining",
        version: 3,
        active: true
      })
    ]);
    expect(JSON.stringify(wrappedKeyCreateSpy.mock.calls)).not.toContain(revokedWallet);
    expect(assetUpdateSpy).toHaveBeenCalledWith(
      {
        _id: assetId,
        ownerWallet,
        currentVersion: 2
      },
      {
        $set: {
          currentVersion: 3,
          sha256: nextSha256,
          status: "ACTIVE",
          blockchainVerificationStatus: "verified"
        }
      },
      {
        new: true,
        runValidators: true
      }
    );
    expect(response.body.version).toMatchObject({
      assetId: assetId.toString(),
      version: 3,
      sha256: nextSha256,
      blockchainTxHash: versionTxHash,
      blockNumber: 99,
      wrappedKeyRecipients: [ownerWallet, remainingWallet]
    });
  });

  it("rejects finalization when wrapped-key recipients include the revoked user or omit a remaining user", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAsset(assetId)) as never);
    vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(queryResult(null) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(queryResult([activeGrant(remainingWallet)]) as never);
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: vi.fn((_: string, wallet: string) =>
        wallet.toLowerCase() === remainingWallet ? Promise.resolve("READ") : Promise.resolve("NONE")
      ),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn(),
      verifyAccessRevoke: vi.fn(),
      verifyVersionCommit: vi.fn().mockResolvedValue({
        blockchainAssetId,
        transactionHash: versionTxHash,
        blockNumber: 99,
        committerWallet: ownerWallet,
        sha256: nextSha256,
        version: 3
      })
    });
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await strongFinalizeRequest(assetId, [
      {
        walletAddress: ownerWallet,
        wrappedAESKey: "wrapped-k2-owner",
        wrappingMetadata: {
          algorithm: "RSA-OAEP",
          keyId: "owner-key"
        }
      },
      {
        walletAddress: revokedWallet,
        wrappedAESKey: "wrapped-k2-revoked",
        wrappingMetadata: {
          algorithm: "RSA-OAEP",
          keyId: "revoked-key"
        }
      }
    ]).expect(400);

    expect(response.body.error.code).toBe("WRAPPED_KEY_RECIPIENTS_MISMATCH");
    expect(storeSpy).not.toHaveBeenCalled();
  });
});

describe("asset access management route", () => {
  const blockchainAssetId = "100";
  const readGrantTxHash = `0x${"e".repeat(64)}`;
  const writeGrantTxHash = `0x${"f".repeat(64)}`;

  function registeredAccessAsset(assetId = new mongoose.Types.ObjectId(), overrides: Record<string, unknown> = {}) {
    return {
      _id: assetId,
      ownerWallet,
      blockchainAssetId,
      blockchainVerificationStatus: "verified",
      ...overrides
    };
  }

  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp()).get(`/api/assets/${new mongoose.Types.ObjectId().toString()}/access`).expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("is owner-only for the access management view", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(null) as never);
    const accessGrantFindSpy = vi.spyOn(AccessGrantModel, "find");

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/access`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(404);

    expect(response.body.error.code).toBe("ASSET_NOT_FOUND");
    expect(assetFindSpy).toHaveBeenCalledWith({ _id: assetId.toString(), ownerWallet: aliceWallet });
    expect(accessGrantFindSpy).not.toHaveBeenCalled();
  });

  it("returns safe access metadata with status cross-checked against current blockchain permission", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const expiredUntil = new Date("2026-01-01T00:00:00.000Z");
    const futureUntil = new Date("2027-01-01T00:00:00.000Z");
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAccessAsset(assetId)) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(
      sortedQueryResult([
        {
          granteeWallet: aliceWallet,
          granteeDisplayName: "Alice",
          accessType: "READ",
          validFrom: null,
          validUntil: null,
          reason: "Review",
          blockchainTxHash: readGrantTxHash,
          status: "ACTIVE",
          wrappedAESKey: "must-not-leak"
        },
        {
          granteeWallet: bobWallet,
          granteeDisplayName: "Bob",
          accessType: "WRITE",
          validFrom: new Date("2025-01-01T00:00:00.000Z"),
          validUntil: expiredUntil,
          reason: "Expired review",
          blockchainTxHash: writeGrantTxHash,
          status: "ACTIVE",
          privateKey: "must-not-leak"
        },
        {
          granteeWallet: spoofedWallet,
          granteeDisplayName: undefined,
          accessType: "READ",
          validFrom: null,
          validUntil: futureUntil,
          reason: undefined,
          blockchainTxHash: `0x${"d".repeat(64)}`,
          status: "ACTIVE"
        }
      ]) as never
    );
    const getPermissionSpy = vi.fn((_: string, wallet: string) => {
      if (wallet === aliceWallet) {
        return Promise.resolve("READ");
      }
      if (wallet === bobWallet) {
        return Promise.resolve("WRITE");
      }
      return Promise.resolve("NONE");
    });
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
      getPermission: getPermissionSpy,
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn()
    });

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/access`)
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(getPermissionSpy).toHaveBeenCalledWith(blockchainAssetId, aliceWallet);
    expect(getPermissionSpy).toHaveBeenCalledWith(blockchainAssetId, bobWallet);
    expect(response.body.access).toEqual([
      {
        granteeWallet: aliceWallet,
        granteeDisplayName: "Alice",
        accessType: "READ",
        validFrom: null,
        validUntil: null,
        reason: "Review",
        status: "ACTIVE",
        blockchainTxHash: readGrantTxHash
      },
      {
        granteeWallet: bobWallet,
        granteeDisplayName: "Bob",
        accessType: "WRITE",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2026-01-01T00:00:00.000Z",
        reason: "Expired review",
        status: "EXPIRED",
        blockchainTxHash: writeGrantTxHash
      },
      {
        granteeWallet: spoofedWallet,
        granteeDisplayName: null,
        accessType: "READ",
        validFrom: null,
        validUntil: "2027-01-01T00:00:00.000Z",
        reason: null,
        status: "REVOKED",
        blockchainTxHash: `0x${"d".repeat(64)}`
      }
    ]);
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
    expect(response.body.access[0]).not.toHaveProperty("wrappedAESKey");
    expect(response.body.access[0]).not.toHaveProperty("privateKey");
  });

  it("rejects the management view when blockchain owner no longer matches the authenticated owner", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(registeredAccessAsset(assetId)) as never);
    const accessGrantFindSpy = vi.spyOn(AccessGrantModel, "find");
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn().mockResolvedValue(bobWallet),
      getPermission: vi.fn(),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn()
    });

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/access`)
      .set("Cookie", authenticatedCookie())
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(accessGrantFindSpy).not.toHaveBeenCalled();
  });

  it("returns no authoritative grants for assets that are not verified on-chain", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult(
        registeredAccessAsset(assetId, {
          blockchainAssetId: null,
          blockchainVerificationStatus: "pending"
        })
      ) as never
    );
    const accessGrantFindSpy = vi.spyOn(AccessGrantModel, "find");
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/access`)
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(response.body).toEqual({ access: [] });
    expect(blockchainSpy).not.toHaveBeenCalled();
    expect(accessGrantFindSpy).not.toHaveBeenCalled();
  });
});

describe("shared with me asset route", () => {
  const blockchainAssetId = "100";

  function sharedAsset(assetId = new mongoose.Types.ObjectId(), overrides: Record<string, unknown> = {}) {
    return {
      _id: assetId,
      ownerWallet: bobWallet,
      filename: "bob-shared.pdf.enc",
      size: 2048,
      mimeType: "application/pdf",
      sha256: validSha256,
      currentVersion: 2,
      status: "ACTIVE",
      blockchainAssetId,
      blockchainVerificationStatus: "verified",
      ...overrides
    };
  }

  function activeWrappedKey(assetId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) {
    return {
      assetId,
      userWallet: aliceWallet,
      version: 2,
      active: true,
      wrappedAESKey: "must-not-return",
      ...overrides
    };
  }

  function activeAccessGrant(assetId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) {
    return {
      assetId,
      granteeWallet: aliceWallet,
      accessType: "READ",
      validUntil: new Date("2027-01-01T00:00:00.000Z"),
      status: "ACTIVE",
      ...overrides
    };
  }

  it("lets Alice see Bob's shared asset when chain permission and current wrapped key are active", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(queryResult([activeWrappedKey(assetId)]) as never);
    vi.spyOn(AssetModel, "find").mockReturnValue(sortedQueryResult([sharedAsset(assetId)]) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(sortedQueryResult([activeAccessGrant(assetId)]) as never);
    vi.spyOn(UserModel, "find").mockReturnValue(queryResult([{ walletAddress: bobWallet, displayName: "Bob Owner" }]) as never);
    const blockchain = mockBlockchainPermission("READ", 2);

    const response = await request(createApp())
      .get("/api/assets/shared-with-me")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(blockchain.mock.results[0].value.getPermission).toHaveBeenCalledWith(blockchainAssetId, aliceWallet);
    expect(response.body.assets).toEqual([
      {
        assetId: assetId.toString(),
        filename: "bob-shared.pdf.enc",
        ownerWallet: bobWallet,
        ownerDisplayName: "Bob Owner",
        permission: "READ",
        expiry: "2027-01-01T00:00:00.000Z",
        currentVersion: 2,
        sha256: validSha256,
        blockchainVerified: true,
        size: 2048,
        mimeType: "application/pdf"
      }
    ]);
    expect(JSON.stringify(response.body)).not.toContain("must-not-return");
    expect(response.body.assets[0]).not.toHaveProperty("wrappedAESKey");
  });

  it("does not show Bob's shared asset to unrelated Charlie", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "find");
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(queryResult([]) as never);

    const response = await request(createApp())
      .get("/api/assets/shared-with-me")
      .set("Cookie", authenticatedCookie(spoofedWallet))
      .expect(200);

    expect(response.body).toEqual({ assets: [] });
    expect(assetFindSpy).not.toHaveBeenCalled();
    expect(blockchainSpy).not.toHaveBeenCalled();
  });

  it("removes a shared asset when blockchain permission is revoked", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(queryResult([activeWrappedKey(assetId)]) as never);
    vi.spyOn(AssetModel, "find").mockReturnValue(sortedQueryResult([sharedAsset(assetId)]) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(sortedQueryResult([activeAccessGrant(assetId)]) as never);
    vi.spyOn(UserModel, "find").mockReturnValue(queryResult([{ walletAddress: bobWallet, displayName: "Bob Owner" }]) as never);
    mockBlockchainPermission("NONE", 2);

    const response = await request(createApp())
      .get("/api/assets/shared-with-me")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.body).toEqual({ assets: [] });
  });

  it("removes a shared asset when the access grant metadata is expired", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(queryResult([activeWrappedKey(assetId)]) as never);
    vi.spyOn(AssetModel, "find").mockReturnValue(sortedQueryResult([sharedAsset(assetId)]) as never);
    vi.spyOn(AccessGrantModel, "find").mockReturnValue(
      sortedQueryResult([
        activeAccessGrant(assetId, {
          validUntil: new Date("2026-01-01T00:00:00.000Z")
        })
      ]) as never
    );
    vi.spyOn(UserModel, "find").mockReturnValue(queryResult([{ walletAddress: bobWallet, displayName: "Bob Owner" }]) as never);
    mockBlockchainPermission("READ", 2);

    const response = await request(createApp())
      .get("/api/assets/shared-with-me")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.body).toEqual({ assets: [] });
  });
});

describe("asset list route", () => {
  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "find");

    await request(createApp()).get("/api/assets").expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("lists active assets owned by the authenticated wallet", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const assetFindSpy = vi.spyOn(AssetModel, "find").mockReturnValue(
      sortedQueryResult([
        {
          _id: assetId,
          ownerWallet,
          filename: "vault-document.pdf.enc",
          size: 15,
          mimeType: "application/octet-stream",
          sha256: validSha256,
          currentVersion: 1,
          status: "active",
          passwordProtectionEnabled: false,
          blockchainAssetId: "chain-asset-1",
          folderId: null,
          registrationTransactionHash: `0x${"c".repeat(64)}`,
          registrationBlockNumber: 12345,
          blockchainVerificationStatus: "verified",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
          updatedAt: new Date("2026-09-08T00:00:00.000Z")
        }
      ]) as never
    );

    const response = await request(createApp()).get("/api/assets").set("Cookie", authenticatedCookie()).expect(200);

    expect(assetFindSpy).toHaveBeenCalledWith({
      ownerWallet,
      status: { $in: ["ACTIVE", "active"] }
    });
    expect(response.body.assets).toEqual([
      {
        id: assetId.toString(),
        ownerWallet,
        filename: "vault-document.pdf.enc",
        size: 15,
        mimeType: "application/octet-stream",
        sha256: validSha256,
        currentVersion: 1,
        status: "active",
        passwordProtectionEnabled: false,
        blockchainAssetId: "chain-asset-1",
        folderId: null,
        registrationTransactionHash: `0x${"c".repeat(64)}`,
        registrationBlockNumber: 12345,
        blockchainVerificationStatus: "verified",
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z"
      }
    ]);
  });

  it("filters assets by an owned folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: folderId }) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "find").mockReturnValue(sortedQueryResult([]) as never);

    await request(createApp()).get(`/api/assets?folderId=${folderId}`).set("Cookie", authenticatedCookie()).expect(200);

    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet });
    expect(assetFindSpy).toHaveBeenCalledWith({
      ownerWallet,
      status: { $in: ["ACTIVE", "active"] },
      folderId
    });
  });

  it("does not list assets for another user's folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "find");

    const response = await request(createApp())
      .get(`/api/assets?folderId=${folderId}`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet: aliceWallet });
    expect(assetFindSpy).not.toHaveBeenCalled();
  });
});

describe("my asset metadata route", () => {
  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "find");

    await request(createApp()).get("/api/assets/my").expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("returns safe frontend metadata for the authenticated owner's assets", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const folderId = new mongoose.Types.ObjectId();
    const assetFindSpy = vi.spyOn(AssetModel, "find").mockReturnValue(
      sortedQueryResult([
        {
          _id: assetId,
          ownerWallet,
          filename: "vault-document.pdf",
          size: 428000,
          mimeType: "application/pdf",
          sha256: validSha256,
          currentVersion: 3,
          status: "active",
          folderId,
          blockchainAssetId: "chain-asset-100",
          registrationTransactionHash: `0x${"d".repeat(64)}`,
          registrationBlockNumber: 193244,
          blockchainVerificationStatus: "verified",
          encryptedStorageReference: "must-not-return",
          wrappedAESKey: "must-not-return",
          createdAt: new Date("2026-09-08T00:00:00.000Z")
        }
      ]) as never
    );

    const response = await request(createApp()).get("/api/assets/my").set("Cookie", authenticatedCookie()).expect(200);

    expect(assetFindSpy).toHaveBeenCalledWith({ ownerWallet });
    expect(response.body.assets).toEqual([
      {
        assetId: assetId.toString(),
        filename: "vault-document.pdf",
        size: 428000,
        mimeType: "application/pdf",
        folderId: folderId.toString(),
        sha256: validSha256,
        currentVersion: 3,
        status: "active",
        passwordProtectionEnabled: false,
        createdAt: "2026-09-08T00:00:00.000Z",
        blockchainAssetId: "chain-asset-100",
        registrationTransactionHash: `0x${"d".repeat(64)}`,
        registrationBlockNumber: 193244,
        blockchainVerificationStatus: "verified"
      }
    ]);
    expect(response.body.assets[0]).not.toHaveProperty("encryptedStorageReference");
    expect(response.body.assets[0]).not.toHaveProperty("wrappedAESKey");
    expect(response.body.assets[0]).not.toHaveProperty("ownerWallet");
  });

  it("supports filename search without accepting raw regex input", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "find").mockReturnValue(sortedQueryResult([]) as never);

    await request(createApp()).get("/api/assets/my?search=q.(pdf)").set("Cookie", authenticatedCookie()).expect(200);

    expect(assetFindSpy).toHaveBeenCalledWith({
      ownerWallet,
      filename: {
        $regex: "q\\.\\(pdf\\)",
        $options: "i"
      }
    });
  });

  it("supports filtering by an owned folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: folderId }) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "find").mockReturnValue(sortedQueryResult([]) as never);

    await request(createApp()).get(`/api/assets/my?folderId=${folderId}`).set("Cookie", authenticatedCookie()).expect(200);

    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet });
    expect(assetFindSpy).toHaveBeenCalledWith({
      ownerWallet,
      folderId
    });
  });

  it("does not list assets for another user's folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "find");

    const response = await request(createApp())
      .get(`/api/assets/my?folderId=${folderId}`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet: aliceWallet });
    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("validates query parameters", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "find");

    await request(createApp()).get("/api/assets/my?folderId=not-an-object-id").set("Cookie", authenticatedCookie()).expect(400);
    await request(createApp()).get("/api/assets/my?unknown=value").set("Cookie", authenticatedCookie()).expect(400);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });
});

describe("asset folder move route", () => {
  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp())
      .patch(`/api/assets/${new mongoose.Types.ObjectId().toString()}/folder`)
      .send({ folderId: null })
      .expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("moves an owned asset into an owned folder and writes an audit event", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const fromFolderId = new mongoose.Types.ObjectId();
    const toFolderId = new mongoose.Types.ObjectId();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: toFolderId }) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult({
        _id: assetId,
        ownerWallet,
        filename: "vault-document.pdf.enc",
        folderId: fromFolderId
      }) as never
    );
    const updateSpy = vi.spyOn(AssetModel, "findOneAndUpdate").mockReturnValue(
      updatedQueryResult({
        _id: assetId,
        ownerWallet,
        filename: "vault-document.pdf.enc",
        folderId: toFolderId
      }) as never
    );
    const auditSpy = vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);

    const response = await request(createApp())
      .patch(`/api/assets/${assetId.toString()}/folder`)
      .set("Cookie", authenticatedCookie())
      .send({ folderId: toFolderId.toString() })
      .expect(200);

    expect(folderFindSpy).toHaveBeenCalledWith({ _id: toFolderId.toString(), ownerWallet });
    expect(assetFindSpy).toHaveBeenCalledWith({ _id: assetId.toString(), ownerWallet });
    expect(updateSpy).toHaveBeenCalledWith(
      { _id: assetId.toString(), ownerWallet },
      {
        $set: {
          folderId: toFolderId.toString()
        }
      },
      {
        new: true,
        runValidators: true
      }
    );
    expect(auditSpy).toHaveBeenCalledWith({
      assetId,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_FOLDER_MOVED",
      fromFolderId,
      toFolderId: toFolderId.toString()
    });
    expect(response.body.asset).toEqual({
      id: assetId.toString(),
      ownerWallet,
      filename: "vault-document.pdf.enc",
      folderId: toFolderId.toString()
    });
  });

  it("moves an owned asset to Unfiled with null folderId", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const fromFolderId = new mongoose.Types.ObjectId();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne");
    vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult({
        _id: assetId,
        ownerWallet,
        filename: "vault-document.pdf.enc",
        folderId: fromFolderId
      }) as never
    );
    vi.spyOn(AssetModel, "findOneAndUpdate").mockReturnValue(
      updatedQueryResult({
        _id: assetId,
        ownerWallet,
        filename: "vault-document.pdf.enc",
        folderId: null
      }) as never
    );
    const auditSpy = vi.spyOn(AssetAuditEventModel, "create").mockResolvedValue({} as never);

    const response = await request(createApp())
      .patch(`/api/assets/${assetId.toString()}/folder`)
      .set("Cookie", authenticatedCookie())
      .send({ folderId: null })
      .expect(200);

    expect(folderFindSpy).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromFolderId,
        toFolderId: null
      })
    );
    expect(response.body.asset.folderId).toBeNull();
  });

  it("does not allow moving another user's asset", async () => {
    const assetId = new mongoose.Types.ObjectId().toString();
    const folderId = new mongoose.Types.ObjectId().toString();
    vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: folderId }) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(null) as never);
    const updateSpy = vi.spyOn(AssetModel, "findOneAndUpdate");
    const auditSpy = vi.spyOn(AssetAuditEventModel, "create");

    const response = await request(createApp())
      .patch(`/api/assets/${assetId}/folder`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .send({ folderId })
      .expect(404);

    expect(response.body.error.code).toBe("ASSET_NOT_FOUND");
    expect(assetFindSpy).toHaveBeenCalledWith({ _id: assetId, ownerWallet: aliceWallet });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("does not allow moving an owned asset into another user's folder", async () => {
    const assetId = new mongoose.Types.ObjectId().toString();
    const folderId = new mongoose.Types.ObjectId().toString();
    const folderFindSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");
    const updateSpy = vi.spyOn(AssetModel, "findOneAndUpdate");
    const auditSpy = vi.spyOn(AssetAuditEventModel, "create");

    const response = await request(createApp())
      .patch(`/api/assets/${assetId}/folder`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .send({ folderId })
      .expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(folderFindSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet: aliceWallet });
    expect(assetFindSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("validates asset and folder ids", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");
    const folderFindSpy = vi.spyOn(FolderModel, "findOne");

    await request(createApp())
      .patch("/api/assets/not-an-object-id/folder")
      .set("Cookie", authenticatedCookie())
      .send({ folderId: null })
      .expect(400);

    await request(createApp())
      .patch(`/api/assets/${new mongoose.Types.ObjectId().toString()}/folder`)
      .set("Cookie", authenticatedCookie())
      .send({ folderId: "not-an-object-id" })
      .expect(400);

    expect(assetFindSpy).not.toHaveBeenCalled();
    expect(folderFindSpy).not.toHaveBeenCalled();
  });
});

describe("asset blockchain detail route", () => {
  function blockchainAsset(assetId = new mongoose.Types.ObjectId(), overrides: Record<string, unknown> = {}) {
    return {
      _id: assetId,
      ownerWallet,
      filename: "vault-document.pdf.enc",
      sha256: validSha256,
      currentVersion: 1,
      status: "ACTIVE",
      blockchainAssetId: "100",
      registrationTransactionHash: `0x${"c".repeat(64)}`,
      registrationBlockNumber: 7,
      blockchainVerificationStatus: "verified",
      createdAt: new Date("2026-09-08T00:00:00.000Z"),
      updatedAt: new Date("2026-09-08T01:00:00.000Z"),
      ...overrides
    };
  }

  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp())
      .get(`/api/assets/${new mongoose.Types.ObjectId().toString()}/blockchain`)
      .expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("returns pending blockchain detail for the owner without trusting frontend state", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult(
        blockchainAsset(assetId, {
          status: "PENDING_BLOCKCHAIN",
          blockchainAssetId: null,
          registrationTransactionHash: null,
          registrationBlockNumber: null,
          blockchainVerificationStatus: "pending"
        })
      ) as never
    );
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(sortedSingleQueryResult(null) as never);
    vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(sortedSingleQueryResult(null) as never);
    const blockchainSpy = vi.spyOn(blockchainRead, "createBlockchainReadService");

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/blockchain?currentHash=0x${"f".repeat(64)}`)
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(assetFindSpy).toHaveBeenCalledWith({ _id: assetId.toString() });
    expect(blockchainSpy).not.toHaveBeenCalled();
    expect(response.body.blockchain).toEqual({
      assetId: assetId.toString(),
      filename: "vault-document.pdf.enc",
      ownerWallet,
      blockchainAssetId: null,
      currentHash: `0x${validSha256}`,
      currentVersion: 1,
      registrationTxHash: null,
      blockNumber: null,
      status: "PENDING_BLOCKCHAIN",
      blockchainVerificationStatus: "pending",
      confirmationState: "PENDING",
      registration: {
        transactionHash: null,
        blockNumber: null,
        confirmed: false
      },
      current: {
        ownerWallet,
        hash: `0x${validSha256}`,
        version: 1
      },
      latestKnownTransaction: null,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T01:00:00.000Z"
    });
  });

  it("returns verified blockchain detail for an authorized reader", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(blockchainAsset(assetId)) as never);
    vi.spyOn(AuditEventModel, "findOne").mockReturnValue(
      sortedSingleQueryResult({
        action: "ACCESS_REVOKED",
        detail: "vault-document.pdf.enc access revoked",
        blockchainTxHash: `0x${"d".repeat(64)}`,
        timestamp: new Date("2026-09-10T01:00:00.000Z")
      }) as never
    );
    vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(sortedSingleQueryResult(null) as never);
    const blockchain = mockBlockchainPermission("READ", 1);

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/blockchain`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(blockchain.mock.results[0].value.getPermission).toHaveBeenCalledWith("100", aliceWallet);
    expect(response.body.blockchain).toMatchObject({
      assetId: assetId.toString(),
      ownerWallet,
      currentHash,
      currentVersion: 1,
      registrationTxHash: `0x${"c".repeat(64)}`,
      blockNumber: 7,
      status: "BLOCKCHAIN_MISMATCH",
      blockchainVerificationStatus: "failed",
      confirmationState: "MISMATCH",
      registration: {
        transactionHash: `0x${"c".repeat(64)}`,
        blockNumber: 7,
        confirmed: true
      },
      current: {
        ownerWallet,
        hash: currentHash,
        version: 1
      },
      latestKnownTransaction: {
        action: "ACCESS_REVOKED",
        detail: "vault-document.pdf.enc access revoked",
        blockchainTxHash: `0x${"d".repeat(64)}`,
        timestamp: "2026-09-10T01:00:00.000Z"
      }
    });
  });

  it("denies non-owner detail when blockchain permission is NONE", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(queryResult(blockchainAsset(assetId)) as never);
    mockBlockchainPermission("NONE", 1);

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/blockchain`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
  });

  it("validates asset id format", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");

    await request(createApp()).get("/api/assets/not-an-object-id/blockchain").set("Cookie", authenticatedCookie()).expect(400);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });
});

describe("encrypted asset open route", () => {
  describe("integrity metadata", () => {
    it("returns integrity metadata for an authenticated wallet with READ permission", async () => {
      const blockchainSpy = mockBlockchainPermission("READ");
      const { assetId, encryptedAssetSpy, wrappedKeyFindSpy } = mockOpenRoutePersistence();

      const response = await request(createApp())
        .get(`/api/assets/${assetId.toString()}/integrity`)
        .set("Cookie", authenticatedCookie(aliceWallet))
        .expect(200);

      expect(response.body).toEqual({
        integrity: {
          currentVersion: 2,
          expectedSha256: "b".repeat(64),
          blockchainSha256: "b".repeat(64),
          blockchainVerificationStatus: "verified"
        }
      });
      expect(blockchainSpy.mock.results[0].value.getPermission).toHaveBeenCalledWith("123", aliceWallet);
      expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
      expect(encryptedAssetSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain("wrapped-key-for-current-user");
      expect(JSON.stringify(response.body)).not.toContain("encrypted-bytes");
    });

    it("returns integrity metadata for an authenticated wallet with WRITE permission", async () => {
      mockBlockchainPermission("WRITE");
      const { assetId } = mockOpenRoutePersistence();

      const response = await request(createApp())
        .get(`/api/assets/${assetId.toString()}/integrity`)
        .set("Cookie", authenticatedCookie(aliceWallet))
        .expect(200);

      expect(response.body.integrity.blockchainVerificationStatus).toBe("verified");
    });

    it("returns integrity metadata for the authenticated owner", async () => {
      const blockchainSpy = mockBlockchainPermission("WRITE");
      const { assetId } = mockOpenRoutePersistence();

      const response = await request(createApp())
        .get(`/api/assets/${assetId.toString()}/integrity`)
        .set("Cookie", authenticatedCookie(ownerWallet))
        .expect(200);

      expect(blockchainSpy.mock.results[0].value.getPermission).toHaveBeenCalledWith("123", ownerWallet);
      expect(response.body.integrity.expectedSha256).toBe("b".repeat(64));
    });

    it("denies integrity metadata when blockchain permission is NONE", async () => {
      mockBlockchainPermission("NONE");
      const { assetId, versionFindSpy, wrappedKeyFindSpy, encryptedAssetSpy } = mockOpenRoutePersistence();

      const response = await request(createApp())
        .get(`/api/assets/${assetId.toString()}/integrity`)
        .set("Cookie", authenticatedCookie(aliceWallet))
        .expect(403);

      expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
      expect(versionFindSpy).not.toHaveBeenCalled();
      expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
      expect(encryptedAssetSpy).not.toHaveBeenCalled();
    });

    it("fails closed when blockchain hash does not match a stored asset version", async () => {
      mockBlockchainPermission("READ");
      const { assetId, wrappedKeyFindSpy, encryptedAssetSpy } = mockOpenRoutePersistence();
      vi.spyOn(AssetVersionModel, "findOne").mockRestore();
      vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(queryResult(null) as never);

      const response = await request(createApp())
        .get(`/api/assets/${assetId.toString()}/integrity`)
        .set("Cookie", authenticatedCookie(aliceWallet))
        .expect(403);

      expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
      expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
      expect(encryptedAssetSpy).not.toHaveBeenCalled();
    });

    it("returns asset activity only after blockchain-backed access verification", async () => {
      mockBlockchainPermission("READ");
      const { assetId, wrappedKeyFindSpy, encryptedAssetSpy } = mockOpenRoutePersistence();
      vi.spyOn(AuditEventModel, "find").mockReturnValue(
        eventQueryResult([
          {
            _id: new mongoose.Types.ObjectId(),
            walletAddress: ownerWallet,
            assetId,
            action: "BLOCKCHAIN_REGISTERED",
            detail: "vault-document.pdf.enc registered on-chain",
            blockchainTxHash: `0x${"c".repeat(64)}`,
            timestamp: new Date("2026-09-10T01:00:00.000Z")
          }
        ]) as never
      );

      const response = await request(createApp())
        .get(`/api/assets/${assetId.toString()}/activity`)
        .set("Cookie", authenticatedCookie(aliceWallet))
        .expect(200);

      expect(response.body.activity).toEqual([
        {
          id: expect.any(String),
          walletAddress: ownerWallet,
          assetId: assetId.toString(),
          action: "BLOCKCHAIN_REGISTERED",
          detail: "vault-document.pdf.enc registered on-chain",
          blockchainTxHash: `0x${"c".repeat(64)}`,
          timestamp: "2026-09-10T01:00:00.000Z"
        }
      ]);
      expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
      expect(encryptedAssetSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain("wrapped-key-for-current-user");
      expect(JSON.stringify(response.body)).not.toContain("encrypted-bytes");
    });
  });

  it("denies Alice attempting to open a Bob-only asset", async () => {
    mockBlockchainPermission("READ");
    const { assetId, wrappedKeyFindSpy, encryptedAssetSpy } = mockOpenRoutePersistence({
      wallet: bobWallet,
      wrappedKey: null
    });

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(wrappedKeyFindSpy).toHaveBeenCalledWith({
      assetId,
      userWallet: aliceWallet,
      version: 2,
      active: true
    });
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });

  it("denies access when a user changes assetId manually to an unauthorized blockchain asset", async () => {
    mockBlockchainPermission("NONE");
    const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult({
        _id: new mongoose.Types.ObjectId(),
        ownerWallet,
        filename: "vault-document.pdf.enc",
        size: 2048,
        mimeType: "application/pdf",
        blockchainAssetId: "999",
        blockchainVerificationStatus: "verified",
        status: "ACTIVE"
      }) as never
    );
    const wrappedKeyFindSpy = vi.spyOn(WrappedKeyModel, "findOne");

    const response = await request(createApp())
      .get(`/api/assets/${new mongoose.Types.ObjectId().toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(assetFindSpy).toHaveBeenCalled();
    expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
  });

  it("returns 403 from /open after revoked user permission resolves to NONE", async () => {
    mockBlockchainPermission("NONE");
    const { assetId, wrappedKeyFindSpy, encryptedAssetSpy } = mockOpenRoutePersistence();

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error).toEqual({
      code: "ASSET_ACCESS_DENIED",
      message: "Asset access denied"
    });
    expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });

  it("opens an encrypted asset with READ permission", async () => {
    const blockchainSpy = mockBlockchainPermission("READ");
    const { assetId, encryptedAssetSpy } = mockOpenRoutePersistence();

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.body.asset).toEqual({
      assetId: assetId.toString(),
      blockchainAssetId: "123",
      filename: "vault-document.pdf.enc",
      mimeType: "application/pdf",
      size: 2048,
      permission: "READ",
      currentVersion: 2,
      sha256: "b".repeat(64),
      expectedSha256: "b".repeat(64),
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      ciphertextUrl: `/api/assets/${assetId.toString()}/ciphertext`,
      EK_User: "wrapped-key-for-current-user",
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "user-key-1"
      }
    });
    expect(response.body.asset).not.toHaveProperty("encryptedFile");
    expect(blockchainSpy.mock.results[0].value.getPermission).toHaveBeenCalledWith("123", aliceWallet);
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });

  it("opens an encrypted asset with WRITE permission", async () => {
    mockBlockchainPermission("WRITE");
    const { assetId } = mockOpenRoutePersistence();

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.body.asset.permission).toBe("WRITE");
    expect(response.body.asset.EK_User).toBe("wrapped-key-for-current-user");
  });

  it("opens the current rotated version with the current K2 wrapped key", async () => {
    const blockchainSpy = mockBlockchainPermission("READ", 3);
    const { assetId, versionFindSpy, wrappedKeyFindSpy } = mockOpenRoutePersistence({
      currentVersion: 3,
      wrappedKey: "wrapped-k2-for-current-user"
    });

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(versionFindSpy).toHaveBeenCalledWith({
      assetId,
      version: 3,
      sha256: "b".repeat(64)
    });
    expect(wrappedKeyFindSpy).toHaveBeenCalledWith({
      assetId,
      userWallet: aliceWallet,
      version: 3,
      active: true
    });
    expect(blockchainSpy.mock.results[0].value.getPermission).toHaveBeenCalledWith("123", aliceWallet);
    expect(response.body.asset.currentVersion).toBe(3);
    expect(response.body.asset.EK_User).toBe("wrapped-k2-for-current-user");
  });

  it("denies access when the authenticated wallet has no wrapped key", async () => {
    mockBlockchainPermission("READ");
    const { assetId, encryptedAssetSpy } = mockOpenRoutePersistence({ wrappedKey: null });

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });

  it("fails closed when blockchain permission cannot be verified", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(
      queryResult({
        _id: assetId,
        ownerWallet,
        filename: "vault-document.pdf.enc",
        size: 2048,
        mimeType: "application/pdf",
        blockchainAssetId: "123",
        blockchainVerificationStatus: "verified",
        status: "ACTIVE"
      }) as never
    );
    vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
      getAssetOwner: vi.fn(),
      getPermission: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      getCurrentHash: vi.fn(),
      getCurrentVersion: vi.fn(),
      verifyAssetRegistration: vi.fn(),
      verifyAccessGrant: vi.fn()
    });
    const versionFindSpy = vi.spyOn(AssetVersionModel, "findOne");
    const wrappedKeyFindSpy = vi.spyOn(WrappedKeyModel, "findOne");

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/open`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(versionFindSpy).not.toHaveBeenCalled();
    expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
  });

  it("streams ciphertext only after the same authorization checks", async () => {
    mockBlockchainPermission("READ");
    const { assetId, encryptedAssetSpy } = mockOpenRoutePersistence();

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/ciphertext`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/octet-stream");
    expect(Buffer.from(response.body).toString()).toBe("encrypted-bytes");
    expect(encryptedAssetSpy).toHaveBeenCalledWith(storageId);
  });

  it("does not stream ciphertext when blockchain permission is revoked", async () => {
    mockBlockchainPermission("NONE");
    const { assetId, encryptedAssetSpy } = mockOpenRoutePersistence();

    const response = await request(createApp())
      .get(`/api/assets/${assetId.toString()}/ciphertext`)
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });
});
