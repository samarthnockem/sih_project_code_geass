import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const wrappingMetadataSchema = new Schema(
  {
    algorithm: {
      type: String,
      required: true,
      enum: ["RSA-OAEP", "PBKDF2-SHA-256+A256GCM"]
    },
    keyId: {
      type: String,
      trim: true,
      minlength: 1,
      maxlength: 255
    },
    kdf: {
      type: new Schema(
        {
          algorithm: {
            type: String,
            required: true,
            enum: ["PBKDF2-SHA-256"]
          },
          iterations: {
            type: Number,
            required: true,
            min: 210000
          },
          salt: {
            type: String,
            required: true,
            trim: true,
            minlength: 16,
            maxlength: 4096
          }
        },
        {
          _id: false,
          strict: "throw"
        }
      ),
      required: false
    },
    keyEncryption: {
      type: new Schema(
        {
          algorithm: {
            type: String,
            required: true,
            enum: ["AES-256-GCM"]
          },
          iv: {
            type: String,
            required: true,
            trim: true,
            minlength: 16,
            maxlength: 4096
          }
        },
        {
          _id: false,
          strict: "throw"
        }
      ),
      required: false
    }
  },
  {
    _id: false,
    strict: "throw"
  }
);

wrappingMetadataSchema.pre("validate", function validateWrappingMetadata() {
  const metadata = this as {
    algorithm?: string;
    keyId?: string;
    kdf?: unknown;
    keyEncryption?: unknown;
  };

  if (metadata.algorithm === "RSA-OAEP" && (!metadata.keyId || metadata.kdf || metadata.keyEncryption)) {
    throw new Error("RSA-OAEP wrapping metadata requires only keyId");
  }

  if (metadata.algorithm === "PBKDF2-SHA-256+A256GCM" && (metadata.keyId || !metadata.kdf || !metadata.keyEncryption)) {
    throw new Error("Password wrapping metadata requires kdf and keyEncryption metadata");
  }
});

const wrappedKeySchema = new Schema(
  {
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true
    },
    userWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    wrappedAESKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1
    },
    version: {
      type: Number,
      required: true,
      min: 1
    },
    wrappingMetadata: {
      type: wrappingMetadataSchema,
      required: true
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
      index: true
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

wrappedKeySchema.index({ assetId: 1, userWallet: 1, version: 1 }, { unique: true });
wrappedKeySchema.index({ assetId: 1, userWallet: 1, active: 1 });

assertNoForbiddenFields(wrappedKeySchema, "WrappedKey");

export type WrappedKey = InferSchemaType<typeof wrappedKeySchema>;
export const WrappedKeyModel = mongoose.models.WrappedKey || mongoose.model("WrappedKey", wrappedKeySchema);
