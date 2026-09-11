import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const folderSchema = new Schema(
  {
    ownerWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100
    },
    parentFolderId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      required: false,
      default: null,
      index: true
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

folderSchema.index({ ownerWallet: 1, parentFolderId: 1 });

assertNoForbiddenFields(folderSchema, "Folder");

export type Folder = InferSchemaType<typeof folderSchema>;
export const FolderModel = mongoose.models.Folder || mongoose.model("Folder", folderSchema);
