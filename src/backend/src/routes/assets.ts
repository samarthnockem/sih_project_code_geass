import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../errors/http-error.js";
import { requireAuth } from "../middleware/require-auth.js";
import { AssetAuditEventModel } from "../models/asset-audit-event.js";
import { AssetModel } from "../models/asset.js";
import { AssetVersionModel } from "../models/asset-version.js";
import { AccessGrantModel } from "../models/access-grant.js";
import { AuditEventModel } from "../models/audit-event.js";
import { FolderModel } from "../models/folder.js";
import { UserModel } from "../models/user.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import { BlockchainVerificationError, createBlockchainReadService } from "../services/blockchain-read.js";
import { recordAuditEvent, safeAuditEvent } from "../services/audit-events.js";
import { deleteEncryptedAsset, getEncryptedAsset, storeEncryptedAsset } from "../services/encrypted-asset-storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ENCRYPTED_ASSET_MAX_BYTES,
    files: 1,
    fields: 9
  }
});

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);
const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const originalSizeSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
const mimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value), "MIME type must not contain control characters");
const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !/[\x00-\x1F\x7F<>:"|?*]/.test(value),
    "Filename must not contain path segments"
  );

const forbiddenSecretFieldNames = new Set([
  "aesKey",
  "rawAESKey",
  "rawAesKey",
  "raw_aes_key",
  "rawKey",
  "secretKey",
  "plaintextFile",
  "fileContents",
  "plaintextFilePassword",
  "filePassword",
  "password",
  "plaintextPassword",
  "passwordDerivedSecretKey",
  "walletPrivateKey",
  "privateKey",
  "privateEncryptionKey",
  "documentEncryptionPrivateKey",
  "mnemonic",
  "passphrase",
  "seedPhrase"
]);

function canonicalFieldName(fieldName: string) {
  return fieldName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const canonicalForbiddenSecretFieldNames = new Set([...forbiddenSecretFieldNames].map(canonicalFieldName));

function containsForbiddenSecretField(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsForbiddenSecretField);
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, nestedValue]) =>
      canonicalForbiddenSecretFieldNames.has(canonicalFieldName(key)) || containsForbiddenSecretField(nestedValue)
  );
}

const encryptionMetadataSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected JSON object");
      }

      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected JSON object"
      });
      return z.NEVER;
    }
  })
  .refine((value) => !containsForbiddenSecretField(value), "Metadata contains forbidden secret fields")
  .pipe(
    z
      .object({
        algorithm: z.literal("AES-256-GCM"),
        iv: z.string().trim().min(1).max(4096),
        tag: z.string().trim().min(1).max(4096)
      })
      .strict()
  );

const wrappingMetadataSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected JSON object");
      }

      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected JSON object"
      });
      return z.NEVER;
    }
  })
  .refine((value) => !containsForbiddenSecretField(value), "Metadata contains forbidden secret fields")
  .pipe(
    z.discriminatedUnion("algorithm", [
      z
        .object({
          algorithm: z.literal("RSA-OAEP"),
          keyId: z.string().trim().min(1).max(255)
        })
        .strict(),
      z
        .object({
          algorithm: z.literal("PBKDF2-SHA-256+A256GCM"),
          kdf: z
            .object({
              algorithm: z.literal("PBKDF2-SHA-256"),
              iterations: z.number().int().min(210000).max(2000000),
              salt: z.string().trim().min(16).max(4096)
            })
            .strict(),
          keyEncryption: z
            .object({
              algorithm: z.literal("AES-256-GCM"),
              iv: z.string().trim().min(16).max(4096)
            })
            .strict()
        })
        .strict()
    ])
  );

const wrappingMetadataObjectSchema = z
  .unknown()
  .refine((value) => !containsForbiddenSecretField(value), "Metadata contains forbidden secret fields")
  .pipe(
    z.discriminatedUnion("algorithm", [
      z
        .object({
          algorithm: z.literal("RSA-OAEP"),
          keyId: z.string().trim().min(1).max(255)
        })
        .strict(),
      z
        .object({
          algorithm: z.literal("PBKDF2-SHA-256+A256GCM"),
          kdf: z
            .object({
              algorithm: z.literal("PBKDF2-SHA-256"),
              iterations: z.number().int().min(210000).max(2000000),
              salt: z.string().trim().min(16).max(4096)
            })
            .strict(),
          keyEncryption: z
            .object({
              algorithm: z.literal("AES-256-GCM"),
              iv: z.string().trim().min(16).max(4096)
            })
            .strict()
        })
        .strict()
    ])
  );

const uploadBodySchema = z
  .object({
    filename: filenameSchema,
    mimeType: mimeTypeSchema,
    originalSize: originalSizeSchema,
    sha256: sha256Schema,
    wrappedAESKey: z.string().trim().min(1).max(20000),
    encryptionMetadata: encryptionMetadataSchema,
    wrappingMetadata: wrappingMetadataSchema,
    passwordProtectionEnabled: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    folderId: objectIdSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const passwordProtected = value.passwordProtectionEnabled === true;
    const passwordWrapped = value.wrappingMetadata.algorithm === "PBKDF2-SHA-256+A256GCM";

    if (passwordProtected !== passwordWrapped) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wrappingMetadata"],
        message: passwordProtected
          ? "Password-protected uploads must use password wrapping metadata"
          : "Non-password uploads must use owner public-key wrapping metadata"
      });
    }
  });

const moveAssetFolderParamsSchema = z
  .object({
    assetId: objectIdSchema
  })
  .strict();

const blockchainSyncParamsSchema = z
  .object({
    assetId: objectIdSchema
  })
  .strict();

const blockchainSyncBodySchema = z
  .object({
    transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  })
  .strict();

const walletAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => value.toLowerCase());

const accessGrantTimestampSchema = z
  .union([z.number().int(), z.string().trim()])
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") {
      return 0;
    }

    const timestamp = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected a non-negative Unix timestamp"
      });
      return z.NEVER;
    }

    return timestamp;
  });

const grantAccessSyncParamsSchema = z
  .object({
    assetId: objectIdSchema
  })
  .strict();

const grantAccessSyncBodySchema = z
  .object({
    granteeWallet: walletAddressSchema,
    wrappedAESKey: z.string().trim().min(1).max(20000),
    accessType: z.enum(["READ", "WRITE"]),
    validFrom: accessGrantTimestampSchema,
    validUntil: accessGrantTimestampSchema,
    reason: z.string().trim().max(1000).optional(),
    granteeDisplayName: z.string().trim().min(1).max(100).optional(),
    blockchainTransactionHash: z
      .string()
      .trim()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
    wrappingMetadata: wrappingMetadataObjectSchema
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.validUntil !== 0 && value.validUntil <= value.validFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "validUntil must be after validFrom"
      });
    }
  });

const revokeAccessSyncBodySchema = z
  .object({
    granteeWallet: walletAddressSchema,
    blockchainTransactionHash: z
      .string()
      .trim()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase())
  })
  .strict();

const strongRevokePrepareBodySchema = z
  .object({
    granteeWallet: walletAddressSchema
  })
  .strict();

const wrappedKeySetSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (containsForbiddenSecretField(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Wrapped-key set contains forbidden secret fields"
        });
        return z.NEVER;
      }
      return parsed;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected JSON array"
      });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z
          .object({
            walletAddress: walletAddressSchema,
            wrappedAESKey: z.string().trim().min(1).max(20000),
            wrappingMetadata: wrappingMetadataObjectSchema
          })
          .strict()
      )
      .min(1)
      .max(100)
  );

const strongRevokeFinalizeBodySchema = z
  .object({
    expectedPreviousVersion: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number(value))
      .pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)),
    newVersion: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number(value))
      .pipe(z.number().int().min(2).max(Number.MAX_SAFE_INTEGER)),
    sha256: sha256Schema,
    encryptionMetadata: encryptionMetadataSchema,
    wrappedKeys: wrappedKeySetSchema,
    blockchainTransactionHash: z
      .string()
      .trim()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
    commitMessage: z.string().trim().max(500).optional()
  })
  .strict();

const moveAssetFolderBodySchema = z
  .object({
    folderId: objectIdSchema.nullable()
  })
  .strict();

const listAssetsQuerySchema = z
  .object({
    folderId: objectIdSchema.optional()
  })
  .strict();

const myAssetsQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    folderId: objectIdSchema.optional()
  })
  .strict();

function singleEncryptedFile(req: Parameters<typeof upload.single>[0]) {
  return upload.single(req);
}

function accessDenied() {
  return new HttpError(403, "ASSET_ACCESS_DENIED", "Asset access denied");
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function safeAssetFolder(asset: { _id: unknown; ownerWallet: string; filename: string; folderId?: unknown }) {
  return {
    id: asset._id?.toString(),
    ownerWallet: asset.ownerWallet,
    filename: asset.filename,
    folderId: asset.folderId ? asset.folderId.toString() : null
  };
}

function safeAssetSummary(asset: {
  _id: unknown;
  ownerWallet: string;
  filename: string;
  size?: number;
  mimeType?: string;
  sha256: string;
  currentVersion: number;
  status: string;
  passwordProtectionEnabled?: boolean;
  blockchainAssetId?: string;
  folderId?: unknown;
  registrationTransactionHash?: string;
  registrationBlockNumber?: number;
  blockchainVerificationStatus?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: asset._id?.toString(),
    ownerWallet: asset.ownerWallet,
    filename: asset.filename,
    size: typeof asset.size === "number" ? asset.size : 0,
    mimeType: asset.mimeType || "application/octet-stream",
    sha256: asset.sha256,
    currentVersion: asset.currentVersion,
    status: asset.status,
    passwordProtectionEnabled: asset.passwordProtectionEnabled ?? false,
    blockchainAssetId: asset.blockchainAssetId || null,
    folderId: asset.folderId ? asset.folderId.toString() : null,
    registrationTransactionHash: asset.registrationTransactionHash || null,
    registrationBlockNumber: typeof asset.registrationBlockNumber === "number" ? asset.registrationBlockNumber : null,
    blockchainVerificationStatus: asset.blockchainVerificationStatus || "pending",
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : undefined,
    updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : undefined
  };
}

function safeMyAsset(asset: Parameters<typeof safeAssetSummary>[0]) {
  const summary = safeAssetSummary(asset);
  return {
    assetId: summary.id,
    filename: summary.filename,
    size: summary.size,
    mimeType: summary.mimeType,
    folderId: summary.folderId,
    sha256: summary.sha256,
    currentVersion: summary.currentVersion,
    status: summary.status,
    passwordProtectionEnabled: summary.passwordProtectionEnabled,
    createdAt: summary.createdAt,
    blockchainAssetId: summary.blockchainAssetId,
    registrationTransactionHash: summary.registrationTransactionHash,
    registrationBlockNumber: summary.registrationBlockNumber,
    blockchainVerificationStatus: summary.blockchainVerificationStatus
  };
}

function dateOrNull(value: unknown) {
  return value instanceof Date ? value.toISOString() : null;
}

function isExpired(validUntil: unknown, now: Date) {
  return validUntil instanceof Date && validUntil.getTime() <= now.getTime();
}

function assetVersionKey(assetId: unknown, version: number) {
  return `${assetId?.toString()}:${version}`;
}

async function loadAuthorizedEncryptedAsset(assetId: string, walletAddress: string) {
  const asset = await AssetModel.findOne({
    _id: assetId,
    status: { $in: ["ACTIVE", "active"] }
  })
    .select("_id ownerWallet filename size mimeType blockchainAssetId blockchainVerificationStatus")
    .lean();

  if (!asset || !asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    throw accessDenied();
  }

  const blockchain = createBlockchainReadService();
  const [permission, currentVersion, currentHash] = await Promise.all([
    blockchain.getPermission(asset.blockchainAssetId, walletAddress),
    blockchain.getCurrentVersion(asset.blockchainAssetId),
    blockchain.getCurrentHash(asset.blockchainAssetId)
  ]).catch(() => {
    throw accessDenied();
  });

  if (permission !== "READ" && permission !== "WRITE") {
    throw accessDenied();
  }

  const sha256 = currentHash.startsWith("0x") ? currentHash.slice(2).toLowerCase() : currentHash.toLowerCase();
  const assetVersion = await AssetVersionModel.findOne({
    assetId: asset._id,
    version: currentVersion,
    sha256
  })
    .select("encryptedStorageReference encryptionMetadata sha256 version -_id")
    .lean();

  if (!assetVersion) {
    throw accessDenied();
  }

  const wrappedKey = await WrappedKeyModel.findOne({
    assetId: asset._id,
    userWallet: walletAddress,
    version: currentVersion,
    active: true
  })
    .select("wrappedAESKey wrappingMetadata -_id")
    .lean();

  if (!wrappedKey) {
    throw accessDenied();
  }

  return {
    asset,
    assetVersion,
    wrappedKey,
    permission,
    currentVersion,
    sha256
  };
}

async function loadAuthorizedAssetIntegrity(assetId: string, walletAddress: string) {
  const asset = await AssetModel.findOne({
    _id: assetId,
    status: { $in: ["ACTIVE", "active"] }
  })
    .select("_id ownerWallet filename blockchainAssetId blockchainVerificationStatus")
    .lean();

  if (!asset || !asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    throw accessDenied();
  }

  const blockchain = createBlockchainReadService();
  const [permission, currentVersion, currentHash] = await Promise.all([
    blockchain.getPermission(asset.blockchainAssetId, walletAddress),
    blockchain.getCurrentVersion(asset.blockchainAssetId),
    blockchain.getCurrentHash(asset.blockchainAssetId)
  ]).catch(() => {
    throw accessDenied();
  });

  if (permission !== "READ" && permission !== "WRITE") {
    throw accessDenied();
  }

  const blockchainSha256 = currentHash.startsWith("0x") ? currentHash.slice(2).toLowerCase() : currentHash.toLowerCase();
  const assetVersion = await AssetVersionModel.findOne({
    assetId: asset._id,
    version: currentVersion,
    sha256: blockchainSha256
  })
    .select("sha256 version -_id")
    .lean();

  if (!assetVersion) {
    throw accessDenied();
  }

  return {
    currentVersion,
    expectedSha256: assetVersion.sha256.toLowerCase(),
    blockchainSha256,
    blockchainVerificationStatus: "verified" as const
  };
}

async function currentAuthorizedWalletsForAsset(asset: {
  _id: unknown;
  ownerWallet: string;
  blockchainAssetId: string;
}) {
  const ownerWallet = asset.ownerWallet.toLowerCase();
  const now = new Date();
  const activeGrants = await AccessGrantModel.find({
    assetId: asset._id,
    ownerWallet,
    status: "ACTIVE",
    $or: [{ validUntil: null }, { validUntil: { $gt: now } }]
  })
    .select("granteeWallet accessType")
    .lean();

  const blockchain = createBlockchainReadService();
  const wallets = new Set<string>([ownerWallet]);
  await Promise.all(
    activeGrants.map(async (grant) => {
      const permission = await blockchain.getPermission(asset.blockchainAssetId, grant.granteeWallet);
      if (permission === "READ" || permission === "WRITE") {
        wallets.add(grant.granteeWallet.toLowerCase());
      }
    })
  );

  return [...wallets].sort();
}

function assertSameWalletSet(actual: string[], expected: string[]) {
  const normalizedActual = [...new Set(actual.map((wallet) => wallet.toLowerCase()))].sort();
  const normalizedExpected = [...new Set(expected.map((wallet) => wallet.toLowerCase()))].sort();

  if (
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((wallet, index) => wallet !== normalizedExpected[index])
  ) {
    throw new HttpError(
      400,
      "WRAPPED_KEY_RECIPIENTS_MISMATCH",
      "Wrapped-key recipients must match the currently authorized wallets"
    );
  }
}

function confirmationStateForBlockchainDetail(input: {
  hasBlockchainAssetId: boolean;
  blockchainVerificationStatus?: string | null;
  status: string;
  hasRegistrationBlock: boolean;
}) {
  if (!input.hasBlockchainAssetId || input.blockchainVerificationStatus === "pending") {
    return "PENDING";
  }

  if (input.status === "BLOCKCHAIN_MISMATCH") {
    return "MISMATCH";
  }

  if (input.blockchainVerificationStatus === "failed" || input.status === "BLOCKCHAIN_VERIFICATION_FAILED") {
    return "FAILED";
  }

  if (input.blockchainVerificationStatus === "verified" && input.hasRegistrationBlock) {
    return "CONFIRMED";
  }

  return "PENDING";
}

async function latestKnownChainTransaction(assetId: unknown) {
  const [auditEvent, version] = await Promise.all([
    AuditEventModel.findOne({
      assetId,
      action: { $in: ["ACCESS_GRANTED", "ACCESS_REVOKED", "VERSION_COMMITTED"] },
      blockchainTxHash: { $type: "string" }
    })
      .sort({ timestamp: -1 })
      .select("action detail blockchainTxHash timestamp -_id")
      .lean(),
    AssetVersionModel.findOne({
      assetId,
      blockchainTransactionHash: { $type: "string" }
    })
      .sort({ version: -1 })
      .select("version blockchainTransactionHash updatedAt createdAt -_id")
      .lean()
  ]);

  const versionTimestamp =
    version && "updatedAt" in version && version.updatedAt instanceof Date
      ? version.updatedAt
      : version?.createdAt instanceof Date
        ? version.createdAt
        : null;
  const versionCandidate = version?.blockchainTransactionHash
    ? {
        action: "VERSION_COMMITTED",
        detail: `Version ${version.version} committed on-chain`,
        blockchainTxHash: version.blockchainTransactionHash,
        timestamp: versionTimestamp
      }
    : null;

  const auditTimestamp = auditEvent?.timestamp instanceof Date ? auditEvent.timestamp : null;
  if (auditEvent && (!versionCandidate || (auditTimestamp?.getTime() || 0) >= (versionCandidate.timestamp?.getTime() || 0))) {
    return {
      action: auditEvent.action,
      detail: auditEvent.detail,
      blockchainTxHash: auditEvent.blockchainTxHash || null,
      timestamp: auditTimestamp ? auditTimestamp.toISOString() : null
    };
  }

  if (versionCandidate) {
    return {
      action: versionCandidate.action,
      detail: versionCandidate.detail,
      blockchainTxHash: versionCandidate.blockchainTxHash,
      timestamp: versionCandidate.timestamp ? versionCandidate.timestamp.toISOString() : null
    };
  }

  return null;
}

async function safeBlockchainAssetDetail(asset: {
  _id: unknown;
  ownerWallet: string;
  filename: string;
  sha256: string;
  currentVersion: number;
  status: string;
  blockchainAssetId?: string | null;
  registrationTransactionHash?: string | null;
  registrationBlockNumber?: number | null;
  blockchainVerificationStatus?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const applicationAssetId = asset._id?.toString();
  const latestKnownTransaction = await latestKnownChainTransaction(asset._id);
  const base = {
    assetId: applicationAssetId,
    filename: asset.filename,
    ownerWallet: asset.ownerWallet,
    blockchainAssetId: asset.blockchainAssetId || null,
    currentHash: asset.sha256 ? `0x${asset.sha256.toLowerCase()}` : "",
    currentVersion: asset.currentVersion,
    registrationTxHash: asset.registrationTransactionHash || null,
    blockNumber: typeof asset.registrationBlockNumber === "number" ? asset.registrationBlockNumber : null,
    status: asset.status,
    blockchainVerificationStatus: asset.blockchainVerificationStatus || "pending",
    confirmationState: confirmationStateForBlockchainDetail({
      hasBlockchainAssetId: !!asset.blockchainAssetId,
      blockchainVerificationStatus: asset.blockchainVerificationStatus,
      status: asset.status,
      hasRegistrationBlock: typeof asset.registrationBlockNumber === "number"
    }),
    registration: {
      transactionHash: asset.registrationTransactionHash || null,
      blockNumber: typeof asset.registrationBlockNumber === "number" ? asset.registrationBlockNumber : null,
      confirmed: asset.blockchainVerificationStatus === "verified" && typeof asset.registrationBlockNumber === "number"
    },
    current: {
      ownerWallet: asset.ownerWallet,
      hash: asset.sha256 ? `0x${asset.sha256.toLowerCase()}` : "",
      version: asset.currentVersion
    },
    latestKnownTransaction,
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : undefined,
    updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : undefined
  };

  if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    return base;
  }

  const blockchain = createBlockchainReadService();
  try {
    const [ownerWallet, currentHash, currentVersion] = await Promise.all([
      blockchain.getAssetOwner(asset.blockchainAssetId),
      blockchain.getCurrentHash(asset.blockchainAssetId),
      blockchain.getCurrentVersion(asset.blockchainAssetId)
    ]);

    return {
      ...base,
      ownerWallet,
      currentHash,
      currentVersion,
      current: {
        ownerWallet,
        hash: currentHash,
        version: currentVersion
      },
      status:
        ownerWallet === asset.ownerWallet.toLowerCase() &&
        currentHash === `0x${asset.sha256.toLowerCase()}` &&
        currentVersion === asset.currentVersion
          ? "VERIFIED"
          : "BLOCKCHAIN_MISMATCH",
      blockchainVerificationStatus:
        ownerWallet === asset.ownerWallet.toLowerCase() &&
        currentHash === `0x${asset.sha256.toLowerCase()}` &&
        currentVersion === asset.currentVersion
          ? "verified"
          : "failed",
      confirmationState: confirmationStateForBlockchainDetail({
        hasBlockchainAssetId: true,
        blockchainVerificationStatus:
          ownerWallet === asset.ownerWallet.toLowerCase() &&
          currentHash === `0x${asset.sha256.toLowerCase()}` &&
          currentVersion === asset.currentVersion
            ? "verified"
            : "failed",
        status:
          ownerWallet === asset.ownerWallet.toLowerCase() &&
          currentHash === `0x${asset.sha256.toLowerCase()}` &&
          currentVersion === asset.currentVersion
            ? "VERIFIED"
            : "BLOCKCHAIN_MISMATCH",
        hasRegistrationBlock: typeof asset.registrationBlockNumber === "number"
      })
    };
  } catch {
    return {
      ...base,
      status: "BLOCKCHAIN_VERIFICATION_FAILED",
      blockchainVerificationStatus: "failed",
      confirmationState: "FAILED"
    };
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const assetsRouter = Router();

assetsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedQuery = listAssetsQuerySchema.parse(req.query);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const filter: { ownerWallet: string; status: { $in: string[] }; folderId?: string } = {
      ownerWallet,
      status: { $in: ["ACTIVE", "active"] }
    };

    if (parsedQuery.folderId) {
      const folder = await FolderModel.findOne({ _id: parsedQuery.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
      filter.folderId = parsedQuery.folderId;
    }

    const assets = await AssetModel.find(filter)
      .sort({ createdAt: -1 })
      .select("ownerWallet filename sha256 currentVersion status passwordProtectionEnabled folderId createdAt updatedAt")
      .lean();

    return res.json({
      assets: assets.map(safeAssetSummary)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/my", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedQuery = myAssetsQuerySchema.parse(req.query);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const filter: {
      ownerWallet: string;
      folderId?: string;
      filename?: { $regex: string; $options: string };
    } = {
      ownerWallet
    };

    if (parsedQuery.search) {
      filter.filename = {
        $regex: escapeRegex(parsedQuery.search),
        $options: "i"
      };
    }

    if (parsedQuery.folderId) {
      const folder = await FolderModel.findOne({ _id: parsedQuery.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
      filter.folderId = parsedQuery.folderId;
    }

    const assets = await AssetModel.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "ownerWallet filename size mimeType sha256 currentVersion status passwordProtectionEnabled folderId blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt"
      )
      .lean();

    return res.json({
      assets: assets.map(safeMyAsset)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/shared-with-me", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const walletAddress = req.auth.walletAddress.toLowerCase();
    const wrappedKeys = await WrappedKeyModel.find({ userWallet: walletAddress, active: true })
      .select("assetId version")
      .lean();

    if (!wrappedKeys.length) {
      return res.json({ assets: [] });
    }

    const allowedAssetVersions = new Set(wrappedKeys.map((key) => assetVersionKey(key.assetId, key.version)));
    const assetIds = [...new Set(wrappedKeys.map((key) => key.assetId?.toString()).filter(Boolean))];
    const assets = await AssetModel.find({
      _id: { $in: assetIds },
      ownerWallet: { $ne: walletAddress },
      status: { $in: ["ACTIVE", "active"] }
    })
      .sort({ createdAt: -1 })
      .select(
        "_id ownerWallet filename size mimeType sha256 currentVersion blockchainAssetId blockchainVerificationStatus"
      )
      .lean();

    const chainRegisteredAssets = assets.filter(
      (asset) =>
        asset.blockchainAssetId &&
        asset.blockchainVerificationStatus === "verified" &&
        allowedAssetVersions.has(assetVersionKey(asset._id, asset.currentVersion))
    );

    if (!chainRegisteredAssets.length) {
      return res.json({ assets: [] });
    }

    const grants = await AccessGrantModel.find({
      assetId: { $in: chainRegisteredAssets.map((asset) => asset._id) },
      granteeWallet: walletAddress,
      status: "ACTIVE"
    })
      .sort({ createdAt: -1 })
      .select("assetId accessType validUntil")
      .lean();
    const now = new Date();

    const grantsByAssetAndPermission = new Map<string, (typeof grants)[number]>();
    for (const grant of grants) {
      if (isExpired(grant.validUntil, now)) continue;
      const key = `${grant.assetId?.toString()}:${grant.accessType}`;
      if (!grantsByAssetAndPermission.has(key)) {
        grantsByAssetAndPermission.set(key, grant);
      }
    }

    const ownerWallets = [...new Set(chainRegisteredAssets.map((asset) => asset.ownerWallet))];
    const owners = await UserModel.find({ walletAddress: { $in: ownerWallets } })
      .select("walletAddress displayName")
      .lean();
    const ownerDisplayNames = new Map(owners.map((owner) => [owner.walletAddress, owner.displayName || null]));

    const blockchain = createBlockchainReadService();
    const sharedAssets = [];
    for (const asset of chainRegisteredAssets) {
      const permission = await blockchain.getPermission(asset.blockchainAssetId, walletAddress);
      if (permission !== "READ" && permission !== "WRITE") {
        continue;
      }

      const grant = grantsByAssetAndPermission.get(`${asset._id?.toString()}:${permission}`);
      if (!grant) {
        continue;
      }

      sharedAssets.push({
        assetId: asset._id?.toString(),
        filename: asset.filename,
        ownerWallet: asset.ownerWallet,
        ownerDisplayName: ownerDisplayNames.get(asset.ownerWallet) || null,
        permission,
        expiry: dateOrNull(grant.validUntil),
        currentVersion: asset.currentVersion,
        sha256: asset.sha256,
        blockchainVerified: true,
        size: typeof asset.size === "number" ? asset.size : 0,
        mimeType: asset.mimeType || "application/octet-stream"
      });
    }

    return res.json({ assets: sharedAssets });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.post("/", requireAuth, singleEncryptedFile("encryptedFile"), async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsed = uploadBodySchema.parse(req.body);
    if (!req.file) {
      throw new HttpError(400, "ENCRYPTED_FILE_REQUIRED", "Encrypted file is required");
    }

    if (req.file.mimetype !== "application/octet-stream") {
      throw new HttpError(400, "INVALID_ENCRYPTED_FILE", "Encrypted file must be application/octet-stream");
    }

    const ownerWallet = req.auth.walletAddress.toLowerCase();

    if (parsed.folderId) {
      const folder = await FolderModel.findOne({ _id: parsed.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
    }

    const stored = await storeEncryptedAsset({
      encryptedBytes: req.file.buffer,
      originalFilename: parsed.filename
    });

    try {
      const asset = await AssetModel.create({
        ownerWallet,
        filename: parsed.filename,
        size: parsed.originalSize,
        mimeType: parsed.mimeType,
        currentVersion: 1,
        sha256: parsed.sha256,
        status: "PENDING_BLOCKCHAIN",
        blockchainVerificationStatus: "pending",
        passwordProtectionEnabled: parsed.passwordProtectionEnabled ?? false,
        folderId: parsed.folderId ?? null
      });

      await AssetVersionModel.create({
        assetId: asset._id,
        version: 1,
        encryptedStorageReference: stored.storageId,
        encryptionMetadata: parsed.encryptionMetadata,
        sha256: parsed.sha256,
        createdBy: ownerWallet,
        commitMessage: "Initial encrypted upload"
      });

      await WrappedKeyModel.create({
        assetId: asset._id,
        userWallet: ownerWallet,
        wrappedAESKey: parsed.wrappedAESKey,
        version: 1,
        wrappingMetadata: parsed.wrappingMetadata,
        active: true
      });

      await AssetAuditEventModel.create({
        assetId: asset._id,
        ownerWallet,
        actorWallet: ownerWallet,
        eventType: "ASSET_UPLOADED",
        fromFolderId: null,
        toFolderId: parsed.folderId ?? null
      });
      await recordAuditEvent({
        walletAddress: ownerWallet,
        assetId: asset._id,
        action: "ASSET_UPLOADED",
        detail: `${parsed.filename} uploaded as encrypted asset`
      });

      return res.status(201).json({
        asset: {
          id: asset._id.toString(),
          ownerWallet,
          filename: parsed.filename,
          size: parsed.originalSize,
          mimeType: parsed.mimeType,
          sha256: parsed.sha256,
          currentVersion: 1,
          status: "PENDING_BLOCKCHAIN",
          blockchainVerificationStatus: "pending",
          passwordProtectionEnabled: parsed.passwordProtectionEnabled ?? false,
          folderId: parsed.folderId ?? null,
          createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : undefined,
          updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : undefined
        }
      });
    } catch (error) {
      await deleteEncryptedAsset(stored.storageId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

assetsRouter.post("/:assetId/blockchain-sync", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = blockchainSyncParamsSchema.parse(req.params);
    const parsedBody = blockchainSyncBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select(
        "_id ownerWallet filename size mimeType sha256 currentVersion status passwordProtectionEnabled folderId blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt updatedAt"
      )
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (asset.status === "ACTIVE" && asset.blockchainVerificationStatus === "verified") {
      throw new HttpError(409, "ASSET_ALREADY_SYNCED", "Asset is already registered on-chain");
    }

    const existingTransaction = await AssetModel.findOne({
      registrationTransactionHash: parsedBody.transactionHash.toLowerCase(),
      _id: { $ne: parsedParams.assetId }
    })
      .select("_id")
      .lean();

    if (existingTransaction) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked to another asset");
    }

    const blockchain = createBlockchainReadService();
    const verified = await blockchain.verifyAssetRegistration({
      transactionHash: parsedBody.transactionHash,
      applicationAssetId: parsedParams.assetId,
      expectedOwnerWallet: ownerWallet,
      expectedSha256: asset.sha256
    });

    const updatedAsset = await AssetModel.findOneAndUpdate(
      {
        _id: parsedParams.assetId,
        ownerWallet,
        registrationTransactionHash: { $in: [null, verified.transactionHash] }
      },
      {
        $set: {
          blockchainAssetId: verified.blockchainAssetId,
          registrationTransactionHash: verified.transactionHash,
          registrationBlockNumber: verified.blockNumber,
          status: "ACTIVE",
          blockchainVerificationStatus: "verified"
        }
      },
      {
        new: true,
        runValidators: true
      }
    )
      .select(
        "_id ownerWallet filename size mimeType sha256 currentVersion status passwordProtectionEnabled folderId blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt updatedAt"
      )
      .lean();

    if (!updatedAsset) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked");
    }
    await recordAuditEvent({
      walletAddress: ownerWallet,
      assetId: updatedAsset._id,
      action: "BLOCKCHAIN_REGISTERED",
      detail: `${updatedAsset.filename} registered on-chain`,
      blockchainTxHash: verified.transactionHash
    });

    return res.json({
      asset: safeAssetSummary(updatedAsset)
    });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.get("/:assetId/access", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet blockchainAssetId blockchainVerificationStatus")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      return res.json({ access: [] });
    }

    const blockchain = createBlockchainReadService();
    const blockchainOwner = await blockchain.getAssetOwner(asset.blockchainAssetId);
    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw accessDenied();
    }

    const grants = await AccessGrantModel.find({ assetId: asset._id, ownerWallet })
      .sort({ createdAt: -1 })
      .select("granteeWallet granteeDisplayName accessType validFrom validUntil reason blockchainTxHash status")
      .lean();
    const now = new Date();

    const access = await Promise.all(
      grants.map(async (grant) => {
        const currentPermission = await blockchain.getPermission(asset.blockchainAssetId, grant.granteeWallet);
        const status = isExpired(grant.validUntil, now)
          ? "EXPIRED"
          : currentPermission === grant.accessType && grant.status === "ACTIVE"
            ? "ACTIVE"
            : "REVOKED";

        return {
          granteeWallet: grant.granteeWallet,
          granteeDisplayName: grant.granteeDisplayName || null,
          accessType: grant.accessType,
          validFrom: dateOrNull(grant.validFrom),
          validUntil: dateOrNull(grant.validUntil),
          reason: grant.reason || null,
          status,
          blockchainTxHash: grant.blockchainTxHash
        };
      })
    );

    return res.json({ access });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.post("/:assetId/access/grant-sync", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const parsedBody = grantAccessSyncBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename currentVersion blockchainAssetId blockchainVerificationStatus status")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      throw new HttpError(409, "ASSET_NOT_REGISTERED_ON_CHAIN", "Asset must be registered on-chain before granting access");
    }

    const existingGrant = await AccessGrantModel.findOne({
      blockchainTxHash: parsedBody.blockchainTransactionHash
    })
      .select("_id")
      .lean();

    if (existingGrant) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked to an access grant");
    }

    const blockchain = createBlockchainReadService();
    const blockchainOwner = await blockchain.getAssetOwner(asset.blockchainAssetId);
    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw new HttpError(403, "ASSET_ACCESS_DENIED", "Asset owner could not be verified on-chain");
    }

    const verifiedGrant = await blockchain.verifyAccessGrant({
      transactionHash: parsedBody.blockchainTransactionHash,
      blockchainAssetId: asset.blockchainAssetId,
      expectedOwnerWallet: ownerWallet,
      expectedGranteeWallet: parsedBody.granteeWallet,
      expectedAccessType: parsedBody.accessType,
      expectedValidFrom: parsedBody.validFrom,
      expectedValidUntil: parsedBody.validUntil
    });

    const activeGrant = await AccessGrantModel.create({
      assetId: asset._id,
      ownerWallet,
      granteeWallet: verifiedGrant.granteeWallet,
      granteeDisplayName: parsedBody.granteeDisplayName,
      accessType: verifiedGrant.accessType,
      validFrom: verifiedGrant.validFrom ? new Date(verifiedGrant.validFrom * 1000) : undefined,
      validUntil: verifiedGrant.validUntil ? new Date(verifiedGrant.validUntil * 1000) : undefined,
      reason: parsedBody.reason,
      blockchainTxHash: verifiedGrant.transactionHash,
      status: "ACTIVE"
    });

    await WrappedKeyModel.create({
      assetId: asset._id,
      userWallet: verifiedGrant.granteeWallet,
      wrappedAESKey: parsedBody.wrappedAESKey,
      version: asset.currentVersion,
      wrappingMetadata: parsedBody.wrappingMetadata,
      active: true
    });

    await AssetAuditEventModel.create({
      assetId: asset._id,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_ACCESS_GRANTED",
      fromFolderId: null,
      toFolderId: null
    });
    await recordAuditEvent({
      walletAddress: ownerWallet,
      assetId: asset._id,
      action: "ACCESS_GRANTED",
      detail: `${asset.filename} access granted to ${verifiedGrant.granteeWallet}`,
      blockchainTxHash: verifiedGrant.transactionHash
    });

    return res.status(201).json({
      accessGrant: {
        id: activeGrant._id.toString(),
        assetId: asset._id.toString(),
        ownerWallet,
        granteeWallet: verifiedGrant.granteeWallet,
        granteeDisplayName: parsedBody.granteeDisplayName || null,
        accessType: verifiedGrant.accessType,
        validFrom: verifiedGrant.validFrom ? new Date(verifiedGrant.validFrom * 1000).toISOString() : null,
        validUntil: verifiedGrant.validUntil ? new Date(verifiedGrant.validUntil * 1000).toISOString() : null,
        reason: parsedBody.reason || null,
        blockchainTxHash: verifiedGrant.transactionHash,
        blockNumber: verifiedGrant.blockNumber,
        status: "ACTIVE"
      }
    });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.post("/:assetId/access/revoke-sync", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const parsedBody = revokeAccessSyncBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename blockchainAssetId blockchainVerificationStatus status")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      throw new HttpError(409, "ASSET_NOT_REGISTERED_ON_CHAIN", "Asset must be registered on-chain before revoking access");
    }

    const replayedGrantTx = await AccessGrantModel.findOne({
      blockchainTxHash: parsedBody.blockchainTransactionHash
    })
      .select("_id")
      .lean();
    const replayedRevokeTx = await AuditEventModel.findOne({
      blockchainTxHash: parsedBody.blockchainTransactionHash
    })
      .select("_id")
      .lean();

    if (replayedGrantTx || replayedRevokeTx) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked to an access change");
    }

    const blockchain = createBlockchainReadService();
    const blockchainOwner = await blockchain.getAssetOwner(asset.blockchainAssetId);
    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw new HttpError(403, "ASSET_ACCESS_DENIED", "Asset owner could not be verified on-chain");
    }

    const verifiedRevoke = await blockchain.verifyAccessRevoke({
      transactionHash: parsedBody.blockchainTransactionHash,
      blockchainAssetId: asset.blockchainAssetId,
      expectedOwnerWallet: ownerWallet,
      expectedGranteeWallet: parsedBody.granteeWallet
    });
    const currentPermission = await blockchain.getPermission(asset.blockchainAssetId, verifiedRevoke.granteeWallet);
    if (currentPermission !== "NONE") {
      throw new HttpError(400, "BLOCKCHAIN_VERIFICATION_FAILED", "Revoked wallet still has on-chain access");
    }

    const revokedAt = new Date();
    await AccessGrantModel.updateMany(
      {
        assetId: asset._id,
        ownerWallet,
        granteeWallet: verifiedRevoke.granteeWallet,
        status: "ACTIVE"
      },
      {
        $set: {
          status: "REVOKED",
          revokedAt
        }
      }
    );

    await WrappedKeyModel.updateMany(
      {
        assetId: asset._id,
        userWallet: verifiedRevoke.granteeWallet,
        active: true
      },
      {
        $set: {
          active: false
        }
      }
    );

    await AssetAuditEventModel.create({
      assetId: asset._id,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_ACCESS_REVOKED",
      fromFolderId: null,
      toFolderId: null
    });
    await recordAuditEvent({
      walletAddress: ownerWallet,
      assetId: asset._id,
      action: "ACCESS_REVOKED",
      detail: `${asset.filename} access revoked for ${verifiedRevoke.granteeWallet}`,
      blockchainTxHash: verifiedRevoke.transactionHash
    });

    return res.json({
      revokedAccess: {
        assetId: asset._id.toString(),
        ownerWallet,
        granteeWallet: verifiedRevoke.granteeWallet,
        blockchainTxHash: verifiedRevoke.transactionHash,
        blockNumber: verifiedRevoke.blockNumber,
        status: "REVOKED",
        revokedAt: revokedAt.toISOString()
      }
    });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.post("/:assetId/access/strong-revoke/prepare", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const parsedBody = strongRevokePrepareBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename sha256 currentVersion blockchainAssetId blockchainVerificationStatus passwordProtectionEnabled status")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      throw new HttpError(409, "ASSET_NOT_REGISTERED_ON_CHAIN", "Asset must be registered on-chain before strong revocation");
    }

    const blockchain = createBlockchainReadService();
    const [blockchainOwner, revokedPermission, currentVersion, currentHash] = await Promise.all([
      blockchain.getAssetOwner(asset.blockchainAssetId),
      blockchain.getPermission(asset.blockchainAssetId, parsedBody.granteeWallet),
      blockchain.getCurrentVersion(asset.blockchainAssetId),
      blockchain.getCurrentHash(asset.blockchainAssetId)
    ]);

    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw new HttpError(403, "ASSET_ACCESS_DENIED", "Asset owner could not be verified on-chain");
    }
    if (revokedPermission !== "NONE") {
      throw new HttpError(409, "REVOKE_SYNC_REQUIRED", "Target grantee must be revoked on-chain before strong revocation");
    }

    const blockchainSha256 = currentHash.startsWith("0x") ? currentHash.slice(2).toLowerCase() : currentHash.toLowerCase();
    if (currentVersion !== asset.currentVersion || blockchainSha256 !== asset.sha256.toLowerCase()) {
      throw new HttpError(409, "ASSET_VERSION_OUT_OF_SYNC", "Stored asset version does not match the blockchain current version");
    }

    const authorizedWallets = (await currentAuthorizedWalletsForAsset({
      _id: asset._id,
      ownerWallet,
      blockchainAssetId: asset.blockchainAssetId
    })).filter((wallet) => wallet !== parsedBody.granteeWallet);

    const users = await UserModel.find({ walletAddress: { $in: authorizedWallets } })
      .select("walletAddress publicEncryptionKey -_id")
      .lean();
    const publicKeyByWallet = new Map(users.map((user) => [user.walletAddress.toLowerCase(), user.publicEncryptionKey || null]));
    const missingPublicKeyWallets = authorizedWallets.filter(
      (wallet) => wallet !== ownerWallet || !asset.passwordProtectionEnabled
    ).filter((wallet) => !publicKeyByWallet.get(wallet));

    if (missingPublicKeyWallets.length) {
      throw new HttpError(409, "PUBLIC_ENCRYPTION_KEY_REQUIRED", "Every remaining authorized wallet must have a public encryption key");
    }

    return res.json({
      strongRevoke: {
        assetId: asset._id.toString(),
        filename: asset.filename,
        currentVersion,
        nextVersion: currentVersion + 1,
        expectedSha256: asset.sha256.toLowerCase(),
        revokedGranteeWallet: parsedBody.granteeWallet,
        passwordProtectionEnabled: asset.passwordProtectionEnabled === true,
        recipients: authorizedWallets.map((wallet) => ({
          walletAddress: wallet,
          publicEncryptionKey: publicKeyByWallet.get(wallet) || null,
          requiresPasswordWrapping: wallet === ownerWallet && asset.passwordProtectionEnabled === true
        }))
      }
    });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.post("/:assetId/access/strong-revoke/finalize", requireAuth, upload.single("encryptedFile"), async (req, res, next) => {
  let stored: Awaited<ReturnType<typeof storeEncryptedAsset>> | null = null;
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const parsedBody = strongRevokeFinalizeBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    if (!req.file) {
      throw new HttpError(400, "ENCRYPTED_FILE_REQUIRED", "Encrypted file is required");
    }
    if (req.file.mimetype !== "application/octet-stream") {
      throw new HttpError(400, "INVALID_ENCRYPTED_FILE", "Encrypted file must be application/octet-stream");
    }
    if (parsedBody.newVersion !== parsedBody.expectedPreviousVersion + 1) {
      throw new HttpError(400, "INVALID_VERSION_SEQUENCE", "New version must immediately follow the previous version");
    }

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename size mimeType sha256 currentVersion blockchainAssetId blockchainVerificationStatus passwordProtectionEnabled status")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }
    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      throw new HttpError(409, "ASSET_NOT_REGISTERED_ON_CHAIN", "Asset must be registered on-chain before strong revocation");
    }
    if (asset.currentVersion !== parsedBody.expectedPreviousVersion) {
      throw new HttpError(409, "ASSET_VERSION_OUT_OF_SYNC", "Asset current version changed before strong revocation finalized");
    }

    const replayedVersionTx = await AssetVersionModel.findOne({
      blockchainTransactionHash: parsedBody.blockchainTransactionHash
    })
      .select("_id")
      .lean();
    const replayedAuditTx = await AuditEventModel.findOne({
      blockchainTxHash: parsedBody.blockchainTransactionHash
    })
      .select("_id")
      .lean();
    if (replayedVersionTx || replayedAuditTx) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked to a version update");
    }

    const blockchain = createBlockchainReadService();
    const blockchainOwner = await blockchain.getAssetOwner(asset.blockchainAssetId);
    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw new HttpError(403, "ASSET_ACCESS_DENIED", "Asset owner could not be verified on-chain");
    }
    const verifiedCommit = await blockchain.verifyVersionCommit({
      transactionHash: parsedBody.blockchainTransactionHash,
      blockchainAssetId: asset.blockchainAssetId,
      expectedCommitterWallet: ownerWallet,
      expectedSha256: parsedBody.sha256,
      expectedVersion: parsedBody.newVersion
    });

    const authorizedWallets = await currentAuthorizedWalletsForAsset({
      _id: asset._id,
      ownerWallet,
      blockchainAssetId: asset.blockchainAssetId
    });
    assertSameWalletSet(
      parsedBody.wrappedKeys.map((key) => key.walletAddress),
      authorizedWallets
    );

    stored = await storeEncryptedAsset({
      encryptedBytes: req.file.buffer,
      originalFilename: asset.filename
    });

    const createVersionDoc = {
      assetId: asset._id,
      version: verifiedCommit.version,
      encryptedStorageReference: stored.storageId,
      encryptionMetadata: parsedBody.encryptionMetadata,
      sha256: verifiedCommit.sha256,
      createdBy: ownerWallet,
      commitMessage: parsedBody.commitMessage || "Strong revocation key rotation",
      blockchainTransactionHash: verifiedCommit.transactionHash
    };
    const newWrappedKeyDocs = parsedBody.wrappedKeys.map((key) => ({
      assetId: asset._id,
      userWallet: key.walletAddress,
      wrappedAESKey: key.wrappedAESKey,
      version: verifiedCommit.version,
      wrappingMetadata: key.wrappingMetadata,
      active: true
    }));

    const runDbSwitch = async (session?: mongoose.ClientSession) => {
      if (session) {
        await AssetVersionModel.create([createVersionDoc], { session });
      } else {
        await AssetVersionModel.create(createVersionDoc);
      }
      await WrappedKeyModel.updateMany(
        {
          assetId: asset._id,
          version: asset.currentVersion,
          active: true
        },
        {
          $set: {
            active: false
          }
        },
        session ? { session } : undefined
      );
      if (session) {
        await WrappedKeyModel.create(newWrappedKeyDocs, { session });
      } else {
        await WrappedKeyModel.create(newWrappedKeyDocs);
      }
      const updatedAsset = await AssetModel.findOneAndUpdate(
        {
          _id: asset._id,
          ownerWallet,
          currentVersion: parsedBody.expectedPreviousVersion
        },
        {
          $set: {
            currentVersion: verifiedCommit.version,
            sha256: verifiedCommit.sha256,
            status: "ACTIVE",
            blockchainVerificationStatus: "verified"
          }
        },
        {
          new: true,
          runValidators: true,
          ...(session ? { session } : {})
        }
      );
      if (!updatedAsset) {
        throw new HttpError(409, "ASSET_VERSION_OUT_OF_SYNC", "Asset current version changed before strong revocation finalized");
      }
      const assetAuditEvent = {
        assetId: asset._id,
        ownerWallet,
        actorWallet: ownerWallet,
        eventType: "ASSET_STRONG_REVOKE_COMPLETED",
        fromFolderId: null,
        toFolderId: null
      };
      if (session) {
        await AssetAuditEventModel.create([assetAuditEvent], { session });
      } else {
        await AssetAuditEventModel.create(assetAuditEvent);
      }
    };

    if (mongoose.connection.readyState === 1) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(() => runDbSwitch(session));
      } finally {
        await session.endSession();
      }
    } else {
      await runDbSwitch();
    }

    await recordAuditEvent({
      walletAddress: ownerWallet,
      assetId: asset._id,
      action: "VERSION_COMMITTED",
      detail: `${asset.filename} version ${verifiedCommit.version} committed after strong revocation`,
      blockchainTxHash: verifiedCommit.transactionHash
    });
    await recordAuditEvent({
      walletAddress: ownerWallet,
      assetId: asset._id,
      action: "STRONG_REVOKE_COMPLETED",
      detail: `${asset.filename} current key set rotated for authorized users`
    });

    stored = null;
    return res.json({
      version: {
        assetId: asset._id.toString(),
        version: verifiedCommit.version,
        sha256: verifiedCommit.sha256,
        blockchainTxHash: verifiedCommit.transactionHash,
        blockNumber: verifiedCommit.blockNumber,
        wrappedKeyRecipients: authorizedWallets
      }
    });
  } catch (error) {
    if (stored) {
      await deleteEncryptedAsset(stored.storageId).catch(() => undefined);
    }
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.patch("/:assetId/folder", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const parsedBody = moveAssetFolderBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    if (parsedBody.folderId !== null) {
      const folder = await FolderModel.findOne({ _id: parsedBody.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
    }

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename folderId")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    const previousFolderId = asset.folderId ?? null;
    const updatedAsset = await AssetModel.findOneAndUpdate(
      { _id: parsedParams.assetId, ownerWallet },
      {
        $set: {
          folderId: parsedBody.folderId
        }
      },
      {
        new: true,
        runValidators: true
      }
    )
      .select("_id ownerWallet filename folderId")
      .lean();

    if (!updatedAsset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    await AssetAuditEventModel.create({
      assetId: updatedAsset._id,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_FOLDER_MOVED",
      fromFolderId: previousFolderId,
      toFolderId: parsedBody.folderId
    });
    await recordAuditEvent({
      walletAddress: ownerWallet,
      assetId: updatedAsset._id,
      action: "DOCUMENT_MOVED",
      detail: `${updatedAsset.filename} moved`
    });

    return res.json({
      asset: safeAssetFolder(updatedAsset)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/blockchain", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const asset = await AssetModel.findOne({ _id: parsedParams.assetId })
      .select(
        "_id ownerWallet filename sha256 currentVersion status blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt updatedAt"
      )
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    const isOwner = asset.ownerWallet.toLowerCase() === walletAddress;
    if (!isOwner) {
      if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
        throw accessDenied();
      }

      const blockchain = createBlockchainReadService();
      const permission = await blockchain.getPermission(asset.blockchainAssetId, walletAddress).catch(() => "NONE");
      if (permission === "NONE") {
        throw accessDenied();
      }
    }

    return res.json({
      blockchain: await safeBlockchainAssetDetail(asset)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/integrity", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const integrity = await loadAuthorizedAssetIntegrity(parsedParams.assetId, walletAddress);

    return res.json({
      integrity: {
        currentVersion: integrity.currentVersion,
        expectedSha256: integrity.expectedSha256,
        blockchainSha256: integrity.blockchainSha256,
        blockchainVerificationStatus: integrity.blockchainVerificationStatus
      }
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/activity", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    await loadAuthorizedAssetIntegrity(parsedParams.assetId, walletAddress);

    const events = await AuditEventModel.find({ assetId: parsedParams.assetId })
      .sort({ timestamp: -1 })
      .limit(100)
      .select("walletAddress assetId action detail blockchainTxHash timestamp")
      .lean();

    return res.json({
      activity: events.map(safeAuditEvent)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/open", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const { asset, assetVersion, wrappedKey, permission, currentVersion, sha256 } = await loadAuthorizedEncryptedAsset(
      parsedParams.assetId,
      walletAddress
    );
    await recordAuditEvent({
      walletAddress,
      assetId: asset._id,
      action: "ASSET_OPENED",
      detail: `${asset.filename} opened after access verification`
    });

    return res.json({
      asset: {
        assetId: asset._id?.toString(),
        blockchainAssetId: asset.blockchainAssetId,
        filename: asset.filename,
        mimeType: asset.mimeType || "application/octet-stream",
        size: typeof asset.size === "number" ? asset.size : 0,
        permission,
        currentVersion,
        sha256,
        expectedSha256: sha256,
        encryptionMetadata: assetVersion.encryptionMetadata,
        ciphertextUrl: `/api/assets/${asset._id?.toString()}/ciphertext`,
        EK_User: wrappedKey.wrappedAESKey,
        wrappingMetadata: wrappedKey.wrappingMetadata
      }
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/ciphertext", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const { asset, assetVersion } = await loadAuthorizedEncryptedAsset(parsedParams.assetId, walletAddress);
    const encryptedAsset = await getEncryptedAsset(assetVersion.encryptedStorageReference);
    if (!encryptedAsset) {
      throw new HttpError(404, "ENCRYPTED_ASSET_NOT_FOUND", "Encrypted asset not found");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(encryptedAsset.byteLength));
    res.setHeader("Content-Disposition", `attachment; filename="${asset.filename}"`);
    return res.send(encryptedAsset.encryptedBytes);
  } catch (error) {
    return next(error);
  }
});
