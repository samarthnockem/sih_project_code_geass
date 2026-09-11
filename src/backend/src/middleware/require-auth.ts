import type { RequestHandler } from "express";

declare module "express-serve-static-core" {
  interface Request {
    auth?: {
      walletAddress: string;
    };
  }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.walletAddress) {
    return res.status(401).json({
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required"
      }
    });
  }

  req.auth = {
    walletAddress: req.walletAddress
  };

  return next();
};
