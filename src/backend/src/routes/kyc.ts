import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import { UserModel } from "../models/user.js";

const kycStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

const mockVerifyBodySchema = z.preprocess(
  (value) => value ?? {},
  z
    .object({
      kycStatus: kycStatusSchema.default("VERIFIED")
    })
    .strict()
);

export const kycRouter = Router();

function safeKycStatus(user: {
  walletAddress: string;
  kycStatus?: string;
  verificationMethod?: string;
  verifiedAt?: Date | string;
}) {
  return {
    walletAddress: user.walletAddress,
    kycStatus: user.kycStatus || "PENDING",
    verificationMethod: user.verificationMethod || null,
    verifiedAt: user.verifiedAt ? new Date(user.verifiedAt).toISOString() : null
  };
}

kycRouter.get("/status", requireAuth, async (req, res, next) => {
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
    const user = await UserModel.findOneAndUpdate(
      { walletAddress },
      {
        $setOnInsert: {
          walletAddress,
          kycStatus: "PENDING"
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    )
      .select("walletAddress kycStatus verificationMethod verifiedAt -_id")
      .lean();

    return res.json(safeKycStatus(user));
  } catch (error) {
    return next(error);
  }
});

kycRouter.post(
  "/mock-verify",
  requireAuth,
  validateRequest({ body: mockVerifyBodySchema }),
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

      const walletAddress = req.auth.walletAddress.toLowerCase();
      const { kycStatus } = req.body as z.infer<typeof mockVerifyBodySchema>;
      const verifiedAt = kycStatus === "VERIFIED" ? new Date() : undefined;
      const user = await UserModel.findOneAndUpdate(
        { walletAddress },
        {
          $set: {
            kycStatus,
            verificationMethod: "MOCK",
            verifiedAt
          },
          $setOnInsert: {
            walletAddress
          }
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      )
        .select("walletAddress kycStatus verificationMethod verifiedAt -_id")
        .lean();

      return res.json({
        ...safeKycStatus(user),
        demoOnly: true,
        message: "Mock KYC verification is demo-only and is not production identity verification."
      });
    } catch (error) {
      return next(error);
    }
  }
);
