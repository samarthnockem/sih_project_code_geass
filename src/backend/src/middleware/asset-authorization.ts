import type { Request, RequestHandler } from "express";
import { createBlockchainReadService, type BlockchainReadService, type Permission } from "../services/blockchain-read.js";

type AssetIdResolver = (req: Request) => string;

export type AssetAuthorizationOptions = {
  blockchain?: BlockchainReadService;
  resolveAssetId?: AssetIdResolver;
};

const defaultResolveAssetId: AssetIdResolver = (req) => {
  const assetId = req.params.assetId;
  return Array.isArray(assetId) ? assetId[0] : assetId;
};

function authRequired(res: Parameters<RequestHandler>[1]) {
  return res.status(401).json({
    error: {
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    }
  });
}

function accessDenied(res: Parameters<RequestHandler>[1]) {
  return res.status(403).json({
    error: {
      code: "ASSET_ACCESS_DENIED",
      message: "Asset access denied"
    }
  });
}

function hasReadPermission(permission: Permission) {
  return permission === "READ" || permission === "WRITE";
}

function hasWritePermission(permission: Permission) {
  return permission === "WRITE";
}

export function createAssetAuthorizationHelpers(options: AssetAuthorizationOptions = {}) {
  const blockchain = options.blockchain ?? createBlockchainReadService();
  const resolveAssetId = options.resolveAssetId ?? defaultResolveAssetId;

  function requirePermission(isAllowed: (permission: Permission) => boolean): RequestHandler {
    return async (req, res, next) => {
      try {
        const walletAddress = req.auth?.walletAddress;
        if (!walletAddress) {
          return authRequired(res);
        }

        const permission = await blockchain.getPermission(resolveAssetId(req), walletAddress);
        if (!isAllowed(permission)) {
          return accessDenied(res);
        }

        return next();
      } catch {
        return accessDenied(res);
      }
    };
  }

  const requireAssetOwner: RequestHandler = async (req, res, next) => {
    try {
      const walletAddress = req.auth?.walletAddress;
      if (!walletAddress) {
        return authRequired(res);
      }

      const ownerWallet = await blockchain.getAssetOwner(resolveAssetId(req));
      if (ownerWallet.toLowerCase() !== walletAddress.toLowerCase()) {
        return accessDenied(res);
      }

      return next();
    } catch {
      return accessDenied(res);
    }
  };

  return {
    requireAssetOwner,
    requireAssetRead: requirePermission(hasReadPermission),
    requireAssetWrite: requirePermission(hasWritePermission)
  };
}

export const { requireAssetOwner, requireAssetRead, requireAssetWrite } = createAssetAuthorizationHelpers();
