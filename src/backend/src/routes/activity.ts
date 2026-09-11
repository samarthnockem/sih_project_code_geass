import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors/http-error.js";
import { requireAuth } from "../middleware/require-auth.js";
import { AssetModel } from "../models/asset.js";
import { AuditEventModel } from "../models/audit-event.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import { createBlockchainReadService } from "../services/blockchain-read.js";
import { safeAuditEvent } from "../services/audit-events.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);

function accessDenied() {
  return new HttpError(403, "ASSET_ACCESS_DENIED", "Asset access denied");
}

async function assertCanReadAssetActivity(assetId: string, walletAddress: string) {
  const asset = await AssetModel.findOne({
    _id: assetId,
    status: { $in: ["ACTIVE", "active"] }
  })
    .select("_id ownerWallet blockchainAssetId blockchainVerificationStatus")
    .lean();

  if (!asset) {
    throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
  }

  if (asset.ownerWallet.toLowerCase() === walletAddress) {
    return asset;
  }

  if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    throw accessDenied();
  }

  const permission = await createBlockchainReadService()
    .getPermission(asset.blockchainAssetId, walletAddress)
    .catch(() => "NONE");
  if (permission !== "READ" && permission !== "WRITE") {
    throw accessDenied();
  }

  return asset;
}

export const activityRouter = Router();

activityRouter.get("/", requireAuth, async (req, res, next) => {
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
    const wrappedKeys = await WrappedKeyModel.find({ userWallet: walletAddress, active: true }).select("assetId").lean();
    const ownedAssets = await AssetModel.find({ ownerWallet: walletAddress }).select("_id").lean();
    const wrappedAssetIds = wrappedKeys.map((key) => key.assetId);
    const sharedAssets = wrappedAssetIds.length
      ? await AssetModel.find({
          _id: { $in: wrappedAssetIds },
          ownerWallet: { $ne: walletAddress },
          status: { $in: ["ACTIVE", "active"] },
          blockchainVerificationStatus: "verified"
        })
          .select("_id blockchainAssetId")
          .lean()
      : [];
    const blockchain = createBlockchainReadService();
    const permittedSharedAssetIds = (
      await Promise.all(
        sharedAssets.map(async (asset) => {
          if (!asset.blockchainAssetId) {
            return null;
          }

          const permission = await blockchain.getPermission(asset.blockchainAssetId, walletAddress).catch(() => "NONE");
          return permission === "READ" || permission === "WRITE" ? asset._id : null;
        })
      )
    ).filter((assetId): assetId is NonNullable<typeof assetId> => assetId !== null);
    const accessibleAssetIds = [...ownedAssets.map((asset) => asset._id), ...permittedSharedAssetIds];

    const events = await AuditEventModel.find({
      $or: [{ walletAddress }, { assetId: { $in: accessibleAssetIds } }]
    })
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

activityRouter.get("/assets/:assetId", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = z.object({ assetId: objectIdSchema }).strict().parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    await assertCanReadAssetActivity(parsedParams.assetId, walletAddress);

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
