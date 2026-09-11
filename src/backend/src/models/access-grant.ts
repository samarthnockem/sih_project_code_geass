import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const accessGrantSchema = new Schema(
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
    granteeWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    granteeDisplayName: {
      type: String,
      trim: true,
      maxlength: 100
    },
    accessType: {
      type: String,
      required: true,
      enum: ["READ", "WRITE"],
      index: true
    },
    validFrom: {
      type: Date
    },
    validUntil: {
      type: Date
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    blockchainTxHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{64}$/,
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: ["ACTIVE", "REVOKED", "EXPIRED"],
      default: "ACTIVE",
      index: true
    },
    revokedAt: {
      type: Date
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    strict: "throw"
  }
);

accessGrantSchema.pre("validate", function validateAccessGrantWindow() {
  const grant = this as {
    validFrom?: Date;
    validUntil?: Date;
    revokedAt?: Date;
    status?: string;
  };

  if (grant.validFrom && grant.validUntil && grant.validUntil <= grant.validFrom) {
    throw new Error("validUntil must be after validFrom");
  }

  if (grant.status === "REVOKED" && !grant.revokedAt) {
    throw new Error("revokedAt is required when status is REVOKED");
  }

  if (grant.status !== "REVOKED" && grant.revokedAt) {
    throw new Error("revokedAt can only be set for revoked grants");
  }
});

accessGrantSchema.index({ assetId: 1, granteeWallet: 1, status: 1 });
accessGrantSchema.index({ granteeWallet: 1, status: 1 });
accessGrantSchema.index({ ownerWallet: 1, assetId: 1 });
accessGrantSchema.index({ blockchainTxHash: 1 }, { unique: true });

assertNoForbiddenFields(accessGrantSchema, "AccessGrant");

export type AccessGrant = InferSchemaType<typeof accessGrantSchema>;
export const AccessGrantModel = mongoose.models.AccessGrant || mongoose.model("AccessGrant", accessGrantSchema);
