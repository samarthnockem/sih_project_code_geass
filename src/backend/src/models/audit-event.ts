import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const transactionHashPattern = /^0x[a-fA-F0-9]{64}$/;

export const auditEventActions = [
  "WALLET_AUTHENTICATED",
  "ASSET_UPLOADED",
  "BLOCKCHAIN_REGISTERED",
  "ASSET_OPENED",
  "ACCESS_GRANTED",
  "ACCESS_REVOKED",
  "STRONG_REVOKE_COMPLETED",
  "DOCUMENT_MOVED",
  "INTEGRITY_VERIFIED",
  "VERSION_COMMITTED"
] as const;
export type AuditEventAction = (typeof auditEventActions)[number];

const auditEventSchema = new Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      required: false,
      default: null,
      index: true
    },
    action: {
      type: String,
      required: true,
      enum: auditEventActions,
      index: true
    },
    detail: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    blockchainTxHash: {
      type: String,
      trim: true,
      lowercase: true,
      match: transactionHashPattern,
      required: false,
      default: null
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: false,
    strict: "throw"
  }
);

auditEventSchema.index({ walletAddress: 1, timestamp: -1 });
auditEventSchema.index({ assetId: 1, timestamp: -1 });
auditEventSchema.index(
  { blockchainTxHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      blockchainTxHash: {
        $type: "string"
      }
    }
  }
);

assertNoForbiddenFields(auditEventSchema, "AuditEvent");

export type AuditEvent = InferSchemaType<typeof auditEventSchema>;
export const AuditEventModel = mongoose.models.AuditEvent || mongoose.model("AuditEvent", auditEventSchema);
