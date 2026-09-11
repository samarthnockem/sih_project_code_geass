import { Router } from "express";
import { z } from "zod";
import { UserModel } from "../models/user.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validateRequest } from "../middleware/validate-request.js";

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const publicEncryptionKeySchema = z.string().trim().min(32).max(4096).regex(/^[A-Za-z0-9+/=._:-]+$/);
const displayNameSchema = z.string().trim().min(1).max(100);
const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .refine((value) => value === "" || z.string().email().safeParse(value).success);

const updateEncryptionKeyBodySchema = z
  .object({
    publicEncryptionKey: publicEncryptionKeySchema
  })
  .strict();

const publicKeyParamsSchema = z
  .object({
    wallet: walletAddressSchema
  })
  .strict();

const updateProfileBodySchema = z
  .object({
    displayName: displayNameSchema.optional(),
    email: emailSchema.optional()
  })
  .strict()
  .refine((body) => body.displayName !== undefined || body.email !== undefined);

export const usersRouter = Router();

function safeUserProfile(user: {
  walletAddress: string;
  displayName?: string;
  email?: string;
  kycStatus?: string;
  publicEncryptionKey?: string;
}) {
  return {
    walletAddress: user.walletAddress,
    displayName: user.displayName || "",
    email: user.email || "",
    kycStatus: user.kycStatus || "PENDING",
    publicEncryptionKey: user.publicEncryptionKey || null
  };
}

usersRouter.get("/me", requireAuth, async (req, res, next) => {
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
      .select("walletAddress displayName email kycStatus publicEncryptionKey -_id")
      .lean();

    return res.json(safeUserProfile(user));
  } catch (error) {
    return next(error);
  }
});

usersRouter.patch(
  "/me",
  requireAuth,
  validateRequest({ body: updateProfileBodySchema }),
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
      const { displayName, email } = req.body as z.infer<typeof updateProfileBodySchema>;
      const setFields: { displayName?: string; email?: string } = {};

      if (displayName !== undefined) setFields.displayName = displayName;
      if (email !== undefined) setFields.email = email;

      const user = await UserModel.findOneAndUpdate(
        { walletAddress },
        {
          $set: setFields,
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
        .select("walletAddress displayName email kycStatus publicEncryptionKey -_id")
        .lean();

      return res.json(safeUserProfile(user));
    } catch (error) {
      return next(error);
    }
  }
);

usersRouter.put(
  "/me/encryption-key",
  requireAuth,
  validateRequest({ body: updateEncryptionKeyBodySchema }),
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

      const { publicEncryptionKey } = req.body as z.infer<typeof updateEncryptionKeyBodySchema>;
      const walletAddress = req.auth.walletAddress.toLowerCase();

      await UserModel.findOneAndUpdate(
        { walletAddress },
        {
          $set: {
            walletAddress,
            publicEncryptionKey
          }
        },
        {
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );

      return res.json({
        walletAddress,
        publicEncryptionKey
      });
    } catch (error) {
      return next(error);
    }
  }
);

usersRouter.get("/:wallet/public-key", validateRequest({ params: publicKeyParamsSchema }), async (req, res, next) => {
  try {
    const { wallet } = req.params as z.infer<typeof publicKeyParamsSchema>;
    const walletAddress = wallet.toLowerCase();
    const user = await UserModel.findOne({ walletAddress }).select("walletAddress publicEncryptionKey -_id").lean();

    if (!user) {
      return res.status(404).json({
        error: {
          code: "PUBLIC_KEY_NOT_FOUND",
          message: "Public encryption key not found"
        }
      });
    }

    return res.json({
      walletAddress: user.walletAddress,
      publicEncryptionKey: user.publicEncryptionKey
    });
  } catch (error) {
    return next(error);
  }
});
