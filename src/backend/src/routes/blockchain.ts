import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { AssetModel } from "../models/asset.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import { createBlockchainReadService, type BlockchainReadService } from "../services/blockchain-read.js";

type BlockchainRecordAsset = {
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
};

type BlockchainDisplayRecord = {
  assetId: string;
  filename: string;
  ownerWallet: string;
  currentHash: string;
  currentVersion: number;
  registrationTxHash: string | null;
  blockNumber: number | null;
  status: string;
};

function dbHash(asset: BlockchainRecordAsset) {
  return asset.sha256 ? `0x${asset.sha256.toLowerCase()}` : "";
}

async function buildBlockchainDisplayRecord(
  asset: BlockchainRecordAsset,
  blockchain: BlockchainReadService,
  walletAddress: string
): Promise<BlockchainDisplayRecord | null> {
  const assetId = asset._id?.toString();
  if (!assetId) {
    return null;
  }

  const base: BlockchainDisplayRecord = {
    assetId,
    filename: asset.filename,
    ownerWallet: asset.ownerWallet,
    currentHash: dbHash(asset),
    currentVersion: asset.currentVersion,
    registrationTxHash: asset.registrationTransactionHash || null,
    blockNumber: typeof asset.registrationBlockNumber === "number" ? asset.registrationBlockNumber : null,
    status: asset.status
  };

  if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    return base;
  }

  try {
    const permission = await blockchain.getPermission(asset.blockchainAssetId, walletAddress);
    if (permission === "NONE") {
      return null;
    }

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
      status:
        ownerWallet === asset.ownerWallet.toLowerCase() &&
        currentHash === dbHash(asset) &&
        currentVersion === asset.currentVersion
          ? "VERIFIED"
          : "BLOCKCHAIN_MISMATCH"
    };
  } catch {
    return {
      ...base,
      status: "BLOCKCHAIN_VERIFICATION_FAILED"
    };
  }
}

export const blockchainRouter = Router();

blockchainRouter.get("/records", requireAuth, async (req, res, next) => {
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
    const accessibleAssetIds = wrappedKeys.map((key) => key.assetId);
    const assets = await AssetModel.find({
      $or: [{ ownerWallet: walletAddress }, { _id: { $in: accessibleAssetIds } }]
    })
      .sort({ createdAt: -1 })
      .select(
        "ownerWallet filename sha256 currentVersion status blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus"
      )
      .lean();

    const blockchain = createBlockchainReadService();
    const records = (
      await Promise.all(assets.map((asset) => buildBlockchainDisplayRecord(asset, blockchain, walletAddress)))
    ).filter((record): record is BlockchainDisplayRecord => record !== null);

    return res.json({ records });
  } catch (error) {
    return next(error);
  }
});
