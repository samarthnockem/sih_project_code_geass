import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const userSchema = new Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern
    },
    publicEncryptionKey: {
      type: String,
      trim: true,
      minlength: 1
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 100
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254
    },
    kycStatus: {
      type: String,
      enum: ["PENDING", "VERIFIED", "REJECTED"],
      default: "PENDING"
    },
    verificationMethod: {
      type: String,
      enum: ["MOCK"]
    },
    verifiedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

assertNoForbiddenFields(userSchema, "User");

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
