import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const sha256Pattern = /^[a-fA-F0-9]{64}$/;

const assetSchema = new Schema(
  {
    ownerWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    filename: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255
    },
    size: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255,
      default: "application/octet-stream"
    },
    blockchainAssetId: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    currentVersion: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    sha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: sha256Pattern,
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: ["PENDING_BLOCKCHAIN", "ACTIVE", "ARCHIVED", "REVOKED", "active", "archived", "revoked"],
      default: "PENDING_BLOCKCHAIN",
      index: true
    },
    passwordProtectionEnabled: {
      type: Boolean,
      required: true,
      default: false
    },
    folderId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      required: false,
      default: null,
      index: true
    },
    registrationTransactionHash: {
      type: String,
      trim: true,
      match: /^0x[a-fA-F0-9]{64}$/,
      sparse: true
    },
    registrationBlockNumber: {
      type: Number,
      min: 0
    },
    blockchainVerificationStatus: {
      type: String,
      required: true,
      enum: ["pending", "verified", "failed"],
      default: "pending"
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

assetSchema.index({ ownerWallet: 1, status: 1 });
assetSchema.index({ ownerWallet: 1, folderId: 1 });

assertNoForbiddenFields(assetSchema, "Asset");

export type Asset = InferSchemaType<typeof assetSchema>;
export const AssetModel = mongoose.models.Asset || mongoose.model("Asset", assetSchema);
