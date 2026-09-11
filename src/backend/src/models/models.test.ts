import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { AccessGrantModel } from "./access-grant.js";
import { AssetAuditEventModel } from "./asset-audit-event.js";
import { AssetModel } from "./asset.js";
import { AuditEventModel } from "./audit-event.js";
import { AssetVersionModel } from "./asset-version.js";
import { FolderModel } from "./folder.js";
import { forbiddenSensitiveFields } from "./schema-guards.js";
import { UserModel } from "./user.js";
import { WrappedKeyModel } from "./wrapped-key.js";

const validWallet = "0x1111111111111111111111111111111111111111";
const validSha256 = "a".repeat(64);
const validObjectId = new mongoose.Types.ObjectId();

const modelsToCheck = [
  UserModel,
  AssetModel,
  AuditEventModel,
  WrappedKeyModel,
  AssetVersionModel,
  FolderModel,
  AssetAuditEventModel,
  AccessGrantModel
];

describe("Secure Vault models", () => {
  it("does not define forbidden sensitive fields", () => {
    for (const model of modelsToCheck) {
      for (const field of forbiddenSensitiveFields) {
        expect(model.schema.path(field), `${model.modelName}.${field}`).toBeUndefined();
      }
    }
  });

  it("uses strict schemas that reject unknown fields", () => {
    for (const model of modelsToCheck) {
      expect(model.schema.get("strict")).toBe("throw");
    }
  });

  it("validates User profile fields and wallet format", async () => {
    const user = new UserModel({
      walletAddress: validWallet.toUpperCase(),
      publicEncryptionKey: "user-public-key",
      displayName: "Demo User",
      email: "USER@EXAMPLE.COM"
    });

    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.walletAddress).toBe(validWallet);
    expect(user.email).toBe("user@example.com");
    expect(user.kycStatus).toBe("PENDING");

    await expect(
      new UserModel({
        walletAddress: validWallet
      }).validate()
    ).resolves.toBeUndefined();

    await expect(
      new UserModel({
        walletAddress: "not-a-wallet",
        publicEncryptionKey: "user-public-key"
      }).validate()
    ).rejects.toThrow();
  });

  it("validates Asset metadata without plaintext file content fields", async () => {
    const asset = new AssetModel({
      ownerWallet: validWallet,
      filename: "encrypted-document.bin",
      sha256: validSha256,
      passwordProtectionEnabled: false,
      folderId: validObjectId
    });

    await expect(asset.validate()).resolves.toBeUndefined();
    expect(AssetModel.schema.path("plaintextFile")).toBeUndefined();
    expect(AssetModel.schema.path("fileContents")).toBeUndefined();
  });

  it("validates Folder organization metadata only", async () => {
    const folder = new FolderModel({
      ownerWallet: validWallet.toUpperCase(),
      name: "Legal Documents",
      parentFolderId: validObjectId
    });

    await expect(folder.validate()).resolves.toBeUndefined();
    expect(folder.ownerWallet).toBe(validWallet);
    expect(FolderModel.schema.path("plaintextFile")).toBeUndefined();
    expect(FolderModel.schema.path("aesKey")).toBeUndefined();
  });

  it("validates AssetAuditEvent organization metadata only", async () => {
    const auditEvent = new AssetAuditEventModel({
      assetId: validObjectId,
      ownerWallet: validWallet.toUpperCase(),
      actorWallet: validWallet.toUpperCase(),
      eventType: "ASSET_FOLDER_MOVED",
      fromFolderId: null,
      toFolderId: new mongoose.Types.ObjectId()
    });

    await expect(auditEvent.validate()).resolves.toBeUndefined();
    expect(auditEvent.ownerWallet).toBe(validWallet);
    expect(auditEvent.actorWallet).toBe(validWallet);
    expect(AssetAuditEventModel.schema.path("plaintextFile")).toBeUndefined();
    expect(AssetAuditEventModel.schema.path("aesKey")).toBeUndefined();
  });

  it("validates AuditEvent safe product activity only", async () => {
    const auditEvent = new AuditEventModel({
      walletAddress: validWallet.toUpperCase(),
      assetId: validObjectId,
      action: "ASSET_OPENED",
      detail: "encrypted-document.bin opened after access verification",
      blockchainTxHash: `0x${"c".repeat(64)}`
    });

    await expect(auditEvent.validate()).resolves.toBeUndefined();
    expect(auditEvent.walletAddress).toBe(validWallet);
    expect(AuditEventModel.schema.path("cookie")).toBeUndefined();
    expect(AuditEventModel.schema.path("sessionId")).toBeUndefined();
    expect(AuditEventModel.schema.path("wrappedAESKey")).toBeUndefined();
    expect(AuditEventModel.schema.path("plaintextFile")).toBeUndefined();
  });

  it("validates AccessGrant as non-authoritative blockchain transaction metadata only", async () => {
    const grant = new AccessGrantModel({
      assetId: validObjectId,
      ownerWallet: validWallet.toUpperCase(),
      granteeWallet: "0x2222222222222222222222222222222222222222".toUpperCase(),
      granteeDisplayName: "Alice",
      accessType: "READ",
      validFrom: new Date("2026-09-09T00:00:00.000Z"),
      validUntil: new Date("2026-09-10T00:00:00.000Z"),
      reason: "Review",
      blockchainTxHash: `0x${"c".repeat(64)}`,
      status: "ACTIVE"
    });

    await expect(grant.validate()).resolves.toBeUndefined();
    expect(grant.ownerWallet).toBe(validWallet);
    expect(grant.granteeWallet).toBe("0x2222222222222222222222222222222222222222");
    expect(AccessGrantModel.schema.path("wrappedAESKey")).toBeUndefined();
    expect(AccessGrantModel.schema.path("aesKey")).toBeUndefined();
    expect(AccessGrantModel.schema.path("rawKey")).toBeUndefined();
  });

  it("validates AccessGrant revocation and expiry windows", async () => {
    await expect(
      new AccessGrantModel({
        assetId: validObjectId,
        ownerWallet: validWallet,
        granteeWallet: "0x2222222222222222222222222222222222222222",
        accessType: "WRITE",
        validFrom: new Date("2026-09-10T00:00:00.000Z"),
        validUntil: new Date("2026-09-09T00:00:00.000Z"),
        blockchainTxHash: `0x${"c".repeat(64)}`,
        status: "ACTIVE"
      }).validate()
    ).rejects.toThrow();

    await expect(
      new AccessGrantModel({
        assetId: validObjectId,
        ownerWallet: validWallet,
        granteeWallet: "0x2222222222222222222222222222222222222222",
        accessType: "READ",
        blockchainTxHash: `0x${"d".repeat(64)}`,
        status: "REVOKED"
      }).validate()
    ).rejects.toThrow();

    await expect(
      new AccessGrantModel({
        assetId: validObjectId,
        ownerWallet: validWallet,
        granteeWallet: "0x2222222222222222222222222222222222222222",
        accessType: "READ",
        blockchainTxHash: `0x${"e".repeat(64)}`,
        status: "REVOKED",
        revokedAt: new Date("2026-09-09T01:00:00.000Z")
      }).validate()
    ).resolves.toBeUndefined();
  });

  it("validates WrappedKey as wrapped key material only", async () => {
    const wrappedKey = new WrappedKeyModel({
      assetId: validObjectId,
      userWallet: validWallet,
      wrappedAESKey: "encrypted-key-for-user",
      version: 1,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "user-key-1"
      }
    });

    await expect(wrappedKey.validate()).resolves.toBeUndefined();
    expect(WrappedKeyModel.schema.path("aesKey")).toBeUndefined();
    expect(WrappedKeyModel.schema.path("rawKey")).toBeUndefined();
  });

  it("validates password-wrapped key metadata without storing password material", async () => {
    const wrappedKey = new WrappedKeyModel({
      assetId: validObjectId,
      userWallet: validWallet,
      wrappedAESKey: "password-encrypted-aes-key",
      version: 1,
      wrappingMetadata: {
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
      }
    });

    await expect(wrappedKey.validate()).resolves.toBeUndefined();
    expect(WrappedKeyModel.schema.path("password")).toBeUndefined();
    expect(WrappedKeyModel.schema.path("passwordDerivedSecretKey")).toBeUndefined();
  });

  it("rejects unapproved wrapping metadata fields", async () => {
    const wrappedKey = new WrappedKeyModel({
      assetId: validObjectId,
      userWallet: validWallet,
      wrappedAESKey: "encrypted-key-for-user",
      version: 1,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "user-key-1",
        secretKey: "must-not-be-stored"
      }
    });

    await expect(wrappedKey.validate()).rejects.toThrow();
  });

  it("validates AssetVersion encrypted storage references", async () => {
    const assetVersion = new AssetVersionModel({
      assetId: validObjectId,
      version: 1,
      encryptedStorageReference: "storage://encrypted/document-v1",
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      sha256: validSha256,
      createdBy: validWallet,
      commitMessage: "Initial encrypted version",
      blockchainTransactionHash: `0x${"b".repeat(64)}`
    });

    await expect(assetVersion.validate()).resolves.toBeUndefined();
  });

  it("rejects unapproved encryption metadata fields", async () => {
    const assetVersion = new AssetVersionModel({
      assetId: validObjectId,
      version: 1,
      encryptedStorageReference: "storage://encrypted/document-v1",
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag",
        privateEncryptionKey: "must-not-be-stored"
      },
      sha256: validSha256,
      createdBy: validWallet
    });

    await expect(assetVersion.validate()).rejects.toThrow();
  });

  it("defines expected indexes", () => {
    expect(UserModel.schema.indexes()).toContainEqual([{ walletAddress: 1 }, { unique: true }]);
    expect(AssetModel.schema.indexes()).toContainEqual([{ ownerWallet: 1, status: 1 }, {}]);
    expect(AssetModel.schema.indexes()).toContainEqual([{ ownerWallet: 1, folderId: 1 }, {}]);
    expect(AssetAuditEventModel.schema.indexes()).toContainEqual([{ assetId: 1, createdAt: -1 }, {}]);
    expect(AssetAuditEventModel.schema.indexes()).toContainEqual([{ ownerWallet: 1, createdAt: -1 }, {}]);
    expect(AuditEventModel.schema.indexes()).toContainEqual([{ walletAddress: 1, timestamp: -1 }, {}]);
    expect(AuditEventModel.schema.indexes()).toContainEqual([{ assetId: 1, timestamp: -1 }, {}]);
    expect(AccessGrantModel.schema.indexes()).toContainEqual([{ assetId: 1, granteeWallet: 1, status: 1 }, {}]);
    expect(AccessGrantModel.schema.indexes()).toContainEqual([{ granteeWallet: 1, status: 1 }, {}]);
    expect(AccessGrantModel.schema.indexes()).toContainEqual([{ ownerWallet: 1, assetId: 1 }, {}]);
    expect(AccessGrantModel.schema.indexes()).toContainEqual([{ blockchainTxHash: 1 }, { unique: true }]);
    expect(FolderModel.schema.indexes()).toContainEqual([{ ownerWallet: 1, parentFolderId: 1 }, {}]);
    expect(WrappedKeyModel.schema.indexes()).toContainEqual([
      { assetId: 1, userWallet: 1, version: 1 },
      { unique: true }
    ]);
    expect(AssetVersionModel.schema.indexes()).toContainEqual([
      { assetId: 1, version: 1 },
      { unique: true }
    ]);
  });
});
