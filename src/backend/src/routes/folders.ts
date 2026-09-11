import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors/http-error.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import { AssetModel } from "../models/asset.js";
import { FolderModel } from "../models/folder.js";

const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !/[\x00-\x1F\x7F]/.test(value),
    "Folder name must not contain path segments"
  );

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);

const createFolderBodySchema = z
  .object({
    name: folderNameSchema,
    parentFolderId: objectIdSchema.nullish()
  })
  .strict();

const folderParamsSchema = z
  .object({
    folderId: objectIdSchema
  })
  .strict();

type SafeFolderInput = {
  _id: unknown;
  ownerWallet: string;
  name: string;
  parentFolderId?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

function safeFolder(folder: SafeFolderInput) {
  return {
    id: folder._id?.toString(),
    ownerWallet: folder.ownerWallet,
    name: folder.name,
    parentFolderId: folder.parentFolderId ? folder.parentFolderId.toString() : null,
    createdAt: folder.createdAt instanceof Date ? folder.createdAt.toISOString() : undefined,
    updatedAt: folder.updatedAt instanceof Date ? folder.updatedAt.toISOString() : undefined
  };
}

function folderNotFound() {
  return new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
}

export const foldersRouter = Router();

foldersRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const folders = await FolderModel.find({ ownerWallet })
      .sort({ name: 1, createdAt: 1 })
      .select("ownerWallet name parentFolderId createdAt updatedAt")
      .lean();

    return res.json({
      folders: folders.map(safeFolder)
    });
  } catch (error) {
    return next(error);
  }
});

foldersRouter.post(
  "/",
  requireAuth,
  validateRequest({ body: createFolderBodySchema }),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        return res.status(401).json({
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication required"
          }
        });
      }

      const ownerWallet = req.auth.walletAddress.toLowerCase();
      const { name, parentFolderId } = req.body as z.infer<typeof createFolderBodySchema>;

      if (parentFolderId) {
        const parentFolder = await FolderModel.findOne({ _id: parentFolderId, ownerWallet }).select("_id").lean();
        if (!parentFolder) {
          throw folderNotFound();
        }
      }

      const folder = await FolderModel.create({
        ownerWallet,
        name,
        parentFolderId: parentFolderId || null
      });

      return res.status(201).json({
        folder: safeFolder(folder)
      });
    } catch (error) {
      return next(error);
    }
  }
);

foldersRouter.get(
  "/:folderId",
  requireAuth,
  validateRequest({ params: folderParamsSchema }),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        return res.status(401).json({
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication required"
          }
        });
      }

      const ownerWallet = req.auth.walletAddress.toLowerCase();
      const { folderId } = req.params as z.infer<typeof folderParamsSchema>;
      const folder = await FolderModel.findOne({ _id: folderId, ownerWallet })
        .select("ownerWallet name parentFolderId createdAt updatedAt")
        .lean();

      if (!folder) {
        throw folderNotFound();
      }

      return res.json({
        folder: safeFolder(folder)
      });
    } catch (error) {
      return next(error);
    }
  }
);

foldersRouter.delete(
  "/:folderId",
  requireAuth,
  validateRequest({ params: folderParamsSchema }),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        return res.status(401).json({
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication required"
          }
        });
      }

      const ownerWallet = req.auth.walletAddress.toLowerCase();
      const { folderId } = req.params as z.infer<typeof folderParamsSchema>;
      const folder = await FolderModel.findOne({ _id: folderId, ownerWallet }).select("_id").lean();

      if (!folder) {
        throw folderNotFound();
      }

      const assetCount = await AssetModel.countDocuments({ ownerWallet, folderId });
      if (assetCount > 0) {
        throw new HttpError(
          409,
          "FOLDER_NOT_EMPTY",
          "Folder contains assets; move assets to Unfiled before deleting the folder"
        );
      }

      await FolderModel.deleteOne({ _id: folderId, ownerWallet });

      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  }
);
