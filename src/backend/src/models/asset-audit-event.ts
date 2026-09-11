import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const assetAuditEventSchema = new Schema(
  {
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true
    },
    ownerWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    actorWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        "ASSET_UPLOADED",
        "ASSET_FOLDER_MOVED",
        "ASSET_ACCESS_GRANTED",
        "ASSET_ACCESS_REVOKED",
        "ASSET_STRONG_REVOKE_COMPLETED"
      ],
      index: true
    },
    fromFolderId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      required: false,
      default: null
    },
    toFolderId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      required: false,
      default: null
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: "throw"
  }
);

assetAuditEventSchema.index({ assetId: 1, createdAt: -1 });
assetAuditEventSchema.index({ ownerWallet: 1, createdAt: -1 });

assertNoForbiddenFields(assetAuditEventSchema, "AssetAuditEvent");

export type AssetAuditEvent = InferSchemaType<typeof assetAuditEventSchema>;
export const AssetAuditEventModel =
  mongoose.models.AssetAuditEvent || mongoose.model("AssetAuditEvent", assetAuditEventSchema);
