import { Router } from "express";
import { verifyMessage } from "ethers";
import { z } from "zod";
import { createChallenge, consumeChallenge } from "../auth/challenges.js";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSession,
  destroySession
} from "../auth/session.js";
import { logger, logSecurityEvent } from "../config/logger.js";
import { authLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { recordAuditEvent } from "../services/audit-events.js";
import { validateRequest } from "../middleware/validate-request.js";

const verifyBodySchema = z
  .object({
    message: z.string().min(1).max(1000),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().min(1).max(500)
  })
  .strict();

export const authRouter = Router();

authRouter.use(authLimiter);

authRouter.get("/challenge", (_req, res) => {
  logger.info({ authFlow: "challenge_requested" }, "wallet auth challenge requested");
  const challenge = createChallenge();
  logger.info({ authFlow: "challenge_issued" }, "wallet auth challenge issued");

  res.json({
    message: challenge.message,
    nonce: challenge.nonce,
    expiresAt: new Date(challenge.expiresAt).toISOString()
  });
});

authRouter.post("/verify", validateRequest({ body: verifyBodySchema }), async (req, res, next) => {
  logger.info({ authFlow: "verify_reached" }, "wallet auth verify reached");
  const { message, nonce, signature } = req.body as z.infer<typeof verifyBodySchema>;
  const challenge = consumeChallenge(nonce, message);

  if (!challenge) {
    logSecurityEvent("auth_challenge_invalid", { requestId: req.id });
    return res.status(401).json({
      error: {
        code: "AUTH_INVALID_CHALLENGE",
        message: "Invalid or expired authentication challenge"
      }
    });
  }

  let walletAddress: string;
  try {
    walletAddress = verifyMessage(message, signature).toLowerCase();
  } catch {
    logSecurityEvent("auth_signature_invalid", { requestId: req.id });
    return res.status(401).json({
      error: {
        code: "AUTH_INVALID_SIGNATURE",
        message: "Invalid wallet signature"
      }
    });
  }
  logger.info({ authFlow: "signature_verified", walletAddress }, "wallet auth signature verified");

  try {
    await recordAuditEvent({
      walletAddress,
      action: "WALLET_AUTHENTICATED",
      detail: "Wallet authenticated"
    });
  } catch (error) {
    return next(error);
  }

  const sessionId = createSession(walletAddress);
  logger.info({ authFlow: "session_created", walletAddress }, "wallet auth session created");
  res.setHeader("set-cookie", buildSessionCookie(sessionId));
  return res.json({
    authenticated: true,
    walletAddress
  });
});

authRouter.post("/logout", (req, res) => {
  if (req.sessionId) {
    destroySession(req.sessionId);
  }

  res.setHeader("set-cookie", buildClearSessionCookie());
  return res.json({ authenticated: false });
});

authRouter.get("/me", requireAuth, (req, res) => {
  if (!req.auth) {
    logger.info({ authFlow: "current_user_unauthenticated" }, "wallet auth current user unauthenticated");
    return res.status(401).json({
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required"
      }
    });
  }

  logger.info({ authFlow: "current_user_authenticated", walletAddress: req.auth.walletAddress }, "wallet auth current user authenticated");
  return res.json({
    authenticated: true,
    walletAddress: req.auth.walletAddress
  });
});
